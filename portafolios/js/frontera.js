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
   * El ponderado es la correlación promedio implícita: con ella, σₚ² = Σwᵢ²σᵢ² + ρ̄w[(Σwᵢσᵢ)² − Σwᵢ²σᵢ²]. */
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


  /* Activos que entran (peso > 0,5 %) ordenados por peso, y los que quedan fuera. */
  function holdings(m, w, pct, esc) {
    const idx = m.names.map((_, i) => i).sort((a, b) => w[b] - w[a]);
    const inn = idx.filter((i) => Math.abs(w[i]) > 0.005);
    const out = idx.filter((i) => Math.abs(w[i]) <= 0.005);
    return `<p><b>Entran</b> (${inn.length}): ${inn.map((i) => `${esc(m.names[i])} ${pct(w[i], 1)}`).join(' · ')}.${out.length ? ` <b>Quedan fuera</b> (${out.length}): ${out.map((i) => esc(m.names[i])).join(', ')}.` : ''}</p>`;
  }

  function detail(c) {
    const { m, P, ports, sel, tan, top, tb, pct, esc, nf, N } = c;
    const lbl = (k) => (ports.find((p) => p.key === k) || {}).label || k;
    const res = (e) => `<ul class="sym"><li>Rendimiento esperado <code>E(Rₚ) = Σ wᵢ E(Rᵢ)</code> = <b>${pct(e.ret)}</b>; riesgo <code>σₚ = √(wᵀΣw)</code> = <b>${pct(e.vol)}</b>.</li><li>Sharpe <code>(E(Rₚ) − rf)/σₚ</code> = ${nf(e.sharpe, 3)} · β = ${nf(e.beta, 3)} · Treynor = ${pct(e.treynor)} · α de Jensen = ${pct(e.jensen, 2)} · N efectivo <code>1/Σwᵢ²</code> = ${nf(e.effN, 1)}.</li></ul>`;
    const box = (k, title, theory, problem, steps, data, use) => {
      const e = P[k];
      return `<div class="panel pf-detail${k === sel ? ' pf-sel' : ''}" id="pf-${k}"><h2>${title}${k === sel ? ' <span class="pos">· elegido</span>' : ''}</h2>
        <h3>Teoría</h3>${theory}
        <h3>Problema que resuelve</h3>${problem}
        <h3>Cómo se calcula, paso a paso</h3><ol>${steps.map((x) => `<li>${x}</li>`).join('')}</ol>
        ${e ? `<h3>Resultado con tus datos</h3>${holdings(m, e.w, pct, esc)}${res(e)}${data || ''}` : data || ''}
        <h3>Cuándo usarlo</h3>${use}</div>`;
    };
    const out = [];
    const Sw = (w) => m.Sigma.map((row) => row.reduce((q, x, j) => q + x * w[j], 0));

    out.push(`<div class="panel"><h2>11.1 La idea común: la frontera eficiente y la separación de Tobin</h2>
      <p><b>Markowitz (1952)</b> describe cada portafolio con dos números: su rendimiento esperado <code>E(Rₚ) = wᵀμ</code> y su riesgo <code>σₚ² = wᵀΣw</code>. Un inversionista racional y averso al riesgo prefiere más rendimiento con igual riesgo y menos riesgo con igual rendimiento. Los portafolios que nadie puede mejorar en las dos cosas a la vez forman la <b>frontera eficiente</b> (sección 8): todos los portafolios que siguen, menos los de referencia (pesos iguales y paridad de riesgo), son puntos de esa curva.</p>
      <p>Lo que cambia entre ellos es <b>qué punto de la curva</b> se elige, y eso depende de qué se le pide al portafolio:</p>
      <ul><li><b>Sin renta fija segura</b>: cada inversionista elige su punto según su aversión al riesgo. El extremo de menor riesgo es el de mínima varianza y el de mayor rendimiento es el de máximo rendimiento.</li>
      <li><b>Con renta fija segura</b> (Tobin, 1958): todos deberían tener el <b>mismo</b> portafolio de acciones, el tangente, y ajustar el riesgo solo con la proporción en renta fija. Es el <b>teorema de separación</b>: la decisión de <i>qué</i> acciones comprar no depende del gusto por el riesgo; solo la de <i>cuánto</i> poner en ellas.</li>
      <li><b>Con utilidad media-varianza</b> <code>U = E(Rₚ) − ½·A·σₚ²</code> (A = aversión al riesgo), la proporción óptima en el tangente es <code>y* = (E(R<sub>T</sub>) − rf) / (A·σ<sub>T</sub>²)</code>${tan ? `: con tus datos, A = 2 → ${pct((tan.ret - m.rf) / (2 * tan.vol * tan.vol), 0)}, A = 4 → ${pct((tan.ret - m.rf) / (4 * tan.vol * tan.vol), 0)}, A = 8 → ${pct((tan.ret - m.rf) / (8 * tan.vol * tan.vol), 0)} en el tangente y el resto en renta fija (más de 100 % significa pedir prestado)` : ''}.</li></ul>
      <p>Todos los portafolios usan los mismos datos (μ y Σ de la sección 4), los mismos límites (mínimo ${pct(Math.min(...P.lo), 0)}, tope ${pct(P.cap, 0)} por activo) y <code>Σwᵢ = 1</code>.</p></div>`);

    // Mínima varianza
    if (P.minVar) {
      const e = P.minVar;
      const g = Sw(e.w);
      const v = e.vol * e.vol;
      out.push(box('minVar', '11.2 Mínima varianza', `<p>Es el punto más a la izquierda de la frontera de <b>Markowitz (1952)</b>: el de menor riesgo posible. No usa los rendimientos esperados, que son el dato más incierto de todo el modelo (Merton, 1980; Jagannathan y Ma, 2003): por eso suele ser el portafolio más estable cuando se recalcula con datos nuevos.</p>`,
        `<p class="formula"><code>min wᵀΣw &nbsp; sujeto a &nbsp; Σwᵢ = 1, &nbsp; w<sub>mín</sub> ≤ wᵢ ≤ w<sub>máx</sub></code></p>`,
        ['Se arma la matriz Σ de varianzas y covarianzas anual.', 'Se resuelve el problema cuadrático: se busca la combinación de pesos que deja la suma <code>Σᵢ Σⱼ wᵢwⱼσᵢⱼ</code> en su mínimo (método de conjunto activo).', 'En el óptimo, todo activo que se compra sin tocar sus límites tiene el mismo <b>riesgo marginal</b> <code>(Σw)ᵢ = σₚ²</code>: si uno tuviera menos, convendría subirle el peso y bajar el riesgo total.', 'Un activo con riesgo marginal mayor que σₚ² queda en el mínimo; uno con menor sube hasta el tope.'],
        `<div class="table-scroll"><table class="data"><thead><tr><th>Activo</th><th class="n">Peso</th><th class="n">σᵢ</th><th class="n">Riesgo marginal (Σw)ᵢ</th><th class="n">σₚ²</th></tr></thead><tbody>${m.names.map((n, i) => `<tr><td>${esc(n)}</td><td class="n">${pct(e.w[i], 1)}</td><td class="n">${pct(m.vol[i])}</td><td class="n">${nf(g[i], 5)}</td><td class="n">${nf(v, 5)}</td></tr>`).join('')}</tbody></table></div>`,
        '<p>Inversionistas muy aversos al riesgo, horizontes cortos o cuando no se confía en los rendimientos esperados. Su desventaja: puede tener poco rendimiento y concentrarse en los activos menos volátiles.</p>'));
    }

    // Máximo rendimiento
    if (top) {
      const order = m.names.map((_, i) => i).sort((a, b) => m.mu[b] - m.mu[a]);
      out.push(box('__maxret', '11.3 Máximo rendimiento', `<p>Es el extremo derecho de la frontera. Sin límites de peso sería un solo activo, el de mayor E(R): no hay diversificación. Con un tope por activo, reparte entre los de mayor rendimiento esperado.</p>`,
        `<p class="formula"><code>max wᵀμ &nbsp; sujeto a &nbsp; Σwᵢ = 1, &nbsp; w<sub>mín</sub> ≤ wᵢ ≤ ${pct(P.cap, 0)}</code></p>`,
        ['Se ordenan los activos por rendimiento esperado, de mayor a menor.', `Se llena cada uno hasta el tope (${pct(P.cap, 0)}) en ese orden, hasta completar el 100 %.`, 'El riesgo no interviene: es el punto de la frontera con mayor E(R) y, casi siempre, el de mayor σ.'],
        `${holdings(m, top.w, pct, esc)}<ul class="sym"><li>Orden por E(R): ${order.map((i) => `${esc(m.names[i])} ${pct(m.mu[i])}`).join(' > ')}.</li><li>E(Rₚ) = <b>${pct(top.ret)}</b>, σₚ = <b>${pct(top.vol)}</b>, Sharpe = ${nf((top.ret - m.rf) / top.vol, 3)}.</li></ul>`,
        '<p>Solo como referencia del máximo alcanzable con los límites de peso. Es el más sensible a errores en los rendimientos esperados.</p>'));
    }

    // Tangente
    if (tan) {
      const slope = (tan.ret - m.rf) / tan.vol;
      out.push(box('tangency', '11.4 Máxima razón de Sharpe (portafolio tangente)', `<p><b>Tobin (1958)</b> mostró que, si se puede invertir o pedir prestado a la tasa libre de riesgo, el mejor portafolio de activos riesgosos es uno solo: el que maximiza la prima por unidad de riesgo. <b>Sharpe (1964)</b> y <b>Lintner (1965)</b> lo llevaron al equilibrio del mercado (CAPM): si todos piensan igual, el tangente es el portafolio de mercado. Su pendiente es la <b>razón de Sharpe</b> (Sharpe, 1966).</p>`,
        `<p class="formula"><code>max (wᵀμ − rf) / √(wᵀΣw) &nbsp; sujeto a &nbsp; Σwᵢ = 1, &nbsp; w<sub>mín</sub> ≤ wᵢ ≤ w<sub>máx</sub></code></p>`,
        ['Se calcula la frontera eficiente (sección 8).', 'Para cada punto se calcula su razón de Sharpe: (E(Rₚ) − rf) / σₚ.', 'La razón sube y luego baja a lo largo de la curva (es unimodal): se toma el punto más alto con una rejilla y se afina con búsqueda de sección áurea.', 'Geométricamente es el punto donde la recta que sale de rf toca la curva sin cortarla: la línea del mercado de capitales (sección 9).', 'Qué activos entran: los que pagan su aporte al riesgo del portafolio (condición de primer orden, sección 12).'],
        `<p>rf = ${pct(m.rf)} → pendiente de la CML = (${pct(tan.ret)} − ${pct(m.rf)}) / ${pct(tan.vol)} = <b>${nf(slope, 3)}</b>: ningún otro portafolio de la frontera da más rendimiento extra por cada punto de riesgo.</p>`,
        '<p>El portafolio de acciones de quien combina con renta fija segura (CDT, TES): la parte riesgosa siempre es esta, y el riesgo total se ajusta con la proporción en renta fija. Es el más defendible en teoría, pero depende mucho de los rendimientos esperados.</p>'));
    }

    // Recomendado
    if (P.recommended) {
      const d = P.recommended.div || {};
      out.push(box('recommended', '11.5 Recomendado: máximo rendimiento sin perder diversificación', `<p>Combina la frontera de <b>Markowitz (1952)</b> con una restricción de diversificación. Markowitz advirtió que el optimizador tiende a concentrarse en pocos activos (los de mayor rendimiento estimado), y que esas estimaciones tienen error (Michaud, 1989, lo llamó «maximizador de errores»). Medir la concentración con el <b>número efectivo de activos</b> <code>N = 1/Σwᵢ²</code> (el inverso del índice de Herfindahl-Hirschman) evita poner casi todo en dos o tres acciones.</p>`,
        `<p class="formula"><code>max wᵀμ &nbsp; sujeto a &nbsp; w eficiente, &nbsp; 1/Σwᵢ² ≥ N* = ${nf(d.target, 1)}, &nbsp; Σwᵢ = 1, &nbsp; loᵢ ≤ wᵢ ≤ tope</code></p>`,
        [`Se fija el nivel de diversificación (Datos → «${esc(d.level || 'media')}»): N* = ${nf(d.target, 1)} de ${N} activos.`, 'Se sube por la frontera desde el punto de mínima varianza, hacia más rendimiento, mientras el N efectivo siga siendo al menos N*.', 'Se toma el último punto que cumple y se afina por bisección entre ese y el siguiente, que ya no cumple.', `El tope por activo no es fijo: se prueba primero sin tope (o con el tuyo) y se baja de 5 en 5 puntos hasta que la frontera tenga portafolios con N ≥ N*. Aquí quedó en ${pct(P.cap, 0)}.`, 'Por construcción está sobre la frontera: es eficiente.'],
        tan ? `<p>Frente al tangente: rendimiento ${pct(P.recommended.ret)} vs ${pct(tan.ret)}, riesgo ${pct(P.recommended.vol)} vs ${pct(tan.vol)}, N efectivo ${nf(P.recommended.effN, 1)} vs ${nf(tan.effN, 1)}.</p>` : '',
        '<p>Para quien quiere el mayor rendimiento esperado sin apostar a pocos activos. Es menos sensible a errores de estimación que el de máximo rendimiento y suele rendir más que el de mínima varianza.</p>'));
    }

    // Máxima diversificación
    if (P.maxDiv) {
      const e = P.maxDiv;
      out.push(box('maxDiv', '11.6 Máxima diversificación', `<p><b>Choueifaty y Coignard (2008)</b> proponen maximizar la <b>razón de diversificación</b>: cuánto riesgo se elimina al combinar los activos. Si todos tuvieran correlación 1, el riesgo sería el promedio ponderado de las volatilidades <code>Σwᵢσᵢ</code>; el portafolio tiene σₚ, que es menor cuanto menos correlacionados estén.</p>`,
        `<p class="formula"><code>max DR = Σ wᵢσᵢ / √(wᵀΣw) &nbsp; sujeto a &nbsp; Σwᵢ = 1, &nbsp; w<sub>mín</sub> ≤ wᵢ ≤ w<sub>máx</sub></code></p>`,
        ['Es el mismo cálculo que el tangente, pero cambiando los rendimientos μ por las volatilidades σ y rf por 0: se busca el máximo de (Σwᵢσᵢ)/σₚ a lo largo de la frontera «de volatilidades».', 'En el óptimo, todos los activos que entran tienen la misma correlación con el portafolio: ninguno se mueve más con él que los demás.', 'No usa los rendimientos esperados.'],
        `<p>Razón de diversificación DR = ${nf(e.divRatio, 3)}: el riesgo real es ${pct(1 - 1 / e.divRatio, 0)} menor que si todo estuviera perfectamente correlacionado.</p>`,
        '<p>Cuando la prioridad es aprovechar la baja correlación entre activos (por ejemplo, acciones de sectores distintos, renta fija y dólar) y no se confía en los rendimientos esperados.</p>'));
    }

    // Paridad de riesgo
    if (P.riskParity) {
      const e = P.riskParity;
      out.push(box('riskParity', '11.7 Paridad de riesgo', `<p>Popularizada por <b>Qian (2005)</b> y estudiada por <b>Maillard, Roncalli y Teïletche (2010)</b>: en vez de repartir el dinero, se reparte el <b>riesgo</b>. Cada activo aporta la misma parte de la varianza del portafolio.</p>`,
        `<p class="formula"><code>CRᵢ = wᵢ·(Σw)ᵢ / σₚ² = 1/N &nbsp; para todo i, &nbsp; Σwᵢ = 1</code></p>`,
        ['La contribución al riesgo de cada activo es su peso por su riesgo marginal: <code>wᵢ(Σw)ᵢ</code>; las contribuciones suman σₚ².', 'Se busca el peso de cada activo que iguala todas las contribuciones (descenso cíclico por coordenadas, hasta que ningún peso cambie).', 'Los activos más volátiles o más correlacionados con los demás reciben menos dinero.', 'No usa los rendimientos esperados ni aplica los límites de peso.'],
        `<div class="table-scroll"><table class="data"><thead><tr><th>Activo</th><th class="n">Peso</th><th class="n">Contribución al riesgo</th></tr></thead><tbody>${m.names.map((n, i) => `<tr><td>${esc(n)}</td><td class="n">${pct(e.w[i], 1)}</td><td class="n">${pct(e.riskContrib[i], 1)}</td></tr>`).join('')}</tbody></table></div>${P.riskParityInBounds ? '' : '<p>Sus pesos salen de tus límites, así que no se compara con la frontera de esos límites (sección 13).</p>'}`,
        '<p>Para un portafolio equilibrado en riesgo que no dependa de los rendimientos esperados. Suele quedar cerca de la frontera, pero no sobre ella.</p>'));
    }

    // Pesos iguales
    if (P.equal) {
      out.push(box('equal', '11.8 Pesos iguales (1/N)', `<p>La diversificación ingenua: el mismo dinero en cada activo. <b>DeMiguel, Garlappi y Uppal (2009)</b> mostraron que, con pocos datos, le gana fuera de muestra a muchos modelos optimizados, porque no tiene error de estimación. Sirve como punto de comparación.</p>`,
        `<p class="formula"><code>wᵢ = 1/N = ${pct(1 / N, 1)}</code> (ajustado a los límites)</p>`,
        ['No se optimiza nada: cada uno de los N activos recibe 1/N.', 'Con N activos de igual varianza y covarianza, <code>σₚ² = σ̄²/N + (1 − 1/N)·cov̄</code> (Elton y Gruber, 1977): el riesgo propio se diluye y queda la covarianza promedio.'],
        '',
        '<p>Como referencia: si un portafolio optimizado no le gana a 1/N, conviene desconfiar de sus estimaciones. Rara vez está sobre la frontera.</p>'));
    }

    // Treynor-Black
    if (tb) {
      const idx = m.assets.map((_, i) => i).filter((i) => Math.abs(tb.wA[i]) > 1e-6).sort((a, b) => Math.abs(tb.wA[b]) - Math.abs(tb.wA[a])).slice(0, 12);
      out.push(`<div class="panel pf-detail" id="pf-tb"><h2>11.9 Treynor-Black (índice + cartera activa)</h2>
        <h3>Teoría</h3><p><b>Treynor y Black (1973)</b> parten de que el mercado es casi eficiente: la base es el índice ${esc(m.marketName)}. Si el análisis indica que algunos activos tienen α de Jensen distinto de cero, se arma una <b>cartera activa</b> con ellos y se combina con el índice. Usa el modelo de índice único de <b>Sharpe (1963)</b>: <code>rᵢ = αᵢ + βᵢ rₘ + εᵢ</code>.</p>
        <h3>Cómo se calcula, paso a paso</h3><ol>
          <li>Para cada activo: α (Jensen), β y varianza residual σ²(εᵢ) de la regresión contra el índice.</li>
          <li>Peso dentro de la cartera activa: <code>wᵢ ∝ αᵢ / σ²(εᵢ)</code> (la «razón de valoración»: α por unidad de riesgo propio). Un α negativo da peso negativo (venta en corto).</li>
          <li>α, β y riesgo propio de la cartera activa: α<sub>A</sub> = ${pct(tb.alphaA, 2)}, β<sub>A</sub> = ${nf(tb.betaA, 3)}, σ²(e<sub>A</sub>) = ${nf(tb.resA, 5)}.</li>
          <li>Peso de la cartera activa: <code>w₀ = [α<sub>A</sub>/σ²(e<sub>A</sub>)] / [(E(Rₘ) − rf)/σₘ²]</code>, ajustado por su beta: <code>w* = w₀ / [1 + (1 − β<sub>A</sub>)·w₀]</code> = <b>${pct(tb.wActive)}</b>; en el índice: ${pct(tb.wIndex)}.</li>
          <li>Sharpe resultante: <code>√(Sₘ² + IR²)</code> = √(${nf(tb.sharpeMkt, 3)}² + ${nf(tb.ir, 3)}²) = <b>${nf(tb.sharpeP, 3)}</b>, donde IR es la razón de información de la cartera activa.</li></ol>
        <h3>Resultado con tus datos</h3>
        <div class="table-scroll"><table class="data"><thead><tr><th>Activo</th><th class="n">α de Jensen</th><th class="n">σ²(ε)</th><th class="n">Peso en la cartera activa</th><th class="n">Peso total</th></tr></thead><tbody>${idx.map((i) => `<tr><td>${esc(m.names[i])}</td><td class="n">${pct(m.assets[i].jensenM, 2)}</td><td class="n">${nf(m.assets[i].residVarM, 5)}</td><td class="n">${pct(tb.wA[i], 1)}</td><td class="n">${pct(tb.assetW[i], 1)}</td></tr>`).join('')}</tbody></table></div>
        <p>${tb.significant} de ${N} alfas son significativos (|t| ≥ 2)${tb.shorts ? '; hay pesos negativos (ventas en corto)' : ''}.</p>
        <h3>Cuándo usarlo</h3><p>Cuando se tiene un análisis propio que justifica alfas (por ejemplo, valoración fundamental) y se quiere apostar a ellos sin abandonar el índice. Con alfas históricos poco significativos, sus pesos son inestables.</p></div>`);
    }

    // Guía para elegir
    out.push(`<div class="panel"><h2>11.10 ¿Cuál elegir?</h2>
      <div class="table-scroll"><table class="data"><thead><tr><th>Si tu situación es…</th><th>Portafolio</th><th>Por qué</th></tr></thead><tbody>
        <tr><td>Vas a combinar acciones con CDT o TES</td><td>${esc(lbl('tangency'))}</td><td>Separación de Tobin: es la mejor parte riesgosa; ajusta el riesgo con la renta fija (sección 9).</td></tr>
        <tr><td>Quieres el mayor rendimiento sin concentrarte</td><td>${esc(lbl('recommended'))}</td><td>Eficiente y con un N efectivo mínimo.</td></tr>
        <tr><td>Quieres el menor riesgo posible o no confías en los rendimientos esperados</td><td>${esc(lbl('minVar'))}</td><td>No usa μ; es el más estable.</td></tr>
        <tr><td>Quieres aprovechar activos poco correlacionados</td><td>${esc(lbl('maxDiv'))}</td><td>Maximiza el riesgo eliminado por la diversificación.</td></tr>
        <tr><td>Quieres que ningún activo domine el riesgo</td><td>${esc(lbl('riskParity'))}</td><td>Cada activo aporta lo mismo al riesgo.</td></tr>
        <tr><td>Crees tener información que el mercado no tiene (alfas)</td><td>Treynor-Black</td><td>Índice más una cartera activa según α/σ²(ε).</td></tr>
        <tr><td>Quieres una referencia sin estimaciones</td><td>${esc(lbl('equal'))}</td><td>Si los optimizados no le ganan, desconfía de los datos.</td></tr>
      </tbody></table></div>
      <p>En todos los casos, revisa en la sección 13 dónde queda frente a la frontera, la CML y la SML, y en Confirmar si lo que compraste sigue siendo eficiente.</p>
      <h3>Referencias</h3><ul class="refs">
        <li>Choueifaty, Y. y Coignard, Y. (2008). Toward maximum diversification. <i>Journal of Portfolio Management, 35</i>(1), 40-51.</li>
        <li>DeMiguel, V., Garlappi, L. y Uppal, R. (2009). Optimal versus naive diversification: How inefficient is the 1/N portfolio strategy? <i>Review of Financial Studies, 22</i>(5), 1915-1953.</li>
        <li>Elton, E. J. y Gruber, M. J. (1977). Risk reduction and portfolio size: An analytical solution. <i>Journal of Business, 50</i>(4), 415-437.</li>
        <li>Jagannathan, R. y Ma, T. (2003). Risk reduction in large portfolios: Why imposing the wrong constraints helps. <i>Journal of Finance, 58</i>(4), 1651-1683.</li>
        <li>Lintner, J. (1965). The valuation of risk assets and the selection of risky investments in stock portfolios and capital budgets. <i>Review of Economics and Statistics, 47</i>(1), 13-37.</li>
        <li>Maillard, S., Roncalli, T. y Teïletche, J. (2010). The properties of equally weighted risk contribution portfolios. <i>Journal of Portfolio Management, 36</i>(4), 60-70.</li>
        <li>Markowitz, H. (1952). Portfolio selection. <i>Journal of Finance, 7</i>(1), 77-91.</li>
        <li>Merton, R. C. (1980). On estimating the expected return on the market. <i>Journal of Financial Economics, 8</i>(4), 323-361.</li>
        <li>Michaud, R. O. (1989). The Markowitz optimization enigma: Is «optimized» optimal? <i>Financial Analysts Journal, 45</i>(1), 31-42.</li>
        <li>Qian, E. (2005). <i>Risk parity portfolios: Efficient portfolios through true diversification</i>. PanAgora Asset Management.</li>
        <li>Sharpe, W. F. (1963). A simplified model for portfolio analysis. <i>Management Science, 9</i>(2), 277-293.</li>
        <li>Sharpe, W. F. (1964). Capital asset prices: A theory of market equilibrium under conditions of risk. <i>Journal of Finance, 19</i>(3), 425-442.</li>
        <li>Sharpe, W. F. (1966). Mutual fund performance. <i>Journal of Business, 39</i>(1), 119-138.</li>
        <li>Tobin, J. (1958). Liquidity preference as behavior towards risk. <i>Review of Economic Studies, 25</i>(2), 65-86.</li>
        <li>Treynor, J. L. y Black, F. (1973). How to use security analysis to improve portfolio selection. <i>Journal of Business, 46</i>(1), 66-86.</li>
      </ul></div>`);
    return out.join('');
  }

  function render(ctx) {
    const { m, P, esc, pct } = ctx;
    if (!m || !P || !P.frontier) return '';
    const C = PF.charts;
    const nf = (x, d = 4) => PF.data.fmtNum(x, d);
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
    const chartPorts = ports.map((p) => ({ key: 'front:' + p.key, label: p.short || p.label, vol: P[p.key].vol, ret: P[p.key].ret, sel: p.key === sel, shape: p.shape }));
    chartPorts.sort((a, b) => a.sel - b.sel);
    const assets = m.assets.map((a) => ({ name: a.name, short: a.name.slice(0, 14), vol: a.vol, ret: a.expRet, beta: a.betaM }));
    const user = ctx.user ? { key: 'conf:me', vol: ctx.user.vol, ret: ctx.user.ret, label: 'Tu portafolio' } : null;
    let chart = '';
    try {
      chart = C ? C.riskReturn({ width, front: P.frontier, rf: m.rf, tangent: tan, assets, ports: chartPorts.reverse(), user }) : '';
    } catch (e) {
      chart = '';
    }
    /* Paso 2 explicado con matemáticas simples y los datos cargados. Nomenclatura de toda la app:
     * subíndice ₚ = portafolio, ₘ = mercado (índice), ᵢ y ⱼ = activos, T = portafolio tangente, rf = tasa libre de riesgo */
    const paso2 = () => {
      const Ep = E && E.w ? E : P.frontier[Math.floor(P.frontier.length / 2)];
      const sub = (x) => `<sub>${x}</sub>`;
      const sup = (x) => `<sup>${x}</sup>`;
      // Ejemplo con los dos activos de mayor peso del portafolio elegido, en partes iguales
      const ord = m.names.map((n, i) => [i, Ep.w[i]]).sort((a, b) => b[1] - a[1]);
      const a = ord[0][0];
      const b = (ord[1] || ord[0])[0];
      const A = esc(m.names[a]);
      const B = esc(m.names[b]);
      const muA = m.mu[a];
      const muB = m.mu[b];
      const vA = m.Sigma[a][a];
      const vB = m.Sigma[b][b];
      const cAB = m.Sigma[a][b];
      const ex = 0.5 * muA + 0.5 * muB;
      const vx = 0.25 * vA + 0.25 * vB + 2 * 0.25 * cAB;
      const terms = m.names.map((n, i) => ({ n, w: Ep.w[i], mu: m.mu[i] })).filter((x) => Math.abs(x.w) > 5e-4).sort((x, y) => y.w - x.w);
      const shown = terms.slice(0, 6);
      const sumR = terms.reduce((q, x) => q + x.w * x.mu, 0);
      const wTxt = (w) => String(Math.round(w * 10000) / 10000).replace('.', ',');
      const ks = [0, Math.floor((P.frontier.length - 1) / 2), P.frontier.length - 1];
      const tOf = (k) => (k === 0 ? 0 : k === P.frontier.length - 1 ? Infinity : P.front[k] && P.front[k].t);
      const lo = pct(Math.min(...P.lo), 0);
      const hi = pct(P.cap, 0);
      return `<p><b>¿Qué significa «min»?</b> Es la abreviatura de <b>minimizar</b>: entre todas las combinaciones de pesos posibles, quedarse con la que da el valor <b>más pequeño</b> de lo que viene después (aquí, la varianza del portafolio, es decir, su riesgo). <b>«sujeto a»</b> introduce las condiciones que deben cumplir los pesos. En palabras: <i>«de todos los portafolios que rinden lo mismo (R*), elige el que tiene menos riesgo»</i>.</p>
      <p class="formula"><code>min σ${sub('p')}${sup('2')} = w${sup('T')}Σw &nbsp; sujeto a &nbsp; w${sup('T')}μ = R*, &nbsp; w${sub('1')} + w${sub('2')} + … + w${sub('N')} = 1, &nbsp; w${sub('mín')} ≤ w${sub('i')} ≤ w${sub('máx')}</code></p>
      <h4>Qué es cada símbolo</h4>
      <ul class="sym">
        <li><code>w${sub('i')}</code>: <b>peso</b> del activo i, la fracción del dinero que se pone en él (w = 0,25 es el 25 %). <code>w</code> es la lista de los ${N} pesos: w${sub('1')}, w${sub('2')}, …, w${sub('N')}.</li>
        <li><code>μ${sub('i')}</code>: rendimiento esperado anual del activo i. <code>σ${sub('i')}${sup('2')}</code>: su varianza. <code>σ${sub('ij')}</code>: covarianza entre los activos i y j. <code>Σ</code> (sigma mayúscula): la tabla con todas las varianzas y covarianzas (sección 4).</li>
        <li>El superíndice <code>${sup('T')}</code> (transpuesta) solo indica que la lista de pesos se escribe como fila para multiplicarla; no cambia ningún valor.</li>
        <li><code>w${sup('T')}μ</code> es el <b>rendimiento esperado del portafolio</b>: <code>E(R${sub('p')}) = w${sub('1')}μ${sub('1')} + w${sub('2')}μ${sub('2')} + … + w${sub('N')}μ${sub('N')}</code> (cada peso por el rendimiento de su activo, sumados).</li>
        <li><code>w${sup('T')}Σw</code> es la <b>varianza del portafolio</b>: <code>σ${sub('p')}${sup('2')} = Σ${sub('i')} Σ${sub('j')} w${sub('i')} w${sub('j')} σ${sub('ij')}</code>, la suma de todas las casillas de la tabla Σ multiplicadas por los pesos de su fila y de su columna (sección 5).</li>
        <li><code>R*</code>: el rendimiento que se pide. <code>w${sub('mín')}</code> y <code>w${sub('máx')}</code>: peso mínimo y máximo por activo (aquí ${lo} y ${hi}, de Datos → Supuestos).</li>
      </ul>
      <h4>Las fórmulas con números: dos activos en partes iguales</h4>
      <p>Con ${A} (A) y ${B} (B), los de mayor peso en el portafolio ${esc(selP.label)}, y w${sub('A')} = w${sub('B')} = 0,5:</p>
      <p class="formula"><code>E(R${sub('p')}) = w${sub('A')}μ${sub('A')} + w${sub('B')}μ${sub('B')}</code> = 0,5 × ${pct(muA, 2)} + 0,5 × ${pct(muB, 2)} = <b>${pct(ex, 2)}</b></p>
      <p class="formula"><code>σ${sub('p')}${sup('2')} = w${sub('A')}${sup('2')}σ${sub('A')}${sup('2')} + w${sub('B')}${sup('2')}σ${sub('B')}${sup('2')} + 2 w${sub('A')}w${sub('B')}σ${sub('AB')}</code> = 0,25 × ${nf(vA, 6)} + 0,25 × ${nf(vB, 6)} + 2 × 0,25 × ${nf(cAB, 6)} = <b>${nf(vx, 6)}</b></p>
      <p class="formula"><code>σ${sub('p')} = √σ${sub('p')}${sup('2')}</code> = √${nf(vx, 6)} = <b>${pct(Math.sqrt(Math.max(0, vx)), 2)}</b> &nbsp; (cada uno por separado: σ${sub('A')} = ${pct(Math.sqrt(vA), 2)}, σ${sub('B')} = ${pct(Math.sqrt(vB), 2)})</p>
      <p class="hint">El término <code>2 w${sub('A')}w${sub('B')}σ${sub('AB')}</code> es el de la diversificación: si los activos no se mueven juntos (covarianza baja o negativa), quita riesgo. Con ${N} activos hay ${N} términos de varianza y ${N * (N - 1)} de covarianza; la suma completa está en la sección 5.</p>
      <h4>Con todos los activos del portafolio ${esc(selP.label)}</h4>
      <p class="formula"><code>E(R${sub('p')})</code> = ${shown.map((x) => `${wTxt(x.w)} × ${pct(x.mu, 2)}`).join(' + ')}${terms.length > shown.length ? ` + … (${terms.length - shown.length} términos más)` : ''} = <b>${pct(sumR, 2)}</b></p>
      <p class="formula"><code>σ${sub('p')}${sup('2')} = w${sup('T')}Σw</code> = <b>${nf(Ep.vol * Ep.vol, 6)}</b> &nbsp;→&nbsp; <code>σ${sub('p')}</code> = <b>${pct(Ep.vol, 2)}</b></p>
      <h4>Las condiciones («sujeto a»)</h4>
      <ul class="sym">
        <li><code>w${sup('T')}μ = R*</code>: el portafolio debe rendir exactamente el objetivo R*. El problema se repite con muchos R* distintos y cada solución es un punto de la curva.</li>
        <li><code>w${sub('1')} + w${sub('2')} + … + w${sub('N')} = 1</code>: se invierte el 100 % del dinero.</li>
        <li><code>w${sub('mín')} ≤ w${sub('i')} ≤ w${sub('máx')}</code>: ningún activo pesa menos de ${lo} ni más de ${hi} (sin ventas en corto si el mínimo es 0).</li>
      </ul>
      <h4>Cómo lo resuelve la app: la tolerancia al riesgo t</h4>
      <p>En vez de fijar R*, se minimiza una sola expresión que pone en la balanza el riesgo y el rendimiento:</p>
      <p class="formula"><code>min ½ σ${sub('p')}${sup('2')} − t · E(R${sub('p')}) &nbsp; = &nbsp; min ½ w${sup('T')}Σw − t · w${sup('T')}μ</code></p>
      <ul class="sym">
        <li><code>t</code> dice cuánto rendimiento vale una unidad de riesgo. Con <code>t = 0</code> solo se minimiza el riesgo (portafolio de <b>mínima varianza</b>, extremo izquierdo de la curva); al subir <code>t</code> se acepta más riesgo a cambio de más rendimiento y el punto sube por la curva; con <code>t</code> muy grande (t → ∞) solo cuenta el rendimiento (<b>máximo rendimiento</b>, extremo derecho).</li>
        <li>El <code>½</code> no cambia la solución, solo simplifica la derivada. Al derivar e igualar a cero (sin límites de peso) queda <code>Σw = t · μ + λ · 1</code>: el riesgo que aporta cada activo es proporcional a su rendimiento (Markowitz, 1952).</li>
        <li>Con los límites de peso se resuelve por programación cuadrática (método de conjunto activo): cada t da un portafolio (σ${sub('p')}, E(R${sub('p')})).</li>
      </ul>
      <div class="table-scroll"><table class="data"><thead><tr><th>Punto de la frontera</th><th class="n">t</th><th class="n">σ${sub('p')}${sup('2')}</th><th class="n">E(R${sub('p')})</th><th class="n">½ σ${sub('p')}${sup('2')} − t · E(R${sub('p')})</th></tr></thead><tbody>${ks
        .map((k, i) => {
          const pt = P.frontier[k];
          const t = tOf(k);
          const obj = fin(t) ? 0.5 * pt.vol * pt.vol - t * pt.ret : NaN;
          return `<tr><td>${['Mínima varianza (izquierda)', 'Mitad de la curva', 'Máximo rendimiento (derecha)'][i]}</td><td class="n">${t === Infinity ? '∞' : nf(t, 4)}</td><td class="n">${nf(pt.vol * pt.vol, 6)}</td><td class="n">${pct(pt.ret, 2)}</td><td class="n">${fin(obj) ? nf(obj, 6) : '—'}</td></tr>`;
        })
        .join('')}</tbody></table></div>`;
    };
    out.push(`<div class="panel"><h2>8. Cómo se calcula y se grafica la frontera eficiente</h2>
      <p><b>Markowitz (1952)</b> llama eficiente al portafolio que, para su nivel de riesgo, da el mayor rendimiento esperado (o, para su rendimiento, el menor riesgo). La frontera eficiente es la curva que une todos esos portafolios.</p>
      <h3>Paso 1. Datos de entrada</h3>
      <ul class="sym"><li><code>μ</code>: vector de rendimientos esperados anuales de los ${N} activos (sección 4).</li><li><code>Σ</code>: matriz de varianzas y covarianzas anual (sección 4).</li><li>Límites de peso: ${pct(Math.min(...P.lo), 0)} ≤ wᵢ ≤ ${pct(P.cap, 0)} por activo y <code>Σ wᵢ = 1</code> (todo el dinero invertido). El tope de ${pct(P.cap, 0)} es el que fija el portafolio recomendado (sección 11).</li></ul>
      <h3>Paso 2. El problema de optimización</h3>
      ${paso2()}
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
        <p class="formula"><code>E(Rₚ) = rf + [(E(R<sub>T</sub>) − rf) / σ<sub>T</sub>] · σₚ</code></p>
        <ul class="sym"><li><code>rf</code> = ${pct(m.rf)}: tasa libre de riesgo (Datos → Supuestos).</li><li><code>E(R<sub>T</sub>)</code> = ${pct(tan.ret)} y <code>σ<sub>T</sub></code> = ${pct(tan.vol)}: rendimiento y riesgo del portafolio tangente.</li><li>Pendiente = (${pct(tan.ret)} − ${pct(m.rf)}) / ${pct(tan.vol)} = <b>${nf(slope, 4)}</b>: es la razón de Sharpe del tangente, el mayor premio por unidad de riesgo total que se puede lograr.</li></ul>
        <h3>Cómo se traza</h3>
        <ol><li>Punto 1: (σ = 0, E(R) = rf = ${pct(m.rf)}), todo en renta fija segura.</li><li>Punto 2: (σ<sub>T</sub> = ${pct(tan.vol)}, E(R<sub>T</sub>) = ${pct(tan.ret)}), todo en el tangente.</li><li>Se prolonga la recta: a la izquierda de T se combina T con renta fija (prestar); a la derecha, se pide prestado a rf para invertir más de 100 % en T (apalancamiento).</li></ol>
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
      ${tb ? `<p><b>Treynor y Black (1973)</b>: parte del índice ${esc(m.marketName)} y le agrega una cartera activa con los activos de α de Jensen distinto de cero. Peso de cada activo en la cartera activa: <code>wᵢ ∝ αᵢ / σ²(εᵢ)</code> (α sobre su riesgo propio). Peso de la cartera activa: <code>w₀ = [α<sub>A</sub> / σ²(e<sub>A</sub>)] / [(E(Rₘ) − rf) / σₘ²]</code>, ajustado por su beta: <code>w* = w₀ / [1 + (1 − β<sub>A</sub>) w₀]</code> = ${pct(tb.wActive)}; el resto, ${pct(tb.wIndex)}, va al índice. Sharpe resultante: √(Sₘ² + IR²) = ${nf(tb.sharpeP, 3)}.</p>` : ''}
      <h3>Pesos de cada portafolio</h3>
      ${wTable(cols)}</div>`);

    /* 11.1–11.9 Detalle de cada portafolio: teoría, problema, pasos, resultado con tus datos y cuándo usarlo */
    out.push(detail({ m, P, ports, sel, tan, top, tb, pct, esc, nf, N }));

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
        <p class="formula"><code>Diferencia ᵢ = [E(Rᵢ) − rf] − βᵢ,T · (E(R<sub>T</sub>) − rf)</code>, &nbsp; con &nbsp; <code>βᵢ,T = Cov(rᵢ, r<sub>T</sub>) / σ<sub>T</sub>² = (Σw<sub>T</sub>)ᵢ / (w<sub>T</sub>ᵀΣw<sub>T</sub>)</code></p>
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
