// Honorarios (PR-3) · exportaciones e importación en las 9 fuentes (fixture `honorarios_fuentes`):
//   · Excel de respaldo: hojas HONORARIOS (una fila por boleta, con ID, tipo como CÓDIGO, N° DC; «Codigo» en las fuentes con cuenta y «Concepto» en JUNJI/FAEP/FIGA/Aportes) y HON_PROYECCION
//     (por cuenta con Item o por concepto), antes de META; neutralización de fórmulas SOLO en texto libre; exportar → importar → exportar idempotente (sin duplicar boletas);
//   · importación: ID usable actualiza esa boleta, ID vacío = clave determinista «imp-…» (reimportar no duplica), filas rechazadas con motivo (cuenta fuera del catálogo, tipo que no es de honorarios o que la
//     cuenta no acepta, concepto vacío o «__x__», monto ≤ 0, sin fecha, RBD inválido, entidad que no es de la fuente), una hoja con la columna equivocada (Codigo ↔ Concepto) se rechaza entera,
//     un archivo antiguo (sin las hojas) no borra nada y uno sin la columna N° DC no borra el que ya tenía la boleta;
//   · XLS por fila (solo esa entidad), CSV de detalle mensual (líneas «Honorarios …», SIN datos del prestador ni N° DC), CSV de compras SUPEREDUC sin honorarios, PDF por fila (sección de honorarios
//     sin marcas ⚠ ni campos) y JSON de respaldo (compatible: solo claves nuevas).
import { boot, clickTab } from '../lib/boot.mjs';
import { capturarDescarga, leerXlsx, parseCsvPuntoYComa } from '../lib/capture-utils.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { docsDe, clon } from '../lib/corte.mjs';
import { libroXlsx } from '../lib/compras.mjs';
import { FUENTES, FUENTES_CUENTA, FUENTES_CONCEPTO, esConcepto, honFuenteDe, entidadDe, boletaCuenta, boletaConcepto } from '../lib/honorarios_fuentes.mjs';

const ENC_C = ['ID', 'RBD', 'Nombre', 'Codigo', 'TipoDocumento', 'NroDocumento', 'FechaDocumento', 'FechaPago', 'Descripcion', 'RutProveedor', 'NombreProveedor', 'MontoGasto', 'MontoDocumento', 'N° DC'];
const ENC_K = ENC_C.map((e, i) => (i === 3 ? 'Concepto' : e));
const MES_T = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ENC_PC = ['RBD', 'Nombre', 'Codigo', 'Item', ...MES_T, 'Total Año'];
const ENC_PK = ['RBD', 'Nombre', 'Concepto', ...MES_T, 'Total Año'];
const TAB = Object.fromEntries(FUENTES.map(f => [f.key, 'of-' + f.key]));
const HOJAS = {
  general: ['INGRESO', 'ING_CARRERA_DOCENTE', 'REMUNERACIONES', 'COMPRAS', 'BYS_PROY_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'], pie: ['INGRESO', 'ING_CARRERA_DOCENTE', 'REMUNERACIONES', 'COMPRAS', 'BYS_PROY_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'],
  subt31_proyectos: ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'], asignacion_familiar: ['INGRESO', 'REMUNERACIONES', 'HONORARIOS', 'HON_PROYECCION', 'META'],
  recuperacion_llmm: ['ING_LLMM_ISAPRES', 'ING_LLMM_FONASA', 'ING_LLMM_SIL', 'META'], // fuente solo de ingresos: sin hojas de honorarios
  mantenimiento: ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_PROY_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'], prorretencion: ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_PROY_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'],
  junji: ['ING_OPERACION', 'ING_HOMOLOGACION', 'ING_CARRERA_DOCENTE', 'ING_BDL', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'],
  faep: ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'], figa: ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'],
  aporte_educ: ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'], aporte_junji: ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'],
};
const exportar = async (h, disparar) => { const dl = await capturarDescarga(h.page, disparar); return { ...dl, libro: await leerXlsx(h.page, dl.buffer) }; };
async function importar(h, inputSelector, dl) {
  const antes = h.dialogs.length;
  await h.page.setInputFiles(inputSelector, { name: dl.filename || 'carga.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: dl.buffer });
  for (let i = 0; i < 200 && h.dialogs.length === antes; i++) await h.page.waitForTimeout(50);
  await h.page.waitForTimeout(600);
  await h.flushWrites(); await h.waitIdle();
  return h.dialogs.slice(antes).map(d => d.message);
}
const importarArmado = async (h, key, hojas) => importar(h, `#importExcelOFInput-${key}`, { buffer: await libroXlsx(h.page, hojas) });
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
const honDeStore = async (h, rbd, fuente) => ((await h.store())[`sep_carga_rbd/${rbd}`].otras_fuentes[fuente] || {}).honorarios || {};
const proyDeStore = async (h, rbd, fuente) => ((await h.store())[`sep_carga_rbd/${rbd}`].otras_fuentes[fuente] || {}).hon_proyeccion_items || {};
const nBoletasDoc = (docs, key) => Object.keys(docs).filter(id => id !== '_meta').reduce((n, id) => n + Object.values((((docs[id].otras_fuentes || {})[key] || {}).honorarios) || {}).filter(x => x && typeof x === 'object').length, 0);

await correrSpec('honorarios_fuentes_excel', async (t) => {
  const docsBase = docsDe('honorarios_fuentes');

  // ============================== 1. EXPORTACIÓN: hojas HONORARIOS y HON_PROYECCION de cada fuente ==============================
  let h = await boot({ fixture: 'honorarios_fuentes' });
  const { page } = h;
  for (const f of FUENTES) {
    const k = f.key;
    await clickTab(page, TAB[k]);
    const x = await exportar(h, () => page.click(`#downloadExcelOFBtn-${k}`));
    t.eq(x.libro.orden, HOJAS[k], `${k}: el libro trae HONORARIOS y HON_PROYECCION antes de META${k === 'recuperacion_llmm' ? ' (Recuperación LLMM: no las trae)' : ''}`);
    if (k === 'recuperacion_llmm') continue;
    t.eq(x.libro.hojas.HONORARIOS[0], esConcepto(k) ? ENC_K : ENC_C, `${k}: encabezados de HONORARIOS (${esConcepto(k) ? '«Concepto»' : '«Codigo»'})`);
    t.eq(x.libro.hojas.HON_PROYECCION[0], esConcepto(k) ? ENC_PK : ENC_PC, `${k}: encabezados de HON_PROYECCION`);
    const n = nBoletasDoc(docsBase, k);
    t.eq(x.libro.hojas.HONORARIOS.length - 1, n, `${k}: una fila por boleta de todas las entidades (${n})`);
    const nProy = Object.keys(docsBase).filter(id => id !== '_meta').reduce((c, id) => c + Object.keys((((docsBase[id].otras_fuentes || {})[k] || {}).hon_proyeccion_items) || {}).length, 0);
    t.eq(x.libro.hojas.HON_PROYECCION.length - 1, nProy, `${k}: una fila por cuenta o concepto de la proyección (${nProy})`);
    // una fila con una sola celda de más no rompe: cada fila trae su ID y el tipo como código
    const filas = x.libro.hojas.HONORARIOS.slice(1);
    t.ok(filas.every(r => r[0] && ['BOLH', 'BHE', 'BOLHE', 'BPST', 'BPSTE', 'FAC'].includes(r[4])), `${k}: todas las filas con ID y el tipo de documento como CÓDIGO`);
  }
  // Contenido fila a fila (General con cuenta; JUNJI con concepto)
  await clickTab(page, 'General');
  const xg = await exportar(h, () => page.click('#downloadExcelOFBtn-general'));
  const fg = (id) => xg.libro.hojas.HONORARIOS.find(r => r[0] === id);
  t.eq(fg('gh1121_2'), ['gh1121_2', 1121, 'LICEO PULMAHUE DE LA LIGUA', '410304', 'BHE', '102', '2026-03-03', '2026-03-10', 'Apoyo administrativo', '12345678-5', 'Juan Pérez Soto', 250000, 250000, 'DC_801'], 'General: la boleta con todos sus campos (cuenta, tipo CÓDIGO, N°, fechas, prestador, bruto, N° DC)');
  t.eq([fg('gh1121_3')[11], fg('gh1121_3')[12]], [150000, 400000], 'General: el reparto (Monto Gasto 150.000 de un documento de 400.000)');
  t.eq(fg('gh_ac_1').slice(0, 4), ['gh_ac_1', 'AC', 'Administración Central', '410304'], 'General: la fila de AC lleva «AC» en la columna RBD');
  t.eq(fg('gh1121_invalida')[6], '10/03/2026', 'General: la fecha con formato no reconocido sale tal cual');
  const esp = fg('gh1121_especial');
  t.ok(esp[5] === 'A&B-<7>' && esp[8].includes('<b>Lego</b>') && esp[10] === 'Ñandú <Ltda> & "Co"' && esp[13] === "DC_<9> & 'Z'; \"Q\"", 'General: caracteres especiales (& < > " \') intactos');
  const pg = xg.libro.hojas.HON_PROYECCION.find(r => r[0] === 1121 && r[2] === '410803');
  t.eq([pg[3], pg[4], pg[11], pg[16]], ['410803 · TALLERES EXTRAPROGRAMÁTICOS', 50000, 100000, 50000 + 5 * 100000], 'General: HON_PROYECCION trae Codigo, Item (nombre de la cuenta), los 12 meses y el total');
  await clickTab(page, 'JUNJI');
  const xj = await exportar(h, () => page.click('#downloadExcelOFBtn-junji'));
  const fj = (id) => xj.libro.hojas.HONORARIOS.find(r => r[0] === id);
  t.eq(fj('jh5402002_3'), ['jh5402002_3', 5402002, xj.libro.hojas.HONORARIOS.find(r => r[0] === 'jh5402002_3')[2], 'Taller de música', 'BPST', '703', '2026-03-09', '2026-03-16', 'Taller de música', '11111111-1', 'Nombre Apellido Apellido', 120000, 120000, 'DC_901'], 'JUNJI: la boleta lleva el concepto en la columna 4 (y no una cuenta)');
  t.eq(fj('jh5402002_sinconcepto')[3], '', 'JUNJI: la boleta sin concepto sale con la celda vacía');
  const pj = xj.libro.hojas.HON_PROYECCION.find(r => r[0] === 5402002 && r[2] === 'Apoyo pedagógico');
  t.eq([pj[10], pj[15]], [200000, 1000000], 'JUNJI: HON_PROYECCION por concepto (agosto-diciembre 200.000, total 1.000.000)');
  t.noErrores(h);
  await h.close();

  // ============================== 2. NEUTRALIZACIÓN DE FÓRMULAS (solo texto libre) ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  await h.remoto('1121', `Object.assign(d.otras_fuentes.general.honorarios.gh1121_1, { descripcion: '+HYPERLINK("x")', nombreProveedor: '@SUMA(1)', documentoContable: '-DC9', nroDocumento: '=1+1', rutProveedor: '+11111111-1' });
    d.otras_fuentes.general.honorarios.gh1121_2.descripcion = '-1500';`);
  await h.remoto('5402002', `Object.assign(d.otras_fuentes.junji.honorarios.jh5402002_1, { concepto: '=CMD()', descripcion: '+X' }); d.otras_fuentes.junji.hon_proyeccion_items['Apoyo pedagógico'].concepto = 'Apoyo pedagógico';`);
  await h.waitIdle();
  await clickTab(h.page, 'General');
  const xn = await exportar(h, () => h.page.click('#downloadExcelOFBtn-general'));
  const r1 = xn.libro.hojas.HONORARIOS.find(r => r[0] === 'gh1121_1');
  t.eq([r1[8], r1[10], r1[13]], ["'+HYPERLINK(\"x\")", "'@SUMA(1)", "'-DC9"], 'Excel: apóstrofo inicial en descripción, prestador y N° DC que empiezan con = + - @');
  t.eq([r1[5], r1[9], r1[6], r1[11]], ['=1+1', '+11111111-1', '2026-01-14', 400000], 'Excel: NUNCA en N° de boleta, RUT, fechas ni montos');
  t.eq(xn.libro.hojas.HONORARIOS.find(r => r[0] === 'gh1121_2')[8], '-1500', 'Excel: un texto que es un número («-1500») no se toca');
  await clickTab(h.page, 'JUNJI');
  const xnj = await exportar(h, () => h.page.click('#downloadExcelOFBtn-junji'));
  t.eq(xnj.libro.hojas.HONORARIOS.find(r => r[0] === 'jh5402002_1')[3], "'=CMD()", 'Excel (concepto): el concepto de una boleta también se neutraliza');
  // reimportar restaura los textos
  await clickTab(h.page, 'General');
  await importar(h, '#importExcelOFInput-general', xn);
  const b1 = (await honDeStore(h, '1121', 'general')).gh1121_1;
  t.eq([b1.descripcion, b1.nombreProveedor, b1.documentoContable, b1.nroDocumento], ['+HYPERLINK("x")', '@SUMA(1)', '-DC9', '=1+1'], 'importar: se quita el apóstrofo y los textos quedan como estaban');
  t.noErrores(h);
  await h.close();

  // ============================== 3. IDA Y VUELTA con boletas válidas (las 9 fuentes) ==============================
  const limpios = clon(docsBase);
  const BORRAR = { general: ['gh1121_invalida', 'gh1121_cuenta_x', 'gh1121_tipo_fac', 'gh1121_tipo_np'], junji: ['jh5402002_sinconcepto', 'jh5402002_invalida', 'jh5402002_tipo_fac'] };
  // compras del fixture `compras_conceptos` que no sobreviven a una ida y vuelta (las mismas que quita compras_conceptos_excel): sin concepto y con fecha no válida
  ['fa1121_sinconcepto', 'fa1121_invalida'].forEach(id => { delete limpios['1121'].otras_fuentes.faep.compras[id]; });
  limpios['1121'].otras_fuentes.faep.compras.fa1121_nc.montoGasto = -50000; limpios['1121'].otras_fuentes.faep.compras.fa1121_nc.montoDocumento = -59500;
  Object.entries(BORRAR).forEach(([k, ids]) => Object.values(limpios).forEach(d => { const o = d.otras_fuentes && d.otras_fuentes[k]; if (o && o.honorarios) ids.forEach(i => { delete o.honorarios[i]; }); }));
  h = await boot({ fixture: limpios });
  for (const f of FUENTES) {
    const k = f.key;
    await clickTab(h.page, TAB[k]);
    const tAntes = await h.page.evaluate((key) => document.getElementById('tab-of-' + key).innerText, k);
    const sAntes = documentos(await h.store());
    const e1 = await exportar(h, () => h.page.click(`#downloadExcelOFBtn-${k}`));
    const m1 = await importar(h, `#importExcelOFInput-${k}`, e1);
    t.ok(/^Carga importada correctamente/.test(m1[0] || '') && (k === 'recuperacion_llmm' || (/HONORARIOS: \d+ filas/.test(m1[0] || '') && /HON_PROYECCION: \d+ filas/.test(m1[0] || ''))) && !/NO se import/.test(m1[0] || ''), `${k}: la importación informa éxito, lista HONORARIOS y HON_PROYECCION y no rechaza ninguna fila`, m1);
    t.eq(await h.page.evaluate((key) => document.getElementById('tab-of-' + key).innerText, k), tAntes, `${k}: la pestaña queda idéntica tras reimportar (los totales no cambian)`);
    const e2 = await exportar(h, () => h.page.click(`#downloadExcelOFBtn-${k}`));
    t.eq(igualLibros(e1.libro, e2.libro), null, `${k}: exportar → importar → exportar da exactamente las mismas hojas (HONORARIOS y HON_PROYECCION incluidas)`);
    t.eq(primeraDiferencia(sAntes, documentos(await h.store())), null, `${k}: los documentos del servidor quedan iguales (salvo ceros y auditoría)`);
    t.eq(nBoletasDoc(documentos(await h.store()), k), nBoletasDoc(sAntes, k), `${k}: no se duplican boletas al reimportar`);
  }
  // XLS por fila: solo esa entidad; se reimporta
  await clickTab(h.page, 'General');
  const sFila = documentos(await h.store());
  const f1 = await exportar(h, () => h.page.click('#otrasFuentesTbody-general button.row-action-btn[data-action="excel"][data-rbd="1121"]'));
  t.eq([...new Set(f1.libro.hojas.HONORARIOS.slice(1).map(r => r[1]))], [1121], 'XLS por fila (General 1121): HONORARIOS trae solo las boletas de esa entidad');
  t.eq(f1.libro.hojas.HONORARIOS.length - 1, 5, 'XLS por fila (General 1121): 5 boletas (las 9 del fixture menos las 4 que se quitaron)');
  t.eq(f1.libro.hojas.HON_PROYECCION.slice(1).map(r => r[2]).sort(), ['410304', '410803'], 'XLS por fila: HON_PROYECCION trae solo las cuentas de esa entidad');
  const mf = await importar(h, '#importExcelOFInput-general', f1);
  t.ok(/^Carga importada correctamente/.test(mf[0] || ''), 'XLS por fila: se reimporta', mf);
  t.eq(primeraDiferencia(sFila, documentos(await h.store())), null, 'XLS por fila: los documentos siguen iguales');
  const fAC = await exportar(h, () => h.page.click('#otrasFuentesTbody-general button.row-action-btn[data-action="excel"][data-rbd="AC"]'));
  t.eq([...new Set(fAC.libro.hojas.HONORARIOS.slice(1).map(r => r[1]))], ['AC'], 'XLS por fila (AC): sus boletas llevan «AC»');
  await clickTab(h.page, 'FAEP');
  const fJar = await exportar(h, () => h.page.click('#otrasFuentesTbody-faep button.row-action-btn[data-action="excel"][data-rbd="5402002"]'));
  t.eq(fJar.libro.hojas.HONORARIOS.length - 1, 1, 'XLS por fila (jardín 5402002 en FAEP): su boleta');
  t.noErrores(h);
  await h.close();

  // ============================== 4. IMPORTACIÓN con cuenta: General ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  await clickTab(h.page, 'General');
  const n1121 = 'LICEO PULMAHUE DE LA LIGUA';
  const fc = (id, rbd, nombre, b) => [id, rbd, nombre, b.codigo, b.tipoDocumento, b.nroDocumento, b.fechaDocumento, b.fechaPago, b.descripcion, b.rutProveedor, b.nombreProveedor, b.montoGasto, b.montoDocumento, b.documentoContable || ''];
  const base = (extra) => boletaCuenta({ codigo: '410803', ...extra });
  const antes1122 = Object.keys(await honDeStore(h, '1122', 'general')).length;
  const filas41 = [ENC_C, fc('', 1122, 'ESCUELA REPUBLICA DE VENEZUELA', base({ nroDocumento: '1', descripcion: 'sin id uno' })), fc(0, 1122, 'ESCUELA REPUBLICA DE VENEZUELA', base({ nroDocumento: '2', descripcion: 'id cero' })), fc('0', 1122, 'ESCUELA REPUBLICA DE VENEZUELA', base({ nroDocumento: '3', descripcion: 'id texto cero' })),
    fc('hon-id', 1122, 'ESCUELA REPUBLICA DE VENEZUELA', base({ nroDocumento: '4', montoGasto: 40000, montoDocumento: 40000, tipoDocumento: 'BHE', codigo: '410304' }))];
  const libro41 = await libroXlsx(h.page, { HONORARIOS: filas41 });
  const msg41 = await importar(h, '#importExcelOFInput-general', { buffer: libro41 });
  t.ok(/HONORARIOS: 4 filas/.test(msg41[0] || ''), 'importar: las 4 filas son válidas', msg41);
  const b41 = await honDeStore(h, '1122', 'general');
  t.eq(Object.keys(b41).length, antes1122 + 4, 'importar: 4 boletas nuevas (nada colapsa en la clave "0")');
  t.ok(!('0' in b41), 'importar: ninguna boleta queda bajo la clave "0"');
  t.eq(Object.keys(b41).filter(id => /^imp-/.test(id)).length, 3, 'importar: los 3 IDs vacío / 0 / "0" reciben una clave determinista «imp-…»');
  t.eq(b41['hon-id'].tipoDocumento, 'BHE', 'importar: la boleta con ID conserva el ID y guarda el tipo como código');
  t.ok(Object.values(b41).every(b => typeof b.codigo === 'string' && !('concepto' in b) && !('documentoOriginal' in b)), 'importar: las boletas llevan `codigo` y no `concepto` ni Doc. original');
  await importar(h, '#importExcelOFInput-general', { buffer: libro41 });
  t.eq(Object.keys(await honDeStore(h, '1122', 'general')).sort(), Object.keys(b41).sort(), 'reimportar el mismo archivo NO duplica ni cambia las claves (idempotente)');
  // ID real: actualiza esa boleta; N° DC
  const libro42 = await libroXlsx(h.page, { HONORARIOS: [ENC_C, fc('hon-id', 1122, 'x', { ...b41['hon-id'], montoGasto: 45000, montoDocumento: 45000, documentoContable: 'DC_800' })] });
  await importar(h, '#importExcelOFInput-general', { buffer: libro42 });
  let e42 = (await honDeStore(h, '1122', 'general'))['hon-id'];
  t.eq([e42.montoGasto, e42.documentoContable], [45000, 'DC_800'], 'importar con un ID existente ACTUALIZA esa boleta (y le pone el N° DC)');
  const libro42b = await libroXlsx(h.page, { HONORARIOS: [ENC_C.slice(0, 13), fc('hon-id', 1122, 'x', { ...e42, montoGasto: 46000 }).slice(0, 13)] });
  await importar(h, '#importExcelOFInput-general', { buffer: libro42b });
  e42 = (await honDeStore(h, '1122', 'general'))['hon-id'];
  t.eq([e42.montoGasto, e42.documentoContable], [46000, 'DC_800'], 'un archivo SIN la columna N° DC no borra el N° DC que ya tiene la boleta');
  await importar(h, '#importExcelOFInput-general', { buffer: await libroXlsx(h.page, { HONORARIOS: [ENC_C, fc('hon-id', 1122, 'x', { ...e42, documentoContable: '' })] }) });
  t.eq((await honDeStore(h, '1122', 'general'))['hon-id'].documentoContable, '', 'con la columna N° DC y la celda vacía, el N° DC se limpia');
  // rechazos con motivo
  const nBase = Object.keys(await honDeStore(h, '1122', 'general')).length;
  const libro43 = await libroXlsx(h.page, { HONORARIOS: [ENC_C,
    fc('ok-1', 1122, 'x', base({ nroDocumento: '71', descripcion: 'fila buena' })),
    fc('r-cuenta', 1122, 'x', base({ codigo: '999999', nroDocumento: '72' })),
    fc('r-tipo', 1122, 'x', base({ tipoDocumento: 'FAC', nroDocumento: '73' })),
    fc('r-tipo-np', 1122, 'x', base({ codigo: '410904', tipoDocumento: 'BHE', nroDocumento: '74' })),
    fc('r-monto', 1122, 'x', base({ montoGasto: -5, nroDocumento: '75' })),
    fc('r-fecha', 1122, 'x', base({ fechaDocumento: '', nroDocumento: '76' })),
    fc('__id_malo__', 1122, 'x', base({ nroDocumento: '77' })),
    fc('r-rbd', 'a/b', 'x', base({ nroDocumento: '78' })),
    fc('r-entidad', 5402002, 'x', base({ nroDocumento: '79' })),
  ] });
  const msg43 = (await importar(h, '#importExcelOFInput-general', { buffer: libro43 })).join('\n');
  t.ok(/HONORARIOS: 1 filas/.test(msg43), 'rechazos: solo la fila buena se importa', msg43);
  t.ok(/HONORARIOS, fila 3: la cuenta "999999" no acepta honorarios/.test(msg43), 'rechazo de cuenta fuera del catálogo, con su fila', msg43);
  t.ok(/HONORARIOS, fila 4: el tipo de documento "FAC" no es de honorarios/.test(msg43), 'rechazo de tipo que no es de honorarios', msg43);
  t.ok(/HONORARIOS, fila 5: la cuenta 410904 no acepta el tipo BHE/.test(msg43), 'rechazo de tipo que la cuenta no acepta', msg43);
  t.ok(/HONORARIOS, fila 6: el monto gasto debe ser mayor que 0/.test(msg43), 'rechazo de monto no positivo', msg43);
  t.ok(/HONORARIOS, fila 7: falta la fecha del documento/.test(msg43), 'rechazo de boleta sin fecha', msg43);
  t.ok(/HONORARIOS, fila 8: El ID de la boleta "__id_malo__" no es válido/.test(msg43), 'rechazo de ID inválido', msg43);
  t.ok(/HONORARIOS, fila 9: El RBD "a\/b" no es válido/.test(msg43), 'rechazo de RBD inválido', msg43);
  t.ok(/HONORARIOS, fila 10: la entidad "5402002" no es parte de Subvención General/.test(msg43), 'rechazo de entidad que no es de la fuente (un jardín en General)', msg43);
  const b43 = await honDeStore(h, '1122', 'general');
  t.eq(Object.keys(b43).length, nBase + 1, 'rechazos: solo la fila buena quedó guardada');
  t.ok(!(await h.store())['sep_carga_rbd/5402002'].otras_fuentes.general, 'rechazos: no se creó nada en una entidad que no es de la fuente');
  // cuenta no habilitada para la subvención: se importa igual y se avisa
  const libroNH = await libroXlsx(h.page, { HONORARIOS: [ENC_C, fc('nh-1', 'AC', 'Administración Central', base({ codigo: '410608', tipoDocumento: 'BPST', nroDocumento: '80' }))] });
  const msgNH = (await importar(h, '#importExcelOFInput-general', { buffer: libroNH })).join('\n');
  t.ok(/HONORARIOS: 1 filas \(⚠ 1 con cuenta no habilitada para Subvención General/.test(msgNH), 'una cuenta del catálogo no habilitada para la subvención se importa y se cuenta con ⚠', msgNH);
  // archivo antiguo sin las hojas: no toca ni borra
  const nAntes = Object.keys(await honDeStore(h, '1121', 'general')).length;
  const libroViejo = await libroXlsx(h.page, { INGRESO: [['RBD', 'Nombre', ...Array(12).fill('m'), 'Total Año'], [1121, n1121, ...Array(12).fill(1000), 12000]] });
  const msgViejo = await importar(h, '#importExcelOFInput-general', { buffer: libroViejo });
  t.ok(/^Carga importada correctamente/.test(msgViejo[0] || '') && !/HONORARIOS/.test(msgViejo[0] || ''), 'archivo antiguo: se importa sin las hojas de honorarios', msgViejo);
  t.eq([Object.keys(await honDeStore(h, '1121', 'general')).length, Object.keys(await proyDeStore(h, '1121', 'general')).length], [nAntes, 2], 'archivo antiguo: no borra ninguna boleta ni proyección');
  // hoja con la columna equivocada: se rechaza entera
  const libroConc = await libroXlsx(h.page, { HONORARIOS: [ENC_K, fc('c-1', 1122, 'x', { ...base({ nroDocumento: '90' }), codigo: 'Apoyo' })] });
  const msgConc = (await importar(h, '#importExcelOFInput-general', { buffer: libroConc })).join('\n');
  t.ok(/lleva «Codigo»/.test(msgConc) && /HONORARIOS: 0 filas/.test(msgConc), 'una hoja HONORARIOS con «Concepto» en una fuente con cuenta se rechaza entera con aviso', msgConc);
  t.ok(!('c-1' in await honDeStore(h, '1122', 'general')), 'y no crea boletas');
  // HON_PROYECCION
  const mesesV = (v) => Array(12).fill(v);
  const libroP = await libroXlsx(h.page, { HON_PROYECCION: [ENC_PC,
    [1122, 'x', '410803', 'x', ...mesesV(1000), 12000], [1122, 'x', '999999', 'x', ...mesesV(1), 12], [1122, 'x', '410910', 'x', ...mesesV(0).map((v, i) => (i > 7 ? 5000 : 0)), 20000], ['a/b', 'x', '410803', 'x', ...mesesV(1), 12], [5402002, 'x', '410803', 'x', ...mesesV(1), 12]] });
  const msgP = (await importar(h, '#importExcelOFInput-general', { buffer: libroP })).join('\n');
  t.ok(/HON_PROYECCION: 2 filas/.test(msgP) && /HON_PROYECCION, fila 3: la cuenta "999999" no acepta honorarios/.test(msgP) && /HON_PROYECCION, fila 5: El RBD "a\/b" no es válido/.test(msgP) && /HON_PROYECCION, fila 6: la entidad "5402002" no es parte de Subvención General/.test(msgP), 'HON_PROYECCION: 2 filas buenas y rechazos con motivo (cuenta, RBD, entidad)', msgP);
  const p1122 = await proyDeStore(h, '1122', 'general');
  t.eq([Object.keys(p1122).sort(), p1122['410803'].codigo, p1122['410803'].total, p1122['410910'].meses.DICIEMBRE], [['410304', '410803', '410910'], '410803', 12000, 5000], 'HON_PROYECCION: guarda codigo, meses y total por cuenta (sin tocar la proyección de 410304 que ya tenía)');
  t.noErrores(h);
  await h.close();

  // ============================== 5. IMPORTACIÓN por concepto: JUNJI ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  await clickTab(h.page, 'JUNJI');
  const fk = (id, rbd, nombre, b) => [id, rbd, nombre, b.concepto, b.tipoDocumento, b.nroDocumento, b.fechaDocumento, b.fechaPago, b.descripcion, b.rutProveedor, b.nombreProveedor, b.montoGasto, b.montoDocumento, b.documentoContable || ''];
  const bc = (extra) => boletaConcepto(extra);
  const libro51 = await libroXlsx(h.page, { HONORARIOS: [ENC_K,
    fk('', 5404003, 'MIS PRIMEROS PASOS', bc({ nroDocumento: '1' })), fk('nuevo', 5404003, 'x', bc({ nroDocumento: '2', concepto: 'Otro concepto' })),
    fk('r-vacio', 5404003, 'x', bc({ concepto: '', nroDocumento: '3' })), fk('r-oculto', 5404003, 'x', bc({ concepto: '__oculto__', nroDocumento: '4' })), fk('r-largo', 5404003, 'x', bc({ concepto: 'L'.repeat(1500), nroDocumento: '5' })),
    fk('r-tipo', 5404003, 'x', bc({ tipoDocumento: 'BOL', nroDocumento: '6' })), fk('r-entidad', 1121, 'x', bc({ nroDocumento: '7' })), fk('r-monto', 5404003, 'x', bc({ montoGasto: 0, nroDocumento: '8' }))] });
  const msg51 = (await importar(h, '#importExcelOFInput-junji', { buffer: libro51 })).join('\n');
  t.ok(/HONORARIOS: 2 filas/.test(msg51), 'JUNJI: las 2 filas buenas se importan', msg51);
  t.ok(/HONORARIOS, fila 4: falta el concepto/.test(msg51) && /HONORARIOS, fila 5: El concepto "__oculto__" no es válido/.test(msg51) && /HONORARIOS, fila 6: El concepto es demasiado largo/.test(msg51), 'JUNJI: rechazos de concepto vacío, «__x__» y demasiado largo', msg51);
  t.ok(/HONORARIOS, fila 7: el tipo de documento "BOL" no es de honorarios/.test(msg51) && /HONORARIOS, fila 8: la entidad "1121" no es parte de JUNJI/.test(msg51) && /HONORARIOS, fila 9: el monto gasto debe ser mayor que 0/.test(msg51), 'JUNJI: rechazos de tipo, entidad (un RBD en JUNJI) y monto', msg51);
  const b51 = await honDeStore(h, '5404003', 'junji');
  t.eq(Object.keys(b51).length, 2, 'JUNJI: solo 2 boletas guardadas');
  t.ok(Object.values(b51).every(b => typeof b.concepto === 'string' && !('codigo' in b)), 'JUNJI: las boletas guardadas llevan `concepto` y no `codigo`');
  const msgCod = (await importar(h, '#importExcelOFInput-junji', { buffer: await libroXlsx(h.page, { HONORARIOS: [ENC_C, fk('cod-1', 5404003, 'x', bc({ nroDocumento: '9' }))] }) })).join('\n');
  t.ok(/lleva «Concepto»/.test(msgCod) && /HONORARIOS: 0 filas/.test(msgCod), 'una hoja HONORARIOS con «Codigo» en una fuente por concepto se rechaza entera con aviso', msgCod);
  t.ok(!('cod-1' in await honDeStore(h, '5404003', 'junji')), 'y no crea boletas con el número de cuenta como concepto');
  const libroPK = await libroXlsx(h.page, { HON_PROYECCION: [ENC_PK, [5404003, 'x', 'Monitor', ...Array(12).fill(2000), 24000], [5404003, 'x', '__x__', ...Array(12).fill(1), 12], [1121, 'x', 'Monitor', ...Array(12).fill(1), 12], [5404003, 'x', '', ...Array(12).fill(1), 12]] });
  const msgPK = (await importar(h, '#importExcelOFInput-junji', { buffer: libroPK })).join('\n');
  t.ok(/HON_PROYECCION: 1 filas/.test(msgPK) && /HON_PROYECCION, fila 3: El concepto "__x__" no es válido/.test(msgPK) && /HON_PROYECCION, fila 4: la entidad "1121" no es parte de JUNJI/.test(msgPK), 'JUNJI HON_PROYECCION: 1 fila buena; rechaza «__x__» y una entidad que no es de la fuente (el concepto vacío se omite)', msgPK);
  const pK5404003 = await proyDeStore(h, '5404003', 'junji');
  t.eq([Object.keys(pK5404003), pK5404003.Monitor.concepto, pK5404003.Monitor.total], [['Monitor'], 'Monitor', 24000], 'JUNJI HON_PROYECCION: guarda concepto, meses y total');
  t.noErrores(h);
  await h.close();

  // ============================== 6. CSV de detalle, CSV SUPEREDUC, PDF por fila y JSON de respaldo ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  await clickTab(h.page, 'JUNJI');
  const csv = await capturarDescarga(h.page, () => h.page.click('#otrasFuentesTbody-junji button.row-action-btn[data-action="csv"][data-rbd="5402002"]'));
  const lineas = parseCsvPuntoYComa(csv.buffer.toString('utf8'));
  const hon = honFuenteDe(docsBase, '5402002', 'junji');
  const lb = lineas.filter(l => /^Honorarios boletas - /.test(l[0])), lp = lineas.filter(l => /^Honorarios proyeccion - /.test(l[0]));
  t.eq(lb.map(l => l[0]).sort(), Object.keys(hon.porClave).map(c => 'Honorarios boletas - ' + c).sort(), 'CSV de detalle: una línea «Honorarios boletas - <concepto>» por concepto con boletas');
  t.eq(lp.map(l => l[0]).sort(), Object.keys(hon.proyPorClave).map(c => 'Honorarios proyeccion - ' + c).sort(), 'CSV de detalle: una línea «Honorarios proyeccion - <concepto>» por concepto de la proyección');
  t.ok(lb.every(l => l[1] === 'Real') && lp.every(l => l[1] === 'Proyectado'), 'las boletas son siempre «Real» y la proyección «Proyectado»');
  t.eq(lb.map(l => [l[0], Number(l[14])]).sort(), Object.entries(hon.porClave).map(([c, a]) => ['Honorarios boletas - ' + c, a.reduce((x, y) => x + y, 0)]).sort(), 'CSV de detalle: el total de cada línea de boletas = cálculo independiente');
  const eJ = entidadDe(docsBase, '5402002', 'junji');
  const gastoTotalCsv = lineas.find(l => /^Gasto Total/.test(l[0]) && /Total/.test(l[1]));
  t.eq(Number(gastoTotalCsv && gastoTotalCsv[14]), eJ.total.gasto, 'CSV de detalle: el Gasto Total incluye los honorarios');
  const txtCsv = csv.buffer.toString('utf8');
  t.ok(!txtCsv.includes('DC_901') && !txtCsv.includes('11111111-1') && !txtCsv.includes('Nombre Apellido') && !txtCsv.includes('Taller de octubre'), 'el N° DC, el RUT, el nombre del prestador y la descripción NUNCA van en el CSV de detalle');
  // CSV SUPEREDUC de General: solo compras, sin las boletas de honorarios
  await clickTab(h.page, 'General');
  const csvG = await capturarDescarga(h.page, () => h.page.click('#otrasFuentesTbody-general button.row-action-btn[data-action="csv"][data-rbd="1121"]'));
  const txtG = csvG.buffer.toString('utf8');
  t.ok(!/gh1121_|Taller de ajedrez \(General\)|Apoyo administrativo/.test(txtG) && /Compra antigua con tipo de honorarios/.test(txtG), 'CSV SUPEREDUC de General: solo compras (la antigua con tipo de honorarios sigue saliendo, ya avisada); ninguna boleta del registro de honorarios');
  // PDF por fila
  await clickTab(h.page, 'JUNJI');
  await h.page.evaluate(() => { window.__prints = []; });
  await h.page.click('#otrasFuentesTbody-junji button.row-action-btn[data-action="pdf"][data-rbd="5402002"]');
  const pr = await h.prints();
  const wrap = pr[0] && pr[0].printWrap || '';
  t.ok(wrap.includes('Honorarios (Subt. 21) — boletas') && wrap.includes('Honorarios (Proyección) — por concepto') && wrap.includes('Registro de honorarios'), 'PDF por fila: filas de boletas y de proyección y registro de honorarios', wrap.slice(0, 400));
  t.ok(wrap.includes('Taller de música') && wrap.includes('DC_901') && wrap.includes('Apoyo pedagógico'), 'PDF por fila: trae los conceptos y el N° DC de las boletas');
  t.ok(!/⚠/.test(wrap.slice(wrap.indexOf('Registro de honorarios'))), 'PDF por fila: la tabla del registro de honorarios sin marcas ⚠ (solo en pantalla)');
  t.ok(!/\+ Agregar honorario|Cancelar edición|Elegir cuenta|Agregar concepto/.test(wrap), 'PDF por fila: sin formulario ni controles de edición');
  t.ok(/Gasto Honorarios \(Real\)/.test(wrap) && /Gasto Honorarios \(Proyectado\)/.test(wrap), 'PDF por fila: las tarjetas Real y Proyectado traen «Gasto Honorarios»');
  // JSON de respaldo
  const js = await capturarDescarga(h.page, () => h.page.click('#downloadCargaOFBtn-junji'));
  const out = JSON.parse(js.buffer.toString('utf8')).otras_fuentes_por_rbd;
  t.eq(Object.keys(out['5402002'].honorarios).length, 9, 'JSON de respaldo: trae las 9 boletas');
  t.eq(out['5402002'].honorarios.jh5402002_3.concepto, 'Taller de música', 'JSON de respaldo: la boleta con su concepto');
  t.eq(out['5402002'].hon_agregado.items.map(i => i.concepto).sort(), Object.keys(hon.porClave).sort(), 'JSON de respaldo: trae los totales por concepto de las boletas');
  t.eq(out['5402002'].hon_proy.items.map(i => i.concepto).sort(), Object.keys(hon.proyPorClave).sort(), 'JSON de respaldo: trae la proyección por concepto');
  t.eq(out['5402002'].rp.total.hon, eJ.total.hon, 'JSON de respaldo: el bloque Real/Proyectado/Total trae los honorarios');
  t.noErrores(h);
  await h.close();
}, { modoBug: 'enforced' });
