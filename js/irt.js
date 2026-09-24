/* Motor psicométrico: Teoría de Respuesta al Ítem (TRI).
 *
 * - Modelo logístico de 3 parámetros (3PL): P(θ) = c + (1 - c) / (1 + e^(-D·a·(θ - b)))
 *   a = discriminación, b = dificultad, c = acierto por azar, D = 1,7.
 * - Estimación EAP (Expected A Posteriori) por cuadratura con previa N(0, 1)
 *   (Bock & Mislevy, 1982; Embretson & Reise, 2000).
 * - Selección adaptativa por máxima información de Fisher (van der Linden & Glas, 2010).
 * - Puntuaciones continuas (velocidad) se integran como indicador factorial:
 *   z ~ N(λ·θ, 1 - λ²).
 * - CI = 100 + 15·θ (escala de desviación de Wechsler). */
(function (root) {
  'use strict';
  const IQ = (root.IQ = root.IQ || {});
  const D = 1.7;

  // Rejilla de cuadratura −5..5 en pasos de 0,05.
  const GRID = [];
  for (let t = -5; t <= 5.0001; t += 0.05) GRID.push(Math.round(t * 100) / 100);

  function prob(theta, item) {
    const c = item.c || 0;
    return c + (1 - c) / (1 + Math.exp(-D * item.a * (theta - item.b)));
  }

  function information(theta, item) {
    const c = item.c || 0;
    const p = prob(theta, item);
    const q = 1 - p;
    const num = Math.pow(D * item.a, 2) * Math.pow(p - c, 2) * q;
    return num / (Math.pow(1 - c, 2) * p);
  }

  function normalPdf(x, mu, sd) {
    const z = (x - mu) / sd;
    return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
  }

  // Aproximación de Abramowitz & Stegun 7.1.26 (error < 1,5e-7).
  function erf(x) {
    const s = x < 0 ? -1 : 1;
    x = Math.abs(x);
    const t = 1 / (1 + 0.3275911 * x);
    const y =
      1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
        t *
        Math.exp(-x * x);
    return s * y;
  }

  function normalCdf(z) {
    return 0.5 * (1 + erf(z / Math.SQRT2));
  }

  /* responses: [{a, b, c, correct}] ; continuous: [{z, loading}]
   * Devuelve { theta, se } con previa N(0,1). */
  function eap(responses, continuous) {
    continuous = continuous || [];
    const logPost = GRID.map((t) => -0.5 * t * t);
    for (const r of responses) {
      for (let i = 0; i < GRID.length; i++) {
        const p = Math.min(Math.max(prob(GRID[i], r), 1e-9), 1 - 1e-9);
        logPost[i] += r.correct ? Math.log(p) : Math.log(1 - p);
      }
    }
    for (const obs of continuous) {
      const l = obs.loading;
      const sd = Math.sqrt(1 - l * l);
      for (let i = 0; i < GRID.length; i++) {
        logPost[i] += Math.log(normalPdf(obs.z, l * GRID[i], sd));
      }
    }
    const max = Math.max.apply(null, logPost);
    let sum = 0;
    let mean = 0;
    const w = logPost.map((lp) => Math.exp(lp - max));
    for (let i = 0; i < GRID.length; i++) {
      sum += w[i];
      mean += w[i] * GRID[i];
    }
    mean /= sum;
    let v = 0;
    for (let i = 0; i < GRID.length; i++) v += w[i] * Math.pow(GRID[i] - mean, 2);
    v /= sum;
    return { theta: mean, se: Math.sqrt(v) };
  }

  /* Elige, entre candidatos {b, a, c, ...}, el de máxima información en θ.
   * "Randomesque" (Kingsbury & Zara, 1989): se sortea entre los k mejores
   * para limitar la exposición de ítems. */
  function selectByInformation(theta, candidates, rand, k) {
    k = k || 1;
    const scored = candidates
      .map((it) => ({ it, info: information(theta, it) }))
      .sort((x, y) => y.info - x.info);
    const top = scored.slice(0, Math.min(k, scored.length));
    return top[Math.floor((rand ? rand() : Math.random()) * top.length)].it;
  }

  const toIQ = (theta) => 100 + 15 * theta;
  const percentile = (iq) => 100 * normalCdf((iq - 100) / 15);

  // Clasificación descriptiva de Wechsler (WAIS-IV, 2008).
  const RANGES = [
    { min: 130, max: 200, label: 'Muy superior', en: 'Extremely high', key: 'vs' },
    { min: 120, max: 129, label: 'Superior', en: 'Very high', key: 's' },
    { min: 110, max: 119, label: 'Normal-alto', en: 'High average', key: 'na' },
    { min: 90, max: 109, label: 'Promedio', en: 'Average', key: 'p' },
    { min: 80, max: 89, label: 'Normal-bajo', en: 'Low average', key: 'nb' },
    { min: 70, max: 79, label: 'Limítrofe', en: 'Borderline', key: 'l' },
    { min: 0, max: 69, label: 'Extremadamente bajo', en: 'Extremely low', key: 'eb' },
  ];

  function classify(iq) {
    const r = Math.round(iq);
    return RANGES.find((x) => r >= x.min && r <= x.max);
  }

  // Porcentaje teórico de población en cada rango (curva normal μ=100, σ=15).
  function rangeShare(range) {
    const lo = range.min === 0 ? -Infinity : (range.min - 0.5 - 100) / 15;
    const hi = range.max === 200 ? Infinity : (range.max + 0.5 - 100) / 15;
    const cdf = (z) => (z === Infinity ? 1 : z === -Infinity ? 0 : normalCdf(z));
    return 100 * (cdf(hi) - cdf(lo));
  }

  IQ.irt = {
    D,
    prob,
    information,
    eap,
    selectByInformation,
    normalCdf,
    toIQ,
    percentile,
    classify,
    rangeShare,
    RANGES,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
