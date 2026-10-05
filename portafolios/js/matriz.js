/* Matriz de precios como la hoja «M. PRECIOS» de un ejercicio de portafolio en Excel:
 *   ITEM | FECHA | índice de mercado | acción 1 | acción 2 | …   (fecha más reciente arriba)
 * Las fechas son todos los días hábiles (lunes a viernes) o todos los días calendario, desde la
 * primera cotización hasta la última. Un día sin negociación (festivo, fin de semana o un activo
 * que no se negoció) lleva el último precio cotizado, que se mantiene hasta la siguiente
 * operación. Antes de la primera cotización de cada activo la celda queda vacía. Los precios
 * guardados no se modifican: solo se completan los días que faltan. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const fin = Number.isFinite;
  const DAY = 864e5;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);

  /* series: [{ name, dates (yyyy-mm-dd), prices }]; opts.calendar: 'habiles' (lunes a viernes) o 'calendario';
   * opts.market: nombre del índice que va en la primera columna; opts.cut: fecha de corte. */
  function build(series, opts) {
    const o = Object.assign({ calendar: 'habiles' }, opts);
    const list = series.filter((s) => s && s.dates && s.dates.length && s.kind !== 'tasa');
    if (!list.length) return { dates: [], names: [], values: [], filled: [] };
    const m = o.market && list.find((s) => s.name === o.market);
    const ordered = (m ? [m] : []).concat(list.filter((s) => s !== m));
    const maps = ordered.map((s) => {
      const mp = new Map();
      s.dates.forEach((d, i) => fin(s.prices[i]) && (!o.cut || d <= o.cut) && mp.set(d.slice(0, 10), s.prices[i]));
      return mp;
    });
    const all = maps.flatMap((mp) => [...mp.keys()]).sort();
    if (!all.length) return { dates: [], names: [], values: [], filled: [] };
    const t0 = Date.parse(all[0]);
    const t1 = Date.parse(all[all.length - 1]);
    const dates = [];
    for (let t = t0; t <= t1; t += DAY) {
      const wd = new Date(t).getUTCDay();
      if (o.calendar !== 'calendario' && (wd === 0 || wd === 6)) continue;
      dates.push(iso(t));
    }
    // Precio de cada fecha: el cotizado ese día o, si no hubo operación, el último anterior
    const values = [];
    const filled = [];
    maps.forEach((mp) => {
      let last = NaN;
      const col = [];
      const fl = [];
      // Fechas cotizadas que caen en fin de semana (raro): cuentan como último precio para el lunes
      const keys = [...mp.keys()].sort();
      let k = 0;
      for (const d of dates) {
        let exact = false;
        while (k < keys.length && keys[k] <= d) {
          last = mp.get(keys[k]);
          exact = keys[k] === d;
          k++;
        }
        col.push(last);
        fl.push(fin(last) && !exact);
      }
      values.push(col);
      filled.push(fl);
    });
    return { dates, names: ordered.map((s) => s.name), values, filled, market: m ? m.name : null };
  }

  /* Número de serie de Excel (días desde 1899-12-30). */
  const serial = (d) => Date.parse(d) / DAY + 25569;

  /* Hoja con el mismo diseño de «M. PRECIOS»: fila 1 con ITEM, FECHA, el índice y el título de
   * los precios; fila 2 con el nombre de cada acción; datos de la fecha más reciente a la más antigua. */
  function sheet(mx, title) {
    const k0 = mx.market ? 1 : 0;
    const head1 = [{ v: 'ITEM', s: 'h' }, { v: 'FECHA', s: 'h' }];
    const head2 = [null, null];
    mx.names.forEach((n, j) => {
      if (j < k0) {
        head1.push({ v: n, s: 'h' });
        head2.push(null);
      } else {
        head1.push(j === k0 ? { v: title || 'PRECIO DE CIERRE', s: 'h' } : null);
        head2.push({ v: n, s: 'h' });
      }
    });
    const rows = [head1, head2];
    for (let i = mx.dates.length - 1, item = 1; i >= 0; i--, item++) {
      rows.push([item, { v: serial(mx.dates[i]), s: 'date' }].concat(mx.values.map((c) => (fin(c[i]) ? { v: c[i], s: 'px' } : null))));
    }
    return { name: 'M. PRECIOS', rows, cols: [7, 12].concat(mx.names.map(() => 14)), freeze: { row: 2, col: 2 } };
  }

  /* Libro de Excel (.xlsx) listo para descargar. */
  function workbook(series, opts) {
    const mx = build(series, opts);
    return { mx, bytes: mx.dates.length ? PF.xlsx.build([sheet(mx, opts && opts.title)]) : null };
  }

  PF.matriz = { build, sheet, workbook, serial };
})(typeof globalThis !== 'undefined' ? globalThis : this);
