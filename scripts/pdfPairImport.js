'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initDB, getDB, save } = require('../src/db/database');
const { v4: uuidv4 } = require('uuid');

// Importer for catalogs where each cell contains BOTH part numbers separated
// by whitespace, e.g.: "06904E-102 R501-4X2"
//
// Layout assumptions:
//   - 1 or 2 columns per page (each column is one self-contained cell)
//   - First token = competitor PN, remaining tokens = equivalent PN
//   - Manufacturer is inferred from the filename
//
// Used for: Weatherhead_to_CSI.pdf

const HEADER_PATTERNS = [
  /cross reference/i,
  /^page\b/i,
  /^\d{1,3}$/,
  /coupling/i,
  /^series\b/i,
  /^competitor/i,
  /discounthydraulic/i,
  /www\./i
];

function isHeader(s) {
  const t = (s || '').trim();
  if (!t) return true;
  // Single short word like "STEEL" or "Notes"
  if (t.length < 4) return true;
  return HEADER_PATTERNS.some(r => r.test(t));
}

function looksLikePN(s) {
  const t = (s || '').trim();
  if (t.length < 3 || t.length > 40) return false;
  if (!/^[A-Z0-9]/i.test(t)) return false;
  if (!/[A-Z0-9]/i.test(t.slice(1))) return false;
  if (/\s/.test(t)) return false;
  return true;
}

// Group items by Y, sort by X, merge close items into cells.
function itemsToRows(items, yTolerance = 1.5, xGap = 15) {
  const valid = items.filter(it => it.transform && it.str !== undefined);
  const buckets = [];
  for (const it of valid) {
    const y = it.transform[5];
    let bucket = buckets.find(b => Math.abs(b.y - y) < yTolerance);
    if (!bucket) { bucket = { y, items: [] }; buckets.push(bucket); }
    bucket.items.push(it);
  }
  buckets.sort((a, b) => b.y - a.y);

  return buckets.map(b => {
    const sorted = b.items.sort((a, c) => a.transform[4] - c.transform[4]);
    const cells = [];
    let cur = null, endX = -Infinity, curX = 0;
    for (const item of sorted) {
      const text = item.str.trim();
      if (!text) continue;
      const x = item.transform[4];
      const w = item.width || (item.str.length * 5);
      if (cur === null || x - endX > xGap) {
        if (cur !== null) cells.push({ x: curX, text: cur });
        cur = text;
        curX = x;
      } else {
        cur += ' ' + text;
      }
      endX = x + w;
    }
    if (cur !== null) cells.push({ x: curX, text: cur });
    return cells;
  });
}

// A cell looks like "06904E-102 R501-4X2" — one PN, whitespace, one PN.
// Returns {competitorPN, equivalentPN} or null.
function cellToPair(text) {
  if (isHeader(text)) return null;
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  if (tokens.length !== 2) return null;
  const [a, b] = tokens;
  if (!looksLikePN(a) || !looksLikePN(b)) return null;
  return { competitorPN: a, equivalentPN: b };
}

async function extractRows(pdfPath) {
  const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
  pdfjsLib.GlobalWorkerOptions.workerSrc = false;
  const doc = await pdfjsLib.getDocument({
    url: pdfPath,
    useWorkerFetch: false,
    isEvalSupported: false
  }).promise;
  const allRows = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    allRows.push(...itemsToRows(content.items));
  }
  return { rows: allRows, numPages: doc.numPages };
}

function inferMfrFromFilename(p) {
  const b = path.basename(p).toLowerCase();
  if (b.includes('weatherhead')) return 'Weatherhead';
  if (b.includes('tompkins')) return 'Tompkins';
  if (b.includes('parker')) return 'Parker';
  if (b.includes('eaton')) return 'Eaton';
  if (b.includes('gates')) return 'Gates';
  return 'Unknown';
}

async function importPDF(pdfPath) {
  if (!pdfPath || !fs.existsSync(pdfPath)) {
    console.error('File not found: ' + pdfPath);
    process.exit(1);
  }
  console.log('\n📄 Reading: ' + pdfPath);
  const defaultMfr = inferMfrFromFilename(pdfPath);

  const { rows, numPages } = await extractRows(pdfPath);
  console.log('Pages: ' + numPages + ' | Rows: ' + rows.length + ' | Manufacturer: ' + defaultMfr);

  const entries = [];
  const seen = new Set();
  let cellsScanned = 0;
  let cellsParsed = 0;
  let cellsRejected = 0;

  for (const row of rows) {
    for (const cell of row) {
      cellsScanned++;
      const pair = cellToPair(cell.text);
      if (!pair) { cellsRejected++; continue; }
      cellsParsed++;
      const k = pair.competitorPN + '|' + pair.equivalentPN;
      if (seen.has(k)) continue;
      seen.add(k);
      entries.push({ ...pair, manufacturer: defaultMfr });
    }
  }

  console.log('Cells scanned: ' + cellsScanned + ' | Parsed: ' + cellsParsed + ' | Rejected: ' + cellsRejected);
  console.log('Unique entries: ' + entries.length);
  if (!entries.length) {
    console.error('\nFirst 10 rows for inspection:');
    rows.slice(0, 10).forEach((r, i) => console.error('  [' + i + '] ' + JSON.stringify(r.map(c => c.text))));
    process.exit(1);
  }
  console.log('\nPreview:');
  entries.slice(0, 8).forEach(e => console.log('  [' + e.manufacturer + '] ' + e.competitorPN + ' -> ' + e.equivalentPN));

  await initDB();
  const db = getDB();
  let pc = 0, cr = 0, du = 0;
  for (const { competitorPN: cPN, manufacturer: mfr, equivalentPN: ePN } of entries) {
    let pid;
    const f = db.exec("SELECT id FROM parts WHERE part_number=? LIMIT 1", [cPN]);
    if (f.length && f[0].values.length) {
      pid = f[0].values[0][0];
    } else {
      pid = uuidv4();
      db.run(
        "INSERT INTO parts (id,part_number,name,category,manufacturer,description,notes,active,created_at) VALUES (?,?,?,?,?,?,?,?,datetime('now'))",
        [pid, cPN, cPN, 'hydraulic', mfr, 'Imported from PDF', '', 1]
      );
      pc++;
    }
    const d = db.exec("SELECT id FROM cross_references WHERE part_id=? AND ref_part_number=? LIMIT 1", [pid, ePN]);
    if (d.length && d[0].values.length) { du++; continue; }
    db.run(
      "INSERT INTO cross_references (id,part_id,ref_part_number,manufacturer,source) VALUES (?,?,?,?,?)",
      [uuidv4(), pid, ePN, mfr, path.basename(pdfPath)]
    );
    cr++;
    if ((cr + du) % 200 === 0) save();
  }
  save();
  console.log('\n✅ Done');
  console.log('  Parts created    : ' + pc);
  console.log('  Cross-refs added : ' + cr);
  console.log('  Dupes skipped    : ' + du + '\n');
}

importPDF(process.argv[2]).catch(e => {
  console.error('Failed:', e.message);
  console.error(e.stack);
  process.exit(1);
});