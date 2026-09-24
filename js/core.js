/* Espacio de nombres global y utilidades compartidas.
 * Los módulos se cargan como scripts clásicos (sin bundler) para que la app
 * funcione abriendo index.html directamente, offline, y también en Node para
 * las pruebas. Cada archivo añade su parte a globalThis.IQ. */
(function (root) {
  'use strict';
  const IQ = (root.IQ = root.IQ || {});

  // PRNG reproducible (mulberry32). Permite regenerar un ítem a partir de su semilla.
  function rng(seed) {
    let a = seed >>> 0;
    const next = function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    next.int = (min, max) => min + Math.floor(next() * (max - min + 1));
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.shuffle = (arr) => {
      const a2 = arr.slice();
      for (let i = a2.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [a2[i], a2[j]] = [a2[j], a2[i]];
      }
      return a2;
    };
    next.sample = (arr, k) => next.shuffle(arr).slice(0, k);
    return next;
  }

  function newSeed() {
    if (root.crypto && root.crypto.getRandomValues) {
      return root.crypto.getRandomValues(new Uint32Array(1))[0];
    }
    return Math.floor(Math.random() * 4294967296);
  }

  function clamp(x, lo, hi) {
    return Math.max(lo, Math.min(hi, x));
  }

  IQ.util = { rng, newSeed, clamp };
})(typeof globalThis !== 'undefined' ? globalThis : this);
