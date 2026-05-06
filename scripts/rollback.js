'use strict';
const { initDB, getDB, save } = require('../src/db/database');

(async () => {
  await initDB();
  const db = getDB();

  // Show what we have before
  console.log('\n=== BEFORE ===');
  let r = db.exec('SELECT source, COUNT(*) FROM cross_references GROUP BY source');
  r.forEach(t => console.log(JSON.stringify(t.values)));

  // Delete cross-refs from any source other than alphabetical.pdf
  db.run("DELETE FROM cross_references WHERE source != 'alphabetical.pdf'");

  // Delete orphaned parts (those with no cross-refs left)
  db.run('DELETE FROM parts WHERE id NOT IN (SELECT DISTINCT part_id FROM cross_references)');

  save();

  console.log('\n=== AFTER ===');
  r = db.exec('SELECT COUNT(*) AS parts FROM parts');
  console.log('Parts:', r[0].values[0][0]);
  r = db.exec('SELECT COUNT(*) AS xrefs FROM cross_references');
  console.log('Cross-refs:', r[0].values[0][0]);
  console.log('\nTop manufacturers:');
  r = db.exec('SELECT manufacturer, COUNT(*) FROM parts GROUP BY manufacturer ORDER BY 2 DESC LIMIT 10');
  r[0].values.forEach(row => console.log('  ' + row[1].toString().padStart(5) + '  ' + row[0]));
})().catch(e => { console.error(e); process.exit(1); });
