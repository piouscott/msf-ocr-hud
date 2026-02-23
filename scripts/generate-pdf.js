/**
 * Generate PDF from HTML using Puppeteer
 * Usage: node scripts/generate-pdf.js
 */

const fs = require('fs');
const path = require('path');

async function generatePDF() {
  try {
    // Import puppeteer dynamically
    const puppeteer = await import('puppeteer');

    const htmlPath = path.join(__dirname, '..', 'docs', 'WAR-OCR-GUIDE.html');
    const pdfPath = path.join(__dirname, '..', 'docs', 'WAR-OCR-GUIDE.pdf');

    if (!fs.existsSync(htmlPath)) {
      console.error('HTML file not found:', htmlPath);
      process.exit(1);
    }

    console.log('Launching browser...');
    const browser = await puppeteer.default.launch({
      headless: 'new'
    });

    const page = await browser.newPage();

    console.log('Loading HTML...');
    const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    console.log('Generating PDF...');
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      },
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<div></div>',
      footerTemplate: `
        <div style="width: 100%; font-size: 9px; padding: 5px 15mm; text-align: center; color: #666;">
          <span>MSF Counter - War OCR Guide</span>
          <span style="float: right;">Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
        </div>
      `
    });

    await browser.close();

    const stats = fs.statSync(pdfPath);
    console.log(`\n✓ PDF generated: ${pdfPath}`);
    console.log(`  Size: ${(stats.size / 1024).toFixed(1)} KB`);

  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' || error.message.includes('puppeteer')) {
      console.log('\nPuppeteer not installed. Installing...');
      const { execSync } = require('child_process');
      try {
        execSync('npm install puppeteer', { stdio: 'inherit' });
        console.log('\nPuppeteer installed. Please run the script again.');
      } catch (installError) {
        console.error('\nFailed to install Puppeteer:', installError.message);
        console.log('\nAlternative: Open docs/WAR-OCR-GUIDE.html in your browser and use Print to PDF (Ctrl+P)');
      }
    } else {
      console.error('Error generating PDF:', error.message);
    }
    process.exit(1);
  }
}

generatePDF();
