/**
 * Fix process_status for rejected articles
 *
 * This script updates all articles that have filter_status='rejected'
 * but process_status='pending' to set process_status='completed'.
 */

import { getDb } from '../src/db.js';

async function fixRejectedArticles() {
  const db = getDb();

  // First, check how many articles need to be fixed
  const checkResult = await db
    .selectFrom('articles')
    .select((eb) => [eb.fn.count('id').as('count')])
    .where('filter_status', '=', 'rejected')
    .where('process_status', '=', 'pending')
    .executeTakeFirst();

  const count = Number(checkResult?.count || 0);
  console.log(`Found ${count} rejected articles with pending status`);

  if (count === 0) {
    console.log('No articles need to be fixed.');
    return;
  }

  // Update the articles
  const result = await db
    .updateTable('articles')
    .set({
      process_status: 'completed',
      updated_at: new Date().toISOString()
    })
    .where('filter_status', '=', 'rejected')
    .where('process_status', '=', 'pending')
    .execute();

  console.log(`Updated ${result.numUpdatedRows} articles to completed`);
}

fixRejectedArticles()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
