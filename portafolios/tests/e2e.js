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
    if (first !== 'Datos y guía') errors.push(label + ': la primera pestaña es ' + first);
    await page.click('#tab-terminal');
    await page.waitForSelector('#tc-price svg');
    // Terminal dividida en renta variable, renta fija y divisas
    if ((await page.$$eval('#t-segs [data-seg]', (b) => b.map((x) => x.getAttribute('data-seg')).join())) !== 'variable,fija,divisas') errors.push(label + ': la terminal no tiene los tres segmentos');
    if ((await page.getAttribute('html', 'data-theme')) !== 'dark') errors.push(label + ': el modo oscuro no es el predeterminado');
    if (!/Times New Roman/.test(await page.evaluate(() => getComputedStyle(document.body).fontFamily))) errors.push(label + ': la letra no es Times New Roman');
    if (await page.isHidden('#tape')) errors.push(label + ': sin cinta de cotizaciones');
    for (const id of ['tc-ret', 'tc-hist', 'tc-cum', 'tc-roll', 'tc-corr']) if (!(await page.$(`#${id} svg`))) errors.push(`${label}: falta el gráfico ${id}`);
    // Renta fija: los bonos de deuda pública (TES cero cupón) con su tasa y cambio en pb
    await page.click('#t-segs [data-seg="fija"]');
    await page.waitForTimeout(300);
    const tes = await page.$$eval('#tw-table tr[data-asset]', (r) => r.map((x) => x.textContent));
    if (tes.filter((x) => /TES (pesos|UVR) \d+ años?/.test(x) && /%/.test(x) && /pb/.test(x)).length < 6) errors.push(label + ': faltan los TES en la terminal de renta fija: ' + tes.join(' | '));
    await page.click('#t-segs [data-seg="variable"]');
    await page.waitForTimeout(300);
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
    // Sin pestaña Comprar; la frecuencia es fija en diaria
    if (await page.$('#tab-comprar')) errors.push(label + ': la pestaña Comprar debería haberse quitado');
    if ((await page.$eval('#freq', (x) => x.value)) !== 'diaria' || !(await page.$eval('#freq', (x) => x.disabled))) errors.push(label + ': la frecuencia debe ser diaria y fija');
    // Compras registradas en Confirmar, con su comisión
    await page.click('#tab-confirmar');
    await page.click('#mode-acciones');
    await page.fill('#bq-0', '10');
    await page.waitForTimeout(500);
    if (!/Comisión de compra/.test(await page.textContent('#buy-table'))) errors.push(`${label}: Confirmar sin comisiones`);
    // Comisión propia de una compra (promoción a mitad de precio)
    const bi = await page.$$eval('#buys [data-bq]', (els) => els.findIndex((e) => e.value !== ''));
    const bf = await page.$(`#bf-${bi}`);
    const before = await page.textContent('#buy-sum');
    await bf.fill('7500');
    await page.waitForTimeout(700);
    if ((await page.textContent('#buy-sum')) === before) errors.push(`${label}: la comisión de una compra no cambia el total`);
    // Cada pestaña recuerda dónde quedó: guía al final, terminal a la mitad, y al volver siguen ahí
    await page.click('#tab-datos');
    await page.click('#datos-sub [data-sub="guia"]');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(400);
    const yGuia = await page.evaluate(() => window.scrollY);
    await page.click('#tab-terminal');
    await page.waitForTimeout(300);
    await page.evaluate(() => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) / 2)));
    await page.waitForTimeout(400);
    const yTerm = await page.evaluate(() => window.scrollY);
    await page.click('#tab-datos');
    await page.waitForTimeout(500);
    const back = await page.evaluate(() => window.scrollY);
    await page.click('#tab-terminal');
    await page.waitForTimeout(500);
    const backT = await page.evaluate(() => window.scrollY);
    if (yGuia < 500 || Math.abs(back - yGuia) > 40 || Math.abs(backT - yTerm) > 40) errors.push(`${label}: las pestañas no recuerdan su posición (guía ${yGuia}→${back}, terminal ${yTerm}→${backT})`);
    await page.click('#tab-datos');
    await page.click('#datos-sub [data-sub="variable"]');
    // Guía para operar en la BVC
    await page.click('#tab-datos');
    if (await page.$('#tab-guia')) errors.push(label + ': Guía debe estar dentro de Datos');
    // Submenú de Datos: renta fija con tasa libre de riesgo y primas
    await page.click('#datos-sub [data-sub="fija"]');
    if (await page.isHidden('#rf-panel') || await page.isHidden('#prp-panel') || !(await page.isHidden('#drop'))) errors.push(label + ': el submenú de renta fija no cambia la vista');
    await page.fill('#prp-tes10', '11');
    await page.fill('#prp-ust10', '4');
    await page.fill('#prp-picol', '5');
    await page.fill('#prp-pius', '2');
    await page.fill('#prp-erp', '4.5');
    await page.press('#prp-erp', 'Tab');
    await page.waitForTimeout(300);
    if (!/Prima por riesgo país/.test(await page.textContent('#prp-out')) || !(await page.$('#prp-btns [data-use-em]'))) errors.push(label + ': no se calculan las primas');
    if (shots) await page.screenshot({ path: `${shots}/${label}-rentafija.png`, fullPage: true });
    await page.click('#datos-sub [data-sub="guia"]');
    if ((await page.$$('#guia .guia-ch')).length < 10) errors.push(label + ': la guía no tiene sus capítulos');
    if (!/Con tus datos/.test(await page.textContent('#guia'))) errors.push(label + ': la guía no usa los datos cargados');
    if (shots) await page.screenshot({ path: `${shots}/${label}-guia.png`, fullPage: false });
    await page.click('#guia [data-guia-go="frontera"]');
    if (await page.isHidden('#screen-frontera')) errors.push(label + ': el botón de la guía no lleva a Portafolio');
    // Elegir activos: quitar uno recalcula con uno menos, y «Todos» lo devuelve
    const nAll = await page.$$eval('#pick-assets [data-pick]:checked', (els) => els.length);
    await page.click('#pick-assets [data-pick] >> nth=0');
    await page.waitForTimeout(400);
    const nNow = await page.$$eval('#pick-assets [data-pick]:checked', (els) => els.length);
    const rows = await page.$$eval('#compare-table tbody tr', (els) => els.length);
    if (nNow !== nAll - 1 || !/de \d+ activos en el portafolio/.test(await page.textContent('#pick-assets'))) errors.push(`${label}: elegir activos no funciona (${nAll} → ${nNow})`);
    if (!rows) errors.push(label + ': sin portafolios al quitar un activo');
    await page.click('#pick-assets [data-pick-all="1"]');
    await page.waitForTimeout(400);
    if ((await page.$$eval('#pick-assets [data-pick]:checked', (els) => els.length)) !== nAll) errors.push(label + ': «Todos» no devuelve los activos');
    // Catálogo de la BVC y matriz de precios en la biblioteca
    await page.evaluate(() => PFApp.saveToLibrary([
      { name: 'MSCI COLCAP', dates: ['2026-08-13', '2026-08-14', '2026-08-18'], prices: [1000, 1010, 1020] },
      { name: 'ECOPETROL', dates: ['2026-08-13', '2026-08-14', '2026-08-18'], prices: [100, 105, 110] },
    ]));
    await page.click('#tab-datos');
    await page.click('#tab-biblioteca');
    await page.waitForTimeout(300);
    const [mxOrig] = await Promise.all([page.waitForEvent('download'), page.click('#mx-download-orig')]);
    if (!/original.*\.xlsx$/.test(mxOrig.suggestedFilename())) errors.push(label + ': la matriz original no se descarga');
    const [mxDl] = await Promise.all([page.waitForEvent('download'), page.click('#mx-download')]);
    if (!/\.xlsx$/.test(mxDl.suggestedFilename())) errors.push(label + ': la matriz de precios no se descarga');
    if ((await page.$$('#cat-table tbody tr')).length < 30) errors.push(label + ': falta el catálogo de la BVC');
    // Paso a paso y macro
    await page.click('#tab-estadistica');
    await page.waitForSelector('#dam-panel');
    const pasos = await page.textContent('#pasos');
    if (!/Markowitz \(1952\)/.test(pasos) || !/βL = βU/.test(pasos) || !/Varianza del portafolio/.test(pasos)) errors.push(label + ': paso a paso incompleto');
    if (!/Cómo se calcula y se grafica la frontera eficiente/.test(pasos) || !/Dónde queda el portafolio elegido/.test(pasos) || !/promedian las correlaciones/.test(pasos)) errors.push(label + ': falta el paso a paso de la frontera');
    if ((await page.$$('#pasos .chart-box svg')).length < 2) errors.push(label + ': faltan las gráficas de la frontera y la SML en el paso a paso');
    for (const id of ['paso-erm', 'paso-riesgo', 'paso-r2', 'paso-primas', 'paso-de']) if (!(await page.$('#' + id))) errors.push(`${label}: falta la sección ${id} del paso a paso`);
    if (!(await page.$('#pasos table.corr-likert td[style*="background"]'))) errors.push(label + ': la matriz de correlación no lleva los colores de Likert');
    if (shots) await page.screenshot({ path: `${shots}/${label}-pasos.png`, fullPage: true });
    await page.click('#tab-macro');
    if ((await page.$$('#macro-cards .macro-card')).length !== 4) errors.push(label + ': faltan las 4 variables macro');
    if ((await page.$$('#macro-cards .macro-links a[href^="https://www.dane.gov.co"]')).length < 3) errors.push(label + ': faltan los enlaces oficiales del DANE');
    if (!/pdf/.test(await page.getAttribute('#macro-file', 'accept'))) errors.push(label + ': macro no acepta PDF');
    // Sin alarmas de advertencia en portafolios ni activos; el sistema financiero con sus referencias
    await page.click('#tab-frontera');
    const bann = await page.$eval('#banner', (b) => (b.hidden ? '' : b.textContent));
    if (bann) errors.push(label + ': alarma visible en Portafolio: ' + bann.slice(0, 80));
    await page.click('#tab-sistema');
    await page.waitForSelector('#sistema .sf-diagram');
    const sis = await page.textContent('#sistema');
    if (!/Mercado extrabursátil/.test(sis) || !/COLEQTY/.test(sis) || !/Referencias/.test(sis)) errors.push(label + ': sistema financiero incompleto');
    // Descargas
    await page.click('#tab-descargas');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#dl-xlsx')]);
    const file = await dl.path();
    const head = fs.readFileSync(file).subarray(0, 2).toString('latin1');
    if (head !== 'PK' || !/\.xlsx$/.test(dl.suggestedFilename())) errors.push(`${label}: descarga de Excel inválida`);
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#dl-cov')]);
    if (!/matriz-covarianzas/.test(dl2.suggestedFilename())) errors.push(`${label}: CSV de covarianzas`);
    // Todas las matrices de cálculo del paso a paso, en CSV y como hojas del libro
    for (const k of ['desv', 'pond', 'front', 'cml', 'sml', 'elec', 'corrp', 'contrib']) {
      const [d] = await Promise.all([page.waitForEvent('download'), page.click('#dl-' + k)]);
      const txt = fs.readFileSync(await d.path(), 'utf8');
      if (!/\.csv$/.test(d.suggestedFilename()) || txt.split('\r\n').length < 3) errors.push(`${label}: matriz ${k} vacía`);
    }
    if (!/Cov_ponderada.*Corr_promedio/.test(await page.textContent('#dl-status').catch(() => '')) && !/Cov_ponderada/.test(await page.evaluate(() => document.getElementById('dl-status').textContent))) {
      await page.click('#dl-xlsx');
      await page.waitForTimeout(300);
      if (!/Desv_media.*Cov_ponderada.*Frontera_puntos.*CML.*SML.*Eleccion_activos.*Corr_promedio.*Contrib_riesgo/.test(await page.textContent('#dl-status'))) errors.push(`${label}: el libro no trae las hojas nuevas: ` + (await page.textContent('#dl-status')));
    }
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
    // Siempre cotizaciones diarias: una fila por rueda
    const freq = await page.$eval('#freq', (x) => x.value);
    const days = await page.$eval('#csv', (t) => t.value.trim().split('\n').length - 1);
    if (freq !== 'diaria' || days < 550 || days > 700) errors.push(`archivos: frecuencia ${freq}, ruedas unidas ${days} (ventana 22/08/2023 a 22/08/2026)`);
    const first = await page.$eval('#csv', (t) => t.value.trim().split('\n')[1].split(/[;,]/)[0]);
    if (first < '2023-08-22') errors.push('archivos: la ventana de análisis no empieza el 22/08/2023: ' + first);
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
    const ruedas = await page.$eval('#csv', (t) => t.value.trim().split('\n').length - 1);
    if (ruedas < 500) errors.push('bvc: ruedas unidas ' + ruedas);
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
      for (let t = Date.UTC(2024, 0, 2), m = 0; m < 400; t += 864e5) {
        const d = new Date(t);
        if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
        m++;
        p *= 1 + (rnd() - 0.48) * 0.02;
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
    await page.waitForFunction(() => /Listo: 4 instrumentos/.test(document.getElementById('upload-status').textContent), null, { timeout: 8000 }).catch(async () => errors.push('win1252: ' + (await page.textContent('#upload-status'))));
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
