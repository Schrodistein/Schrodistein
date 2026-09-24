/* Interfaz de la aplicación: navegación, aplicación de la batería,
 * resultados, práctica, historial y torre de Hanói. */
(function () {
  'use strict';
  const { battery: B, irt, charts, util } = IQ;
  const SUB = B.SUBTESTS;

  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const fmt = (n, d) => Number(n).toLocaleString('es-ES', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });

  const store = {
    get(k, def) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? def : JSON.parse(v);
      } catch (e) {
        return def;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch (e) {
        /* almacenamiento no disponible */
      }
    },
  };

  /* ---------- Navegación ---------- */
  const SCREENS = ['home', 'test', 'results', 'train', 'ranges', 'science', 'history'];
  function go(name) {
    SCREENS.forEach((s) => ($('#screen-' + s).hidden = s !== name));
    $$('#nav button').forEach((b) => b.setAttribute('aria-current', b.dataset.go === name ? 'page' : 'false'));
    $('#nav').hidden = name === 'test';
    $('.brand').disabled = name === 'test';
    if (name === 'ranges') renderRanges();
    if (name === 'history') renderHistory();
    window.scrollTo(0, 0);
    try {
      if (name !== 'test' && name !== 'results') history.replaceState(null, '', name === 'home' ? location.pathname : '#' + name);
    } catch (e) {
      /* sin history API */
    }
  }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]');
    if (b && !b.disabled) go(b.dataset.go);
  });

  /* ---------- Portada ---------- */
  function renderHome() {
    $('#home-bell').innerHTML = charts.bell({ showRanges: true });
    const bySub = {};
    B.ORDER.forEach((id) => (bySub[SUB[id].index] = (bySub[SUB[id].index] || []).concat(SUB[id].title)));
    $('#home-indexes').innerHTML = B.INDEX_ORDER.map((k) => {
      const I = B.INDEXES[k];
      return `<div><span class="code">${k} · ${I.chc}</span><strong>${I.name}</strong><span class="small muted">${I.desc}</span><span class="small">${bySub[k].join(' · ')}</span></div>`;
    }).join('');
    const lastAge = store.get('iq-age', null);
    if (lastAge) $('#age').value = lastAge;
  }

  $('#setup').addEventListener('submit', (e) => {
    e.preventDefault();
    const age = parseInt($('#age').value, 10);
    const err = $('#setup-error');
    err.hidden = true;
    if (!(age >= 16 && age <= 90)) {
      err.textContent = 'Escribe una edad entre 16 y 90 años. Los baremos infantiles son muy distintos y esta prueba no los incluye.';
      err.hidden = false;
      $('#age').focus();
      return;
    }
    if (!$('#consent').checked) {
      err.textContent = 'Marca la casilla de confirmación para empezar.';
      err.hidden = false;
      return;
    }
    store.set('iq-age', age);
    const mode = $('input[name=mode]:checked').value;
    startSession(B.createSession({ mode, age }));
  });

  /* ---------- Motor de espera cancelable ---------- */
  const ABORT = { abort: true };
  let ctx = null;
  let keyHandler = null;
  document.addEventListener('keydown', (e) => {
    if (keyHandler && !e.metaKey && !e.ctrlKey && !e.altKey) keyHandler(e);
  });

  function wait(setup) {
    return new Promise((resolve, reject) => {
      if (!ctx || ctx.aborted) return reject(ABORT);
      let cleanup = () => {};
      let settled = false;
      const done = (v) => {
        if (settled) return;
        settled = true;
        cleanup();
        ctx.pending = null;
        resolve(v);
      };
      ctx.pending = () => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(ABORT);
      };
      cleanup = setup(done) || (() => {});
    });
  }
  const sleep = (ms) => wait((done) => {
    const t = setTimeout(done, ms);
    return () => clearTimeout(t);
  });

  function startTimer(seconds, onTimeout) {
    const bar = $('#t-timer');
    const fill = bar.firstElementChild;
    const t0 = performance.now();
    bar.classList.remove('low');
    fill.style.transform = 'scaleX(1)';
    const iv = setInterval(() => {
      const left = 1 - (performance.now() - t0) / (seconds * 1000);
      fill.style.transform = `scaleX(${Math.max(0, left)})`;
      bar.classList.toggle('low', left < 0.2);
      if (left <= 0) {
        clearInterval(iv);
        onTimeout && onTimeout();
      }
    }, 100);
    return () => {
      clearInterval(iv);
      fill.style.transform = 'scaleX(0)';
      bar.classList.remove('low');
    };
  }

  const stage = () => $('#stage');

  /* ---------- Sesión ---------- */
  let session = null;

  function setProgress(stIndex, frac) {
    const n = session.plan.length;
    $('#t-progress').style.width = (100 * (stIndex + Math.min(1, frac || 0))) / n + '%';
  }

  async function startSession(s) {
    session = s;
    ctx = { aborted: false, pending: null };
    go('test');
    requestWakeLock();
    try {
      for (let i = 0; i < session.plan.length; i++) {
        const stId = session.plan[i];
        const def = SUB[stId];
        $('#t-title').textContent = def.title;
        $('#t-count').textContent = session.practice ? 'Práctica' : `Subprueba ${i + 1} de ${session.plan.length}`;
        setProgress(i, 0);
        await intro(def, i);
        if (def.kind === 'gen' || def.kind === 'bank') await runItems(stId, i);
        else if (def.kind === 'span') await runSpan(stId, i);
        else if (def.kind === 'speed') await runSpeed(stId, i);
      }
      setProgress(session.plan.length, 0);
      finish();
    } catch (e) {
      if (e !== ABORT) {
        console.error(e);
        stage().innerHTML = `<p class="feedback ko">Ha ocurrido un error inesperado: ${esc(e.message)}</p>`;
      }
    } finally {
      releaseWakeLock();
    }
  }

  function abortSession() {
    if (!ctx) return;
    ctx.aborted = true;
    if (ctx.pending) ctx.pending();
    keyHandler = null;
    session = null;
    go(lastScreenBeforeTest);
  }
  let lastScreenBeforeTest = 'home';
  $('#abort').addEventListener('click', () => {
    const btn = $('#abort');
    if (btn.dataset.armed) {
      delete btn.dataset.armed;
      btn.textContent = 'Abandonar';
      abortSession();
    } else {
      btn.dataset.armed = '1';
      btn.textContent = 'Toca otra vez para abandonar (se pierde el progreso)';
      setTimeout(() => {
        delete btn.dataset.armed;
        btn.textContent = 'Abandonar';
      }, 4000);
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && session && !session.practice && ctx && !ctx.aborted) session.flags.hidden++;
  });
  window.addEventListener('beforeunload', (e) => {
    if (session && !session.practice && ctx && !ctx.aborted && !$('#screen-test').hidden) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  let wakeLock = null;
  function requestWakeLock() {
    try {
      if (navigator.wakeLock) navigator.wakeLock.request('screen').then((l) => (wakeLock = l)).catch(() => {});
    } catch (e) {
      /* no disponible */
    }
  }
  function releaseWakeLock() {
    try {
      if (wakeLock) wakeLock.release();
    } catch (e) {
      /* ignorado */
    }
    wakeLock = null;
  }

  function intro(def) {
    const extra =
      def.kind === 'gen' || def.kind === 'bank'
        ? `${def.n[session.mode] || def.n.full} ítems · máximo ${def.time} s por ítem`
        : def.kind === 'span'
        ? 'La longitud aumenta mientras aciertes al menos uno de cada dos intentos'
        : `${session.practice ? 45 : def.duration[session.mode]} segundos`;
    stage().innerHTML = `<div class="intro"><h2>${def.title}</h2><p>${def.intro}</p><p class="count">${extra}</p>
      ${session.practice ? '<p class="small muted">Modo práctica: verás la solución después de cada respuesta.</p>' : ''}
      <div><button class="btn primary" type="button" id="go">Empezar</button></div></div>`;
    $('#t-timer').firstElementChild.style.transform = 'scaleX(0)';
    return wait((done) => {
      const b = $('#go');
      b.focus();
      b.addEventListener('click', () => done());
      keyHandler = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          done();
        }
      };
      return () => (keyHandler = null);
    });
  }

  /* ---------- Ítems de opción múltiple / numéricos ---------- */
  async function runItems(stId, stIndex) {
    const def = SUB[stId];
    const total = def.n[session.mode] || def.n.full;
    let k = 0;
    while (B.itemsLeft(session, stId) > 0) {
      const item = B.nextItem(session, stId);
      if (!item) break;
      $('#t-count').textContent = `${session.practice ? 'Práctica' : 'Subprueba ' + (stIndex + 1) + ' de ' + session.plan.length} · ítem ${k + 1}/${total}`;
      const res = await presentItem(def, item);
      B.record(session, stId, item, res.correct, { rt: res.rt, timedOut: res.timedOut, level: item.level, id: item.id });
      k++;
      setProgress(stIndex, k / total);
      if (session.practice) await showFeedback(item, res);
      else await sleep(150);
    }
  }

  function optionsHtml(item) {
    if (item.kind === 'matrix') {
      return `<div class="split mx"><div>${IQ.matrices.renderMatrix(item)}</div><div class="options eight">${item.options
        .map((c, i) => `<button class="opt" type="button" aria-label="Opción ${i + 1}"><span class="k">${i + 1}</span>${IQ.matrices.renderCell(c)}</button>`)
        .join('')}</div></div>`;
    }
    if (item.kind === 'rotation') {
      return `<p class="question">¿Cuál es la misma figura, solo girada?</p><div class="target">${IQ.rotation.renderPoly(item.target, 0, 'figura modelo')}</div>
        <div class="options four-fig">${item.options
          .map((o, i) => `<button class="opt" type="button" aria-label="Opción ${i + 1}"><span class="k">${i + 1}</span>${IQ.rotation.renderPoly(o.cells, o.angle, 'opción ' + (i + 1))}</button>`)
          .join('')}</div>`;
    }
    return `<p class="question">${esc(item.q)}</p><div class="options text">${item.options
      .map((o, i) => `<button class="opt textopt" type="button"><span class="k">${i + 1}</span>${esc(o)}</button>`)
      .join('')}</div>`;
  }

  function presentItem(def, item) {
    const numeric = item.kind === 'series' || item.numeric;
    return wait((done) => {
      const t0 = performance.now();
      const rt = () => Math.round(performance.now() - t0);
      let cleanupKeypad = () => {};
      if (numeric) {
        const head =
          item.kind === 'series'
            ? `<p class="question">¿Qué número sigue?</p><div class="series">${item.shown.map((n) => `<span>${n}</span>`).join('')}<span class="q">?</span></div>`
            : `<p class="question">${esc(item.q)}</p>`;
        stage().innerHTML = head + '<div id="kp"></div>';
        cleanupKeypad = keypad($('#kp'), {
          sign: true,
          decimal: item.kind !== 'series',
          label: 'Responder',
          onSubmit: (v) => {
            const val = item.kind === 'series' ? item.answer : item.answerValue;
            done({ value: v, correct: B.checkNumeric(v, val), rt: rt(), timedOut: false });
          },
        });
      } else {
        stage().innerHTML = optionsHtml(item);
        const btns = $$('.opt', stage());
        const choose = (i) => done({ chosen: i, correct: i === item.answer, rt: rt(), timedOut: false });
        btns.forEach((b, i) => b.addEventListener('click', () => choose(i)));
        keyHandler = (e) => {
          const n = parseInt(e.key, 10);
          if (n >= 1 && n <= btns.length) choose(n - 1);
        };
      }
      const stop = startTimer(def.time, () => done({ chosen: -1, correct: false, rt: rt(), timedOut: true }));
      return () => {
        keyHandler = null;
        stop();
        cleanupKeypad();
      };
    });
  }

  function showFeedback(item, res) {
    const btns = $$('.opt', stage());
    if (btns.length) {
      btns.forEach((b) => (b.disabled = true));
      if (btns[item.answer]) btns[item.answer].classList.add('is-correct');
      if (res.chosen >= 0 && res.chosen !== item.answer) btns[res.chosen].classList.add('is-wrong');
    }
    let answerText = '';
    if (item.kind === 'series') answerText = `La respuesta es <span class="num">${item.answer}</span>. `;
    else if (item.numeric) answerText = `La respuesta es <span class="num">${fmt(item.answerValue, item.answerValue % 1 ? 1 : 0)}</span>. `;
    const title = res.timedOut ? 'Se acabó el tiempo' : res.correct ? 'Correcto' : 'Incorrecto';
    const box = document.createElement('div');
    box.className = 'feedback ' + (res.correct ? 'ok' : 'ko');
    box.innerHTML = `<strong>${title}</strong><span>${answerText}${item.explanation.map(esc).join(' ')}</span><div><button class="btn primary" type="button">Siguiente</button></div>`;
    stage().appendChild(box);
    return wait((done) => {
      const b = $('button', box);
      b.focus();
      b.addEventListener('click', () => done());
      keyHandler = (e) => e.key === 'Enter' && (e.preventDefault(), done());
      return () => (keyHandler = null);
    });
  }

  /* Teclado numérico en pantalla (+ teclado físico). Devuelve función de limpieza. */
  function keypad(host, opts) {
    let value = '';
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
    const row4 = opts.digitsOnly ? ['⌫', '0', 'OK'] : [opts.sign ? '−' : '', '0', opts.decimal ? ',' : ''];
    host.innerHTML = `<div class="stack" style="align-items:center"><div class="answerbox" aria-live="polite">&nbsp;</div><div class="keypad">${keys
      .concat(row4)
      .map((k) => {
        if (k === '') return '<button type="button" class="blank" tabindex="-1" aria-hidden="true"></button>';
        if (k === 'OK') return `<button type="button" data-k="ok" class="span2" style="grid-column:auto">${opts.label}</button>`;
        return `<button type="button" data-k="${k}" aria-label="${k === '⌫' ? 'Borrar' : k}">${k}</button>`;
      })
      .join('')}${opts.digitsOnly ? '' : `<button type="button" data-k="⌫" aria-label="Borrar">⌫</button><button type="button" data-k="ok" class="span2">${opts.label}</button>`}</div></div>`;
    const box = $('.answerbox', host);
    const render = () => (box.innerHTML = value ? esc(opts.digitsOnly ? value.split('').join(' ') : value) : '&nbsp;');
    const press = (k) => {
      if (k === 'ok') {
        if (value && value !== '−') opts.onSubmit(value.replace('−', '-'));
        return;
      }
      if (k === '⌫') value = value.slice(0, -1);
      else if (k === '−') value = value.startsWith('−') ? value.slice(1) : '−' + value;
      else if (k === ',') {
        if (!value.includes(',')) value += value && value !== '−' ? ',' : '0,';
      } else if (value.replace(/[^0-9]/g, '').length < 12) value += k;
      render();
      if (opts.onChange) opts.onChange(value);
    };
    $$('button[data-k]', host).forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
    keyHandler = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') press('⌫');
      else if (e.key === 'Enter') {
        e.preventDefault();
        press('ok');
      } else if ((e.key === '-' || e.key === '−') && opts.sign) press('−');
      else if ((e.key === ',' || e.key === '.') && opts.decimal) press(',');
    };
    return () => (keyHandler = null);
  }

  /* ---------- Amplitud: dígitos y Corsi ---------- */
  function digitSequence(L, R) {
    const s = [];
    while (s.length < L) {
      const d = R.int(1, 9);
      if (d !== s[s.length - 1]) s.push(d);
    }
    return s;
  }

  const CORSI_POS = [
    [8, 62], [20, 14], [38, 40], [52, 8], [58, 70], [70, 36], [80, 76], [80, 8], [26, 80],
  ];

  async function runSpan(stId, stIndex) {
    const def = SUB[stId];
    const R = session.seedRng;
    let L = def.start;
    let trials = 0;
    for (;;) {
      let ok = 0;
      for (let t = 0; t < 2; t++) {
        $('#t-count').textContent = `${session.practice ? 'Práctica' : 'Subprueba ' + (stIndex + 1) + ' de ' + session.plan.length} · ${L} elementos · intento ${t + 1}/2`;
        let correct;
        let expected;
        if (def.mode === 'corsi') {
          const seq = R.sample([0, 1, 2, 3, 4, 5, 6, 7, 8], Math.min(L, 9));
          expected = seq;
          const got = await corsiTrial(seq);
          correct = got.join(',') === seq.join(',');
        } else {
          const seq = digitSequence(L, R);
          expected = def.mode === 'backward' ? seq.slice().reverse() : seq;
          const got = await digitTrial(seq, def.mode);
          correct = got === expected.join('');
        }
        B.record(session, stId, B.spanItem(stId, L), correct, { length: L });
        ok += correct ? 1 : 0;
        trials++;
        setProgress(stIndex, Math.min(0.95, trials / 12));
        if (session.practice) await spanFeedback(correct, expected, def.mode);
        else await sleep(400);
      }
      if (!ok || L >= def.max) break;
      L++;
    }
  }

  async function digitTrial(seq, mode) {
    stage().innerHTML = `<p class="muted">Atención…</p><div class="bigdigit num" id="bd"></div>`;
    await sleep(900);
    const bd = $('#bd');
    for (const d of seq) {
      bd.textContent = d;
      await sleep(800);
      bd.textContent = '';
      await sleep(200);
    }
    stage().innerHTML = `<p class="question">${mode === 'backward' ? 'Escribe los números en orden inverso' : 'Escribe los números en el mismo orden'}</p><div id="kp"></div>`;
    return wait((done) => keypad($('#kp'), { digitsOnly: true, label: 'Listo', onSubmit: (v) => done(v) }));
  }

  async function corsiTrial(seq) {
    stage().innerHTML = `<p class="question" id="cq">Observa la secuencia</p><div class="corsi locked" id="board">${CORSI_POS.map(
      ([x, y], i) => `<button type="button" style="left:${x}%;top:${y}%" aria-label="Bloque ${i + 1}" data-i="${i}"></button>`
    ).join('')}</div>`;
    const blocks = $$('#board button');
    await sleep(800);
    for (const i of seq) {
      blocks[i].classList.add('lit');
      await sleep(700);
      blocks[i].classList.remove('lit');
      await sleep(300);
    }
    $('#board').classList.remove('locked');
    $('#cq').textContent = 'Toca los bloques en el mismo orden';
    const taps = [];
    return wait((done) => {
      const handlers = blocks.map((b, i) => {
        const h = () => {
          if (taps.length >= seq.length) return;
          taps.push(i);
          b.classList.add('tapped');
          setTimeout(() => b.classList.remove('tapped'), 250);
          if (taps.length === seq.length) setTimeout(() => done(taps), 350);
        };
        b.addEventListener('click', h);
        return h;
      });
      return () => blocks.forEach((b, i) => b.removeEventListener('click', handlers[i]));
    });
  }

  function spanFeedback(correct, expected, mode) {
    const box = document.createElement('div');
    box.className = 'feedback ' + (correct ? 'ok' : 'ko');
    const sol =
      mode === 'corsi' ? `Orden correcto: bloques ${expected.map((i) => i + 1).join(' → ')}.` : `Respuesta correcta: <span class="num">${expected.join(' ')}</span>.`;
    box.innerHTML = `<strong>${correct ? 'Correcto' : 'Incorrecto'}</strong><span>${sol}</span><div><button class="btn primary" type="button">Siguiente</button></div>`;
    stage().appendChild(box);
    return wait((done) => {
      $('button', box).addEventListener('click', () => done());
      keyHandler = (e) => e.key === 'Enter' && (e.preventDefault(), done());
      return () => (keyHandler = null);
    });
  }

  /* ---------- Velocidad: búsqueda de símbolos ---------- */
  const GLYPHS = 'ΔΘΛΞΠΣΦΨΩЖЯЮБДИЛ'.split('');

  async function runSpeed(stId, stIndex) {
    const def = SUB[stId];
    const secs = session.practice ? 45 : def.duration[session.mode];
    const R = session.seedRng;
    let correctN = 0;
    let errorsN = 0;
    const t0 = performance.now();
    const end = t0 + secs * 1000;
    const stopTimer = startTimer(secs);
    try {
      while (performance.now() < end) {
        const targets = R.sample(GLYPHS, 2);
        const present = R() < 0.5;
        const others = R.sample(GLYPHS.filter((g) => !targets.includes(g)), present ? 4 : 5);
        if (present) others.splice(R.int(0, 4), 0, R.pick(targets));
        stage().innerHTML = `<div class="speed"><div class="glyphs targets">${targets.map((g) => `<span>${g}</span>`).join('')}</div><div class="sep"></div><div class="glyphs">${others
          .map((g) => `<span>${g}</span>`)
          .join('')}</div></div><div class="yesno"><button class="btn" type="button" data-a="1">Sí</button><button class="btn" type="button" data-a="0">No</button></div><p class="small muted num">Aciertos ${correctN} · Errores ${errorsN}</p>`;
        const ans = await wait((done) => {
          $$('.yesno button').forEach((b) => b.addEventListener('click', () => done(b.dataset.a === '1')));
          keyHandler = (e) => {
            if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 's') done(true);
            if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'n') done(false);
          };
          const tt = setTimeout(() => done(null), Math.max(0, end - performance.now()));
          return () => {
            keyHandler = null;
            clearTimeout(tt);
          };
        });
        if (ans === null) break;
        if (ans === present) correctN++;
        else errorsN++;
        setProgress(stIndex, (performance.now() - t0) / (secs * 1000));
        if (session.practice && ans !== present) {
          stage().insertAdjacentHTML('beforeend', `<p class="feedback ko">${present ? 'Sí estaba: ' + others.filter((g) => targets.includes(g)).join('') : 'No había ninguno'}</p>`);
          await sleep(900);
        }
      }
    } finally {
      stopTimer();
    }
    B.recordSpeed(session, stId, correctN, errorsN, secs);
    stage().innerHTML = `<p class="question">Tiempo</p><p class="num">${correctN} aciertos · ${errorsN} errores</p>`;
    await sleep(1400);
  }

  /* ---------- Final ---------- */
  function finish() {
    const s = session;
    const result = B.score(s);
    session = null;
    if (s.practice) return renderPracticeEnd(s, result);
    const summary = {};
    for (const r of s.responses) {
      const x = (summary[r.subtest] = summary[r.subtest] || { n: 0, ok: 0 });
      x.n++;
      x.ok += r.correct ? 1 : 0;
    }
    s.continuous.forEach((c) => (summary[c.subtest] = { speed: c.raw }));
    const entry = {
      id: Date.now(),
      date: new Date().toISOString(),
      age: s.age,
      mode: s.mode,
      minutes: Math.round((Date.now() - s.startedAt) / 60000),
      total: result.total,
      indices: result.indices,
      validity: result.validity,
      strengths: result.strengths,
      summary,
    };
    const hist = store.get('iq-history', []);
    hist.unshift(entry);
    store.set('iq-history', hist.slice(0, 30));
    renderResults(entry);
  }

  function pctText(p) {
    if (p > 99.9) return '>99,9';
    if (p < 0.1) return '<0,1';
    return fmt(p, p < 10 || p > 90 ? 1 : 0);
  }

  function renderResults(entry) {
    const T = entry.total;
    const date = new Date(entry.date).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const rows = [{ label: 'CI total', iq: T.iq, ciLow: T.ciLow, ciHigh: T.ciHigh, total: true }].concat(
      B.INDEX_ORDER.filter((k) => entry.indices[k]).map((k) => ({ ...entry.indices[k], label: `${B.INDEXES[k].short} (${k})` }))
    );
    const strengthOf = (k) => (entry.strengths || []).find((x) => x.index === k);
    const warns = entry.validity.warnings;
    const plus = Math.round((T.ciHigh - T.ciLow) / 2);
    const subLines = Object.entries(entry.summary)
      .map(([id, v]) => {
        const def = SUB[id];
        if (!def) return '';
        return v.speed
          ? `<tr><td>${def.title}</td><td class="num">${v.speed.correctN} aciertos, ${v.speed.errorsN} errores en ${v.speed.seconds} s</td></tr>`
          : `<tr><td>${def.title}</td><td class="num">${v.ok} / ${v.n}</td></tr>`;
      })
      .join('');
    $('#screen-results').innerHTML = `
      <div class="score-head">
        <p class="eyebrow">Resultado · ${date} · versión ${entry.mode === 'full' ? 'completa' : 'breve'} · ${entry.age} años</p>
        <h2>Tu CI estimado</h2>
      </div>
      <div class="score-big"><span class="n num">${T.iq}</span><div class="stack" style="gap:6px"><span class="pill">${T.range.label}</span><span class="ci">IC 95 %: ${T.ciLow}–${T.ciHigh}</span></div></div>
      <div class="facts">
        <div><span class="small muted">Percentil</span><span class="v">${pctText(T.percentile)}</span><span class="small muted">Por encima del ${pctText(T.percentile)} % de tu grupo de edad</span></div>
        <div><span class="small muted">Precisión</span><span class="v">±${plus}</span><span class="small muted">puntos al 95 % de confianza</span></div>
        <div><span class="small muted">Categorías compatibles</span><span class="v" style="font-size:1rem;font-family:var(--font-body)">${compatibleRanges(T.ciLow, T.ciHigh)}</span></div>
      </div>
      ${charts.bell({ iq: T.iq, ciLow: T.ciLow, ciHigh: T.ciHigh })}
      ${warns.length ? `<div class="warn"><strong>Avisos de validez</strong>${warns.map((w) => `<span class="small">${esc(w)}</span>`).join('')}<span class="small muted">El resultado puede infraestimar tu capacidad real.</span></div>` : ''}
      <div class="stack">
        <h3>Perfil de índices</h3>
        <div class="table-wrap">${charts.profile(rows)}</div>
        <p class="small muted">Puntos = puntuación estimada; barras = intervalo de confianza al 95 %; franja sombreada = rango promedio (90–109).</p>
      </div>
      <div class="index-list">${B.INDEX_ORDER.filter((k) => entry.indices[k])
        .map((k) => {
          const I = entry.indices[k];
          const s = strengthOf(k);
          return `<div><strong>${B.INDEXES[k].name} <span class="small muted">(${k})</span></strong><span class="v">${I.iq} <span class="small muted">[${I.ciLow}–${I.ciHigh}]</span></span>
            <span class="small muted">${B.INDEXES[k].desc}</span><span class="small" style="text-align:right">${I.range.label}${s ? ` · <strong>${s.kind === 'fortaleza' ? 'Fortaleza' : 'Debilidad'} personal</strong>` : ''}</span></div>`;
        })
        .join('')}</div>
      <div class="prose">
        <h3>Cómo interpretarlo</h3>
        <p>Tu puntuación más probable es <strong>${T.iq}</strong> (${T.range.label.toLowerCase()}). Con el error de esta prueba, tu CI verdadero estaría entre <strong>${T.ciLow}</strong> y <strong>${T.ciHigh}</strong> con un 95 % de confianza. ${
          (entry.strengths || []).length
            ? 'Las fortalezas y debilidades señaladas se alejan de tu propia media más de lo que explicaría el error de medida.'
            : 'Ningún índice se aleja de tu media más de lo que explicaría el error de medida, así que tu perfil es homogéneo.'
        }</p>
        <p class="small muted">Es una estimación orientativa, no un diagnóstico. Para un CI con validez clínica hace falta una evaluación individual con un psicólogo, que usará pruebas baremadas como la WAIS-IV. Consulta «Ciencia» para ver los métodos y las limitaciones.</p>
      </div>
      <details class="panel"><summary><strong>Detalle por subprueba</strong></summary><div class="table-wrap" style="margin-top:12px"><table><tbody>${subLines}</tbody></table></div>
      <p class="small muted" style="margin-top:10px">En una prueba adaptativa el número de aciertos no es comparable entre personas: los ítems se ajustan a tu nivel, así que es normal acertar cerca de la mitad.</p></details>
      <div class="row"><button class="btn primary" type="button" data-go="ranges">Ver tabla de rangos</button><button class="btn" type="button" data-go="home">Volver al inicio</button></div>`;
    go('results');
  }

  function compatibleRanges(lo, hi) {
    const labels = irt.RANGES.filter((r) => !(r.max < lo || r.min > hi))
      .reverse()
      .map((r) => r.label);
    return labels.join(' · ');
  }

  function renderPracticeEnd(s, result) {
    const idx = Object.keys(result.indices)[0];
    const r = s.responses;
    const ok = r.filter((x) => x.correct).length;
    const sp = s.continuous[0];
    const line = sp
      ? `${sp.raw.correctN} aciertos y ${sp.raw.errorsN} errores en ${sp.raw.seconds} s.`
      : `${ok} de ${r.length} correctos${r.some((x) => x.length) ? ` · mayor longitud superada: ${Math.max(0, ...r.filter((x) => x.correct).map((x) => x.length))}` : ''}.`;
    stage().innerHTML = `<div class="intro"><h2>Práctica terminada</h2><p>${line}</p>
      ${idx ? `<p class="muted small">Nivel orientativo en esta tarea: <strong class="num">${result.indices[idx].iq}</strong> (IC ${result.indices[idx].ciLow}–${result.indices[idx].ciHigh}). Con tan pocos ítems el margen es amplio; no es tu CI.</p>` : ''}
      <div class="row"><button class="btn primary" type="button" id="again">Repetir</button><button class="btn" type="button" data-go="train">Otras tareas</button></div></div>`;
    $('#t-timer').firstElementChild.style.transform = 'scaleX(0)';
    $('#nav').hidden = false;
    $('#again').addEventListener('click', () => startPractice(s.plan[0]));
  }

  /* ---------- Entrenar ---------- */
  function renderTrain() {
    $('#train-grid').innerHTML = B.ORDER.map((id) => {
      const d = SUB[id];
      return `<button type="button" data-practice="${id}"><span class="code">${d.index} · ${B.INDEXES[d.index].chc}</span><strong>${d.title}</strong><span class="small muted">${d.intro.split('. ')[0]}.</span></button>`;
    }).join('');
    $$('[data-practice]').forEach((b) => b.addEventListener('click', () => startPractice(b.dataset.practice)));
  }
  function startPractice(id) {
    lastScreenBeforeTest = 'train';
    const n = SUB[id].n;
    const s = B.createSession({ mode: n.short ? 'short' : 'full', age: store.get('iq-age', 30), practice: true, only: id });
    startSession(s);
  }

  /* ---------- Rangos ---------- */
  function renderRanges() {
    const last = store.get('iq-history', [])[0];
    $('#ranges-bell').innerHTML = charts.bell(last ? { iq: last.total.iq, ciLow: last.total.ciLow, ciHigh: last.total.ciHigh, showRanges: true, label: 'Tu último resultado' } : { showRanges: true });
    const myKey = last && last.total.range.key;
    $('#ranges-table').innerHTML =
      '<thead><tr><th>CI</th><th>Categoría (WAIS-IV)</th><th>% de la población</th><th>Percentiles</th></tr></thead><tbody>' +
      irt.RANGES.map((r) => {
        const lo = r.min === 0 ? '≤ 69' : r.max === 200 ? '≥ 130' : `${r.min}–${r.max}`;
        const pLo = r.min === 0 ? 0 : irt.percentile(r.min - 0.5);
        const pHi = r.max === 200 ? 100 : irt.percentile(r.max + 0.5);
        return `<tr class="${r.key === myKey ? 'me' : ''}"><td class="num">${lo}</td><td>${r.label}${r.key === myKey ? ' <span class="small muted">· tu último resultado</span>' : ''}</td><td class="num">${fmt(irt.rangeShare(r), 1)} %</td><td class="num">${fmt(pLo, 1)}–${fmt(pHi, 1)}</td></tr>`;
      }).join('') +
      '</tbody>';
  }

  /* ---------- Historial ---------- */
  function renderHistory() {
    const hist = store.get('iq-history', []);
    const host = $('#history-list');
    if (!hist.length) {
      host.innerHTML = `<div class="panel stack"><p>Todavía no has completado ninguna evaluación en este dispositivo.</p><div><button class="btn primary" type="button" data-go="home">Hacer la prueba</button></div></div>`;
      return;
    }
    host.innerHTML =
      hist
        .map(
          (h, i) => `<div class="history-item"><span class="n num">${h.total.iq}</span><div><strong>${h.total.range.label}</strong> <span class="small muted">IC ${h.total.ciLow}–${h.total.ciHigh}</span><br><span class="small muted">${new Date(h.date).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })} · ${h.mode === 'full' ? 'completa' : 'breve'} · ${h.age} años${h.validity.ok ? '' : ' · con avisos'}</span></div><button class="btn" type="button" data-hist="${i}">Ver</button></div>`
        )
        .join('') +
      (hist.length > 1 ? `<p class="small muted" style="margin-top:12px">Las mejoras entre aplicaciones suelen deberse en parte al efecto de práctica, no a un aumento real de la capacidad.</p>` : '') +
      `<div class="confirm-row" style="margin-top:16px;justify-content:flex-start"><button class="btn ghost" type="button" id="clear-hist">Borrar historial</button></div>`;
    $$('[data-hist]', host).forEach((b) => b.addEventListener('click', () => renderResults(hist[+b.dataset.hist])));
    $('#clear-hist').addEventListener('click', (e) => {
      const b = e.currentTarget;
      if (b.dataset.armed) {
        store.set('iq-history', []);
        renderHistory();
      } else {
        b.dataset.armed = '1';
        b.textContent = 'Toca otra vez para borrar todo';
      }
    });
  }

  /* ---------- Torre de Hanói ---------- */
  const hanoi = { pegs: [[], [], []], sel: null, moves: 0, n: 4 };
  function hanoiReset() {
    hanoi.n = parseInt($('#hanoi-n').value, 10);
    hanoi.pegs = [Array.from({ length: hanoi.n }, (_, i) => hanoi.n - i), [], []];
    hanoi.sel = null;
    hanoi.moves = 0;
    $('#hanoi-msg').textContent = '';
    hanoiRender();
  }
  function hanoiRender() {
    const min = Math.pow(2, hanoi.n) - 1;
    $('#hanoi-info').textContent = `Movimientos: ${hanoi.moves} · mínimo posible: ${min}`;
    $('#hanoi').innerHTML = hanoi.pegs
      .map(
        (p, i) =>
          `<button type="button" class="peg${hanoi.sel === i ? ' sel' : ''}" data-peg="${i}" aria-label="Varilla ${i + 1}, ${p.length} discos">${p
            .map((d, j) => `<span class="disk${hanoi.sel === i && j === p.length - 1 ? ' top-sel' : ''}" style="width:${20 + (d / hanoi.n) * 75}%"></span>`)
            .join('')}</button>`
      )
      .join('');
  }
  $('#hanoi').addEventListener('click', (e) => {
    const b = e.target.closest('[data-peg]');
    if (!b) return;
    const i = +b.dataset.peg;
    const P = hanoi.pegs;
    if (hanoi.sel === null) {
      if (P[i].length) hanoi.sel = i;
    } else if (hanoi.sel === i) {
      hanoi.sel = null;
    } else {
      const d = P[hanoi.sel][P[hanoi.sel].length - 1];
      const top = P[i][P[i].length - 1];
      if (top === undefined || top > d) {
        P[i].push(P[hanoi.sel].pop());
        hanoi.moves++;
        $('#hanoi-msg').textContent = '';
      } else {
        $('#hanoi-msg').textContent = 'No se puede poner un disco grande sobre uno más pequeño.';
      }
      hanoi.sel = null;
    }
    hanoiRender();
    if (P[2].length === hanoi.n) {
      const min = Math.pow(2, hanoi.n) - 1;
      $('#hanoi-msg').textContent =
        hanoi.moves === min ? `¡Resuelto con el mínimo de ${min} movimientos!` : `Resuelto en ${hanoi.moves} movimientos. El mínimo es ${min}: ¿puedes lograrlo?`;
    }
  });
  $('#hanoi-reset').addEventListener('click', hanoiReset);
  $('#hanoi-n').addEventListener('change', hanoiReset);

  /* ---------- Arranque ---------- */
  $$('#nav button, .brand').forEach((b) =>
    b.addEventListener('click', () => {
      lastScreenBeforeTest = b.dataset.go === 'train' ? 'train' : 'home';
    })
  );
  renderHome();
  renderTrain();
  hanoiReset();
  const initial = (location.hash || '').slice(1);
  go(['train', 'ranges', 'science', 'history'].includes(initial) ? initial : 'home');

  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    try {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    } catch (e) {
      /* entorno sin service workers */
    }
  }
})();
