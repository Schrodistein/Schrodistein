/* Prueba de extremo a extremo con Playwright: recorre las cinco secciones.
 * Uso: node portafolios/tests/e2e.js [url] [carpeta-capturas] */
const path = require('path');
const fs = require('fs');
const os = require('os');
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
  // Subida de un archivo por activo en formato Investing.com (español), con precios diarios.
  // Nombres sin tildes: setInputFiles de Playwright no adjunta rutas con caracteres no ASCII.
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pf-'));
    const files = [];
    const names = ['ECOPETROL', 'PFBCOLOM', 'ISA', 'GRUPOSURA', 'MSCI COLCAP'];
    names.forEach((n, k) => {
      let p = 1000 * (k + 1);
      const rows = ['"Fecha","Último","Apertura","Máximo","Mínimo","Vol.","% var."'];
      const d = new Date(Date.UTC(2021, 0, 4));
      let seed = k + 1;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const out = [];
      while (d < new Date(Date.UTC(2025, 11, 31))) {
        if (d.getUTCDay() % 6) {
          p *= 1 + (rnd() - 0.49) * 0.03;
          const dd = String(d.getUTCDate()).padStart(2, '0') + '.' + String(d.getUTCMonth() + 1).padStart(2, '0') + '.' + d.getUTCFullYear();
          out.push(`"${dd}","${p.toFixed(2).replace('.', ',')}","1,00","1,00","1,00","1,2M","0,1%"`);
        }
        d.setUTCDate(d.getUTCDate() + 1);
      }
      const f = path.join(dir, n + ' Datos historicos.csv');
      fs.writeFileSync(f, rows.concat(out.reverse()).join('\n'));
      files.push(f);
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => errors.push('archivos: ' + e.message));
    await page.goto(url + '#datos');
    await page.setInputFiles('#file', files);
    await page.waitForFunction(() => /Se unieron 5 activos/.test(document.getElementById('data-meta').textContent), null, { timeout: 5000 }).catch(async () => errors.push('archivos: ' + (await page.textContent('#banner')) + ' / ' + (await page.textContent('#data-meta'))));
    const market = await page.$eval('#market', (s) => s.value);
    if (market !== 'MSCI COLCAP') errors.push('archivos: índice detectado ' + market);
    const rows = await page.$$eval('#assets-table tbody tr', (r) => r.length);
    if (rows !== 5) errors.push('archivos: filas de activos ' + rows);
    const periods = await page.$eval('#csv', (t) => t.value.trim().split('\n').length - 1);
    if (periods !== 60) errors.push('archivos: meses unidos ' + periods);
    await page.selectOption('#freq', 'semanal');
    await page.waitForTimeout(300);
    const weeks = await page.$eval('#csv', (t) => t.value.trim().split('\n').length - 1);
    if (weeks < 250) errors.push('archivos: semanas unidas ' + weeks);
    if (shots) await page.screenshot({ path: `${shots}/archivos-datos.png`, fullPage: true });
    await page.close();
  }
  // Descargas de la BVC en Excel: tramos de 6 meses, títulos encima y columna de nemotécnico.
  // El lector de Excel se sirve desde el paquete local «xlsx» en lugar del CDN.
  let XLSX = null;
  try {
    XLSX = require('xlsx');
  } catch (e) {
    console.log('(se omite la prueba de Excel: instala el paquete xlsx para ejecutarla)');
  }
  if (XLSX) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bvc-'));
    const files = [];
    ['ECOPETROL', 'PFBCOLOM', 'ISA', 'COLCAP'].forEach((n, k) => {
      let p = 2000 * (k + 1);
      let seed = 7 * (k + 3);
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let half = 0; half < 6; half++) {
        const rows = [['Bolsa de Valores de Colombia'], ['Histórico ' + n], [], ['Nemotécnico', 'Fecha', 'Cantidad', 'Volumen', 'Precio de cierre']];
        const d = new Date(2023, half * 6, 1);
        const end = new Date(2023, half * 6 + 6, 1);
        while (d < end) {
          if (d.getDay() % 6) {
            p *= 1 + (rnd() - 0.49) * 0.03;
            rows.push([n, new Date(d), 100, Math.round(p * 100), Math.round(p * 100) / 100]);
          }
          d.setDate(d.getDate() + 1);
        }
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows, { cellDates: true }), 'Hoja1');
        const f = path.join(dir, `${n}_${half + 1}.xlsx`);
        XLSX.writeFile(wb, f);
        files.push(f);
      }
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('pageerror', (e) => errors.push('bvc: ' + e.message));
    const lib = require.resolve('xlsx/dist/xlsx.full.min.js');
    await page.route('**/xlsx.full.min.js', (r) => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(lib, 'utf8') }));
    await page.goto(url + '#datos');
    await page.setInputFiles('#file', files);
    await page.waitForFunction(() => /Se unieron 4 activos/.test(document.getElementById('data-meta').textContent), null, { timeout: 10000 }).catch(async () => errors.push('bvc: ' + (await page.textContent('#banner')) + ' / ' + (await page.textContent('#data-meta'))));
    const meta = await page.textContent('#data-meta');
    if (!/ECOPETROL: «Precio de cierre», 6 archivos/.test(meta)) errors.push('bvc: tramos no unidos: ' + meta);
    const market = await page.$eval('#market', (s) => s.value);
    if (market !== 'COLCAP') errors.push('bvc: índice detectado ' + market);
    const months = await page.$eval('#csv', (t) => t.value.trim().split('\n').length - 1);
    if (months !== 36) errors.push('bvc: meses unidos ' + months);
    if (shots) await page.screenshot({ path: `${shots}/bvc-datos.png`, fullPage: true });
    await page.close();
  }
  await browser.close();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('e2e correcto');
})();
