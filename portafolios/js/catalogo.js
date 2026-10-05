/* Catálogo de acciones y ETF locales que cotizan en la Bolsa de Valores de Colombia (renta variable,
 * mercado principal), más los índices y divisas de referencia. El nemotécnico es el de la BVC, la única
 * fuente de precios de acciones, índices y ETF; solo las divisas tienen símbolo automático. La BVC cambia la lista cuando
 * una empresa se inscribe, se fusiona o cancela su inscripción: cualquier otro archivo que cargues
 * entra igual como un activo más, con su propio nombre. */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});
  const A = (nemo, name, sector) => ({ nemo, name, sector, type: 'accion', yahoo: '' });
  const CATALOG = [
    // Petróleo, gas y energía
    A('ECOPETROL', 'Ecopetrol', 'Petróleo y gas'),
    A('CNEC', 'Canacol Energy', 'Petróleo y gas'),
    A('PROMIGAS', 'Promigas', 'Gas'),
    A('TERPEL', 'Organización Terpel', 'Combustibles'),
    A('ISA', 'Interconexión Eléctrica (ISA)', 'Energía eléctrica'),
    A('GEB', 'Grupo Energía Bogotá', 'Energía eléctrica'),
    A('CELSIA', 'Celsia', 'Energía eléctrica'),
    // Bancos y financieras
    A('CIBEST', 'Grupo Cibest (antes Bancolombia), ordinaria', 'Bancos'),
    A('PFCIBEST', 'Grupo Cibest (antes Bancolombia), preferencial', 'Bancos'),
    A('GRUPOAVAL', 'Grupo Aval, ordinaria', 'Bancos'),
    A('PFAVAL', 'Grupo Aval, preferencial', 'Bancos'),
    A('BOGOTA', 'Banco de Bogotá', 'Bancos'),
    A('PFDAVVNDA', 'Davivienda, preferencial', 'Bancos'),
    A('BBVACOL', 'BBVA Colombia', 'Bancos'),
    A('OCCIDENTE', 'Banco de Occidente', 'Bancos'),
    A('POPULAR', 'Banco Popular', 'Bancos'),
    A('CORFICOLCF', 'Corficolombiana, ordinaria', 'Financieras'),
    A('PFCORFICOL', 'Corficolombiana, preferencial', 'Financieras'),
    A('GRUBOLIVAR', 'Grupo Bolívar', 'Financieras'),
    A('BVC', 'Bolsa de Valores de Colombia', 'Financieras'),
    A('BMC', 'Bolsa Mercantil de Colombia', 'Financieras'),
    // Holdings, cementos e infraestructura
    A('GRUPOARGOS', 'Grupo Argos, ordinaria', 'Holdings'),
    A('PFGRUPOARG', 'Grupo Argos, preferencial', 'Holdings'),
    A('GRUPOSURA', 'Grupo Sura, ordinaria', 'Holdings'),
    A('PFGRUPSURA', 'Grupo Sura, preferencial', 'Holdings'),
    A('VALOREM', 'Valorem', 'Holdings'),
    A('CEMARGOS', 'Cementos Argos, ordinaria', 'Cementos'),
    A('PFCEMARGOS', 'Cementos Argos, preferencial', 'Cementos'),
    A('CONCONCRET', 'Constructora Conconcreto', 'Construcción'),
    // Consumo, industria, minería y telecomunicaciones
    A('EXITO', 'Grupo Éxito', 'Comercio'),
    A('MINEROS', 'Mineros', 'Minería (oro)'),
    A('ETB', 'Empresa de Telecomunicaciones de Bogotá', 'Telecomunicaciones'),
    A('ENKA', 'Enka de Colombia', 'Industria'),
    A('FABRICATO', 'Fabricato', 'Textiles'),
    A('COLTEJER', 'Coltejer', 'Textiles'),
    A('ELCONDOR', 'Construcciones El Cóndor', 'Construcción'),
    // ETF locales
    { nemo: 'ICOLCAP', name: 'iShares MSCI COLCAP (ETF)', sector: 'ETF del índice COLCAP', type: 'etf', yahoo: '' },
    { nemo: 'HCOLSEL', name: 'Hcolsel (ETF de acciones colombianas)', sector: 'ETF', type: 'etf', yahoo: '' },
    // Índices de referencia (se descargan de la BVC)
    { nemo: 'MSCI COLCAP', name: 'Índice MSCI COLCAP', sector: 'Índice de renta variable', type: 'indice', yahoo: '' },
    { nemo: 'COLTES LP', name: 'Índice COLTES de largo plazo', sector: 'Índice de renta fija', type: 'indice', yahoo: '' },
    { nemo: 'COLIBR', name: 'Índice COLIBR (IBR overnight)', sector: 'Índice del mercado monetario', type: 'indice', yahoo: '' },
    // Divisas
    { nemo: 'USD/COP', name: 'Dólar en pesos', sector: 'Divisas', type: 'divisa', yahoo: 'COP=X' },
    { nemo: 'EUR/COP', name: 'Euro en pesos', sector: 'Divisas', type: 'divisa', yahoo: 'EURCOP=X' },
  ];
  PF.catalog = CATALOG;
  if (typeof module === 'object' && module.exports) module.exports = CATALOG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
