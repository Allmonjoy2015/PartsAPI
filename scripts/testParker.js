require('dotenv').config();
const puppeteer = require('puppeteer-core');

// From our earlier successful run we saw Ham-Let fittings cross-ref perfectly
const TEST_PARTS = ['772HLF 3/8 X 1/4', '739HLF 3/8 X 1/2'];

(async () => {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: 'new',
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36');
  await page.goto('https://crossref.parker.com/us/en/cross-reference', {
    waitUntil: 'networkidle2', timeout: 30000
  });

  await page.waitForSelector('#txtSearch');
  await page.$eval('#txtSearch', el => el.value = '');
  await page.type('#txtSearch', TEST_PARTS.join(', '), { delay: 40 });
  await page.click('button.searchButton');

  console.log(`Searching for: ${TEST_PARTS.join(', ')}`);
  await new Promise(r => setTimeout(r, 4000));

  const result = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table tr').forEach((tr, i) => {
      const cells = [...tr.querySelectorAll('th,td')].map(c =>
        c.innerText.trim().replace(/\s+/g,' ').slice(0, 80)
      );
      if (cells.length >= 3 && cells.some(c => c)) rows.push(cells);
    });
    return rows;
  });

  console.log('\n=== ALL TABLE ROWS ===');
  result.forEach((row, i) => console.log(`Row ${i}:`, JSON.stringify(row)));

  await browser.close();
})().catch(e => { console.error('Failed:', e.message); process.exit(1); });
