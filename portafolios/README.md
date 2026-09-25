# Frontera Eficiente

Aplicación web para construir y **confirmar portafolios eficientes** con la teoría de Markowitz, Sharpe, Treynor y Jensen. Muestra el rendimiento esperado del portafolio y lo diversifica tanto como permitan tus límites. No tiene dependencias y todo se calcula en el navegador. Solo al subir un Excel descarga SheetJS desde cdnjs.

Ábrela con `portafolios/index.html` (o con `npm start` en `http://localhost:8080/portafolios/`).

## Qué hace

1. **Datos**: sube los históricos que descargas de la **Bolsa de Valores de Colombia** (Excel o CSV con nemotécnico, fecha, cantidad, volumen y precio de cierre), de Investing.com o de Yahoo Finance. Puedes subir varios archivos a la vez. La app une los tramos de 6 meses de una misma acción, toma el último cierre de cada periodo y conserva solo las fechas comunes a todos los activos. También acepta una tabla ya armada (una columna por activo más un índice) con coma, punto y coma o tabulador, y coma decimal. Incluye un ejemplo simulado de 60 meses.
2. **Activos**: rendimiento esperado, σ, β, α de Jensen con su t y valor p, razón de Sharpe, razón de Treynor y R². Incluye la línea del mercado de valores y la matriz de correlaciones.
3. **Portafolio**: frontera eficiente, línea del mercado de capitales y cinco portafolios: el **recomendado** (máxima razón de Sharpe dentro de los límites de peso), mínima varianza, máxima diversificación, paridad de riesgo y 1/N. Para cada uno muestra el rendimiento esperado con su IC 95 %, la σ, las razones de Sharpe y Treynor, el α de Jensen, la β, el M², el número efectivo de activos, la razón de diversificación, el VaR y los montos a invertir. También calcula el modelo de Treynor-Black.
4. **Confirmar**: escribes tus pesos y la app dice si el portafolio es eficiente. Lo compara con el portafolio eficiente de igual riesgo y con el de igual rendimiento, y revisa una lista de criterios: Markowitz, Sharpe, Treynor, Jensen y diversificación.
5. **Teoría**: fórmulas y referencias.

## Supuestos configurables

- Tasa libre de riesgo y rendimiento esperado del mercado.
- Rendimientos esperados: históricos, del CAPM o una mezcla 50/50 (la opción predeterminada, que reduce el error de estimación).
- Covarianzas: muestrales (Markowitz) o del modelo de índice único (Sharpe).
- Peso mínimo y máximo por activo. Un máximo de 20 % obliga a tener al menos 5 activos, y un mínimo negativo permite ventas en corto.

## Método

`min ½ w'Σw − t·μ'w` sujeto a `Σw = 1` y `lo ≤ w ≤ hi` se resuelve exactamente por conjunto activo (`js/optim.js`). Al variar t se recorre la frontera. El portafolio tangente y el de máxima diversificación se obtienen maximizando una razón a lo largo de su frontera. Las pruebas comparan los resultados con las fórmulas cerradas sin restricciones, con un gradiente proyectado y con 5000 portafolios aleatorios.

```
js/stats.js    estadística, regresión, lectura de CSV
js/optim.js    programa cuadrático, frontera, tangente, paridad de riesgo
js/model.js    modelo de mercado, medidas, confirmación, Treynor-Black
js/sample.js   datos de ejemplo simulados
js/charts.js   gráficos SVG
js/app.js      interfaz
tests/run.js   pruebas del motor (node portafolios/tests/run.js)
tests/e2e.js   prueba en navegador con Playwright (la parte de Excel requiere el paquete xlsx)
```

Es una herramienta educativa: los rendimientos pasados no garantizan los futuros y no constituye asesoría de inversión.
