/* Escritor mínimo de libros de Excel (.xlsx) sin dependencias: hojas con valores,
 * fórmulas (con su resultado ya calculado), formatos numéricos, encabezados en
 * negrita, anchos de columna y paneles inmovilizados. El archivo es un ZIP sin
 * compresión con el XML de Office Open. Excel recalcula todo al abrirlo.
 *
 * Celda: null | número | texto | { v, f, s }   (f = fórmula sin «=», s = estilo)
 * Estilos: h (encabezado), b (negrita), t (título), n (nota), pct, pctb, num2, num4,
 *          num6, int, money, moneyb, date (fecha m/d/yyyy), px (#,##0.00)
 * Hoja: { name, rows, cols, freeze, colorScale: ['B4:K13'] (correlaciones: rojizos −1, amarillo 0, verdes +1) } */
(function (root) {
  'use strict';
  const PF = (root.PF = root.PF || {});

  const AUTHOR = 'Schrödinstein';
  const STYLE = { h: 1, b: 2, pct: 3, num4: 4, num6: 5, money: 6, num2: 7, t: 8, n: 9, pctb: 10, moneyb: 11, int: 12, date: 13, px: 14 };

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

  function colName(i) {
    let s = '';
    for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
    return s;
  }
  const ref = (r, c) => colName(c) + (r + 1);

  function cellXml(r, c, cell) {
    if (cell == null || cell === '') return '';
    const at = ref(r, c);
    if (typeof cell === 'number') return Number.isFinite(cell) ? `<c r="${at}"><v>${cell}</v></c>` : '';
    if (typeof cell === 'string') return `<c r="${at}" t="inlineStr"><is><t xml:space="preserve">${esc(cell)}</t></is></c>`;
    const s = cell.s != null ? ` s="${STYLE[cell.s] || 0}"` : '';
    if (cell.f) {
      const v = cell.v;
      if (typeof v === 'string') return `<c r="${at}"${s} t="str"><f>${esc(cell.f)}</f><v>${esc(v)}</v></c>`;
      return `<c r="${at}"${s}><f>${esc(cell.f)}</f>${Number.isFinite(v) ? `<v>${v}</v>` : ''}</c>`;
    }
    if (typeof cell.v === 'number') return Number.isFinite(cell.v) ? `<c r="${at}"${s}><v>${cell.v}</v></c>` : `<c r="${at}"${s}/>`;
    if (cell.v == null || cell.v === '') return `<c r="${at}"${s}/>`;
    return `<c r="${at}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(cell.v)}</t></is></c>`;
  }

  // Escala de Likert de las correlaciones (rojizos negativos, amarillo cero, verdes positivos) por bandas
  const BANDS_DEFAULT = [[-1, -0.6, '7A2012', 'FFFFFF'], [-0.6, -0.35, 'B23C20', 'FFFFFF'], [-0.35, -0.15, 'DF5C2C', 'FFFFFF'], [-0.15, -0.02, 'F28E37', '1D1D1F'], [-0.02, 0.02, 'FFDE46', '1D1D1F'], [0.02, 0.15, 'C2DE6E', '1D1D1F'], [0.15, 0.35, '81CC68', '1D1D1F'], [0.35, 0.6, '45A35F', 'FFFFFF'], [0.6, 1, '1C6B3A', 'FFFFFF']].map(([from, to, color, text]) => ({ from, to, color: '#' + color, text: '#' + text }));
  const BANDS = (root.PF && root.PF.stats && root.PF.stats.LK_BANDS) || BANDS_DEFAULT;
  const argb = (hex) => 'FF' + hex.replace('#', '').toUpperCase();
  const dxfs = () => `<dxfs count="${BANDS.length}">${BANDS.map((b) => `<dxf><font><color rgb="${argb(b.text)}"/></font><fill><patternFill patternType="solid"><bgColor rgb="${argb(b.color)}"/></patternFill></fill></dxf>`).join('')}</dxfs>`;
  function sheetXml(sh) {
    const rows = sh.rows
      .map((row, r) => {
        if (!row) return '';
        const cells = row.map((cell, c) => cellXml(r, c, cell)).join('');
        return cells ? `<row r="${r + 1}">${cells}</row>` : '';
      })
      .join('');
    const cols = (sh.cols || []).length ? `<cols>${sh.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
    let view = '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
    if (sh.freeze) {
      const { row = 0, col = 0 } = sh.freeze;
      const attrs = [col ? `xSplit="${col}"` : '', row ? `ySplit="${row}"` : ''].filter(Boolean).join(' ');
      view = `<sheetViews><sheetView workbookViewId="0"><pane ${attrs} topLeftCell="${ref(row, col)}" activePane="${row && col ? 'bottomRight' : row ? 'bottomLeft' : 'topRight'}" state="frozen"/></sheetView></sheetViews>`;
    }
    // Escala de color de 3 puntos (correlaciones: −1 rojo, 0 amarillo, +1 verde), formato condicional de Excel
    const cf = (sh.colorScale || [])
      .map((range) => `<conditionalFormatting sqref="${range}">${BANDS.map((b, i) => `<cfRule type="cellIs" dxfId="${i}" priority="${i + 1}" operator="between"><formula>${b.from}</formula><formula>${b.to}</formula></cfRule>`).join('')}</conditionalFormatting>`)
      .join('');
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${view}${cols}<sheetData>${rows}</sheetData>${cf}</worksheet>`;
  }

  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="8"><numFmt numFmtId="164" formatCode="0.00%"/><numFmt numFmtId="165" formatCode="0.0000"/><numFmt numFmtId="166" formatCode="0.000000"/><numFmt numFmtId="167" formatCode="&quot;$&quot; #,##0"/><numFmt numFmtId="168" formatCode="0.00"/><numFmt numFmtId="169" formatCode="#,##0"/><numFmt numFmtId="170" formatCode="[$-409]m/d/yyyy"/><numFmt numFmtId="171" formatCode="#,##0.00"/></numFmts>
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><color rgb="FF1D4F91"/><name val="Calibri"/></font><font><i/><sz val="10"/><color rgb="FF4A5651"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE3EBF6"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF9AA5B4"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment wrapText="0"/></xf>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="167" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="169" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="170" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="171" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>__DXFS__</styleSheet>`;

  function workbookParts(sheets) {
    const names = sheets.map((s) => s.name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31));
    const files = [];
    files.push([
      '[Content_Types].xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    ]);
    files.push(['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>']);
    // Propiedades del libro: autor
    const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    files.push(['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>${AUTHOR}</dc:creator><cp:lastModifiedBy>${AUTHOR}</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`]);
    files.push([
      'xl/workbook.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names
        .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
    ]);
    files.push([
      'xl/_rels/workbook.xml.rels',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ]);
    files.push(['xl/styles.xml', STYLES.replace('__DXFS__', dxfs())]);
    sheets.forEach((sh, i) => files.push([`xl/worksheets/sheet${i + 1}.xml`, sheetXml(sh)]));
    return files;
  }

  /* ---------- ZIP (método «store») ---------- */
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    for (const [name, content] of files) {
      const data = typeof content === 'string' ? enc.encode(content) : content;
      const nm = enc.encode(name);
      const crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true);
      h.setUint16(4, 20, true);
      h.setUint16(6, 0x0800, true); // nombres en UTF-8
      h.setUint16(8, 0, true);
      h.setUint16(10, 0, true);
      h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true);
      h.setUint32(18, data.length, true);
      h.setUint32(22, data.length, true);
      h.setUint16(26, nm.length, true);
      h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nm, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true);
      c.setUint16(4, 20, true);
      c.setUint16(6, 20, true);
      c.setUint16(8, 0x0800, true);
      c.setUint16(10, 0, true);
      c.setUint16(12, 0, true);
      c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true);
      c.setUint32(20, data.length, true);
      c.setUint32(24, data.length, true);
      c.setUint16(28, nm.length, true);
      c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nm);
      offset += 30 + nm.length + data.length;
    }
    const cdSize = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true);
    e.setUint16(8, files.length, true);
    e.setUint16(10, files.length, true);
    e.setUint32(12, cdSize, true);
    e.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(e.buffer)]);
    const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let pos = 0;
    for (const p of all) {
      out.set(p, pos);
      pos += p.length;
    }
    return out;
  }

  function build(sheets) {
    return zip(workbookParts(sheets));
  }

  PF.xlsx = { build, colName, ref, zip, crc32 };
})(typeof globalThis !== 'undefined' ? globalThis : this);
