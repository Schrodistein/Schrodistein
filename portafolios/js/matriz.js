/* Matriz de precios como la hoja «M. PRECIOS» de un ejercicio de portafolio en Excel:
 *   ITEM | FECHA | índice de mercado | acción 1 | acción 2 | …   (fecha más reciente arriba)
 * Las fechas son las ruedas de la BVC (días en que se negoció al menos uno de los activos), desde la
 * primera cotización hasta la última. No se agregan fines de semana ni festivos: los rendimientos
 * diarios se anualizan con 242 ruedas al año, y días inventados con rendimiento cero romperían esa
 * base. Si un activo no se negoció en una rueda, lleva su último precio cotizado hasta la siguiente
 * operación (así la matriz queda cuadrada). Antes de la primera cotización de cada activo la celda queda vacía. Los precios
 * guardados no se modifican: solo se completan los días que faltan. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const fin = Number.isFinite;
  const DAY = 864e5;
  const iso = (t) => new Date(t).toISOString().slice(0, 10);

  /* series: [{ name, dates (yyyy-mm-dd), prices }]; opts.calendar: 'ruedas' (predeterminado) o 'habiles' (lunes a viernes);
   * opts.market: nombre del índice que va en la primera columna; opts.cut: fecha de corte; opts.from: fecha de inicio. */
  function build(series, opts) {
    const o = Object.assign({ calendar: 'ruedas' }, opts);
    const list = series.filter((s) => s && s.dates && s.dates.length && s.kind !== 'tasa');
    if (!list.length) return { dates: [], names: [], values: [], filled: [] };
    const m = o.market && list.find((s) => s.name === o.market);
    const ordered = (m ? [m] : []).concat(list.filter((s) => s !== m));
    const maps = ordered.map((s) => {
      const mp = new Map();
      s.dates.forEach((d, i) => fin(s.prices[i]) && (!o.cut || d <= o.cut) && (!o.from || d >= o.from) && mp.set(d.slice(0, 10), s.prices[i]));
      return mp;
    });
    const all = maps.flatMap((mp) => [...mp.keys()]).sort();
    if (!all.length) return { dates: [], names: [], values: [], filled: [] };
    let dates;
    if (o.calendar === 'habiles') {
      // Lunes a viernes (incluye festivos, con el último precio)
      dates = [];
      for (let t = Date.parse(all[0]), t1 = Date.parse(all[all.length - 1]); t <= t1; t += DAY) {
        const wd = new Date(t).getUTCDay();
        if (wd !== 0 && wd !== 6) dates.push(iso(t));
      }
    } else {
      // Ruedas de la BVC: los días en que se negoció al menos uno de los activos (sin fines de semana
      // ni festivos). Es la base de 242 ruedas al año con que se anualizan los rendimientos.
      // La TRM rige también sábados y domingos: esas fechas no son ruedas y no entran (el precio del
      // sábado pasa al lunes como último precio). Si hay activos de la BVC, mandan sus fechas.
      const wd = (d) => new Date(d + 'T00:00:00Z').getUTCDay() % 6 !== 0;
      const bvc = maps.filter((mp, j) => !/(^|\W)(trm|usd|eur|cop)(\W|$)|d[oó]lar/i.test(ordered[j].name) && ordered[j].kind !== 'divisa' && ordered[j].cls !== 'divisa');
      const base = (bvc.length ? bvc : maps).flatMap((mp) => [...mp.keys()]);
      dates = [...new Set(base)].filter(wd).sort();
      // Como en el análisis (PF.data.mergeSeries): con cinco o más activos, una fecha cuenta como rueda si la
      // cotizan al menos dos, y se quitan los festivos (fechas sueltas en que casi ningún precio cambió:
      // p. ej. un activo con la fecha corrida un día cae en un lunes festivo o en un domingo).
      const src = bvc.length ? bvc : maps;
      if (src.length >= 5) dates = dates.filter((d) => src.filter((mp) => mp.has(d)).length >= 2);
      if (src.length >= 4) {
        const keep = [];
        for (const d of dates) {
          const prev = keep[keep.length - 1];
          const both = prev ? src.filter((mp) => mp.has(d) && mp.has(prev)) : [];
          if (prev && both.length >= 4 && both.filter((mp) => mp.get(d) !== mp.get(prev)).length <= 1) continue;
          keep.push(d);
        }
        dates = keep;
      }
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
