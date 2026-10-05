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
    const page = await browser.newPage({ viewport, colorScheme: scheme, acceptDownloads: true });
    page.on('pageerror', (e) => errors.push(label + ': ' + e.message));
    page.on('console', (m) => m.type() === 'error' && !/fonts|Failed to load resource/.test(m.text()) && errors.push(label + ': ' + m.text()));
    await page.goto(url);
    // Pantalla inicial: Datos; luego la terminal, en modo oscuro y con Times New Roman
    await page.waitForSelector('#screen-datos:not([hidden])');
    const first = await page.$eval('.tabs button', (b) => b.textContent);
    if (first !== 'Datos') errors.push(label + ': la primera pestaña es ' + first);
    await page.click('#tab-terminal');
    await page.waitForSelector('#tc-price svg');
    if ((await page.getAttribute('html', 'data-theme')) !== 'dark') errors.push(label + ': el modo oscuro no es el predeterminado');
    if (!/Times New Roman/.test(await page.evaluate(() => getComputedStyle(document.body).fontFamily))) errors.push(label + ': la letra no es Times New Roman');
    if (await page.isHidden('#tape')) errors.push(label + ': sin cinta de cotizaciones');
    for (const id of ['tc-ret', 'tc-hist', 'tc-cum', 'tc-roll', 'tc-corr']) if (!(await page.$(`#${id} svg`))) errors.push(`${label}: falta el gráfico ${id}`);
    await page.click('#tw-table tr[data-asset="Banca"]');
    if (!/Banca/.test(await page.textContent('#th'))) errors.push(label + ': la lista de seguimiento no cambia de activo');
    // Apariencia: modo claro y fondo personalizado
    await page.click('#ap-btn');
    await page.click('[data-mode="light"]');
    await page.click('#ap-sw-light .sw:nth-child(3)');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    if ((await page.getAttribute('html', 'data-theme')) !== 'light' || bg !== 'rgb(244, 240, 230)') errors.push(`${label}: el tema no cambió (${bg})`);
    await page.click('[data-mode="dark"]');
    await page.click('#ap-btn');
    if (shots) await page.screenshot({ path: `${shots}/${label}-terminal.png`, fullPage: true });
    await page.click('#tab-frontera');
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
    // Plan de compra con comisiones
    await page.click('#tab-comprar');
    await page.waitForSelector('#plan-out .plan-lead');
    const lead = await page.textContent('#plan-out .plan-lead');
    if (!/^Invierte así: .*\d+ acciones de /.test(lead.trim())) errors.push(`${label}: plan sin acciones (${lead})`);
    if ((await page.$$eval('#plan-proj tbody tr', (r) => r.length)) < 3) errors.push(`${label}: faltan las proyecciones a corto, mediano y largo plazo`);
    // Promoción sin comisión: la compra queda en $0 y la venta sigue en $15.000
    await page.click('.fee-presets [data-fee="0"]');
    await page.waitForTimeout(600);
    const promo = await page.textContent('#plan-out .tiles');
    if (!/Comisiones de compra\s*\$\s*0/.test(promo) || !/Comisiones de venta[^$]*\$\s*[1-9]/.test(promo)) errors.push(`${label}: la promoción sin comisión no se aplicó (${promo.slice(0, 200)})`);
    await page.click('.fee-presets [data-fee="1"]');
    await page.waitForTimeout(600);
    const tiles = await page.textContent('#plan-out .tiles');
    if (!/Comisiones de compra/.test(tiles) || !/15\.000/.test(tiles)) errors.push(`${label}: plan sin comisiones de $15.000`);
    await page.fill('#plan-budget', '300000');
    await page.waitForTimeout(900);
    const k = await page.$$eval('#plan-out table tbody tr', (r) => r.length - 1);
    if (k < 1 || k > 4) errors.push(`${label}: con $300.000 el plan debería tener pocos activos (${k})`);
    if (shots) await page.screenshot({ path: `${shots}/${label}-comprar.png`, fullPage: true });
    await page.click('#plan-register');
    await page.waitForTimeout(500);
    if (!/Comisión de compra/.test(await page.textContent('#buy-table'))) errors.push(`${label}: Confirmar sin comisiones`);
    // Comisión propia de una compra (promoción a mitad de precio)
    const bi = await page.$$eval('#buys [data-bq]', (els) => els.findIndex((e) => e.value !== ''));
    const bf = await page.$(`#bf-${bi}`);
    const before = await page.textContent('#buy-sum');
    await bf.fill('7500');
    await page.waitForTimeout(700);
    if ((await page.textContent('#buy-sum')) === before) errors.push(`${label}: la comisión de una compra no cambia el total`);
    // Paso a paso y macro
    await page.click('#tab-estadistica');
    await page.waitForSelector('#dam-panel');
    const pasos = await page.textContent('#pasos');
    if (!/Markowitz \(1952\)/.test(pasos) || !/βL = βU/.test(pasos) || !/Varianza del portafolio/.test(pasos)) errors.push(label + ': paso a paso incompleto');
    await page.click('#tab-macro');
    if ((await page.$$('#macro-cards .macro-card')).length !== 4) errors.push(label + ': faltan las 4 variables macro');
    // Descargas
    await page.click('#tab-descargas');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-xlsx')]);
    const file = await dl.path();
    const head = fs.readFileSync(file).subarray(0, 2).toString('latin1');
    if (head !== 'PK' || !/\.xlsx$/.test(dl.suggestedFilename())) errors.push(`${label}: descarga de Excel inválida`);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#dl-cov')]);
    if (!/matriz-covarianzas/.test(dl2.suggestedFilename())) errors.push(`${label}: CSV de covarianzas`);
    if (shots) await page.screenshot({ path: `${shots}/${label}-descargas.png`, fullPage: true });
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
    // Datos diarios bien fechados: la app sugiere frecuencia semanal
    const freq = await page.$eval('#freq', (x) => x.value);
    const weeks = await page.$eval('#csv', (t) => t.value.trim().split('\n').length - 1);
    if (freq !== 'semanal' || weeks < 250) errors.push(`archivos: frecuencia ${freq}, semanas unidas ${weeks}`);
    await page.selectOption('#freq', 'mensual');
    await page.waitForTimeout(300);
    const periods = await page.$eval('#csv', (t) => t.value.trim().split('\n').length - 1);
    if (periods !== 60) errors.push('archivos: meses unidos ' + periods);
    if (shots) await page.screenshot({ path: `${shots}/archivos-datos.png`, fullPage: true });
    // Compras por número de acciones y fecha: el precio sale del cierre de ese día
    await page.click('#tab-confirmar');
    await page.click('#mode-acciones');
    await page.fill('#buy-date', '2024-03-02'); // sábado: debe usar el cierre del viernes 1
    await page.dispatchEvent('#buy-date', 'change');
    await page.fill('#bq-0', '100');
    await page.waitForTimeout(600);
    const note = await page.textContent('#bn-0');
    if (!/Cierre del 2024-03-01 \(ese día no hubo negociación\)/.test(note)) errors.push('compras: ' + note);
    if (!/Total invertido/.test(await page.textContent('#buy-sum'))) errors.push('compras: sin total');
    if (await page.isHidden('#buy-detail')) errors.push('compras: sin detalle');
    if (!/Eficiente|No eficiente|Casi eficiente/.test(await page.textContent('#verdict'))) errors.push('compras: sin veredicto');
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
    await page.selectOption('#freq', 'mensual');
    await page.waitForTimeout(300);
    const months = await page.$eval('#csv', (t) => t.value.trim().split('\n').length - 1);
    if (months !== 36) errors.push('bvc: meses unidos ' + months);
    if (shots) await page.screenshot({ path: `${shots}/bvc-datos.png`, fullPage: true });
    await page.close();
  }
  // CSV guardados por Excel en español: Windows-1252, punto y coma, encabezados con tildes y
  // unidades, un archivo sin extensión y otro que no es un historial (debe informarse, no bloquear).
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-'));
    const files = [];
    ['CELSIA', 'GRUPOARGOS', 'NUTRESA', 'COLCAP'].forEach((n, k) => {
      let p = 5000 + 1000 * k;
      let seed = 11 * (k + 2);
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const lines = ['Bolsa de Valores de Colombia;;;;', 'Histórico de operaciones;;;;', 'Nemotécnico;Fecha Operación;Cantidad;Volumen ($);Precio de Cierre ($)'];
      for (let m = 0; m < 40; m++) {
        p *= 1 + (rnd() - 0.48) * 0.08;
        const d = new Date(Date.UTC(2022, m + 1, 0));
        const dd = String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0') + '/' + d.getUTCFullYear();
        lines.push(`${n};${dd};100;${Math.round(p * 100)};${p.toFixed(2).replace('.', ',')}`);
      }
      const f = path.join(dir, k === 3 ? 'colcap-descarga' : n + '.csv');
      fs.writeFileSync(f, Buffer.from(lines.join('\r\n'), 'latin1'));
      files.push(f);
    });
    const junk = path.join(dir, 'notas.txt');
    fs.writeFileSync(junk, 'Estas son mis notas\nsin datos de precios\n');
    files.push(junk);
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('pageerror', (e) => errors.push('win1252: ' + e.message));
    await page.goto(url + '#datos');
    await page.setInputFiles('#file', files);
    await page.waitForFunction(() => /Listo: 4 activos/.test(document.getElementById('upload-status').textContent), null, { timeout: 8000 }).catch(async () => errors.push('win1252: ' + (await page.textContent('#upload-status'))));
    const st = await page.textContent('#upload-status');
    if (!/notas\.txt/.test(st)) errors.push('win1252: no informa el archivo inválido: ' + st);
    const market = await page.$eval('#market', (s) => s.value);
    if (market !== 'COLCAP') errors.push('win1252: índice detectado ' + market);
    if (shots) await page.screenshot({ path: `${shots}/win1252-datos.png`, fullPage: true });
    await page.close();
  }
  await browser.close();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('e2e correcto');
})();
