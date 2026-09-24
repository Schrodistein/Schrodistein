/* Generador de matrices progresivas (razonamiento fluido, Gf).
 *
 * Basado en la taxonomía de reglas de Carpenter, Just & Shell (1990) —
 * constante por fila, progresión, distribución de tres valores y
 * suma/resta de figuras (aquí XOR de líneas) — y en el enfoque de diseño
 * cognitivo de Embretson (1998): la dificultad se predice a partir del
 * número y tipo de reglas.
 *
 * Los distractores se construyen como en I-RAVEN (Hu et al., 2021): se
 * elige un valor alternativo para 3 atributos y las 8 opciones son las 2³
 * combinaciones. Así cada valor aparece exactamente 4 veces y no se puede
 * acertar eligiendo "el valor más frecuente" entre las opciones. */
(function (root) {
  'use strict';
  const IQ = (root.IQ = root.IQ || {});
  const { rng } = IQ.util;

  const SHAPES = ['circle', 'square', 'triangle', 'pentagon', 'star', 'cross'];
  const SHAPE_NAMES = {
    circle: 'círculo',
    square: 'cuadrado',
    triangle: 'triángulo',
    pentagon: 'pentágono',
    star: 'estrella',
    cross: 'cruz',
    arrow: 'flecha',
  };
  const FILL_NAMES = ['vacío', 'rayado', 'gris', 'negro'];
  const ATTR_NAMES = {
    shape: 'la forma',
    count: 'el número de figuras',
    size: 'el tamaño',
    fill: 'el relleno',
    rot: 'la orientación',
    lines: 'las líneas',
  };

  /* Cada nivel: dificultad b (logits) y las reglas que usa.
   * Las b son estimaciones a priori según Embretson (1998) / Carpenter et al. (1990):
   * cada regla añadida, y en especial las de tipo distribución y XOR, aumentan la
   * carga en memoria de trabajo y la dificultad empírica. */
  const LEVELS = [
    { level: 1, b: -2.2, pick: [[['count', 'prog']], [['size', 'prog']], [['shape', 'row']]] },
    { level: 2, b: -1.5, pick: [[['shape', 'dist3']], [['fill', 'dist3']], [['rot', 'prog']]] },
    {
      level: 3,
      b: -0.9,
      pick: [
        [['count', 'prog'], ['shape', 'dist3']],
        [['size', 'prog'], ['fill', 'dist3']],
        [['rot', 'prog'], ['fill', 'dist3']],
      ],
    },
    {
      level: 4,
      b: -0.3,
      pick: [
        [['shape', 'dist3'], ['fill', 'dist3', 'kdiff']],
        [['count', 'dist3'], ['shape', 'dist3', 'kdiff']],
        [['rot', 'prog', 'varbase'], ['fill', 'dist3']],
      ],
    },
    {
      level: 5,
      b: 0.3,
      pick: [
        [['count', 'prog', 'varbase'], ['shape', 'dist3'], ['fill', 'dist3', 'kdiff']],
        [['size', 'prog'], ['shape', 'dist3'], ['fill', 'dist3', 'kdiff']],
        [['rot', 'prog', 'varbase'], ['size', 'dist3'], ['fill', 'dist3', 'kdiff']],
      ],
    },
    {
      level: 6,
      b: 0.9,
      pick: [
        [['lines', 'xor'], ['shape', 'dist3']],
        [['lines', 'xor'], ['count', 'prog']],
        [['lines', 'xor'], ['fill', 'dist3']],
      ],
    },
    {
      level: 7,
      b: 1.5,
      pick: [
        [['count', 'prog', 'varbase'], ['shape', 'dist3'], ['fill', 'dist3', 'kdiff'], ['size', 'dist3']],
        [['lines', 'xor'], ['shape', 'dist3'], ['fill', 'dist3', 'kdiff']],
      ],
    },
    {
      level: 8,
      b: 2.1,
      pick: [
        [['lines', 'xor'], ['count', 'prog', 'varbase'], ['shape', 'dist3'], ['fill', 'dist3', 'kdiff']],
        [['lines', 'xor'], ['rot', 'prog', 'varbase'], ['size', 'dist3'], ['fill', 'dist3', 'kdiff']],
      ],
    },
  ];

  function domainOf(attr) {
    switch (attr) {
      case 'shape':
        return SHAPES;
      case 'count':
        return [1, 2, 3, 4];
      case 'size':
        return [0, 1, 2];
      case 'fill':
        return [0, 1, 2, 3];
      case 'rot':
        return [0, 1, 2, 3];
      default:
        return null;
    }
  }

  // Construye la rejilla 3×3 de valores de un atributo según su regla.
  function buildRule(attr, type, flags, R, usedK) {
    const g = [[], [], []];
    const desc = { attr, type };
    if (type === 'row') {
      const vals = R.sample(domainOf(attr), 3);
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g[r][c] = vals[r];
    } else if (type === 'dist3') {
      const vals = R.sample(domainOf(attr), 3);
      let k = R.int(1, 2);
      if (flags.includes('kdiff') && usedK.length) k = usedK[0] === 1 ? 2 : 1;
      usedK.push(k);
      desc.k = k;
      desc.vals = vals;
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g[r][c] = vals[(c + k * r) % 3];
    } else if (type === 'prog') {
      const varbase = flags.includes('varbase');
      if (attr === 'count') {
        const base0 = R.int(1, 2);
        for (let r = 0; r < 3; r++) {
          const base = varbase ? R.int(1, 2) : base0;
          for (let c = 0; c < 3; c++) g[r][c] = base + c;
        }
        desc.step = 1;
      } else if (attr === 'size') {
        const up = R() < 0.5;
        for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g[r][c] = up ? c : 2 - c;
        desc.step = up ? 1 : -1;
      } else if (attr === 'rot') {
        const step = R() < 0.5 ? 1 : 3; // 90° horario o antihorario
        const base0 = R.int(0, 3);
        for (let r = 0; r < 3; r++) {
          const base = varbase ? R.int(0, 3) : base0;
          for (let c = 0; c < 3; c++) g[r][c] = (base + step * c) % 4;
        }
        desc.step = step;
      }
    } else if (type === 'xor') {
      for (let r = 0; r < 3; r++) {
        let m1, m2, m3;
        do {
          m1 = R.int(1, 15);
          m2 = R.int(1, 15);
          m3 = m1 ^ m2;
        } while (m1 === m2 || m3 === 0 || m3 === m1 || m3 === m2);
        g[r] = [m1, m2, m3];
      }
    }
    return { grid: g, desc };
  }

  function describe(desc) {
    const n = ATTR_NAMES[desc.attr];
    switch (desc.type) {
      case 'row':
        return `En cada fila ${n} se mantiene constante.`;
      case 'dist3':
        return `En cada fila aparecen los mismos tres valores de ${n.replace(/^(el|la|las) /, '')}, cada uno una vez (rotan de una fila a otra).`;
      case 'prog':
        if (desc.attr === 'count') return 'El número de figuras aumenta en 1 de izquierda a derecha.';
        if (desc.attr === 'size')
          return desc.step > 0 ? 'Las figuras crecen de izquierda a derecha.' : 'Las figuras se encogen de izquierda a derecha.';
        return `La flecha gira 90° ${desc.step === 1 ? 'en sentido horario' : 'en sentido antihorario'} en cada paso.`;
      case 'xor':
        return 'Líneas: la tercera casilla contiene las líneas que aparecen en solo una de las dos primeras (se anulan las repetidas).';
      default:
        return '';
    }
  }

  function levelInfo(level) {
    return LEVELS[level - 1];
  }

  function generate(level, seed) {
    const R = rng(seed);
    const L = LEVELS[level - 1];
    const plan = R.pick(L.pick);
    const ruled = new Set(plan.map((p) => p[0]));

    // Valores globales para atributos sin regla.
    const hasRot = ruled.has('rot');
    const base = {
      shape: hasRot ? 'arrow' : R.pick(SHAPES),
      count: 1,
      size: ruled.has('count') ? R.int(1, 2) : 2,
      fill: R.pick([0, 1, 2, 3]),
      rot: 0,
      lines: 0,
    };
    if (!ruled.has('count') && !ruled.has('size') && R() < 0.35) base.count = R.int(1, 2);

    const grids = {};
    const descs = [];
    const usedK = [];
    for (const [attr, type, ...flags] of plan) {
      const { grid, desc } = buildRule(attr, type, flags, R, usedK);
      grids[attr] = grid;
      descs.push(desc);
    }

    const cells = [];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = Object.assign({}, base);
        for (const attr in grids) cell[attr] = grids[attr][r][c];
        cells.push(cell);
      }
    }
    const correct = cells[8];

    // Atributos a perturbar para los distractores: primero los que tienen regla.
    const pool = R.shuffle(Array.from(ruled));
    const extras = R.shuffle(['fill', 'size', 'count', 'shape'].filter((a) => !ruled.has(a)));
    for (const a of extras) {
      if (pool.length >= 3) break;
      if (a === 'shape' && hasRot) continue;
      pool.push(a);
    }
    const perturb = pool.slice(0, 3);

    const alt = {};
    for (const attr of perturb) alt[attr] = alternative(attr, correct[attr], grids[attr], descs, R);

    const options = [];
    for (let mask = 0; mask < 8; mask++) {
      const o = Object.assign({}, correct);
      perturb.forEach((attr, i) => {
        if (mask & (1 << i)) o[attr] = alt[attr];
      });
      options.push({ mask, cell: o });
    }
    const shuffled = R.shuffle(options);
    const answer = shuffled.findIndex((o) => o.mask === 0);

    return {
      kind: 'matrix',
      level,
      b: L.b,
      seed,
      cells: cells.slice(0, 8),
      options: shuffled.map((o) => o.cell),
      answer,
      explanation: descs.map(describe),
    };
  }

  // Valor alternativo plausible (tomado del propio problema cuando es posible).
  function alternative(attr, value, grid, descs, R) {
    if (attr === 'lines') {
      return value ^ (1 << R.int(0, 3));
    }
    if (attr === 'count') {
      const cands = [value - 1, value + 1].filter((v) => v >= 1 && v <= 4);
      return R.pick(cands);
    }
    if (grid) {
      const seen = new Set();
      grid.forEach((row) => row.forEach((v) => seen.add(v)));
      seen.delete(value);
      if (seen.size) return R.pick(Array.from(seen));
    }
    const dom = domainOf(attr).filter((v) => v !== value);
    return R.pick(dom);
  }

  /* ---------- Renderizado SVG ---------- */
  const SIZE_F = [0.52, 0.76, 1.0];
  const LAYOUT = {
    1: { r: 34, p: [[50, 50]] },
    2: { r: 21, p: [[27, 50], [73, 50]] },
    3: { r: 19, p: [[50, 27], [27, 71], [73, 71]] },
    4: { r: 18, p: [[29, 29], [71, 29], [29, 71], [71, 71]] },
  };
  const FILLS = ['var(--cell)', 'url(#iq-hatch)', 'var(--ink-3)', 'var(--ink)'];

  function poly(cx, cy, r, n, start, inner) {
    const pts = [];
    const total = inner ? n * 2 : n;
    for (let i = 0; i < total; i++) {
      const rr = inner && i % 2 ? r * inner : r;
      const ang = start + (i * 2 * Math.PI) / total;
      pts.push((cx + rr * Math.cos(ang)).toFixed(1) + ',' + (cy + rr * Math.sin(ang)).toFixed(1));
    }
    return pts.join(' ');
  }

  function shapeSvg(shape, cx, cy, r, fill, rot) {
    const common = `fill="${FILLS[fill]}" stroke="var(--ink)" stroke-width="2.2" stroke-linejoin="round"`;
    const tr = rot ? ` transform="rotate(${rot * 90} ${cx} ${cy})"` : '';
    const up = -Math.PI / 2;
    switch (shape) {
      case 'circle':
        return `<circle cx="${cx}" cy="${cy}" r="${(r * 0.9).toFixed(1)}" ${common}/>`;
      case 'square':
        return `<polygon points="${poly(cx, cy, r * 1.05, 4, -Math.PI / 4)}" ${common}${tr}/>`;
      case 'triangle':
        return `<polygon points="${poly(cx, cy + r * 0.12, r * 1.1, 3, up)}" ${common}${tr}/>`;
      case 'pentagon':
        return `<polygon points="${poly(cx, cy + r * 0.05, r, 5, up)}" ${common}${tr}/>`;
      case 'star':
        return `<polygon points="${poly(cx, cy + r * 0.06, r * 1.08, 5, up, 0.45)}" ${common}${tr}/>`;
      case 'cross': {
        const w = r * 0.36;
        const p = [
          [-w, -r], [w, -r], [w, -w], [r, -w], [r, w], [w, w],
          [w, r], [-w, r], [-w, w], [-r, w], [-r, -w], [-w, -w],
        ].map(([x, y]) => `${(cx + x).toFixed(1)},${(cy + y).toFixed(1)}`);
        return `<polygon points="${p.join(' ')}" ${common}${tr}/>`;
      }
      case 'arrow': {
        const p = [
          [0, -r], [r * 0.75, -r * 0.05], [r * 0.28, -r * 0.05], [r * 0.28, r],
          [-r * 0.28, r], [-r * 0.28, -r * 0.05], [-r * 0.75, -r * 0.05],
        ].map(([x, y]) => `${(cx + x).toFixed(1)},${(cy + y).toFixed(1)}`);
        return `<polygon points="${p.join(' ')}" ${common}${tr}/>`;
      }
    }
    return '';
  }

  const LINE_DEFS = [
    [8, 50, 92, 50],
    [50, 8, 50, 92],
    [12, 12, 88, 88],
    [88, 12, 12, 88],
  ];

  function cellInner(cell) {
    const L = LAYOUT[cell.count];
    const r = L.r * SIZE_F[cell.size];
    let s = L.p.map(([x, y]) => shapeSvg(cell.shape, x, y, r, cell.fill, cell.rot)).join('');
    for (let i = 0; i < 4; i++) {
      if (cell.lines & (1 << i)) {
        const [x1, y1, x2, y2] = LINE_DEFS[i];
        s += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="var(--accent)" stroke-width="3.2" stroke-linecap="round"/>`;
      }
    }
    return s;
  }

  const DEFS =
    '<defs><pattern id="iq-hatch" patternUnits="userSpaceOnUse" width="5" height="5" patternTransform="rotate(45)">' +
    '<rect width="5" height="5" fill="var(--cell)"/><line x1="0" y1="0" x2="0" y2="5" style="stroke:var(--ink);stroke-width:1.6"/></pattern></defs>';

  function renderCell(cell) {
    return `<svg viewBox="0 0 100 100" class="mx-cell" role="img" aria-label="opción">${DEFS}<rect x="1" y="1" width="98" height="98" rx="4" fill="var(--cell)"/>${cellInner(cell)}</svg>`;
  }

  function renderMatrix(item) {
    let s = `<svg viewBox="0 0 316 316" class="mx-grid" role="img" aria-label="Matriz de 3 por 3 con la última casilla vacía">${DEFS}`;
    for (let i = 0; i < 9; i++) {
      const x = (i % 3) * 106;
      const y = Math.floor(i / 3) * 106;
      s += `<g transform="translate(${x} ${y})"><rect x="1" y="1" width="102" height="102" rx="5" fill="var(--cell)" stroke="var(--line)" stroke-width="1.5"/>`;
      if (i < 8) s += `<g transform="translate(2 2)">${cellInner(item.cells[i])}</g>`;
      else
        s += `<rect x="1" y="1" width="102" height="102" rx="5" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="2" stroke-dasharray="6 5"/><text x="52" y="66" text-anchor="middle" font-size="44" font-weight="600" fill="var(--accent)" font-family="var(--font-display)">?</text>`;
      s += '</g>';
    }
    return s + '</svg>';
  }

  IQ.matrices = {
    LEVELS,
    levelInfo,
    generate,
    renderCell,
    renderMatrix,
    SHAPE_NAMES,
    FILL_NAMES,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
