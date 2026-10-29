// fuentes_nuevas_excel (PR K) — Excel, CSV, PDF y respaldo de las fuentes agregadas a `main` sin pruebas (Subtítulo 31, Recuperación LLMM, Asignación Familiar) y del Ingreso Carrera Docente de General y PIE.
// Fixture `fondos_fijos`.
//
//   1. hojas de «⬇ Excel» de cada fuente (nombre, orden y filas) contra el cálculo independiente: `ING_CARRERA_DOCENTE` en General y PIE; `ING_LLMM_ISAPRES / _FONASA / _SIL` sin REMUNERACIONES ni honorarios en Recuperación LLMM;
//      Asignación Familiar sin COMPRAS ni B&S; la entidad AC fuera de Asignación Familiar
//   2. exportar → importar → exportar es idempotente (hojas idénticas y ningún dato cambia en el servidor)
//   3. editar el libro y reimportar: llega a la pantalla y al servidor (write de SOLO esa línea)
//   4. compatibilidad hacia atrás: un Excel anterior (General sin `ING_CARRERA_DOCENTE`, Subt. 31 sin honorarios) se importa sin tocar lo que no trae; las hojas que la fuente no lleva (REMUNERACIONES / HONORARIOS /
//      COMPRAS en Recuperación LLMM) se ignoran
//   5. filas de entidades FUERA del universo (AC en Asignación Familiar, un jardín en General sin Fondos Fijos, un id inexistente) se rechazan con aviso y no crean datos ni documentos
//   6. Excel / CSV de detalle / PDF por fila y JSON de respaldo
import { boot } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { docsDe, clon } from '../lib/corte.mjs';
import { capturarDescarga, leerXlsx, parseCsvPuntoYComa } from '../lib/capture-utils.mjs';
import { libroXlsx, importarLibro } from '../lib/compras.mjs';
import { entidadDe } from '../lib/honorarios_fuentes.mjs';
import { MESES, RBD_IDS, GESPARVU_IDS, fmt, clp } from '../lib/fondos_fijos.mjs';

const RUTA = (id) => `sep_carga_rbd/${id}`;
const num = (v) => { const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN); return Number.isFinite(n) ? n : 0; };
const exportar = async (h, key) => { await h.clickTab('of-' + key); const dl = await capturarDescarga(h.page, () => h.page.click(`#downloadExcelOFBtn-${key}`)); return { ...dl, libro: await leerXlsx(h.page, dl.buffer) }; };
const importar = async (h, key, hojas) => { await h.clickTab('of-' + key); const buf = await libroXlsx(h.page, hojas); return importarLibro(h, `#importExcelOFInput-${key}`, buf); };
const lineaDe = (docs, id, key, campo) => { const m = (((docs[id] || {}).otras_fuentes || {})[key] || {})[campo]; return MESES.map(mes => num(m && m.meses && m.meses[mes])); };
const filaHoja = (hoja, id) => (hoja || []).find(r => String(r[0]) === String(id));
const sinNombre = (hojas) => JSON.stringify(Object.fromEntries(Object.entries(hojas).map(([n, filas]) => [n, filas.map(f => f.slice(0, 1).concat(f.slice(2)))]))); // sin la columna Nombre
// Lo que hay guardado de la fuente en TODOS los documentos, sin los ceros y textos vacíos que una importación completa agrega (una hoja del libro trae todas las entidades del universo, con ceros): ruta → valor.
const IGNORAR = [/\/honorarios\/[^/]+\/fechaDocumento$/, /^sep_carga_rbd\/5402002\/ingreso\//]; // fecha dd/mm/aaaa → aaaa-mm-dd (PR-3) y el «ingreso» de General guardado fuera del universo de un jardín (la importación completa lo deja en 0)
const planos = (o, ruta = '', out = {}) => { if (o && typeof o === 'object') Object.entries(o).forEach(([k, v]) => planos(v, ruta + '/' + k, out)); else if (o !== 0 && o !== '' && o !== null && o !== undefined && !IGNORAR.some(r => r.test(ruta))) out[ruta] = o; return out; };
const otrasFuentesServidor = async (h, key) => { const st = await h.store(); return JSON.stringify(Object.fromEntries(Object.entries(st).filter(([k]) => k.startsWith('sep_carga_rbd/') && k !== 'sep_carga_rbd/_meta').flatMap(([k, d]) => Object.entries(planos((d.otras_fuentes || {})[key], k))).sort())); };
const rechazos = (txt) => String(txt).split('\n').filter(l => /^\s+· /.test(l) && !/^\s+· HONORARIOS, /.test(l)); // filas rechazadas, sin las boletas inválidas que trae a propósito el fixture de honorarios
const sinHonorarios = (hojas) => { const o = { ...hojas }; delete o.HONORARIOS; return o; }; // las boletas con fecha dd/mm/aaaa se normalizan a aaaa-mm-dd al reimportar (PR-3): lo cubre honorarios_fuentes_excel

await correrSpec('fuentes_nuevas_excel', async (t) => {
  const docs = docsDe('fondos_fijos');
  const h = await boot({ fixture: 'fondos_fijos' });
  const { page } = h;

  // ================================================================ 1. hojas del Excel de cada fuente
  const X = {};
  for (const key of ['subt31_proyectos', 'recuperacion_llmm', 'asignacion_familiar', 'general', 'pie']) X[key] = await exportar(h, key);
  t.eq(X.recuperacion_llmm.libro.orden, ['ING_LLMM_ISAPRES', 'ING_LLMM_FONASA', 'ING_LLMM_SIL', 'META'], '1) Recuperación LLMM: ING_LLMM_ISAPRES, ING_LLMM_FONASA, ING_LLMM_SIL y META (sin REMUNERACIONES, COMPRAS ni honorarios: es solo de ingresos)');
  t.eq(X.asignacion_familiar.libro.orden, ['INGRESO', 'REMUNERACIONES', 'HONORARIOS', 'HON_PROYECCION', 'META'], '1) Asignación Familiar: INGRESO, REMUNERACIONES, HONORARIOS, HON_PROYECCION y META (sin COMPRAS ni B&S)');
  t.eq(X.subt31_proyectos.libro.orden, ['INGRESO', 'REMUNERACIONES', 'COMPRAS', 'BYS_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'], '1) Subtítulo 31: como FAEP (con COMPRAS por concepto y BYS_ITEMS)');
  t.eq(X.general.libro.orden, ['INGRESO', 'ING_CARRERA_DOCENTE', 'REMUNERACIONES', 'COMPRAS', 'BYS_PROY_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'], '1) General: INGRESO + ING_CARRERA_DOCENTE antes de REMUNERACIONES');
  t.eq(X.pie.libro.orden, X.general.libro.orden, '1) PIE: las mismas hojas que General');
  t.ok(!X.general.libro.orden.some(n => /FONDO/i.test(n)) && !JSON.stringify(X.general.libro.hojas).includes('Fondos'), '1) General no exporta Fondos Fijos (se controlan aparte; lo registrado ya está en el B&S del panel, no en el libro de compras)');
  const cuenta = (hojas, n) => hojas[n].length - 1;
  t.eq([cuenta(X.subt31_proyectos.libro.hojas, 'INGRESO'), cuenta(X.recuperacion_llmm.libro.hojas, 'ING_LLMM_SIL'), cuenta(X.asignacion_familiar.libro.hojas, 'INGRESO'), cuenta(X.general.libro.hojas, 'ING_CARRERA_DOCENTE'), cuenta(X.pie.libro.hojas, 'ING_CARRERA_DOCENTE')],
    [69, 69, 68, 57, 56], '1) filas por hoja = universo de cada fuente: Subt. 31 69, Recuperación LLMM 69, Asignación Familiar 68 (sin AC), General 57 (con el jardín con Fondos Fijos) y PIE 56');
  t.ok(!filaHoja(X.asignacion_familiar.libro.hojas.INGRESO, 'AC') && !!filaHoja(X.recuperacion_llmm.libro.hojas.ING_LLMM_SIL, 'AC') && !!filaHoja(X.subt31_proyectos.libro.hojas.INGRESO, 'AC'), '1) AC no está en Asignación Familiar pero sí en Recuperación LLMM y Subt. 31');
  const malasHojas = [];
  const chequea = (key, hoja, campo, ids) => ids.forEach(id => { const f = filaHoja(X[key].libro.hojas[hoja], id); const e = lineaDe(docs, id, key, campo); if (!f || JSON.stringify(f.slice(2, 14).map(Number)) !== JSON.stringify(e) || Number(f[14]) !== e.reduce((a, b) => a + b, 0)) malasHojas.push(`${key}.${hoja}.${id}`); });
  chequea('recuperacion_llmm', 'ING_LLMM_ISAPRES', 'ingreso_llmm_isapres', [...RBD_IDS, 'AC', ...GESPARVU_IDS]);
  chequea('recuperacion_llmm', 'ING_LLMM_FONASA', 'ingreso_llmm_fonasa', [...RBD_IDS, 'AC', ...GESPARVU_IDS]);
  chequea('recuperacion_llmm', 'ING_LLMM_SIL', 'ingreso_llmm_sil', [...RBD_IDS, 'AC', ...GESPARVU_IDS]);
  chequea('asignacion_familiar', 'INGRESO', 'ingreso', [...RBD_IDS, ...GESPARVU_IDS]);
  chequea('asignacion_familiar', 'REMUNERACIONES', 'gasto_rem', [...RBD_IDS, ...GESPARVU_IDS]);
  chequea('subt31_proyectos', 'INGRESO', 'ingreso', [...RBD_IDS, 'AC', ...GESPARVU_IDS]);
  chequea('general', 'ING_CARRERA_DOCENTE', 'ingreso_carrera_docente', [...RBD_IDS, 'AC', '5402002']);
  chequea('general', 'INGRESO', 'ingreso', [...RBD_IDS, 'AC']);
  chequea('pie', 'ING_CARRERA_DOCENTE', 'ingreso_carrera_docente', [...RBD_IDS, 'AC']);
  t.eq(malasHojas, [], '1) cada fila de cada hoja de ingreso / remuneración = lo guardado (12 meses y Total Año)');
  t.eq(filaHoja(X.general.libro.hojas.ING_CARRERA_DOCENTE, '1121').slice(2, 15), [700000, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 700000], '1) General / 1121: Carrera Docente 700.000 en enero');
  t.eq(filaHoja(X.general.libro.hojas.INGRESO, '5402002').slice(2, 15), new Array(13).fill(0), '1) el jardín 5402002 (fila de General por sus Fondos Fijos) trae su fila con ingreso 0: el «ingreso» de 999.999 que su documento guarda fuera del universo de General no se lee');
  const meta = X.asignacion_familiar.libro.hojas.META;
  t.eq([meta.length - 1, filaHoja(meta, '1121')[2], filaHoja(meta, '5402002')[2]], [68, 7, 7], '1) META: «Real hasta» de cada entidad del universo (68 en Asignación Familiar)');
  t.eq((await h.writes()).length, 0, '1) exportar no escribe nada');

  // ================================================================ 2. exportar → importar → exportar: idempotente
  for (const key of ['recuperacion_llmm', 'asignacion_familiar', 'subt31_proyectos', 'general', 'pie']) {
    const antes = await otrasFuentesServidor(h, key);
    const msgs = await importar(h, key, X[key].libro.hojas);
    const alertas = msgs.filter(m => /Carga importada/.test(m));
    t.ok(alertas.length === 1 && rechazos(alertas[0]).length === 0, `2) ${key}: reimportar su propio Excel termina bien (ninguna fila rechazada, salvo las boletas inválidas a propósito del fixture de honorarios)`, rechazos(alertas[0]));
    const dos = await exportar(h, key);
    t.eq(JSON.stringify(sinHonorarios(dos.libro.hojas)), JSON.stringify(sinHonorarios(X[key].libro.hojas)), `2) ${key}: exportar → importar → exportar da hojas idénticas`);
    t.eq(await otrasFuentesServidor(h, key), antes, `2) ${key}: ningún dato cambió en el servidor`);
  }

  // ================================================================ 3. editar el libro y reimportar
  const ed = clon(X.recuperacion_llmm.libro.hojas);
  filaHoja(ed.ING_LLMM_SIL, '1121')[2] = 12345; filaHoja(ed.ING_LLMM_SIL, '1121')[14] = 12345 + 20000;
  filaHoja(ed.ING_LLMM_FONASA, '5402002')[4] = 6500;
  await h.clearWrites();
  const msgs3 = await importar(h, 'recuperacion_llmm', ed);
  t.ok(/ING_LLMM_SIL: 69 filas/.test(msgs3.join('\n')) && /ING_LLMM_ISAPRES: 69 filas/.test(msgs3.join('\n')), '3) Recuperación LLMM: el resumen cuenta las 69 filas de cada una de las 3 hojas', msgs3.join('\n'));
  let st = await h.store();
  t.eq([st[RUTA('1121')].otras_fuentes.recuperacion_llmm.ingreso_llmm_sil.meses.ENERO, st[RUTA('5402002')].otras_fuentes.recuperacion_llmm.ingreso_llmm_fonasa.meses.MARZO], [12345, 6500], '3) los montos editados llegan al servidor');
  const ws1121 = (await h.writes()).filter(w => w.path === RUTA('1121') && w.payload.otras_fuentes);
  t.ok(ws1121.length >= 1 && ws1121.every(w => Object.keys(w.payload.otras_fuentes).join() === 'recuperacion_llmm'), '3) y los writes de 1121 tocan SOLO `otras_fuentes.recuperacion_llmm` (Asignación Familiar, honorarios y demás fuentes del documento quedan intactos)');
  await h.clickTab('of-recuperacion_llmm');
  const tabla = await page.evaluate(() => { const tr = document.querySelector('#otrasFuentesTbody-recuperacion_llmm tr[data-rbd="1121"]'); return tr.children[3].textContent.trim(); });
  t.eq(clp(tabla), 40000 + 30000 + 20000 + 12345, '3) la pantalla muestra el ingreso nuevo de 1121 (40.000 + 30.000 + 20.000 + 12.345 = 102.345)');
  const edG = clon(X.general.libro.hojas);
  filaHoja(edG.ING_CARRERA_DOCENTE, '1122')[7] = 77000; filaHoja(edG.ING_CARRERA_DOCENTE, '1122')[14] = 300000 + 77000;
  await importar(h, 'general', edG);
  st = await h.store();
  t.eq(st[RUTA('1122')].otras_fuentes.general.ingreso_carrera_docente.meses.JUNIO, 77000, '3) General: la hoja ING_CARRERA_DOCENTE editada llega al servidor');
  t.eq(num(((st[RUTA('1122')].otras_fuentes.general.ingreso || {}).meses || {}).ENERO), lineaDe(docs, '1122', 'general', 'ingreso')[0], '3) y no toca `ingreso`');
  const edA = clon(X.asignacion_familiar.libro.hojas);
  filaHoja(edA.INGRESO, '1122')[3] = 55000; filaHoja(edA.REMUNERACIONES, '5402002')[2] = 9000;
  await importar(h, 'asignacion_familiar', edA);
  st = await h.store();
  t.eq([st[RUTA('1122')].otras_fuentes.asignacion_familiar.ingreso.meses.FEBRERO, st[RUTA('5402002')].otras_fuentes.asignacion_familiar.gasto_rem.meses.ENERO], [55000, 9000], '3) Asignación Familiar: INGRESO y REMUNERACIONES editados llegan al servidor (también para un jardín)');
  await h.clickTab('of-asignacion_familiar');
  const af1122 = await page.evaluate(() => { const tr = document.querySelector('#otrasFuentesTbody-asignacion_familiar tr[data-rbd="1122"]'); return Array.from(tr.children).map(td => td.textContent.trim()); });
  t.eq(clp(af1122[3]), 400000 + 55000, '3) y la pantalla de Asignación Familiar lo refleja');

  // ================================================================ 4. compatibilidad hacia atrás
  const docs4 = (await h.store());
  const cdAntes = JSON.stringify(docs4[RUTA('1121')].otras_fuentes.general.ingreso_carrera_docente);
  const viejoG = clon(X.general.libro.hojas); delete viejoG.ING_CARRERA_DOCENTE; delete viejoG.HONORARIOS; delete viejoG.HON_PROYECCION;
  filaHoja(viejoG.INGRESO, '1123')[2] = 3030;
  const msgs4 = await importar(h, 'general', viejoG);
  t.ok(/Carga importada/.test(msgs4.join('')) && !/NO se importaron/.test(msgs4.join('')), '4) un Excel de General anterior a Carrera Docente (sin ING_CARRERA_DOCENTE ni honorarios) se importa sin filas rechazadas', msgs4.join(' | ').slice(0, 300));
  st = await h.store();
  t.eq(JSON.stringify(st[RUTA('1121')].otras_fuentes.general.ingreso_carrera_docente), cdAntes, '4) el Ingreso Carrera Docente guardado NO se borra ni se pone en 0');
  t.eq(st[RUTA('1123')].otras_fuentes.general.ingreso.meses.ENERO, 3030, '4) y lo que sí trae el archivo se importa (ingreso de 1123)');
  t.eq(Object.keys(st[RUTA('1121')].otras_fuentes.general.honorarios).length, 9, '4) y las boletas de honorarios guardadas siguen (un Excel sin la hoja HONORARIOS no borra nada)');
  // Recuperación LLMM: hojas que la fuente no lleva se ignoran
  const conBasura = clon((await exportar(h, 'recuperacion_llmm')).libro.hojas); // el libro actual (con lo editado en el punto 3)
  conBasura.REMUNERACIONES = [['RBD', 'Nombre', 'Enero'], [1121, 'X', 999999]];
  conBasura.HONORARIOS = [['ID', 'RBD', 'Nombre', 'Concepto'], ['zz', 1121, 'X', 'Reemplazo']];
  conBasura.COMPRAS = [['ID', 'RBD', 'Nombre', 'Concepto'], ['zz', 1121, 'X', 'Reemplazo']];
  const antesL = JSON.stringify(planos((await h.store())[RUTA('1121')].otras_fuentes.recuperacion_llmm));
  const msgs4b = await importar(h, 'recuperacion_llmm', conBasura);
  t.ok(!/REMUNERACIONES|HONORARIOS|COMPRAS/.test(msgs4b.join('')), '4) Recuperación LLMM ignora las hojas REMUNERACIONES / HONORARIOS / COMPRAS (ni siquiera las menciona en el resumen)', msgs4b.join(' | ').slice(0, 300));
  const despuesL = (await h.store())[RUTA('1121')].otras_fuentes.recuperacion_llmm;
  t.eq(JSON.stringify(planos(despuesL)), antesL, '4) y no crea `gasto_rem`, `compras` ni `honorarios` en su documento (ni cambia la boleta guardada)');
  t.ok(!despuesL.gasto_rem && !despuesL.compras && JSON.stringify(despuesL.honorarios) === JSON.stringify(docs['1121'].otras_fuentes.recuperacion_llmm.honorarios), '4) (sin gasto_rem ni compras, y la boleta guardada intacta)');
  // Asignación Familiar: COMPRAS / BYS ignoradas
  const afBasura = clon(X.asignacion_familiar.libro.hojas);
  afBasura.COMPRAS = [['ID', 'RBD', 'Nombre', 'Concepto', 'TipoDocumento', 'NroDocumento', 'FechaDocumento', 'FechaPago', 'Descripcion', 'RutProveedor', 'NombreProveedor', 'MontoGasto'], ['zz', 1121, 'X', 'Reemplazo', 'Boleta', '1', '2026-03-01', '2026-03-02', 'd', '1-9', 'n', 5000]];
  afBasura.BYS_ITEMS = [['RBD', 'Nombre', 'Concepto', 'Enero'], [1121, 'X', 'Cosas', 7000]];
  await h.clearWrites();
  const msgs4c = await importar(h, 'asignacion_familiar', afBasura);
  t.ok(!/COMPRAS|BYS/.test(msgs4c.join('')), '4) Asignación Familiar (sin B&S) ignora COMPRAS y BYS_ITEMS', msgs4c.join(' | ').slice(0, 300));
  st = await h.store();
  t.ok(!(st[RUTA('1121')].otras_fuentes.asignacion_familiar.compras) && !(st[RUTA('1121')].otras_fuentes.asignacion_familiar.bys_items), '4) y no crea compras ni B&S');
  // Subt. 31 antiguo: sin honorarios
  const viejoS = clon(X.subt31_proyectos.libro.hojas); delete viejoS.HONORARIOS; delete viejoS.HON_PROYECCION;
  const honAntes = JSON.stringify((await h.store())[RUTA('1121')].otras_fuentes.subt31_proyectos.honorarios);
  await importar(h, 'subt31_proyectos', viejoS);
  t.eq(JSON.stringify((await h.store())[RUTA('1121')].otras_fuentes.subt31_proyectos.honorarios), honAntes, '4) Subt. 31 sin las hojas de honorarios: las boletas guardadas quedan');

  // ================================================================ 5. entidades fuera del universo
  const fuera = clon(X.asignacion_familiar.libro.hojas);
  fuera.INGRESO.push(['AC', 'ADMINISTRACION CENTRAL', 111, ...new Array(11).fill(0), 111]);
  fuera.INGRESO.push(['9999', 'NO EXISTE', 222, ...new Array(11).fill(0), 222]);
  fuera.META.push(['AC', 'ADMINISTRACION CENTRAL', 3]);
  fuera.REMUNERACIONES.push(['AC', 'ADMINISTRACION CENTRAL', 5, ...new Array(11).fill(0), 5]);
  await h.clearWrites();
  const msgs5 = await importar(h, 'asignacion_familiar', fuera);
  const m5 = msgs5.join('\n');
  t.ok(/⚠ 4 filas NO se importaron/.test(m5) && /la entidad "AC" no es parte de Asignación Familiar/.test(m5) && /la entidad "9999" no es parte de Asignación Familiar/.test(m5), '5) Asignación Familiar: las filas de AC (INGRESO, REMUNERACIONES y META) y de un id inexistente se rechazan con aviso «la entidad "AC" no es parte de Asignación Familiar»', m5);
  st = await h.store();
  t.ok(!st[RUTA('9999')], '5) y no se crea ningún documento para el id inexistente');
  t.eq(JSON.stringify((st[RUTA('AC')].otras_fuentes || {}).asignacion_familiar), JSON.stringify(docs['AC'].otras_fuentes.asignacion_familiar), '5) ni se escribe nada en AC (que no es entidad de Asignación Familiar; su documento conserva solo lo que ya traía)');
  t.eq((await h.writes()).filter(w => w.path === RUTA('AC')).length, 0, '5) 0 writes a AC');
  const fueraG = clon(X.general.libro.hojas);
  fueraG.INGRESO.push(['5401006', 'EL CARMEN CUNCUNITA', 4444, ...new Array(11).fill(0), 4444]);
  const msgs5b = await importar(h, 'general', fueraG);
  t.ok(/la entidad "5401006" no es parte de Subvención General/.test(msgs5b.join('\n')), '5) General: un jardín SIN Fondos Fijos registrados en General (5401006) no es parte de General: su fila se rechaza', msgs5b.join('\n').slice(0, 400));
  t.ok(!((await h.store())[RUTA('5401006')].otras_fuentes || {}).general, '5) y no se le crea `general`');
  const dentroG = clon(X.general.libro.hojas);
  filaHoja(dentroG.ING_CARRERA_DOCENTE, '5402002')[2] = 0;
  const msgs5c = await importar(h, 'general', dentroG);
  t.ok(rechazos(msgs5c.join('\n')).length === 0, '5) en cambio el jardín 5402002 (con Fondos Fijos registrados) sí es parte de General: su fila se importa sin rechazos', rechazos(msgs5c.join('\n')));
  const libroL5 = (await exportar(h, 'recuperacion_llmm')).libro; // el libro actual (con lo editado en el punto 3)
  const msgs5d = await importar(h, 'recuperacion_llmm', (() => { const x = clon(libroL5.hojas); filaHoja(x.ING_LLMM_ISAPRES, 'AC')[2] = 26000; filaHoja(x.ING_LLMM_ISAPRES, 'AC')[14] = 26000; return x; })());
  t.ok(rechazos(msgs5d.join('\n')).length === 0 && (await h.store())[RUTA('AC')].otras_fuentes.recuperacion_llmm.ingreso_llmm_isapres.meses.ENERO === 26000, '5) Recuperación LLMM sí incluye a AC: su fila se importa');

  // ================================================================ 6. por fila: Excel, CSV de detalle, PDF; y JSON de respaldo
  const dlFila = (key, id, accion) => capturarDescarga(page, () => page.click(`#otrasFuentesTbody-${key} button.row-action-btn[data-action="${accion}"][data-rbd="${id}"]`));
  await h.clickTab('of-recuperacion_llmm');
  const xl = await leerXlsx(page, (await dlFila('recuperacion_llmm', '5402002', 'excel')).buffer);
  t.eq(xl.orden, ['ING_LLMM_ISAPRES', 'ING_LLMM_FONASA', 'ING_LLMM_SIL', 'META'], '6) XLS de una fila de Recuperación LLMM: las mismas hojas');
  t.eq([xl.hojas.ING_LLMM_FONASA.length, xl.hojas.ING_LLMM_FONASA[1][0], xl.hojas.ING_LLMM_FONASA[1][4]], [2, 5402002, 6500], '6) con solo esa entidad (encabezado + una fila) y sus montos');
  // CSV de detalle (fuentes sin SUPEREDUC)
  const csvL = parseCsvPuntoYComa((await dlFila('recuperacion_llmm', '1121', 'csv')).buffer.toString('utf8'));
  t.eq(csvL.map(r => r[0]).slice(1, 4), ['Recuperación LLMM Isapres', 'Recuperación LLMM FONASA', 'Recuperación LLMM SIL'], '6) CSV de detalle de Recuperación LLMM: las tres líneas de ingreso (sin «Gasto Remuneraciones» ni líneas de gasto)');
  t.ok(!csvL.some(r => /Remuneraciones|Honorarios|B&S/.test(r[0])), '6) sin líneas de remuneraciones, honorarios ni B&S');
  const eL = entidadDe(await (async () => { const o = clon(docs); Object.assign(o['1121'].otras_fuentes.recuperacion_llmm.ingreso_llmm_sil, { meses: { ...o['1121'].otras_fuentes.recuperacion_llmm.ingreso_llmm_sil.meses, ENERO: 12345 } }); return o; })(), '1121', 'recuperacion_llmm');
  t.eq(Number(csvL.find(r => r[0] === 'Ingreso Total (Real+Proyectado)').slice(-1)[0]), eL.total.ingreso, '6) y «Ingreso Total» = cálculo independiente');
  await h.clickTab('of-asignacion_familiar');
  const csvA = parseCsvPuntoYComa((await dlFila('asignacion_familiar', '1121', 'csv')).buffer.toString('utf8'));
  const eA = entidadDe(docs, '1121', 'asignacion_familiar');
  t.eq(csvA.map(r => r[0]).slice(1, 5), ['Ingreso', 'Gasto Remuneraciones', 'Honorarios boletas - Reemplazo', 'Honorarios proyeccion - Reemplazo'], '6) CSV de detalle de Asignación Familiar: Ingreso, Remuneraciones y honorarios (sin B&S)');
  t.eq([Number(csvA.find(r => r[0] === 'Gasto Total (Real+Proyectado)').slice(-1)[0]), Number(csvA.find(r => r[0] === 'Saldo Total (Real+Proyectado)').slice(-1)[0]), csvA.find(r => r[0] === 'Estado (Total)').slice(-1)[0]], [eA.total.gasto, eA.total.saldo, 'Déficit'], '6) con Gasto Total, Saldo y Estado del cálculo independiente (Déficit por honorarios)');
  await h.clickTab('of-subt31_proyectos');
  const csvS = parseCsvPuntoYComa((await dlFila('subt31_proyectos', '1121', 'csv')).buffer.toString('utf8'));
  const eS = entidadDe(docs, '1121', 'subt31_proyectos');
  t.ok(csvS.some(r => r[0] === 'B&S - Obras menores') && csvS.some(r => r[0] === 'Honorarios boletas - Talleres técnicos'), '6) CSV de detalle de Subt. 31: B&S y honorarios por concepto');
  t.eq(Number(csvS.find(r => r[0] === 'Gasto Total (Real+Proyectado)').slice(-1)[0]), eS.total.gasto, '6) y el Gasto Total del cálculo independiente');
  // PDF
  for (const [key, id, textos] of [['recuperacion_llmm', '1121', ['Recuperación Licencias Médicas', 'Recuperación LLMM Isapres', 'Recuperación LLMM FONASA', 'Recuperación LLMM SIL', 'Sin gastos asociados', fmt(102345)]],
    ['asignacion_familiar', '1121', ['Asignación Familiar', 'Ingreso Percibido', 'Gasto Remuneraciones', 'Gasto Honorarios', fmt(900000), fmt(1060000)]],
    ['subt31_proyectos', '1121', ['Subtítulo 31 (Proyectos)', 'Gasto Bienes y Servicios', 'Registro de compras', fmt(2000000)]],
    ['general', '1121', ['Subvención General', 'Ingreso Carrera Docente', fmt(700000), 'Fondos Fijos rendidos']],
    ['pie', '1121', ['PIE', 'Ingreso Carrera Docente', fmt(300000)]]]) {
    await h.clickTab('of-' + key);
    await page.click(`#otrasFuentesTbody-${key} button.row-action-btn[data-action="pdf"][data-rbd="${id}"]`);
    await h.waitIdle();
    const pr = (await h.prints()).slice(-1)[0];
    const faltan = textos.filter(x => !pr.printWrap.includes(x));
    t.eq(faltan, [], `6) PDF de ${key} / ${id}: trae ${textos.slice(0, 3).join(', ')}…`);
    if (key === 'recuperacion_llmm') t.ok(!/Gasto Remuneraciones|Honorarios|Registro de compras/.test(pr.printWrap), '6) PDF de Recuperación LLMM: sin Remuneraciones, honorarios ni compras');
    if (key === 'asignacion_familiar') t.ok(!/Gasto Bienes y Servicios|Registro de compras|compras/i.test(pr.printWrap), '6) PDF de Asignación Familiar: sin la tarjeta «Gasto Bienes y Servicios» ni registro de compras', pr.printWrap.match(/.{30}Bienes y Servicios.{30}/));
  }
  // JSON de respaldo
  for (const [key, claves] of [['recuperacion_llmm', ['ingreso_llmm_isapres', 'ingreso_llmm_fonasa', 'ingreso_llmm_sil']], ['general', ['ingreso', 'ingreso_carrera_docente']], ['pie', ['ingreso', 'ingreso_carrera_docente']], ['asignacion_familiar', ['ingreso', 'gasto_rem']], ['subt31_proyectos', ['ingreso', 'gasto_rem', 'bys_items']]]) {
    await h.clickTab('of-' + key);
    const js = JSON.parse((await capturarDescarga(page, () => page.click(`#downloadCargaOFBtn-${key}`))).buffer.toString('utf8'));
    t.ok(js.fuente === key && claves.every(c => js.otras_fuentes_por_rbd['1121'] && js.otras_fuentes_por_rbd['1121'][c] !== undefined), `6) respaldo JSON de ${key}: trae ${claves.join(', ')}`, Object.keys(js.otras_fuentes_por_rbd['1121'] || {}));
  }
  const jl = JSON.parse((await capturarDescarga(page, async () => { await h.clickTab('of-recuperacion_llmm'); await page.click('#downloadCargaOFBtn-recuperacion_llmm'); })).buffer.toString('utf8'));
  t.eq(jl.otras_fuentes_por_rbd['1121'].ingreso_llmm_sil.meses.ENERO, 12345, '6) el respaldo de Recuperación LLMM refleja lo importado');
  t.noErrores(h);
  await h.close();
});
