import { getDb } from '../src/db.js';
import { indexArticles } from '../src/vector/indexer.js';

async function main() {
  console.log('开始测试文章 1800 的向量化...');
  
  indexArticles([1800], undefined, (result) => {
    console.log('回调:', result);
  });
  
  // 等待一段时间
  await new Promise(resolve => setTimeout(resolve, 10000));
  console.log('测试完成');
}

main().catch(console.error);
