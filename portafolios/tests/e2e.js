/* Prueba de extremo a extremo con Playwright: recorre las cinco secciones.
 * Uso: node portafolios/tests/e2e.js [url] [carpeta-capturas] */
const path = require('path');
const { chromium } = require('playwright');
const url = process.argv[2] || 'file://' + path.join(__dirname, '..', 'index.html');
const shots = process.argv[3];
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  for (const [label, viewport, scheme] of [['movil', { width: 390, height: 844 }, 'light'], ['escritorio', { width: 1280, height: 900 }, 'dark']]) {
    const page = await browser.newPage({ viewport, colorScheme: scheme });
    page.on('pageerror', (e) => errors.push(label + ': ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text()) && errors.push(label + ': ' + m.text()));
    await page.goto(url);
    await page.waitForSelector('#chart-front svg');
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) errors.push(label + ': desbordamiento horizontal en Portafolio');
    if (shots) await page.screenshot({ path: `${shots}/${label}-portafolio.png`, fullPage: true });
    for (const tab of ['activos', 'confirmar', 'datos', 'teoria']) {
      await page.click('#tab-' + tab);
      await page.waitForTimeout(150);
      if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) errors.push(`${label}: desbordamiento horizontal en ${tab}`);
      if (shots) await page.screenshot({ path: `${shots}/${label}-${tab}.png`, fullPage: true });
    }
    await page.click('#tab-confirmar');
    const v1 = await page.textContent('#verdict .pill');
    await page.click('#w-rec');
    await page.waitForTimeout(100);
    const v2 = await page.textContent('#verdict .pill');
    if (!/No eficiente/.test(v1)) errors.push(`${label}: 1/N debería ser no eficiente (${v1})`);
    if (!/^Eficiente/.test(v2.trim())) errors.push(`${label}: el recomendado debería ser eficiente (${v2})`);
    if (shots) await page.screenshot({ path: `${shots}/${label}-confirmar-rec.png`, fullPage: true });
    await page.evaluate(() => localStorage.clear());
    await page.close();
  }
  await browser.close();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('e2e correcto');
})();
