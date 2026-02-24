/**
 * Backfill title_normalized and remove duplicates
 *
 * 运行此脚本：
 *   pnpm run db:backfill-title-normalized
 *
 * 操作步骤：
 * 1. 删除已存在的重复数据（title_normalized 不为 NULL 的）
 * 2. 为所有 title_normalized IS NULL 的记录回填标准化标题
 * 3. 再次检查并删除回填后产生的重复数据
 * 4. 级联删除关联表数据：article_related, article_filter_logs, article_process_logs
 */

import Database from 'better-sqlite3';
import { config } from '../src/config.js';

/**
 * Normalize title for deduplication (与 src/utils/title.ts 保持一致的逻辑)
 */
function normalizeTitle(title: string): string | null {
  if (!title || typeof title !== 'string') {
    return null;
  }

  const trimmed = title.trim();
  if (trimmed.length === 0) {
    return null;
  }

  // 1. Convert to lowercase
  let normalized = trimmed.toLowerCase();

  // 2. Remove punctuation and special characters
  // Keep: word characters, whitespace, Chinese characters
  // \u4e00-\u9fff: Common Chinese characters
  // \u3400-\u4dbf: Chinese extension A
  normalized = normalized.replace(/[^\w\s\u4e00-\u9fff\u3400-\u4dbf]/g, ' ');

  // 3. Collapse multiple whitespace to single space
  normalized = normalized.replace(/\s+/g, ' ');

  // 4. Trim leading/trailing spaces
  normalized = normalized.trim();

  // 5. Return null if empty after normalization
  if (normalized.length === 0) {
    return null;
  }

  return normalized;
}

/**
 * Generate normalized title for storage
 */
function generateNormalizedTitle(title: string): string | null {
  const normalized = normalizeTitle(title);

  // Limit length to prevent index issues
  if (normalized && normalized.length > 500) {
    return normalized.substring(0, 500);
  }

  return normalized;
}

/**
 * 删除重复数据
 */
function deleteDuplicates(db: Database.Database, duplicates: Array<{ title_normalized: string; count: number; keep_id: number; all_ids: string }>): number {
  if (duplicates.length === 0) return 0;

  const idsToDelete: number[] = [];
  for (const dup of duplicates) {
    const allIds = dup.all_ids.split(',').map(Number);
    const keepId = dup.keep_id;
    const deleteIds = allIds.filter(id => id !== keepId);
    idsToDelete.push(...deleteIds);
  }

  if (idsToDelete.length === 0) return 0;

  // 级联删除关联表数据
  db.prepare(`
    DELETE FROM article_related
    WHERE article_id IN (${idsToDelete.map(() => '?').join(',')})
    OR related_article_id IN (${idsToDelete.map(() => '?').join(',')})
  `).run(...idsToDelete, ...idsToDelete);

  db.prepare(`
    DELETE FROM article_filter_logs
    WHERE article_id IN (${idsToDelete.map(() => '?').join(',')})
  `).run(...idsToDelete);

  db.prepare(`
    DELETE FROM article_process_logs
    WHERE article_id IN (${idsToDelete.map(() => '?').join(',')})
  `).run(...idsToDelete);

  db.prepare(`
    DELETE FROM article_translations
    WHERE article_id IN (${idsToDelete.map(() => '?').join(',')})
  `).run(...idsToDelete);

  db.prepare(`
    DELETE FROM articles
    WHERE id IN (${idsToDelete.map(() => '?').join(',')})
  `).run(...idsToDelete);

  return idsToDelete.length;
}

/**
 * 主函数
 */
async function main() {
  console.log('=== 回填 title_normalized 并删除重复数据 ===\n');

  // 备份数据库
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const backupPath = config.databasePath.replace('.db', `.backup-${timestamp}.db`);
  const fs = await import('fs');
  fs.copyFileSync(config.databasePath, backupPath);
  console.log(`✅ 数据库已备份到: ${backupPath}\n`);

  const db = new Database(config.databasePath);

  try {
    // ============================================================
    // 步骤 1: 删除已存在的重复数据
    // ============================================================
    console.log('步骤 1: 检查已存在的重复数据...');

    const existingDuplicates = db.prepare(`
      SELECT title_normalized, COUNT(*) as count, MIN(id) as keep_id, GROUP_CONCAT(id) as all_ids
      FROM articles
      WHERE title_normalized IS NOT NULL
      GROUP BY title_normalized
      HAVING COUNT(*) > 1
    `).all() as Array<{ title_normalized: string; count: number; keep_id: number; all_ids: string }>;

    let deletedCount = 0;
    if (existingDuplicates.length > 0) {
      console.log(`   发现 ${existingDuplicates.length} 组已存在的重复数据`);
      deletedCount = deleteDuplicates(db, existingDuplicates);
      console.log(`   ✅ 已删除 ${deletedCount} 条重复记录\n`);
    } else {
      console.log('   ✅ 未发现已存在的重复数据\n');
    }

    // ============================================================
    // 步骤 2: 回填 title_normalized
    // ============================================================
    console.log('步骤 2: 回填 title_normalized...');

    const nullCount = db.prepare(
      'SELECT COUNT(*) as count FROM articles WHERE title_normalized IS NULL'
    ).get() as { count: number };

    console.log(`   发现 ${nullCount.count} 条 title_normalized 为 NULL 的记录`);

    if (nullCount.count > 0) {
      const rows = db.prepare(
        'SELECT id, title FROM articles WHERE title_normalized IS NULL'
      ).all() as Array<{ id: number; title: string }>;

      // 获取已存在的 title_normalized，避免冲突
      const titleMap = new Map<string, number>();
      const existingNormalized = db.prepare(
        'SELECT id, title_normalized FROM articles WHERE title_normalized IS NOT NULL'
      ).all() as Array<{ id: number; title_normalized: string }>;

      for (const row of existingNormalized) {
        titleMap.set(row.title_normalized, row.id);
      }

      const updateStmt = db.prepare(
        'UPDATE articles SET title_normalized = ? WHERE id = ?'
      );

      let updatedCount = 0;
      const skippedIds: number[] = [];

      for (const row of rows) {
        const normalized = generateNormalizedTitle(row.title);

        if (normalized && titleMap.has(normalized)) {
          // 这个 normalized title 已存在，记录为需要删除的重复数据
          skippedIds.push(row.id);
          continue;
        }

        updateStmt.run(normalized, row.id);
        updatedCount++;

        if (normalized) {
          titleMap.set(normalized, row.id);
        }
      }

      console.log(`   ✅ 已更新 ${updatedCount} 条记录，发现 ${skippedIds.length} 条重复记录需要删除\n`);

      // 删除跳过的重复记录
      if (skippedIds.length > 0) {
        console.log('   正在删除重复记录...');

        db.prepare(`
          DELETE FROM article_related
          WHERE article_id IN (${skippedIds.map(() => '?').join(',')})
          OR related_article_id IN (${skippedIds.map(() => '?').join(',')})
        `).run(...skippedIds, ...skippedIds);

        db.prepare(`
          DELETE FROM article_filter_logs
          WHERE article_id IN (${skippedIds.map(() => '?').join(',')})
        `).run(...skippedIds);

        db.prepare(`
          DELETE FROM article_process_logs
          WHERE article_id IN (${skippedIds.map(() => '?').join(',')})
        `).run(...skippedIds);

        db.prepare(`
          DELETE FROM article_translations
          WHERE article_id IN (${skippedIds.map(() => '?').join(',')})
        `).run(...skippedIds);

        db.prepare(`
          DELETE FROM articles
          WHERE id IN (${skippedIds.map(() => '?').join(',')})
        `).run(...skippedIds);

        deletedCount += skippedIds.length;
        console.log(`   ✅ 已删除 ${skippedIds.length} 条重复记录\n`);
      }
    } else {
      console.log('   ⏭️  没有需要更新的记录\n');
    }

    // ============================================================
    // 步骤 3: 检查并删除回填后产生的重复数据
    // ============================================================
    console.log('步骤 3: 检查回填后产生的重复数据...');

    const newDuplicates = db.prepare(`
      SELECT title_normalized, COUNT(*) as count, MIN(id) as keep_id, GROUP_CONCAT(id) as all_ids
      FROM articles
      WHERE title_normalized IS NOT NULL
      GROUP BY title_normalized
      HAVING COUNT(*) > 1
    `).all() as Array<{ title_normalized: string; count: number; keep_id: number; all_ids: string }>;

    if (newDuplicates.length > 0) {
      console.log(`   发现 ${newDuplicates.length} 组新的重复数据`);
      deletedCount += deleteDuplicates(db, newDuplicates);
      console.log(`   ✅ 已删除 ${newDuplicates.reduce((sum, d) => sum + d.count - 1, 0)} 条重复记录\n`);
    } else {
      console.log('   ✅ 未发现新的重复数据\n');
    }

    // ============================================================
    // 验证结果
    // ============================================================
    console.log('=== 验证结果 ===');

    const remainingNulls = db.prepare(
      'SELECT COUNT(*) as count FROM articles WHERE title_normalized IS NULL'
    ).get() as { count: number };

    const remainingDuplicates = db.prepare(`
      SELECT COUNT(*) as count FROM (
        SELECT title_normalized, COUNT(*) as cnt
        FROM articles
        WHERE title_normalized IS NOT NULL
        GROUP BY title_normalized
        HAVING cnt > 1
      )
    `).get() as { count: number };

    const totalArticles = db.prepare('SELECT COUNT(*) as count FROM articles').get() as { count: number };

    console.log(`   文章总数: ${totalArticles.count}`);
    console.log(`   title_normalized 为 NULL 的记录: ${remainingNulls.count}`);
    console.log(`   重复的 title_normalized 记录: ${remainingDuplicates.count}`);
    console.log(`   共删除 ${deletedCount} 条重复记录`);

    if (remainingNulls.count === 0 && remainingDuplicates.count === 0) {
      console.log('\n✅ 迁移成功完成！');
    } else {
      console.log('\n⚠️  迁移完成，但仍有问题需要处理');
    }

  } catch (error) {
    console.error('\n❌ 迁移失败:', error);
    console.error(`💾 备份可用: ${backupPath}`);
    process.exit(1);
  } finally {
    db.close();
  }
}

main().catch(console.error);
