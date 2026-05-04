'use strict';
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
pdfjsLib.GlobalWorkerOptions.workerSrc = false;

(async () => {
  const pdfPath = process.argv[2];
  const doc = await pdfjsLib.getDocument({url:pdfPath,useWorkerFetch:false,isEvalSupported:false}).promise;
  const page = await doc.getPage(1);
  const content = await page.getTextContent();

  console.log('=== ITEM COUNT (page 1) ===');
  console.log(content.items.length, 'items');

  console.log('\n=== FIRST 25 ITEMS (raw) ===');
  content.items.slice(0,25).forEach((it,i) => {
    const x = it.transform ? it.transform[4].toFixed(1) : '?';
    const y = it.transform ? it.transform[5].toFixed(1) : '?';
    console.log(`[${i.toString().padStart(2)}] x=${x.padStart(7)} y=${y.padStart(7)} | "${it.str}"`);
  });

  console.log('\n=== JOINED-WITH-SPACE (first 1500 chars) ===');
  console.log(content.items.map(i=>i.str).join(' ').slice(0,1500));
})();
