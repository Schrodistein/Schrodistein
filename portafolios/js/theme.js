/* Apariencia: modo oscuro (predeterminado), claro o según el sistema, y color de fondo
 * elegible para cada modo. Del fondo se derivan las superficies, los bordes y, si hace
 * falta, el color del texto, para que siempre se lea bien. Se guarda en el navegador. */
(function () {
  'use strict';
  const KEY = 'pf.theme';
  const PRESETS = {
    dark: [
      ['Negro terminal', '#0b0e11'],
      ['Grafito', '#16191e'],
      ['Azul noche', '#0b1628'],
      ['Verde bolsa', '#07160f'],
      ['Borgoña', '#1a0d12'],
    ],
    light: [
      ['Gris claro', '#eef1f5'],
      ['Blanco', '#fafafa'],
      ['Hueso', '#f4f0e6'],
      ['Menta', '#ecf4ef'],
      ['Celeste', '#e8f0fb'],
    ],
  };
  const DERIVED = ['--bg', '--surface', '--sunk', '--line', '--grid', '--ink', '--ink-2', '--ink-3', 'color-scheme'];
  const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function load() {
    try {
      return Object.assign({ mode: 'dark', bgDark: '', bgLight: '' }, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch (e) {
      return { mode: 'dark', bgDark: '', bgLight: '' };
    }
  }
  function save(p) {
    try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch (e) {
      /* sin almacenamiento: vale para esta sesión */
    }
  }

  const hex = (h) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  };
  const toHex = (c) => '#' + c.map((x) => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
  function luminance(c) {
    const l = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  }

  function effectiveMode(p) {
    if (p.mode === 'system') return media && media.matches ? 'dark' : 'light';
    return p.mode === 'light' ? 'light' : 'dark';
  }

  function apply() {
    const p = load();
    const mode = effectiveMode(p);
    const root = document.documentElement;
    root.setAttribute('data-theme', mode);
    for (const k of DERIVED) root.style.removeProperty(k);
    const bg = hex(mode === 'dark' ? p.bgDark : p.bgLight);
    if (bg) {
      const W = [255, 255, 255];
      const K = [0, 0, 0];
      const darkBg = luminance(bg) < 0.2;
      const set = (k, v) => root.style.setProperty(k, v);
      set('--bg', toHex(bg));
      if (darkBg) {
        set('--surface', toHex(mix(bg, W, 0.05)));
        set('--sunk', toHex(mix(bg, W, 0.025)));
        set('--line', toHex(mix(bg, W, 0.14)));
        set('--grid', toHex(mix(bg, W, 0.08)));
      } else {
        set('--surface', toHex(mix(bg, W, 0.75)));
        set('--sunk', toHex(mix(bg, W, 0.4)));
        set('--line', toHex(mix(bg, K, 0.12)));
        set('--grid', toHex(mix(bg, K, 0.06)));
      }
      // Un fondo oscuro en modo claro (o al revés) cambia el color del texto
      if (darkBg !== (mode === 'dark')) {
        set('--ink', darkBg ? '#e6ebf2' : '#111722');
        set('--ink-2', darkBg ? '#a3aebd' : '#465163');
        set('--ink-3', darkBg ? '#6c7788' : '#7c8799');
        set('color-scheme', darkBg ? 'dark' : 'light');
      }
    }
    renderPanel(p, mode);
  }

  /* ---------- Panel ---------- */
  function swatches(kind, current) {
    return PRESETS[kind]
      .map(([name, c]) => `<button type="button" class="sw${current.toLowerCase() === c ? ' on' : ''}" data-kind="${kind}" data-color="${c}" style="background:${c}" title="${name}" aria-label="${name}"></button>`)
      .join('');
  }
  function renderPanel(p, mode) {
    const el = document.getElementById('ap-panel');
    if (!el) return;
    const cur = (k) => p[k] || '';
    el.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === p.mode)));
    document.getElementById('ap-sw-dark').innerHTML = swatches('dark', cur('bgDark'));
    document.getElementById('ap-sw-light').innerHTML = swatches('light', cur('bgLight'));
    document.getElementById('ap-dark').value = cur('bgDark') || PRESETS.dark[0][1];
    document.getElementById('ap-light').value = cur('bgLight') || PRESETS.light[0][1];
    document.getElementById('ap-now').textContent = `Ahora: modo ${mode === 'dark' ? 'oscuro' : 'claro'}${p.mode === 'system' ? ' (según el sistema)' : ''}.`;
  }

  function wire() {
    const btn = document.getElementById('ap-btn');
    const panel = document.getElementById('ap-panel');
    if (!btn || !panel) return;
    const close = () => {
      panel.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      btn.setAttribute('aria-expanded', String(!panel.hidden));
    });
    document.addEventListener('click', (e) => {
      // composedPath: la muestra pulsada se redibuja, pero el clic sigue siendo dentro del panel
      if (!panel.hidden && !e.composedPath().includes(panel) && !e.composedPath().includes(btn)) close();
    });
    document.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    panel.addEventListener('click', (e) => {
      const p = load();
      const m = e.target.closest('[data-mode]');
      const sw = e.target.closest('[data-color]');
      if (m) p.mode = m.getAttribute('data-mode');
      else if (sw) p[sw.getAttribute('data-kind') === 'dark' ? 'bgDark' : 'bgLight'] = sw.getAttribute('data-color');
      else if (e.target.id === 'ap-reset') {
        p.bgDark = '';
        p.bgLight = '';
      } else return;
      save(p);
      apply();
    });
    for (const [id, k] of [['ap-dark', 'bgDark'], ['ap-light', 'bgLight']]) {
      document.getElementById(id).addEventListener('input', (e) => {
        const p = load();
        p[k] = e.target.value;
        save(p);
        apply();
      });
    }
    if (media && media.addEventListener) media.addEventListener('change', apply);
    apply();
  }

  apply(); // antes de pintar: evita el destello del tema equivocado
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
  window.PFTheme = { apply, load, PRESETS, luminance: (h) => luminance(hex(h)) };
})();
