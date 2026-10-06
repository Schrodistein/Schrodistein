/* Tasa libre de riesgo, rendimiento esperado anual del mercado, riesgo sistemático y no sistemático y
 * coeficiente de determinación R², calculados con los datos cargados (secciones 15 a 17 de «Paso a
 * paso») y candidatas a tasa libre de riesgo a partir de la renta fija de la biblioteca (Datos →
 * Renta fija). Los rendimientos son logarítmicos diarios y se anualizan con 242 ruedas. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const fin = Number.isFinite;
  const RUEDAS = 242;

  /* ---------- Tasa libre de riesgo a partir de la renta fija ---------- */
  const DAY = 864e5;
  const t = (d) => Date.parse(d.length === 7 ? d + '-01' : d);
  // Rendimiento efectivo anual de un índice de rendimiento total entre dos fechas (base 365 días)
  function annualFrom(dates, prices, back) {
    const last = prices.length - 1;
    if (last < 1) return null;
    let k = last;
    if (back) while (k > 0 && t(dates[last]) - t(dates[k - 1]) <= back * DAY) k--;
    else k = 0;
    const days = (t(dates[last]) - t(dates[k])) / DAY;
    if (days < 20 || !(prices[k] > 0)) return null;
    return { value: Math.pow(prices[last] / prices[k], 365 / days) - 1, from: dates[k], to: dates[last], days };
  }
  const FAMILY = [
    { re: /colibr|(^|\W)ibr(\W|$)/i, label: 'Mercado monetario (IBR)', plazo: 'Overnight, capitalizado a diario', use: 'Tasa libre de riesgo de corto plazo (1 año o menos): CAPM de un año, razón de Sharpe, renta fija segura del plan.' },
    { re: /gxtescol/i, label: 'ETF de TES en pesos (BVC)', plazo: 'Canasta de TES', use: 'Rendimiento realizado de un portafolio de TES que cotiza en la BVC; sirve como referencia de renta fija mientras cargas el COLTES o las tasas cero cupón.' },
    { re: /coltes\s*cp/i, label: 'TES tasa fija en pesos de 1 a 5 años', plazo: '1 a 5 años', use: 'Referencia de mediano plazo; su rendimiento realizado incluye el efecto precio por duración.' },
    { re: /coltes\s*lp/i, label: 'TES tasa fija en pesos de más de 5 años', plazo: 'Más de 5 años', use: 'Índice del segmento de renta fija (β de TES y bonos). Para valorar acciones a largo plazo se usa la TIR del TES de 10 años, no este rendimiento realizado.' },
    { re: /coltes\s*uvr/i, label: 'TES en UVR (tasa real)', plazo: 'Más de 1 año', use: 'Tasa libre de riesgo real (descontada la inflación).' },
    { re: /coltes/i, label: 'TES tasa fija en pesos', plazo: 'Toda la curva', use: 'Referencia general de la renta fija pública.' },
  ];
  /* Candidatas con las series de la biblioteca: índices (rendimiento realizado) y tasas (TIR). */
  function rfCandidates(series) {
    const out = [];
    for (const s of series || []) {
      if (!s || !s.dates || s.dates.length < 3) continue;
      // Series en dólares o de inflación (Tesoro de EE. UU., T10YIE, EMBIG): no son tasas libres de riesgo en pesos
      if (s.role && /^(ust|infl|embi)/.test(s.role)) continue;
      if (s.kind === 'tasa') {
        // Al pasar por la biblioteca, prices es el índice de rendimiento total y rates la tasa original
        const y = s.rates || s.prices;
        const k = y.length - 1;
        const last20 = y.slice(-20).filter(fin);
        out.push({
          name: s.name,
          tipo: /cero cup/i.test(s.name) ? `Tasa cero cupón ${/uvr/i.test(s.name) ? 'real (UVR)' : 'en pesos'} · Banco de la República` : 'Tasa negociada (TIR)',
          plazo: /cero cup/i.test(s.name) && fin(s.dur) ? `${s.dur} año${s.dur === 1 ? '' : 's'}` : fin(s.dur) ? `Duración ≈ ${String(Math.round(s.dur * 10) / 10).replace('.', ',')} años` : '—',
          value: y[k],
          avg: last20.length ? last20.reduce((q, x) => q + x, 0) / last20.length : NaN,
          date: s.dates[k],
          note: /uvr/i.test(s.name)
            ? 'Tasa real (sobre la inflación, en UVR): la tasa libre de riesgo real a ese plazo. No se usa como rf nominal; sirve para ver la inflación esperada: (1 + tasa en pesos) / (1 + tasa UVR) − 1.'
            : /cero cup/i.test(s.name)
              ? 'Tasa cero cupón del Banco de la República (Nelson y Siegel): la tasa libre de riesgo en pesos a ese plazo.'
              : 'Es la tasa a la que se negocia hoy el título: la referencia correcta de tasa libre de riesgo a ese plazo.',
          pri: /uvr/i.test(s.name) ? 1.5 : /tes|tfit|tfu|tco/i.test(s.name) ? 0 : 2,
          dur: s.dur,
          role: s.role,
        });
        continue;
      }
      const fam = FAMILY.find((f) => f.re.test(s.name));
      if (!fam) continue;
      const y1 = annualFrom(s.dates, s.prices, 365);
      const all = annualFrom(s.dates, s.prices, 0);
      if (!y1 && !all) continue;
      out.push({
        name: s.name,
        tipo: `Índice BVC · ${fam.label}`,
        plazo: fam.plazo,
        value: y1 ? y1.value : all.value,
        avg: all ? all.value : NaN,
        date: (y1 || all).to,
        from: (y1 || all).from,
        note: fam.use,
        pri: /colibr|ibr/i.test(s.name) ? 1 : 3,
      });
    }
    return out.sort((a, b) => a.pri - b.pri || (a.dur || 0) - (b.dur || 0) || a.name.localeCompare(b.name));
  }
  /* ---------- Documentos de Damodaran (no son series diarias: datos de referencia) ---------- */
  const pctNum = (v) => {
    if (typeof v === 'number') return v;
    const t = String(v == null ? '' : v).trim();
    if (!t || /^n\/?a$/i.test(t)) return NaN;
    const x = parseFloat(t.replace('%', '').replace(',', '.'));
    return /%/.test(t) ? x / 100 : x;
  };
  /* «Country Default Spreads and Risk Premiums» (ctryprem): fila de un país y la prima madura implícita. */
  function parseCountryRisk(rows, country) {
    const low = (x) => String(x == null ? '' : x).toLowerCase().trim();
    const hr = rows.findIndex((r) => r && r.some((c) => low(c) === 'country') && r.some((c) => /country risk premium/i.test(String(c))));
    if (hr < 0) return null;
    const h = rows[hr].map(low);
    const col = (re) => h.findIndex((x) => re.test(x));
    const ci = { country: col(/^country$/), rating: col(/rating/), spread: col(/default spread/), crp: col(/country risk premium/), erp: col(/^equity risk premium/), tax: col(/tax/), cds: col(/^sovereign+ cds/), erpCds: col(/erp based on/) };
    const want = country || 'Colombia';
    const row = rows.slice(hr + 1).find((r) => r && low(r[ci.country]) === want.toLowerCase());
    if (!row) return null;
    const g = (k) => (ci[k] >= 0 ? pctNum(row[ci[k]]) : NaN);
    const out = { country: want, rating: ci.rating >= 0 ? String(row[ci.rating]).trim() : '', spread: g('spread'), crp: g('crp'), erp: g('erp'), tax: g('tax'), cds: g('cds'), erpCds: g('erpCds') };
    // Prima de un mercado maduro: la de un país Aaa (CRP = 0), o ERP − CRP de Colombia
    const aaa = rows.slice(hr + 1).find((r) => r && /^aaa$/i.test(String(r[ci.rating]).trim()) && pctNum(r[ci.crp]) === 0);
    out.mature = aaa ? pctNum(aaa[ci.erp]) : out.erp - out.crp;
    out.ratio = out.spread > 0 ? out.crp / out.spread : NaN; // σ acciones / σ bonos que usa Damodaran
    return out;
  }
  /* «Implied ERP» (histimpl): prima implícita del S&P 500 por año (FCFE) y la tasa del Tesoro. */
  function parseImpliedErp(rows) {
    const hr = rows.findIndex((r) => r && /^year$/i.test(String(r[0]).trim()) && r.some((c) => /implied (erp|premium)/i.test(String(c))));
    if (hr < 0) return null;
    const h = rows[hr].map((x) => String(x).toLowerCase());
    const ci = h.findIndex((x) => /^implied erp \(fcfe\)$/.test(x.trim()));
    const ddm = h.findIndex((x) => /implied premium \(ddm\)/.test(x));
    const tb = h.findIndex((x) => /t\.?bond rate/.test(x));
    const k = ci >= 0 ? ci : ddm;
    const series = rows
      .slice(hr + 1)
      .filter((r) => r && Number.isInteger(+r[0]) && +r[0] > 1900 && fin(+r[k]) && r[k] !== '')
      .map((r) => ({ year: +r[0], erp: +r[k], tbond: tb >= 0 ? +r[tb] : NaN }));
    if (!series.length) return null;
    const last = series[series.length - 1];
    return { year: last.year, erp: last.erp, tbond: last.tbond, method: ci >= 0 ? 'FCFE (dividendos + recompras)' : 'DDM', series };
  }
  /* Busca en las hojas de un libro un documento de referencia de Damodaran. */
  function readReference(sheets, fileName) {
    for (const rows of sheets) {
      const c = parseCountryRisk(rows);
      if (c) return { kind: 'ctryprem', file: fileName, data: c };
      const i = parseImpliedErp(rows);
      if (i) return { kind: 'implied', file: fileName, data: i };
    }
    // Betas por industria de Damodaran (betaemerg.xls, betaGlobal.xls…): para la beta de Damodaran (Paso a paso 7)
    if (PF.pasos && PF.pasos.parseDamodaran) {
      for (const rows of sheets) {
        try {
          return { kind: 'betas', file: fileName, data: { list: PF.pasos.parseDamodaran(rows) } };
        } catch (e) {
          /* otra hoja */
        }
      }
    }
    return null;
  }

  /* rf en pesos a partir de la tasa en dólares (paridad de Fisher). */
  const fisher = (rUsd, piCol, piUs) => ((1 + rUsd) * (1 + piCol)) / (1 + piUs) - 1;
  /* rf de Damodaran: tasa del bono local menos el diferencial por riesgo de impago del país. */
  const damodaranRf = (yLocal, spread) => yLocal - spread;
  /* Tasa diaria equivalente para rendimientos logarítmicos con 242 ruedas. */
  const dailyLog = (rf) => Math.log(1 + rf) / RUEDAS;

  /* ---------- Prima de riesgo del mercado (PRM) y prima por riesgo país (PRP) ----------
   * inp (en %, salvo embi en puntos básicos y ratio en veces): tes10, ust10, picol, pius, embi, ratio, erp */
  function premiums(inp, ctx) {
    const P = (k) => (inp && inp[k] !== '' && inp[k] != null && fin(+inp[k]) ? +inp[k] / 100 : NaN);
    const tes10 = P('tes10');
    const ust10 = P('ust10');
    const picol = P('picol');
    const pius = P('pius');
    const erpM = P('erp');
    const embi = inp && fin(+inp.embi) && inp.embi !== '' ? +inp.embi / 10000 : NaN;
    const ratioIn = inp && fin(+inp.ratio) && inp.ratio !== '' ? +inp.ratio : NaN;
    const ratio = fin(ratioIn) ? ratioIn : ctx && fin(ctx.volRatio) ? ctx.volRatio : 1.5;
    const rfUsdInCop = fin(ust10) && fin(picol) && fin(pius) ? fisher(ust10, picol, pius) : NaN;
    const implicit = fin(tes10) && fin(rfUsdInCop) ? tes10 - rfUsdInCop : NaN; // diferencial del TES sobre el Tesoro llevado a pesos
    const spread = fin(embi) ? embi : implicit;
    const prp = fin(spread) ? spread * ratio : NaN;
    const rfLocal = fin(tes10) && fin(spread) ? damodaranRf(tes10, spread) : NaN;
    const rf = ctx && fin(ctx.rf) ? ctx.rf : NaN;
    // E(Rₘ) en pesos (Damodaran): sobre la rf local sin riesgo de impago si se conoce; si no, la rf en uso
    const rfBase = fin(rfLocal) ? rfLocal : rf;
    const em = fin(rfBase) && fin(erpM) ? rfBase + erpM + (fin(prp) ? prp : 0) : NaN;
    return { rfBase, rfBaseSrc: fin(rfLocal) ? 'local' : 'uso', tes10, ust10, picol, pius, erpM, embi, ratio, ratioFromData: !fin(ratioIn) && ctx && fin(ctx.volRatio), rfUsdInCop, implicit, spread, spreadSrc: fin(embi) ? 'EMBI' : fin(implicit) ? 'TES' : '', prp, rfLocal, em };
  }

  /* ---------- Paso a paso: secciones 15 a 18 ---------- */
  function render(ctx) {
    const { m, table, esc, pct } = ctx;
    if (!m || !table) return '';
    const f = m.f;
    const nf = (x, d = 4) => PF.data.fmtNum(x, d);
    const ix = (name) => table.names.indexOf(name);
    const R = PF.data.toReturns(table.values, ctx.kind === 'returns' ? 'returns' : 'prices', ctx.retType !== 'simple');
    const mk = m.marketName;
    const rM = (R[ix(mk)] || []).filter(fin);
    const out = [];

    // 15. Rendimiento esperado anual del mercado
    if (rM.length >= 6) {
      const n = rM.length;
      const mean = rM.reduce((q, x) => q + x, 0) / n;
      const v = rM.reduce((q, x) => q + (x - mean) ** 2, 0) / (n - 1);
      const muLn = mean * f;
      const s2 = v * f;
      const geo = Math.exp(muLn) - 1;
      const arit = Math.exp(muLn + s2 / 2) - 1;
      const years = n / f;
      const se = Math.sqrt(s2) / Math.sqrt(years);
      const lo = muLn - 1.96 * se;
      const hi = muLn + 1.96 * se;
      const crp = ctx.crp || 0;
      const erpHist = muLn - m.rf;
      const infl = ctx.inflation;
      const btn = (x, label) => (fin(x) ? `<button type="button" class="btn btn-ghost" data-use-em="${(Math.round(x * 10000) / 100).toFixed(2)}">${label || 'Usar en Supuestos'}</button>` : '');
      const vals = table.values[ix(mk)].filter(fin);
      out.push(`<div class="panel" id="paso-erm"><h2>15. Rendimiento esperado anual del mercado E(Rₘ)</h2>
        <p><b>E(Rₘ)</b> es lo que se espera que rinda en un año el portafolio de mercado, que en Colombia representa el <b>${esc(mk)}</b>. Es el punto de partida del CAPM (<code>E(Rᵢ) = rf + βᵢ [E(Rₘ) − rf]</code>), del α de Jensen, de la razón de Treynor del mercado y de la pendiente de la línea del mercado de valores. No se observa: se estima, y hay dos caminos.</p>
        <h3>a) Histórico: la media de los rendimientos diarios, anualizada</h3>
        <ol>
          <li>Rendimiento de cada rueda: <code>rₜ = ln(Pₜ / Pₜ₋₁)</code>. Con tus datos hay <b>${n.toLocaleString('es-CO')}</b> rendimientos diarios del ${esc(mk)} (${nf(years, 2)} años de ${f} ruedas).</li>
          <li>Media diaria: <code>r̄ = Σ rₜ / n</code> = <b>${nf(mean, 6)}</b>; varianza diaria <code>s² = Σ (rₜ − r̄)² / (n − 1)</code> = ${nf(v, 8)}.</li>
          <li>Anualizar: los rendimientos logarítmicos se suman en el tiempo, así que <code>μ = r̄ × ${f}</code> = <b>${pct(muLn, 2)}</b> continuo anual y <code>σ² = s² × ${f}</code> = ${nf(s2, 6)} (σ = ${pct(Math.sqrt(s2), 2)}).</li>
          <li>Pasar a tasa efectiva anual (lo que de verdad creció un peso invertido): <code>e<sup>μ</sup> − 1</code> = <b>${pct(geo, 2)}</b>. Es igual a la tasa compuesta del periodo, <code>(P<sub>T</sub> / P₀)<sup>${f}/n</sup> − 1</code>, con P₀ = ${nf(vals[0], 2)} y P<sub>T</sub> = ${nf(vals[vals.length - 1], 2)}.</li>
          <li>Media aritmética esperada (si los rendimientos son lognormales): <code>e<sup>μ + σ²/2</sup> − 1</code> = <b>${pct(arit, 2)}</b>. Es mayor que la geométrica por la volatilidad; la diferencia ≈ σ²/2.</li>
          <li>Precisión: el error estándar de μ es <code>σ / √años</code> = ${pct(se, 2)}, así que con 95 % de confianza μ está entre <b>${pct(lo, 1)}</b> y <b>${pct(hi, 1)}</b>. Con pocos años el intervalo es muy ancho: la media histórica es el dato con más error de toda la teoría (Merton, 1980).</li>
        </ol>
        <p class="row-btns">${btn(muLn, `Usar μ = ${pct(muLn, 2)}`)} ${btn(geo, `Usar efectiva ${pct(geo, 2)}`)}</p>
        <h3>b) Prospectivo: tasa libre de riesgo + prima de riesgo del mercado</h3>
        <p class="formula"><code>E(Rₘ) = rf + PRM + PRP</code></p>
        <ul class="sym"><li><code>rf</code>: tasa libre de riesgo en pesos (Datos → Renta fija): hoy ${pct(m.rf, 2)}.</li><li><code>PRM</code>: prima de riesgo de un mercado maduro. Histórica (Ibbotson; Dimson, Marsh y Staunton) o implícita en los precios de hoy (Damodaran, «Implied ERP», del S&amp;P 500).</li><li><code>PRP</code>: prima por riesgo país de Colombia (Damodaran, tabla «ctryprem»; o el diferencial EMBI × σ acciones / σ bonos). En la app: ${pct(crp, 2)} (Paso a paso → sección 7).</li></ul>
        <p>Con tus datos, la prima histórica del ${esc(mk)} sobre la rf es <code>μ − rf</code> = ${pct(muLn, 2)} − ${pct(m.rf, 2)} = <b>${pct(erpHist, 2)}</b>. Si es negativa o muy baja (un periodo de caída del mercado), no sirve como expectativa: la teoría exige <code>E(Rₘ) &gt; rf</code>, y se usa la prima implícita.</p>
        <p class="hint"><b>Modelo de Gordon (1959)</b>, otra vía prospectiva: <code>E(Rₘ) = D₁ / P₀ + g</code>, el rendimiento por dividendo del índice más el crecimiento esperado de los dividendos (≈ crecimiento nominal del PIB a largo plazo). <b>Fisher (1930)</b>: para pasarlo a términos reales, <code>(1 + E(Rₘ)) / (1 + π) − 1</code>${fin(infl) ? `; con la inflación anual más reciente (${pct(infl, 2)}), la media efectiva histórica equivale a <b>${pct((1 + geo) / (1 + infl) - 1, 2)}</b> real` : ''}.</p>
        <p>En uso ahora: <b>E(Rₘ) = ${pct(m.Em, 2)}</b> ${Math.abs(m.Em - m.mktHist) < 1e-9 ? '(la media histórica anual, porque el campo de Supuestos está vacío)' : '(el valor escrito en Supuestos)'}. Los botones de arriba lo pasan a Supuestos.</p>
      </div>`);
    }

    // 16. Riesgo sistemático y no sistemático
    const vm = m.mktVol * m.mktVol;
    const rows = m.assets.map((a) => {
      const tot = a.histVol * a.histVol;
      const sys = a.betaM * a.betaM * vm;
      const r2 = fin(a.r2M) ? a.r2M : sys / tot;
      const unsys = Math.max(0, a.residVarM);
      const rho = Math.sign(a.betaM) * Math.sqrt(Math.max(0, r2));
      const totalBeta = Math.abs(rho) > 1e-6 ? a.betaM / rho : NaN;
      return { a, tot, sys, unsys, r2, totalBeta };
    });
    const e = ctx.P && ctx.P.recommended;
    let port = '';
    if (e) {
      const bp = m.assets.reduce((q, a, i) => q + e.w[i] * a.betaM, 0);
      const vp = e.vol * e.vol;
      const sp = bp * bp * vm;
      const up = m.assets.reduce((q, a, i) => q + e.w[i] * e.w[i] * a.residVarM, 0);
      const wavgUns = m.assets.reduce((q, a, i) => q + e.w[i] * a.residVarM, 0);
      port = `<h3>El portafolio recomendado</h3>
        <p class="formula"><code>σₚ² ≈ βₚ² σₘ² + Σ wᵢ² σ²(εᵢ)</code> → βₚ = Σ wᵢ βᵢ = <b>${nf(bp, 3)}</b>; sistemático βₚ² σₘ² = ${nf(sp, 6)}; no sistemático Σ wᵢ² σ²(εᵢ) = ${nf(up, 6)}; varianza del portafolio σₚ² = ${nf(vp, 6)}.</p>
        <p>El riesgo propio de cada acción entra al portafolio multiplicado por <code>wᵢ²</code>, no por <code>wᵢ</code>: con pesos pequeños casi desaparece. Si se sumaran sin diversificar (Σ wᵢ σ²(εᵢ)) serían ${nf(wavgUns, 6)}; en el portafolio quedan ${nf(up, 6)}, el <b>${pct(wavgUns > 0 ? 1 - up / wavgUns : NaN, 1)}</b> menos. Lo que no se puede quitar es βₚ² σₘ²: el riesgo del mercado.</p>`;
    }
    // Curva de diversificación con pesos iguales (Evans y Archer, 1968)
    const N = m.names.length;
    let sv = 0;
    let sc = 0;
    let nc = 0;
    for (let i = 0; i < N; i++) {
      sv += m.Sigma[i][i];
      for (let j = 0; j < N; j++) if (i !== j) {
        sc += m.Sigma[i][j];
        nc++;
      }
    }
    const varBar = sv / N;
    const covBar = nc ? sc / nc : 0;
    const curve = [1, 2, 3, 5, 10, 15, 20, 30, 50, 100].filter((k, idx, arr) => k <= Math.max(N, 30) || idx === arr.length - 1).map((k) => [k, varBar / k + (1 - 1 / k) * covBar]);
    out.push(`<div class="panel" id="paso-riesgo"><h2>16. Riesgo sistemático y riesgo no sistemático</h2>
      <p><b>Definición.</b> El <b>riesgo total</b> de un activo, su varianza σᵢ², tiene dos partes:</p>
      <ul>
        <li><b>Riesgo sistemático</b> (de mercado, no diversificable): el que viene de lo que mueve a toda la economía al tiempo: tasas de interés del Banco de la República, inflación, crecimiento del PIB, TRM, precio del petróleo, riesgo político o fiscal. Afecta a todas las acciones en mayor o menor medida, y por eso no se elimina combinándolas. Se mide con la <b>β</b>.</li>
        <li><b>Riesgo no sistemático</b> (propio, específico o idiosincrático, diversificable): el que solo afecta a una empresa o sector: un resultado trimestral, un cambio de administración, una demanda, un accidente en una planta. Como lo que le pasa a una empresa no le pasa a las demás, en un portafolio esos choques se compensan. Se mide con la varianza del residuo <b>σ²(ε)</b>.</li>
      </ul>
      <p><b>Teoría y cálculo.</b> Del modelo de índice único de <b>Sharpe (1963)</b>, <code>rᵢ = αᵢ + βᵢ rₘ + εᵢ</code>, con εᵢ sin correlación con el mercado, la varianza se separa exactamente:</p>
      <p class="formula"><code>σᵢ² = βᵢ² σₘ² + σ²(εᵢ)</code> &nbsp;·&nbsp; <code>βᵢ = Cov(rᵢ, rₘ) / σₘ²</code> &nbsp;·&nbsp; <code>R²ᵢ = βᵢ² σₘ² / σᵢ²</code></p>
      <ul class="sym"><li><code>βᵢ² σₘ²</code>: riesgo sistemático (la parte de la varianza que explica el mercado).</li><li><code>σ²(εᵢ)</code>: riesgo no sistemático, la varianza de los residuos de la regresión.</li><li><code>R²</code>: fracción sistemática del riesgo total; <code>1 − R²</code> es la fracción no sistemática (sección 17).</li><li>Mercado de referencia: ${esc(mk)}, σₘ anual = ${pct(m.mktVol, 2)}, σₘ² = ${nf(vm, 6)}.</li></ul>
      <div class="table-scroll"><table class="data"><thead><tr><th>Activo</th><th class="n">β</th><th class="n">σ total</th><th class="n">σ² total</th><th class="n">Sistemático β²σₘ²</th><th class="n">No sistemático σ²(ε)</th><th class="n">% sistemático (R²)</th><th class="n">% no sistemático</th><th class="n">σ(ε)</th><th class="n">β total (Damodaran)</th></tr></thead><tbody>${rows
        .map((r) => `<tr><td>${esc(r.a.name)}</td><td class="n">${nf(r.a.betaM, 3)}</td><td class="n">${pct(r.a.histVol, 2)}</td><td class="n">${nf(r.tot, 6)}</td><td class="n">${nf(r.sys, 6)}</td><td class="n">${nf(r.unsys, 6)}</td><td class="n"><b>${pct(r.r2, 1)}</b></td><td class="n">${pct(1 - r.r2, 1)}</td><td class="n">${pct(Math.sqrt(r.unsys), 2)}</td><td class="n">${nf(r.totalBeta, 2)}</td></tr>`)
        .join('')}</tbody></table></div>
      <p class="hint">Valores anuales (× ${f} ruedas). La suma de sistemático y no sistemático es igual a la varianza total, salvo diferencias por las fechas que cada activo comparte con el índice.</p>
      <h3>Por qué la diversificación solo quita una parte (Evans y Archer, 1968)</h3>
      <p>Con N activos en partes iguales: <code>σₚ² = σ̄² / N + (1 − 1/N) · cov̄</code>. Con tus datos, la varianza promedio es σ̄² = ${nf(varBar, 6)} y la covarianza promedio cov̄ = ${nf(covBar, 6)}. El primer término (riesgo propio) cae con N; el segundo (riesgo común) no: el riesgo tiende a <code>√cov̄</code> = ${pct(Math.sqrt(Math.max(0, covBar)), 2)} y nunca baja de ahí.</p>
      <div class="table-scroll"><table class="data"><thead><tr><th class="n">N activos</th>${curve.map((c) => `<th class="n">${c[0]}</th>`).join('')}</tr></thead><tbody><tr><td>σₚ</td>${curve.map((c) => `<td class="n">${pct(Math.sqrt(Math.max(0, c[1])), 1)}</td>`).join('')}</tr></tbody></table></div>
      ${port}
      <h3>De aquí salen las betas y las medidas de desempeño</h3>
      <div class="table-scroll"><table class="data"><thead><tr><th>Medida</th><th>Fórmula</th><th>Qué riesgo usa</th><th>Cuándo es la correcta</th></tr></thead><tbody>
        <tr><td><b>β de Sharpe</b> (1963, 1964)</td><td><code>Cov(rᵢ, rₘ) / σₘ²</code></td><td>Solo el sistemático</td><td>Es la medida de riesgo del CAPM: en equilibrio el mercado solo paga el riesgo que no se puede diversificar.</td></tr>
        <tr><td><b>Razón de Sharpe</b> (1966)</td><td><code>(E(R) − rf) / σ</code></td><td>Total (sistemático + no sistemático)</td><td>Cuando el portafolio es <i>toda</i> la inversión: el inversionista soporta también el riesgo propio que no diversificó.</td></tr>
        <tr><td><b>Razón de Treynor</b> (1965)</td><td><code>(E(R) − rf) / β</code></td><td>Solo el sistemático</td><td>Cuando el activo o fondo es una parte de un portafolio ya diversificado, donde el riesgo propio desaparece.</td></tr>
        <tr><td><b>α de Jensen</b> (1968)</td><td><code>E(R) − [rf + β (E(Rₘ) − rf)]</code></td><td>Mide contra la línea del mercado de valores, que solo remunera β</td><td>Rendimiento por encima de lo que exige el riesgo sistemático.</td></tr>
        <tr><td><b>Razón de valoración</b> (Treynor y Black, 1973)</td><td><code>α / σ(ε)</code></td><td>Solo el no sistemático</td><td>Cuánto α se gana por cada unidad de riesgo propio que se acepta al sobreponderar un activo.</td></tr>
        <tr><td><b>β de Damodaran</b> (de abajo hacia arriba)</td><td><code>βL = βU [1 + (1 − t) D/E]</code></td><td>Sistemático del negocio (βU) + riesgo financiero de la deuda</td><td>Estima la β sistemática con el sector y la estructura de capital, en lugar de con la regresión, que tiene error.</td></tr>
        <tr><td><b>β total</b> (Damodaran)</td><td><code>β / ρᵢₘ = β / √R²</code></td><td>Total, en unidades de β</td><td>Para un dueño no diversificado (una sola empresa): carga también el riesgo propio. Última columna de la tabla.</td></tr>
      </tbody></table></div>
    </div>`);

    // 17. R²
    const A = m.names[ctx.a] || m.names[0];
    const rA = R[ix(A)];
    const rMk = R[ix(mk)];
    let sec17 = '';
    if (rA && rMk) {
      const pc = PF.pasos.pairCalc(rA, rMk);
      const reg = PF.stats.regress(pc.a, pc.b);
      const n = pc.n;
      const yhat = pc.b.map((x) => reg.alpha + reg.beta * x);
      const sst = pc.sqa;
      const ssr = yhat.reduce((q, y) => q + (y - pc.ma) ** 2, 0);
      const sse = pc.a.reduce((q, y, k) => q + (y - yhat[k]) ** 2, 0);
      const r2 = sst > 0 ? 1 - sse / sst : NaN;
      const r2adj = 1 - ((1 - r2) * (n - 1)) / (n - 2);
      const F = (r2 / (1 - r2)) * (n - 2);
      const tB = reg.seBeta > 0 ? reg.beta / reg.seBeta : NaN;
      const p = PF.stats.pValue(tB, n - 2);
      const see = Math.sqrt(sse / (n - 2));
      const macro = ctx.macroRel || {};
      const V = (PF.macro && PF.macro.VARS) || {};
      const mrows = Object.entries(macro).filter(([, r]) => r && r.ok);
      sec17 = `<div class="panel" id="paso-r2"><h2>17. Coeficiente de determinación R²</h2>
        <p><b>Qué es.</b> En una regresión <code>y = a + b·x + ε</code>, el R² es la proporción de la variación de <code>y</code> que explica <code>x</code>. Viene de descomponer la suma de cuadrados total (<b>Fisher</b>, análisis de varianza, 1925; el coeficiente de correlación es de <b>Pearson</b>, 1896):</p>
        <p class="formula"><code>SST = Σ (yₜ − ȳ)²</code> = <code>SSR = Σ (ŷₜ − ȳ)²</code> + <code>SSE = Σ (yₜ − ŷₜ)²</code> &nbsp;→&nbsp; <code>R² = SSR / SST = 1 − SSE / SST</code></p>
        <ul class="sym"><li><code>SST</code>: variación total de y alrededor de su media.</li><li><code>SSR</code>: la parte explicada por la recta (en el modelo de mercado, el riesgo sistemático).</li><li><code>SSE</code>: la parte no explicada, la de los residuos ε (el riesgo no sistemático). El error estándar de la estimación es <code>√(SSE / (n − 2))</code>.</li><li>Con una sola variable explicativa, <code>R² = ρ²</code>: el cuadrado de la correlación. R² va de 0 (x no explica nada) a 1 (explica todo); a diferencia de ρ, no dice el signo de la relación.</li></ul>
        <h3>Con tus datos: ${esc(A)} frente al ${esc(mk)}</h3>
        <div class="table-scroll"><table class="data"><tbody>
          <tr><td>Periodos (n)</td><td class="n">${n}</td></tr>
          <tr><td>Recta estimada</td><td class="n">r̂ = ${nf(reg.alpha, 6)} + ${nf(reg.beta, 4)} · rₘ</td></tr>
          <tr><td>SST (total)</td><td class="n">${nf(sst, 8)}</td></tr>
          <tr><td>SSR (explicada por el mercado: sistemática)</td><td class="n">${nf(ssr, 8)}</td></tr>
          <tr><td>SSE (residual: no sistemática)</td><td class="n">${nf(sse, 8)}</td></tr>
          <tr class="hl"><td><b>R² = SSR / SST</b></td><td class="n"><b>${nf(r2, 4)}</b> (${pct(r2, 1)} del riesgo de ${esc(A)} es sistemático)</td></tr>
          <tr><td>ρ² (comprobación)</td><td class="n">${nf(pc.corr * pc.corr, 4)}</td></tr>
          <tr><td>R² ajustado = 1 − (1 − R²)(n − 1)/(n − k − 1), k = 1</td><td class="n">${nf(r2adj, 4)}</td></tr>
          <tr><td>Error estándar de la estimación √(SSE/(n − 2)) diario · anual</td><td class="n">${nf(see, 6)} · ${pct(see * Math.sqrt(f), 2)}</td></tr>
          <tr><td>Estadístico F = [R² / (1 − R²)] (n − 2)</td><td class="n">${nf(F, 2)}</td></tr>
          <tr><td>t de β (t² = F) y valor p</td><td class="n">${nf(tB, 2)} · ${p < 0.0001 ? 'p &lt; 0,0001' : 'p = ' + nf(p, 4)}</td></tr>
        </tbody></table></div>
        <p><b>Cómo se lee.</b> Un R² alto (acciones grandes del índice, como las de mayor peso en el ${esc(mk)}) quiere decir que el activo se mueve sobre todo con el mercado: su β es confiable y diversificar con él ayuda poco frente al índice. Un R² bajo dice que domina el riesgo propio: la β estimada tiene más error y ese riesgo sí se puede diversificar. En acciones individuales con datos diarios son normales R² de 0,1 a 0,5.</p>
        <p><b>El R² y el error.</b> El residuo ε es la parte que el mercado no explica. En el modelo de mercado se le llama riesgo <i>no sistemático</i> (o error aleatorio), y el término <code>β·rₘ</code> es la parte sistemática. En estadística, «error sistemático» es otra cosa: un sesgo que se repite siempre en el mismo sentido (por ejemplo, fechas corridas o precios sin ajustar por dividendos). Un R² muy bajo o residuos con patrón pueden señalarlo. Por eso la app revisa los desfases de fechas al cargar los datos.</p>
        <h3>R² de las variables macroeconómicas con el ${esc(mk)}</h3>
        <p>Para cada variable se regresa el rendimiento del índice sobre el cambio de la variable en el mismo periodo (mensual o trimestral): <code>rₘ,ₜ = a + b · Δxₜ + εₜ</code>. Se usan <i>cambios</i>, no niveles: dos series con tendencia dan R² altos sin relación real (regresión espuria, Granger y Newbold, 1974). Es la idea del modelo de factores macroeconómicos de <b>Chen, Roll y Ross (1986)</b>, derivado de la teoría de valoración por arbitraje de <b>Ross (1976)</b>: el riesgo sistemático tiene varias fuentes, y el R² de cada factor dice cuánto del movimiento del mercado le corresponde.</p>
        ${mrows.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>Variable</th><th class="n">Periodos</th><th class="n">ρ</th><th class="n">R²</th><th class="n">R² ajustado</th><th class="n">b</th><th class="n">t</th><th class="n">Valor p</th><th>Lectura</th></tr></thead><tbody>${mrows
          .map(([k, r]) => {
            const lk = PF.stats.likert(r.corr);
            const adj = 1 - ((1 - r.r2) * (r.n - 1)) / (r.n - 2);
            return `<tr><td>${esc((V[k] && V[k].label) || k)}</td><td class="n">${r.n}</td><td class="n" style="background:${lk.color};color:${lk.text}">${nf(r.corr, 3)}</td><td class="n"><b>${nf(r.r2, 3)}</b></td><td class="n">${nf(adj, 3)}</td><td class="n">${nf(r.b, 4)}</td><td class="n">${nf(r.t, 2)}</td><td class="n">${fin(r.p) ? nf(r.p, 3) : '—'}</td><td>${r.p < 0.05 ? `Significativa: explica ${pct(r.r2, 0)} de la variación del índice` : 'No significativa al 5 %: con estos datos no se distingue de cero'}</td></tr>`;
          })
          .join('')}</tbody></table></div>
        <p class="hint">Un R² macro bajo no quiere decir que la variable no importe: los precios se anticipan a las cifras (se mueven con lo esperado, no con el dato publicado), y con pocos trimestres el estimador tiene mucho error. La sección Macro muestra además si la variable adelanta o rezaga al mercado.</p>` : '<p class="hint">Carga las variables macro (sección Macro) para ver su R² con el índice.</p>'}
      </div>`;
    }
    out.push(sec17);
    out.push(premiumSection(ctx, nf));
    out.push(deSection(ctx, nf));
    return out.join('');
  }

  /* Datos que entran al cálculo, con su fuente y fecha. */
  const LABELS = {
    tes10: ['TES en pesos a 10 años (cero cupón)', '%'],
    ust10: ['Tesoro de EE. UU. a 10 años', '%'],
    picol: ['Inflación esperada de Colombia', '%'],
    pius: ['Inflación esperada de EE. UU.', '%'],
    embi: ['EMBIG Colombia (riesgo país)', 'pb'],
    ratio: ['σ acciones / σ bonos', 'veces'],
    erp: ['Prima de un mercado maduro (PRM)', '%'],
  };
  function sourcesHTML(ctx, pa) {
    const { esc } = ctx;
    const nf = (x, d) => PF.data.fmtNum(x, d);
    const rows = Object.keys(LABELS).map((k) => {
      const u = pa.used && pa.used[k];
      const [lab, unit] = LABELS[k];
      return `<tr><td>${lab}</td><td class="n"><b>${u ? nf(u.v, unit === 'pb' ? 0 : 2) + ' ' + unit : '—'}</b></td><td>${u ? esc(u.from) : '<span class="neg">Falta: carga el archivo o escríbelo arriba</span>'}</td><td>${u && u.date ? esc(u.date) : ''}</td></tr>`;
    });
    return `<h3>Datos usados</h3><div class="hscroll"><table class="data wrap"><thead><tr><th>Dato</th><th class="n">Valor</th><th>Fuente</th><th>Fecha</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  }
  /* Comparación con la tabla de Damodaran (prima por calificación y por CDS). */
  function damodaranHTML(ctx, D, q) {
    const c = D && D.ctryprem;
    if (!c) return '';
    const { pct, esc } = ctx;
    return `<h3>Comparación con Damodaran (${esc(c.file || 'ctryprem')})</h3>
      <div class="hscroll"><table class="data wrap"><thead><tr><th>Medida</th><th class="n">Damodaran</th><th class="n">Con tus datos</th><th>Cómo se obtiene</th></tr></thead><tbody>
        <tr><td>Calificación de Moody's</td><td class="n">${esc(c.rating)}</td><td class="n">—</td><td>Riesgo de impago del Estado colombiano según la calificadora.</td></tr>
        <tr><td>Diferencial por impago</td><td class="n">${pct(c.spread, 2)}</td><td class="n">${pct(q.spread, 2)}</td><td>Damodaran: diferencial típico de los países con la misma calificación. Tus datos: ${q.spreadSrc === 'EMBI' ? 'EMBIG Colombia (J.P. Morgan)' : 'TES 10 años menos el Tesoro llevado a pesos'}.</td></tr>
        <tr><td>Prima por riesgo país (PRP)</td><td class="n"><b>${pct(c.crp, 2)}</b></td><td class="n"><b>${pct(q.prp, 2)}</b></td><td>Diferencial × σ acciones / σ bonos.</td></tr>
        <tr><td>Prima total de Colombia (PRM + PRP)</td><td class="n">${pct(c.erp, 2)}</td><td class="n">${pct(fin(q.erpM) && fin(q.prp) ? q.erpM + q.prp : NaN, 2)}</td><td>Prima de un mercado maduro más la prima por riesgo país.</td></tr>
        <tr><td>CDS soberano y prima total con CDS</td><td class="n">${pct(c.cds, 2)} · ${pct(c.erpCds, 2)}</td><td class="n">—</td><td>Otra medida del riesgo de impago: el costo de asegurar la deuda de Colombia.</td></tr>
        <tr><td>Tasa de impuestos de las sociedades</td><td class="n">${pct(c.tax, 0)}</td><td class="n">—</td><td>La <code>t</code> de la beta de Damodaran, <code>βL = βU [1 + (1 − t) D/E]</code>.</td></tr>
      </tbody></table></div>`;
  }

  /* Tabla de cálculo de las primas (se usa en Datos → Renta fija y en Paso a paso). */
  function premiumHTML(ctx, q) {
    const { pct } = ctx;
    const nf = (x, d = 2) => PF.data.fmtNum(x, d);
    const row = (a, b, c) => `<tr><td>${a}</td><td><code>${b}</code></td><td class="n"><b>${c}</b></td></tr>`;
    return `<h3>Cálculo</h3><div class="hscroll"><table class="data wrap"><thead><tr><th>Paso</th><th>Fórmula</th><th class="n">Resultado</th></tr></thead><tbody>
      ${row('1. Tasa libre de riesgo en dólares llevada a pesos (paridad de Fisher)', '(1 + rf USD)(1 + π Col) / (1 + π EE. UU.) − 1', pct(q.rfUsdInCop, 2))}
      ${row('2. Diferencial implícito del TES de 10 años', 'TIR TES 10 años − paso 1', pct(q.implicit, 2))}
      ${row('3. Diferencial por riesgo de impago (default spread)', fin(q.embi) ? 'EMBI de Colombia (pb) / 10.000' : 'si no hay EMBI, el del paso 2', pct(q.spread, 2))}
      ${row('4. Volatilidad relativa acciones / bonos', 'σ ' + 'acciones / σ bonos' + (q.ratioFromData ? ' (con tus datos)' : ''), nf(q.ratio, 2) + ' veces')}
      ${row('5. <b>Prima por riesgo país (PRP)</b>', 'diferencial × σ acciones / σ bonos', pct(q.prp, 2))}
      ${row('6. Tasa libre de riesgo local sin riesgo de impago (Damodaran)', 'TIR TES 10 años − diferencial', pct(q.rfLocal, 2))}
      ${row('7. <b>Rendimiento esperado del mercado (β = 1)</b>', (q.rfBaseSrc === 'local' ? 'rf local (paso 6)' : 'rf en uso') + ' + PRM madura + PRP', pct(q.em, 2))}
    </tbody></table></div>`;
  }

  /* 19. Deuda / patrimonio (D/E) de cada activo para la beta de Damodaran, con calculadora. */
  function deSection(ctx, nf) {
    const { m, table, esc, pct } = ctx;
    const A = m.names[ctx.a] || m.names[0];
    const col = table.values[table.names.indexOf(A)] || [];
    let price = NaN;
    for (let k = col.length - 1; k >= 0 && !fin(price); k--) if (fin(col[k])) price = col[k];
    const c = (ctx.deCalc && ctx.deCalc[A]) || {};
    const shares = fin(+c.shares) && c.shares !== '' && c.shares != null ? +c.shares : ctx.shares && fin(+ctx.shares[A]) ? +ctx.shares[A] : NaN;
    const num = (k) => (c[k] != null && c[k] !== '' && fin(+c[k]) ? +c[k] : NaN);
    const debt = num('debt'); // obligaciones financieras + bonos + arrendamientos, en millones de pesos
    const cash = num('cash');
    const book = num('book');
    const cap = fin(price) && fin(shares) ? (price * shares) / 1e6 : NaN; // millones de pesos
    const de = fin(debt) && cap > 0 ? debt / cap : NaN;
    const deNet = fin(debt) && fin(cash) && cap > 0 ? Math.max(0, debt - cash) / cap : NaN;
    const deBook = fin(debt) && book > 0 ? debt / book : NaN;
    const inp = (k, v, label, ph) => `<label class="field" for="de-${k}"><span>${label}</span><input id="de-${k}" type="number" step="any" inputmode="decimal" data-de="${esc(A)}" data-f="${k}" value="${v != null && v !== '' ? esc(String(v)) : ''}" placeholder="${esc(ph || '')}"></label>`;
    const isBank = /cibest|bancolombia|aval|bogota|davivienda|occidente|popular|bbva|corfi|bolivar/i.test(A);
    return `<div class="panel" id="paso-de"><h2>19. Deuda / patrimonio (D/E) para la beta de Damodaran</h2>
      <p>La beta de una acción mezcla dos riesgos: el del <b>negocio</b> (qué tan cíclicas son sus ventas y sus costos) y el <b>financiero</b> (cuánta deuda tiene). Con más deuda, los intereses son un costo fijo y la utilidad del accionista se mueve más que las ventas: la beta sube. <b>Hamada (1972)</b>, a partir de Modigliani y Miller (1958, 1963), lo escribió así, y es la fórmula de Damodaran:</p>
      <p class="formula"><code>βL = βU [1 + (1 − t) · D/E]</code> &nbsp;·&nbsp; <code>βU = βL / [1 + (1 − t) · D/E]</code></p>
      <ul class="sym"><li><code>βU</code>: beta desapalancada (solo riesgo del negocio), promedio de la industria de Damodaran.</li><li><code>βL</code>: beta apalancada (la del accionista, con su deuda).</li><li><code>t</code>: tasa de impuesto de renta (35 % en Colombia); la deuda pesa <code>(1 − t)</code> porque los intereses se deducen.</li><li><code>D/E</code>: deuda financiera dividida por el valor de mercado del patrimonio.</li></ul>
      <h3>Cómo se obtiene el D/E de cada activo</h3>
      <ol>
        <li><b>Estados financieros</b> del emisor, consolidados y del último trimestre: los publica en su página de relación con inversionistas y los reporta a la <b>Superintendencia Financiera</b> (información relevante del Registro Nacional de Valores y Emisores, RNVE); la ficha del emisor en bvc.com.co los enlaza.</li>
        <li><b>Deuda (D)</b>, del estado de situación financiera: <i>obligaciones financieras</i> corrientes y no corrientes (préstamos bancarios) + <i>bonos y papeles comerciales emitidos</i> + <i>pasivos por arrendamiento</i> (NIIF 16; Damodaran los trata como deuda). No se incluyen proveedores, cuentas por pagar, impuestos, provisiones ni beneficios a empleados: no cobran intereses.</li>
        <li><b>Patrimonio a valor de mercado (E)</b>: precio de la acción × acciones en circulación (capitalización bursátil). El precio sale de tus datos de la BVC; las acciones en circulación, de la ficha del emisor o de la nota de capital de los estados financieros. Si hay acción ordinaria y preferencial, se suman las dos.</li>
        <li><b>D/E = D / E</b>. Damodaran usa valores de mercado porque la beta mide el riesgo de lo que el accionista paga hoy, no de lo que dice la contabilidad. El D/E contable (deuda / patrimonio en libros) se muestra solo para comparar.</li>
        <li><b>Deuda neta</b> (opcional): restar el efectivo da el D/E neto, que usa Damodaran en la «beta corregida por caja».</li>
      </ol>
      ${isBank ? `<p class="hint"><b>${esc(A)} es una entidad financiera.</b> En bancos la deuda (depósitos) es la materia prima del negocio, no una decisión de financiación: Damodaran no desapalanca ni reapalanca las betas de los bancos. Usa directamente la beta de la industria («Bank (Money Center)») sin D/E.</p>` : ''}
      <h3>Calculadora para ${esc(A)}</h3>
      <p class="hint">Cambia el activo en la sección 1 (Activo A). Las cifras van en <b>millones de pesos</b>.</p>
      <div class="form">
        ${inp('debt', c.debt, 'Deuda financiera D (obligaciones + bonos + arrendamientos)', 'millones COP')}
        ${inp('cash', c.cash, 'Efectivo y equivalentes (opcional)', 'millones COP')}
        ${inp('shares', c.shares != null && c.shares !== '' ? c.shares : '', 'Acciones en circulación', fin(shares) ? String(shares) : 'número de acciones')}
        ${inp('book', c.book, 'Patrimonio contable (opcional)', 'millones COP')}
      </div>
      <div class="table-scroll"><table class="data"><tbody>
        <tr><td>Último precio en tus datos</td><td class="n">${fin(price) ? price.toLocaleString('es-CO') : '—'}</td></tr>
        <tr><td>Capitalización E = precio × acciones (millones)</td><td class="n">${fin(cap) ? Math.round(cap).toLocaleString('es-CO') : '—'}</td></tr>
        <tr class="hl"><td><b>D/E a valor de mercado</b></td><td class="n"><b>${nf(de, 3)}</b></td></tr>
        <tr><td>D/E con deuda neta de caja</td><td class="n">${nf(deNet, 3)}</td></tr>
        <tr><td>D/E contable (solo comparación)</td><td class="n">${nf(deBook, 3)}</td></tr>
      </tbody></table></div>
      ${fin(de) ? `<div class="row-btns"><button type="button" class="btn btn-primary" data-de-use="${esc(A)}" data-de-val="${de.toFixed(4)}">Usar D/E = ${nf(de, 3)} en la beta de Damodaran (sección 7)</button></div>` : ''}
    </div>`;
  }

  function premiumSection(ctx, nf) {
    const { m, esc, pct } = ctx;
    const pa = ctx.prpAll || { inp: {}, used: {} };
    const q = premiums(pa.inp, { rf: m.rf, volRatio: pa.inp.ratio });
    const hist = m.mktHist - m.rf;
    return `<div class="panel" id="paso-primas"><h2>18. Prima de riesgo del mercado y prima por riesgo país</h2>
      <p><b>Prima de riesgo del mercado (PRM)</b>: <code>E(Rₘ) − rf</code>, lo que se exige por invertir en acciones en lugar de en el activo sin riesgo. Es la pendiente de la línea del mercado de valores y lo que multiplica la β en el CAPM. <b>Prima por riesgo país (PRP)</b>: lo que se exige además por invertir en Colombia y no en un mercado maduro (Estados Unidos): riesgo de impago del Estado, inestabilidad fiscal o política, convertibilidad de la moneda. Con las dos, el costo del patrimonio de una acción colombiana es</p>
      <p class="formula"><code>Kₑ = rf + β · PRM + λ · PRP</code></p>
      <ul class="sym"><li><code>rf</code>: tasa libre de riesgo (${pct(m.rf, 2)}).</li><li><code>β</code>: riesgo sistemático del activo (sección 16).</li><li><code>λ</code>: exposición de la empresa al riesgo del país (Damodaran, 2003). Con λ = 1 todas cargan la prima completa; con λ = β, en proporción a su β. Una empresa con ingresos en dólares (exportadora) tiene λ &lt; 1.</li></ul>
      <h3>Cómo se establece la PRM</h3>
      <ol>
        <li><b>Histórica</b>: el promedio de <code>Rm − rf</code> en muchos años (Ibbotson; Dimson, Marsh y Staunton). Con tus datos: ${pct(m.mktHist, 2)} − ${pct(m.rf, 2)} = <b>${pct(hist, 2)}</b>. Con 3 años el error es enorme (sección 15): sirve para describir el periodo, no para proyectar.</li>
        <li><b>Implícita</b> (Damodaran): la tasa de descuento que iguala el nivel actual del S&amp;P 500 con los flujos esperados de dividendos y recompras, menos el rendimiento del Tesoro de EE. UU. Se publica cada mes en pages.stern.nyu.edu/~adamodar → Data → «Implied ERP». Es la PRM de un mercado maduro.</li>
        <li><b>Encuestas</b> a analistas y profesores (Fernández y otros, cada año).</li>
      </ol>
      <h3>Cómo se establece la PRP (desde la renta fija)</h3>
      <ol>
        <li><b>Diferencial de bonos soberanos</b>: rendimiento de un bono de Colombia en dólares menos el del Tesoro de EE. UU. al mismo plazo. Su promedio ponderado es el <b>EMBI</b> de J.P. Morgan para Colombia, en puntos básicos (100 pb = 1 %), que publican el Banco de la República y los proveedores de datos.</li>
        <li><b>CDS soberano a 5 años</b>: lo que cuesta asegurar un bono de Colombia contra impago; se mueve casi igual que el EMBI.</li>
        <li><b>Por calificación</b>: el diferencial típico de los países con la misma calificación de Moody's o S&amp;P (tabla «ctryprem» de Damodaran).</li>
        <li><b>Implícito en los TES</b>: la TIR del TES a 10 años en pesos menos la tasa del Tesoro de EE. UU. llevada a pesos con la diferencia de inflaciones (Fisher). Es lo que la tabla de abajo calcula si no hay EMBI.</li>
      </ol>
      <p>El diferencial de bonos mide el riesgo de impago, pero las acciones son más riesgosas que los bonos, así que Damodaran lo escala con la volatilidad relativa: <code>PRP = diferencial × σ acciones / σ bonos</code>${fin(ctx.volRatio) ? `. Con tus datos, σ del ${esc(m.marketName)} / σ del índice COLTES = <b>${nf(ctx.volRatio, 2)}</b>` : ''}. La misma lógica da la <b>tasa libre de riesgo local</b>: el TES no está libre de riesgo de impago, por eso <code>rf = TIR TES − diferencial</code>.</p>
      ${sourcesHTML(ctx, pa)}
      ${premiumHTML(ctx, q)}
      ${damodaranHTML(ctx, ctx.damRef, q)}
      <p class="hint">Los datos salen de los archivos cargados en Datos → Renta fija (o se escriben ahí). La PRP calculada se usa en la beta de Damodaran (sección 7) y el rendimiento esperado del mercado se puede pasar a Supuestos.</p>
    </div>`;
  }

  PF.riesgo = { render, premiums, premiumHTML, sourcesHTML, damodaranHTML, rfCandidates, parseCountryRisk, parseImpliedErp, readReference, annualFrom, fisher, damodaranRf, dailyLog, FAMILY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
