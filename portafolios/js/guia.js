/* Guía para aprender a operar acciones y ETF en la Bolsa de Valores de Colombia: del mercado a la orden
 * de compra, conectada en cada paso con la teoría que la sostiene (Markowitz, Tobin, Sharpe, Treynor,
 * Jensen, Fama, Gordon, Kahneman y Tversky…) y con la sección de la app donde se practica. Las normas,
 * tarifas y horarios cambian: la guía dice dónde confirmarlos. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const fin = Number.isFinite;

  const go = (screen, label) => `<button type="button" class="btn" data-guia-go="${screen}">${label}</button>`;
  const theory = (html) => `<div class="guia-theory"><b>La teoría detrás</b>${html}</div>`;
  const inApp = (...btns) => `<div class="row-btns guia-app"><span class="sub">En la app:</span>${btns.join('')}</div>`;

  /* Ejemplos con los datos cargados (si los hay). */
  function live(ctx) {
    const { m, P, pct, esc } = ctx;
    if (!m || !P) return null;
    const i = m.assets.reduce((b, a, k) => (fin(a.betaM) && (b < 0 || Math.abs(a.betaM - 1) < Math.abs(m.assets[b].betaM - 1)) ? k : b), -1);
    const a = m.assets[Math.max(0, i)];
    const k = m.rf + a.betaM * (m.Em - m.rf);
    const sel = (ctx.ports || []).find((p) => p.key === ctx.sel) || { label: 'Recomendado', key: 'recommended' };
    const e = P[sel.key] || P.recommended;
    return { a, k, e, sel, m, pct, esc, n: m.names.length };
  }

  const CHAPTERS = [
    {
      id: 'mercado',
      title: '1. Qué se negocia en la BVC',
      body: (L) => `
        <p>La <b>Bolsa de Valores de Colombia (BVC)</b> es el mercado organizado donde se compran y venden valores inscritos en el Registro Nacional de Valores y Emisores (RNVE). Para aprender a operar basta con conocer estos instrumentos:</p>
        <ul>
          <li><b>Acción ordinaria</b>: una parte de la propiedad de la empresa, con voto en la asamblea y derecho a los dividendos que se decreten. Ejemplos: ECOPETROL, ISA, CIBEST.</li>
          <li><b>Acción preferencial</b> (nemotécnicos que empiezan por <code>PF</code>, como PFCIBEST o PFAVAL): normalmente sin voto en la mayoría de decisiones, a cambio de un dividendo preferente. Suele ser más líquida que la ordinaria de la misma empresa.</li>
          <li><b>ETF</b> (fondo bursátil): un fondo que replica un índice y se compra como una acción. <b>ICOLCAP</b> replica el MSCI COLCAP: con una sola compra se tiene una canasta diversificada de las acciones más grandes y líquidas.</li>
          <li><b>Índices</b> (MSCI COLCAP, COLTES, COLIBR): no se compran; miden el mercado y sirven de referencia para calcular β, CAPM, Treynor y Jensen.</li>
        </ul>
        <p>Cada valor tiene un <b>nemotécnico</b>: el código con el que se negocia y con el que la app reconoce los archivos de la BVC.</p>
        ${theory(`<p><b>Hipótesis de mercados eficientes</b> (Fama, 1970): los precios reflejan la información disponible, así que es difícil ganarle al mercado de forma sistemática. Por eso la teoría moderna de portafolios no busca «la acción ganadora» sino la mejor <i>combinación</i> de riesgo y rendimiento, y por eso un ETF del índice es el punto de partida natural de cualquier portafolio.</p>`)}
        ${inApp(go('sistema', 'Sistema financiero'), go('biblioteca', 'Todos los activos de la BVC'))}`,
    },
    {
      id: 'antes',
      title: '2. Antes de invertir: objetivo, horizonte y riesgo',
      body: (L) => `
        <ol>
          <li><b>Fondo de emergencia primero.</b> Lo que puedas necesitar en menos de un año no va a la bolsa; va a renta fija segura (CDT, cuenta de ahorros remunerada o un fondo de liquidez).</li>
          <li><b>Horizonte.</b> Las acciones pueden caer 20 % o 30 % en un año. Con 1 año de plazo el riesgo de perder es alto; con 5 o 10 años, mucho menor.</li>
          <li><b>Tolerancia a la pérdida.</b> Define cuánto podrías perder sin vender por pánico. La app la usa para decidir qué parte va a acciones y qué parte a renta fija segura.</li>
          <li><b>Presupuesto y costos.</b> Cada compra paga una comisión fija o mínima: con montos pequeños conviene tener pocos activos o un ETF. La app calcula un monto mínimo por inversión para que la comisión no se coma el rendimiento.</li>
        </ol>
        ${theory(`<p><b>Teorema de separación de Tobin (1958)</b>: todos los inversionistas deberían tener el mismo portafolio de acciones (el tangente) y ajustar su riesgo solo con la proporción que ponen en renta fija segura. <b>Regla de seguridad primero de Roy (1952)</b>: elegir esa proporción para que la probabilidad de perder no pase de un límite. En la práctica: el portafolio tangente para la parte de acciones y una proporción en renta fija segura según tu tolerancia a la pérdida.</p>
          <p class="formula"><code>E(Rₚ) = (1 − α)·rf + α·E(R_T)</code> &nbsp; con α tal que P(pérdida en el plazo) ≤ p</p>`)}
        ${inApp(go('frontera', 'Portafolio'))}`,
    },
    {
      id: 'cuenta',
      title: '3. Abrir la cuenta y elegir el canal',
      body: () => `
        <ol>
          <li>Elige una <b>sociedad comisionista de bolsa</b> vigilada por la Superintendencia Financiera, o una plataforma que opere a través de una. Verifica en el <b>RNAMV</b> del Autorregulador del Mercado de Valores (AMV) que la firma y su asesor estén inscritos.</li>
          <li>Haz la <b>vinculación</b>: documento de identidad, RUT si te lo piden, certificación bancaria, origen de fondos y el <b>perfil de riesgo</b> (cuestionario de conocimiento y tolerancia).</li>
          <li>Recibe tu cuenta en el <b>depósito de valores</b> (deceval): las acciones quedan a tu nombre, no a nombre de la comisionista.</li>
          <li>Pasa dinero a la cuenta y revisa la <b>tabla de tarifas</b>: comisión por operación (y su mínimo), IVA sobre la comisión, custodia y costos de retiro.</li>
        </ol>
        <p>La sección «Dónde invertir» compara canales, costos y el paso a paso de cada uno. Escribe la comisión real de tu canal en Datos → Supuestos y la de cada compra en Confirmar (incluidas promociones a cero o a mitad de precio).</p>
        ${theory(`<p>Los <b>costos de transacción</b> reducen el rendimiento neto y cambian el portafolio óptimo: con una comisión fija por activo, el número óptimo de activos crece con el presupuesto. La app recalcula el plan con menos activos cuando eso da más rendimiento neto.</p>`)}
        ${inApp(go('invertir', 'Dónde invertir'), go('confirmar', 'Comisiones en Confirmar'))}`,
    },
    {
      id: 'orden',
      title: '4. Cómo funciona una orden de compra o venta',
      body: () => `
        <ul>
          <li><b>Orden límite</b>: compras o vendes a un precio máximo (o mínimo) que tú fijas. Es la recomendable en acciones poco líquidas: evita pagar un precio muy lejos del último cierre.</li>
          <li><b>Orden a mercado</b>: se ejecuta al mejor precio disponible en el libro. Rápida, pero en acciones con poco volumen puede salir cara.</li>
          <li><b>Libro de órdenes y spread</b>: las mejores puntas de compra y de venta. La diferencia (spread) es un costo implícito: cuanto más líquida la acción, más estrecho.</li>
          <li><b>Sesión de negociación</b>: subasta de apertura, negociación continua y subasta de cierre en días hábiles bursátiles (ruedas). El precio de cierre que usa la app es el de cada rueda. Consulta el horario vigente en bvc.com.co.</li>
          <li><b>Cumplimiento</b>: la operación se compensa y liquida normalmente en <b>T+2</b> (dos días hábiles después de la rueda), a través de la Cámara de Riesgo Central de Contraparte y deceval. Confírmalo con tu comisionista.</li>
          <li><b>Dividendos</b>: se pagan a quien tenga la acción antes del <b>periodo ex dividendo</b> (los días hábiles previos a cada pago, cuando la acción se negocia sin el derecho). Las fechas las publica cada emisor en la información relevante de la Superintendencia Financiera.</li>
        </ul>
        ${theory(`<p>La <b>liquidez</b> (volumen, rotación y frecuencia de negociación) es el criterio con que la BVC elige las acciones del COLEQTY y del MSCI COLCAP. Una acción poco líquida tiene precios de cierre «viejos» que subestiman su varianza y su correlación: por eso la app completa los días sin negociación con el último precio, mide los factores V, R y T del COLEQTY y avisa cuando una serie parece desfasada.</p>`)}
        ${inApp(go('terminal', 'Terminal: precios y volumen'), go('sistema', 'Índices y liquidez (COLEQTY)'))}`,
    },
    {
      id: 'datos',
      title: '5. Conseguir y guardar los datos',
      body: () => `
        <ol>
          <li>Descarga el histórico de cada acción o ETF en bvc.com.co (hasta 6 meses por archivo): la BVC es la única fuente de precios de la app. En la app de escritorio, «Abrir la BVC y descargar» importa cada archivo solo.</li>
          <li>Descarga también el índice de tu segmento: <b>MSCI COLCAP</b> para acciones y ETF.</li>
          <li>Sube los archivos en Datos: los tramos de un mismo nemotécnico se unen en un solo activo y quedan guardados en la Biblioteca, fieles a la fuente.</li>
          <li>Define los supuestos: tasa libre de riesgo (TES o COLIBR), rendimiento esperado del mercado o prima de riesgo, frecuencia y límites de peso. La guía de Datos dice de dónde sale cada uno.</li>
        </ol>
        ${theory(`<p>Toda la teoría se alimenta de dos estimaciones: el <b>rendimiento esperado</b> μ y la <b>matriz de covarianzas</b> Σ. Las dos salen del historial; la media histórica tiene mucho error, por eso la app ofrece mezclarla con el CAPM y fijar una fecha de corte para que el análisis sea reproducible.</p>`)}
        ${inApp(go('datos', 'Datos'), go('biblioteca', 'Biblioteca'), go('macro', 'Macro'))}`,
    },
    {
      id: 'analizar',
      title: '6. Analizar cada activo: rendimiento, riesgo y relación con el mercado',
      body: (L) => `
        <ul>
          <li><b>Rendimiento</b> <code>rₜ = Pₜ/Pₜ₋₁ − 1</code> y su promedio anual.</li>
          <li><b>Riesgo total</b>: desviación estándar σ (Markowitz, 1952).</li>
          <li><b>Correlación</b> ρ entre activos (Pearson): cuanto más baja, más ayuda a diversificar.</li>
          <li><b>Beta</b> β = Cov(rᵢ, rₘ)/Var(rₘ) (Sharpe, 1963): el riesgo que no se elimina diversificando. Damodaran la estima desde el negocio y la deuda.</li>
          <li><b>Rendimiento exigido</b> por el CAPM: <code>k = rf + β(E(Rₘ) − rf)</code>.</li>
          <li><b>Desempeño</b>: Sharpe (prima por unidad de σ), Treynor (por unidad de β) y α de Jensen (exceso sobre el CAPM).</li>
        </ul>
        ${L ? `<p class="guia-live">Con tus datos: <b>${L.esc(L.a.name)}</b> tiene β = ${L.a.betaM.toFixed(2).replace('.', ',')}; con rf = ${L.pct(L.m.rf)} y E(Rₘ) = ${L.pct(L.m.Em)}, el CAPM le exige k = ${L.pct(L.k)} al año. Su rendimiento esperado es ${L.pct(L.a.expRet)}: α de Jensen ${L.pct(L.a.expRet - L.k, 2)}.</p>` : ''}
        ${theory(`<p><b>Valoración fundamental y CAPM</b>: el modelo de dividendos de <b>Gordon (1959)</b> dice que el precio justo de una acción es <code>P₀ = D₁ / (k − g)</code>, donde D₁ es el dividendo del próximo año, g su crecimiento y k el rendimiento exigido que da el CAPM. Si el precio de mercado está muy por encima de ese valor, el rendimiento esperado es bajo; si está por debajo, alto. Así se conectan el análisis fundamental (Graham y Dodd, 1934) y la teoría de portafolios.</p>`)}
        ${inApp(go('activos', 'Activos'), go('estadistica', 'Paso a paso (secciones 1 a 7)'))}`,
    },
    {
      id: 'portafolio',
      title: '7. Construir el portafolio',
      body: (L) => `
        <ol>
          <li>Elige qué activos entran (cualquier grupo de dos o más) en «Activos del portafolio».</li>
          <li>La app calcula la <b>frontera eficiente</b> de Markowitz con esos activos y tus límites de peso.</li>
          <li>Compara los portafolios: mínima varianza, máxima Sharpe (tangente), recomendado (máximo rendimiento sin perder diversificación), máxima diversificación, paridad de riesgo y pesos iguales.</li>
          <li>Elige uno y revisa dónde queda frente a la frontera, la CML y la SML, y cuánto riesgo elimina la diversificación (correlación promedio).</li>
        </ol>
        ${L ? `<p class="guia-live">Ahora: portafolio <b>${L.esc(L.sel.label)}</b> con ${L.n} activos disponibles: rendimiento esperado ${L.pct(L.e.ret)}, riesgo ${L.pct(L.e.vol)}, Sharpe ${L.e.sharpe.toFixed(2).replace('.', ',')}, β ${L.e.beta.toFixed(2).replace('.', ',')}.</p>` : ''}
        ${theory(`<p><b>Markowitz (1952)</b>: el riesgo del portafolio <code>σₚ² = wᵀΣw</code> depende de las covarianzas, no solo del riesgo de cada acción. <b>Sharpe (1964)</b> y <b>Lintner (1965)</b>: con renta fija segura, el mejor portafolio de acciones es el tangente, y la recta que lo une con rf es la línea del mercado de capitales. <b>Treynor y Black (1973)</b>: si crees que algunos activos tienen α, combínalos con el índice en proporción a α/σ²(ε).</p>`)}
        ${inApp(go('frontera', 'Portafolio'), go('estadistica', 'Paso a paso (secciones 8 a 14)'))}`,
    },
    {
      id: 'ordenes',
      title: '8. Pasar del portafolio a las órdenes',
      body: () => `
        <ol>
          <li>En Portafolio toma los pesos del portafolio elegido y el monto de cada activo (capital × peso).</li>
          <li>Calcula las <b>acciones enteras</b> de cada activo: monto / último precio, redondeado hacia abajo.</li>
          <li>Coloca en tu comisionista una <b>orden límite</b> por cada activo, cerca del último precio.</li>
          <li>Registra en Confirmar lo que realmente compraste (cantidad, precio, fecha y comisión): la app verifica si tu portafolio quedó sobre la frontera eficiente y qué tanto se alejó de los pesos elegidos.</li>
        </ol>
        ${theory(`<p>El paso de pesos teóricos a acciones enteras y comisiones fijas es un problema de <b>optimización entera</b>: redondear cambia los pesos y el riesgo. Por eso Confirmar vuelve a evaluar el portafolio real con la misma Σ y lo compara con el eficiente de igual riesgo.</p>`)}
        ${inApp(go('frontera', 'Portafolio'), go('confirmar', 'Confirmar'))}`,
    },
    {
      id: 'seguimiento',
      title: '9. Seguimiento, rebalanceo e impuestos',
      body: () => `
        <ul>
          <li><b>Actualiza</b> los datos cada semana (la app de escritorio lo hace sola) y revisa si el portafolio recomendado cambió.</li>
          <li><b>Rebalancea</b> cuando un activo se aleje mucho de su peso objetivo (por ejemplo, más de 5 puntos), o una o dos veces al año. Cada rebalanceo paga comisiones: no lo hagas por cambios pequeños.</li>
          <li><b>Variables macro</b>: inflación, desempleo, PIB y TRM mueven el mercado colombiano. Mira cómo se relaciona cada una con tus activos.</li>
          <li><b>Impuestos</b>: los dividendos pueden tener retención en la fuente; la utilidad en la venta de acciones inscritas en bolsa tiene un tratamiento especial cuando no se supera cierto porcentaje de la empresa (Estatuto Tributario, art. 36-1). Declara tus inversiones y confirma las reglas vigentes con la DIAN o un contador.</li>
        </ul>
        ${theory(`<p><b>Modelo multifactor</b> de Chen, Roll y Ross (1986) y la <b>teoría de arbitraje</b> de Ross (1976): además del mercado, factores macro como la inflación, la producción y el tipo de cambio explican rendimientos. Por eso la app relaciona el COLCAP con PIB, inflación, desempleo y TRM.</p>`)}
        ${inApp(go('macro', 'Macro'), go('confirmar', 'Confirmar'))}`,
    },
    {
      id: 'errores',
      title: '10. Errores comunes y cómo evitarlos',
      body: () => `
        <ul>
          <li><b>Concentrarse</b> en una o dos acciones conocidas: la diversificación es el único «almuerzo gratis».</li>
          <li><b>Vender en pánico</b> después de una caída, o comprar solo lo que más subió.</li>
          <li><b>Ignorar los costos</b>: muchas compras pequeñas con comisión mínima destruyen el rendimiento.</li>
          <li><b>Creer que el pasado se repite</b>: los rendimientos históricos son una estimación con mucho error; usa rangos, no un número.</li>
          <li><b>Operar sin plan</b>: define antes cuánto, en qué, por cuánto tiempo y cuándo rebalancear.</li>
        </ul>
        ${theory(`<p><b>Finanzas conductuales</b> (Kahneman y Tversky, 1979): sentimos las pérdidas con más fuerza que las ganancias equivalentes (aversión a la pérdida) y sobrevaloramos lo conocido. Un proceso con reglas —el de esta guía— protege de esos sesgos.</p>`)}
        ${inApp(go('teoria', 'Teoría'))}`,
    },
  ];

  const GLOSSARY = [
    ['Nemotécnico', 'Código con que se negocia un valor en la BVC (ECOPETROL, PFCIBEST, ICOLCAP).'],
    ['Rueda', 'Día hábil bursátil: cada sesión de negociación.'],
    ['Comisionista de bolsa', 'Entidad autorizada para comprar y vender valores por cuenta de sus clientes.'],
    ['Deceval', 'Depósito centralizado donde quedan registradas tus acciones a tu nombre.'],
    ['Orden límite', 'Orden con precio máximo de compra o mínimo de venta.'],
    ['Spread', 'Diferencia entre la mejor punta de compra y la mejor de venta.'],
    ['T+2', 'Liquidación de la operación dos días hábiles después de la rueda.'],
    ['Dividendo', 'Parte de las utilidades que la empresa reparte a sus accionistas.'],
    ['Periodo ex dividendo', 'Días antes del pago en que la acción se negocia sin derecho al dividendo.'],
    ['ETF', 'Fondo que replica un índice y se negocia como una acción.'],
    ['MSCI COLCAP', 'Índice de las acciones más líquidas y grandes de la BVC; referencia del mercado.'],
    ['Rendimiento esperado E(R)', 'Lo que se espera ganar en un año, en promedio.'],
    ['Volatilidad σ', 'Desviación estándar de los rendimientos: el riesgo total.'],
    ['Correlación ρ', 'Cuánto se mueven juntos dos activos, de −1 a 1.'],
    ['Beta β', 'Sensibilidad del activo a los movimientos del mercado.'],
    ['Frontera eficiente', 'Portafolios con el mayor rendimiento para cada nivel de riesgo.'],
    ['Portafolio tangente', 'El de máxima razón de Sharpe; donde la CML toca la frontera.'],
    ['Razón de Sharpe', '(E(R) − rf) / σ: prima por unidad de riesgo total.'],
    ['α de Jensen', 'Rendimiento por encima de lo que exige el CAPM.'],
    ['Rebalancear', 'Comprar y vender para volver a los pesos objetivo.'],
  ];

  function render(ctx) {
    const L = live(ctx || {});
    const toc = CHAPTERS.map((c) => `<li><a href="#guia-${c.id}" data-guia-to="${c.id}">${c.title}</a></li>`).join('');
    const route = [
      ['datos', 'Datos', 'carga históricos y supuestos'],
      ['biblioteca', 'Biblioteca', 'guarda todo el historial'],
      ['terminal', 'Terminal', 'mira precios y volumen'],
      ['activos', 'Activos', 'β, CAPM, Sharpe, Treynor, Jensen'],
      ['frontera', 'Portafolio', 'elige activos y portafolio'],
      ['estadistica', 'Paso a paso', 'cada cálculo con sus fórmulas'],
      ['invertir', 'Dónde invertir', 'canal y órdenes'],
      ['confirmar', 'Confirmar', 'registra y verifica'],
    ];
    return `<div class="panel"><h2>Ruta de aprendizaje</h2>
        <ol class="guia-route">${route.map(([s, l, d]) => `<li><button type="button" class="btn" data-guia-go="${s}">${l}</button> <span class="sub">${d}</span></li>`).join('')}</ol>
        <h3>Capítulos</h3><ul class="guia-toc">${toc}</ul></div>
      ${CHAPTERS.map((c) => `<div class="panel guia-ch" id="guia-${c.id}"><h2>${c.title}</h2>${c.body(L)}</div>`).join('')}
      <div class="panel"><h2>Glosario</h2><dl class="guia-gloss">${GLOSSARY.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join('')}</dl></div>
      <div class="panel"><h2>Referencias</h2><ul class="refs">
        <li>Chen, N.-F., Roll, R. y Ross, S. A. (1986). Economic forces and the stock market. <i>Journal of Business, 59</i>(3), 383-403.</li>
        <li>Fama, E. F. (1970). Efficient capital markets: A review of theory and empirical work. <i>Journal of Finance, 25</i>(2), 383-417.</li>
        <li>Gordon, M. J. (1959). Dividends, earnings, and stock prices. <i>Review of Economics and Statistics, 41</i>(2), 99-105.</li>
        <li>Graham, B. y Dodd, D. (1934). <i>Security analysis</i>. McGraw-Hill.</li>
        <li>Jensen, M. C. (1968). The performance of mutual funds in the period 1945-1964. <i>Journal of Finance, 23</i>(2), 389-416.</li>
        <li>Kahneman, D. y Tversky, A. (1979). Prospect theory: An analysis of decision under risk. <i>Econometrica, 47</i>(2), 263-291.</li>
        <li>Lintner, J. (1965). The valuation of risk assets and the selection of risky investments in stock portfolios and capital budgets. <i>Review of Economics and Statistics, 47</i>(1), 13-37.</li>
        <li>Markowitz, H. (1952). Portfolio selection. <i>Journal of Finance, 7</i>(1), 77-91.</li>
        <li>Roy, A. D. (1952). Safety first and the holding of assets. <i>Econometrica, 20</i>(3), 431-449.</li>
        <li>Ross, S. A. (1976). The arbitrage theory of capital asset pricing. <i>Journal of Economic Theory, 13</i>(3), 341-360.</li>
        <li>Sharpe, W. F. (1964). Capital asset prices: A theory of market equilibrium under conditions of risk. <i>Journal of Finance, 19</i>(3), 425-442.</li>
        <li>Tobin, J. (1958). Liquidity preference as behavior towards risk. <i>Review of Economic Studies, 25</i>(2), 65-86.</li>
        <li>Treynor, J. L. y Black, F. (1973). How to use security analysis to improve portfolio selection. <i>Journal of Business, 46</i>(1), 66-86.</li>
      </ul></div>`;
  }

  PF.guia = { render, CHAPTERS, GLOSSARY };
})(typeof globalThis !== 'undefined' ? globalThis : this);
