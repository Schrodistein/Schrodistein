/* «Sistema financiero»: relación entre el sistema económico y el sistema financiero de
 * Colombia. Sigue el esquema clásico (sistema financiero → mercado monetario, de
 * capitales —bancario y de valores: bursátil y extrabursátil—, de divisas y otros), con
 * las instituciones colombianas de cada rama, y lo enlaza con los datos de la app. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const fin = Number.isFinite;

  // Árbol del sistema financiero: [id, título, detalle, padre, segmentos de la app que viven ahí]
  const NODES = [
    ['sf', 'Sistema financiero', 'Canaliza el ahorro hacia la inversión', null, []],
    ['mon', 'Mercado monetario', 'Corto plazo (menos de un año)', 'sf', ['cdt']],
    ['cap', 'Mercado de capitales', 'Mediano y largo plazo', 'sf', []],
    ['div', 'Mercado de divisas', 'Compra y venta de moneda extranjera', 'sf', ['divisa']],
    ['otr', 'Otros mercados', 'Seguros, derivados, productos básicos, financiación colaborativa', 'sf', ['futuro', 'opcion']],
    ['ban', 'Mercado bancario', 'Intermediado: captar y prestar', 'cap', []],
    ['val', 'Mercado de valores', 'Directo: el ahorro llega a quien emite', 'cap', []],
    ['bco', 'Bancos', 'Establecimientos bancarios', 'ban', ['cdt']],
    ['oin', 'Otros intermediarios', 'Corporaciones, cooperativas, redescuento', 'ban', []],
    ['bur', 'Mercado bursátil', 'Bolsa de Valores de Colombia (BVC)', 'val', ['accion', 'etf', 'tes', 'bono', 'futuro']],
    ['ext', 'Mercado extrabursátil', 'Mostrador (OTC): MEC, SEN, contratos a la medida', 'val', ['tes', 'bono']],
  ];

  const DETAIL = {
    mon: {
      who: 'Banco de la República (fija la tasa de política monetaria y presta liquidez a los bancos con operaciones repo), mercado interbancario, IBR (tasa de referencia del mercado monetario), TES de corto plazo, CDT a menos de un año y fondos de inversión colectiva de liquidez.',
      app: 'En la app: los CDT y la renta fija segura del plan; el índice COLIBR mide este mercado.',
    },
    ban: {
      who: 'Captan ahorro del público (cuentas, CDT) y lo prestan a hogares y empresas. Es intermediación indirecta: el ahorrador le presta al banco, no a la empresa. Los regula el Estatuto Orgánico del Sistema Financiero (Decreto 663 de 1993) y los vigila la Superintendencia Financiera.',
      app: 'En la app: los CDT y la tasa de la renta fija segura.',
    },
    bco: { who: 'Bancos comerciales: Bancolombia (Grupo Cibest), Banco de Bogotá, Davivienda, BBVA y otros. Sus depósitos están asegurados por Fogafín hasta el tope vigente.', app: 'En la app: CIBEST y PFCIBEST (Grupo Cibest) cotizan en la BVC.' },
    oin: { who: 'Corporaciones financieras, compañías de financiamiento y cooperativas financieras, que también son establecimientos de crédito, más las entidades de redescuento del Estado (Bancóldex, Findeter, Finagro). Las fiduciarias y las administradoras de fondos de pensiones invierten el ahorro de terceros, sobre todo en el mercado de valores.', app: '' },
    val: {
      who: 'Las empresas y el Estado emiten acciones, bonos y TES y los compran directamente los inversionistas. Es desintermediado: el ahorro llega a quien lo usa. Lo regula la Ley 964 de 2005 y lo vigilan la Superintendencia Financiera y el Autorregulador del Mercado de Valores (AMV). Los títulos se custodian en Deceval y las operaciones se compensan en la Cámara de Riesgo Central de Contraparte (CRCC).',
      app: 'En la app: toda la teoría de portafolios (Markowitz, Sharpe, Treynor, Jensen) se aplica aquí.',
    },
    bur: { who: 'Se negocia en la Bolsa de Valores de Colombia, a través de sociedades comisionistas de bolsa: acciones, ETF (como ICOLCAP), bonos, TES y derivados estandarizados. Su termómetro es el índice MSCI COLCAP.', app: 'En la app: las acciones de la BVC, el COLCAP como índice de mercado, los TES y los futuros.' },
    ext: { who: 'Mercado mostrador (OTC): se negocia directamente entre entidades, por fuera de la rueda de la bolsa. Incluye el MEC (Mercado Electrónico Colombiano), el SEN del Banco de la República para TES entre creadores de mercado, y los forwards y swaps a la medida.', app: 'En la app: la renta fija (TES y bonos) se negocia sobre todo aquí.' },
    div: {
      who: 'Mercado cambiario: bancos y otros intermediarios del mercado cambiario, casas de cambio y el sistema SET-FX. La TRM es el promedio de las operaciones del día, que certifica la Superintendencia Financiera. El Banco de la República maneja las reservas internacionales; el régimen cambiario es de libre flotación (Ley 9 de 1991).',
      app: 'En la app: el segmento de divisas, la TRM como variable macro y el dólar (USD/COP).',
    },
    otr: { who: 'Seguros (compañías de seguros), derivados estandarizados de la BVC compensados en la CRCC, la Bolsa Mercantil de Colombia (productos agropecuarios y energéticos) y la financiación colaborativa (por ejemplo a2censo, de la BVC).', app: 'En la app: el segmento de derivados (futuros y opciones).' },
  };

  /* Diagrama SVG del árbol (como el esquema de clase), con los nodos donde hay activos resaltados */
  function diagram(active) {
    const W = 1060;
    const H = 470;
    const pos = {
      sf: [530, 40],
      mon: [110, 150],
      cap: [400, 150],
      div: [690, 150],
      otr: [950, 150],
      ban: [230, 270],
      val: [720, 270],
      bco: [110, 390],
      oin: [340, 390],
      bur: [610, 390],
      ext: [850, 390],
    };
    const bw = 196;
    const bh = 62;
    let s = `<svg viewBox="0 0 ${W} ${H}" class="sf-diagram" role="img" aria-label="Esquema del sistema financiero colombiano">`;
    for (const [id, , , parent] of NODES) {
      if (!parent) continue;
      const [x1, y1] = pos[parent];
      const [x2, y2] = pos[id];
      const ym = (y1 + bh / 2 + y2 - bh / 2) / 2;
      s += `<path d="M${x1},${y1 + bh / 2} V${ym} H${x2} V${y2 - bh / 2 - 6}" fill="none" stroke="var(--ink-3)" stroke-width="1.4" marker-end="url(#sf-arrow)"/>`;
    }
    s += '<defs><marker id="sf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-3)"/></marker></defs>';
    for (const [id, title, sub] of NODES) {
      const [x, y] = pos[id];
      const on = active.has(id);
      const words = sub.split(' ');
      const lines = [];
      let cur = '';
      for (const w of words) {
        if ((cur + ' ' + w).trim().length > 30) {
          lines.push(cur.trim());
          cur = w;
        } else cur += ' ' + w;
      }
      lines.push(cur.trim());
      s += `<g class="sf-node${on ? ' on' : ''}${id === 'sf' ? ' root' : ''}" data-node="${id}"><rect x="${x - bw / 2}" y="${y - bh / 2}" width="${bw}" height="${bh}" rx="8"/>
        <text x="${x}" y="${y - bh / 2 + 18}" text-anchor="middle" class="sf-t">${title}</text>
        ${lines.slice(0, 2).map((l, i) => `<text x="${x}" y="${y - bh / 2 + 34 + i * 13}" text-anchor="middle" class="sf-s">${l}</text>`).join('')}</g>`;
    }
    s += `<text x="20" y="${H - 8}" class="sf-s">Flechas: el ahorro baja del sistema a cada mercado. En verde, las partes donde están los activos que cargaste.</text></svg>`;
    return s;
  }

  /* ctx: { macro: datos macro, results: relaciones con el índice, classes: tipos de los activos cargados, marketName, esc, pct } */
  function render(ctx) {
    const esc = ctx.esc;
    const classes = new Set(ctx.classes || []);
    const active = new Set(NODES.filter((n) => n[4].some((c) => classes.has(c))).map((n) => n[0]));
    if ([...active].some((id) => ['bur', 'ext'].includes(id))) active.add('val').add('cap');
    if ([...active].some((id) => ['bco', 'oin'].includes(id))) active.add('ban').add('cap');
    if (active.size) active.add('sf');
    const nf = (x, d = 1) => (fin(x) ? x.toFixed(d).replace('.', ',') : '—');
    const last = (k) => {
      const d = ctx.macro && ctx.macro[k];
      return d && d.values && d.values.length ? { v: d.values[d.values.length - 1], t: d.dates[d.dates.length - 1] } : null;
    };
    const L = { pib: last('pib'), inflacion: last('inflacion'), desempleo: last('desempleo'), trm: last('trm') };
    const R = ctx.results || {};
    const rel = (k) => (R[k] && R[k].ok ? ` Con tus datos, la correlación del rendimiento de ${esc(ctx.marketName || 'el índice')} con su cambio es ${nf(R[k].corr, 2)} (n = ${R[k].n}).` : '');
    const val = (k, unit) => (L[k] ? `<b>${k === 'trm' ? Math.round(L[k].v).toLocaleString('es-CO') : nf(L[k].v)}${unit}</b> (${esc(L[k].t)})` : '<span class="sub">sin dato: actualízalo en Macro</span>');

    const out = [];
    out.push(`<div class="panel"><h2>1. El sistema económico</h2>
      <p>La economía colombiana tiene cuatro grupos de agentes: <b>hogares</b>, que trabajan, consumen y ahorran; <b>empresas</b>, que producen e invierten; el <b>Estado</b>, que recauda, gasta y se endeuda; y el <b>sector externo</b>, que exporta, importa y trae o saca capitales. En el flujo circular de la renta, los hogares venden su trabajo a las empresas y gastan su ingreso en bienes. Lo que no consumen es <b>ahorro</b>, y las empresas y el Estado necesitan <b>inversión</b> y financiación por encima de lo que generan.</p>
      <p class="formula"><code>Y = C + I + G + (X − M)</code>  y, en una economía abierta,  <code>S<sub>privado</sub> + (T − G) = I + (X − M)</code></p>
      <ul class="sym"><li><code>Y</code>: producto interno bruto (PIB). <code>C</code>: consumo de los hogares. <code>I</code>: inversión de las empresas. <code>G</code>: gasto público. <code>X − M</code>: exportaciones menos importaciones.</li><li><code>S</code>: ahorro privado. <code>T − G</code>: ahorro del Estado (negativo cuando hay déficit fiscal). Si el ahorro interno no alcanza para la inversión, la diferencia la pone el ahorro externo, que se ve como déficit de cuenta corriente.</li></ul>
      <p>Hay agentes <b>superavitarios</b>, que ahorran más de lo que invierten (sobre todo los hogares), y agentes <b>deficitarios</b>, que necesitan más de lo que tienen (empresas y Estado). El sistema financiero existe para unirlos.</p></div>`);

    out.push(`<div class="panel"><h2>2. El sistema financiero: transforma el ahorro en inversión</h2>
      <p><b>Sistema financiero</b>: el conjunto de instituciones, medios y mercados que canalizan el ahorro generado por los prestamistas (los superavitarios) hacia los prestatarios o inversores (los deficitarios) de un país. Lo hace de dos maneras: a través de <b>intermediarios</b>, en el mercado bancario, o <b>directamente</b>, en el mercado de valores.</p>
      <div class="sf-wrap">${diagram(active)}</div>
      <div class="sf-details">${['mon', 'cap', 'ban', 'bco', 'oin', 'val', 'bur', 'ext', 'div', 'otr']
        .map((id) => {
          const n = NODES.find((x) => x[0] === id);
          const d = DETAIL[id];
          const on = active.has(id);
          return `<details${on ? ' open' : ''}><summary><b>${n[1]}</b> · ${n[2]}${on ? ' <span class="pos">· en tu portafolio</span>' : ''}</summary>${d ? `<p>${d.who}</p>${d.app ? `<p class="hint">${d.app}</p>` : ''}` : '<p>Une el mercado bancario y el de valores: financiación de mediano y largo plazo para la inversión productiva.</p>'}</details>`;
        })
        .join('')}</div></div>`);

    out.push(`<div class="panel"><h2>3. Autoridades y entidades de apoyo</h2>
      <div class="table-scroll"><table class="data"><thead><tr><th>Entidad</th><th>Papel</th></tr></thead><tbody>
      <tr><td>Banco de la República</td><td>Banco central independiente (Constitución de 1991, Ley 31 de 1992). Su Junta Directiva fija la tasa de política monetaria para cumplir la meta de inflación de 3 % (± 1 punto). Administra las reservas internacionales, emite la moneda y es prestamista de última instancia.</td></tr>
      <tr><td>Ministerio de Hacienda y URF</td><td>Política fiscal, emisión de TES para financiar al Gobierno y regulación financiera (Unidad de Proyección Normativa y Estudios de Regulación Financiera).</td></tr>
      <tr><td>Superintendencia Financiera (SFC)</td><td>Vigila bancos, aseguradoras, fiduciarias, fondos de pensiones, comisionistas y emisores de valores, y certifica la TRM.</td></tr>
      <tr><td>Autorregulador del Mercado de Valores (AMV)</td><td>Disciplina y certifica a los profesionales del mercado de valores.</td></tr>
      <tr><td>Fogafín</td><td>Seguro de depósitos para los ahorradores de los establecimientos de crédito.</td></tr>
      <tr><td>BVC, Deceval y CRCC</td><td>La bolsa donde se negocia, el depósito que custodia los títulos y la cámara que compensa y garantiza las operaciones, sobre todo las de derivados.</td></tr>
      </tbody></table></div></div>`);

    out.push(`<div class="panel"><h2>4. Cómo se conectan: canales entre la economía y el sistema financiero</h2>
      <ol class="steps">
        <li><b>Ahorro → inversión → crecimiento.</b> Un sistema financiero más profundo (más crédito y mercado de capitales en relación con el PIB) financia más inversión y más crecimiento (Schumpeter, 1911; Levine, 1997). Crecimiento del PIB: ${val('pib', ' %')}. Las utilidades de las empresas crecen con la economía, y el precio de sus acciones es el valor presente de esas utilidades.${rel('pib')}</li>
        <li><b>Política monetaria → tasas → crédito, consumo y bolsa.</b> Si la inflación (${val('inflacion', ' %')}) se aleja de la meta de 3 %, el Banco de la República sube su tasa. Suben el IBR y las tasas de los CDT y del crédito, cae la demanda y, con ella, la inflación. Las acciones y los TES pierden valor porque sus flujos se descuentan a una tasa mayor; por eso la renta fija y la variable reaccionan a cada decisión de la Junta.${rel('inflacion')}</li>
        <li><b>Empleo → ingreso de los hogares → ahorro y consumo.</b> Con desempleo alto (${val('desempleo', ' %')}) los hogares ahorran y consumen menos, y sube la morosidad de los créditos. Los bancos prestan con más cautela y bajan sus utilidades, y el sector financiero pesa mucho en el COLCAP.${rel('desempleo')}</li>
        <li><b>Sector externo → TRM → mercado de divisas y de valores.</b> El precio del petróleo y los flujos de capital extranjero mueven la TRM (${val('trm', ' pesos por dólar')}). Cuando los extranjeros salen, venden TES y acciones y compran dólares: sube la TRM y caen la bolsa y los TES al mismo tiempo. Una TRM alta encarece la deuda en dólares y las importaciones, y sube la inflación (efecto traspaso).${rel('trm')}</li>
        <li><b>Política fiscal → TES → tasas de largo plazo.</b> El déficit del Gobierno se financia emitiendo TES. Si la deuda preocupa a los inversionistas, piden más tasa, lo que encarece la financiación de las empresas y baja el valor de los portafolios de renta fija (índice COLTES).</li>
      </ol>
      <p class="hint">Estas cifras salen de la sección Macro, que las descarga (en la app de escritorio) o las importa de tus archivos. La relación estadística de cada variable con cada activo está allí.</p></div>`);

    out.push(`<div class="panel"><h2>5. Dónde encaja la teoría de portafolios</h2>
      <p>La teoría moderna de portafolios trabaja en el <b>mercado de valores</b>, sobre todo en el bursátil. Markowitz (1952) explica cómo combinar los títulos para tener el mayor rendimiento por unidad de riesgo. Sharpe (1964), Treynor (1965) y Jensen (1968) miden el riesgo y el desempeño frente al índice del mercado. La economía entra por dos lados: en el <b>rendimiento esperado</b>, porque el crecimiento, la inflación y las tasas determinan las utilidades y la tasa de descuento, y en el <b>riesgo</b>, porque los choques macroeconómicos son el riesgo sistemático, el que no se elimina diversificando y que mide la β. Chen, Roll y Ross (1986) llevan esto al modelo de factores: cada activo tiene una sensibilidad a cada variable macro.</p>
      <p class="hint">Por eso la app combina segmentos de varios mercados del esquema: renta variable y renta fija del mercado de valores, CDT del mercado monetario y bancario, divisas y derivados. Al diversificar entre mercados que responden distinto a la economía, se reduce el riesgo del portafolio.</p></div>`);
    return out.join('');
  }

  PF.sistema = { NODES, render, diagram };
})(typeof globalThis !== 'undefined' ? globalThis : this);
