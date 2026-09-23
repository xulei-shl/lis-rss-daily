/**
 * 语义检索 JEV 精排 — 无密钥冒烟验证
 *
 * 使用 stub 的 fetch 与临时数据库，不需要真实 JEV/TYPESAFE 密钥，也不污染项目数据库：
 *   1. buildJevRerankRequest 请求形状（每候选 noul + score，批级 1 个 choice）
 *   2. parseJevRerankAnswers 校验（缺失 / 越界 clamp / 非数字 / choice 弃权）
 *   3. jevRerank 端到端（stub fetch 返回答案 → 正常打分）
 *   4. jevRerank 失败降级（fetch 抛错 → 返回 null，交由调用方回退）
 *
 * 运行：npx tsx scripts/test-search-jev-rerank.ts
 */

import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

// 必须在导入 config（间接读取环境变量）之前设置
process.env.DATABASE_PATH = path.join(os.tmpdir(), `jev-rerank-check-${process.pid}.db`);
process.env.TYPESAFE_API_KEY = 'test-key';
process.env.JEV_MAX_RETRIES = '0';

const { buildJevRerankRequest, parseJevRerankAnswers, jevRerank, RELEVANCE_LEVELS } =
  await import('../src/vector/jev-reranker.js');

const items = [
  { articleId: 1, text: 'a' },
  { articleId: 2, text: 'b' },
];

let passed = 0;
function check(name: string, fn: () => void): void {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

async function main(): Promise<void> {
  console.log('1) buildJevRerankRequest 请求形状');
  check('state 组装 request + 候选', () => {
    const body = buildJevRerankRequest('深度学习', items, 'jev-latest');
    assert.equal(body.model, 'jev-latest');
    assert.equal(body.state.request, '深度学习');
    assert.equal(body.state.results.length, 2);
    assert.equal(body.state.results[1].index, 1);
  });
  check('每候选 noul + score + 批级 choice', () => {
    const body = buildJevRerankRequest('q', items);
    assert.equal(body.questions.r0.type, 'noul');
    assert.equal(body.questions.s0.type, 'score');
    assert.equal(body.questions.r1.type, 'noul');
    assert.equal(body.questions.s1.type, 'score');
    assert.equal(body.questions.has_match.type, 'choice');
    assert.equal(body.questions.s0.criteria.length, RELEVANCE_LEVELS.length);
  });
  check('候选文本按上限截断', () => {
    const body = buildJevRerankRequest('q', [{ articleId: 9, text: 'x'.repeat(5000) }]);
    assert.ok(body.state.results[0].content.length <= 800);
  });

  console.log('2) parseJevRerankAnswers 校验');
  check('正常答案产生综合分 noul × score/4', () => {
    const parsed = parseJevRerankAnswers(
      {
        r0: { type: 'noul', noul: 0.9 },
        s0: { type: 'score', score: 4 },
        r1: { type: 'noul', noul: 0.2 },
        s1: { type: 'score', score: 2 },
        has_match: { type: 'choice', choice: 'yes' },
      },
      items
    );
    assert.deepEqual(parsed.scores, [
      { articleId: 1, value: 0.9, relevanceLevel: 4 },
      { articleId: 2, value: 0.1, relevanceLevel: 2 },
    ]);
    assert.equal(parsed.hasMatch, true);
  });
  check('缺失答案的候选不产分（回退）', () => {
    const parsed = parseJevRerankAnswers({ r0: { type: 'noul', noul: 0.5 } }, items);
    assert.equal(parsed.scores.length, 0);
    assert.equal(parsed.hasMatch, null);
  });
  check('非数字 / 类型不符被拒绝', () => {
    const parsed = parseJevRerankAnswers(
      { r0: { type: 'noul', noul: 'NaN' }, s0: { type: 'score', score: 1 } },
      items
    );
    assert.equal(parsed.scores.length, 0);
  });
  check('越界值被 clamp', () => {
    const parsed = parseJevRerankAnswers(
      { r0: { type: 'noul', noul: 1.5 }, s0: { type: 'score', score: 9 } },
      [{ articleId: 7, text: 't' }]
    );
    assert.deepEqual(parsed.scores, [{ articleId: 7, value: 1, relevanceLevel: 4 }]);
  });
  check('choice=no → hasMatch=false；非法 choice → null', () => {
    assert.equal(
      parseJevRerankAnswers({ has_match: { type: 'choice', choice: 'no' } }, []).hasMatch,
      false
    );
    assert.equal(
      parseJevRerankAnswers({ has_match: { type: 'choice', choice: 'maybe' } }, []).hasMatch,
      null
    );
  });

  console.log('3) jevRerank 端到端（stub fetch）');
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        answers: {
          r0: { type: 'noul', noul: 0.95 },
          s0: { type: 'score', score: 4 },
          r1: { type: 'noul', noul: 0.1 },
          s1: { type: 'score', score: 1 },
          has_match: { type: 'choice', choice: 'yes' },
        },
        usage: { input_tokens: 12, output_tokens: 5 },
      }),
      { status: 200 }
    )) as typeof fetch;

  const outcome = await jevRerank('深度学习', items, 1);
  check('返回打分并累计 usage', () => {
    assert.ok(outcome, '期望有结果');
    assert.equal(outcome.scores.get(1)?.value, 0.95);
    assert.equal(outcome.scores.get(2)?.value, 0.03);
    assert.equal(outcome.hasMatch, true);
    assert.equal(outcome.usage.input_tokens, 12);
  });

  console.log('4) jevRerank 失败降级');
  globalThis.fetch = (async () => {
    throw new Error('network down');
  }) as typeof fetch;
  const failed = await jevRerank('深度学习', items, 1);
  check('请求失败返回 null（调用方回退向量分）', () => {
    assert.equal(failed, null);
  });

  globalThis.fetch = originalFetch;

  console.log(`\n全部通过：${passed} 项`);
}

main().catch((error) => {
  console.error('\n验证失败：', error);
  process.exit(1);
});
