/* Paso a paso de la frontera eficiente: cómo se calcula y se grafica la frontera de Markowitz,
 * la línea del mercado de capitales (CML) y la del mercado de valores (SML), cómo se eligen los
 * activos de cada portafolio (mínima varianza, máximo rendimiento, máxima Sharpe o tangente,
 * recomendado, máxima diversificación, paridad de riesgo, pesos iguales y Treynor-Black), dónde
 * queda el portafolio elegido y cómo se promedian las correlaciones. Todo con los números del modelo. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const fin = Number.isFinite;

  /* Promedios de correlación de un portafolio w:
   *   simple    ρ̄  = Σ_{i<j} ρᵢⱼ / [N(N − 1)/2]                         (todos los pares por igual)
   *   ponderado ρ̄w = Σ<sub>i≠j</sub> wᵢwⱼσᵢσⱼρᵢⱼ / Σ<sub>i≠j</sub> wᵢwⱼσᵢσⱼ               (pesa cada par por su aporte al riesgo)
   * El ponderado es la correlación promedio implícita: con ella, σp² = Σwᵢ²σᵢ² + ρ̄w[(Σwᵢσᵢ)² − Σwᵢ²σᵢ²]. */
  function avgCorr(m, w) {
    const n = w.length;
    let sum = 0;
    let pairs = 0;
    let num = 0;
    let den = 0;
    const list = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const r = m.corr[i][j];
        if (!fin(r)) continue;
        sum += r;
        pairs++;
        const k = 2 * w[i] * w[j] * m.vol[i] * m.vol[j];
        num += k * r;
        den += k;
        list.push({ i, j, r, k });
      }
    const own = w.reduce((s, x, i) => s + x * x * m.vol[i] * m.vol[i], 0);
    const naive = w.reduce((s, x, i) => s + x * m.vol[i], 0);
    const varP = own + num;
    return { simple: pairs ? sum / pairs : NaN, pairs, weighted: den ? num / den : NaN, list, own, naive, cross: den, varP };
  }

  /* Beta de cada activo frente a un portafolio P: βᵢ,P = Cov(rᵢ, rP) / σP² = (Σw)ᵢ / wᵀΣw. */
  function betasTo(m, w) {
    const Sw = m.Sigma.map((row) => row.reduce((s, x, j) => s + x * w[j], 0));
    const v = Sw.reduce((s, x, i) => s + x * w[i], 0);
    return Sw.map((x) => x / v);
  }

  function render(ctx) {
    const { m, P, esc, pct } = ctx;
    if (!m || !P || !P.frontier) return '';
    const C = PF.charts;
    const nf = (x, d = 4) => (fin(x) ? x.toFixed(d).replace('.', ',') : '—');
    const ports = (ctx.ports || []).filter((p) => P[p.key]);
    const sel = P[ctx.sel] ? ctx.sel : 'recommended';
    const selP = ports.find((p) => p.key === sel) || { label: 'Recomendado', key: 'recommended' };
    const E = P[sel];
    const N = m.names.length;
    const top = P.frontier[P.frontier.length - 1];
    const mv = P.frontier[0];
    const tan = P.tangency;
    const out = [];
    const wTable = (cols) => `<div class="table-scroll"><table class="data"><thead><tr><th>Activo</th>${cols.map((c) => `<th class="n">${c.h}</th>`).join('')}</tr></thead><tbody>${m.names
      .map((n, i) => `<tr><td>${esc(n)}</td>${cols.map((c) => `<td class="n">${c.w ? pct(c.w[i]) : '—'}</td>`).join('')}</tr>`)
      .join('')}</tbody></table></div>`;

    /* 8. Frontera eficiente */
    const show = [];
    const step = Math.max(1, Math.floor(P.frontier.length / 9));
    for (let k = 0; k < P.frontier.length; k += step) show.push(k);
    if (show[show.length - 1] !== P.frontier.length - 1) show.push(P.frontier.length - 1);
    const width = ctx.width || 640;
    const chartPorts = ports.map((p) => ({ label: p.short || p.label, vol: P[p.key].vol, ret: P[p.key].ret, sel: p.key === sel, shape: p.shape }));
    chartPorts.sort((a, b) => a.sel - b.sel);
    const assets = m.assets.map((a) => ({ name: a.name, short: a.name.slice(0, 14), vol: a.vol, ret: a.expRet, beta: a.betaM }));
    const user = ctx.user ? { vol: ctx.user.vol, ret: ctx.user.ret, label: 'Tu portafolio' } : null;
    let chart = '';
    try {
      chart = C ? C.riskReturn({ width, front: P.frontier, rf: m.rf, tangent: tan, assets, ports: chartPorts.reverse(), user }) : '';
    } catch (e) {
      chart = '';
    }
    out.push(`<div class="panel"><h2>8. Cómo se calcula y se grafica la frontera eficiente</h2>
      <p><b>Markowitz (1952)</b> llama eficiente al portafolio que, para su nivel de riesgo, da el mayor rendimiento esperado (o, para su rendimiento, el menor riesgo). La frontera eficiente es la curva que une todos esos portafolios.</p>
      <h3>Paso 1. Datos de entrada</h3>
      <ul class="sym"><li><code>μ</code>: vector de rendimientos esperados anuales de los ${N} activos (sección 4).</li><li><code>Σ</code>: matriz de varianzas y covarianzas anual (sección 4).</li><li>Límites de peso: ${pct(Math.min(...P.lo), 0)} ≤ wᵢ ≤ ${pct(P.cap, 0)} por activo y <code>Σ wᵢ = 1</code> (todo el dinero invertido). El tope de ${pct(P.cap, 0)} es el que fija el portafolio recomendado (sección 11).</li></ul>
      <h3>Paso 2. El problema de optimización</h3>
      <p class="formula"><code>min σₚ² = wᵀΣw &nbsp; sujeto a &nbsp; wᵀμ = R*, &nbsp; Σwᵢ = 1, &nbsp; loᵢ ≤ wᵢ ≤ hiᵢ</code></p>
      <p>Para cada rendimiento objetivo R* se busca la combinación de pesos con la menor varianza. La app lo resuelve en la forma equivalente de <b>Markowitz con tolerancia al riesgo t</b>:</p>
      <p class="formula"><code>min ½ wᵀΣw − t · wᵀμ</code> &nbsp; con t de 0 a ∞</p>
      <ul class="sym"><li><code>t = 0</code>: solo importa el riesgo → portafolio de <b>mínima varianza</b>, el extremo izquierdo de la curva.</li><li><code>t</code> creciente: se acepta más riesgo por más rendimiento → los puntos suben por la curva.</li><li><code>t → ∞</code>: solo importa el rendimiento → portafolio de <b>máximo rendimiento</b>, el extremo derecho.</li><li>Cada problema es cuadrático con restricciones de caja; se resuelve con un método de conjunto activo (programación cuadrática) y da un punto (σₚ, E(Rₚ)).</li></ul>
      <h3>Paso 3. Puntos calculados</h3>
      <p>Se resolvieron ${P.frontier.length} puntos. Algunos de ellos:</p>
      <div class="table-scroll"><table class="data"><thead><tr><th class="n">Punto</th><th class="n">t</th><th class="n">E(Rₚ) = wᵀμ</th><th class="n">σₚ = √(wᵀΣw)</th><th class="n">Sharpe</th>${m.names.map((n) => `<th class="n">${esc(n)}</th>`).join('')}</tr></thead><tbody>${show
        .map((k) => {
          const p = P.frontier[k];
          const t = k === 0 ? 0 : k === P.frontier.length - 1 ? Infinity : P.front[k] && P.front[k].t;
          return `<tr${k === 0 || k === P.frontier.length - 1 ? ' class="hl"' : ''}><td class="n">${k + 1}</td><td class="n">${t === Infinity ? '∞' : fin(t) ? nf(t, 4) : '—'}</td><td class="n">${pct(p.ret)}</td><td class="n">${pct(p.vol)}</td><td class="n">${nf((p.ret - m.rf) / p.vol, 3)}</td>${p.w.map((x) => `<td class="n">${pct(x, 0)}</td>`).join('')}</tr>`;
        })
        .join('')}</tbody></table></div>
      <h3>Paso 4. Graficar</h3>
      <ol><li>Eje horizontal: riesgo σₚ (anual). Eje vertical: rendimiento esperado E(Rₚ) (anual).</li><li>Se dibuja cada punto (σₚ, E(Rₚ)) de la tabla y se unen en orden de t: esa curva es la frontera eficiente.</li><li>Solo la parte que sube desde el punto de mínima varianza (σ = ${pct(mv.vol)}, E(R) = ${pct(mv.ret)}) es eficiente; por debajo de ese punto, a igual riesgo hay otro portafolio que rinde más.</li><li>Se agregan los activos individuales (puntos sueltos: todos quedan a la derecha o por debajo de la curva) y los portafolios de las secciones siguientes.</li><li>Desde rf = ${pct(m.rf)} se traza la línea del mercado de capitales, tangente a la curva (sección 9).</li></ol>
      ${chart ? `<div class="chart-box">${chart}</div><div class="legend"><span><i class="line" style="background:var(--s1)"></i>Frontera eficiente</span><span><i class="line" style="background:var(--s2)"></i>Línea del mercado de capitales</span><span><i class="dot" style="background:var(--asset)"></i>Activos</span><span><i class="dot" style="background:var(--ink)"></i>Portafolios</span><span><i class="dot" style="background:var(--s1)"></i>Elegido: ${esc(selP.label)}</span></div>` : ''}
      </div>`);

    /* 9. CML */
    if (tan) {
      const slope = (tan.ret - m.rf) / tan.vol;
      const at = E.vol;
      out.push(`<div class="panel"><h2>9. Línea del mercado de capitales (CML)</h2>
        <p><b>Tobin (1958)</b> y <b>Sharpe (1964)</b>: si se puede prestar o pedir prestado a la tasa libre de riesgo rf, la mejor combinación ya no está sobre la curva sino sobre la recta que sale de rf y toca la frontera en el portafolio <b>tangente</b> T.</p>
        <p class="formula"><code>E(Rₚ) = rf + [(E(R_T) − rf) / σ_T] · σₚ</code></p>
        <ul class="sym"><li><code>rf</code> = ${pct(m.rf)}: tasa libre de riesgo (Datos → Supuestos).</li><li><code>E(R_T)</code> = ${pct(tan.ret)} y <code>σ_T</code> = ${pct(tan.vol)}: rendimiento y riesgo del portafolio tangente.</li><li>Pendiente = (${pct(tan.ret)} − ${pct(m.rf)}) / ${pct(tan.vol)} = <b>${nf(slope, 4)}</b>: es la razón de Sharpe del tangente, el mayor premio por unidad de riesgo total que se puede lograr.</li></ul>
        <h3>Cómo se traza</h3>
        <ol><li>Punto 1: (σ = 0, E(R) = rf = ${pct(m.rf)}), todo en renta fija segura.</li><li>Punto 2: (σ_T = ${pct(tan.vol)}, E(R_T) = ${pct(tan.ret)}), todo en el tangente.</li><li>Se prolonga la recta: a la izquierda de T se combina T con renta fija (prestar); a la derecha, se pide prestado a rf para invertir más de 100 % en T (apalancamiento).</li></ol>
        <p>Con el riesgo del portafolio elegido (${esc(selP.label)}, σ = ${pct(at)}), la CML da E(R) = ${pct(m.rf)} + ${nf(slope, 4)} × ${pct(at)} = <b>${pct(m.rf + slope * at)}</b>. Se logra con ${pct(at / tan.vol)} en el tangente y ${pct(1 - at / tan.vol)} en renta fija segura.</p></div>`);
    }

    /* 10. SML */
    const bP = E.beta;
    const reqP = m.rf + bP * (m.Em - m.rf);
    let smlChart = '';
    try {
      smlChart = C ? C.sml({ width, assets: assets.concat([{ name: selP.label, short: selP.label, beta: bP, ret: E.ret }]), rf: m.rf, Em: m.Em, marketName: m.marketName }) : '';
    } catch (e) {
      smlChart = '';
    }
    out.push(`<div class="panel"><h2>10. Línea del mercado de valores (SML) y CAPM</h2>
      <p><b>Sharpe (1964)</b>, <b>Lintner (1965)</b> y <b>Mossin (1966)</b>: en equilibrio el mercado solo paga el riesgo sistemático β. La SML relaciona β con el rendimiento que se exige:</p>
      <p class="formula"><code>E(Rᵢ) = rf + βᵢ · (E(Rₘ) − rf)</code> = ${pct(m.rf)} + βᵢ × (${pct(m.Em)} − ${pct(m.rf)}) = ${pct(m.rf)} + βᵢ × ${pct(m.Em - m.rf)}</p>
      <h3>Cómo se traza</h3>
      <ol><li>Eje horizontal: β; eje vertical: rendimiento esperado.</li><li>Punto 1: (β = 0, rf = ${pct(m.rf)}). Punto 2: el mercado ${esc(m.marketName)} (β = 1, E(Rₘ) = ${pct(m.Em)}). La recta que los une es la SML.</li><li>Cada activo se ubica con su β y su rendimiento esperado: por encima de la recta tiene α de Jensen positivo (rinde más de lo que exige su β); por debajo, negativo.</li></ol>
      <h3>Beta del portafolio elegido (${esc(selP.label)})</h3>
      <p class="formula"><code>βₚ = Σ wᵢ βᵢ</code> = ${m.names
        .map((n, i) => (Math.abs(E.w[i]) > 5e-4 ? `${pct(E.w[i], 1)}×${nf(m.assets[i].betaM, 2)}` : null))
        .filter(Boolean)
        .join(' + ')} = <b>${nf(bP, 3)}</b></p>
      <p>Rendimiento exigido por la SML: ${pct(m.rf)} + ${nf(bP, 3)} × ${pct(m.Em - m.rf)} = ${pct(reqP)}. Rendimiento esperado del portafolio: ${pct(E.ret)}. α de Jensen = ${pct(E.ret)} − ${pct(reqP)} = <b>${pct(E.ret - reqP, 2)}</b>: el portafolio queda ${E.ret >= reqP ? 'por encima' : 'por debajo'} de la SML.</p>
      ${smlChart ? `<div class="chart-box">${smlChart}</div>` : ''}</div>`);

    /* 11. Cómo se elige cada portafolio */
    const tb = ctx.tb && ctx.tb.ok ? ctx.tb : null;
    const defs = [
      { key: 'minVar', crit: '<code>min wᵀΣw</code> (t = 0)', how: 'Solo mira la matriz Σ: busca la combinación con la menor varianza posible. No usa los rendimientos esperados, que son el dato con más error de estimación. Recibe más peso un activo con poca varianza y baja correlación con los demás.' },
      { key: 'maxRet', crit: '<code>max wᵀμ</code> (t → ∞)', how: `Ordena los activos de mayor a menor E(R) y llena cada uno hasta el tope de ${pct(P.cap, 0)} hasta completar el 100 %. Es el extremo derecho de la frontera: no le importa el riesgo.`, ev: { ret: top.ret, vol: top.vol, w: top.w, sharpe: (top.ret - m.rf) / top.vol } },
      { key: 'tangency', crit: '<code>max (wᵀμ − rf) / √(wᵀΣw)</code>', how: 'Recorre la frontera y se queda con el punto de mayor razón de Sharpe (rejilla y búsqueda de sección áurea sobre t). Es donde la CML toca la curva: el portafolio tangente o de máxima Sharpe.' },
      { key: 'recommended', crit: `<code>max wᵀμ</code> sobre la frontera con <code>1 / Σwᵢ² ≥ ${nf(E && P.recommended.div ? P.recommended.div.target : NaN, 1)}</code>`, how: `Sube por la frontera mientras el número efectivo de activos N = 1/Σwᵢ² siga siendo al menos ${P.recommended.div ? nf(P.recommended.div.target, 1) : '—'} (diversificación ${P.recommended.div ? esc(P.recommended.div.level) : ''}). Es el punto eficiente de mayor rendimiento que no se concentra en pocos activos. El tope por activo (${pct(P.cap, 0)}) es el más holgado con el que se alcanza esa diversificación.` },
      { key: 'maxDiv', crit: '<code>max Σ wᵢσᵢ / σₚ</code>', how: 'Choueifaty y Coignard (2008): maximiza la razón de diversificación, el cociente entre el riesgo si todo estuviera perfectamente correlacionado y el riesgo real. Favorece activos poco correlacionados entre sí.' },
      { key: 'riskParity', crit: '<code>wᵢ(Σw)ᵢ / σₚ² = 1/N</code> para todo i', how: 'Cada activo aporta la misma parte del riesgo total. Se resuelve por descenso cíclico por coordenadas; los activos más volátiles reciben menos peso.' },
      { key: 'equal', crit: '<code>wᵢ = 1/N</code>', how: `Reparte por igual entre los ${N} activos (ajustado a los límites). DeMiguel, Garlappi y Uppal (2009) lo usan como referencia: no estima nada, pero rara vez está sobre la frontera.` },
    ];
    const rowsP = defs
      .map((d) => {
        const e = d.ev || P[d.key];
        if (!e) return '';
        const lbl = d.key === 'maxRet' ? 'Máximo rendimiento' : (ports.find((p) => p.key === d.key) || {}).label || d.key;
        return `<tr${d.key === sel ? ' class="hl"' : ''}><td><b>${esc(lbl)}</b>${d.key === sel ? ' (elegido)' : ''}</td><td>${d.crit}</td><td>${d.how}</td><td class="n">${pct(e.ret)}</td><td class="n">${pct(e.vol)}</td><td class="n">${nf(e.sharpe, 3)}</td><td class="n">${nf(1 / e.w.reduce((s, x) => s + x * x, 0), 1)}</td></tr>`;
      })
      .join('');
    const cols = defs.filter((d) => d.ev || P[d.key]).map((d) => ({ h: d.key === 'maxRet' ? 'Máx. rendimiento' : esc((ports.find((p) => p.key === d.key) || {}).short || d.key), w: (d.ev || P[d.key]).w }));
    if (tb) cols.push({ h: 'Treynor-Black (parte activa)', w: tb.assetW });
    out.push(`<div class="panel"><h2>11. Cómo se eligen los activos de cada portafolio</h2>
      <p>Todos usan los mismos μ y Σ y los mismos límites de peso; cambia lo que se optimiza.</p>
      <div class="table-scroll"><table class="data"><thead><tr><th>Portafolio</th><th>Criterio</th><th>Cómo elige los activos</th><th class="n">E(R)</th><th class="n">σ</th><th class="n">Sharpe</th><th class="n">N efectivo</th></tr></thead><tbody>${rowsP}</tbody></table></div>
      ${tb ? `<p><b>Treynor y Black (1973)</b>: parte del índice ${esc(m.marketName)} y le agrega una cartera activa con los activos de α de Jensen distinto de cero. Peso de cada activo en la cartera activa: <code>wᵢ ∝ αᵢ / σ²(εᵢ)</code> (α sobre su riesgo propio). Peso de la cartera activa: <code>w₀ = [α_A / σ²(e_A)] / [(E(Rₘ) − rf) / σₘ²]</code>, ajustado por su beta: <code>w* = w₀ / [1 + (1 − β_A) w₀]</code> = ${pct(tb.wActive)}; el resto, ${pct(tb.wIndex)}, va al índice. Sharpe resultante: √(Sₘ² + IR²) = ${nf(tb.sharpeP, 3)}.</p>` : ''}
      <h3>Pesos de cada portafolio</h3>
      ${wTable(cols)}</div>`);

    /* 12. Por qué entra o no cada activo (condición de primer orden del tangente) */
    if (tan) {
      const bT = betasTo(m, tan.w);
      const prem = tan.ret - m.rf;
      const diff = m.names.map((_, i) => m.mu[i] - m.rf - bT[i] * prem);
      const state = tan.w.map((w, i) => (w <= P.lo[i] + 1e-4 ? 'lo' : w >= P.hi[i] - 1e-4 ? 'hi' : 'in'));
      const inner = diff.filter((_, i) => state[i] === 'in');
      const nu = inner.length ? inner.reduce((a, x) => a + x, 0) / inner.length : NaN;
      const WHY = { lo: 'en el mínimo: su prima no alcanza a pagar su aporte al riesgo', hi: 'en el tope: rinde más de lo que exige su aporte al riesgo', in: 'interior: su prima paga justo su aporte al riesgo' };
      out.push(`<div class="panel"><h2>12. Por qué un activo entra o no al portafolio tangente</h2>
        <p>Para cada activo se compara su prima con la que exige su aporte al riesgo del portafolio tangente T:</p>
        <p class="formula"><code>Diferencia ᵢ = [E(Rᵢ) − rf] − βᵢ,T · (E(R_T) − rf)</code>, &nbsp; con &nbsp; <code>βᵢ,T = Cov(rᵢ, r_T) / σ_T² = (Σw_T)ᵢ / (w_TᵀΣw_T)</code></p>
        <ol><li>Sin límites de peso, el óptimo de Markowitz deja la diferencia en 0 para todos los activos: cada uno paga exactamente su aporte al riesgo (condición de primer orden).</li><li>Con límites (mínimo ${pct(Math.min(...P.lo), 0)} y tope ${pct(P.cap, 0)}), todos los activos <b>interiores</b> comparten una misma diferencia ν${fin(nu) ? ` = ${pct(nu, 2)}` : ''}: es el costo de los límites.</li><li>Un activo con diferencia menor que ν baja hasta el mínimo; uno con diferencia mayor sube hasta el tope. Así se eligen los activos: entran los que más rendimiento aportan por unidad de riesgo que suman al conjunto, no los de mayor rendimiento a secas.</li></ol>
        <div class="table-scroll"><table class="data"><thead><tr><th>Activo</th><th class="n">E(Rᵢ) − rf</th><th class="n">βᵢ,T</th><th class="n">Prima exigida βᵢ,T·${pct(prem)}</th><th class="n">Diferencia</th><th class="n">Peso en T</th><th>Resultado</th></tr></thead><tbody>${m.names
          .map((n, i) => `<tr><td>${esc(n)}</td><td class="n">${pct(m.mu[i] - m.rf)}</td><td class="n">${nf(bT[i], 3)}</td><td class="n">${pct(bT[i] * prem)}</td><td class="n">${pct(diff[i], 2)}</td><td class="n">${pct(tan.w[i])}</td><td>${WHY[state[i]]}</td></tr>`)
          .join('')}</tbody></table></div></div>`);
    }

    /* 13. Dónde queda el portafolio elegido */
    const O = PF.optim;
    let eff = null;
    try {
      eff = O.frontierAtVol(m.Sigma, m.mu, P.lo, P.hi, P.front, E.vol);
    } catch (e) {
      eff = null;
    }
    const pos = (e, name) => {
      const fr = (() => {
        try {
          return O.frontierAtVol(m.Sigma, m.mu, P.lo, P.hi, P.front, e.vol);
        } catch (er) {
          return null;
        }
      })();
      const gap = fr ? fr.ret - e.ret : NaN;
      // Un portafolio con pesos fuera de los límites (p. ej. paridad de riesgo) puede quedar a la izquierda de la frontera
      const outside = e.w.some((x, i) => x < P.lo[i] - 1e-6 || x > P.hi[i] + 1e-6) || gap < -5e-4;
      const cml = tan ? m.rf + ((tan.ret - m.rf) / tan.vol) * e.vol : NaN;
      return `<tr><td><b>${esc(name)}</b></td><td class="n">${pct(e.vol)}</td><td class="n">${pct(e.ret)}</td><td class="n">${fr ? pct(fr.ret) : '—'}</td><td class="n">${fin(gap) && !outside ? pct(Math.max(0, gap), 2) : '—'}</td><td class="n">${fin(cml) ? pct(cml) : '—'}</td><td class="n">${nf(e.sharpe, 3)}</td><td class="n">${nf(e.beta, 3)}</td><td class="n">${pct(e.jensen, 2)}</td><td>${outside ? 'fuera de los límites de peso: no se compara con esta frontera' : fin(gap) && gap < 5e-4 ? 'sobre la frontera eficiente' : 'por debajo de la frontera'}</td></tr>`;
    };
    out.push(`<div class="panel"><h2>13. Dónde queda el portafolio elegido</h2>
      <p>El portafolio elegido en Portafolio es <b>${esc(selP.label)}</b>. Para ubicarlo:</p>
      <ol><li>Riesgo: <code>σₚ = √(wᵀΣw)</code> = ${pct(E.vol)} → coordenada horizontal.</li><li>Rendimiento: <code>E(Rₚ) = wᵀμ</code> = ${pct(E.ret)} → coordenada vertical.</li><li>Se compara con la frontera al mismo riesgo: el portafolio eficiente con σ = ${pct(E.vol)} rinde ${eff ? pct(eff.ret) : '—'}. ${eff && eff.ret - E.ret < 5e-4 ? 'Coinciden: el portafolio está sobre la frontera.' : `Le faltan ${eff ? pct(eff.ret - E.ret, 2) : '—'} para estar sobre ella.`}</li><li>Se compara con la CML: ${tan ? `con su riesgo, la combinación de tangente y renta fija rendiría ${pct(m.rf + ((tan.ret - m.rf) / tan.vol) * E.vol)}; su Sharpe es ${nf(E.sharpe, 3)} frente a ${nf(tan.sharpe, 3)} del tangente.` : 'no hay tangente con prima positiva.'}</li><li>Se ubica en la SML con su β = ${nf(E.beta, 3)} (sección 10).</li></ol>
      <div class="table-scroll"><table class="data"><thead><tr><th>Portafolio</th><th class="n">σ</th><th class="n">E(R)</th><th class="n">Frontera a igual σ</th><th class="n">Distancia</th><th class="n">CML a igual σ</th><th class="n">Sharpe</th><th class="n">β</th><th class="n">α de Jensen</th><th>Posición</th></tr></thead><tbody>${ports
        .map((p) => pos(P[p.key], p.label + (p.key === sel ? ' (elegido)' : '')))
        .join('')}${ctx.user ? pos(ctx.user, 'Tu portafolio (Confirmar)') : ''}</tbody></table></div></div>`);

    /* 14. Promedio de las correlaciones */
    const ac = avgCorr(m, E.w);
    const top10 = ac.list
      .filter((p) => Math.abs(E.w[p.i]) > 5e-4 && Math.abs(E.w[p.j]) > 5e-4)
      .sort((a, b) => Math.abs(b.k) - Math.abs(a.k))
      .slice(0, 15);
    const eq = avgCorr(m, new Array(N).fill(1 / N));
    out.push(`<div class="panel"><h2>14. Cómo se promedian las correlaciones</h2>
      <p>La correlación promedio resume en un número cuánto se mueven juntos los activos, y por eso cuánto ayuda la diversificación. Hay dos formas de calcularla:</p>
      <h3>a) Promedio simple de todos los pares</h3>
      <p class="formula"><code>ρ̄ = Σ<sub>i&lt;j</sub> ρᵢⱼ / [N(N − 1)/2]</code></p>
      <p>Con ${N} activos hay ${N} × ${N - 1} / 2 = ${ac.pairs} pares (los valores de la matriz de correlaciones por encima de la diagonal, sección 4). Su suma dividida por ${ac.pairs} da <b>ρ̄ = ${nf(ac.simple, 4)}</b>. No depende de los pesos.</p>
      <h3>b) Promedio ponderado por el portafolio (correlación implícita)</h3>
      <p class="formula"><code>ρ̄ₚ = Σ<sub>i≠j</sub> wᵢwⱼσᵢσⱼρᵢⱼ / Σ<sub>i≠j</sub> wᵢwⱼσᵢσⱼ</code></p>
      <p>Cada par pesa según cuánto riesgo aporta en el portafolio (<code>wᵢwⱼσᵢσⱼ</code>): un par con pesos pequeños casi no cuenta. Es la correlación única que, puesta en todos los pares, da la misma varianza del portafolio:</p>
      <p class="formula"><code>σₚ² = Σ wᵢ²σᵢ² + ρ̄ₚ · [(Σ wᵢσᵢ)² − Σ wᵢ²σᵢ²]</code></p>
      <p>Con el portafolio elegido (${esc(selP.label)}):</p>
      <ul class="sym"><li>Riesgo propio: <code>Σ wᵢ²σᵢ²</code> = ${nf(ac.own, 6)}</li><li>Riesgo si la correlación fuera 1: <code>(Σ wᵢσᵢ)²</code> = ${nf(ac.naive, 4)}² = ${nf(ac.naive * ac.naive, 6)}</li><li>Término cruzado posible: ${nf(ac.naive * ac.naive, 6)} − ${nf(ac.own, 6)} = ${nf(ac.cross, 6)}</li><li>Término cruzado real: <code>Σ<sub>i≠j</sub> wᵢwⱼσᵢⱼ</code> = ${nf(ac.varP - ac.own, 6)}</li><li><b>ρ̄ₚ</b> = ${nf(ac.varP - ac.own, 6)} / ${nf(ac.cross, 6)} = <b>${nf(ac.weighted, 4)}</b></li><li>Comprobación: ${nf(ac.own, 6)} + ${nf(ac.weighted, 4)} × ${nf(ac.cross, 6)} = ${nf(ac.varP, 6)} → σₚ = ${pct(Math.sqrt(Math.max(0, ac.varP)))} (igual a la sección 5).</li></ul>
      <h3>Pares que más pesan en el promedio ponderado</h3>
      <div class="table-scroll"><table class="data"><thead><tr><th>Par</th><th class="n">ρᵢⱼ</th><th class="n">2wᵢwⱼσᵢσⱼ</th><th class="n">Aporte 2wᵢwⱼσᵢσⱼρᵢⱼ</th></tr></thead><tbody>${top10
        .map((p) => `<tr><td>${esc(m.names[p.i])} – ${esc(m.names[p.j])}</td><td class="n">${nf(p.r, 4)}</td><td class="n">${nf(p.k, 6)}</td><td class="n">${nf(p.k * p.r, 6)}</td></tr>`)
        .join('')}</tbody></table></div>
      <h3>Qué dice sobre la diversificación</h3>
      <p><b>Elton y Gruber (1977)</b>: con pesos iguales, <code>σₚ² = σ̄²/N + (1 − 1/N)·cov̄</code>. Al agregar activos, el primer término (riesgo propio) tiende a cero y queda solo la covarianza promedio: el riesgo que no se puede diversificar. Con pesos iguales en tus ${N} activos, ρ̄ₚ = ${nf(eq.weighted, 4)}. Cuanto más baja la correlación promedio, más riesgo elimina la diversificación: el portafolio elegido tiene σₚ = ${pct(E.vol)} frente a ${pct(ac.naive)} si todo estuviera perfectamente correlacionado.</p></div>`);

    return out.join('');
  }

  PF.frontera = { render, avgCorr, betasTo };
})(typeof globalThis !== 'undefined' ? globalThis : this);
