/**
 * remap 集成测试：临时 SQLite 中建 v1/v2，写 remap，
 * 断言旧 slug 经 resolveTopic 返回新版本主题。
 *
 * 不触碰 data/ 下的真实数据库。
 */

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const dbPath = path.join(tmpdir(), `cluster-remap-test-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = dbPath;

let closeDb: (() => Promise<void>) | null = null;

async function main(): Promise<void> {
  const fs = await import('node:fs');
  const sql = fs.readFileSync(path.join(process.cwd(), 'sql/045_add_topic_cluster.sql'), 'utf8');
  const mergeSql = fs.readFileSync(
    path.join(process.cwd(), 'sql/049_topic_merge_remap.sql'),
    'utf8'
  );
  const bootstrap = new Database(dbPath);
  bootstrap.exec(sql);
  bootstrap.exec(mergeSql);
  bootstrap.exec('CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY); INSERT INTO users (id) VALUES (1);');
  bootstrap.close();

  const { closeDb: close, getDb } = await import('../src/db.js');
  closeDb = close;
  const { createSet, archiveSet } = await import('../src/topic-cluster/repo/sets.js');
  const { insertTopic } = await import('../src/topic-cluster/repo/topics.js');
  const {
    writeRemapForVersions,
    getRemappedTopicId,
    findTopicIdBySlugAnyVersion,
  } = await import('../src/topic-cluster/repo/remap.js');
  const { resolveTopic } = await import('../src/topic-cluster/query.js');
  const { vectorToBlob } = await import('../src/topic-cluster/domain/vector.js');

  await createSet({
    version: 1,
    triggerReason: 'init',
    embeddingModel: 'test',
    embeddingDim: 4,
    facetContractVersion: 'v2',
    initThreshold: 0.65,
  });
  await archiveSet(1);
  await createSet({
    version: 2,
    triggerReason: 'manual_rebuild',
    embeddingModel: 'test',
    embeddingDim: 4,
    facetContractVersion: 'v2',
    initThreshold: 0.65,
  });

  const oldId = await insertTopic({
    userId: 1,
    setVersion: 1,
    slug: 'v1-t-001-old',
    name: '旧主题',
    keywords: ['旧'],
    centroid: vectorToBlob([1, 0, 0, 0]),
    centroidDim: 4,
    firstEventDate: '2024-01-01',
    lastEventDate: '2025-01-01',
  });
  const newId = await insertTopic({
    userId: 1,
    setVersion: 2,
    slug: 'v2-t-001-new',
    name: '新主题',
    keywords: ['新'],
    centroid: vectorToBlob([0.99, 0.1, 0, 0]),
    centroidDim: 4,
    firstEventDate: '2024-01-01',
    lastEventDate: '2025-06-01',
  });

  const written = await writeRemapForVersions(1, 2);
  assert.equal(written, 1);
  assert.equal(await getRemappedTopicId(oldId), newId);
  assert.equal(await findTopicIdBySlugAnyVersion('v1-t-001-old'), oldId);

  const resolved = await resolveTopic('v1-t-001-old');
  assert.equal(resolved?.id, newId);
  assert.equal(resolved?.slug, 'v2-t-001-new');

  // 再次写入应幂等（先删后插），不会撞主键
  assert.equal(await writeRemapForVersions(1, 2), 1);
  const count = await getDb()
    .selectFrom('cluster_topic_remap')
    .select((eb) => eb.fn.count('old_topic_id').as('count'))
    .executeTakeFirst();
  assert.equal(Number(count?.count ?? 0), 1);

  console.log('remap 集成测试通过：旧 slug 解析到新主题，重复写入幂等');
}

main()
  .catch((error) => {
    console.error('❌ remap 测试失败：', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (closeDb) await closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      rmSync(`${dbPath}${suffix}`, { force: true });
    }
  });
