/* Pruebas sin dependencias: node tests/run.js */
'use strict';
const path = require('path');
for (const f of ['core', 'irt', 'gen-matrices', 'gen-series', 'gen-rotation', 'banks', 'battery']) {
  require(path.join(__dirname, '..', 'js', f + '.js'));
}
const IQ = globalThis.IQ;
let failed = 0;
let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (e) {
    failed++;
    console.error('✗ ' + name + '\n  ' + e.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'aserción fallida');
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

test('normalCdf', () => {
  assert(near(IQ.irt.normalCdf(0), 0.5, 1e-6));
  assert(near(IQ.irt.normalCdf(1.96), 0.975, 1e-3));
  assert(near(IQ.irt.normalCdf(-1), 0.1587, 1e-3));
});

test('percentiles de CI', () => {
  assert(near(IQ.irt.percentile(100), 50, 0.01));
  assert(near(IQ.irt.percentile(130), 97.7, 0.1));
  assert(near(IQ.irt.percentile(70), 2.3, 0.1));
});

test('clasificación Wechsler', () => {
  assert(IQ.irt.classify(100).label === 'Promedio');
  assert(IQ.irt.classify(119).label === 'Normal-alto');
  assert(IQ.irt.classify(130).label === 'Muy superior');
  assert(IQ.irt.classify(69).label === 'Extremadamente bajo');
  const total = IQ.irt.RANGES.reduce((s, r) => s + IQ.irt.rangeShare(r), 0);
  assert(near(total, 100, 0.01), 'los rangos cubren el 100 %: ' + total);
});

test('EAP sin datos = previa', () => {
  const e = IQ.irt.eap([]);
  assert(near(e.theta, 0, 1e-3) && near(e.se, 1, 1e-2));
});

test('EAP recupera θ simulado (sesgo y error razonables)', () => {
  const R = IQ.util.rng(42);
  for (const trueTheta of [-2, -1, 0, 1, 2]) {
    let err = 0;
    const reps = 60;
    for (let rep = 0; rep < reps; rep++) {
      const rs = [];
      for (let i = 0; i < 40; i++) {
        const it = { a: 1.4, b: -2.5 + (5 * i) / 39, c: 0.2 };
        rs.push(Object.assign({ correct: R() < IQ.irt.prob(trueTheta, it) }, it));
      }
      err += IQ.irt.eap(rs).theta - trueTheta;
    }
    assert(Math.abs(err / reps) < 0.25, `sesgo alto en θ=${trueTheta}: ${err / reps}`);
  }
});

test('información máxima cerca de b', () => {
  const it = { a: 1.5, b: 0.5, c: 0 };
  assert(IQ.irt.information(0.5, it) > IQ.irt.information(-1, it));
  assert(IQ.irt.information(0.5, it) > IQ.irt.information(2, it));
});

test('matrices: 8 opciones distintas y respuesta única en todos los niveles', () => {
  for (let level = 1; level <= 8; level++) {
    for (let s = 1; s <= 150; s++) {
      const it = IQ.matrices.generate(level, s * 7919 + level);
      assert(it.options.length === 8);
      const keys = it.options.map((o) => JSON.stringify(o));
      assert(new Set(keys).size === 8, `opciones repetidas nivel ${level} semilla ${s}`);
      assert(it.answer >= 0 && it.answer < 8);
      for (const c of it.cells.concat(it.options)) {
        assert(c.count >= 1 && c.count <= 4, 'count fuera de rango');
        assert(c.size >= 0 && c.size <= 2, 'size fuera de rango');
      }
      assert(IQ.matrices.renderMatrix(it).includes('<svg'));
      assert(it.explanation.length >= 1);
    }
  }
});

test('matrices: cada valor de atributo aparece 4 veces (sin pista de mayoría)', () => {
  for (let s = 1; s < 200; s++) {
    const it = IQ.matrices.generate(1 + (s % 8), s);
    for (const attr of ['shape', 'count', 'size', 'fill', 'rot', 'lines']) {
      const counts = {};
      it.options.forEach((o) => (counts[o[attr]] = (counts[o[attr]] || 0) + 1));
      const vals = Object.values(counts);
      assert(vals.length === 1 || vals.every((v) => v === 4), `atributo ${attr} desequilibrado`);
    }
  }
});

test('series: respuestas enteras o finitas', () => {
  for (let level = 1; level <= 8; level++)
    for (let s = 1; s <= 100; s++) {
      const it = IQ.series.generate(level, s);
      assert(it.shown.length === 6 && Number.isFinite(it.answer));
      assert(Math.abs(it.answer) < 1e6, 'número demasiado grande');
    }
});

test('rotación: una sola opción congruente con el objetivo', () => {
  const { congruent } = IQ.rotation._test;
  for (let level = 1; level <= 6; level++)
    for (let s = 1; s <= 80; s++) {
      const it = IQ.rotation.generate(level, s * 31 + level);
      const matches = it.options.filter((o) => congruent(it.target, o.cells));
      assert(matches.length === 1, `nivel ${level} semilla ${s}: ${matches.length} congruentes`);
      assert(it.options[it.answer].correct);
      assert(IQ.rotation.renderPoly(it.target, 0).includes('<rect'));
    }
});

test('bancos: ids únicos y respuestas válidas', () => {
  const ids = new Set();
  for (const it of IQ.banks.VERBAL.concat(IQ.banks.LOGIC)) {
    assert(!ids.has(it.id), 'id duplicado ' + it.id);
    ids.add(it.id);
    if (it.t === 'num') assert(Number.isFinite(it.ans));
    else assert(it.o.length >= 3 && new Set(it.o).size === it.o.length, 'opciones repetidas ' + it.id);
  }
});

test('respuesta numérica con coma decimal', () => {
  assert(IQ.battery.checkNumeric('7,5', 7.5));
  assert(IQ.battery.checkNumeric(' 45 ', 45));
  assert(!IQ.battery.checkNumeric('46', 45));
  assert(!IQ.battery.checkNumeric('', 45));
});

test('baremo por edad', () => {
  const { ageShift } = IQ.battery;
  assert(ageShift('IRF', 25) === 0);
  assert(ageShift('IRF', 70) < -0.8);
  assert(ageShift('ICV', 60) > 0);
  assert(ageShift('IVP', 20) === 0);
});

function simulate(trueTheta, mode, seed) {
  const B = IQ.battery;
  const R = IQ.util.rng(seed);
  const s = B.createSession({ mode, age: 28, seed });
  for (const st of s.plan) {
    const def = B.SUBTESTS[st];
    if (def.kind === 'gen' || def.kind === 'bank') {
      while (B.itemsLeft(s, st) > 0) {
        const it = B.nextItem(s, st);
        if (!it) break;
        B.record(s, st, it, R() < IQ.irt.prob(trueTheta, it), { rt: 8000 });
      }
    } else if (def.kind === 'span') {
      let L = def.start;
      for (;;) {
        let ok = 0;
        for (let t = 0; t < 2; t++) {
          const it = B.spanItem(st, L);
          const c = R() < IQ.irt.prob(trueTheta, it);
          ok += c;
          B.record(s, st, it, c);
        }
        if (!ok || L >= def.max) break;
        L++;
      }
    } else if (def.kind === 'speed') {
      const secs = def.duration[mode];
      const rate = def.meanRate + def.sdRate * trueTheta;
      B.recordSpeed(s, st, Math.round(rate * secs) + 2, 2, secs);
    }
  }
  return B.score(s);
}

test('batería completa simulada recupera el CI aproximadamente', () => {
  for (const t of [-1.5, 0, 1.5]) {
    let sum = 0;
    const reps = 12;
    for (let r = 0; r < reps; r++) sum += simulate(t, 'full', 1000 + r).total.iq;
    const mean = sum / reps;
    assert(Math.abs(mean - (100 + 15 * t)) < 9, `θ=${t}: CI medio ${mean.toFixed(1)}`);
  }
});

test('intervalo de confianza contiene el CI y es razonable', () => {
  const res = simulate(0.5, 'full', 7);
  const T = res.total;
  assert(T.ciLow <= T.iq && T.iq <= T.ciHigh);
  assert(T.ciHigh - T.ciLow < 30, 'intervalo demasiado ancho: ' + (T.ciHigh - T.ciLow));
  assert(Object.keys(res.indices).length === 5);
});

test('modo breve funciona', () => {
  const res = simulate(0, 'short', 99);
  assert(res.total && Object.keys(res.indices).length === 5);
});

console.log(`${passed} pruebas correctas, ${failed} fallidas`);
process.exit(failed ? 1 : 0);
