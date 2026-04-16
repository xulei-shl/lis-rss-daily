/**
 * 手动触发洞察报告生成
 *
 * 用法:
 *   pnpm run trigger-insights              # 使用默认配置（10天，用户ID=1）
 *   pnpm run trigger-insights 30           # 自定义天数
 *   pnpm run trigger-insights 15 1         # 自定义天数和用户ID
 *
 * 或者使用 tsx:
 *   npx tsx scripts/trigger-insights.ts
 *   npx tsx scripts/trigger-insights.ts 30 1
 */

import 'dotenv/config';
import { generateInsightsSummary } from '../src/api/daily-summary.js';

// 解析命令行参数
const args = process.argv.slice(2);
const days = args[0] ? parseInt(args[0], 10) : parseInt(process.env.INSIGHTS_DAYS || '10', 10);
const userId = args[1] ? parseInt(args[1], 10) : 1;

if (isNaN(days) || days <= 0) {
  console.error('❌ 天数必须是正整数');
  process.exit(1);
}

if (isNaN(userId) || userId <= 0) {
  console.error('❌ 用户ID必须是正整数');
  process.exit(1);
}

console.log('🚀 开始生成洞察报告');
console.log(`   用户ID: ${userId}`);
console.log(`   时间范围: 最近 ${days} 天`);
console.log('---');

async function main() {
  try {
    const result = await generateInsightsSummary({
      userId,
      days,
    });

    console.log('---');
    console.log('✅ 洞察报告生成成功！');
    console.log(`   日期范围: ${result.date}`);
    console.log(`   文章数量: ${result.totalArticles}`);
    console.log(`   类型: ${result.type}`);
    console.log(`   生成时间: ${result.generatedAt}`);
    console.log('');
    console.log('=== 报告内容预览 ===');
    console.log(result.summary.substring(0, 500) + (result.summary.length > 500 ? '...' : ''));

  } catch (error) {
    console.error('❌ 生成洞察报告失败:', error);
    process.exit(1);
  }
}

main();
