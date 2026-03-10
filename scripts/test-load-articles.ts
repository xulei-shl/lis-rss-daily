import { loadArticles } from '../src/vector/indexer.js';
import { logger } from '../src/logger.js';

const log = logger.child({ module: 'test-load' });

async function main() {
  console.log('测试 loadArticles 函数...');
  
  try {
    const result = await loadArticles([1800], 1);
    console.log('成功！返回:', result.length, '篇文章');
    console.log('第一篇:', result[0]);
  } catch (error) {
    console.log('错误类型:', error.constructor.name);
    console.log('错误消息:', (error as any).message);
    console.log('错误代码:', (error as any).code);
    console.log('完整错误:', error);
  }
}

main().catch(console.error);
