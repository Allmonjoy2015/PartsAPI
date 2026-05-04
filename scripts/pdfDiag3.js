'use strict';
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = false;

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

(async () => {
  const pdfPath = process.argv[2];
  const doc = await pdfjsLib.getDocument({
    url: pdfPath,
    useWorkerFetch: false,
    isEvalSupported: false
  }).promise;

  console.log('Total pages: ' + doc.numPages);
  console.log('\nScanning pages until finding one with content...\n');

  for (let pageNum = 1; pageNum <= Math.min(doc.numPages, 8); pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    const rows = itemsToRows(content.items);

    console.log('--- Page ' + pageNum + ' (' + content.items.length + ' raw items, ' + rows.length + ' rows) ---');

    if (rows.length === 0) {
      console.log('  (empty)');
      continue;
    }

    // Show up to 12 rows from this page
    rows.slice(0, 12).forEach((r, i) => {
      const cells = r.map(c => 'x=' + c.x.toFixed(0) + ':"' + c.text + '"').join(' | ');
      console.log('  [' + i.toString().padStart(2) + '] (' + r.length + ' cells) ' + cells);
    });

    // If this page has substantive content (>5 rows), stop
    if (rows.length > 5) {
      console.log('\n^ Stopping at first content page.');
      break;
    }
    console.log('');
  }
})().catch(e => { console.error(e); process.exit(1); });
