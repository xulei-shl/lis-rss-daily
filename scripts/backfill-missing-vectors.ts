import 'dotenv/config';
import { sql } from 'kysely';
import { initDb } from '../src/db.js';
import { buildVectorText } from '../src/vector/text-builder.js';
import { getEmbeddingsBatch } from '../src/vector/embedding-client.js';
import { upsert, buildVectorId } from '../src/vector/vector-store.js';
import { getCollection } from '../src/vector/chroma-client.js';

async function loadChromaIds() {
  const { ChromaClient, DefaultEmbeddingFunction } = await import('chromadb');
  const c = new ChromaClient({ path: 'http://127.0.0.1:8000' });
  // chromadb 1.10 types require embeddingFunction on getCollection; it is unused for reads
  const col = await c.getCollection({ name: 'articles', embeddingFunction: new DefaultEmbeddingFunction() });
  const ids = new Set<number>();
  let offset = 0;
  while (true) {
    const r: any = await col.get({ limit: 2000, offset, include: [] as any });
    for (const id of r.ids || []) ids.add(Number(String(id).split(':')[1]));
    if (!r.ids || r.ids.length < 2000) break;
    offset += 2000;
  }
  return ids;
}

async function main() {
  const chromaIds = await loadChromaIds();
  const db = initDb();
  const rows = await db.selectFrom('articles as a')
    .leftJoin('rss_sources as r', 'r.id', 'a.rss_source_id')
    .leftJoin('keyword_subscriptions as k', 'k.id', 'a.keyword_id')
    .leftJoin('journals as j', 'j.id', 'a.journal_id')
    .leftJoin('email_sources as e', 'e.id', 'a.email_source_id')
    .leftJoin('web_sources as w', 'w.id', 'a.web_source_id')
    .select(['a.id as id', sql<number>`coalesce(r.user_id, k.user_id, j.user_id, e.user_id, w.user_id)`.as('uid')] as any)
    .where((eb: any) => eb.or([eb('r.user_id','is not',null),eb('k.user_id','is not',null),eb('j.user_id','is not',null),eb('e.user_id','is not',null),eb('w.user_id','is not',null)]))
    .orderBy('a.id', 'asc').execute();
  const candidates = rows.map((r: any) => ({ id: Number(r.id), uid: Number(r.uid) })).filter(r => r.id > 0 && r.uid > 0);
  const missing = candidates.filter(c => !chromaIds.has(c.id));
  console.log('candidates', candidates.length, 'chroma', chromaIds.size, 'missing', missing.length);
  if (!missing.length) return;

  const batch = 16; let indexed = 0, empty = 0, failed = 0; const failures: any[] = [];
  for (let i = 0; i < missing.length; i += batch) {
    const chunk = missing.slice(i, i + batch);
    const arows = await db.selectFrom('articles').leftJoin('article_translations','article_translations.article_id','articles.id')
      .where('articles.id', 'in', chunk.map(c=>c.id))
      .select(['articles.id','articles.title','articles.content','articles.markdown_content','article_translations.title_zh','article_translations.summary_zh']).execute();
    const byId = new Map(arows.map((r: any) => [Number(r.id), r]));
    const groups = new Map<number, { ids: string[], docs: string[], metas: any[], aids: number[] }>();
    for (const c of chunk) {
      const row = byId.get(c.id);
      if (!row) { failed++; continue; }
      const doc = buildVectorText(row as any);
      if (!doc) { empty++; continue; }
      const g = groups.get(c.uid) || { ids: [], docs: [], metas: [], aids: [] };
      g.ids.push(buildVectorId(c.id, c.uid)); g.docs.push(doc); g.metas.push({ article_id: c.id, user_id: c.uid }); g.aids.push(c.id); groups.set(c.uid, g);
    }
    for (const [uid, g] of groups.entries()) {
      try { const emb = await getEmbeddingsBatch(g.docs, uid); await upsert(uid, g.ids, emb, g.metas, g.docs); indexed += g.ids.length; }
      catch (e: any) { failed += g.aids.length; failures.push({ ids: g.aids.slice(0,5), err: e?.message || String(e) }); }
    }
    if ((i / batch) % 5 === 0 || i + batch >= missing.length) console.log('progress', Math.min(i + batch, missing.length), '/', missing.length, 'indexed', indexed, 'empty', empty, 'failed', failed);
  }
  const { collection } = await getCollection(candidates[0].uid);
  const count = await (collection as any).count?.();
  console.log(JSON.stringify({ candidates: candidates.length, chromaBefore: chromaIds.size, missing: missing.length, indexed, empty, failed, count, failures: failures.slice(0,10) }, null, 2));
}
main().catch(e => { console.error(e?.stack || e); process.exit(1); });
