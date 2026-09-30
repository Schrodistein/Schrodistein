/* Genera build/icon.png (512 px) y build/tray.png (32 px) a partir de un SVG,
 * dibujándolo con el navegador de Playwright. Uso: node scripts/icons.js */
'use strict';
const path = require('path');
const { chromium } = require('playwright');
const svg = (size, pad) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
  <rect x="${pad}" y="${pad}" width="${32 - 2 * pad}" height="${32 - 2 * pad}" rx="${7 - pad / 2}" fill="#1d4f91"/>
  <path d="M6 25 C8 14 14 9 26 7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
  <line x1="6" y1="19" x2="26" y2="6" stroke="#fff" stroke-width="1.3" opacity="0.6"/>
  <circle cx="18.5" cy="10.2" r="2.6" fill="#fff"/></svg>`;
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [file, size, pad] of [['icon.png', 512, 1.5], ['tray.png', 32, 0]]) {
    await p.setViewportSize({ width: size, height: size });
    await p.setContent(`<html><body style="margin:0;background:transparent">${svg(size, pad)}</body></html>`);
    await p.screenshot({ path: path.join(__dirname, '..', 'build', file), omitBackground: true });
  }
  await b.close();
  console.log('Íconos generados en build/');
})();
