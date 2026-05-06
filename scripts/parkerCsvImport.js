/**
 * parkerCsvImport.js
 * Imports Parker's bulk cross-reference CSV (from MyParker downloads)
 * into the parts database automatically.
 *
 * Parker CSV columns vary by division but typically include:
 *   Competitor Mfr, Competitor PN, Parker PN, Division, Description
 *
 * Usage:
 *   node scripts/parkerCsvImport.js path\to\parker_export.csv
 *   node scripts/parkerCsvImport.js  (with no arg = reads from default path)
 */

require('dotenv').config();
const fs   = require('fs');
const path = require('path');
const { initDB, getDB, save } = require('../src/db/database');
const { v4: uuidv4 } = require('uuid');

// Default download location — Parker saves to Downloads
const DEFAULT_CSV = path.join(
  process.env.USERPROFILE || 'C:\\Users\\allmo',
  'Downloads', 'parker_crossref.csv'
);

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (!lines.length) return { headers: [], rows: [] };

  // Detect delimiter (comma or tab or semicolon)
  const delimiters = [',', '\t', ';'];
  const firstLine = lines[0];
  const delim = delimiters.find(d => firstLine.split(d).length > 3) || ',';

  const parseRow = line => {
    const row = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === delim && !inQ) { row.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    row.push(cur.trim());
    return row;
  };

  const headers = parseRow(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'));
  const rows = lines.slice(1).map(l => {
    const vals = parseRow(l);
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ''; });
    return obj;
  });

  return { headers, rows };
}

// Try multiple possible column name patterns from different Parker export formats
function extractFields(row) {
  const get = (...keys) => {
    for (const k of keys) {
      const val = row[k] || row[k.toLowerCase()] || row[k.replace(/_/g,' ')];
      if (val && val.trim()) return val.trim();
    }
    return '';
  };

  return {
    competitorPN:   get('competitor_part_number','competitor_pn','cross_from_part','part_number','comp_pn','competitor_part'),
    competitorMfr:  get('competitor_manufacturer','competitor_mfr','cross_from','manufacturer','mfr','brand'),
    parkerPN:       get('parker_part_number','parker_pn','cross_to_parker','parker_part','parker'),
    division:       get('division','product_type','type','category'),
    description:    get('description','product_description','parker_description','name')
  };
}

async function importCSV(csvPath) {
  const filePath = csvPath || DEFAULT_CSV;

  if (!fs.existsSync(filePath)) {
    console.error(`\n❌ CSV file not found: ${filePath}`);
    console.error('Download the cross-reference export from MyParker and place it at:');
    console.error(`   ${DEFAULT_CSV}`);
    console.error('Or pass the path as an argument: node scripts/parkerCsvImport.js C:\\path\\to\\file.csv\n');
    process.exit(1);
  }

  console.log(`\n📂 Reading: ${filePath}`);
  const text = fs.readFileSync(filePath, 'utf8');
  const { headers, rows } = parseCSV(text);

  console.log(`📊 Found ${rows.length} rows | Columns: ${headers.join(', ')}`);

  await initDB();
  const db = getDB();

  let inserted = 0, skipped = 0, noPartMatch = 0;

  for (const row of rows) {
    const { competitorPN, competitorMfr, parkerPN, division, description } = extractFields(row);

    if (!competitorPN || !parkerPN) { skipped++; continue; }

    // Find the part in our DB by competitor PN
    const found = db.exec(
      `SELECT id FROM parts WHERE part_number = '${competitorPN.replace(/'/g,"''")}' LIMIT 1`
    );

    let partId;
    if (found.length && found[0].values.length) {
      partId = found[0].values[0][0];
    } else {
      // Part not in our DB yet — create it
      partId = uuidv4();
      db.run(`INSERT OR IGNORE INTO parts VALUES (
        '${partId}',
        '${competitorPN.replace(/'/g,"''")}',
        '${(description || competitorPN).replace(/'/g,"''")}',
        '${(division || '').replace(/'/g,"''")}',
        '${(competitorMfr || '').replace(/'/g,"''")}',
        '', '', 1, datetime('now')
      )`);
      noPartMatch++;
    }

    // Check for duplicate cross-ref
    const dup = db.exec(
      `SELECT id FROM cross_references
       WHERE part_id='${partId}' AND ref_part_number='${parkerPN.replace(/'/g,"''")}' LIMIT 1`
    );
    if (dup.length && dup[0].values.length) { skipped++; continue; }

    // Insert cross-reference
    db.run(`INSERT INTO cross_references VALUES (
      '${uuidv4()}', '${partId}',
      '${parkerPN.replace(/'/g,"''")}',
      'Parker',
      '${(description || division || '').replace(/'/g,"''").slice(0,300)}'
    )`);
    inserted++;

    // Save every 500 rows to avoid memory buildup
    if (inserted % 500 === 0) {
      save();
      console.log(`  ... ${inserted} records saved so far`);
    }
  }

  save();

  console.log('\n========================================');
  console.log(`  ✅ Import complete`);
  console.log(`  Cross-references inserted : ${inserted}`);
  console.log(`  New parts auto-created    : ${noPartMatch}`);
  console.log(`  Duplicates skipped        : ${skipped}`);
  console.log('========================================\n');
}

// Run directly
const arg = process.argv[2];
importCSV(arg).catch(e => { console.error('Import failed:', e.message); process.exit(1); });
