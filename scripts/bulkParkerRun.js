/**
 * bulkParkerRun.js
 * Run this ONCE to seed Parker cross-reference data for all existing parts.
 * Usage: node scripts/bulkParkerRun.js
 */

require('dotenv').config();
const { initDB } = require('../src/db/database');
const { bulkEnrich } = require('../src/services/parkerEnrich');

async function main() {
  console.log('\n========================================');
  console.log('  Parker Cross-Reference Bulk Importer');
  console.log('========================================\n');
  console.log('Opening headless Chrome and querying Parker');
  console.log('cross-reference for every part in your database.\n');
  console.log('DO NOT close this window. May take a while.\n');

  await initDB();
  const result = await bulkEnrich();

  console.log('\n========================================');
  console.log(`  DONE: ${result.enriched} cross-references saved`);
  console.log(`  Parts processed: ${result.total}`);
  console.log('========================================\n');
  process.exit(0);
}

main().catch(err => {
  console.error('Bulk run failed:', err.message);
  process.exit(1);
});
