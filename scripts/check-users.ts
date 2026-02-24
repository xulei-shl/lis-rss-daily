import database from 'better-sqlite3';
const db = new database('./data/rss-tracker.db');
const users = db.prepare('SELECT username, role FROM users').all();
console.table(users);
db.close();
