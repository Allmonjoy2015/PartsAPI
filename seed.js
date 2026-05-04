const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { initDB, save } = require('./src/db/database');

async function seed() {
  await initDB();
  const { getDB } = require('./src/db/database');
  const db = getDB();

  const adminId = uuidv4();
  const credId = uuidv4();
  const hash = bcrypt.hashSync('admin1234', 10);

  // Check if admin already exists
  const existing = db.exec(`SELECT id FROM users WHERE email = 'admin@partsapi.local'`);
  if (existing.length && existing[0].values.length) {
    console.log('Admin user already exists, skipping seed.');
    process.exit(0);
  }

  db.run(`INSERT INTO users VALUES (
    '${adminId}','Admin User','admin@partsapi.local',
    'admin','admin',1,datetime('now'))`);

  db.run(`INSERT INTO credentials VALUES (
    '${credId}','${adminId}','password','${hash}',datetime('now'))`);

  save();

  console.log('\n✅ Admin user created!');
  console.log('   Email:    admin@partsapi.local');
  console.log('   Password: admin1234');
  console.log('   Role:     admin');
  console.log('\n⚠️  Change the password after first login!\n');
  process.exit(0);
}

seed().catch(console.error);
