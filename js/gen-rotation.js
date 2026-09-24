/* Generador de rotación mental (procesamiento visoespacial, Gv).
 * Paradigma de Shepard & Metzler (1971) en versión bidimensional con
 * poliominós: hay que distinguir la figura rotada de su imagen especular.
 * La dificultad aumenta con la complejidad de la figura (número de bloques),
 * con ángulos no ortogonales y con distractores que difieren en un solo bloque. */
(function (root) {
  'use strict';
  const IQ = (root.IQ = root.IQ || {});
  const { rng } = IQ.util;

  const LEVELS = [
    { level: 1, b: -1.8, n: 5, angles: [90, 180, 270], lures: ['m', 'm', 'm'] },
    { level: 2, b: -1.1, n: 6, angles: [90, 180, 270], lures: ['m', 'm', 'm'] },
    { level: 3, b: -0.4, n: 6, angles: [45, 90, 135, 180, 225, 270, 315], lures: ['m', 'm', 'm'] },
    { level: 4, b: 0.3, n: 7, angles: [30, 60, 120, 150, 210, 240, 300, 330], lures: ['m', 'm', 'm'] },
    { level: 5, b: 0.9, n: 7, angles: [30, 60, 120, 150, 210, 240, 300, 330], lures: ['m', 'm', 'x'] },
    { level: 6, b: 1.5, n: 8, angles: [15, 75, 105, 165, 195, 255, 285, 345], lures: ['m', 'x', 'xm'] },
  ];

  const key = (cells) =>
    normalize(cells)
      .map((c) => c.join(','))
      .join(';');

  function normalize(cells) {
    const mx = Math.min(...cells.map((c) => c[0]));
    const my = Math.min(...cells.map((c) => c[1]));
    return cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  }
  const rot90 = (cells) => cells.map(([x, y]) => [y, -x]);
  const mirror = (cells) => cells.map(([x, y]) => [-x, y]);

  function rotationKeys(cells) {
    const keys = new Set();
    let c = cells;
    for (let i = 0; i < 4; i++) {
      keys.add(key(c));
      c = rot90(c);
    }
    return keys;
  }
  const congruent = (a, b) => rotationKeys(a).has(key(b));
  const isChiral = (cells) => !congruent(cells, mirror(cells));

  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function connected(cells) {
    const set = new Set(cells.map((c) => c.join(',')));
    const seen = new Set([cells[0].join(',')]);
    const stack = [cells[0]];
    while (stack.length) {
      const [x, y] = stack.pop();
      for (const [dx, dy] of NB) {
        const k = x + dx + ',' + (y + dy);
        if (set.has(k) && !seen.has(k)) {
          seen.add(k);
          stack.push([x + dx, y + dy]);
        }
      }
    }
    return seen.size === cells.length;
  }

  function frontier(cells) {
    const set = new Set(cells.map((c) => c.join(',')));
    const out = new Map();
    for (const [x, y] of cells)
      for (const [dx, dy] of NB) {
        const k = x + dx + ',' + (y + dy);
        if (!set.has(k)) out.set(k, [x + dx, y + dy]);
      }
    return Array.from(out.values());
  }

  function randomPolyomino(n, R) {
    for (let tries = 0; tries < 500; tries++) {
      let cells = [[0, 0]];
      while (cells.length < n) cells.push(R.pick(frontier(cells)));
      // Evitamos figuras demasiado alargadas (poco informativas) y las simétricas.
      const w = Math.max(...cells.map((c) => c[0])) - Math.min(...cells.map((c) => c[0])) + 1;
      const h = Math.max(...cells.map((c) => c[1])) - Math.min(...cells.map((c) => c[1])) + 1;
      if (Math.max(w, h) > 4) continue;
      if (isChiral(cells)) return normalize(cells);
    }
    throw new Error('No se pudo generar un poliominó quiral');
  }

  // Mueve un bloque a otra posición manteniendo la conexión y evitando congruencias.
  function movedVariant(cells, avoid, R) {
    for (let tries = 0; tries < 300; tries++) {
      const i = R.int(0, cells.length - 1);
      const rest = cells.filter((_, j) => j !== i);
      if (!connected(rest)) continue;
      const cand = R.pick(frontier(rest).filter((p) => !(p[0] === cells[i][0] && p[1] === cells[i][1])));
      if (!cand) continue;
      const v = rest.concat([cand]);
      if (avoid.some((a) => congruent(a, v) || congruent(mirror(a), v))) continue;
      return normalize(v);
    }
    return null;
  }

  function generate(level, seed) {
    const R = rng(seed);
    const L = LEVELS[level - 1];
    const target = randomPolyomino(L.n, R);
    const angles = R.shuffle(L.angles);
    const used = [target];
    const lures = [];
    for (const kind of L.lures) {
      let cells = null;
      if (kind === 'm') cells = mirror(target);
      else if (kind === 'x') cells = movedVariant(target, used, R);
      else if (kind === 'xm') {
        const v = movedVariant(target, used, R);
        cells = v && mirror(v);
      }
      if (!cells) cells = mirror(target);
      used.push(cells);
      lures.push({ cells: normalize(cells), correct: false });
    }
    const opts = R.shuffle([{ cells: target, correct: true }].concat(lures)).map((o, i) => ({
      cells: o.cells,
      correct: o.correct,
      angle: angles[i % angles.length],
    }));
    return {
      kind: 'rotation',
      level,
      b: L.b,
      seed,
      target,
      targetAngle: 0,
      options: opts,
      answer: opts.findIndex((o) => o.correct),
      explanation: [
        'Solo una opción es la misma figura girada. Las demás son su imagen en espejo o tienen un bloque cambiado de sitio, y ningún giro las hace coincidir.',
      ],
    };
  }

  function renderPoly(cells, angle, label) {
    const cx = cells.reduce((s, c) => s + c[0] + 0.5, 0) / cells.length;
    const cy = cells.reduce((s, c) => s + c[1] + 0.5, 0) / cells.length;
    let maxR = 0;
    for (const [x, y] of cells)
      for (const [ox, oy] of [[0, 0], [1, 0], [0, 1], [1, 1]])
        maxR = Math.max(maxR, Math.hypot(x + ox - cx, y + oy - cy));
    const u = 44 / maxR;
    let s = `<svg viewBox="-50 -50 100 100" class="rot-fig" role="img" aria-label="${label || 'figura'}"><g transform="rotate(${angle})">`;
    for (const [x, y] of cells) {
      s += `<rect x="${((x - cx) * u).toFixed(2)}" y="${((y - cy) * u).toFixed(2)}" width="${u.toFixed(2)}" height="${u.toFixed(2)}" fill="var(--accent)" stroke="var(--cell)" stroke-width="1.6"/>`;
    }
    return s + '</g></svg>';
  }

  IQ.rotation = {
    LEVELS,
    levelInfo: (l) => LEVELS[l - 1],
    generate,
    renderPoly,
    _test: { congruent, mirror, isChiral, connected, normalize },
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
