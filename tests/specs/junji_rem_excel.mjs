// JUNJI · Excel con el Gasto de Remuneraciones en 4 líneas y el renombre «Ingreso Carrera Docente Parvularia». Fixture `junji_rem`.
// Exportar: hojas ING_OPERACION, ING_HOMOLOGACION, ING_CARRERA_DOCENTE_PARVULARIA (nombre nuevo), ING_BDL, REM_OPERACION, REM_HOMOLOGACION, REM_CARRERA_DOCENTE_PARVULARIA, REM_BDL (ya no hay REMUNERACIONES).
// Importar: exportar → importar → exportar es idempotente; un Excel ANTERIOR (hoja REMUNERACIONES y ING_CARRERA_DOCENTE) se importa igual: REMUNERACIONES → línea Operación (solo ese campo, las otras 3 líneas no se
// tocan) e ING_CARRERA_DOCENTE → Ingreso Carrera Docente Parvularia; si vienen las hojas nuevas, mandan. El Excel de General / PIE conserva ING_CARRERA_DOCENTE y REMUNERACIONES.
// Debe FALLAR contra APP_HTML=@217e33a.
import { boot, clickTab, cargarFixture } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { capturarDescarga, leerXlsx } from '../lib/capture-utils.mjs';
import { GESPARVU_IDS, MESES } from '../lib/corte.mjs';
import { LINEAS, remLineasDe, sumaMeses } from '../lib/junji_rem.mjs';
import { libroXlsx, importarLibro } from '../lib/compras.mjs';

const RUTA = (id) => `sep_carga_rbd/${id}`;
const ofJ = (docs, id) => (docs[id] && docs[id].otras_fuentes && docs[id].otras_fuentes.junji) || {};
async function exportar(page, disparar) {
  const dl = await capturarDescarga(page, disparar);
  return { ...dl, libro: await leerXlsx(page, dl.buffer) };
}
const copia = (x) => { const o = {}; x.libro.orden.forEach(n => { o[n] = x.libro.hojas[n].map(r => r.slice()); }); return o; };

await correrSpec('junji_rem_excel', async (t) => {
  const docs = cargarFixture('junji_rem').docs;
  const h = await boot({ fixture: 'junji_rem', user: 'authorized' });
  const { page } = h;
  await clickTab(page, 'junji');

  // ---------------------------------------------------------------- 1) exportar
  const x1 = await exportar(page, () => page.click('#downloadExcelOFBtn-junji'));
  t.eq(x1.libro.orden, ['ING_OPERACION', 'ING_HOMOLOGACION', 'ING_CARRERA_DOCENTE_PARVULARIA', 'ING_BDL', ...LINEAS.map(l => l.hoja), 'COMPRAS', 'BYS_ITEMS', 'HONORARIOS', 'HON_PROYECCION', 'META'], 'Excel de JUNJI: 4 hojas de ingreso (la tercera «ING_CARRERA_DOCENTE_PARVULARIA»), 4 de Remuneraciones (REM_*), y ya no hay REMUNERACIONES');
  t.ok(!x1.libro.hojas.REMUNERACIONES && !x1.libro.hojas.ING_CARRERA_DOCENTE, 'no quedan las hojas REMUNERACIONES ni ING_CARRERA_DOCENTE en el Excel de JUNJI');
  for (const l of LINEAS) {
    const hoja = x1.libro.hojas[l.hoja];
    t.eq(hoja[0].slice(0, 3), ['RBD', 'Nombre', 'Enero'], `${l.hoja}: mismas columnas que las hojas de ingreso`);
    t.eq(hoja.slice(1).map(f => String(f[0])), GESPARVU_IDS, `${l.hoja}: una fila por jardín (13), en el orden de JUNJI`);
    const mal = hoja.slice(1).filter(f => {
      const rem = remLineasDe(ofJ(docs, String(f[0])))[l.key];
      return JSON.stringify(f.slice(2, 14)) !== JSON.stringify(MESES.map(m => Math.round(rem.meses[m]))) || f[14] !== Math.round(sumaMeses(rem));
    }).map(f => String(f[0]));
    t.eq(mal, [], `${l.hoja}: los 12 meses y el total de cada jardín = oráculo (el antiguo \`gasto_rem\` aparece en Operación, mes a mes)`);
  }

  // ---------------------------------------------------------------- 2) exportar → importar → exportar: idéntico
  let msg = await importarLibro(h, '#importExcelOFInput-junji', x1.buffer, 'junji.xlsx');
  t.ok(LINEAS.every(l => msg[0].includes(l.hoja + ': 13 filas')) && msg[0].includes('ING_CARRERA_DOCENTE_PARVULARIA: 13 filas'), 'importar el mismo Excel informa las 8 hojas nuevas con 13 filas cada una', msg);
  const x2 = await exportar(page, () => page.click('#downloadExcelOFBtn-junji'));
  t.eq(JSON.stringify(x2.libro.hojas), JSON.stringify(x1.libro.hojas), 'exportar → importar → exportar da exactamente las mismas hojas');
  const st = await h.store();
  t.eq([st[RUTA('5401003')].otras_fuentes.junji.gasto_rem.meses.FEBRERO, st[RUTA('5401003')].otras_fuentes.junji.gasto_rem_operacion.meses.FEBRERO], [200000, 50000], 'la importación escribe `gasto_rem_operacion` y no toca el campo antiguo `gasto_rem`');

  // ---------------------------------------------------------------- 3) Excel con cambios: una línea de un jardín
  const nuevo = copia(x1);
  nuevo.REM_HOMOLOGACION = nuevo.REM_HOMOLOGACION.map((f, i) => (i && String(f[0]) === '5401003' ? f.map((c, j) => (j === 3 ? 654321 : (j === 14 ? 654321 : c))) : f));
  await h.clearWrites();
  msg = await importarLibro(h, '#importExcelOFInput-junji', await libroXlsx(page, nuevo), 'junji_cambio.xlsx');
  t.ok(/REM_HOMOLOGACION: 13 filas/.test(msg[0] || ''), 'un Excel con cambios en REM_HOMOLOGACION lo importa', msg);
  const s2 = await h.store();
  t.eq([s2[RUTA('5401003')].otras_fuentes.junji.gasto_rem_homologacion.meses.FEBRERO, s2[RUTA('5401003')].otras_fuentes.junji.gasto_rem_homologacion.total], [654321, 654321], 'el gasto de Homologación de febrero de 5401003 (un jardín sin esa línea antes) llega al servidor');
  const wr = (await h.writes()).filter(x => x.path === RUTA('5401003'));
  t.ok(wr.length > 0 && wr.every(x => x.options.merge === true), 'con merge:true');

  // ---------------------------------------------------------------- 4) Excel ANTERIOR: REMUNERACIONES → Operación; ING_CARRERA_DOCENTE → Carrera Docente Parvularia
  const ant = {};
  x1.libro.orden.filter(n => !n.startsWith('REM_') && n !== 'ING_CARRERA_DOCENTE_PARVULARIA').forEach(n => { ant[n] = x1.libro.hojas[n].map(r => r.slice()); });
  ant.ING_CARRERA_DOCENTE = x1.libro.hojas.ING_CARRERA_DOCENTE_PARVULARIA.map((f, i) => (i && String(f[0]) === '5402002' ? f.map((c, j) => (j === 2 ? 77000 : c)) : f.slice()));
  ant.REMUNERACIONES = x1.libro.hojas.REM_OPERACION.map((f, i) => (i && String(f[0]) === '5402002' ? f.map((c, j) => (j === 2 ? 123000 : c)) : f.slice()));
  const antes = (await h.store())[RUTA('5402002')].otras_fuentes.junji;
  await h.clearWrites();
  msg = await importarLibro(h, '#importExcelOFInput-junji', await libroXlsx(page, ant), 'junji_anterior.xlsx');
  t.ok(/^Carga importada correctamente/.test(msg[0] || '') && msg[0].includes('REMUNERACIONES (→ Operación): 13 filas') && msg[0].includes('ING_CARRERA_DOCENTE: 13 filas'), 'un Excel ANTERIOR (REMUNERACIONES + ING_CARRERA_DOCENTE) se importa sin error: REMUNERACIONES pasa a Operación', msg);
  const d2 = (await h.store())[RUTA('5402002')].otras_fuentes.junji;
  t.eq([d2.gasto_rem_operacion.meses.ENERO, d2.ingreso_carrera_docente.meses.ENERO], [123000, 77000], 'REMUNERACIONES escribió Gasto Rem. Operación (123.000) e ING_CARRERA_DOCENTE el Ingreso Carrera Docente Parvularia (77.000)');
  t.eq([JSON.stringify(d2.gasto_rem_homologacion), JSON.stringify(d2.gasto_rem_carrera_docente), JSON.stringify(d2.gasto_rem_bdl)], [JSON.stringify(antes.gasto_rem_homologacion), JSON.stringify(antes.gasto_rem_carrera_docente), JSON.stringify(antes.gasto_rem_bdl)], 'las otras 3 líneas de Remuneración no se tocan');
  t.ok(!(await h.writes()).some(x => /"gasto_rem":/.test(JSON.stringify(x.payload || {}))), 'y NO se escribe el campo antiguo `gasto_rem`');
  // si el archivo trae las dos (REMUNERACIONES y REM_OPERACION), mandan las nuevas
  const ambas = copia(x1);
  ambas.REMUNERACIONES = x1.libro.hojas.REM_OPERACION.map((f, i) => (i && String(f[0]) === '5402002' ? f.map((c, j) => (j === 2 ? 5 : c)) : f.slice()));
  ambas.REM_OPERACION = x1.libro.hojas.REM_OPERACION.map((f, i) => (i && String(f[0]) === '5402002' ? f.map((c, j) => (j === 2 ? 9 : c)) : f.slice()));
  await importarLibro(h, '#importExcelOFInput-junji', await libroXlsx(page, ambas), 'junji_ambas.xlsx');
  t.eq((await h.store())[RUTA('5402002')].otras_fuentes.junji.gasto_rem_operacion.meses.ENERO, 9, 'con REMUNERACIONES y REM_OPERACION en el mismo archivo manda REM_OPERACION');

  // ---------------------------------------------------------------- 5) Excel individual (⬇ XLS de la fila) y las demás fuentes
  const xr = await exportar(page, () => page.click('#otrasFuentesTbody-junji button.row-action-btn[data-action="excel"][data-rbd="5402002"]'));
  t.eq(xr.libro.orden.slice(0, 8), x1.libro.orden.slice(0, 8), 'el Excel de una fila (XLS) trae las mismas 8 hojas de ingreso y Remuneración');
  t.eq(xr.libro.hojas.REM_HOMOLOGACION.slice(1).map(f => String(f[0])), ['5402002'], '…solo con la fila de la entidad');
  await clickTab(page, 'general');
  const xg = await exportar(page, () => page.click('#downloadExcelOFBtn-general'));
  t.ok(xg.libro.orden.includes('REMUNERACIONES') && xg.libro.orden.includes('ING_CARRERA_DOCENTE') && !xg.libro.orden.some(n => n.startsWith('REM_')), 'el Excel de Subvención General conserva REMUNERACIONES e ING_CARRERA_DOCENTE (el renombre es solo de JUNJI)');
  t.noErrores(h);
  await h.close();
});
