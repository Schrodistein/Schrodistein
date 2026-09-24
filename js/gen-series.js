/* Generador de series numéricas (razonamiento inductivo / cuantitativo, Gf-RQ).
 * Las series de números son un formato clásico de razonamiento inductivo
 * (Thurstone, 1938; Simon & Kotovsky, 1963). La dificultad crece con el número
 * de operaciones que hay que descubrir y con el nivel de las diferencias
 * (primer vs. segundo orden, series intercaladas, recursivas). */
(function (root) {
  'use strict';
  const IQ = (root.IQ = root.IQ || {});
  const { rng } = IQ.util;

  const LEVELS = [
    { level: 1, b: -2.3 },
    { level: 2, b: -1.5 },
    { level: 3, b: -0.8 },
    { level: 4, b: -0.1 },
    { level: 5, b: 0.6 },
    { level: 6, b: 1.2 },
    { level: 7, b: 1.8 },
    { level: 8, b: 2.4 },
  ];

  // Cada constructor devuelve { terms, explanation } con 7 términos (el último es la respuesta).
  const BUILDERS = {
    1: [
      (R) => {
        const a = R.int(1, 9), d = R.int(2, 5);
        return arith(a, d, `Se suma ${d} cada vez.`);
      },
      (R) => {
        const d = R.int(2, 4), a = R.int(30, 50);
        return arith(a, -d, `Se resta ${d} cada vez.`);
      },
    ],
    2: [
      (R) => {
        const a = R.int(1, 4), r = 2;
        return geom(a, r, 'Cada número es el doble del anterior.');
      },
      (R) => {
        const a = R.int(3, 20), d = R.int(6, 13);
        return arith(a, d, `Se suma ${d} cada vez.`);
      },
    ],
    3: [
      (R) => {
        const a = R.int(1, 3);
        return geom(a, 3, 'Cada número es el triple del anterior.');
      },
      (R) => {
        const a = R.int(1, 10), d0 = R.int(1, 3);
        const t = [a];
        for (let i = 0; i < 6; i++) t.push(t[i] + d0 + i);
        return { terms: t, explanation: `Las diferencias aumentan de 1 en 1 (+${d0}, +${d0 + 1}, +${d0 + 2}…).` };
      },
    ],
    4: [
      (R) => {
        const a = R.int(1, 9), d1 = R.int(2, 5), b = R.int(20, 40), d2 = -R.int(1, 4);
        const t = [];
        for (let i = 0; i < 7; i++) t.push(i % 2 === 0 ? a + d1 * (i / 2) : b + d2 * ((i - 1) / 2));
        return {
          terms: t,
          explanation: `Son dos series intercaladas: posiciones impares ${d1 > 0 ? '+' : ''}${d1}, posiciones pares ${d2}.`,
        };
      },
      (R) => {
        const k = R.int(0, 3), s = R.int(1, 2);
        const t = [];
        for (let i = 0; i < 7; i++) t.push(Math.pow(i + s, 2) + k);
        return { terms: t, explanation: `Cuadrados perfectos${k ? ` más ${k}` : ''}: ${s}², ${s + 1}², ${s + 2}²…` };
      },
    ],
    5: [
      (R) => {
        const a = R.int(1, 5), m = 2, c = R.pick([1, -1, 2]);
        const t = [a];
        for (let i = 0; i < 6; i++) t.push(t[i] * m + c);
        return { terms: t, explanation: `Cada número es el doble del anterior ${c > 0 ? 'más' : 'menos'} ${Math.abs(c)}.` };
      },
      (R) => {
        const a = R.int(2, 9), d0 = R.int(1, 3);
        const t = [a];
        for (let i = 0; i < 6; i++) t.push(t[i] + d0 * Math.pow(2, i));
        return { terms: t, explanation: `Las diferencias se duplican: +${d0}, +${d0 * 2}, +${d0 * 4}…` };
      },
    ],
    6: [
      (R) => {
        const a = R.int(1, 5), p = R.int(2, 5);
        const t = [a];
        for (let i = 0; i < 6; i++) t.push(i % 2 === 0 ? t[i] + p : t[i] * 2);
        return { terms: t, explanation: `Se alternan dos operaciones: +${p} y ×2.` };
      },
      (R) => {
        const a = R.int(1, 4), b = R.int(2, 6);
        const t = [a, b];
        for (let i = 2; i < 7; i++) t.push(t[i - 1] + t[i - 2]);
        return { terms: t, explanation: 'Cada número es la suma de los dos anteriores (tipo Fibonacci).' };
      },
    ],
    7: [
      (R) => {
        const k = R.pick([1, -1]);
        const t = [];
        for (let i = 1; i <= 7; i++) t.push(i * i * i + k * i);
        return { terms: t, explanation: `Cada término es n³ ${k > 0 ? '+' : '−'} n (n = 1, 2, 3…).` };
      },
      (R) => {
        const primes = [2, 3, 5, 7, 11, 13, 17];
        const a = R.int(1, 12);
        const t = [a];
        for (let i = 0; i < 6; i++) t.push(t[i] + primes[i]);
        return { terms: t, explanation: 'Las diferencias son los números primos: +2, +3, +5, +7, +11…' };
      },
      (R) => {
        const a = R.int(2, 4);
        const t = [a];
        for (let i = 0; i < 6; i++) t.push(t[i] * (i + 1));
        return { terms: t, explanation: 'Se multiplica sucesivamente por 1, 2, 3, 4, 5…' };
      },
    ],
    8: [
      (R) => {
        const a = R.int(1, 6), s = R.int(1, 2);
        const t = [a];
        for (let i = 0; i < 6; i++) t.push(t[i] + Math.pow(i + s, 2));
        return { terms: t, explanation: `Las diferencias son cuadrados: +${s * s}, +${(s + 1) ** 2}, +${(s + 2) ** 2}…` };
      },
      (R) => {
        const a = R.int(1, 3), b = R.int(1, 3), c = R.int(2, 4);
        const t = [a, b, c];
        for (let i = 3; i < 7; i++) t.push(t[i - 1] + t[i - 2] + t[i - 3]);
        return { terms: t, explanation: 'Cada número es la suma de los tres anteriores.' };
      },
      (R) => {
        const a = R.int(2, 5);
        const t = [a];
        for (let i = 0; i < 6; i++) t.push(i % 2 === 0 ? t[i] * 3 : t[i] - (i + 1));
        return { terms: t, explanation: 'Se alterna ×3 con una resta que crece: −2, −4, −6…' };
      },
    ],
  };

  function arith(a, d, explanation) {
    const t = [];
    for (let i = 0; i < 7; i++) t.push(a + d * i);
    return { terms: t, explanation };
  }
  function geom(a, r, explanation) {
    const t = [];
    for (let i = 0; i < 7; i++) t.push(a * Math.pow(r, i));
    return { terms: t, explanation };
  }

  function generate(level, seed) {
    const R = rng(seed);
    const L = LEVELS[level - 1];
    const { terms, explanation } = R.pick(BUILDERS[level])(R);
    return {
      kind: 'series',
      level,
      b: L.b,
      seed,
      shown: terms.slice(0, 6),
      answer: terms[6],
      explanation: [explanation],
    };
  }

  IQ.series = { LEVELS, generate, levelInfo: (l) => LEVELS[l - 1] };
})(typeof globalThis !== 'undefined' ? globalThis : this);
