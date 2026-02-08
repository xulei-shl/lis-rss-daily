/**
 * 迁移脚本：更新系统提示词变量定义
 * 删除旧的系统提示词，让用户重新初始化
 */

import { getDb } from '../src/db.js';

async function migrate() {
  const db = getDb();

  console.log('开始迁移：清理旧的系统提示词...');

  // 删除所有用户的旧系统提示词
  const result = await db
    .deleteFrom('system_prompts')
    .executeTakeFirst();

  const numDeleted = result.numDeletedRows;
  console.log(`已删除 ${numDeleted} 条旧的系统提示词`);
  console.log('迁移完成！');
  console.log('请点击设置页面的"初始化默认模板"按钮来重新创建提示词。');
}

migrate().catch(err => {
  console.error('迁移失败:', err);
  process.exit(1);
});
