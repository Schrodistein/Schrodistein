/* Prueba de extremo a extremo: completa la versión breve respondiendo al azar.
 * Uso: npx http-server -p 8080 . & ; node scripts/e2e.js [url] */
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://localhost:8080/index.html';
const shots = process.argv[3];
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.goto(url);
  if (shots) await page.screenshot({ path: shots + '/home.png', fullPage: true });
  await page.fill('#age', '30');
  await page.check('#mode-short', { force: true });
  await page.check('#consent');
  await page.click('#start');
  const t0 = Date.now();
  let shotDone = {};
  while (Date.now() - t0 < 6 * 60 * 1000) {
    if (await page.isVisible('#screen-results')) break;
    const title = await page.textContent('#t-title');
    if (await page.isVisible('#go')) { await page.click('#go'); continue; }
    if (shots && !shotDone[title] && (await page.$('.opt, .keypad, .corsi:not(.locked), .yesno'))) {
      shotDone[title] = 1;
      await page.screenshot({ path: `${shots}/item-${Object.keys(shotDone).length}.png`, fullPage: true });
    }
    if (await page.$('.yesno button')) { await page.click('.yesno button >> nth=' + (Math.random() < 0.5 ? 0 : 1)).catch(() => {}); continue; }
    if (await page.$('.opt:not([disabled])')) {
      const n = (await page.$$('.opt')).length;
      await page.click(`.opt >> nth=${Math.floor(Math.random() * n)}`).catch(() => {});
      await page.waitForTimeout(250);
      continue;
    }
    if (await page.$('.keypad')) {
      await page.click('.keypad button[data-k="1"]').catch(() => {});
      await page.click('.keypad button[data-k="ok"]').catch(() => {});
      await page.waitForTimeout(250);
      continue;
    }
    if (await page.$('.corsi:not(.locked)')) {
      const b = await page.$$('.corsi button');
      for (let i = 0; i < 3; i++) await b[i].click().catch(() => {});
      await page.waitForTimeout(500);
      continue;
    }
    await page.waitForTimeout(200);
  }
  const ok = await page.isVisible('#screen-results');
  if (shots && ok) await page.screenshot({ path: shots + '/results.png', fullPage: true });
  const iq = ok ? await page.textContent('.score-big .n') : null;
  console.log(JSON.stringify({ finished: ok, iq, seconds: Math.round((Date.now() - t0) / 1000), errors }));
  await browser.close();
  process.exit(ok && !errors.length ? 0 : 1);
})();
