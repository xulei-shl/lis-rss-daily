/**
 * Update password hashes to SHA256 format
 * 
 * Run: npx tsx scripts/fix-passwords.ts
 */

import Database from 'better-sqlite3';
import crypto from 'crypto';

const dbPath = './data/rss-tracker.db';

// SHA256 hashes
const adminHash = crypto.createHash('sha256').update('admin123').digest('hex');
const guestHash = crypto.createHash('sha256').update('cc@7007').digest('hex');

console.log('Connecting to database:', dbPath);
const db = new Database(dbPath);

try {
  console.log('Updating admin password hash to SHA256...');
  console.log('  New hash:', adminHash);
  db.exec(`UPDATE users SET password_hash = '${adminHash}', role = 'admin' WHERE username = 'admin'`);
  
  console.log('Updating guest password hash to SHA256...');
  console.log('  New hash:', guestHash);
  db.exec(`UPDATE users SET password_hash = '${guestHash}', role = 'guest' WHERE username = 'guest'`);
  
  // Verify the updates
  const users = db.prepare('SELECT id, username, password_hash, role FROM users').all() as Array<{id: number, username: string, password_hash: string, role: string}>;
  
  console.log('\nCurrent users in database:');
  users.forEach((u) => {
    console.log(`  - ${u.username} (id: ${u.id}, role: ${u.role})`);
    console.log(`    password_hash: ${u.password_hash.substring(0, 20)}...`);
  });
  
  console.log('\n✅ Password hashes updated to SHA256 format!');
  console.log('You can now login with:');
  console.log('  - admin / admin123');
  console.log('  - guest / cc@7007');
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
} finally {
  db.close();
}
