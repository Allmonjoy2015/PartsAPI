'use strict';
require('dotenv').config();
const { initDB, getDB } = require('../src/db/database');

const query = (process.argv[2] || '').trim();
if (!query) {
  console.log('Usage: node scripts/lookup.js <part-number>');
  console.log('       node scripts/lookup.js <partial>      (prefix search)');
  process.exit(1);
}

(async () => {
  await initDB();
  const db = getDB();

  console.log('\n🔍 Searching for: ' + query);
  console.log('─'.repeat(60));

  // 1. Exact match: part_number = query  → show all its equivalents
  const directHits = db.exec(
    "SELECT id, part_number, manufacturer FROM parts WHERE part_number = ? COLLATE NOCASE",
    [query]
  );

  if (directHits.length && directHits[0].values.length) {
    for (const [id, pn, mfr] of directHits[0].values) {
      console.log('\n📦 ' + pn + '  [' + mfr + ']');
      const xrefs = db.exec(
        "SELECT ref_part_number, manufacturer, source FROM cross_references WHERE part_id = ? ORDER BY ref_part_number",
        [id]
      );
      if (xrefs.length && xrefs[0].values.length) {
        console.log('   Equivalents:');
        for (const [ref, refMfr, src] of xrefs[0].values) {
          console.log('     → ' + ref.padEnd(20) + '  (' + refMfr + ', ' + src + ')');
        }
      } else {
        console.log('   (no cross-references)');
      }
    }
  }

  // 2. Reverse match: ref_part_number = query  → find what maps TO this PN
  const reverseHits = db.exec(
    `SELECT p.part_number, p.manufacturer, x.manufacturer, x.source
     FROM cross_references x
     JOIN parts p ON p.id = x.part_id
     WHERE x.ref_part_number = ? COLLATE NOCASE
     ORDER BY p.part_number`,
    [query]
  );

  if (reverseHits.length && reverseHits[0].values.length) {
    console.log('\n🔄 Reverse matches (parts that cross-reference TO ' + query + '):');
    for (const [pn, mfr, refMfr, src] of reverseHits[0].values) {
      console.log('   ← ' + pn.padEnd(20) + '  [' + mfr + ']  (' + src + ')');
    }
  }

  // 3. If nothing found, try prefix search
  const directCount = (directHits[0]?.values?.length) || 0;
  const reverseCount = (reverseHits[0]?.values?.length) || 0;

  if (directCount === 0 && reverseCount === 0) {
    console.log('\nNo exact matches. Trying prefix search...\n');
    const prefix = db.exec(
      `SELECT part_number, manufacturer FROM parts
       WHERE part_number LIKE ? COLLATE NOCASE
       ORDER BY part_number LIMIT 20`,
      [query + '%']
    );
    if (prefix.length && prefix[0].values.length) {
      console.log('📋 Parts starting with "' + query + '":');
      for (const [pn, mfr] of prefix[0].values) {
        console.log('   ' + pn.padEnd(20) + '  [' + mfr + ']');
      }
      const more = db.exec(
        "SELECT COUNT(*) FROM parts WHERE part_number LIKE ? COLLATE NOCASE",
        [query + '%']
      );
      const total = more[0].values[0][0];
      if (total > 20) console.log('   ... and ' + (total - 20) + ' more');
    } else {
      // Try ref_part_number prefix too
      const refPrefix = db.exec(
        `SELECT DISTINCT ref_part_number, manufacturer FROM cross_references
         WHERE ref_part_number LIKE ? COLLATE NOCASE
         ORDER BY ref_part_number LIMIT 20`,
        [query + '%']
      );
      if (refPrefix.length && refPrefix[0].values.length) {
        console.log('📋 Cross-ref part numbers starting with "' + query + '":');
        for (const [pn, mfr] of refPrefix[0].values) {
          console.log('   ' + pn.padEnd(20) + '  [' + mfr + ']');
        }
      } else {
        console.log('   No matches found.');
      }
    }
  }

  console.log('');
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });