/* Batería: definición de subpruebas, selección adaptativa, baremos por edad
 * y cálculo de índices y CI total.
 *
 * Estructura inspirada en el modelo CHC (Carroll, 1993; McGrew, 2009) y en los
 * cinco índices de las escalas Wechsler actuales (WISC-V / WAIS-5):
 *   ICV Comprensión verbal (Gc) · IRF Razonamiento fluido (Gf) ·
 *   IVE Visoespacial (Gv) · IMT Memoria de trabajo (Gwm) · IVP Velocidad de procesamiento (Gs) */
(function (root) {
  'use strict';
  const IQ = (root.IQ = root.IQ || {});
  const { irt, util } = IQ;

  const INDEXES = {
    ICV: { short: 'Verbal', name: 'Comprensión verbal', chc: 'Gc', desc: 'Conocimiento del lenguaje, vocabulario y formación de conceptos.' },
    IRF: { short: 'Razonamiento', name: 'Razonamiento fluido', chc: 'Gf', desc: 'Resolver problemas nuevos, descubrir reglas y razonar de forma lógica.' },
    IVE: { short: 'Visoespacial', name: 'Visoespacial', chc: 'Gv', desc: 'Manipular mentalmente figuras y relaciones espaciales.' },
    IMT: { short: 'Memoria', name: 'Memoria de trabajo', chc: 'Gwm', desc: 'Retener y manipular información a corto plazo.' },
    IVP: { short: 'Velocidad', name: 'Velocidad de procesamiento', chc: 'Gs', desc: 'Rapidez y precisión en tareas visuales sencillas.' },
  };
  const INDEX_ORDER = ['ICV', 'IRF', 'IVE', 'IMT', 'IVP'];

  /* Subpruebas. n = número de ítems en modo completo / breve.
   * a y c: discriminación y probabilidad de acierto por azar (3PL).
   * time: segundos máximos por ítem (se puntúa como error al agotarse). */
  const SUBTESTS = {
    matrices: {
      id: 'matrices', index: 'IRF', kind: 'gen', gen: 'matrices', a: 1.5, c: 1 / 8, n: { full: 12, short: 8 }, time: 120,
      title: 'Matrices',
      intro: 'Observa la cuadrícula de 3 × 3. Las figuras siguen una o varias reglas por filas (forma, número, tamaño, relleno, orientación o líneas). Elige la opción que completa la casilla vacía.',
    },
    verbal: {
      id: 'verbal', index: 'ICV', kind: 'bank', bank: 'VERBAL', a: 1.4, c: 0.25, n: { full: 12, short: 8 }, time: 45,
      title: 'Comprensión verbal',
      intro: 'Analogías, sinónimos y palabras que no encajan en un grupo. Elige la mejor respuesta.',
    },
    digitsF: {
      id: 'digitsF', index: 'IMT', kind: 'span', mode: 'forward', a: 1.3, mu: 6.5, sd: 1.2, start: 3, max: 10, n: { full: true, short: false },
      title: 'Dígitos en orden directo',
      intro: 'Verás una serie de números, uno por segundo. Cuando termine, escríbelos en el mismo orden. Cada nivel añade un número.',
    },
    rotation: {
      id: 'rotation', index: 'IVE', kind: 'gen', gen: 'rotation', a: 1.3, c: 0.25, n: { full: 10, short: 6 }, time: 45,
      title: 'Rotación mental',
      intro: 'Arriba verás una figura. Solo una de las opciones es esa misma figura girada; las demás están reflejadas en espejo o tienen un bloque en otro sitio.',
    },
    series: {
      id: 'series', index: 'IRF', kind: 'gen', gen: 'series', a: 1.4, c: 0.02, n: { full: 7, short: 5 }, time: 120,
      title: 'Series numéricas',
      intro: 'Descubre la regla de la serie y escribe el número que sigue.',
    },
    digitsB: {
      id: 'digitsB', index: 'IMT', kind: 'span', mode: 'backward', a: 1.3, mu: 4.8, sd: 1.2, start: 2, max: 9, n: { full: true, short: true },
      title: 'Dígitos en orden inverso',
      intro: 'Verás una serie de números. Escríbelos en orden inverso: si ves 3 · 8 · 1, escribe 1 8 3.',
    },
    speed: {
      id: 'speed', index: 'IVP', kind: 'speed', duration: { full: 120, short: 90 }, n: { full: true, short: true },
      // Baremo provisional (tasa neta aciertos − errores por segundo, adultos 20–34 años).
      meanRate: 0.42, sdRate: 0.11, loading: 0.92,
      title: 'Búsqueda de símbolos',
      intro: '¿Aparece alguno de los dos símbolos de la izquierda en el grupo de la derecha? Responde Sí o No lo más rápido que puedas sin cometer errores. En teclado: ← = Sí, → = No.',
    },
    logic: {
      id: 'logic', index: 'IRF', kind: 'bank', bank: 'LOGIC', a: 1.3, c: null, n: { full: 6, short: 4 }, time: 150,
      title: 'Acertijos lógicos',
      intro: 'Problemas de razonamiento lógico y cuantitativo. Lee con calma: algunos tienen una respuesta intuitiva que es incorrecta.',
    },
    corsi: {
      id: 'corsi', index: 'IMT', kind: 'span', mode: 'corsi', a: 1.3, mu: 5.7, sd: 1.1, start: 3, max: 9, n: { full: true, short: true },
      title: 'Bloques de Corsi',
      intro: 'Los bloques se iluminarán uno a uno. Cuando termine la secuencia, tócalos en el mismo orden.',
    },
  };

  const ORDER = ['matrices', 'verbal', 'digitsF', 'rotation', 'series', 'digitsB', 'speed', 'logic', 'corsi'];

  function planFor(mode) {
    return ORDER.filter((id) => SUBTESTS[id].n[mode]);
  }

  /* ---------- Baremos por edad ----------
   * El CI se define respecto a la propia edad. Aplicamos la tendencia media
   * transversal descrita por Salthouse (2009) y los baremos Wechsler: el
   * razonamiento fluido, la velocidad y la capacidad visoespacial declinan
   * desde la mitad de la veintena; el vocabulario crece hasta ~65 años.
   * Valores en desviaciones típicas respecto al grupo de 20–34 años. */
  const AGE_SLOPE = { IRF: -0.022, IVE: -0.022, IVP: -0.028, IMT: -0.012, ICV: 0.012 };

  function ageShift(index, age) {
    age = util.clamp(age, 16, 90);
    let s = 0;
    if (age < 20) s -= 0.05 * (20 - age);
    if (index === 'ICV') {
      if (age > 25) s += AGE_SLOPE.ICV * (Math.min(age, 65) - 25);
      if (age > 65) s -= 0.02 * (age - 65);
    } else if (age > 25) {
      s += AGE_SLOPE[index] * (age - 25);
    }
    return s;
  }

  /* ---------- Sesión de evaluación ---------- */
  function createSession(opts) {
    const mode = opts.mode || 'full';
    const seedRng = util.rng(opts.seed || util.newSeed());
    return {
      mode,
      age: opts.age,
      practice: !!opts.practice,
      plan: opts.only ? [opts.only] : planFor(mode),
      responses: [], // {subtest, index, a, b, c, correct, rt, timedOut, level?, id?}
      continuous: [], // {subtest, index, z, loading, raw}
      used: {},
      flags: { hidden: 0 },
      startedAt: Date.now(),
      seedRng,
    };
  }

  function indexResponses(session, index) {
    return session.responses.filter((r) => r.index === index);
  }

  function provisionalTheta(session, index) {
    const rs = indexResponses(session, index);
    if (!rs.length) return -0.8; // se empieza con ítems algo fáciles
    return irt.eap(rs).theta;
  }

  function itemsLeft(session, st) {
    const n = SUBTESTS[st].n[session.mode] || SUBTESTS[st].n.full;
    return n - session.responses.filter((r) => r.subtest === st).length;
  }

  /* Siguiente ítem de una subprueba "gen" o "bank" por máxima información. */
  function nextItem(session, stId) {
    const st = SUBTESTS[stId];
    const theta = provisionalTheta(session, st.index);
    const R = session.seedRng;
    if (st.kind === 'gen') {
      const G = IQ[st.gen];
      const cands = G.LEVELS.map((L) => ({ level: L.level, b: L.b, a: st.a, c: st.c }));
      const pick = irt.selectByInformation(theta, cands, R, 1);
      const seed = Math.floor(R() * 4294967296);
      const item = G.generate(pick.level, seed);
      item.a = st.a;
      item.c = st.c;
      return item;
    }
    if (st.kind === 'bank') {
      const bank = IQ.banks[st.bank];
      const used = (session.used[stId] = session.used[stId] || new Set());
      const cands = bank
        .filter((it) => !used.has(it.id))
        .map((it) => ({
          ref: it,
          b: it.b,
          a: st.a,
          c: st.c != null ? st.c : it.t === 'num' ? 0.02 : 1 / it.o.length,
        }));
      if (!cands.length) return null;
      const pick = irt.selectByInformation(theta, cands, R, 3);
      used.add(pick.ref.id);
      const it = pick.ref;
      const item = { kind: stId === 'logic' ? 'logic' : 'verbal', id: it.id, b: pick.b, a: pick.a, c: pick.c, q: it.q, sub: it.sub };
      if (it.t === 'num') {
        item.numeric = true;
        item.answerValue = it.ans;
      } else {
        const order = R.shuffle(it.o.map((text, i) => ({ text, i })));
        item.options = order.map((o) => o.text);
        item.answer = order.findIndex((o) => o.i === 0);
      }
      item.explanation = [it.why || (IQ.banks.VERBAL_WHY && IQ.banks.VERBAL_WHY[it.id]) || `Respuesta correcta: ${it.o ? it.o[0] : it.ans}.`];
      return item;
    }
    return null;
  }

  function checkNumeric(input, value) {
    const v = parseFloat(String(input).trim().replace(',', '.'));
    return Number.isFinite(v) && Math.abs(v - value) < 1e-6;
  }

  function record(session, stId, item, correct, extra) {
    const st = SUBTESTS[stId];
    session.responses.push(
      Object.assign(
        { subtest: stId, index: st.index, a: item.a, b: item.b, c: item.c || 0, correct: !!correct },
        extra || {}
      )
    );
  }

  // Ítem TRI de un ensayo de amplitud de longitud L.
  function spanItem(stId, L) {
    const st = SUBTESTS[stId];
    return { a: st.a, b: (L - st.mu) / st.sd, c: 0, length: L };
  }

  function recordSpeed(session, stId, correctN, errorsN, seconds) {
    const st = SUBTESTS[stId];
    const net = correctN - errorsN;
    const z = (net / seconds - st.meanRate) / st.sdRate;
    session.continuous.push({ subtest: stId, index: st.index, z: util.clamp(z, -4, 4), loading: st.loading, raw: { correctN, errorsN, seconds } });
  }

  /* ---------- Puntuación final ---------- */
  const CALIBRATION_SD = 0.2; // incertidumbre añadida por usar parámetros no calibrados
  const INDEX_INTERCORR = 0.5; // correlación media entre índices (WAIS-IV ≈ 0,4–0,6)

  function score(session) {
    const indices = {};
    for (const idx of INDEX_ORDER) {
      const rs = indexResponses(session, idx);
      const cs = session.continuous.filter((c) => c.index === idx);
      if (!rs.length && !cs.length) continue;
      const est = irt.eap(rs, cs);
      const theta = est.theta - ageShift(idx, session.age);
      const se = Math.sqrt(est.se * est.se + CALIBRATION_SD * CALIBRATION_SD);
      indices[idx] = scaleScore(theta, se);
      indices[idx].rawTheta = est.theta;
      indices[idx].n = rs.length + cs.length;
      indices[idx].correct = rs.filter((r) => r.correct).length;
    }
    const keys = Object.keys(indices);
    const k = keys.length;
    let total = null;
    if (k) {
      // Compuesto re-estandarizado: media de índices / DT de la media de k índices correlacionados.
      const sdMean = Math.sqrt((1 + (k - 1) * INDEX_INTERCORR) / k);
      const meanTheta = keys.reduce((s, x) => s + indices[x].theta, 0) / k;
      const seMean = Math.sqrt(keys.reduce((s, x) => s + indices[x].se * indices[x].se, 0)) / k;
      total = scaleScore(meanTheta / sdMean, seMean / sdMean);
    }
    return { indices, total, validity: validity(session), strengths: strengths(indices) };
  }

  function scaleScore(theta, se) {
    const iq = irt.toIQ(theta);
    const half = 1.96 * 15 * se;
    return {
      theta,
      se,
      iq: Math.round(util.clamp(iq, 40, 160)),
      ciLow: Math.round(util.clamp(iq - half, 40, 160)),
      ciHigh: Math.round(util.clamp(iq + half, 40, 160)),
      percentile: irt.percentile(iq),
      range: irt.classify(util.clamp(iq, 40, 160)),
    };
  }

  // Fortalezas y debilidades relativas: diferencia con la media personal (p < 0,05).
  function strengths(indices) {
    const keys = Object.keys(indices);
    if (keys.length < 3) return [];
    const mean = keys.reduce((s, x) => s + indices[x].iq, 0) / keys.length;
    return keys
      .map((x) => {
        const d = indices[x].iq - mean;
        const crit = 1.96 * 15 * indices[x].se;
        return { index: x, diff: d, kind: d > crit ? 'fortaleza' : d < -crit ? 'debilidad' : null };
      })
      .filter((x) => x.kind);
  }

  /* Indicadores de validez del rendimiento. */
  function validity(session) {
    const warnings = [];
    const timed = session.responses.filter((r) => r.rt != null && r.subtest !== 'digitsF' && r.subtest !== 'digitsB' && r.subtest !== 'corsi');
    const fast = timed.filter((r) => r.rt < (r.subtest === 'matrices' ? 3000 : 1800));
    if (timed.length && fast.length / timed.length > 0.2)
      warnings.push(`Respuestas muy rápidas en ${fast.length} de ${timed.length} ítems: posible respuesta al azar.`);
    const tout = session.responses.filter((r) => r.timedOut).length;
    if (tout >= 4) warnings.push(`Se agotó el tiempo en ${tout} ítems.`);
    if (session.flags.hidden > 0)
      warnings.push(`Se salió de la aplicación ${session.flags.hidden} ${session.flags.hidden === 1 ? 'vez' : 'veces'} durante la prueba.`);
    const sp = session.continuous.find((c) => c.subtest === 'speed');
    if (sp && sp.raw.correctN + sp.raw.errorsN > 0 && sp.raw.errorsN / (sp.raw.correctN + sp.raw.errorsN) > 0.25)
      warnings.push('Muchos errores en búsqueda de símbolos: la velocidad pudo primar sobre la precisión.');
    return { ok: warnings.length === 0, warnings };
  }

  IQ.battery = {
    INDEXES,
    INDEX_ORDER,
    SUBTESTS,
    ORDER,
    planFor,
    ageShift,
    createSession,
    nextItem,
    itemsLeft,
    checkNumeric,
    record,
    spanItem,
    recordSpeed,
    score,
    provisionalTheta,
    CALIBRATION_SD,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
