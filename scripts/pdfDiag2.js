'use strict';
const path = require('path');
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
  buckets.sort((a,b) => b.y - a.y);
  return buckets.map(b => {
    const sorted = b.items.sort((a,c) => a.transform[4] - c.transform[4]);
    const cells = [];
    let cur = null, endX = -Infinity, curX = 0;
    for (const item of sorted) {
      const text = item.str.trim();
      if (!text) continue;
      const x = item.transform[4];
      const w = item.width || (item.str.length * 5);
      if (cur === null || x - endX > xGap) {
        if (cur !== null) cells.push({ x: curX, text: cur });
        cur = text; curX = x;
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
  const doc = await pdfjsLib.getDocument({url:process.argv[2],useWorkerFetch:false,isEvalSupported:false}).promise;
  const page = await doc.getPage(2);  // page 2 — past the headers
  const content = await page.getTextContent();
  const rows = itemsToRows(content.items);
  console.log('Page 2 row count:', rows.length);
  console.log('\nFirst 15 rows with X positions:');
  rows.slice(0, 15).forEach((r, i) => {
    const cells = r.map(c => `x=${c.x.toFixed(0)}:"${c.text}"`).join(' | ');
    console.log(`[${i.toString().padStart(2)}] (${r.length} cells) ${cells}`);
  });
})();
