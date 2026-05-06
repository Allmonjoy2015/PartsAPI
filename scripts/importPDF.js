const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { DEFAULT_PDF, parsePDF, inferCategory } = require('./pdfCrossRefImport');


async function importPDF(pdfPath) {
    const filePath = pdfPath || DEFAULT_PDF;

    if (!fs.existsSync(filePath)) {
        console.error(`\n❌ PDF not found: ${filePath}`);
        console.error('Save the cross-reference PDF to your Downloads folder as crossref.pdf');
        console.error('Or pass the full path: node scripts/pdfCrossRefImport.js "C:\\path\\to\\file.pdf"\n');
        process.exit(1);
    }

    console.log(`\n📄 Reading PDF: ${filePath}`);
    const dataBuffer = fs.readFileSync(filePath);
    const parser = new PDFParse();
    const pdfData = await parser.parse(dataBuffer);

    console.log(`📊 Pages: ${pdfData.numpages} | Text length: ${pdfData.text.length} chars`);

    const entries = parsePDF(pdfData.text);
    console.log(`🔍 Found ${entries.length} cross-reference entries\n`);

    if (!entries.length) {
        console.error('No entries parsed. The PDF format may differ — check the file.');
        process.exit(1);
    }

    // Preview first 5
    console.log('Preview (first 5):');
    entries.slice(0, 5).forEach(e => console.log(`  ${e.competitorPN} (${e.manufacturer}) → ${e.equivalentPN}`)
    );
    console.log('...\n');

    await initDB();
    const db = getDB();

    let partsCreated = 0;
    let crossRefsInserted = 0;
    let duplicatesSkipped = 0;

    for (const entry of entries) {
        const { competitorPN, manufacturer, equivalentPN } = entry;

        // Find or create the competitor part
        let partId;
        const found = db.exec(
            `SELECT id FROM parts WHERE part_number = '${competitorPN.replace(/'/g, "''")}' LIMIT 1`
        );

        if (found.length && found[0].values.length) {
            partId = found[0].values[0][0];
        } else {
            // Auto-create the part
            partId = uuidv4();
            const cat = inferCategory(competitorPN, manufacturer);
            db.run(`INSERT INTO parts VALUES (
        '${partId}',
        '${competitorPN.replace(/'/g, "''")}',
        '${manufacturer.replace(/'/g, "''")} ${competitorPN.replace(/'/g, "''")}',
        '${cat}',
        '${manufacturer.replace(/'/g, "''")}',
        'Hose fitting — imported from cross-reference PDF',
        '', 1, datetime('now')
      )`);
            partsCreated++;
        }

        // Check for duplicate cross-ref
        const dup = db.exec(
            `SELECT id FROM cross_references
       WHERE part_id = '${partId}'
         AND ref_part_number = '${equivalentPN.replace(/'/g, "''")}' LIMIT 1`
        );
        if (dup.length && dup[0].values.length) {
            duplicatesSkipped++;
            continue;
        }

        // Insert cross-reference
        db.run(`INSERT INTO cross_references VALUES (
      '${uuidv4()}',
      '${partId}',
      '${equivalentPN.replace(/'/g, "''")}',
      'DiscountHydraulicHose',
      'Hose fitting cross-reference'
    )`);
        crossRefsInserted++;

        // Save every 200 to avoid memory buildup
        if ((crossRefsInserted + duplicatesSkipped) % 200 === 0) {
            save();
            process.stdout.write(`  ... ${crossRefsInserted} inserted, ${duplicatesSkipped} skipped\r`);
        }
    }

    save();

    console.log('\n========================================');
    console.log(`  ✅ Import complete`);
    console.log(`  Parts auto-created    : ${partsCreated}`);
    console.log(`  Cross-refs inserted   : ${crossRefsInserted}`);
    console.log(`  Duplicates skipped    : ${duplicatesSkipped}`);
    console.log(`  Total entries parsed  : ${entries.length}`);
    console.log('========================================\n');
}
exports.importPDF = importPDF;
