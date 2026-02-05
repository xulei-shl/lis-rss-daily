import { getDb } from '../src/db.js';

const db = getDb();
const result = await db
  .selectFrom('articles')
  .select((eb) => [eb.fn.count('id').as('count')])
  .where('filter_status', '=', 'rejected')
  .where('process_status', '=', 'pending')
  .executeTakeFirst();

console.log('Remaining rejected+pending articles:', Number(result?.count || 0));
process.exit(0);
