require('dotenv').config();
const { launchBrowser, lookupParts, log } = require('../src/services/parkerScraper');

// Confirmed working: Ham-Let fittings that Parker cross-references
const TEST_PARTS = [
  '772HLF 3/8 X 1/4',
  '739HLF 3/8 X 1/2'
];

(async () => {
  log('=== LIVE PARKER LOOKUP TEST ===');
  log(`Testing: ${TEST_PARTS.join(', ')}`);

  const browser = await launchBrowser();
  try {
    const results = await lookupParts(browser, TEST_PARTS);

    console.log('\n--- RESULTS ---');
    results.forEach(r => {
      if (r.parkerPartNumber) {
        console.log(`✅ ${r.input}`);
        console.log(`   → Parker PN:  ${r.parkerPartNumber}`);
        console.log(`   → Division:   ${r.description}`);
        console.log(`   → Competitor: ${r.division}`);
      } else {
        console.log(`❌ ${r.input} → No match found`);
      }
    });

    const matched = results.filter(r => r.parkerPartNumber).length;
    console.log(`\n${matched}/${TEST_PARTS.length} matched`);
  } finally {
    await browser.close();
  }
  process.exit(0);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
