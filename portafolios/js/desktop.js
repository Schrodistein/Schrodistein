/* Integración con la app de escritorio (Electron). En el navegador no hace nada:
 * solo se activa si el proceso principal expuso window.bvc (ver escritorio/preload.js). */
(function () {
  'use strict';
  const api = globalThis.bvc;
  if (!api) return;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const nf = (d) => new Intl.NumberFormat('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
  const fmtPrice = (x) => (x >= 1000 ? nf(0).format(x) : nf(2).format(x));
  const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : 'nunca');
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
  const SRC = { bvc: 'BVC', yahoo: 'automática' };

  let summary = null;
  let news = [];
  let fromDesktop = false; // el análisis usa los datos guardados de la app

  function prefs() {
    try {
      return JSON.parse(localStorage.getItem('pf.desktop') || '{}');
    } catch (e) {
      return {};
    }
  }
  function setPref(k, v) {
    try {
      const p = prefs();
      p[k] = v;
      localStorage.setItem('pf.desktop', JSON.stringify(p));
    } catch (e) {
      /* sin almacenamiento */
    }
  }

  function status(msg, kind) {
    const el = $('mk-status');
    el.hidden = !msg;
    el.className = 'status' + (kind ? ' ' + kind : '');
    el.textContent = msg || '';
  }

  /* ---------- Mercado ---------- */
  function renderMarket() {
    if (!summary) return;
    const s = summary.settings;
    const m = summary.meta;
    $('mk-meta').textContent = `Última actualización de cierres: ${fmtDateTime(m.lastPrices)} · de noticias: ${fmtDateTime(m.lastNews)}${s.auto ? ` · la próxima, en unas ${s.intervalHours >= 48 ? Math.round(s.intervalHours / 24) + ' días' : s.intervalHours + ' h'}` : ' · actualización automática apagada'}.`;
    const rows = summary.assets
      .map((a, i) => {
        const ch = a.price && a.prev ? a.price / a.prev - 1 : null;
        return `<tr data-i="${i}">
          <td><strong>${esc(a.name)}</strong>${a.index ? ' <span class="src">índice</span>' : ''}${a.error ? `<span class="err-line">${esc(a.error)}</span>` : ''}</td>
          <td class="n">${a.price != null ? fmtPrice(a.price) : '—'}</td>
          <td>${a.last ? esc(a.last) : '—'}</td>
          <td class="n ${ch == null ? '' : ch >= 0 ? 'pos' : 'neg'}">${ch == null ? '—' : (ch >= 0 ? '+' : '') + nf(2).format(ch * 100) + ' %'}</td>
          <td class="n">${a.count}${a.first ? `<span class="sub">desde ${esc(a.first)}</span>` : ''}</td>
          <td>${a.source ? `<span class="src ${a.source}">${SRC[a.source] || esc(a.source)}</span>` : '—'}</td>
          <td><input class="cell" data-f="yahoo" value="${esc(a.yahoo)}" aria-label="Símbolo automático de ${esc(a.name)}" placeholder="sin fuente automática"></td>
          <td><input class="cell" data-f="news" value="${esc(a.news)}" aria-label="Búsqueda de noticias de ${esc(a.name)}"></td>
          <td><label class="check"><input type="checkbox" data-f="enabled" ${a.enabled ? 'checked' : ''} aria-label="Usar ${esc(a.name)}"> usar</label></td>
          <td><label class="check"><input type="checkbox" data-f="index" ${a.index ? 'checked' : ''} aria-label="${esc(a.name)} es un índice"> índice</label></td>
          <td><button type="button" class="btn btn-ghost" data-del="${i}" aria-label="Quitar ${esc(a.name)}">Quitar</button></td>
        </tr>`;
      })
      .join('');
    $('mk-table').innerHTML = `<thead><tr><th>Activo</th><th class="n">Último cierre</th><th>Fecha</th><th class="n">Variación</th><th class="n">Días</th><th>Fuente</th><th>Símbolo automático</th><th>Búsqueda de noticias</th><th></th><th></th><th></th></tr></thead><tbody>${rows}</tbody>`;
    $('set-auto').checked = s.auto;
    $('set-interval').value = String(s.intervalHours);
    $('set-yahoo').checked = s.yahoo;
    $('set-news').checked = s.news;
    $('set-notify').checked = s.notify;
    $('set-background').checked = s.background;
    $('set-login').checked = s.openAtLogin;
    $('set-reload').checked = prefs().reload !== false;
  }

  function assetsFromTable() {
    return summary.assets.map((a, i) => {
      const tr = $('mk-table').querySelector(`tr[data-i="${i}"]`);
      const get = (f) => tr && tr.querySelector(`[data-f="${f}"]`);
      return {
        name: a.name,
        yahoo: get('yahoo') ? get('yahoo').value : a.yahoo,
        news: get('news') ? get('news').value : a.news,
        enabled: get('enabled') ? get('enabled').checked : a.enabled,
        index: get('index') ? get('index').checked : a.index,
      };
    });
  }

  async function saveAssets(list) {
    summary = await api.guardarActivos(list);
    renderMarket();
  }

  /* ---------- Noticias ---------- */
  function renderNews() {
    const sel = $('nw-asset');
    const cur = sel.value;
    const names = [...new Set(news.map((n) => n.asset))].sort();
    sel.innerHTML = '<option value="">Todos</option>' + names.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
    sel.value = names.includes(cur) ? cur : '';
    const q = $('nw-q').value.trim().toLowerCase();
    const list = news.filter((n) => (!sel.value || n.asset === sel.value) && (!q || n.title.toLowerCase().includes(q)));
    $('nw-meta').textContent = news.length
      ? `${list.length} de ${news.length} noticias${summary && summary.meta.lastNews ? ` · actualizadas el ${fmtDateTime(summary.meta.lastNews)}` : ''}`
      : 'Todavía no hay noticias. Pulsa «Actualizar ahora» en Mercado.';
    $('nw-list').innerHTML = list
      .slice(0, 300)
      .map((n) => `<li><a data-url="${esc(n.link)}" tabindex="0" role="link">${esc(n.title)}</a><span class="nm"><span class="chip">${esc(n.asset)}</span>${n.source ? `<span>${esc(n.source)}</span>` : ''}${n.date ? `<span>${esc(fmtDate(n.date))}</span>` : ''}</span></li>`)
      .join('');
  }

  /* ---------- Datos → análisis ---------- */
  /* El análisis usa solo los datos cargados de la BVC (descargas e importaciones),
   * salvo que se elija incluir la fuente automática o que aún no haya descargas. */
  async function useInAnalysis(silent) {
    const want = $('mk-source').value === 'todos' ? 'todos' : 'cargados';
    let series = await api.series(want);
    let note = want === 'cargados' ? 'con los datos cargados de la BVC' : 'con los datos cargados y los de la fuente automática';
    if (series.length < 2 && want === 'cargados') {
      const all = await api.series('todos');
      if (all.length >= 2) {
        series = all;
        note = 'con los datos de la fuente automática, porque aún no hay suficientes descargas de la BVC';
      }
    }
    if (series.length < 2) {
      if (!silent) status('Faltan datos: se necesitan al menos dos activos con cierres. Abre la BVC, importa archivos o actualiza.', 'bad');
      return false;
    }
    const ok = globalThis.PFApp && (await globalThis.PFApp.loadSeries(series, note));
    fromDesktop = !!ok;
    if (ok && !silent) status(`El análisis usa ahora ${series.length} series ${note}: ${series.map((x) => x.name).join(', ')}.`, 'ok');
    return ok;
  }

  async function refreshAll(payload) {
    summary = (payload && payload.summary) || (await api.resumen());
    news = await api.noticias();
    renderMarket();
    renderNews();
    if (payload && payload.result) {
      const r = payload.result;
      const errs = r.prices.errors.length + r.news.errors.length;
      status(
        `Actualizado: ${r.prices.updated.length} activos con cierres nuevos${r.prices.newest ? ` (último del ${r.prices.newest})` : ''}, ${r.news.fresh} noticias nuevas.${errs ? ` ${errs} consultas fallaron; revisa los avisos en rojo de la tabla.` : ''}`,
        errs ? 'warn' : 'ok'
      );
    }
    if (payload && payload.imported) {
      const names = Object.keys(payload.imported.assets);
      status(
        names.length
          ? `Importado de la BVC: ${names.map((n) => `${n} (${payload.imported.assets[n]} días)`).join(', ')}.${payload.imported.errors.length ? ' No se pudieron leer: ' + payload.imported.errors.join('; ') : ''}`
          : `No se importó nada. ${payload.imported.errors.join('; ')}`,
        names.length ? 'ok' : 'bad'
      );
    }
    if (payload && payload.result) await loadMacro();
    // Cada actualización agrega a la biblioteca local los historiales descargados
    if (payload && payload.result && globalThis.PFApp && globalThis.PFApp.saveToLibrary) await globalThis.PFApp.saveToLibrary(await api.series('todos'));
    if (payload && (payload.result || payload.imported)) setTimeout(() => saveLibrary(true), 1500);
    if (payload && (payload.result || payload.imported) && fromDesktop && prefs().reload !== false) {
      const before = lastRecommended();
      if (await useInAnalysis(true)) await announceRecommendation(before, payload);
    }
  }

  /* Con datos nuevos se recalcula el portafolio recomendado; si cambió, se avisa. */
  function lastRecommended() {
    try {
      return JSON.parse(localStorage.getItem('pf.lastRec') || 'null');
    } catch (e) {
      return null;
    }
  }
  async function announceRecommendation(before, payload) {
    const r = globalThis.PFApp && globalThis.PFApp.recommended();
    if (!r) return;
    try {
      localStorage.setItem('pf.lastRec', JSON.stringify(r));
    } catch (e) {
      /* sin almacenamiento */
    }
    const fresh = payload.result ? payload.result.prices.updated.length : Object.keys(payload.imported.assets).length;
    if (!fresh) return;
    const w = (x, n) => {
      const i = x.names.indexOf(n);
      return i >= 0 ? x.w[i] : 0;
    };
    const moved = before ? Math.max(...[...new Set(before.names.concat(r.names))].map((n) => Math.abs(w(r, n) - w(before, n)))) : 1;
    const top = r.names.map((n, i) => [n, r.w[i]]).filter((x) => x[1] > 0.005).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n, x]) => `${n} ${Math.round(x * 100)} %`).join(', ');
    const msg = `${before && moved < 0.02 ? 'El portafolio recomendado casi no cambió' : 'Nuevo portafolio recomendado'}: ${top}. Rendimiento esperado ${(r.ret * 100).toFixed(1).replace('.', ',')} %.`;
    status(`Datos nuevos de ${fresh} ${fresh === 1 ? 'activo' : 'activos'}. ${msg} Revisa Comprar para el plan con tu presupuesto.`, 'ok');
    // Sin alarma de escritorio por cambios del portafolio: el aviso queda en Mercado
  }

  /* Variables macro y biblioteca local */
  async function loadMacro() {
    if (!api.macro) return;
    try {
      const d = await api.macro();
      if (globalThis.PFApp && globalThis.PFApp.setMacro) globalThis.PFApp.setMacro(d);
    } catch (e) {
      /* sin datos macro */
    }
  }
  async function saveLibrary(silent) {
    if (!api.guardarBiblioteca || !globalThis.PFApp || !globalThis.PFApp.documents) return null;
    try {
      const r = await api.guardarBiblioteca(globalThis.PFApp.documents());
      if (!silent && r) status(r.error ? 'No se pudo guardar la biblioteca: ' + r.error : `Biblioteca guardada en ${r.dir}: ${r.assets} activos, ${r.vars} variables macro y ${r.docs} documentos.`, r.error ? 'bad' : 'ok');
      return r;
    } catch (e) {
      if (!silent) status('No se pudo guardar la biblioteca: ' + e.message, 'bad');
      return null;
    }
  }

  function init() {
    document.querySelectorAll('.desktop-only').forEach((el) => (el.hidden = false));
    api.alActualizar(refreshAll);
    loadMacro();
    setTimeout(() => saveLibrary(true), 6000);
    $('mk-lib-open').addEventListener('click', async () => {
      await saveLibrary(true);
      const r = await api.abrirBiblioteca();
      status(`Biblioteca local: ${r.dir}`, 'ok');
    });
    $('mk-lib-save').addEventListener('click', () => saveLibrary(false));
    $('macro-update').addEventListener('click', async () => {
      const el = $('macro-status');
      const say = (t, k) => {
        el.hidden = false;
        el.className = 'status ' + (k || '');
        el.textContent = t;
      };
      say('Descargando PIB, inflación, desempleo y TRM…');
      $('macro-update').disabled = true;
      try {
        const r = await api.actualizarMacro();
        if (globalThis.PFApp) globalThis.PFApp.setMacro(r.data);
        const V = globalThis.PF.macro.VARS;
        const got = Object.keys(r.data || {}).map((k) => `${V[k] ? V[k].label : k} (${r.data[k].source})`);
        say(`${got.length ? 'Descargadas: ' + got.join('; ') + '.' : 'No se descargó ninguna variable.'}${r.result.errors.length ? ' Fallaron: ' + r.result.errors.join(' · ') : ''}`, r.result.errors.length ? 'warn' : 'ok');
        saveLibrary(true);
      } catch (e) {
        say('No se pudo actualizar: ' + e.message, 'bad');
      } finally {
        $('macro-update').disabled = false;
      }
    });

    $('mk-update').addEventListener('click', async () => {
      status('Actualizando cierres y noticias…');
      $('mk-update').disabled = true;
      try {
        await api.actualizar();
      } catch (e) {
        status('No se pudo actualizar: ' + e.message, 'bad');
      } finally {
        $('mk-update').disabled = false;
      }
    });
    $('mk-bvc').addEventListener('click', () => {
      api.abrirBVC();
      status('Se abrió la BVC en otra ventana. Busca cada acción, descarga su histórico y la app lo importa sola al terminar la descarga.');
    });
    $('mk-import').addEventListener('click', async () => {
      const r = await api.importar();
      if (r === null) status('');
    });
    $('mk-source').value = prefs().source === 'todos' ? 'todos' : 'cargados';
    $('mk-source').addEventListener('change', () => {
      setPref('source', $('mk-source').value);
      if (fromDesktop) useInAnalysis(false);
    });
    $('mk-export').addEventListener('click', async () => {
      try {
        const r = await api.exportarDatos();
        if (r) status(`Datos exportados a ${r.file}. Copia ese archivo al otro equipo y usa «Importar datos de otro equipo».`, 'ok');
      } catch (e) {
        status('No se pudieron exportar los datos: ' + e.message, 'bad');
      }
    });
    $('mk-restore').addEventListener('click', async () => {
      try {
        const r = await api.importarRespaldo();
        if (r) status(`Datos importados: ${r.assets} activos nuevos, ${r.points} cierres y ${r.news} noticias.`, 'ok');
      } catch (e) {
        status('No se pudieron importar los datos: ' + String(e.message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'bad');
      }
    });
    $('mk-use').addEventListener('click', async () => {
      if (await useInAnalysis(false)) globalThis.PFApp.go('frontera');
    });
    $('mk-table').addEventListener('change', () => saveAssets(assetsFromTable()));
    $('mk-table').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-del]');
      if (!b) return;
      const list = assetsFromTable();
      list.splice(+b.getAttribute('data-del'), 1);
      saveAssets(list);
    });
    $('mk-add').addEventListener('click', () => {
      const name = $('mk-new-name').value.trim().toUpperCase();
      if (!name) return status('Escribe el nemotécnico del activo.', 'bad');
      if (summary.assets.some((a) => a.name === name)) return status(`${name} ya está en la lista.`, 'bad');
      const list = assetsFromTable();
      list.push({ name, yahoo: $('mk-new-yahoo').value.trim() || name + '.CL', news: $('mk-new-news').value.trim() || name + ' acción', enabled: true, index: /colcap|indice|índice/i.test(name) });
      $('mk-new-name').value = '';
      $('mk-new-yahoo').value = '';
      $('mk-new-news').value = '';
      saveAssets(list).then(() => status(`${name} agregado. Pulsa «Actualizar ahora» para traer sus datos.`, 'ok'));
    });
    const saveSettings = () =>
      api
        .guardarAjustes({
          auto: $('set-auto').checked,
          intervalHours: +$('set-interval').value,
          yahoo: $('set-yahoo').checked,
          news: $('set-news').checked,
          notify: $('set-notify').checked,
          background: $('set-background').checked,
          openAtLogin: $('set-login').checked,
        })
        .then((s) => {
          summary = s;
          renderMarket();
        });
    for (const id of ['set-auto', 'set-interval', 'set-yahoo', 'set-news', 'set-notify', 'set-background', 'set-login']) $(id).addEventListener('change', saveSettings);
    $('set-reload').addEventListener('change', () => setPref('reload', $('set-reload').checked));

    $('nw-asset').addEventListener('change', renderNews);
    $('nw-q').addEventListener('input', renderNews);
    const openNews = (ev) => {
      const a = ev.target.closest('[data-url]');
      if (!a) return;
      ev.preventDefault();
      api.abrirEnlace(a.getAttribute('data-url'));
    };
    $('nw-list').addEventListener('click', openNews);
    $('nw-list').addEventListener('keydown', (ev) => ev.key === 'Enter' && openNews(ev));

    refreshAll(null).then(() => {
      // Al abrir: si ya hay datos guardados, el análisis parte de ellos.
      if (summary.assets.filter((a) => a.enabled && a.count >= 3).length >= 2) useInAnalysis(true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
