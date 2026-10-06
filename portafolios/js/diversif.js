/* Elegir activos por diversificación: de un universo de N activos analizados, qué grupo de k
 * reduce más el riesgo según sus correlaciones. Explica el criterio (correlaciones negativas,
 * cercanas a cero o positivas), lo calcula con los datos cargados y deja aplicar la selección.
 *
 * Con pesos iguales (1/k) la varianza del portafolio depende solo de dos promedios:
 *   σₚ² = V̄ / k + (1 − 1/k) · C̄        V̄ = varianza promedio, C̄ = covarianza promedio de los pares
 * La reducción por diversificación es lo que se pierde de riesgo frente al promedio de los σ:
 *   reducción = 1 − σₚ / σ̄              σ̄ = Σ σᵢ / k
 * Un activo nuevo i baja el riesgo del portafolio p si ρᵢ,ₚ < σₚ / σᵢ (Elton y Gruber). */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const fin = Number.isFinite;
  const MAX_EXACT = 20000; // combinaciones que se evalúan una por una; más allá, búsqueda voraz + intercambios

  const binom = (n, k) => {
    let r = 1;
    for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
    return Math.round(r);
  };

  /* Indicadores de un grupo S (índices del universo) con pesos iguales */
  function evalSet(m, S) {
    const k = S.length;
    const w = 1 / k;
    let V = 0;
    let C = 0;
    let rho = 0;
    let sig = 0;
    let ret = 0;
    for (let a = 0; a < k; a++) {
      const i = S[a];
      V += m.Sigma[i][i];
      sig += m.vol[i];
      ret += m.mu[i];
      for (let b = a + 1; b < k; b++) {
        C += m.Sigma[i][S[b]];
        rho += m.corr[i][S[b]];
      }
    }
    const pairs = (k * (k - 1)) / 2;
    const Vbar = V / k;
    const Cbar = pairs ? C / pairs : 0;
    const varP = Vbar / k + (1 - 1 / k) * Cbar;
    const volP = Math.sqrt(Math.max(0, varP));
    const sigBar = sig / k;
    return { S, k, w, Vbar, Cbar, varP, volP, sigBar, red: 1 - volP / sigBar, dr: sigBar / volP, rho: pairs ? rho / pairs : 1, ret: ret * w, sharpe: (ret * w - m.rf) / volP, minVol: Math.min(...S.map((i) => m.vol[i])) };
  }

  /* Mínima varianza sin ventas en corto dentro del grupo */
  function minVar(m, S) {
    const Sig = S.map((i) => S.map((j) => m.Sigma[i][j]));
    let w;
    try {
      w = PF.optim.solveQP(Sig, new Array(S.length).fill(0), 0, 1);
    } catch (e) {
      w = new Array(S.length).fill(1 / S.length);
    }
    let v = 0;
    for (let a = 0; a < S.length; a++) for (let b = 0; b < S.length; b++) v += w[a] * w[b] * Sig[a][b];
    return { w, vol: Math.sqrt(Math.max(0, v)), ret: w.reduce((q, x, a) => q + x * m.mu[S[a]], 0) };
  }

  const KEY = { red: (x) => -x.red, vol: (x) => x.volP, rho: (x) => x.rho, mv: (x) => x.mv.vol };

  /* Recorre todos los grupos de k (o una búsqueda aproximada si son demasiados) */
  function best(m, k, by, top) {
    const N = m.names.length;
    k = Math.max(2, Math.min(N, k | 0));
    by = KEY[by] ? by : 'red';
    const total = binom(N, k);
    let list = [];
    let exact = total <= MAX_EXACT;
    if (exact) {
      const S = [];
      const rec = (start) => {
        if (S.length === k) return list.push(evalSet(m, S.slice()));
        for (let i = start; i <= N - (k - S.length); i++) {
          S.push(i);
          rec(i + 1);
          S.pop();
        }
      };
      rec(0);
    } else {
      // voraz desde cada par inicial bueno + intercambios de a un activo
      const seen = new Set();
      const add = (S) => {
        const key = S.slice().sort((a, b) => a - b).join(',');
        if (seen.has(key)) return null;
        seen.add(key);
        const e = evalSet(m, S.slice().sort((a, b) => a - b));
        list.push(e);
        return e;
      };
      const pairs = [];
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) pairs.push([i, j, m.corr[i][j]]);
      pairs.sort((a, b) => a[2] - b[2]);
      for (const [i, j] of pairs.slice(0, 30)) {
        let S = greedy(m, k, [i, j]).set;
        let cur = add(S) || evalSet(m, S);
        for (let pass = 0; pass < 20; pass++) {
          let improved = false;
          for (let a = 0; a < k && !improved; a++)
            for (let o = 0; o < N && !improved; o++) {
              if (S.includes(o)) continue;
              const T = S.slice();
              T[a] = o;
              const e = add(T) || evalSet(m, T.slice().sort((x, y) => x - y));
              if (KEY[by === 'mv' ? 'vol' : by](e) < KEY[by === 'mv' ? 'vol' : by](cur) - 1e-12) {
                S = T;
                cur = e;
                improved = true;
              }
            }
          if (!improved) break;
        }
      }
    }
    // mínima varianza: en todos si son pocos; si no, en los mejores por σₚ con pesos iguales
    const pre = by === 'mv' && list.length > 3000 ? list.slice().sort((a, b) => a.volP - b.volP).slice(0, 300) : by === 'mv' ? list : null;
    if (pre) {
      for (const e of pre) e.mv = minVar(m, e.S);
      list = pre;
    }
    list.sort((a, b) => KEY[by](a) - KEY[by](b));
    list = list.slice(0, top || 10);
    for (const e of list) if (!e.mv) e.mv = minVar(m, e.S);
    return { k, by, total, exact, list };
  }

  /* Construcción paso a paso: se parte del par menos correlacionado y en cada paso entra el activo
   * con menor correlación con el portafolio que ya se tiene (pesos iguales). */
  function greedy(m, k, start) {
    const N = m.names.length;
    k = Math.max(2, Math.min(N, k | 0));
    let S = start ? start.slice() : null;
    if (!S) {
      let bestP = null;
      for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) if (!bestP || m.corr[i][j] < bestP[2]) bestP = [i, j, m.corr[i][j]];
      S = [bestP[0], bestP[1]];
    }
    const steps = [{ add: S.slice(), e: evalSet(m, S), cands: [] }];
    while (S.length < k) {
      const p = evalSet(m, S);
      const cands = [];
      for (let i = 0; i < N; i++) {
        if (S.includes(i)) continue;
        const cov = S.reduce((q, j) => q + m.Sigma[i][j], 0) / S.length;
        const rhoIP = cov / (m.vol[i] * p.volP);
        const after = evalSet(m, S.concat([i]));
        cands.push({ i, rhoIP, lim: p.volP / m.vol[i], helps: rhoIP < p.volP / m.vol[i], after });
      }
      cands.sort((a, b) => a.rhoIP - b.rhoIP);
      S = S.concat([cands[0].i]);
      steps.push({ add: [cands[0].i], e: evalSet(m, S), before: p, cands });
    }
    return { set: S.slice().sort((a, b) => a - b), steps };
  }

  /* Pares: correlación, umbral ρ* = σmenor / σmayor y mínima varianza de los dos */
  function pairs(m) {
    const N = m.names.length;
    const out = [];
    for (let i = 0; i < N; i++)
      for (let j = i + 1; j < N; j++) {
        const lo = m.vol[i] <= m.vol[j] ? i : j;
        const hi = lo === i ? j : i;
        const a = m.Sigma[lo][lo];
        const b = m.Sigma[hi][hi];
        const c = m.Sigma[lo][hi];
        const den = a + b - 2 * c;
        const wLo = den > 0 ? Math.max(0, Math.min(1, (b - c) / den)) : 1;
        const v = wLo * wLo * a + (1 - wLo) * (1 - wLo) * b + 2 * wLo * (1 - wLo) * c;
        out.push({ i, j, lo, hi, rho: m.corr[i][j], lim: m.vol[lo] / m.vol[hi], wLo, mvVol: Math.sqrt(Math.max(0, v)), eqVol: Math.sqrt(Math.max(0, 0.25 * (a + b + 2 * c))) });
      }
    return out.sort((x, y) => x.rho - y.rho);
  }

  function render(ctx) {
    const { m, esc, pct } = ctx;
    if (!m || m.names.length < 3) return '<p class="meta">Carga al menos tres activos para elegir un grupo por diversificación.</p>';
    const nf = (x, d = 4) => PF.data.fmtNum(x, d);
    const sub = (x) => `<sub>${x}</sub>`;
    const sup = (x) => `<sup>${x}</sup>`;
    const N = m.names.length;
    const k = Math.max(2, Math.min(N - 1, ctx.k || Math.min(5, N - 1)));
    const by = KEY[ctx.by] ? ctx.by : 'red';
    const picked = new Set(ctx.picked || []);
    const R = best(m, k, by, 10);
    const G = greedy(m, k);
    const P = pairs(m);
    const lk = (x) => {
      const l = PF.stats.likert(x);
      return `style="background:${l.color};color:${l.text}" title="${esc(l.label)}"`;
    };
    const nm = (i) => esc(m.names[i]);
    const neg = P.filter((p) => p.rho < -0.1).length;
    const zero = P.filter((p) => Math.abs(p.rho) <= 0.1).length;
    const pos = P.filter((p) => p.rho > 0.1).length;
    const caso = neg === 0 && zero === 0 ? 'todas positivas' : pos === 0 && zero === 0 ? 'todas negativas' : 'mezcladas';
    const floor = -1 / (k - 1);
    const b0 = R.list[0];
    const opt = (v, t) => `<option value="${v}"${by === v ? ' selected' : ''}>${t}</option>`;
    const out = [];

    out.push(`<p>De los <b>${N}</b> activos analizados, ¿qué grupo de <b>k</b> reduce más el riesgo por diversificación? La app prueba ${R.exact ? `<b>todas</b> las ${R.total.toLocaleString('es-CO')} combinaciones posibles` : `una búsqueda aproximada (hay ${R.total.toLocaleString('es-CO')} combinaciones; se parte de los 30 pares menos correlacionados y se intercambian activos mientras mejore)`} y las ordena según el criterio que elijas.</p>
      <div class="row-btns div-form"><label>Activos a elegir (k) <input type="number" id="div-k" min="2" max="${N - 1}" step="1" value="${k}"></label>
      <label>Ordenar por <select id="div-by">${opt('red', 'Mayor reducción de riesgo por diversificación (pesos iguales)')}${opt('vol', 'Menor riesgo σₚ con pesos iguales')}${opt('rho', 'Menor correlación promedio ρ̄')}${opt('mv', 'Menor riesgo de mínima varianza')}</select></label></div>`);

    // Mejores grupos
    out.push(`<h3>Los mejores grupos de ${k} activos</h3>
      <div class="table-scroll hscroll"><table class="data"><thead><tr><th>#</th><th>Activos</th><th class="n">ρ̄</th><th class="n">σ̄ (promedio de σ${sub('i')})</th><th class="n">σ${sub('p')} pesos iguales</th><th class="n">Reducción 1 − σ${sub('p')}/σ̄</th><th class="n">σ${sub('p')} mínima varianza</th><th class="n">E(R${sub('p')}) pesos iguales</th><th class="n">Sharpe</th><th></th></tr></thead><tbody>${R.list
        .map((e, r) => {
          const same = e.S.length === picked.size && e.S.every((i) => picked.has(m.names[i]));
          return `<tr${r === 0 ? ' class="hl"' : ''}><td class="n">${r + 1}</td><td>${e.S.map(nm).join(', ')}</td><td class="n" ${lk(e.rho)}>${nf(e.rho, 3)}</td><td class="n">${pct(e.sigBar, 2)}</td><td class="n">${pct(e.volP, 2)}</td><td class="n"><b>${pct(e.red, 1)}</b></td><td class="n">${pct(e.mv.vol, 2)}</td><td class="n">${pct(e.ret, 2)}</td><td class="n">${nf(e.sharpe, 3)}</td><td>${same ? '<span class="pos">En uso</span>' : `<button type="button" class="btn btn-ghost btn-use" data-div-use="${esc(e.S.map((i) => m.names[i]).join('|'))}">Usar estos ${k}</button>`}</td></tr>`;
        })
        .join('')}</tbody></table></div>
      <p class="table-note">«Usar estos ${k}» deja solo esos activos marcados en «Activos del portafolio»; la frontera, los portafolios y el paso a paso se recalculan con ellos. Los demás siguen cargados y se pueden volver a marcar.</p>`);

    // De dónde sale el resultado del primero
    const e = b0;
    out.push(`<h3>De dónde salen los números del grupo 1</h3>
      <ol>
        <li>Varianza promedio de los ${k}: <code>V̄ = (σ${sub('1')}${sup('2')} + … + σ${sub('k')}${sup('2')}) / k</code> = <b>${nf(e.Vbar, 6)}</b>.</li>
        <li>Covarianza promedio de los ${(k * (k - 1)) / 2} pares: <code>C̄ = Σ σ${sub('ij')} / [k(k − 1)/2]</code> = <b>${nf(e.Cbar, 6)}</b>.</li>
        <li>Con pesos iguales <code>w${sub('i')} = 1/k = ${nf(1 / k, 4)}</code>: <code>σ${sub('p')}${sup('2')} = V̄/k + (1 − 1/k)·C̄</code> = ${nf(e.Vbar, 6)}/${k} + ${nf(1 - 1 / k, 4)} × ${nf(e.Cbar, 6)} = <b>${nf(e.varP, 6)}</b> → <code>σ${sub('p')}</code> = <b>${pct(e.volP, 2)}</b>.</li>
        <li>Sin diversificar, el riesgo sería el promedio de los σ: <code>σ̄ = Σσ${sub('i')}/k</code> = <b>${pct(e.sigBar, 2)}</b>. Reducción por diversificación: <code>1 − σ${sub('p')}/σ̄</code> = 1 − ${pct(e.volP, 2)}/${pct(e.sigBar, 2)} = <b>${pct(e.red, 1)}</b>.</li>
        <li>Correlación promedio: <code>ρ̄ = Σ ρ${sub('ij')} / [k(k − 1)/2]</code> = <b>${nf(e.rho, 4)}</b>. Mínima varianza dentro del grupo (sin ventas en corto): σ${sub('p')} = <b>${pct(e.mv.vol, 2)}</b> con ${e.S.map((i, a) => `${nm(i)} ${pct(e.mv.w[a], 1)}`).join(', ')}.</li>
      </ol>
      <p class="hint">La fórmula del paso 3 muestra por qué la correlación manda: al crecer k, el término V̄/k se va a cero y el riesgo queda en <code>σ${sub('p')}${sup('2')} → C̄</code>. Lo que <b>no</b> se puede diversificar es la covarianza promedio; por eso se eligen activos con covarianzas (y correlaciones) bajas entre sí.</p>`);

    // Construcción paso a paso
    out.push(`<h3>Cómo se arma el grupo paso a paso</h3>
      <p>Regla para agregar un activo <i>i</i> a un portafolio <i>p</i> (Elton y Gruber): el riesgo baja si <code>ρ${sub('i,p')} &lt; σ${sub('p')} / σ${sub('i')}</code>, donde <code>ρ${sub('i,p')} = Cov(r${sub('i')}, r${sub('p')}) / (σ${sub('i')} σ${sub('p')})</code> y <code>Cov(r${sub('i')}, r${sub('p')}) = Σ${sub('j')} w${sub('j')} σ${sub('ij')}</code>. Entre los que cumplen, el que menos se correlaciona con lo que ya se tiene es el que más diversifica.</p>
      <ol>${G.steps
        .map((s, n) => {
          if (n === 0) return `<li>Se parte del par menos correlacionado: <b>${nm(s.add[0])}</b> y <b>${nm(s.add[1])}</b>, ρ = ${nf(m.corr[s.add[0]][s.add[1]], 4)}. Con 50 % y 50 %, σ${sub('p')} = ${pct(s.e.volP, 2)}.</li>`;
          const c = s.cands[0];
          const tbl = `<div class="table-scroll"><table class="data"><thead><tr><th>Candidato</th><th class="n">σ${sub('i')}</th><th class="n">ρ${sub('i,p')}</th><th class="n">Límite σ${sub('p')}/σ${sub('i')}</th><th>¿Baja el riesgo?</th><th class="n">σ${sub('p')} si entra</th></tr></thead><tbody>${s.cands
            .slice(0, 6)
            .map((x, r) => `<tr${r === 0 ? ' class="hl"' : ''}><td>${nm(x.i)}</td><td class="n">${pct(m.vol[x.i], 2)}</td><td class="n" ${lk(x.rhoIP)}>${nf(x.rhoIP, 3)}</td><td class="n">${nf(x.lim, 3)}</td><td>${x.helps ? '<span class="pos">Sí</span>' : '<span class="neg">No</span>'}</td><td class="n">${pct(x.after.volP, 2)}</td></tr>`)
            .join('')}</tbody></table></div>`;
          return `<li>Portafolio actual con σ${sub('p')} = ${pct(s.before.volP, 2)}. Entra <b>${nm(c.i)}</b>: ρ${sub('i,p')} = ${nf(c.rhoIP, 3)}${c.helps ? ` &lt; ${nf(c.lim, 3)}, así que baja el riesgo` : ` ≥ ${nf(c.lim, 3)}: ninguno lo baja, se toma el menos correlacionado`}. Queda σ${sub('p')} = ${pct(s.e.volP, 2)} (reducción ${pct(s.e.red, 1)}).${tbl}</li>`;
        })
        .join('')}</ol>
      <p class="hint">El método paso a paso es rápido y fácil de seguir, pero no siempre da el mejor grupo: la tabla de arriba prueba todas las combinaciones. Resultado paso a paso: ${G.set.map(nm).join(', ')} (reducción ${pct(evalSet(m, G.set).red, 1)}).</p>`);

    // Criterio según el signo de las correlaciones
    out.push(`<h3>¿Correlaciones negativas o positivas? El criterio</h3>
      <p>En tus ${N} activos hay <b>${P.length}</b> pares: <span ${lk(-0.6)}>&nbsp;${neg} negativos (ρ &lt; −0,1)&nbsp;</span> <span ${lk(0)}>&nbsp;${zero} cercanos a cero&nbsp;</span> <span ${lk(0.6)}>&nbsp;${pos} positivos (ρ &gt; 0,1)&nbsp;</span>. Caso que aplica: <b>${caso}</b>.</p>
      <div class="table-scroll"><table class="data"><thead><tr><th>Correlación</th><th>Qué pasa con el riesgo</th><th>Cuál conviene</th></tr></thead><tbody>
        <tr><td ${lk(-1)}>ρ = −1</td><td>Cobertura perfecta: con <code>w${sub('A')} = σ${sub('B')}/(σ${sub('A')} + σ${sub('B')})</code> el riesgo es <b>cero</b>.</td><td>Es el ideal teórico; en bolsa casi no existe.</td></tr>
        <tr><td ${lk(-0.5)}>−1 &lt; ρ &lt; 0</td><td>Siempre diversifica: el término <code>2 w${sub('A')}w${sub('B')}σ${sub('AB')}</code> <b>resta</b> varianza. Es lo mejor para bajar riesgo.</td><td>Entre negativas, diversifica más la más negativa; a igual ρ, la de menor σ. Ojo: muchas coberturas rinden poco (revisa E(R) y Sharpe).</td></tr>
        <tr><td ${lk(0)}>ρ = 0</td><td>No suma ni resta: con pesos iguales <code>σ${sub('p')} = σ/√k</code> si todas tienen el mismo σ.</td><td>Muy buena: el riesgo baja con la raíz del número de activos.</td></tr>
        <tr><td ${lk(0.5)}>0 &lt; ρ &lt; ρ*</td><td>Diversifica, pero menos: la mezcla queda por debajo del activo menos riesgoso solo si <code>ρ &lt; ρ* = σ${sub('menor')}/σ${sub('mayor')}</code>.</td><td>Entre positivas, gana la de menor ρ y, a igual ρ, la que tiene σ parecido (ρ* más alto).</td></tr>
        <tr><td ${lk(0.95)}>ρ* ≤ ρ ≤ 1</td><td>No baja el riesgo por debajo del activo menos riesgoso: la mínima varianza pone 100 % en él. Con ρ = 1 no hay ninguna diversificación.</td><td>Evitar como pareja si el objetivo es diversificar.</td></tr>
      </tbody></table></div>
      <ul class="sym">
        <li><b>Si todas son positivas</b> (lo usual en acciones de un mismo país, porque todas dependen del mercado): el piso de riesgo es <code>σ${sub('p')}${sup('2')} → C̄ ≈ ρ̄ σ̄${sup('2')}</code>. Diversifican más los activos con menor ρ̄ con el resto, y sirven más los de otros sectores o segmentos (renta fija, divisas) que las acciones del mismo sector.</li>
        <li><b>Si todas son negativas</b>: con k activos no pueden ser todas muy negativas a la vez. La correlación promedio no puede bajar de <code>ρ̄ ≥ −1/(k − 1)</code>; con k = ${k} el mínimo es <b>${nf(floor, 4)}</b>. Entre negativas, diversifica más el par con ρ más negativo, y su efecto en pesos es la covarianza <code>σ${sub('ij')} = ρ${sub('ij')} σ${sub('i')} σ${sub('j')}</code>: una ρ moderada entre activos volátiles puede quitar más varianza que una ρ fuerte entre activos tranquilos.</li>
        <li><b>Si están mezcladas</b>: primero los pares negativos o cercanos a cero; luego, entre los positivos, los de menor ρ. Siempre se comprueba con la regla <code>ρ${sub('i,p')} &lt; σ${sub('p')}/σ${sub('i')}</code>, que mira la relación con <b>todo</b> el portafolio y no solo con un activo.</li>
        <li><b>El rendimiento también cuenta</b>: elegir solo por correlación puede dejar activos que rinden poco. Compara la columna E(R${sub('p')}) y Sharpe de la tabla de arriba; la frontera eficiente (sección 8) hace el balance completo riesgo-rendimiento.</li>
        <li><b>Las correlaciones cambian</b>: en las crisis tienden a subir (Longin y Solnik, 2001), justo cuando más se necesita la diversificación. Revisa la selección con la ventana de análisis más reciente.</li>
      </ul>`);

    // Pares
    out.push(`<h3>Todos los pares, de la correlación más baja a la más alta</h3>
      <div class="table-scroll hscroll" style="max-height:420px"><table class="data"><thead><tr><th>Activo menos riesgoso</th><th>Activo más riesgoso</th><th class="n">ρ</th><th class="n">ρ* = σ${sub('menor')}/σ${sub('mayor')}</th><th>¿Diversifica?</th><th class="n">σ${sub('p')} 50/50</th><th class="n">σ${sub('p')} mínima varianza</th><th class="n">Peso del menos riesgoso</th></tr></thead><tbody>${P.map(
        (p) => `<tr><td>${nm(p.lo)} (${pct(m.vol[p.lo], 1)})</td><td>${nm(p.hi)} (${pct(m.vol[p.hi], 1)})</td><td class="n" ${lk(p.rho)}>${nf(p.rho, 3)}</td><td class="n">${nf(p.lim, 3)}</td><td>${p.rho < p.lim ? '<span class="pos">Sí, baja el riesgo</span>' : '<span class="neg">No</span>'}</td><td class="n">${pct(p.eqVol, 2)}</td><td class="n">${pct(p.mvVol, 2)}</td><td class="n">${pct(p.wLo, 1)}</td></tr>`
      ).join('')}</tbody></table></div>
      <p class="table-note">Peso de mínima varianza de dos activos: <code>w${sub('A')} = (σ${sub('B')}${sup('2')} − σ${sub('AB')}) / (σ${sub('A')}${sup('2')} + σ${sub('B')}${sup('2')} − 2σ${sub('AB')})</code>, acotado entre 0 y 100 %. Colores: rojo y naranja, correlación negativa; amarillo, cercana a cero; verdes, positiva.</p>
      <p class="hint">Referencias: Markowitz (1952); Elton y Gruber (1977), «Risk reduction and portfolio size»; Evans y Archer (1968); Statman (1987), «How many stocks make a diversified portfolio?»; Choueifaty y Coignard (2008), razón de diversificación; Longin y Solnik (2001).</p>`);
    return out.join('');
  }

  PF.diversif = { evalSet, minVar, best, greedy, pairs, render, binom };
})(typeof window !== 'undefined' ? window : globalThis);
