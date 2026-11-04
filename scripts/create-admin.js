// Creates (or replaces) the admin login in data/users.json. The password is stored only as a scrypt hash.
// Usage: node scripts/create-admin.js <email> <password> [name]
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const [email, password, name = 'Admin'] = process.argv.slice(2);
if (!email || !password) { console.error('Usage: node scripts/create-admin.js <email> <password> [name]'); process.exit(1); }
if (password.length < 8) { console.error('Use a password of at least 8 characters.'); process.exit(1); }

const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
const file = path.join(__dirname, '..', 'data', 'users.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify([{ id: 'u1', email: email.trim().toLowerCase(), name, role: 'admin', salt, hash }], null, 2));
console.log(`Admin saved for ${email}. Start the app with: npm start`);
