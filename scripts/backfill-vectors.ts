/**
 * Backfill article vectors into ChromaDB (rebuild-friendly).
 * Usage: pnpm exec tsx scripts/backfill-vectors.ts [--user-id N] [--limit N] [--offset N] [--batch-size 16] [--dry-run]
 */
import 'dotenv/config';
import { sql } from 'kysely';
import { initDb } from '../src/db.js';
import { logger } from '../src/logger.js';
import { buildVectorText } from '../src/vector/text-builder.js';
import { getEmbeddingsBatch } from '../src/vector/embedding-client.js';
import { upsert, buildVectorId } from '../src/vector/vector-store.js';
import { getClient, getCollection } from '../src/vector/chroma-client.js';
import { getActiveConfigByType } from '../src/api/llm-configs.js';
import { getChromaSettings } from '../src/api/settings.js';

const log = logger.child({ module: 'backfill-vectors' });
type Opts = { userId?: number; limit?: number; offset: number; batchSize: number; dryRun: boolean; help: boolean };
function parseArgs(argv: string[]): Opts {
  const opts: Opts = { offset: 0, batchSize: 16, dryRun: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--user-id') opts.userId = Number(next());
    else if (a === '--limit') opts.limit = Number(next());
    else if (a === '--offset') opts.offset = Number(next() || '0');
    else if (a === '--batch-size') opts.batchSize = Number(next() || '16');
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (opts.batchSize < 1 || opts.batchSize > 128) throw new Error('--batch-size must be 1-128');
  if (opts.offset < 0) throw new Error('--offset must be >= 0');
  return opts;
}
type Candidate = { id: number; user_id: number };
async function loadCandidates(opts: Opts): Promise<Candidate[]> {
  const db = initDb();
  let q = db
    .selectFrom('articles as a')
    .leftJoin('rss_sources as r', 'r.id', 'a.rss_source_id')
    .leftJoin('keyword_subscriptions as k', 'k.id', 'a.keyword_id')
    .leftJoin('journals as j', 'j.id', 'a.journal_id')
    .leftJoin('email_sources as e', 'e.id', 'a.email_source_id')
    .leftJoin('web_sources as w', 'w.id', 'a.web_source_id')
    .select(['a.id as id', sql<number>`coalesce(r.user_id, k.user_id, j.user_id, e.user_id, w.user_id)`.as('uid')] as any)
    .where((eb: any) => eb.or([eb('r.user_id','is not',null),eb('k.user_id','is not',null),eb('j.user_id','is not',null),eb('e.user_id','is not',null),eb('w.user_id','is not',null)]))
    .orderBy('a.id', 'asc');
  if (opts.userId) q = q.where((eb: any) => eb.or([eb('r.user_id','=',opts.userId),eb('k.user_id','=',opts.userId),eb('j.user_id','=',opts.userId),eb('e.user_id','=',opts.userId),eb('w.user_id','=',opts.userId)]));
  // SQLite requires LIMIT when using OFFSET; apply only when needed.
  if (opts.limit !== undefined) q = q.limit(opts.limit);
  if (opts.offset > 0) q = q.offset(opts.offset);
  const rows = await q.execute();
  return rows.map((r: any) => ({ id: Number(r.id), user_id: Number(r.uid) })).filter(r => r.id > 0 && r.user_id > 0);
}
async function loadArticleRows(ids: number[]) {
  if (ids.length === 0) return [] as any[];
  const db = initDb();
  return db.selectFrom('articles').leftJoin('article_translations','article_translations.article_id','articles.id')
    .where('articles.id','in',ids)
    .select(['articles.id','articles.title','articles.content','articles.markdown_content','article_translations.title_zh','article_translations.summary_zh']).execute();
}
async function preflight(userIds: number[], dryRun: boolean) {
  for (const uid of [...new Set(userIds)].sort((a,b)=>a-b)) {
    const emb = await getActiveConfigByType(uid,'embedding');
    const chroma = await getChromaSettings(uid);
    console.log(`user ${uid}: embedding=${emb ? `${emb.provider}/${emb.model}` : 'MISSING'} chroma=${chroma.host}:${chroma.port}/${chroma.collection}`);
    if (!dryRun && !emb) throw new Error(`Missing embedding config for user ${uid}`);
  }
  if (!dryRun) { const c = await getClient(userIds[0]); await c.heartbeat(); console.log('Chroma heartbeat: ok'); }
}
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log('Usage: pnpm exec tsx scripts/backfill-vectors.ts [--user-id N] [--limit N] [--offset N] [--batch-size 16] [--dry-run]'); return; }
  initDb();
  const candidates = await loadCandidates(opts);
  console.log(`candidates=${candidates.length} offset=${opts.offset} limit=${opts.limit ?? 'all'} userId=${opts.userId ?? 'all'} batchSize=${opts.batchSize} dryRun=${opts.dryRun}`);
  if (!candidates.length) return console.log('No candidates.');
  const byUser = new Map<number, number>();
  for (const c of candidates) byUser.set(c.user_id,(byUser.get(c.user_id)||0)+1);
  console.log('candidates_by_user='+JSON.stringify(Object.fromEntries([...byUser.entries()].sort((a,b)=>a[0]-b[0]))));
  await preflight([...byUser.keys()], opts.dryRun);
  if (opts.dryRun) {
    const rows = await loadArticleRows(candidates.slice(0,10).map(c=>c.id));
    console.log(`dry-run sample_with_text=${rows.filter((r:any)=>buildVectorText(r)).length}`);
    return;
  }
  let processed=0,indexed=0,empty=0,failed=0; const failures: Array<{articleId:number;error:string}>=[]; const start=Date.now();
  for (let i=0;i<candidates.length;i+=opts.batchSize){
    const chunk=candidates.slice(i,i+opts.batchSize);
    const rows=await loadArticleRows(chunk.map(c=>c.id));
    const rowById=new Map<number,any>(rows.map((r:any)=>[Number(r.id),r]));
    const groups=new Map<number,{ids:string[];docs:string[];metas:any[];articleIds:number[]}>();
    for (const c of chunk){ processed++; const row=rowById.get(c.id); if(!row){failed++;failures.push({articleId:c.id,error:'row not found'});continue;}
      const doc=buildVectorText(row); if(!doc){empty++;continue;}
      const g=groups.get(c.user_id)||{ids:[],docs:[],metas:[],articleIds:[]};
      g.ids.push(buildVectorId(c.id,c.user_id)); g.docs.push(doc); g.metas.push({article_id:c.id,user_id:c.user_id}); g.articleIds.push(c.id); groups.set(c.user_id,g);
    }
    for (const [uid,g] of groups.entries()){
      try { const embeddings=await getEmbeddingsBatch(g.docs,uid); await upsert(uid,g.ids,embeddings,g.metas,g.docs); indexed+=g.ids.length; }
      catch (err:any){ failed+=g.articleIds.length; const msg=err?.message||String(err); for(const id of g.articleIds) failures.push({articleId:id,error:msg}); log.warn({uid,count:g.articleIds.length,error:msg},'batch failed'); }
    }
    if (processed % (opts.batchSize*5)===0 || i+opts.batchSize>=candidates.length) console.log(`progress processed=${processed}/${candidates.length} indexed=${indexed} empty=${empty} failed=${failed} elapsed=${((Date.now()-start)/1000).toFixed(1)}s`);
  }
  try { const {collection}=await getCollection(candidates[0].user_id); const count=await (collection as any).count?.(); console.log(`chroma_collection_count_user_${candidates[0].user_id}=${count}`); } catch(e:any){ console.log(`chroma_count_check_failed=${e?.message||e}`); }
  console.log(JSON.stringify({processed,indexed,empty,failed,elapsedMs:Date.now()-start,failures:failures.slice(0,30)},null,2));
  if (failed>0) process.exitCode=2;
}
main().catch((err)=>{ console.error(err?.stack||err?.message||String(err)); process.exit(1); });
