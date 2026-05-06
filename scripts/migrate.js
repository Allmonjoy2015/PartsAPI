'use strict';
require('dotenv').config();
const { initDB, getDB, save } = require('../src/db/database');
const { parsePN } = require('../src/parsers');

async function columnExists(db, table, colName) {
  const r = db.exec(`PRAGMA table_info(${table})`);
  if (!r.length) return false;
  return r[0].values.some(row => row[1] === colName);
}

async function addColumnIfMissing(db, table, colDef, colName) {
  if (await columnExists(db, table, colName)) {
    console.log('  ✓ ' + table + '.' + colName + ' already exists');
    return;
  }
  db.run(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
  console.log('  + added ' + table + '.' + colName);
}

(async () => {
  await initDB();
  const db = getDB();

  console.log('\n📋 Adding columns...');

  // parts: every part has a part_number, parse it
  await addColumnIfMissing(db, 'parts', 'hose_size_16ths INTEGER', 'hose_size_16ths');
  await addColumnIfMissing(db, 'parts', 'style_code TEXT', 'style_code');
  await addColumnIfMissing(db, 'parts', 'end_type TEXT', 'end_type');

  // cross_references: ref_part_number is what gets parsed
  await addColumnIfMissing(db, 'cross_references', 'hose_size_16ths INTEGER', 'hose_size_16ths');
  await addColumnIfMissing(db, 'cross_references', 'style_code TEXT', 'style_code');
  await addColumnIfMissing(db, 'cross_references', 'end_type TEXT', 'end_type');

  // Indexes for filter performance
  console.log('\n🔍 Creating indexes...');
  db.run('CREATE INDEX IF NOT EXISTS idx_parts_size ON parts(hose_size_16ths)');
  db.run('CREATE INDEX IF NOT EXISTS idx_parts_style ON parts(style_code)');
  db.run('CREATE INDEX IF NOT EXISTS idx_parts_endtype ON parts(end_type)');
  db.run('CREATE INDEX IF NOT EXISTS idx_xref_size ON cross_references(hose_size_16ths)');
  db.run('CREATE INDEX IF NOT EXISTS idx_xref_style ON cross_references(style_code)');
  db.run('CREATE INDEX IF NOT EXISTS idx_xref_endtype ON cross_references(end_type)');

  // Backfill parts
  console.log('\n⚙️  Backfilling parts...');
  const parts = db.exec('SELECT id, part_number FROM parts');
  let pUpdated = 0, pSkipped = 0;
  if (parts.length && parts[0].values.length) {
    const stmt = db.prepare('UPDATE parts SET hose_size_16ths=?, style_code=?, end_type=? WHERE id=?');
    for (const [id, pn] of parts[0].values) {
      const parsed = parsePN(pn);
      if (!parsed) { pSkipped++; continue; }
      stmt.run([parsed.hose_size_16ths, parsed.style_code, parsed.end_type, id]);
      pUpdated++;
    }
    stmt.free();
  }
  console.log('  ' + pUpdated + ' updated, ' + pSkipped + ' skipped');

  // Backfill cross_references
  console.log('\n⚙️  Backfilling cross_references...');
  const xrefs = db.exec('SELECT id, ref_part_number FROM cross_references');
  let xUpdated = 0, xSkipped = 0;
  if (xrefs.length && xrefs[0].values.length) {
    const stmt = db.prepare('UPDATE cross_references SET hose_size_16ths=?, style_code=?, end_type=? WHERE id=?');
    for (const [id, ref] of xrefs[0].values) {
      const parsed = parsePN(ref);
      if (!parsed) { xSkipped++; continue; }
      stmt.run([parsed.hose_size_16ths, parsed.style_code, parsed.end_type, id]);
      xUpdated++;
    }
    stmt.free();
  }
  console.log('  ' + xUpdated + ' updated, ' + xSkipped + ' skipped');

  save();

  // Show what got parsed
  console.log('\n📊 Coverage:');
  const stats = [
    ['parts with size',    "SELECT COUNT(*) FROM parts WHERE hose_size_16ths IS NOT NULL"],
    ['parts with style',   "SELECT COUNT(*) FROM parts WHERE style_code IS NOT NULL"],
    ['parts with endtype', "SELECT COUNT(*) FROM parts WHERE end_type IS NOT NULL"],
    ['xrefs with size',    "SELECT COUNT(*) FROM cross_references WHERE hose_size_16ths IS NOT NULL"],
    ['xrefs with style',   "SELECT COUNT(*) FROM cross_references WHERE style_code IS NOT NULL"],
    ['xrefs with endtype', "SELECT COUNT(*) FROM cross_references WHERE end_type IS NOT NULL"]
  ];
  for (const [label, sql] of stats) {
    const r = db.exec(sql);
    console.log('  ' + label.padEnd(22) + r[0].values[0][0]);
  }

  console.log('\n✅ Migration complete\n');
})().catch(e => { console.error(e); process.exit(1); });