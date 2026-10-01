/* Genera los iconos PNG a partir de <carpeta>/icon.svg con Playwright (Chromium).
 * Uso: node scripts/icons.js [carpeta]   (por defecto: icons) */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const dir = path.resolve(__dirname, '..', process.argv[2] || 'icons');
(async () => {
  const svg = fs.readFileSync(path.join(dir, 'icon.svg'), 'utf8');
  const browser = await chromium.launch();
  for (const size of [192, 512]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`);
    await page.screenshot({ path: path.join(dir, `icon-${size}.png`), omitBackground: true });
  }
  await browser.close();
})();
