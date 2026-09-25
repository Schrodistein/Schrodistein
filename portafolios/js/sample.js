/* Datos de ejemplo SIMULADOS (no son cotizaciones reales): 60 meses de precios
 * generados con un modelo de índice único r = rf + α + β(rm − rf) + ε, con
 * semilla fija para que el ejemplo sea siempre el mismo. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(R) {
    const u = Math.max(R(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * R());
  }

  // nombre, beta, alfa mensual, σ residual mensual
  const ASSETS = [
    ['Tecnología', 1.35, 0.003, 0.055],
    ['Banca', 1.15, 0.0005, 0.04],
    ['Consumo básico', 0.6, 0.002, 0.028],
    ['Energía', 1.0, -0.001, 0.06],
    ['Salud', 0.75, 0.0025, 0.033],
    ['Minería', 1.25, 0.0, 0.065],
    ['Telecomunicaciones', 0.7, -0.0015, 0.032],
    ['Inmobiliario (FIBRAs)', 0.8, 0.001, 0.042],
    ['Bonos gubernamentales', 0.05, 0.0008, 0.012],
    ['Oro', -0.05, 0.002, 0.042],
  ];

  function csv(seed) {
    const R = rng(seed || 20260925);
    const months = 60;
    const rfp = 0.04 / 12;
    const price = ASSETS.map(() => 100);
    let mkt = 1000;
    const head = ['Fecha'].concat(ASSETS.map((a) => a[0]), ['Índice de mercado']);
    const rows = [head.join(',')];
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    const d = new Date(2021, 8, 1);
    const line = () => [fmt(d)].concat(price.map((p) => p.toFixed(2)), [mkt.toFixed(2)]).join(',');
    rows.push(line());
    for (let t = 0; t < months; t++) {
      const rm = 0.009 + 0.045 * gauss(R);
      mkt *= 1 + rm;
      ASSETS.forEach((a, i) => {
        const r = rfp + a[2] + a[1] * (rm - rfp) + a[3] * gauss(R);
        price[i] *= 1 + r;
      });
      d.setMonth(d.getMonth() + 1);
      rows.push(line());
    }
    return rows.join('\n');
  }

  PF.sample = { csv, ASSETS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
