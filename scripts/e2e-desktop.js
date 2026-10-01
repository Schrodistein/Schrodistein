/* Prueba de extremo a extremo de la aplicación de escritorio (Electron),
 * con los mercados simulados. Requiere: cd desktop && npm install.
 * Uso (Linux sin pantalla): xvfb-run node scripts/e2e-desktop.js [carpeta-capturas] */
const { _electron } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { mockBinance } = require('./mock-markets');

const root = path.join(__dirname, '..');
const shots = process.argv[2];

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-e2e-'));
  const app = await _electron.launch({
    executablePath: require(path.join(root, 'desktop', 'node_modules', 'electron')),
    args: ['--no-sandbox', path.join(root, 'desktop')],
    env: Object.assign({}, process.env, { RADAR_USER_DATA: userData }),
  });
  const errors = [];
  const results = {};
  const check = (name, cond) => {
    results[name] = !!cond;
    if (!cond) errors.push('Falla: ' + name);
  };
  const page = await app.firstWindow();
  page.on('pageerror', (e) => errors.push(e.message));
  // El bloqueo del script en línea que se inyecta a propósito más abajo genera un error de consola esperado.
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|fonts|ERR_FAILED|net::|Content Security Policy/.test(m.text()) && errors.push(m.text()));
  await page.setViewportSize({ width: 1360, height: 860 }).catch(() => {});
  await mockBinance(page, []);
  await page.reload();
  await page.waitForSelector('#signal .verdict', { timeout: 30000 });

  check('servida desde radar://', (await page.evaluate(() => location.href)).startsWith('radar://app/'));
  check('puente de escritorio', await page.evaluate(() => typeof window.radarDesktop === 'object' && typeof window.radarDesktop.show === 'function'));
  check('sin acceso a Node en la página', await page.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined'));
  check('la política de seguridad bloquea scripts en línea', await page.evaluate(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__inyectado = 1';
    document.body.appendChild(s);
    return window.__inyectado === undefined;
  }));
  check('ventanas emergentes bloqueadas', await page.evaluate(() => window.open('https://example.com') === null));
  check('análisis de EUR/USD', (await page.textContent('#q-sym')) === 'EUR/USD');
  await page.click('#notice-ok');
  await page.click('.tabs [data-tab="forex"]');
  await page.waitForSelector('#tab-forex .srow', { timeout: 15000 }).catch(() => {});
  check('calendario y fuerza de divisas', /Non-Farm/.test(await page.textContent('#tab-forex')) && (await page.$$('#tab-forex .srow')).length === 8);
  if (shots) await page.screenshot({ path: shots + '/escritorio-app.png' });

  // Cerrar la ventana la oculta en la bandeja: la app sigue viva.
  const hasTray = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length > 0);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await page.waitForTimeout(500);
  const state = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows();
    return { windows: w.length, visible: w.length ? w[0].isVisible() : false };
  });
  check('sigue en la bandeja al cerrar la ventana', hasTray && state.windows === 1 && !state.visible);
  await page.evaluate(() => window.radarDesktop.show());
  await page.waitForTimeout(300);
  check('el aviso trae la ventana al frente', await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible()));
  check('menú en español', await app.evaluate(({ Menu }) => Menu.getApplicationMenu().items.map((i) => i.label).join(',').includes('Archivo')));
  const goto = await app.evaluate(({ Menu }) => {
    const m = Menu.getApplicationMenu().items.find((i) => i.label === 'Ir a');
    const it = m && m.submenu.items.find((i) => i.label === 'Mercados');
    if (it) it.click();
    return !!it;
  });
  await page.waitForFunction(() => !document.querySelector('#tab-markets').hidden, null, { timeout: 5000 }).catch(() => {});
  check('menú «Ir a» cambia de pestaña', goto && !(await page.$eval('#tab-markets', (e) => e.hidden)));
  await page.waitForFunction(() => document.querySelectorAll('#tab-prospect').length && window.__radar.state.news && window.__radar.state.news.items.length > 0, null, { timeout: 15000 }).catch(() => {});
  check('noticias en escritorio (CSP y CORS permiten los canales)', await page.evaluate(() => !!(window.__radar.state.news && window.__radar.state.news.items.length)));

  await app.close();
  fs.rmSync(userData, { recursive: true, force: true });
  console.log(JSON.stringify({ results, errors }, null, 1));
  process.exit(errors.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
