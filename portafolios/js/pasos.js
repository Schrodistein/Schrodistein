/* «Paso a paso»: varianza, desviación estándar, covarianza y correlación de los activos
 * cargados, con cada fórmula, sus valores y el autor que la introdujo en la teoría de
 * portafolios; varianza del portafolio de Markowitz; beta de Sharpe frente a beta de
 * Damodaran. Todo se calcula con los mismos datos que usa el resto de la app. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const fin = Number.isFinite;

  /* ---------- Industrias de Damodaran ---------- */
  // Lee la hoja de betas por industria de Damodaran (betaemerg.xls, betaGlobal.xls…), ya
  // convertida a filas por SheetJS. Columnas: Industry Name, Number of firms, Beta, D/E Ratio,
  // Effective Tax rate, Unlevered beta, Cash/Firm value, Unlevered beta corrected for cash…
  function parseDamodaran(rows) {
    const low = (x) => String(x == null ? '' : x).toLowerCase().trim();
    const hr = rows.findIndex((r) => r && r.some((c) => low(c) === 'industry name'));
    if (hr < 0) throw new Error('El archivo no tiene la tabla «Industry Name» de Damodaran.');
    const h = rows[hr].map(low);
    const col = (re, not) => h.findIndex((x) => re.test(x) && !(not && not.test(x)));
    const ci = {
      name: col(/^industry name$/),
      firms: col(/number of firms/),
      beta: col(/^(average )?beta$/),
      de: col(/d\/e ratio/),
      tax: col(/tax rate/),
      unlev: col(/^unlevered beta$/),
      unlevCash: col(/unlevered beta corrected for cash/),
    };
    const num = (v) => (typeof v === 'number' ? v : parseFloat(String(v).replace('%', '')) / (/%/.test(String(v)) ? 100 : 1));
    const out = [];
    for (const r of rows.slice(hr + 1)) {
      if (!r || !r[ci.name]) continue;
      const name = String(r[ci.name]).trim();
      const unlev = num(r[ci.unlevCash >= 0 ? ci.unlevCash : ci.unlev]);
      if (!name || !fin(unlev) || /^total/i.test(name)) continue;
      out.push({ name, firms: num(r[ci.firms]), beta: num(r[ci.beta]), de: num(r[ci.de]), tax: num(r[ci.tax]), unlev });
    }
    if (out.length < 5) throw new Error('No se encontraron industrias con beta desapalancada.');
    return out;
  }
  // Industria sugerida para acciones conocidas de la BVC (nombres de Damodaran)
  const SUGGEST = [
    [/ecopetrol|canacol|geopark/i, 'Oil/Gas (Integrated)'],
    [/terpel/i, 'Oil/Gas Distribution'],
    [/cibest|bcolombia|bancolombia|bogota|davivienda|occidente|aval|popular|bbva/i, 'Bank (Money Center)'],
    [/sura|grupsura/i, 'Insurance (General)'],
    [/isa|geb|celsia|promigas|energ/i, 'Utility (General)'],
    [/argos|grupoargos|corfi/i, 'Diversified'],
    [/cemargos|cementos/i, 'Building Materials'],
    [/nutresa|exito/i, 'Food Processing'],
  ];
  function suggestIndustry(name, list) {
    const hit = SUGGEST.find(([re]) => re.test(name));
    if (!hit || !list) return null;
    return list.find((x) => x.name.toLowerCase() === hit[1].toLowerCase()) || null;
  }

  /* Beta de Damodaran (de abajo hacia arriba): βL = βU · [1 + (1 − t) · D/E] */
  const relever = (bu, t, de) => bu * (1 + (1 - t) * de);
  const unlever = (bl, t, de) => bl / (1 + (1 - t) * de);

  /* ---------- Cálculos ---------- */
  function pairCalc(rA, rB) {
    const idx = [];
    for (let t = 0; t < rA.length; t++) if (fin(rA[t]) && fin(rB[t])) idx.push(t);
    const a = idx.map((t) => rA[t]);
    const b = idx.map((t) => rB[t]);
    const n = a.length;
    const sa = a.reduce((q, x) => q + x, 0);
    const sb = b.reduce((q, x) => q + x, 0);
    const ma = sa / n;
    const mb = sb / n;
    const da = a.map((x) => x - ma);
    const db = b.map((x) => x - mb);
    const sqa = da.reduce((q, x) => q + x * x, 0);
    const sqb = db.reduce((q, x) => q + x * x, 0);
    const sp = da.reduce((q, x, i) => q + x * db[i], 0);
    const va = sqa / (n - 1);
    const vb = sqb / (n - 1);
    const cov = sp / (n - 1);
    return { idx, a, b, n, sa, sb, ma, mb, da, db, sqa, sqb, sp, va, vb, sda: Math.sqrt(va), sdb: Math.sqrt(vb), cov, corr: cov / Math.sqrt(va * vb) };
  }

  /* ctx: { m, table, retType, P, esc, pct, num, a, b, dam: {list, inputs}, crp } */
  /* Nomenclatura única para toda la app: la misma letra significa lo mismo en cada pantalla, gráfica y archivo. */
  const NOMEN = `<h2>Nomenclatura</h2>
    <p>Las mismas letras significan lo mismo en toda la app. Los subíndices (letras pequeñas abajo) dicen <b>de quién</b> es el valor; los superíndices (arriba) son potencias o la transpuesta.</p>
    <div class="table-scroll"><table class="data"><thead><tr><th>Símbolo</th><th>Significa</th><th>Ejemplo</th></tr></thead><tbody>
      <tr><td><code>i</code>, <code>j</code></td><td>Un activo cualquiera (acción, ETF, bono) y otro activo</td><td><code>σ<sub>ij</sub></code>: covarianza entre los activos i y j</td></tr>
      <tr><td><code>A</code>, <code>B</code></td><td>Los dos activos que se usan en los ejemplos numéricos</td><td><code>r<sub>A,t</sub></code>: rendimiento del activo A el día t</td></tr>
      <tr><td><code>p</code></td><td><b>Portafolio</b> (la combinación de activos que se analiza)</td><td><code>E(R<sub>p</sub>)</code>, <code>σ<sub>p</sub></code>, <code>β<sub>p</sub></code></td></tr>
      <tr><td><code>m</code></td><td><b>Mercado</b>: el índice de referencia (MSCI COLCAP, o el índice propio del activo)</td><td><code>E(R<sub>m</sub>)</code>, <code>σ<sub>m</sub><sup>2</sup></code>, <code>r<sub>m</sub></code></td></tr>
      <tr><td><code>T</code></td><td>Portafolio <b>tangente</b> (el de mayor Sharpe)</td><td><code>E(R<sub>T</sub>)</code>, <code>σ<sub>T</sub></code>, <code>w<sub>T</sub></code></td></tr>
      <tr><td><code>rf</code></td><td>Tasa libre de riesgo anual</td><td><code>E(R<sub>m</sub>) − rf</code>: prima de mercado</td></tr>
      <tr><td><code>t</code></td><td>Un día de negociación (rueda); en la frontera, la tolerancia al riesgo</td><td><code>r<sub>t</sub> = ln(P<sub>t</sub> / P<sub>t−1</sub>)</code></td></tr>
      <tr><td><code>P</code></td><td>Precio de cierre</td><td><code>P<sub>t</sub></code>: precio el día t</td></tr>
      <tr><td><code>r</code></td><td>Rendimiento diario (logarítmico)</td><td><code>r<sub>i,t</sub></code></td></tr>
      <tr><td><code>R</code>, <code>E(R)</code>, <code>μ</code></td><td>Rendimiento anual y rendimiento esperado anual</td><td><code>μ<sub>i</sub> = E(R<sub>i</sub>)</code></td></tr>
      <tr><td><code>w</code></td><td>Peso: fracción del dinero en cada activo (suman 1)</td><td><code>w<sub>i</sub> = 0,25</code> es el 25 %</td></tr>
      <tr><td><code>σ</code>, <code>σ<sup>2</sup></code></td><td>Desviación estándar (riesgo) y varianza</td><td><code>σ<sub>p</sub> = √σ<sub>p</sub><sup>2</sup></code></td></tr>
      <tr><td><code>Σ</code></td><td>Como letra sola: la matriz de varianzas y covarianzas. Delante de una expresión: «suma de»</td><td><code>w<sup>T</sup>Σw</code>; <code>Σ w<sub>i</sub> = 1</code></td></tr>
      <tr><td><code>ρ</code></td><td>Correlación (de −1 a +1)</td><td><code>ρ<sub>ij</sub> = σ<sub>ij</sub> / (σ<sub>i</sub> σ<sub>j</sub>)</code></td></tr>
      <tr><td><code>β</code>, <code>α</code>, <code>ε</code></td><td>Beta (riesgo sistemático), alfa de Jensen y error de la regresión (riesgo propio)</td><td><code>r<sub>i</sub> = α<sub>i</sub> + β<sub>i</sub> r<sub>m</sub> + ε<sub>i</sub></code></td></tr>
      <tr><td><code>N</code></td><td>Número de activos</td><td><code>w<sub>1</sub> + … + w<sub>N</sub> = 1</code></td></tr>
      <tr><td><code>f</code></td><td>Ruedas por año (242) para anualizar</td><td><code>σ<sub>anual</sub> = σ<sub>diaria</sub> √f</code></td></tr>
      <tr><td><code><sup>T</sup></code> (superíndice)</td><td>Transpuesta: la lista de pesos escrita como fila para multiplicar</td><td><code>w<sup>T</sup>μ = Σ w<sub>i</sub> μ<sub>i</sub></code></td></tr>
    </tbody></table></div>`;

  function render(ctx) {
    const { m, table, esc, pct } = ctx;
    const f = m.f;
    const nf = (x, d = 6) => PF.data.fmtNum(x, d);
    const n4 = (x) => nf(x, 4);
    const log = ctx.retType !== 'simple';
    const ix = (name) => table.names.indexOf(name);
    const R = PF.data.toReturns(table.values, ctx.kind === 'returns' ? 'returns' : 'prices', log);
    const A = m.names[ctx.a] || m.names[0];
    const B = m.names[ctx.b] || m.names[1] || m.names[0];
    const mk = m.marketName;
    const rA = R[ix(A)];
    const rB = R[ix(B)];
    const pc = pairCalc(rA, rB);
    const out = [`<div class="panel" id="paso-nomen">${NOMEN}</div>`];
    const sel = (id, v) => `<select id="${id}">${m.names.map((n, i) => `<option value="${i}"${n === v ? ' selected' : ''}>${esc(n)}</option>`).join('')}</select>`;

    out.push(`<div class="panel"><h2>1. De precios a rendimientos</h2>
      <div class="form"><label class="field" for="pa-a"><span>Activo A</span>${sel('pa-a', A)}</label><label class="field" for="pa-b"><span>Activo B</span>${sel('pa-b', B)}</label></div>
      <p>Markowitz (1952) trabaja con <b>rendimientos</b>, no con precios: lo que importa al inversionista es cuánto gana por cada peso invertido. ${log ? 'La app usa el rendimiento logarítmico (continuo)' : 'La app usa el rendimiento simple'}:</p>
      <p class="formula"><code>${log ? 'rₜ = ln(Pₜ / Pₜ₋₁)' : 'rₜ = Pₜ / Pₜ₋₁ − 1'}</code></p>
      <ul class="sym"><li><code>Pₜ</code>: precio de cierre del periodo t (último cierre o promedio, según Datos).</li><li><code>Pₜ₋₁</code>: precio del periodo anterior.</li>${log ? '<li><code>ln</code>: logaritmo natural. Los rendimientos logarítmicos se suman en el tiempo y se acercan más a una distribución normal.</li>' : ''}</ul>
      <p>Hay <b>${pc.n}</b> periodos en que ${esc(A)} y ${esc(B)} tienen rendimiento a la vez, con frecuencia de ${f} periodos por año (f = ${f}).</p></div>`);

    // Tabla de cálculo
    const show = pc.n <= 24 ? pc.idx.map((_, k) => k) : [...Array(12).keys(), -1, ...[pc.n - 3, pc.n - 2, pc.n - 1]];
    const pr = (name, t) => table.values[ix(name)][t];
    const prevPrice = (name, t) => {
      for (let k = t - 1; k >= 0; k--) if (fin(table.values[ix(name)][k])) return table.values[ix(name)][k];
      return NaN;
    };
    const rows = show.map((k) => {
      if (k === -1) return `<tr><td colspan="11" class="sub">… ${pc.n - 15} periodos más (incluidos en las sumas) …</td></tr>`;
      // El rendimiento t sale de los precios t y t + 1 de la tabla: la fila lleva la fecha y el precio del día t + 1
      const t = pc.idx[k] + 1;
      return `<tr><td class="n">${k + 1}</td><td>${esc(table.dates[t])}</td><td class="n">${nf(pr(A, t), 2)}</td><td class="n">${nf(pr(B, t), 2)}</td><td class="n">${nf(pc.a[k])}</td><td class="n">${nf(pc.b[k])}</td><td class="n">${nf(pc.da[k])}</td><td class="n">${nf(pc.db[k])}</td><td class="n">${nf(pc.da[k] ** 2, 8)}</td><td class="n">${nf(pc.db[k] ** 2, 8)}</td><td class="n">${nf(pc.da[k] * pc.db[k], 8)}</td></tr>`;
    });
    const t0 = pc.idx[0] + 1;
    out.push(`<div class="panel"><h2>2. Tabla de cálculo: ${esc(A)} (A) y ${esc(B)} (B)</h2>
      <p class="hint">Ejemplo con el primer periodo: r<sub>A</sub> = ${log ? 'ln' : ''}(${nf(pr(A, t0), 2)} / ${nf(prevPrice(A, t0), 2)})${log ? '' : ' − 1'} = ${nf(pc.a[0])}.</p>
      <div class="table-scroll"><table class="data"><thead><tr><th class="n">t</th><th>Fecha</th><th class="n">P<sub>A</sub></th><th class="n">P<sub>B</sub></th><th class="n">r<sub>A</sub></th><th class="n">r<sub>B</sub></th><th class="n">r<sub>A</sub> − r̄<sub>A</sub></th><th class="n">r<sub>B</sub> − r̄<sub>B</sub></th><th class="n">(r<sub>A</sub> − r̄<sub>A</sub>)²</th><th class="n">(r<sub>B</sub> − r̄<sub>B</sub>)²</th><th class="n">(r<sub>A</sub> − r̄<sub>A</sub>)(r<sub>B</sub> − r̄<sub>B</sub>)</th></tr></thead>
      <tbody>${rows.join('')}<tr class="hl"><td colspan="4"><b>Σ (suma de los ${pc.n} periodos)</b></td><td class="n"><b>${nf(pc.sa)}</b></td><td class="n"><b>${nf(pc.sb)}</b></td><td class="n">0</td><td class="n">0</td><td class="n"><b>${nf(pc.sqa, 8)}</b></td><td class="n"><b>${nf(pc.sqb, 8)}</b></td><td class="n"><b>${nf(pc.sp, 8)}</b></td></tr></tbody></table></div>
      <p class="hint">Las desviaciones respecto a la media siempre suman cero; por eso se elevan al cuadrado (varianza) o se multiplican entre activos (covarianza).</p></div>`);

    // Fórmulas con valores
    const fa = (x) => nf(x * f, 6);
    out.push(`<div class="panel"><h2>3. Fórmulas con los valores de A y B</h2>
      <h3>Rendimiento medio (esperado histórico)</h3>
      <p class="formula"><code>r̄ = Σ rₜ / n</code> → r̄<sub>A</sub> = ${nf(pc.sa)} / ${pc.n} = <b>${nf(pc.ma)}</b> por periodo; anual: × f = <b>${pct(pc.ma * f)}</b>. r̄<sub>B</sub> = ${nf(pc.sb)} / ${pc.n} = <b>${nf(pc.mb)}</b>; anual <b>${pct(pc.mb * f)}</b>.</p>
      <p class="hint"><b>Markowitz (1952)</b>: el rendimiento esperado <code>E(R)</code> es la primera de las dos medidas que describen un activo; la media histórica es su estimación más simple. <code>Σ</code> es la suma de todos los periodos y <code>n</code> el número de periodos.</p>

      <h3>Varianza</h3>
      <p class="formula"><code>σ² = Σ (rₜ − r̄)² / (n − 1)</code> → σ²<sub>A</sub> = ${nf(pc.sqa, 8)} / ${pc.n - 1} = <b>${nf(pc.va, 8)}</b> por periodo; anual × f = <b>${fa(pc.va)}</b>. σ²<sub>B</sub> = ${nf(pc.sqb, 8)} / ${pc.n - 1} = <b>${nf(pc.vb, 8)}</b>; anual <b>${fa(pc.vb)}</b>.</p>
      <p class="hint"><b>Markowitz (1952)</b> propuso medir el <b>riesgo</b> con la varianza: cuánto se alejan los rendimientos de su media. <code>(rₜ − r̄)²</code> es la desviación de cada periodo al cuadrado, para que las caídas y las subidas no se cancelen. Se divide por <code>n − 1</code> y no por <code>n</code> (corrección de Bessel) porque la media también se estimó con los mismos datos; así la varianza muestral no queda sesgada. Para anualizar se multiplica por f, si los rendimientos de cada periodo son independientes.</p>

      <h3>Desviación estándar (volatilidad)</h3>
      <p class="formula"><code>σ = √σ²</code> → σ<sub>A</sub> = √${nf(pc.va, 8)} = <b>${nf(pc.sda)}</b>; anual <code>σ·√f</code> = <b>${pct(pc.sda * Math.sqrt(f))}</b>. σ<sub>B</sub> = <b>${nf(pc.sdb)}</b>; anual <b>${pct(pc.sdb * Math.sqrt(f))}</b>.</p>
      <p class="hint">La raíz devuelve el riesgo a las unidades del rendimiento (porcentaje). Es la medida de riesgo total que usa <b>Sharpe (1966)</b> en su razón <code>(E(R) − rf) / σ</code>. Se anualiza con <code>√f</code> porque la varianza crece con el tiempo y la desviación con su raíz.</p>

      <h3>Covarianza</h3>
      <p class="formula"><code>σ<sub>AB</sub> = Σ (r<sub>A,t</sub> − r̄<sub>A</sub>)(r<sub>B,t</sub> − r̄<sub>B</sub>) / (n − 1)</code> → σ<sub>AB</sub> = ${nf(pc.sp, 8)} / ${pc.n - 1} = <b>${nf(pc.cov, 8)}</b>; anual <b>${fa(pc.cov)}</b>.</p>
      <p class="hint">El aporte central de <b>Markowitz (1952)</b>: el riesgo de un portafolio no es el promedio de los riesgos, porque depende de cómo se mueven los activos <i>juntos</i>. Si cuando A sube B también sube, los productos son positivos y la covarianza también. Si se mueven en sentido contrario, es negativa y combinarlos reduce el riesgo: es la base matemática de la diversificación.</p>

      <h3>Coeficiente de correlación</h3>
      <p class="formula"><code>ρ<sub>AB</sub> = σ<sub>AB</sub> / (σ<sub>A</sub> · σ<sub>B</sub>)</code> → ρ = ${nf(pc.cov, 8)} / (${nf(pc.sda)} × ${nf(pc.sdb)}) = <b>${n4(pc.corr)}</b></p>
      <p class="hint">El coeficiente de <b>Pearson (1896)</b> estandariza la covarianza entre −1 y 1, para poder comparar pares de activos. Con ρ = 1 no hay beneficio de diversificar; con ρ &lt; 1 sí, y con ρ = −1 se podría eliminar el riesgo. Markowitz lo usa para escribir la covarianza como <code>σ<sub>AB</sub> = ρ<sub>AB</sub> σ<sub>A</sub> σ<sub>B</sub></code>.</p>
      ${m.info && m.info.pairwise ? `<p class="hint"><b>Nota:</b> el modelo usa «toda la historia de cada activo». La media y la varianza de cada activo salen de todos sus periodos, y cada covarianza de los que comparten los dos. Por eso pueden diferir un poco de las de esta tabla, que usa solo los ${pc.n} periodos comunes. Con «solo periodos comunes» en Datos coinciden.</p>` : ''}
    </div>`);

    // Matrices
    const N = m.names.length;
    const head = `<tr><th></th>${m.names.map((n) => `<th class="n">${esc(n)}</th>`).join('')}</tr>`;
    const mat = (M, fmt) => `<div class="table-scroll"><table class="data"><thead>${head}</thead><tbody>${m.names.map((n, i) => `<tr><td>${esc(n)}</td>${M[i].map((x, j) => `<td class="n${i === j ? ' diag' : ''}">${fmt(x)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    const matC = (M) => `<div class="table-scroll"><table class="data corr-likert"><thead>${head}</thead><tbody>${m.names.map((n, i) => `<tr><td>${esc(n)}</td>${M[i].map((x) => { const lk = PF.stats.likert(x); return `<td class="n" style="background:${lk.color};color:${lk.text}" title="${esc(lk.label)}">${n4(x)}</td>`; }).join('')}</tr>`).join('')}</tbody></table></div>`;
    out.push(`<div class="panel"><h2>4. Matrices de todos los activos (anuales)</h2>
      <div class="table-scroll"><table class="data"><thead><tr><th>Activo</th><th class="n">E(R)</th><th class="n">Varianza σ²</th><th class="n">Desviación σ</th></tr></thead><tbody>${m.names.map((n, i) => `<tr><td>${esc(n)}</td><td class="n">${pct(m.mu[i])}</td><td class="n">${nf(m.Sigma[i][i], 6)}</td><td class="n">${pct(m.vol[i])}</td></tr>`).join('')}</tbody></table></div>
      <h3>Matriz de varianzas y covarianzas Σ</h3><p class="hint">La diagonal son las varianzas σᵢ²; fuera de ella, las covarianzas σᵢⱼ, simétricas (σᵢⱼ = σⱼᵢ). Es la matriz que usa el optimizador de Markowitz.</p>${mat(m.Sigma, (x) => nf(x, 6))}
      <h3>Matriz de correlaciones ρ</h3><p class="hint">ρᵢⱼ = σᵢⱼ / (σᵢ σⱼ). La diagonal vale 1: cada activo está perfectamente correlacionado consigo mismo. Cada celda lleva el color de su correlación: verde = correlación directa (en +1, perfecta: se mueven juntos), amarillo = sin correlación lineal (0), rojo = correlación inversa (en −1, perfecta: se mueven en sentido contrario).</p>${matC(m.corr)}${PF.charts && PF.charts.likertLegend ? PF.charts.likertLegend() : ''}</div>`);

    // Varianza del portafolio
    const e = ctx.P && ctx.P.recommended;
    if (e) {
      const w = e.w;
      const terms = m.Sigma.map((row, i) => row.map((s, j) => w[i] * w[j] * s));
      const total = terms.flat().reduce((q, x) => q + x, 0);
      const diag = terms.reduce((q, row, i) => q + row[i], 0);
      const naive = w.reduce((q, x, i) => q + x * m.vol[i], 0);
      out.push(`<div class="panel"><h2>5. Varianza del portafolio (Markowitz)</h2>
        <p class="formula"><code>σₚ² = Σᵢ Σⱼ wᵢ wⱼ σᵢⱼ = wᵀ Σ w</code></p>
        <ul class="sym"><li><code>wᵢ</code>: peso del activo i en el portafolio (fracción del dinero; suman 1).</li><li><code>σᵢⱼ</code>: covarianza entre i y j de la matriz Σ (con i = j es la varianza).</li><li>Hay N términos de varianza y N(N − 1) de covarianza: con muchos activos manda la covarianza, no el riesgo propio de cada uno.</li></ul>
        <p>Con los pesos del portafolio recomendado, cada celda es <code>wᵢ wⱼ σᵢⱼ</code>:</p>
        ${mat(terms, (x) => nf(x, 6))}
        <p class="formula">σₚ² = suma de todas las celdas = <b>${nf(total, 6)}</b> → σₚ = √σₚ² = <b>${pct(Math.sqrt(total))}</b>. Las varianzas (diagonal) aportan ${nf(diag, 6)} y las covarianzas ${nf(total - diag, 6)}.</p>
        <p class="hint"><b>Efecto de la diversificación:</b> si todos los activos tuvieran correlación 1, el riesgo sería el promedio ponderado <code>Σ wᵢ σᵢ</code> = ${pct(naive)}. El portafolio tiene ${pct(Math.sqrt(total))}: combinar activos que no se mueven igual le quita ${pct(naive - Math.sqrt(total))} de volatilidad.</p></div>`);
    }

    // Beta de Sharpe paso a paso
    const rM = R[ix(mk)];
    const pm = pairCalc(rA, rM);
    const regA = PF.stats.regress(pm.a.map((x) => x - m.rfp), pm.b.map((x) => x - m.rfp));
    out.push(`<div class="panel"><h2>6. Beta, Treynor y Jensen de ${esc(A)}</h2>
      <p class="formula"><code>βᵢ = Cov(rᵢ, rₘ) / Var(rₘ)</code> → β = ${nf(pm.cov, 8)} / ${nf(pm.vb, 8)} = <b>${n4(pm.cov / pm.vb)}</b> (con ${pm.n} periodos comunes con ${esc(mk)})</p>
      <p class="hint"><b>Sharpe (1963)</b>, en su modelo de índice único, explica cada rendimiento como <code>rᵢ = αᵢ + βᵢ rₘ + εᵢ</code>. La beta mide cuánto se mueve el activo cuando se mueve el mercado: β = 1 lo sigue, β &gt; 1 lo amplifica y β &lt; 1 lo amortigua. En el <b>CAPM</b> (Sharpe, 1964; Lintner, 1965) es el único riesgo que se paga, porque el riesgo propio εᵢ se elimina al diversificar: <code>E(Rᵢ) = rf + βᵢ (E(Rₘ) − rf)</code>.</p>
      <p class="formula"><code>Treynor = (E(Rᵢ) − rf) / βᵢ</code> = ${pct(m.assets[ctx.a] ? m.assets[ctx.a].treynor : NaN)}</p>
      <p class="hint"><b>Treynor (1965)</b>: prima por unidad de riesgo <i>sistemático</i> (β). Sirve para un activo o un fondo que forma parte de un portafolio diversificado, donde solo cuenta la β.</p>
      <p class="formula"><code>α de Jensen = E(Rᵢ) − [rf + βᵢ (E(Rₘ) − rf)]</code> = ${pct(m.assets[ctx.a] ? m.assets[ctx.a].jensen : NaN, 2)}</p>
      <p class="hint"><b>Jensen (1968)</b>: lo que el activo rinde por encima (α &gt; 0) o por debajo (α &lt; 0) de lo que exige el CAPM para su β. En la regresión de excesos de rendimiento sobre el mercado, el α histórico es la ordenada: ${pct(regA.alpha * f, 2)} anual (t = ${nf(regA.tAlpha, 2)}).</p></div>`);

    // Sharpe vs Damodaran
    out.push(damodaranPanel(ctx, R, rM, nf));
    return out.join('');
  }

  function damodaranPanel(ctx, R, rM, nf) {
    const { m, table, esc, pct } = ctx;
    const ix = (name) => table.names.indexOf(name);
    const list = ctx.dam && ctx.dam.list;
    const inputs = (ctx.dam && ctx.dam.inputs) || {};
    const erp = m.Em - m.rf;
    const crp = ctx.crp || 0;
    const opts = list ? `<datalist id="dam-ind">${list.map((x) => `<option value="${esc(x.name)}">`).join('')}</datalist>` : '';
    const rows = m.names.map((n, i) => {
      const a = m.assets[i];
      const pm = pairCalc(R[ix(n)], rM);
      const reg = PF.stats.regress(pm.a, pm.b);
      const se = reg.seBeta;
      const inp = inputs[n] || {};
      const sug = suggestIndustry(n, list);
      const ind = inp.industry != null ? inp.industry : sug ? sug.name : '';
      const fromList = list && list.find((x) => x.name.toLowerCase() === String(ind).toLowerCase());
      const bu = inp.bu != null && inp.bu !== '' ? +inp.bu : fromList ? fromList.unlev : NaN;
      const de = inp.de != null && inp.de !== '' ? +inp.de : NaN;
      const tax = inp.tax != null && inp.tax !== '' ? +inp.tax / 100 : fin(ctx.taxDefault) ? ctx.taxDefault : 0.35;
      const bl = fin(bu) && fin(de) ? relever(bu, tax, de) : NaN;
      const bImpl = fin(de) ? unlever(a.betaM, tax, de) : NaN;
      const blume = 0.67 * a.betaM + 0.33;
      const ke = (b) => (fin(b) ? m.rf + b * erp + crp : NaN);
      return `<tr>
        <td>${esc(n)}</td>
        <td class="n"><b>${nf(a.betaM, 3)}</b><span class="sub">±${nf(1.96 * se, 2)}</span></td>
        <td class="n">${nf(blume, 3)}</td>
        <td><input list="dam-ind" data-dam="${esc(n)}" data-f="industry" value="${esc(ind)}" placeholder="industria" aria-label="Industria de ${esc(n)}"></td>
        <td><input type="number" step="0.01" data-dam="${esc(n)}" data-f="bu" value="${inp.bu != null ? esc(inp.bu) : ''}" placeholder="${fromList ? nf(fromList.unlev, 2) : 'βU'}" aria-label="Beta desapalancada de ${esc(n)}"></td>
        <td><input type="number" step="0.01" min="0" data-dam="${esc(n)}" data-f="de" value="${inp.de != null ? esc(inp.de) : ''}" placeholder="D/E" aria-label="Deuda / patrimonio de ${esc(n)}"></td>
        <td><input type="number" step="1" min="0" max="60" data-dam="${esc(n)}" data-f="tax" value="${inp.tax != null ? esc(inp.tax) : ''}" placeholder="35" aria-label="Tasa de impuestos de ${esc(n)}"></td>
        <td class="n"><b>${nf(bl, 3)}</b></td>
        <td class="n">${nf(bImpl, 3)}</td>
        <td class="n">${fin(bl) ? nf(bl - a.betaM, 3) : '—'}</td>
        <td class="n">${pct(ke(a.betaM))}</td>
        <td class="n">${pct(ke(bl))}</td>
      </tr>`;
    });
    return `<div class="panel" id="dam-panel"><h2>7. Beta de Sharpe frente a beta de Damodaran</h2>
      <div class="beta-compare">
        <div><h3>Beta de Sharpe (de regresión, «de arriba hacia abajo»)</h3>
          <p class="formula"><code>rᵢ,ₜ = αᵢ + βᵢ rₘ,ₜ + εᵢ,ₜ</code>, <code>βᵢ = Cov(rᵢ, rₘ) / Var(rₘ)</code></p>
          <p>Sale de los <b>precios históricos de la propia acción</b>, con una regresión de sus rendimientos sobre los del índice (Sharpe, 1963 y 1964). Es la que usa el resto de esta app.</p>
          <ul><li>Mira al <b>pasado</b>: refleja el negocio y el endeudamiento que tuvo la empresa en el periodo de la muestra.</li><li>Tiene <b>error estándar</b> alto: con pocos datos, el intervalo del 95 % (±1,96 σ<sub>β</sub>) puede ser muy ancho.</li><li>Depende del índice (en Colombia el COLCAP está concentrado en pocas empresas), del periodo y de la frecuencia de los datos. Las acciones poco negociadas muestran betas artificialmente bajas.</li></ul></div>
        <div><h3>Beta de Damodaran (fundamental, «de abajo hacia arriba»)</h3>
          <p class="formula"><code>βU = βL / [1 + (1 − t)·D/E]</code> (desapalancar, Hamada, 1972)<br><code>βL = βU · [1 + (1 − t)·D/E]</code> (reapalancar)</p>
          <p>Aswath Damodaran (NYU Stern) parte del <b>promedio de las betas de muchas empresas del mismo negocio</b>: le quita a cada una el efecto de su deuda (beta desapalancada βU, de activos), las promedia por industria, corrige por la caja y vuelve a aplicar la deuda de la empresa que se analiza.</p>
          <ul><li><code>βU</code>: riesgo del negocio sin deuda (beta desapalancada de la industria, corregida por caja).</li><li><code>D/E</code>: deuda / valor de mercado del patrimonio de la empresa, hoy.</li><li><code>t</code>: tasa marginal de impuestos (35 % en Colombia para sociedades); los intereses de la deuda se deducen de impuestos, y por eso la deuda pesa <code>(1 − t)</code>.</li><li>Promediar muchas betas reduce el error: el error estándar baja con la raíz del número de empresas.</li><li>Refleja el negocio y la deuda <b>actuales</b>, y se puede calcular para empresas que no cotizan o con poca historia.</li></ul></div>
      </div>
      <p><b>Diferencia principal.</b> La beta de Sharpe <i>mide</i> la sensibilidad pasada de una acción con una regresión estadística. La de Damodaran la <i>construye</i> con fundamentales: el riesgo del sector más el apalancamiento financiero de hoy. Damodaran recomienda la segunda para calcular el costo del patrimonio, <code>Kₑ = rf + β·(E(Rₘ) − rf) + PRP</code>, porque sus betas de regresión suelen tener errores estándar muy grandes. Para un mercado emergente como Colombia suma además una prima por riesgo país (PRP).</p>
      <div class="row-btns">${ctx.desktop ? '<button type="button" class="btn" id="dam-download">Descargar las betas por industria de Damodaran (mercados emergentes)</button>' : ''}<label class="btn file" for="dam-file">Cargar betas por industria de Damodaran (.xls)<input type="file" id="dam-file" accept=".xls,.xlsx"></label>
        <label class="field inline" for="dam-crp"><span>Prima por riesgo país (%)</span><input id="dam-crp" type="number" step="0.01" min="0" value="${crp ? (crp * 100).toFixed(2) : ''}" placeholder="0"></label></div>
      ${ctx.crpSrc ? `<p class="hint">Prima por riesgo país ${esc(ctx.crpSrc)}${/escrita/.test(ctx.crpSrc) ? '. Borra el campo para volver a la calculada en Datos → Renta fija.' : '. Si escribes otra, se usa la tuya.'}</p>` : '<p class="hint">Sube en Datos → Renta fija el EMBIG, las tasas de los TES y el Tesoro de EE. UU. (o la tabla de Damodaran) y la prima por riesgo país llega aquí sola.</p>'}
      <p class="status" id="dam-status"${list ? '' : ' hidden'}>${list ? `Industrias de Damodaran cargadas: ${list.length}${ctx.dam.source ? ` («${esc(ctx.dam.source)}»)` : ''}. Escribe o elige la industria de cada activo; la βU se toma de la tabla (puedes cambiarla).` : ''}</p>${list ? '' : '<p class="hint">El archivo de betas de Damodaran (betaemerg.xls) también se puede subir en Datos → Renta fija junto con los demás documentos.</p>'}
      ${opts}
      <div class="table-scroll"><table class="data dam"><thead><tr><th>Activo</th><th class="n">β Sharpe (regresión) ± IC 95 %</th><th class="n">β ajustada de Blume</th><th>Industria (Damodaran)</th><th class="n">βU industria</th><th class="n">D/E</th><th class="n">Impuestos %</th><th class="n">β Damodaran βL</th><th class="n">βU implícita de la regresión</th><th class="n">Diferencia</th><th class="n">Kₑ con β Sharpe</th><th class="n">Kₑ con β Damodaran</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
      <p class="hint">D/E: deuda financiera total dividida por la capitalización bursátil (precio × acciones en circulación), de los estados financieros más recientes que publica cada emisor en la Superintendencia Financiera. La beta ajustada de Blume (1971), <code>0,67 β + 0,33</code>, acerca la beta de regresión a 1 porque las betas tienden a regresar a ese valor. Kₑ usa la tasa libre de riesgo y la prima de mercado de Datos (${pct(erp)})${crp ? ` más la prima por riesgo país (${pct(crp)})` : ''}.</p></div>`;
  }

  /* Documento autónomo (para guardar en la biblioteca o descargar). */
  function documentHTML(title, body) {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><meta name="author" content="Schrödinstein"><style>
body{font-family:'Times New Roman',Times,serif;max-width:1100px;margin:24px auto;padding:0 16px;color:#111722;background:#fff;line-height:1.5}
h1{font-size:1.8rem}h2{margin-top:28px;border-bottom:1px solid #ccd3dd;padding-bottom:4px}code{background:#eef1f5;padding:1px 4px;border-radius:3px}
table{border-collapse:collapse;font-size:.9rem;margin:8px 0}td,th{border:1px solid #d6dbe3;padding:3px 7px}td.n,th.n{text-align:right}.hl td{background:#eef3fb;font-weight:600}.hint,.sub{color:#465163;font-size:.92em}
.pos{color:#0a7a3a}.neg{color:#b42318}input,select,button,label.btn,datalist{display:none}.form{display:none}svg{max-width:420px}.gl{stroke:#e2e6ec}.tk{font-size:10px;fill:#7c8799}
</style></head><body><h1>${title}</h1><p class="sub">Frontera Eficiente · aplicación de Schrödinstein (la teoría y los modelos son de los autores citados) · generado el ${new Date().toISOString().slice(0, 10)}.</p>${body}</body></html>`;
  }

  PF.pasos = { NOMEN, render, pairCalc, parseDamodaran, suggestIndustry, relever, unlever, documentHTML };
})(typeof globalThis !== 'undefined' ? globalThis : this);
