// Registro de compras por CONCEPTO · exportaciones e importación (JUNJI, FAEP, FIGA, Aporte Fiscal Educ. y Aporte Fiscal JUNJI):
//   · Excel de respaldo: hoja COMPRAS análoga a la de las fuentes con compras pero con la columna «Concepto» en vez de «Codigo» (la hoja BYS_ITEMS sigue siendo lo «sin documento»);
//     neutralización de fórmulas SOLO en texto libre (concepto, descripción, proveedor, N° DC), nunca en montos, fechas, RUT ni N° de documento;
//   · importación con las mismas reglas de las compras: ID usable (actualiza esa compra) o clave determinista «imp-…» (reimportar no duplica), nota de crédito siempre negativa,
//     filas rechazadas con motivo (RBD, ID o concepto inválido, concepto vacío), una hoja con «Codigo» (de una fuente con cuenta) se rechaza entera, un archivo antiguo sin la hoja no borra nada,
//     un archivo sin la columna N° DC no borra el que ya tiene la compra; exportar → importar → exportar no cambia nada;
//   · XLS (con la hoja COMPRAS de esa entidad), CSV de detalle mensual (SIN datos del documento; con las líneas «B&S documentado») y PDF por fila (registro de compras, desglose
//     documentado / sin documento), JSON de respaldo.  NO hay CSV de SUPEREDUC para estas fuentes.
import { boot, clickTab } from '../lib/boot.mjs';
import { capturarDescarga, leerXlsx, parseCsvPuntoYComa } from '../lib/capture-utils.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { docsDe, clon } from '../lib/corte.mjs';
import { libroXlsx, importarLibro } from '../lib/compras.mjs';
import { FUENTES_CONCEPTO, entidadDe, documentadoDe, compraCBase } from '../lib/compras_conceptos.mjs';

const ENC = ['ID', 'RBD', 'Nombre', 'Concepto', 'TipoDocumento', 'NroDocumento', 'FechaDocumento', 'FechaPago', 'Descripcion', 'RutProveedor', 'NombreProveedor', 'MontoGasto', 'MontoDocumento', 'DocumentoOriginal', 'N° DC'];
const exportar = async (h, disparar) => { const dl = await capturarDescarga(h.page, disparar); return { ...dl, libro: await leerXlsx(h.page, dl.buffer) }; };
async function importar(h, inputSelector, dl) {
  const antes = h.dialogs.length;
  await h.page.setInputFiles(inputSelector, { name: dl.filename, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: dl.buffer });
  for (let i = 0; i < 200 && h.dialogs.length === antes; i++) await h.page.waitForTimeout(50);
  await h.flushWrites(); await h.waitIdle();
  return h.dialogs.slice(antes).map(d => d.message);
}
function limpiar(v) {
  if (Array.isArray(v)) return v.map(limpiar);
  if (v && typeof v === 'object') {
    const o = {};
    Object.keys(v).sort().forEach(k => {
      if (k === 'lastModifiedAt' || k === 'lastModifiedBy') return;
      const x = limpiar(v[k]);
      if (x === 0 || x === '' || (x && typeof x === 'object' && !Array.isArray(x) && Object.keys(x).every(c => c === 'item' || c === 'concepto'))) return;
      o[k] = x;
    });
    return o;
  }
  return v;
}
const documentos = (store) => { const o = {}; Object.keys(store).forEach(p => { o[p] = limpiar(store[p]); }); return o; };
function primeraDiferencia(a, b, ruta = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return null;
  if (a && b && typeof a === 'object' && typeof b === 'object') for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) { const d = primeraDiferencia(a[k], b[k], ruta + '/' + k); if (d) return d; }
  return `${ruta}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`;
}
function igualLibros(a, b) {
  if (JSON.stringify(a.orden) !== JSON.stringify(b.orden)) return `hojas distintas: ${a.orden} vs ${b.orden}`;
  for (const n of a.orden) {
    const A = a.hojas[n], B = b.hojas[n];
    if (A.length !== B.length) return `hoja ${n}: ${A.length} filas -> ${B.length} filas`;
    for (let i = 0; i < A.length; i++) if (JSON.stringify(A[i]) !== JSON.stringify(B[i])) return `hoja ${n}, fila ${i + 1}: ${JSON.stringify(A[i])} -> ${JSON.stringify(B[i])}`;
  }
  return null;
}
const comprasDe = async (h, rbd, fuente) => ((await h.store())[`sep_carga_rbd/${rbd}`].otras_fuentes[fuente] || {}).compras || {};
const HOJAS_ESPERADAS = {
  junji: ['ING_OPERACION', 'ING_HOMOLOGACION', 'ING_CARRERA_DOCENTE', 'ING_BDL', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'META'],
  faep: ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'META'], figa: ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'META'],
  aporte_educ: ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'META'], aporte_junji: ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'META'],
};

await correrSpec('compras_conceptos_excel', async (t) => {
  const docsBase = docsDe('compras_conceptos');

  // ============================== 1. EXPORTACIÓN: la hoja COMPRAS de cada fuente por concepto ==============================
  let h = await boot({ fixture: 'compras_conceptos' });
  const { page } = h;
  for (const k of FUENTES_CONCEPTO) {
    await clickTab(page, 'of-' + k);
    const x = await exportar(h, () => page.click(`#downloadExcelOFBtn-${k}`));
    t.eq(x.libro.orden, HOJAS_ESPERADAS[k], `${k}: el libro trae la hoja COMPRAS antes de BYS_ITEMS (lo «sin documento»)`);
    t.eq(x.libro.hojas.COMPRAS[0], ENC, `${k}: encabezados de COMPRAS con «Concepto» en lugar de «Codigo»`);
    const nEsperado = Object.keys(docsBase).filter(id => id !== '_meta').reduce((n, id) => n + Object.keys(((docsBase[id].otras_fuentes || {})[k] || {}).compras || {}).length, 0);
    t.eq(x.libro.hojas.COMPRAS.length - 1, nEsperado, `${k}: una fila por compra de todas las entidades (${nEsperado})`);
  }
  // Contenido fila a fila de FAEP.
  await clickTab(page, 'of-faep');
  const fx = await exportar(h, () => page.click('#downloadExcelOFBtn-faep'));
  const filaDe = (id) => fx.libro.hojas.COMPRAS.find(r => r[0] === id);
  t.eq(filaDe('fa1121_1'), ['fa1121_1', 1121, 'LICEO PULMAHUE DE LA LIGUA', 'Alimentación', 'Factura electrónica', '1001', '2026-03-12', '2026-03-30', 'Colaciones de marzo', '76123456-7', 'Proveedor Ejemplo SpA', 500000, 595000, '', 'DC_701'], 'FAEP: fila completa de una factura (ID, RBD, concepto, tipo, N°, fechas, proveedor, montos, N° DC)');
  const nc = filaDe('fa1121_nc');
  t.eq([nc[4], nc[11], nc[12], nc[13]], ['Nota de crédito', -50000, -59500, '1001-FACEL'], 'FAEP: la nota de crédito (guardada en positivo) sale en NEGATIVO y con su Documento Original');
  t.eq(filaDe('fa_ac_1').slice(0, 4), ['fa_ac_1', 'AC', 'Administración Central', 'Alimentación'], 'FAEP: la fila de AC lleva «AC» en la columna RBD');
  t.eq(filaDe('fa5402002_1').slice(0, 4).map(String), ['fa5402002_1', '5402002', fx.libro.hojas.COMPRAS.find(r => r[0] === 'fa5402002_1')[2], 'Alimentación'], 'FAEP: las compras de un jardín (GESPARVU) también salen');
  const esp = filaDe('fa1121_especial');
  t.ok(esp[3] === 'Reparación "sala" & <cuna> O\'Higgins' && esp[5] === 'A&B-<7>' && esp[8].includes('<b>x</b>') && esp[10] === 'Ñandú <Ltda> & "Co"' && esp[14] === "DC_<9> & 'Z'; \"Q\"", 'FAEP: los caracteres especiales (& < > " \') viajan intactos', esp);
  t.eq(filaDe('fa1121_sinconcepto')[3], '', 'FAEP: la compra sin concepto sale con la celda vacía');
  t.eq(filaDe('fa1121_invalida')[6], '10/03/2026', 'FAEP: la fecha con formato no reconocido sale tal cual');
  // Hoja BYS_ITEMS = solo lo «sin documento» (no mezcla lo documentado).
  const sinDoc = fx.libro.hojas.BYS_ITEMS.filter((r, i) => i > 0 && r[0] === 1121).map(r => r[2]).sort();
  t.eq(sinDoc, ['Alimentación', 'Servicios básicos'], 'FAEP: BYS_ITEMS (1121) sigue trayendo solo los 2 conceptos «sin documento»');
  t.noErrores(h);
  await h.close();

  // ============================== 2. NEUTRALIZACIÓN DE FÓRMULAS (solo texto libre) ==============================
  h = await boot({ fixture: 'compras_conceptos' });
  await h.remoto('1121', `Object.assign(d.otras_fuentes.faep.compras.fa1121_1, { concepto: '=CMD()', descripcion: '+HYPERLINK("x")', nombreProveedor: '@SUMA(1)', documentoContable: '-DC9', nroDocumento: '=1+1', rutProveedor: '+11111111-1', fechaDocumento: '2026-03-12' });
    d.otras_fuentes.faep.compras.fa1121_2.concepto = '-5%'; d.otras_fuentes.faep.compras.fa1121_2.descripcion = '-1500';`);
  await h.waitIdle();
  await clickTab(h.page, 'of-faep');
  const fn = await exportar(h, () => h.page.click('#downloadExcelOFBtn-faep'));
  const r1 = fn.libro.hojas.COMPRAS.find(r => r[0] === 'fa1121_1');
  t.eq([r1[3], r1[8], r1[10], r1[14]], ["'=CMD()", "'+HYPERLINK(\"x\")", "'@SUMA(1)", "'-DC9"], 'Excel: apóstrofo inicial en concepto, descripción, proveedor y N° DC que empiezan con = + - @');
  t.eq([r1[5], r1[9], r1[6], r1[11]], ['=1+1', '+11111111-1', '2026-03-12', 500000], 'Excel: NUNCA en N° de documento, RUT, fechas ni montos');
  const r2 = fn.libro.hojas.COMPRAS.find(r => r[0] === 'fa1121_2');
  t.eq([r2[3], r2[8]], ['-5%', '-1500'], 'Excel: un texto que es un número («-5%», «-1500») no se toca');
  // Reimportar: el apóstrofo se quita y los datos no cambian.
  const antes = documentos(await h.store());
  const m = await importar(h, '#importExcelOFInput-faep', fn);
  t.ok(/COMPRAS: \d+ filas/.test(m[0] || ''), 'importar: el resumen lista COMPRAS', m);
  const c = (await comprasDe(h, '1121', 'faep')).fa1121_1;
  t.eq([c.concepto, c.descripcion, c.nombreProveedor, c.documentoContable], ['=CMD()', '+HYPERLINK("x")', '@SUMA(1)', '-DC9'], 'importar: se quita el apóstrofo y los textos quedan como estaban');
  t.eq(primeraDiferencia(antes['sep_carga_rbd/1121'].otras_fuentes.faep.bys_items, documentos(await h.store())['sep_carga_rbd/1121'].otras_fuentes.faep.bys_items), null, 'lo «sin documento» no cambia al reimportar');
  t.noErrores(h);
  await h.close();

  // ============================== 3. IDA Y VUELTA con documentos válidos (las 5 fuentes) ==============================
  const limpios = clon(docsBase);
  limpios['1121'].otras_fuentes.faep.compras.fa1121_nc.montoGasto = -50000; limpios['1121'].otras_fuentes.faep.compras.fa1121_nc.montoDocumento = -59500;
  ['fa1121_sinconcepto', 'fa1121_invalida'].forEach(id => { delete limpios['1121'].otras_fuentes.faep.compras[id]; });
  h = await boot({ fixture: limpios });
  for (const k of FUENTES_CONCEPTO) {
    await clickTab(h.page, 'of-' + k);
    const tAntes = await h.page.evaluate((key) => document.getElementById('tab-of-' + key).innerText, k);
    const sAntes = documentos(await h.store());
    const e1 = await exportar(h, () => h.page.click(`#downloadExcelOFBtn-${k}`));
    const m1 = await importar(h, `#importExcelOFInput-${k}`, e1);
    t.ok(/^Carga importada correctamente/.test(m1[0] || '') && /COMPRAS: \d+ filas/.test(m1[0] || '') && !/NO se import/.test(m1[0] || ''), `${k}: la importación informa éxito, lista COMPRAS y no rechaza ninguna fila`, m1);
    t.eq(await h.page.evaluate((key) => document.getElementById('tab-of-' + key).innerText, k), tAntes, `${k}: la pestaña queda idéntica tras reimportar`);
    const e2 = await exportar(h, () => h.page.click(`#downloadExcelOFBtn-${k}`));
    t.eq(igualLibros(e1.libro, e2.libro), null, `${k}: exportar → importar → exportar da exactamente las mismas hojas (también COMPRAS)`);
    t.eq(primeraDiferencia(sAntes, documentos(await h.store())), null, `${k}: los documentos del servidor quedan iguales (salvo ceros y auditoría)`);
    const nCompras = (s) => Object.values(s).reduce((n, d) => n + Object.keys(((d.otras_fuentes || {})[k] || {}).compras || {}).length, 0);
    t.eq(nCompras(documentos(await h.store())), nCompras(sAntes), `${k}: no se duplican compras al reimportar`);
  }
  // Excel individual (fila) de una entidad con documentos: la hoja COMPRAS trae SOLO esa entidad y se reimporta.
  await clickTab(h.page, 'of-faep');
  const sFila = documentos(await h.store());
  const f1 = await exportar(h, () => h.page.click('#otrasFuentesTbody-faep button.row-action-btn[data-action="excel"][data-rbd="1121"]'));
  t.eq([...new Set(f1.libro.hojas.COMPRAS.slice(1).map(r => r[1]))], [1121], 'XLS por fila (FAEP 1121): COMPRAS trae solo las compras de esa entidad');
  t.eq(f1.libro.hojas.COMPRAS.length - 1, 6, 'XLS por fila (FAEP 1121): 6 compras (las 8 del fixture menos las 2 que se quitaron)');
  const mf = await importar(h, '#importExcelOFInput-faep', f1);
  t.ok(/^Carga importada correctamente/.test(mf[0] || ''), 'XLS por fila: se reimporta', mf);
  t.eq(primeraDiferencia(sFila, documentos(await h.store())), null, 'XLS por fila: los documentos siguen iguales');
  const fJ = await exportar(h, () => h.page.click('#otrasFuentesTbody-faep button.row-action-btn[data-action="excel"][data-rbd="5402002"]'));
  t.eq(fJ.libro.hojas.COMPRAS.length - 1, 2, 'XLS por fila (jardín 5402002): sus 2 compras de FAEP');
  t.noErrores(h);
  await h.close();

  // ============================== 4. IMPORTACIÓN: reglas de las compras ==============================
  h = await boot({ fixture: 'compras_conceptos' });
  await clickTab(h.page, 'of-figa');
  const fila = (id, rbd, nombre, c) => [id, rbd, nombre, c.concepto, c.tipoDocumento, c.nroDocumento, c.fechaDocumento, c.fechaPago, c.descripcion, c.rutProveedor, c.nombreProveedor, c.montoGasto, c.montoDocumento, c.documentoOriginal || '', c.documentoContable || ''];
  const base = (extra) => compraCBase({ concepto: 'Material didáctico', ...extra });
  const nombre1121 = 'LICEO PULMAHUE DE LA LIGUA';
  // 4.1 IDs vacíos / 0 / "0": clave determinista imp-… (nada en la clave "0"), reimportar no duplica, NC positiva → negativa, ND negativa → positiva.
  const filas41 = [
    ENC,
    fila('', 1121, nombre1121, base({ nroDocumento: '1', descripcion: 'sin id uno' })),
    fila(0, 1121, nombre1121, base({ nroDocumento: '2', descripcion: 'id cero' })),
    fila('0', 1121, nombre1121, base({ nroDocumento: '3', descripcion: 'id texto cero' })),
    fila('nc-pos', 1121, nombre1121, base({ tipoDocumento: 'Nota de crédito', nroDocumento: '4', montoGasto: 40000, montoDocumento: 47600, documentoOriginal: '1-FAC' })),
    fila('nd-neg', 1121, nombre1121, base({ tipoDocumento: 'Nota de débito', nroDocumento: '5', montoGasto: -30000, montoDocumento: -35700 })),
    fila('fac-neg', 1121, nombre1121, base({ tipoDocumento: 'Factura', nroDocumento: '6', montoGasto: -1000, montoDocumento: -1190 })),
  ];
  const libro41 = await libroXlsx(h.page, { COMPRAS: filas41 });
  const antes1121 = Object.keys(await comprasDe(h, '1121', 'figa')).length;
  const msg41 = await importarLibro(h, '#importExcelOFInput-figa', libro41);
  t.ok(/COMPRAS: 6 filas/.test(msg41[0] || ''), 'importar: las 6 filas son válidas', msg41);
  const c41 = await comprasDe(h, '1121', 'figa');
  const nuevas = Object.entries(c41).filter(([id]) => !['fg1121_1', 'fg1121_nc'].includes(id));
  t.eq(nuevas.length, 6, 'importar: 6 compras nuevas (nada colapsa en la clave "0")');
  t.ok(!('0' in c41), 'importar: ninguna compra queda bajo la clave "0"');
  t.eq(nuevas.filter(([id]) => /^imp-/.test(id)).length, 3, 'importar: los 3 IDs vacío / 0 / "0" reciben una clave determinista «imp-…»');
  t.eq([c41['nc-pos'].montoGasto, c41['nc-pos'].montoDocumento, c41['nd-neg'].montoGasto, c41['nd-neg'].montoDocumento, c41['fac-neg'].montoGasto], [-40000, -47600, 30000, 35700, -1000], 'importar: la nota de crédito queda NEGATIVA, la de débito POSITIVA y una factura en negativo se respeta');
  t.eq(c41['nc-pos'].documentoOriginal, '1-FAC', 'importar: el Documento Original de la NC se conserva');
  t.ok(nuevas.every(([, c]) => typeof c.concepto === 'string' && !('codigo' in c)), 'importar: las compras guardadas llevan `concepto` y no `codigo`');
  const clavesImp = nuevas.map(([id]) => id).sort();
  await importarLibro(h, '#importExcelOFInput-figa', libro41);
  t.eq(Object.keys(await comprasDe(h, '1121', 'figa')).sort(), Object.keys(c41).sort(), 'reimportar el mismo archivo NO duplica ni cambia las claves (idempotente)');
  t.eq(Object.keys(await comprasDe(h, '1121', 'figa')).length, antes1121 + 6, 'total de compras = antes + 6');
  // 4.2 ID real: actualiza esa compra (edición desde Excel); el N° DC se limpia con la celda vacía y se conserva si el archivo no trae la columna.
  const libro42 = await libroXlsx(h.page, { COMPRAS: [ENC, fila('fg1121_1', 1121, nombre1121, { ...c41['nc-pos'], concepto: 'Material didáctico', tipoDocumento: 'Factura', nroDocumento: '530', fechaDocumento: '2026-02-05', fechaPago: '2026-02-12', descripcion: 'Material didáctico del liceo (editado)', montoGasto: 260000, montoDocumento: 309400, documentoOriginal: '', documentoContable: 'DC_800' })] });
  await importarLibro(h, '#importExcelOFInput-figa', libro42);
  const e42 = (await comprasDe(h, '1121', 'figa')).fg1121_1;
  t.eq([e42.montoGasto, e42.descripcion, e42.documentoContable], [260000, 'Material didáctico del liceo (editado)', 'DC_800'], 'importar con un ID existente ACTUALIZA esa compra (y le pone el N° DC)');
  const sin14 = ENC.slice(0, 14);
  const libro42b = await libroXlsx(h.page, { COMPRAS: [sin14, fila('fg1121_1', 1121, nombre1121, { ...e42, montoGasto: 270000 }).slice(0, 14)] });
  await importarLibro(h, '#importExcelOFInput-figa', libro42b);
  const e42b = (await comprasDe(h, '1121', 'figa')).fg1121_1;
  t.eq([e42b.montoGasto, e42b.documentoContable], [270000, 'DC_800'], 'un archivo SIN la columna N° DC no borra el N° DC que ya tiene la compra');
  const libro42c = await libroXlsx(h.page, { COMPRAS: [ENC, fila('fg1121_1', 1121, nombre1121, { ...e42b, documentoContable: '' })] });
  await importarLibro(h, '#importExcelOFInput-figa', libro42c);
  t.eq((await comprasDe(h, '1121', 'figa')).fg1121_1.documentoContable, '', 'con la columna N° DC y la celda vacía, el N° DC se limpia');
  // 4.3 filas rechazadas con motivo (y las buenas se importan).
  const libro43 = await libroXlsx(h.page, { COMPRAS: [
    ENC,
    fila('ok-1', 1121, nombre1121, base({ nroDocumento: '71', descripcion: 'fila buena' })),
    fila('r-concepto', 1121, nombre1121, base({ concepto: '__oculto__', nroDocumento: '72' })),
    fila('r-vacio', 1121, nombre1121, base({ concepto: '', nroDocumento: '73' })),
    fila('r-largo', 1121, nombre1121, base({ concepto: 'L'.repeat(1500), nroDocumento: '74' })),
    fila('__id_malo__', 1121, nombre1121, base({ nroDocumento: '75' })),
    fila('r-rbd', 'a/b', nombre1121, base({ nroDocumento: '76' })),
    fila('sin-fecha', 1121, nombre1121, base({ fechaDocumento: '', nroDocumento: '77' })),
    fila('sin-monto', 1121, nombre1121, base({ montoGasto: 0, nroDocumento: '78' })),
  ] });
  const msg43 = (await importarLibro(h, '#importExcelOFInput-figa', libro43)).join('\n');
  t.ok(/COMPRAS: 1 filas/.test(msg43), 'rechazos: solo la fila buena se importa (las filas sin fecha o sin monto se omiten sin aviso, como en las demás fuentes)', msg43);
  t.ok(/4 filas NO se importaron/.test(msg43) || /5 filas NO se importaron/.test(msg43), 'rechazos: el resumen cuenta las filas rechazadas', msg43);
  t.ok(/COMPRAS, fila 3: El concepto "__oculto__" no es válido/.test(msg43), 'rechazo de «__x__» con su motivo y su fila', msg43);
  t.ok(/COMPRAS, fila 4: El concepto no puede estar vacío/.test(msg43), 'rechazo de concepto vacío con motivo', msg43);
  t.ok(/COMPRAS, fila 5: El concepto es demasiado largo/.test(msg43), 'rechazo de concepto demasiado largo', msg43);
  t.ok(/COMPRAS, fila 6: El ID de la compra "__id_malo__" no es válido/.test(msg43), 'rechazo de ID inválido', msg43);
  t.ok(/COMPRAS, fila 7: El RBD "a\/b" no es válido/.test(msg43), 'rechazo de RBD inválido', msg43);
  const c43 = await comprasDe(h, '1121', 'figa');
  t.ok('ok-1' in c43 && !('r-concepto' in c43) && !('r-vacio' in c43) && !('__id_malo__' in c43) && !('sin-fecha' in c43) && !('sin-monto' in c43), 'rechazos: solo la fila buena quedó guardada');
  // 4.4 apóstrofo de fórmula en el archivo: se quita al importar.
  const libro44 = await libroXlsx(h.page, { COMPRAS: [ENC, fila('f-1', 1121, nombre1121, base({ concepto: "'=1+1", nroDocumento: '81', descripcion: "'@x" }))] });
  await importarLibro(h, '#importExcelOFInput-figa', libro44);
  const c44 = (await comprasDe(h, '1121', 'figa'))['f-1'];
  t.eq([c44.concepto, c44.descripcion], ['=1+1', '@x'], 'importar: el apóstrofo de neutralización se quita (ida y vuelta sin alterar el texto)');
  // 4.5 archivo ANTIGUO sin la hoja COMPRAS: no toca ni borra las compras guardadas.
  const nAntes = Object.keys(await comprasDe(h, '1121', 'figa')).length;
  const libroViejo = await libroXlsx(h.page, { INGRESO: [['RBD', 'Nombre', ...Array(12).fill('m'), 'Total Año'], [1121, nombre1121, ...Array(12).fill(1000), 12000]], BYS_ITEMS: [['RBD', 'Nombre', 'Concepto', ...Array(12).fill('m'), 'Total Año']] });
  const msgViejo = await importarLibro(h, '#importExcelOFInput-figa', libroViejo);
  t.ok(/^Carga importada correctamente/.test(msgViejo[0] || '') && !/COMPRAS/.test(msgViejo[0] || ''), 'archivo antiguo: se importa sin la hoja COMPRAS', msgViejo);
  t.eq(Object.keys(await comprasDe(h, '1121', 'figa')).length, nAntes, 'archivo antiguo: no borra ninguna compra');
  // 4.6 hoja COMPRAS de una fuente CON código de cuenta (columna «Codigo»): se rechaza entera.
  const libroCodigo = await libroXlsx(h.page, { COMPRAS: [ENC.map((e, i) => (i === 3 ? 'Codigo' : e)), fila('cod-1', 1121, nombre1121, base({ concepto: '410606', nroDocumento: '91' }))] });
  const msgCod = (await importarLibro(h, '#importExcelOFInput-figa', libroCodigo)).join('\n');
  t.ok(/código de cuenta SUPEREDUC/.test(msgCod) && /COMPRAS: 0 filas/.test(msgCod), 'una hoja COMPRAS con «Codigo» (de una fuente con cuenta) se rechaza entera con aviso', msgCod);
  t.ok(!('cod-1' in await comprasDe(h, '1121', 'figa')), 'y no crea conceptos con el número de cuenta');
  t.noErrores(h);
  await h.close();

  // ============================== 5. FILA: CSV de detalle, PDF, JSON de respaldo (sin CSV de SUPEREDUC) ==============================
  h = await boot({ fixture: 'compras_conceptos' });
  await clickTab(h.page, 'of-faep');
  t.eq(await h.page.evaluate(() => !!document.getElementById('downloadComprasOFBtn-faep')), false, 'FAEP no tiene botón «CSV de compras SUPEREDUC» (no es una subvención del sistema)');
  t.eq(await h.page.evaluate(() => document.querySelector('#otrasFuentesTbody-faep button.row-action-btn[data-action="csv"][data-rbd="1121"]').textContent.trim()), '⬇ CSV', 'el botón CSV por fila sigue siendo el CSV de detalle mensual');
  const csv = await capturarDescarga(h.page, () => h.page.click('#otrasFuentesTbody-faep button.row-action-btn[data-action="csv"][data-rbd="1121"]'));
  t.ok(/^detalle_faep_1121_/.test(csv.filename), 'el CSV por fila se llama detalle_faep_1121_…', csv.filename);
  const lineas = parseCsvPuntoYComa(csv.buffer.toString('utf8'));
  t.eq(lineas[0].slice(0, 2), ['Linea', 'Tipo'], 'CSV de detalle: mismo encabezado de siempre');
  const docCsv = lineas.filter(l => /^B&S documentado - /.test(l[0]));
  const dEsp = documentadoDe(docsBase, '1121', 'faep');
  t.eq(docCsv.map(l => l[0]).sort(), Object.keys(dEsp.conceptos).map(c => 'B&S documentado - ' + c).sort(), 'CSV de detalle: una línea «B&S documentado - <concepto>» por concepto documentado');
  t.ok(docCsv.every(l => l[1] === 'Real'), 'las líneas documentadas son siempre «Real»');
  t.eq(docCsv.map(l => [l[0], Number(l[14])]).sort(), Object.entries(dEsp.conceptos).map(([c, a]) => ['B&S documentado - ' + c, a.reduce((x, y) => x + y, 0)]).sort(), 'CSV de detalle: el total de cada línea documentada = cálculo independiente');
  t.ok(lineas.some(l => /^B&S - Alimentación/.test(l[0])), 'las líneas «sin documento» (B&S - <concepto>) siguen ahí');
  const eFaep = entidadDe(docsBase, '1121', 'faep');
  const lineaTot = lineas.find(l => l[0] === 'Gasto Total (Real+Proyectado)' || l[0] === 'Gasto Total (Real+Proyectado)'.replace('Total ', 'Total '));
  const gastoTotalCsv = lineas.find(l => /^Gasto Total/.test(l[0]) && /Total/.test(l[1]));
  t.eq(Number(gastoTotalCsv && gastoTotalCsv[14]), eFaep.total.gasto, 'CSV de detalle: el Gasto Total incluye lo documentado');
  t.ok(!csv.buffer.toString('utf8').includes('DC_701') && !csv.buffer.toString('utf8').includes('Colaciones'), 'el N° DC y los datos del documento NUNCA van en el CSV');
  // PDF por fila
  await h.page.evaluate(() => { window.__prints = []; });
  await h.page.click('#otrasFuentesTbody-faep button.row-action-btn[data-action="pdf"][data-rbd="1121"]');
  const pr = await h.prints();
  const wrap = pr[0] && pr[0].printWrap || '';
  t.ok(/Documentado \$1\.090\.000 · Sin documento \$28\.904\.570 · Total \$29\.994\.570/.test(wrap), 'PDF por fila: resumen «Documentado · Sin documento · Total»', wrap.slice(0, 600));
  t.ok(wrap.includes('Bienes y Servicios — documentado (compras, Real)') && wrap.includes('Bienes y Servicios — sin documento (por concepto)') && wrap.includes('Registro de compras'), 'PDF por fila: tablas «documentado», «sin documento» y «Registro de compras»');
  t.ok(/Concepto\nTipo doc\./.test(wrap) || wrap.includes('Concepto'), 'PDF por fila: el registro lleva la columna Concepto');
  t.ok(wrap.includes('DC_701') && wrap.includes('1001-FACEL') && wrap.includes('-$50.000'), 'PDF por fila: trae N° DC, Doc. original y la NC en negativo');
  t.ok(wrap.includes('Mobiliario administrativo'), 'PDF por fila: el concepto nuevo está en el registro');
  // JSON de respaldo
  const js = await capturarDescarga(h.page, () => h.page.click('#downloadCargaOFBtn-faep'));
  const out = JSON.parse(js.buffer.toString('utf8')).otras_fuentes_por_rbd;
  t.eq(Object.keys(out['1121'].compras).length, 8, 'JSON de respaldo: trae las 8 compras con concepto');
  t.eq(out['1121'].compras.fa1121_nc.montoGasto, -50000, 'JSON de respaldo: la NC con el signo normalizado');
  t.eq(out['1121'].bys_doc_items.map(i => i.concepto).sort(), Object.keys(dEsp.conceptos).sort(), 'JSON de respaldo: trae los totales documentados por concepto');
  t.noErrores(h);
  await h.close();
}, { modoBug: 'enforced' });
