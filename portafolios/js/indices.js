/* Índices bursátiles: cómo se construye un índice, los índices de la BVC por mercado y la
 * función de selección por liquidez del COLEQTY (volumen, rotación y frecuencia), calculada
 * con los archivos de la BVC cargados. Incluye un constructor de índice con los activos del
 * usuario y la lista de referencias de toda la sección. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const fin = Number.isFinite;
  const DAY = 864e5;

  /* Liquidez de una acción a la fecha `asOf` (ISO), con la serie diaria de la BVC
   * { dates, prices, qty (acciones negociadas), vol (monto negociado en pesos) }:
   *   V = Σ monto negociado en los últimos 360 días calendario
   *   R = Σ (acciones negociadas en i / acciones en circulación) en los últimos 180 días   (× 100, en %)
   *   T = días con negociación en el trimestre / ruedas (días hábiles bursátiles) del trimestre × 100
   * `ruedas`: fechas en que hubo mercado (las de cualquier activo cargado). */
  function liquidity(s, asOf, shares, ruedas) {
    const t1 = Date.parse(asOf);
    const inWin = (d, days) => {
      const t = Date.parse(d);
      return t <= t1 && t > t1 - days * DAY;
    };
    let V = 0;
    let R = 0;
    let traded = 0;
    let haveVol = false;
    s.dates.forEach((d, i) => {
      const q = s.qty ? s.qty[i] : NaN;
      const v = s.vol ? s.vol[i] : NaN;
      if (inWin(d, 360) && fin(v)) {
        V += v;
        haveVol = true;
      }
      if (inWin(d, 180) && fin(q) && shares > 0) R += q / shares;
      if (inWin(d, 91) && fin(q) && q > 0) traded++;
    });
    const sessions = ruedas.filter((d) => inWin(d, 91)).length;
    return { V: haveVol ? V : NaN, R: shares > 0 && s.qty ? R * 100 : NaN, T: sessions && s.qty ? (traded / sessions) * 100 : NaN, traded, sessions };
  }

  /* Índice propio base 100 con los activos elegidos.
   *   método 'cap'    ponderación por capitalización bursátil: wᵢ = Pᵢ·Nᵢ / Σ Pⱼ·Nⱼ (al inicio)
   *   método 'liq'    ponderación por liquidez: wᵢ = Vᵢ / Σ Vⱼ
   *   método 'precio' ponderado por precios (como el Dow Jones): I = Σ Pᵢ / divisor
   *   método 'igual'  pesos iguales
   * Índice de Laspeyres: cantidades fijas al inicio, Iₜ = 100 · Σ qᵢ Pᵢ,ₜ / Σ qᵢ Pᵢ,₀. */
  function buildIndex(table, names, method, info) {
    const cols = names.map((n) => table.values[table.names.indexOf(n)]);
    // Primer periodo en que todos tienen precio
    let t0 = table.dates.findIndex((_, t) => cols.every((c) => fin(c[t]) && c[t] > 0));
    if (t0 < 0) return null;
    const p0 = cols.map((c) => c[t0]);
    let w;
    if (method === 'cap') w = names.map((n, i) => (info.shares[n] > 0 ? p0[i] * info.shares[n] : NaN));
    else if (method === 'liq') w = names.map((n) => info.V[n]);
    else if (method === 'precio') w = p0.slice();
    else w = names.map(() => 1);
    if (w.some((x) => !(x > 0))) return { error: method === 'cap' ? 'Escribe las acciones en circulación de cada activo para ponderar por capitalización.' : 'Falta el volumen negociado de algún activo (se necesitan los CSV de la BVC).' };
    const sw = w.reduce((a, b) => a + b, 0);
    w = w.map((x) => x / sw);
    const q = w.map((x, i) => x / p0[i]); // cantidades fijas que replican los pesos iniciales
    const dates = [];
    const values = [];
    for (let t = t0; t < table.dates.length; t++) {
      if (!cols.every((c) => fin(c[t]))) continue;
      dates.push(table.dates[t]);
      values.push(100 * cols.reduce((a, c, i) => a + q[i] * c[t], 0));
    }
    return { dates, values, w, from: table.dates[t0] };
  }

  const REFS = [
    'Banco de la República. (s. f.). Política monetaria: estrategia de inflación objetivo. https://www.banrep.gov.co',
    'Bolsa de Valores de Colombia. (2013). Metodología para el cálculo de los índices de renta variable: COLCAP, COLEQTY, COLSC, COLIR. BVC.',
    'Bolsa de Valores de Colombia. (2014). Metodología de los índices de renta fija COLTES y del índice de mercado monetario COLIBR. BVC.',
    'MSCI Inc. (2021). MSCI COLCAP Index methodology. https://www.msci.com',
    'Boyd, J. H., Hu, J., y Jagannathan, R. (2005). The stock market\'s reaction to unemployment news: Why bad news is usually good for stocks. The Journal of Finance, 60(2), 649–672.',
    'Chen, N.-F., Roll, R., y Ross, S. A. (1986). Economic forces and the stock market. The Journal of Business, 59(3), 383–403.',
    'Congreso de Colombia. (1992). Ley 31 de 1992, por la cual se dictan las normas a las que deberá sujetarse el Banco de la República.',
    'Congreso de Colombia. (2005). Ley 964 de 2005, por la cual se dictan normas generales del mercado de valores.',
    'Damodaran, A. (2012). Investment valuation: Tools and techniques for determining the value of any asset (3.ª ed.). Wiley.',
    'Damodaran, A. (s. f.). Betas by sector (emerging markets). NYU Stern. https://pages.stern.nyu.edu/~adamodar',
    'Dornbusch, R., y Fischer, S. (1980). Exchange rates and the current account. The American Economic Review, 70(5), 960–971.',
    'Fama, E. F. (1981). Stock returns, real activity, inflation, and money. The American Economic Review, 71(4), 545–565.',
    'Fama, E. F. (1990). Stock returns, expected returns, and real activity. The Journal of Finance, 45(4), 1089–1108.',
    'Fama, E. F., y Schwert, G. W. (1977). Asset returns and inflation. Journal of Financial Economics, 5(2), 115–146.',
    'Hamada, R. S. (1972). The effect of the firm\'s capital structure on the systematic risk of common stocks. The Journal of Finance, 27(2), 435–452.',
    'Jensen, M. C. (1968). The performance of mutual funds in the period 1945–1964. The Journal of Finance, 23(2), 389–416.',
    'Levine, R. (1997). Financial development and economic growth: Views and agenda. Journal of Economic Literature, 35(2), 688–726.',
    'Lintner, J. (1965). The valuation of risk assets and the selection of risky investments in stock portfolios and capital budgets. The Review of Economics and Statistics, 47(1), 13–37.',
    'Markowitz, H. (1952). Portfolio selection. The Journal of Finance, 7(1), 77–91.',
    'Pearson, K. (1896). Mathematical contributions to the theory of evolution III: Regression, heredity, and panmixia. Philosophical Transactions of the Royal Society A, 187, 253–318.',
    'Presidencia de la República. (1993). Decreto 663 de 1993, Estatuto Orgánico del Sistema Financiero.',
    'Schumpeter, J. A. (1911). Theorie der wirtschaftlichen Entwicklung. Duncker & Humblot.',
    'Sharpe, W. F. (1963). A simplified model for portfolio analysis. Management Science, 9(2), 277–293.',
    'Sharpe, W. F. (1964). Capital asset prices: A theory of market equilibrium under conditions of risk. The Journal of Finance, 19(3), 425–442.',
    'Sharpe, W. F. (1966). Mutual fund performance. The Journal of Business, 39(1), 119–138.',
    'Superintendencia Financiera de Colombia. (s. f.). Tasa representativa del mercado (TRM). https://www.superfinanciera.gov.co',
    'Treynor, J. L. (1965). How to rate management of investment funds. Harvard Business Review, 43(1), 63–75.',
    'Blume, M. E. (1971). On the assessment of risk. The Journal of Finance, 26(1), 1–10.',
  ].sort((a, b) => a.localeCompare(b, 'es'));

  /* ctx: { series (diarias cargadas), table, model, marketName, shares, method, pick, esc, pct } */
  function render(ctx) {
    const { esc } = ctx;
    const nf = (x, d = 1) => (fin(x) ? x.toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—');
    const money = (x) => (fin(x) ? '$ ' + Math.round(x).toLocaleString('es-CO') : '—');
    const out = [];
    out.push(`<div class="panel"><h2>6. Cómo se construye un índice bursátil</h2>
      <p>Un índice resume en un solo número cómo se mueve un mercado. Es el «portafolio de mercado» con el que se miden la β, Treynor y Jensen. Construirlo tiene dos pasos:</p>
      <div class="beta-compare"><div><h3>1. Seleccionar la canasta</h3><ul>
        <li><b>Por capitalización de la compañía</b>: entran las empresas más grandes, según su valor en bolsa (precio × acciones en circulación).</li>
        <li><b>Por liquidez</b>: entran las acciones que más se negocian, para que el índice se pueda replicar comprando y vendiendo de verdad.</li>
        <li><b>Mixta</b>: combina los dos criterios.</li></ul></div>
      <div><h3>2. Ponderar</h3><ul>
        <li><b>Por capitalización bursátil</b>: <code>wᵢ = Pᵢ Nᵢ / Σ Pⱼ Nⱼ</code>, donde Nᵢ son las acciones en circulación (o las que flotan libremente). Es el método del MSCI COLCAP y del S&amp;P 500.</li>
        <li><b>Por liquidez o rentabilidad</b>: pesa más la acción más negociada o la más rentable.</li>
        <li><b>Por precios</b>: <code>I = Σ Pᵢ / divisor</code>, como el Dow Jones: pesa más la acción de precio más alto, sin importar el tamaño de la empresa.</li></ul></div></div>
      <p class="formula"><code>Iₜ = I₀ · Σ qᵢ Pᵢ,ₜ / Σ qᵢ Pᵢ,₀</code> (índice de Laspeyres con base I₀ = 100 o 1.000; qᵢ son las cantidades de la canasta, que se ajustan en cada rebalanceo)</p></div>`);

    out.push(`<div class="panel"><h2>7. Índices de la Bolsa de Valores de Colombia</h2>
      <div class="table-scroll"><table class="data"><thead><tr><th>Mercado</th><th>Índice</th><th>Qué mide</th><th>Criterio</th></tr></thead><tbody>
      <tr><td rowspan="4">Renta variable</td><td><b>COLEQTY</b></td><td>Índice amplio de acciones: las 40 con mejor función de selección (liquidez).</td><td>Liquidez: volumen, rotación y frecuencia</td></tr>
      <tr><td><b>COLCAP</b> (hoy MSCI COLCAP)</td><td>Las acciones más líquidas del mercado; es el índice de referencia de la bolsa colombiana.</td><td>Liquidez para entrar; ponderado por capitalización bursátil</td></tr>
      <tr><td><b>COLSC</b></td><td>Empresas de menor capitalización (small caps) de la canasta del COLEQTY.</td><td>Tamaño</td></tr>
      <tr><td><b>COLIR</b></td><td>Emisores con el Reconocimiento IR de la BVC: los que cumplen mejores prácticas de revelación de información y relación con inversionistas.</td><td>Mejores prácticas</td></tr>
      <tr><td rowspan="2">Renta fija</td><td><b>COLTES</b> (tasa fija: corto plazo CP y largo plazo LP)</td><td>Portafolio de TES en pesos a tasa fija, separado por plazo.</td><td>Plazo al vencimiento</td></tr>
      <tr><td><b>COLTES UVR</b></td><td>TES indexados a la UVR (protegidos contra la inflación).</td><td>Unidad de valor real</td></tr>
      <tr><td>Mercado monetario</td><td><b>COLIBR</b></td><td>Inversión a un día que renta a la tasa IBR.</td><td>Tasa interbancaria</td></tr>
      </tbody></table></div>
      <p class="hint">En la app, cada segmento se mide contra su índice: COLCAP para acciones y ETF, COLTES para TES y bonos, COLIBR para CDT y mercado monetario (sección Datos → Índices de referencia).</p></div>`);

    // Función de selección con los datos cargados
    const series = (ctx.series || []).filter((s) => s.qty || s.vol);
    // Ruedas: días en que se negoció alguna de las acciones con datos de la BVC
    const ruedas = [...new Set(series.flatMap((s) => s.dates.filter((_, i) => s.qty && s.qty[i] > 0)))].sort();
    const asOf = ruedas[ruedas.length - 1];
    const rows = series
      .filter((s) => !PF.data.isMarketName(s.name) || /icolcap/i.test(s.name))
      .map((s) => Object.assign({ name: s.name }, liquidity(s, asOf, ctx.shares[s.name], ruedas)));
    const rank = (k) => {
      // Empates comparten puesto: 1 + número de acciones estrictamente mejores
      rows.forEach((r) => (r['rk' + k] = fin(r[k]) ? 1 + rows.filter((o) => fin(o[k]) && o[k] > r[k] + 1e-9).length : null));
    };
    ['V', 'R', 'T'].forEach(rank);
    out.push(`<div class="panel" id="liq-panel"><h2>8. Función de selección del COLEQTY con tus datos</h2>
      <p>El COLEQTY elige las 40 acciones con mejor función de selección, una medida de liquidez basada en tres factores. «Rueda» es cada día hábil bursátil en que hay negociación.</p>
      <p class="formula"><code>Vⱼ = Σᵢ₌₁³⁶⁰ monto negociado de j en el día i</code>: <b>volumen</b>, el monto total negociado de la acción en los últimos 360 días calendario.</p>
      <p class="formula"><code>Rⱼ = Σᵢ₌₁¹⁸⁰ (acciones negociadas de j en i / acciones en circulación vigentes de j en i)</code>: <b>rotación</b>, qué tanto de la empresa cambia de manos en 180 días.</p>
      <p class="formula"><code>Tⱼ = (días en que se negoció j en el trimestre / ruedas del trimestre) × 100</code>: <b>frecuencia</b>.</p>
      ${rows.length ? `<p class="hint">Calculado al ${esc(asOf)} con la cantidad y el volumen de los CSV de la BVC. Para la rotación escribe las acciones en circulación de cada emisor, que están en su ficha de la BVC o en sus estados financieros.</p>
      <div class="table-scroll"><table class="data"><thead><tr><th>Acción</th><th class="n">Volumen V (360 días)</th><th class="n">Puesto</th><th class="n">Acciones en circulación</th><th class="n">Rotación R (180 días)</th><th class="n">Puesto</th><th class="n">Frecuencia T (trimestre)</th><th class="n">Puesto</th></tr></thead><tbody>
      ${rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="n">${money(r.V)}</td><td class="n">${r.rkV || '—'}</td><td><input type="number" min="0" step="1000" data-shares="${esc(r.name)}" value="${ctx.shares[r.name] || ''}" placeholder="N.º de acciones" aria-label="Acciones en circulación de ${esc(r.name)}"></td><td class="n">${fin(r.R) ? nf(r.R, 2) + ' %' : '—'}</td><td class="n">${r.rkR || '—'}</td><td class="n">${fin(r.T) ? nf(r.T, 1) + ' %' : '—'}<span class="sub"> ${r.traded}/${r.sessions} ruedas</span></td><td class="n">${r.rkT || '—'}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="sub">Carga los CSV de la BVC (traen cantidad y volumen negociados) para calcular la liquidez de tus acciones.</p>'}</div>`);

    // Constructor de índice
    let builder = '';
    const m = ctx.model;
    if (m && ctx.table) {
      const names = m.names.filter((n) => ['accion', 'etf'].includes(ctx.clsOf(n)));
      const V = Object.fromEntries(rows.map((r) => [r.name, r.V]));
      const method = ctx.method || 'liq';
      const idx = names.length >= 2 ? buildIndex(ctx.table, names, method, { shares: ctx.shares, V }) : null;
      let chart = '';
      let table = '';
      if (idx && !idx.error) {
        const mk = ctx.table.values[ctx.table.names.indexOf(m.marketName)];
        const k0 = ctx.table.dates.indexOf(idx.from);
        let base = NaN;
        for (let t = k0; t < mk.length && !fin(base); t++) base = mk[t];
        const mkv = idx.dates.map((d) => mk[ctx.table.dates.indexOf(d)] / base * 100);
        const W = ctx.width || 700;
        chart = dualChart(idx.dates, idx.values, mkv, W, esc(m.marketName));
        const R = (arr) => arr[arr.length - 1] / 100 - 1;
        const last = mkv.filter(fin);
        table = `<div class="table-scroll"><table class="data"><thead><tr><th>Activo</th><th class="n">Peso inicial</th></tr></thead><tbody>${names.map((n, i) => `<tr><td>${esc(n)}</td><td class="n">${nf(idx.w[i] * 100, 1)} %</td></tr>`).join('')}</tbody></table></div>
          <p>Desde ${esc(idx.from)} tu índice rinde <b>${nf(R(idx.values) * 100, 1)} %</b> frente a <b>${nf((last[last.length - 1] / 100 - 1) * 100, 1)} %</b> de ${esc(m.marketName)}.</p>`;
      }
      builder = `<div class="panel" id="idx-panel"><h2>9. Construye tu propio índice</h2>
        <p>Con las acciones cargadas (canasta seleccionada) elige cómo ponderarlas y compara el resultado con ${esc(m.marketName)}.</p>
        <label class="field inline" for="idx-method"><span>Ponderación</span><select id="idx-method">
          <option value="liq"${method === 'liq' ? ' selected' : ''}>Por liquidez (volumen V)</option>
          <option value="cap"${method === 'cap' ? ' selected' : ''}>Por capitalización bursátil (precio × acciones en circulación)</option>
          <option value="precio"${method === 'precio' ? ' selected' : ''}>Por precios (como el Dow Jones)</option>
          <option value="igual"${method === 'igual' ? ' selected' : ''}>Pesos iguales</option></select></label>
        ${idx && idx.error ? `<p class="status warn">${esc(idx.error)}</p>` : ''}${!idx ? '<p class="sub">Se necesitan al menos dos acciones con precios.</p>' : ''}
        ${chart}${table}</div>`;
    }
    out.push(builder);

    out.push(`<div class="panel refs"><h2>Referencias</h2><ol>${REFS.map((r) => `<li>${esc(r).replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')}</li>`).join('')}</ol>
      <p class="hint">Las metodologías de los índices cambian con el tiempo; la versión vigente está en bvc.com.co (Índices) y, para el MSCI COLCAP, en msci.com.</p></div>`);
    return out.join('');
  }

  function dualChart(dates, a, b, W, nameB) {
    const H = 200;
    const pad = { l: 44, r: 10, t: 10, b: 22 };
    const all = a.concat(b).filter(fin);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const X = (i) => pad.l + (i / Math.max(1, dates.length - 1)) * (W - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo || 1)) * (H - pad.t - pad.b);
    const path = (arr) => arr.map((v, i) => (fin(v) ? `${i && fin(arr[i - 1]) ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}` : '')).join('');
    let s = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Índice propio frente al índice de mercado">`;
    for (const v of [lo, 100, hi].filter((v, i, a) => i === 1 || Math.abs(v - 100) > (hi - lo) * 0.08)) if (v >= lo && v <= hi) s += `<line class="gl" x1="${pad.l}" x2="${W - pad.r}" y1="${Y(v)}" y2="${Y(v)}"/><text class="tk" x="${pad.l - 4}" y="${Y(v) + 3}" text-anchor="end">${Math.round(v)}</text>`;
    s += `<path d="${path(a)}" fill="none" stroke="var(--s1)" stroke-width="2"/><path d="${path(b)}" fill="none" stroke="var(--s2)" stroke-width="1.6"/>`;
    s += `<text class="tk" x="${pad.l}" y="${H - 6}">${dates[0]}</text><text class="tk" x="${W - pad.r}" y="${H - 6}" text-anchor="end">${dates[dates.length - 1]}</text></svg>`;
    s += `<div class="legend"><span><i class="line" style="background:var(--s1)"></i>Tu índice (base 100)</span><span><i class="line" style="background:var(--s2)"></i>${nameB} (base 100)</span></div>`;
    return s;
  }

  PF.indices = { liquidity, buildIndex, render, REFS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
