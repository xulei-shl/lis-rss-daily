/**
 * Generate bcrypt hash for password
 *
 * Usage: pnpm run gen-password [password]
 * Example: pnpm run gen-password admin123
 */

import bcrypt from 'bcryptjs';
import { config } from '../src/config.js';

const password = process.argv[2] || 'admin123';
const hash = bcrypt.hashSync(password, 10);

console.log('\n=================================');
console.log('  Password Hash Generator');
console.log('=================================\n');
console.log(`Password: ${password}`);
console.log(`Hash: ${hash}\n`);
