'use strict';
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { initDB, getDB, save } = require('../src/db/database');
const { v4: uuidv4 } = require('uuid');

const HEADER_TEXTS = [
  /^competitor/i, /^item number/i, /^name$/i,
  /discounthydraulic/i, /alphabetical/i,
  /^page\b/i, /^\d{1,3}$/,
  /^save \d/i, /^buy online/i, /when you/i,
  /customer service/i, /^www\./i,
  /tompkins.*hydraulic/i, /weatherhead.*csi/i
];

function isHeader(s) {
  const t = (s || '').trim();
  if (!t) return true;
  return HEADER_TEXTS.some(r => r.test(t));
}

// Group items by Y, sort by X, merge close items into cells.
// Returns rows of { x, text } cells.
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

function looksLikePN(s) {
  const t = (s || '').trim();
  if (t.length < 3 || t.length > 40) return false;
  if (!/^[A-Z0-9]/i.test(t)) return false;
  if (!/[A-Z0-9]/i.test(t.slice(1))) return false;
  if (/^(competitor|item|number|name|page|save|buy|online)$/i.test(t)) return false;
  if (/\s/.test(t)) return false;
  return true;
}

function cellsToEntry(cells, defaultMfr) {
  const cleaned = cells.map(c => c.text).filter(t => !isHeader(t));
  if (cleaned.length === 3) {
    const [a, b, c] = cleaned;
    if (looksLikePN(a) && looksLikePN(c)) {
      return { competitorPN: a, manufacturer: b || defaultMfr, equivalentPN: c };
    }
  }
  if (cleaned.length === 2) {
    const [a, b] = cleaned;
    if (looksLikePN(a) && looksLikePN(b)) {
      return { competitorPN: a, manufacturer: defaultMfr, equivalentPN: b };
    }
  }
  return null;
}

function splitRowByMidpoint(cells, midpoint = 260) {
  const left = cells.filter(c => c.x < midpoint);
  const right = cells.filter(c => c.x >= midpoint);
  return [left, right].filter(half => half.length > 0);
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
  if (b.includes('tompkins')) return 'Tompkins';
  if (b.includes('weatherhead')) return 'Weatherhead';
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
  console.log('Pages: ' + numPages + ' | Rows: ' + rows.length + ' | Default mfr: ' + defaultMfr);

  const entries = [];
  const seen = new Set();
  const stats = { halves: 0, parsed: 0, rejected: 0 };

  for (const row of rows) {
    const halves = (row.length > 3) ? splitRowByMidpoint(row) : [row];
    stats.halves += halves.length;
    for (const half of halves) {
      const e = cellsToEntry(half, defaultMfr);
      if (!e) { stats.rejected++; continue; }
      stats.parsed++;
      const k = e.competitorPN + '|' + e.equivalentPN;
      if (seen.has(k)) continue;
      seen.add(k);
      entries.push(e);
    }
  }

  console.log('Half-rows tried: ' + stats.halves + ' | Parsed: ' + stats.parsed + ' | Rejected: ' + stats.rejected);
  console.log('Unique entries : ' + entries.length);
  if (!entries.length) {
    console.error('\nFirst 15 rows for inspection:');
    rows.slice(0, 15).forEach((r, i) => console.error('  [' + i + '] ' + JSON.stringify(r.map(c => c.text))));
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
