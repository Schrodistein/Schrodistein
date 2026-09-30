/* «Dónde invertir»: canales para cada segmento del plan, paso a paso y verificación.
 * Es orientación general para Colombia: las tarifas, tasas y requisitos cambian, así que
 * cada canal remite a su sitio oficial para confirmarlos. No es asesoría de inversión. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});

  const link = (url, text) => `<a href="${url}" target="_blank" rel="noopener">${text || url.replace(/^https?:\/\/(www\.)?/, '')}</a>`;

  // Canales. segs: segmentos del plan que cubre cada uno.
  const CHANNELS = [
    {
      id: 'trii',
      name: 'trii (app de inversión)',
      segs: ['variable'],
      what: 'Acciones y ETF locales de la BVC (como ICOLCAP) desde el celular.',
      cost: 'Comisión fija por operación, la que usa esta app (≈ $15.000 por compra y por venta, con promociones ocasionales). Confirma la tarifa vigente en la app.',
      best: 'Montos pequeños y medianos, pocas operaciones al año. Con comisión fija, entre más grande cada compra, menor el costo en porcentaje.',
      url: 'https://www.trii.co',
    },
    {
      id: 'scb',
      name: 'Sociedades comisionistas de bolsa',
      segs: ['variable', 'fija', 'derivados', 'divisas'],
      what: 'El canal completo: acciones, ETF, TES, bonos, CDT en el mercado secundario, derivados de la BVC y, en algunas, divisas y mercados internacionales.',
      cost: 'Comisión en porcentaje del monto, casi siempre con un mínimo por operación, y a veces cuota de custodia o administración. Pide la tarifa por escrito.',
      best: 'Montos grandes, renta fija (TES y bonos) y derivados, que en la práctica solo se negocian a través de una comisionista miembro de la BVC.',
      examples: 'Hay comisionistas de los grandes bancos (por ejemplo Valores Bancolombia, Davivienda Corredores, Itaú Comisionista de Bolsa) e independientes (por ejemplo Credicorp Capital, Acciones & Valores, Casa de Bolsa, BTG Pactual, Alianza Valores, Global Securities). La lista oficial de miembros está en la BVC.',
      url: 'https://www.bvc.com.co',
    },
    {
      id: 'cdt',
      name: 'Bancos y compañías de financiamiento: CDT',
      segs: ['fija'],
      what: 'Certificados de depósito a término a tasa fija, abiertos en línea desde la app o la web de cada entidad.',
      cost: 'Sin comisión de bolsa. Hay retención en la fuente sobre los intereses y el 4 × 1.000 al mover el dinero.',
      best: 'La parte de renta fija segura del plan y los horizontes cortos. Compara la tasa efectiva anual (EA) al mismo plazo entre varias entidades. Los CDT de entidades vigiladas tienen el seguro de depósitos de Fogafín hasta su tope vigente por persona y entidad.',
      url: 'https://www.fogafin.gov.co',
      urlText: 'fogafin.gov.co (seguro de depósitos)',
    },
    {
      id: 'fic',
      name: 'Fondos de inversión colectiva (FIC)',
      segs: ['fija', 'variable', 'divisas'],
      what: 'Fondos de renta fija, de acciones o en dólares administrados por fiduciarias y comisionistas; algunos se abren por app (por ejemplo tyba, de Credicorp Capital).',
      cost: 'Comisión de administración anual, que ya viene descontada de la rentabilidad publicada. Revisa la ficha técnica y el reglamento del fondo.',
      best: 'Diversificar en renta fija o en dólares con montos pequeños, sin comprar TES o bonos uno por uno.',
      url: 'https://www.superfinanciera.gov.co',
      urlText: 'superfinanciera.gov.co (fondos vigilados)',
    },
    {
      id: 'deriv',
      name: 'Mercado de derivados de la BVC',
      segs: ['derivados'],
      what: 'Futuros estandarizados sobre la TRM, TES, acciones y el índice COLCAP. Se compensan en la Cámara de Riesgo Central de Contraparte (CRCC).',
      cost: 'Comisión de la comisionista por contrato y garantías (margen) que se ajustan cada día según el precio. Una caída puede exigir más garantías.',
      best: 'Cubrir riesgos (por ejemplo, el dólar) o tomar posiciones apalancadas si ya tienes experiencia. Es el segmento de mayor riesgo.',
      url: 'https://www.camaraderiesgo.com.co',
      urlText: 'camaraderiesgo.com.co (CRCC)',
    },
    {
      id: 'fx',
      name: 'Divisas: bancos, casas de cambio e inversión en dólares',
      segs: ['divisas'],
      what: 'Comprar dólares en un intermediario del mercado cambiario (bancos y casas de cambio autorizadas), o tener exposición al dólar con FIC en dólares y con ETF internacionales del Mercado Global Colombiano de la BVC.',
      cost: 'El diferencial entre el precio de compra y el de venta (compara con la TRM del día) más las comisiones del canal.',
      best: 'Diversificar el riesgo del peso colombiano. La TRM oficial del día la publica el Banco de la República.',
      url: 'https://www.banrep.gov.co',
      urlText: 'banrep.gov.co (TRM)',
    },
  ];

  const STEPS = [
    ['Define el plan', 'Presupuesto, horizonte y cuánto riesgo aceptas: la sección <b>Comprar</b> ya lo calcula, con el monto mínimo por inversión y el reparto con renta fija segura.'],
    ['Verifica la entidad', `Antes de entregar dinero, busca la entidad en la ${link('https://www.superfinanciera.gov.co', 'Superintendencia Financiera')} (entidades vigiladas) y al asesor en el registro de profesionales certificados del ${link('https://www.amvcolombia.org.co', 'AMV')}. Desconfía de rentabilidades «garantizadas» altas y de quien pida consignar a cuentas personales.`],
    ['Abre la cuenta', 'Con tu cédula, datos de contacto e información financiera (ingresos, patrimonio). Llenas el formulario de vinculación y el perfil de riesgo; algunas entidades piden certificación bancaria o RUT.'],
    ['Pasa el dinero', 'Por PSE o transferencia desde una cuenta a tu nombre. Ten en cuenta el 4 × 1.000 (GMF) al retirar de tu cuenta bancaria.'],
    ['Da la orden', 'Acciones y ETF: busca el nemotécnico y pon una <b>orden limitada</b> con la cantidad del plan y un precio máximo cercano al último cierre. CDT: plazo y tasa EA. TES y bonos: valor nominal y tasa. Derivados: número de contratos y garantías.'],
    ['Guarda los comprobantes y regístralos', 'Anota precio, fecha y la comisión que pagaste de verdad (con o sin promoción) en <b>Confirmar → Por acciones compradas</b>: así la app mide tu portafolio real.'],
    ['Haz seguimiento semanal', 'Actualiza los datos (la app de escritorio lo hace sola), mira si el recomendado cambió y rebalancea solo si la mejora supera las comisiones de vender y comprar.'],
    ['Impuestos', 'Los intereses y dividendos tienen retención en la fuente, y los rendimientos y el patrimonio se reportan en la declaración de renta ante la DIAN si superas los topes del año. Consulta a un contador para tu caso.'],
  ];

  /* Monto por segmento en el plan actual (la renta fija segura cuenta como renta fija). */
  function planBySeg(plan, segOf, clsOf) {
    const out = {};
    if (!plan) return out;
    for (const r of plan.rows) {
      const sg = segOf(clsOf(r.name)) || 'variable';
      out[sg] = out[sg] || { amount: 0, rows: [] };
      out[sg].amount += r.amount;
      out[sg].rows.push(r);
    }
    if (plan.safe > 0) {
      out.fija = out.fija || { amount: 0, rows: [] };
      out.fija.amount += plan.safe;
      out.fija.safe = plan.safe;
    }
    return out;
  }

  function render(ctx) {
    const { plan, money, pct, segOf, clsOf, SEGS } = ctx;
    const by = planBySeg(plan, segOf, clsOf);
    const inPlan = new Set(Object.keys(by));
    // Resumen del plan con el canal sugerido para cada segmento
    let summary;
    if (!plan) summary = '<p>Todavía no hay plan de inversión: carga los datos y revisa la sección <b>Comprar</b>. Abajo están todos los canales.</p>';
    else {
      const items = [];
      if (by.variable) {
        const n = by.variable.rows.length;
        const avg = by.variable.amount / Math.max(1, n);
        const cost = plan.feeBuy > 0 ? plan.feeBuy / avg : 0;
        items.push(`<li><b>Renta variable: ${money(by.variable.amount)}</b> en ${n} ${n === 1 ? 'activo' : 'activos'} (${by.variable.rows.map((r) => r.name).join(', ')}). ${plan.feeBuy > 0 ? `Con comisión fija de ${money(plan.feeBuy)}, cada compra de unos ${money(avg)} cuesta ${pct(cost, 2)}; una comisionista que cobre porcentaje solo sale más barata si cobra menos de ${pct(cost, 2)} por operación, incluido su mínimo.` : 'Con la comisión en $0 (promoción), la app de comisión fija es la opción más barata.'} Canal sugerido: <b>${avg < 50e6 ? 'trii o una comisionista con tarifa baja' : 'compara trii con una comisionista: a este monto el porcentaje puede salir mejor'}</b>.</li>`);
      }
      if (by.fija) {
        const parts = [];
        if (by.fija.safe) parts.push(`${money(by.fija.safe)} de renta fija segura: <b>CDT</b> en un banco vigilado (a la tasa EA más alta al plazo de tu horizonte) o un <b>FIC de renta fija</b> de corto plazo`);
        const tb = by.fija.rows.filter((r) => ['tes', 'bono'].includes(clsOf(r.name)));
        const cd = by.fija.rows.filter((r) => clsOf(r.name) === 'cdt');
        if (tb.length) parts.push(`${money(tb.reduce((s, r) => s + r.amount, 0))} en TES y bonos (${tb.map((r) => r.name).join(', ')}): a través de una <b>comisionista de bolsa</b> o de un <b>FIC</b> que invierta en ellos si el monto es pequeño`);
        if (cd.length) parts.push(`${money(cd.reduce((s, r) => s + r.amount, 0))} en CDT (${cd.map((r) => r.name).join(', ')}): en el banco emisor o en el mercado secundario con una comisionista`);
        items.push(`<li><b>Renta fija: ${money(by.fija.amount)}</b>. ${parts.join('; ')}.</li>`);
      }
      if (by.derivados) items.push(`<li><b>Derivados: ${money(by.derivados.amount)}</b> (${by.derivados.rows.map((r) => r.name).join(', ')}). Solo con una <b>comisionista miembro del mercado de derivados de la BVC</b>; ese monto es la exposición, y además necesitas garantías que cambian cada día.</li>`);
      if (by.divisas) items.push(`<li><b>Divisas: ${money(by.divisas.amount)}</b> (${by.divisas.rows.map((r) => r.name).join(', ')}). En un <b>banco o casa de cambio autorizada</b> comparando con la TRM del día, o con un <b>FIC en dólares</b> o un ETF del Mercado Global Colombiano si no necesitas los dólares en efectivo.</li>`);
      summary = `<p>Tu plan de ${money(plan.budget)} a ${plan.years} ${plan.years === 1 ? 'año' : 'años'} se reparte así:</p><ul>${items.join('')}</ul>`;
    }
    const segName = (k) => (SEGS[k] ? SEGS[k].label : k);
    const cards = CHANNELS.map((c) => {
      const hit = c.segs.some((sg) => inPlan.has(sg));
      return `<article class="where-card"${hit ? ' data-in-plan="1"' : ''}>
        <h3>${c.name}</h3>
        <div>${c.segs.map((sg) => `<span class="tag${inPlan.has(sg) ? '' : ' off'}">${segName(sg)}</span>`).join('')}${hit ? ' <b class="pos">En tu plan</b>' : ''}</div>
        <p>${c.what}</p>
        <ul><li><b>Costos:</b> ${c.cost}</li><li><b>Conviene para:</b> ${c.best}</li>${c.examples ? `<li><b>Ejemplos:</b> ${c.examples}</li>` : ''}</ul>
        <p>${link(c.url, c.urlText)}</p>
      </article>`;
    });
    // Primero los canales que usa el plan
    const order = CHANNELS.map((c, i) => [c.segs.some((sg) => inPlan.has(sg)) ? 0 : 1, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    return {
      summary,
      cards: order.map(([, i]) => cards[i]).join(''),
      steps: STEPS.map(([t, d]) => `<li><b>${t}.</b> ${d}</li>`).join(''),
    };
  }

  PF.where = { CHANNELS, STEPS, render, planBySeg };
})(typeof globalThis !== 'undefined' ? globalThis : this);
