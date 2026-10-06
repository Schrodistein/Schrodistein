/* Datos de ejemplo SIMULADOS (no son cotizaciones reales): precios generados con un modelo de
 * índice único r = rf + α + β(rm − rf) + ε, con semilla fija para que el ejemplo sea siempre el
 * mismo. csv() da 60 meses (pruebas); csv(seed, { daily: true }) da cotizaciones diarias, una por
 * rueda de lunes a viernes durante unos tres años, como las que usa la app. */
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

  function csv(seed, opts) {
    const daily = !!(opts && opts.daily);
    const R = rng(seed || 20260925);
    const n = daily ? 742 : 60;
    const k = daily ? 21 : 1; // ruedas por mes, para escalar los parámetros mensuales
    const rfp = 0.04 / (daily ? 242 : 12);
    const price = ASSETS.map(() => 100);
    let mkt = 1000;
    const head = ['Fecha'].concat(ASSETS.map((a) => a[0]), ['Índice de mercado']);
    const rows = [head.join(',')];
    const fmt = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + (daily ? '-' + String(d.getDate()).padStart(2, '0') : '');
    const d = daily ? new Date(2023, 7, 22) : new Date(2021, 8, 1);
    const line = () => [fmt(d)].concat(price.map((p) => p.toFixed(2)), [mkt.toFixed(2)]).join(',');
    rows.push(line());
    for (let t = 0; t < n; t++) {
      const rm = 0.009 / k + (0.045 / Math.sqrt(k)) * gauss(R);
      mkt *= 1 + rm;
      ASSETS.forEach((a, i) => {
        const r = rfp + a[2] / k + a[1] * (rm - rfp) + (a[3] / Math.sqrt(k)) * gauss(R);
        price[i] *= 1 + r;
      });
      if (daily) {
        do d.setDate(d.getDate() + 1);
        while (d.getDay() === 0 || d.getDay() === 6);
      } else d.setMonth(d.getMonth() + 1);
      rows.push(line());
    }
    return rows.join('\n');
  }

  PF.sample = { csv, ASSETS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
