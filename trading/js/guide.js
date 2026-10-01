/* Contenido de la pestaña «Guía». */
(function (root) {
  'use strict';
  const FX = (root.FX = root.FX || {});
  FX.guide = `
<h2>Cómo funciona</h2>
<p>Radar de Divisas descarga las velas del par que elijas desde Binance, las analiza con las principales escuelas de análisis técnico y cuantitativo y combina todas las evidencias en una <strong>puntuación de confluencia</strong> para comprar y otra para vender. Cuando una supera el umbral de tu perfil, hay un disparador reciente y no va contra la tendencia (si el filtro está activo), aparece una señal con entrada, stop, objetivo y tamaño de posición, y recibes un aviso.</p>
<p>Las señales se calculan solo con <strong>velas cerradas</strong>: la vela en curso puede cambiar hasta su cierre y daría falsas alarmas.</p>

<h3>Escuelas de análisis que combina</h3>
<dl>
  <dt>Tendencia — teoría de Dow, medias, ADX, Ichimoku, Supertrend</dt>
  <dd>Medias exponenciales 20/50/200; máximos y mínimos crecientes o decrecientes; fuerza de la tendencia con ADX y ±DI; posición respecto a la nube de Ichimoku y cruces Tenkan/Kijun; giros del Supertrend.</dd>
  <dt>Temporalidad superior</dt>
  <dd>Reconstruye la vela mayor (por ejemplo 4 h si miras 1 h) y comprueba si su tendencia acompaña. Operar a favor del marco mayor es una de las reglas más robustas.</dd>
  <dt>Momento — RSI, MACD, estocástico, CCI, divergencias</dt>
  <dd>Salidas de sobrecompra y sobreventa, cruces del MACD, divergencias normales (posible giro) y ocultas (continuación) en el RSI y el MACD.</dd>
  <dt>Volatilidad — Bollinger, Keltner, Donchian</dt>
  <dd>Reentradas en las bandas de Bollinger, salida de la compresión (squeeze: Bollinger dentro de Keltner) y rupturas del canal de Donchian (sistema «tortuga»).</dd>
  <dt>Volumen — OBV, MFI, Chaikin, VWAP</dt>
  <dd>Si el volumen confirma el movimiento: acumulación o distribución, flujo de dinero y posición frente al precio medio ponderado por volumen.</dd>
  <dt>Velas japonesas</dt>
  <dd>Martillo, estrella fugaz, envolventes, línea penetrante, nube oscura, harami, pinzas, estrella de la mañana y del atardecer, tres soldados y tres cuervos, doji. Solo cuentan en el contexto correcto (por ejemplo, un martillo tras una caída).</dd>
  <dt>Estructura y chartismo</dt>
  <dd>Soportes y resistencias (agrupando máximos y mínimos de oscilación), rupturas con volumen, doble suelo y doble techo, hombro-cabeza-hombro, triángulos, cuñas, canales, banderas, retrocesos y extensiones de Fibonacci, puntos pivote, rupturas de estructura (BOS) y cambios de carácter (CHoCH) y huecos de valor (FVG).</dd>
  <dt>Estadística</dt>
  <dd>Pendiente de regresión con su t de Student, exponente de Hurst y ratio de varianzas para saber si el activo tiende a continuar sus movimientos o a revertirlos, y GARCH(1,1) para la volatilidad.</dd>
</dl>
<p>Cada grupo tiene un tope de puntos: diez osciladores diciendo lo mismo cuentan como una sola evidencia, porque están correlacionados. Los factores en contra (sobrecompra, resistencia cercana, temporalidad superior opuesta) restan.</p>

<h3>Perfiles</h3>
<p><strong>Conservador</strong>: pocas señales, mucha confluencia. <strong>Equilibrado</strong>: el punto medio. <strong>Agresivo</strong>: más señales y más falsas. Más señales no significa más ganancias: compruébalo en el backtest.</p>

<h3>La proyección</h3>
<p>La pestaña <em>Proyección</em> no adivina el futuro: describe el abanico de precios plausibles. La volatilidad se estima con un modelo GARCH(1,1) y se simulan 2 000 trayectorias remuestreando los movimientos reales del par (simulación histórica filtrada), lo que respeta las colas gruesas de los mercados. El resultado es un cono: el precio debería quedar dentro de la banda del 90 % unas 9 de cada 10 veces.</p>
<p>Con esas trayectorias se calcula también la probabilidad de tocar el objetivo antes que el stop, y se compara con la <strong>tasa base empírica</strong>: qué ocurrió realmente en este par las veces que el análisis tuvo el mismo sesgo que ahora, con su intervalo de confianza. Si ese intervalo se solapa con el de «cualquier momento», el análisis no está aportando ventaja en este par.</p>

<h3>Fuentes de datos</h3>
<dl>
  <dt>Binance (sin clave)</dt><dd>Criptomonedas y pares de monedas estables frente a monedas nacionales (EURUSDT, USDTTRY…), en directo por WebSocket, con el sentimiento de los futuros.</dd>
  <dt>Twelve Data (clave gratuita)</dt><dd>Divisas de verdad: velas intradía de cualquier par (EUR/USD, GBP/JPY, USD/MXN…) y del oro y la plata (XAU/USD, XAG/USD). El plan gratuito da 800 consultas al día, de sobra si usas temporalidades de 15 min o más. Pega la clave en Ajustes.</dd>
  <dt>Banco Central Europeo (sin clave)</dt><dd>Tipos de referencia diarios de unas 30 divisas desde 1999. Sin clave de Twelve Data, los pares de divisas se analizan con estos datos en diario y semanal. Son fijaciones (un precio al día, a las 14:15 CET): no tienen mechas ni volumen.</dd>
  <dt>Forex Factory</dt><dd>Calendario económico de la semana. La app avisa en la tarjeta de señal cuando hay un dato de alto impacto para las divisas del par en las próximas 24 horas.</dd>
</dl>
<p>Escribe los pares de divisas con barra o sin ella (<code>EUR/USD</code> o <code>eurusd</code>); los de Binance, como siempre (<code>EURUSDT</code>).</p>

<h3>Herramientas de divisas (pestaña «Divisas»)</h3>
<dl>
  <dt>Sesiones</dt><dd>Sídney, Tokio, Londres y Nueva York, con su horario de verano. El solapamiento Londres–Nueva York concentra la liquidez; la sesión asiática suele moverse en rangos estrechos. El mercado cierra el fin de semana.</dd>
  <dt>Calendario económico</dt><dd>Empleo, inflación, PIB, decisiones de tipos… con previsión y dato anterior. Una sorpresa frente a la previsión mueve la divisa más que cualquier indicador técnico.</dd>
  <dt>Fuerza de las divisas</dt><dd>Cambio medio de cada una de las 8 principales frente a las otras siete. Enfrentar la más fuerte con la más débil suele dar las tendencias más limpias.</dd>
  <dt>Correlaciones</dt><dd>Comprar EUR/USD y GBP/USD a la vez es casi la misma apuesta: la matriz te evita duplicar el riesgo sin darte cuenta.</dd>
  <dt>Lotes y pips</dt><dd>En «Riesgo» y en la tarjeta de señal, el tamaño en lotes (estándar 100 000, mini 0.1, micro 0.01), el stop en pips y el valor del pip en la divisa de tu cuenta.</dd>
</dl>

<h3>Qué no incluye</h3>
<ul>
  <li><strong>Interpretación de noticias.</strong> El calendario te dice cuándo llega un dato y qué se espera, pero la app no lee titulares ni discursos. Los tipos de interés, la inflación, el empleo y los bancos centrales mueven las divisas con fuerza: evita abrir posiciones justo antes de datos importantes.</li>
  <li><strong>Ondas de Elliott y patrones armónicos.</strong> Su recuento es subjetivo y no se puede automatizar de forma fiable; se han dejado fuera a propósito.</li>
  <li><strong>Ejecución de órdenes.</strong> La app no se conecta a tu cuenta ni opera por ti. Tú decides y ejecutas en Binance.</li>
</ul>

<h3>Binance y las divisas</h3>
<p>Binance es un exchange de criptomonedas, no un bróker de forex. Allí los pares más parecidos a divisas son los de monedas estables frente a monedas nacionales, como <code>EURUSDT</code> (euro/dólar), <code>USDTTRY</code> (lira turca) o <code>USDTBRL</code> (real brasileño), y el oro tokenizado <code>PAXGUSDT</code>. La app analiza también los pares de divisas reales (EUR/USD, USD/JPY…) con datos de Twelve Data o del BCE, pero para operarlos necesitas un bróker de forex regulado en tu país. En forex el coste principal es el diferencial (spread): ajústalo en «Coste por lado en divisas».</p>
<p>En <strong>spot</strong> solo se puede comprar lo que se paga: las señales de venta sirven para cerrar o reducir compras. Para vender en corto hacen falta futuros o margen, que implican apalancamiento y riesgo de liquidación.</p>

<h3>Expectativas realistas</h3>
<p>No existe una forma rápida y segura de ganar dinero con el trading. Los avisos obligatorios de los brókeres europeos indican que entre el 70 % y el 90 % de las cuentas minoristas de CFD pierden dinero. Lo que sí se puede controlar es cuánto se pierde cuando uno se equivoca: stop siempre, riesgo pequeño por operación, comisiones bajo control y paciencia para evaluar una estrategia con decenas de operaciones, no con dos o tres.</p>
<p>Un buen uso de la app: elige pocos pares y una temporalidad de 1 h o más, valida la estrategia en el backtest, opera primero con cantidades mínimas y lleva un registro de tus resultados.</p>

<h3>Legalidad e impuestos</h3>
<p>Operar con criptoactivos es legal en la mayoría de países, pero comprueba que Binance presta servicio legalmente en el tuyo y respeta sus condiciones (verificación de identidad incluida). Las ganancias tributan: guarda el historial de operaciones y decláralas según la normativa fiscal de tu país.</p>

<h3>Glosario rápido</h3>
<dl>
  <dt>ATR</dt><dd>Rango medio verdadero: cuánto se mueve el precio en una vela típica. Se usa para colocar el stop.</dd>
  <dt>R y R:R</dt><dd>R es lo que arriesgas en una operación. Un R:R de 2 significa que buscas ganar el doble de lo que arriesgas.</dd>
  <dt>Factor de beneficio</dt><dd>Ganancias brutas divididas entre pérdidas brutas. Por encima de 1, la estrategia gana dinero.</dd>
  <dt>Esperanza</dt><dd>Resultado medio por operación, en R. Es la cifra que de verdad importa.</dd>
  <dt>Máxima caída</dt><dd>La mayor bajada del capital desde un máximo. Te dice cuánto dolor hay que aguantar.</dd>
</dl>
`;
})(typeof globalThis !== 'undefined' ? globalThis : this);
