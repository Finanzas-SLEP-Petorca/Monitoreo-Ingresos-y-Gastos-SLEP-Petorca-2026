// fuentes_nuevas_modelo (PR K) — las fuentes que se agregaron directamente a `main` sin pruebas: Subtítulo 31 (Proyectos), Recuperación Licencias Médicas (solo ingresos), Asignación Familiar (solo Remuneraciones
// y Honorarios) y el Ingreso Carrera Docente de Subvención General y PIE. MODELO, lectura y guardado. Fixture `fondos_fijos` (que parte de `honorarios_fuentes`), contra el cálculo independiente de
// tests/lib/honorarios_fuentes.mjs / tests/lib/fondos_fijos.mjs.
//
//   1. universo: Subt. 31 y Recuperación LLMM = 55 RBD + AC + 13 GESPARVU (69), Asignación Familiar = 55 RBD + 13 GESPARVU (68, SIN AC); lo guardado fuera del universo (AC en Asignación Familiar, General en un jardín) se ignora
//   2. forma: encabezados de la tabla, tarjetas y secciones del modal de cada fuente (Recuperación LLMM sin gasto; Asignación Familiar sin B&S; General y PIE con la tabla «Ingreso Carrera Docente»)
//   3. totales Real / Proyectado / Total, Estado y «N de M en déficit» (3 vistas de cada pestaña) y cada fila = cálculo independiente
//   4. lectura TOLERANTE de documentos dañados (valores no numéricos, nulos, tipos cambiados): estado verde, el resto del panel intacto, nada se escribe
//   5. guardado: un write de SOLO esa línea y mes (`otras_fuentes.<fuente>.<línea>.meses.<MES>`, `merge:true`), el servidor conserva el resto, recarga
//   6. Honorarios (PR #67): Subt. 31 y Asignación Familiar los llevan; Recuperación LLMM NO (una boleta en su documento no cuenta y su modal no trae el bloque)
import { boot } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { docsDe, clon } from '../lib/corte.mjs';
import { leerFilas, leerTarjetas, abrirModal, cerrarModal } from '../lib/honorarios_fuentes.mjs';
import { ordenFilas, fuenteEsp, idsGeneral, clp, fmt, MESES, RBD_IDS, GESPARVU_IDS } from '../lib/fondos_fijos.mjs';

const RUTA = (id) => `sep_carga_rbd/${id}`;
const SUF = { total: 'Total', real: 'Real', proy: 'Proyectado' };
const celda = (id, fuente, modo, mes) => `#otrasFuentesModalBody input.celda-input[data-rbd="${id}"][data-fuente="${fuente}"][data-modo="${modo}"][data-mes="${mes}"]`;
const escrituras = async (h, id) => (await h.writes()).filter(w => w.path === RUTA(id) && w.payload && w.payload.otras_fuentes);
const estadoSync = (page) => page.evaluate(() => ({ txt: document.getElementById('sync-text').textContent, cls: document.getElementById('sync-indicator').className }));

/** Verifica tarjetas (3 vistas) y filas de una pestaña contra el esperado de la fuente. */
async function verificarFuente(t, h, key, esp, rotuloIngreso, { sinGasto = false, sinBys = false } = {}) {
  const { page } = h;
  await h.clickTab('of-' + key);
  const tj = await leerTarjetas(page, key);
  for (const vista of ['real', 'proy', 'total']) {
    const b = esp.suma[vista], suf = SUF[vista];
    const lee = (r) => clp((tj[vista][`${r} (${suf})`] || {}).valor);
    if (sinGasto) t.eq([lee(rotuloIngreso), lee('Saldo')], [b.ingreso, b.saldo], `${key} · tarjetas ${suf}: Ingreso y Saldo = cálculo independiente (el saldo es el ingreso recuperado)`);
    else t.eq([lee(rotuloIngreso), lee('Gasto Remuneraciones'), lee('Gasto Honorarios'), ...(sinBys ? [] : [lee('Gasto Bienes y Servicios')]), lee('Gasto Total'), lee('Saldo')],
      [b.ingreso, b.rem, b.hon, ...(sinBys ? [] : [b.bys]), b.gasto, b.saldo], `${key} · tarjetas ${suf} = cálculo independiente`);
  }
  if (sinGasto) t.eq(clp(tj.total['Sin gastos asociados (Total)'].valor), 0, `${key}: la tarjeta «Sin gastos asociados» vale $0`);
  const nota = (tj.total['Saldo (Total)'] || {}).nota;
  if (sinGasto) t.eq(nota, 'Corresponde al ingreso recuperado', `${key}: la nota del Saldo dice que corresponde al ingreso recuperado`);
  else t.ok(new RegExp(`${esp.suma.nDeficit} de ${esp.suma.nEntidades} entidades en déficit`).test(nota), `${key}: «${esp.suma.nDeficit} de ${esp.suma.nEntidades} entidades en déficit»`, nota);
  const filas = await leerFilas(page, key);
  const malas = [];
  Object.entries(esp.porId).forEach(([id, e]) => {
    const r = filas[id];
    if (!r) { malas.push(id + ' (sin fila)'); return; }
    const ok = clp(r.ingreso) === e.total.ingreso && clp(r.saldo) === e.total.saldo && r.estado === (e.estado === 'deficit' ? 'Déficit' : 'Superávit')
      && (sinGasto || (clp(r.rem) === e.total.rem && clp(r.hon) === e.total.hon && clp(r.gasto) === e.total.gasto && (sinBys || clp(r.bys) === e.total.bys)));
    if (!ok) malas.push(`${id}: ${JSON.stringify(r)} ≠ ${JSON.stringify(e.total)} ${e.estado}`);
  });
  t.eq(malas, [], `${key}: cada una de las ${Object.keys(esp.porId).length} filas = cálculo independiente (ingreso, gasto, saldo y Estado)`);
  for (const vista of ['real', 'proy']) {
    await page.click(`#tab-of-${key} .of-chip[data-of-vista="${vista}"]`);
    await h.waitIdle();
    const fv = await leerFilas(page, key);
    const malasV = Object.entries(esp.porId).filter(([id, e]) => clp(fv[id].ingreso) !== e[vista].ingreso || clp(fv[id].saldo) !== e[vista].saldo).map(([id]) => id);
    t.eq(malasV, [], `${key} · vista ${vista}: ingreso y saldo de cada fila = cálculo independiente`);
  }
  await page.click(`#tab-of-${key} .of-chip[data-of-vista="total"]`);
  await h.waitIdle();
}

await correrSpec('fuentes_nuevas_modelo', async (t) => {
  const docs = docsDe('fondos_fijos');
  const h = await boot({ fixture: 'fondos_fijos' });
  const { page } = h;
  const esp = { subt31_proyectos: fuenteEsp(docs, 'subt31_proyectos'), recuperacion_llmm: fuenteEsp(docs, 'recuperacion_llmm'), asignacion_familiar: fuenteEsp(docs, 'asignacion_familiar'), pie: fuenteEsp(docs, 'pie'), general: fuenteEsp(docs, 'general') };

  // ================================================================ 1. universo
  for (const [key, ids, n] of [['subt31_proyectos', [...RBD_IDS, 'AC', ...GESPARVU_IDS], 69], ['recuperacion_llmm', [...RBD_IDS, 'AC', ...GESPARVU_IDS], 69], ['asignacion_familiar', [...RBD_IDS, ...GESPARVU_IDS], 68], ['pie', [...RBD_IDS, 'AC'], 56], ['general', idsGeneral(docs), 57]]) {
    await h.clickTab('of-' + key);
    t.eq(await ordenFilas(page, `#otrasFuentesTbody-${key} tr[data-rbd]`), ids, `1) ${key}: ${n} filas ${key === 'asignacion_familiar' ? '(55 RBD + 13 GESPARVU, SIN Administración Central)' : key === 'general' ? '(RBD + AC + el jardín con Fondos Fijos registrados)' : key === 'pie' ? '(55 RBD + AC)' : '(55 RBD + AC + 13 GESPARVU, en ese orden)'}`);
  }
  t.eq(Object.keys(esp.asignacion_familiar.porId).includes('AC'), false, '1) (sanity del oráculo) AC no es entidad de Asignación Familiar');
  // lo guardado fuera del universo no se ve: AF en el documento de AC (888.888), General en el jardín 5402002 (999.999)
  const afTotal = esp.asignacion_familiar.suma.total.ingreso;
  t.ok(!String(afTotal).includes('888888'), '1) y el ingreso de AF guardado en el documento de AC no suma a Asignación Familiar');
  await h.clickTab('of-general');
  t.eq((await leerFilas(page, 'general'))['5402002'].ingreso, '$0', '1) General en un jardín: el «ingreso» 999.999 guardado en su documento (fuera del universo de General) no se lee');

  // ================================================================ 2. forma: encabezados, tarjetas y modal de cada fuente
  const cabeceras = (k) => page.evaluate((x) => Array.from(document.querySelectorAll(`#otrasFuentesTable-${x} thead th`)).map(th => th.textContent.trim()), k);
  const rotulos = (k) => page.evaluate((x) => Array.from(document.querySelectorAll(`#ofKpiRow-total-${x} .kpi-card .label`)).map(c => c.textContent.trim()), k);
  await h.clickTab('of-subt31_proyectos');
  t.eq(await cabeceras('subt31_proyectos'), ['RBD / GESPARVU', 'Nombre', 'Real hasta', 'Ingreso', 'Gasto Remuneraciones', 'Gasto Honorarios (Subt. 21)', 'Gasto Bienes y Servicios', 'Gasto Total', 'Saldo', 'Estado (Total)', 'Acciones'], '2) Subt. 31: tabla con Ingreso, Remuneraciones, Honorarios, B&S, Gasto Total, Saldo y Estado');
  await h.clickTab('of-recuperacion_llmm');
  t.eq(await cabeceras('recuperacion_llmm'), ['RBD / GESPARVU', 'Nombre', 'Real hasta', 'Ingreso', 'Saldo', 'Estado (Total)', 'Acciones'], '2) Recuperación LLMM: solo Ingreso y Saldo (sin ninguna columna de gasto)');
  t.eq(await rotulos('recuperacion_llmm'), ['Ingreso (Total)', 'Sin gastos asociados (Total)', 'Saldo (Total)'], '2) y 3 tarjetas: Ingreso, «Sin gastos asociados» y Saldo');
  await h.clickTab('of-asignacion_familiar');
  t.eq(await cabeceras('asignacion_familiar'), ['RBD / GESPARVU', 'Nombre', 'Real hasta', 'Ingreso Percibido', 'Gasto Remuneraciones', 'Gasto Honorarios (Subt. 21)', 'Gasto Total', 'Saldo', 'Estado (Total)', 'Acciones'], '2) Asignación Familiar: «Ingreso Percibido», Remuneraciones, Honorarios, Gasto Total y Saldo (sin B&S)');
  t.eq(await rotulos('asignacion_familiar'), ['Ingreso Percibido (Total)', 'Gasto Remuneraciones (Total)', 'Gasto Honorarios (Total)', 'Gasto Total (Total)', 'Saldo (Total)'], '2) y 5 tarjetas sin Bienes y Servicios');
  const modalInfo = async (fuente, id) => {
    await abrirModal(h, fuente, id);
    const r = await page.evaluate(() => ({
      tablas: Array.from(document.querySelectorAll('#otrasFuentesModalBody table.detalle-table')).map(t => { const l = t.querySelector('tbody tr .item-label'); return l ? l.textContent.trim() : null; }).filter(Boolean),
      modos: Array.from(new Set(Array.from(document.querySelectorAll('#otrasFuentesModalBody input.celda-input')).map(i => i.dataset.modo))),
      compras: !!document.querySelector('#otrasFuentesModalBody .compra-form-grid'), honBloque: !!document.querySelector('#otrasFuentesModalBody .hon-block'),
      texto: document.getElementById('otrasFuentesModalBody').innerText.replace(/\s+/g, ' '), sub: document.getElementById('otrasFuentesModalSubtitle').textContent.replace(/\s+/g, ' '),
    }));
    await cerrarModal(h);
    return r;
  };
  const mLlmm = await modalInfo('recuperacion_llmm', '1121');
  t.eq(mLlmm.tablas, ['Recuperación LLMM Isapres', 'Recuperación LLMM FONASA', 'Recuperación LLMM SIL'], '2) modal de Recuperación LLMM: SOLO las tres líneas de ingreso (Isapres, FONASA, SIL)');
  t.eq(mLlmm.modos, ['of_ingreso_llmm_isapres', 'of_ingreso_llmm_fonasa', 'of_ingreso_llmm_sil'], '2) y solo celdas de esas tres líneas (sin Remuneraciones, B&S ni proyección)');
  t.ok(!mLlmm.compras && !mLlmm.honBloque && /no tiene gastos asociados/.test(mLlmm.texto) && /Gasto Total: \$0/.test(mLlmm.sub), '2) sin registro de compras ni honorarios; dice que no tiene gastos asociados y el subtítulo trae Gasto Total $0', mLlmm.sub);
  const mAf = await modalInfo('asignacion_familiar', '1121');
  t.ok(mAf.tablas.includes('Ingresos Percibidos') && mAf.tablas.includes('Gasto Remuneraciones (Asignación Familiar)') && mAf.honBloque && !mAf.compras, '2) modal de Asignación Familiar: «Ingresos Percibidos», «Gasto Remuneraciones» y honorarios; SIN registro de compras ni B&S', mAf.tablas);
  t.ok(/solo permite gastos en Remuneraciones; no registra Bienes y Servicios/.test(mAf.texto), '2) y lo explica');
  const mS31 = await modalInfo('subt31_proyectos', '1121');
  t.ok(mS31.honBloque && mS31.compras && /Registro de compras \(Subtítulo 31/.test(mS31.texto) && mS31.modos.includes('of_bys_item'), '2) modal de Subt. 31: remuneraciones, honorarios, registro de compras por concepto y B&S «sin documento» (igual que FAEP)');
  const mPie = await modalInfo('pie', '1121');
  const mGen = await modalInfo('general', '1121');
  t.ok(mPie.tablas.includes('Ingreso Carrera Docente PIE') && mGen.tablas.includes('Ingreso Carrera Docente General') && mGen.modos.includes('of_ingreso_carrera_docente'), '2) modales de General y PIE: tabla «Ingreso Carrera Docente General / PIE» con sus 12 celdas', { pie: mPie.tablas, gen: mGen.tablas });
  const mMan = await modalInfo('mantenimiento', '1121');
  t.ok(!mMan.tablas.some(x => /Carrera Docente/.test(x)), '2) las demás fuentes con compras (Mantenimiento, Pro-Retención) NO traen Carrera Docente');

  // ================================================================ 3. totales y filas
  await verificarFuente(t, h, 'subt31_proyectos', esp.subt31_proyectos, 'Ingreso');
  await verificarFuente(t, h, 'recuperacion_llmm', esp.recuperacion_llmm, 'Ingreso', { sinGasto: true });
  await verificarFuente(t, h, 'asignacion_familiar', esp.asignacion_familiar, 'Ingreso Percibido', { sinBys: true });
  await verificarFuente(t, h, 'pie', esp.pie, 'Ingreso');
  const b = esp.recuperacion_llmm.suma.total;
  t.eq([b.ingreso, b.gasto, b.saldo, esp.recuperacion_llmm.suma.nDeficit], [40000 + 30000 + 20000 + 25000 + 15000, 0, 130000, 0], '3) Recuperación LLMM: 40.000 + 30.000 + 20.000 (1121) + 25.000 (AC) + 15.000 (jardín) = 130.000 de ingreso, gasto $0, saldo = ingreso y 0 entidades en déficit');
  const af = esp.asignacion_familiar.porId;
  t.eq([af['1121'].estado, af['5402002'].estado, af['1122'].total.saldo], ['deficit', 'deficit', 300000 - 0], '3) Asignación Familiar: 1121 y el jardín 5402002 en Déficit por sus honorarios; 1122 (400.000 − 100.000) superávit de 300.000');
  const gCD = esp.pie.porId['1122'].total.ingreso;
  t.ok(gCD >= 100000, '3) PIE / 1122: su ingreso incluye el Ingreso Carrera Docente (100.000)', gCD);
  t.eq((await h.writes()).length, 0, '3) mirar las pestañas no escribe nada');
  t.noErrores(h);
  await h.close();

  // ================================================================ 4. lectura tolerante
  const daniado = clon(docs);
  daniado['1121'].otras_fuentes.recuperacion_llmm = { ingreso_llmm_isapres: { meses: { ENERO: 'abc', FEBRERO: '1000', MARZO: null, ABRIL: { x: 1 } } }, ingreso_llmm_fonasa: 'x', ingreso_llmm_sil: { meses: [1, 2] }, real_hasta_mes: 'zz', honorarios: { b: { montoGasto: 5000, fechaDocumento: '2026-03-01' } } };
  daniado['1122'].otras_fuentes.asignacion_familiar = { ingreso: 5, gasto_rem: { meses: { ENERO: { a: 1 }, FEBRERO: true, MARZO: '2500' } }, honorarios: 'x', hon_proyeccion_items: [1, 2] };
  daniado['1122'].otras_fuentes.subt31_proyectos = { ingreso: null, gasto_rem: 'x', bys_items: { a: null, b: 'x' }, compras: 7 };
  daniado['1122'].otras_fuentes.general.ingreso_carrera_docente = { meses: 'x', total: 'y' };
  daniado['1122'].otras_fuentes.pie.ingreso_carrera_docente = 7;
  daniado['AC'].otras_fuentes.general.ingreso_carrera_docente = { meses: { ENERO: '80000', FEBRERO: null, MARZO: true } };
  daniado['5402002'].otras_fuentes.asignacion_familiar = 'texto';
  daniado['5402004'].otras_fuentes.recuperacion_llmm = [1];
  const hd = await boot({ fixture: daniado });
  const sd = await estadoSync(hd.page);
  t.ok(/green/.test(sd.cls) && !/inv[aá]lid/i.test(sd.txt), '4) los campos nuevos dañados NO dejan el panel en rojo ni marcan el documento como inválido', sd);
  const espD = { subt31_proyectos: fuenteEsp(daniado, 'subt31_proyectos'), recuperacion_llmm: fuenteEsp(daniado, 'recuperacion_llmm'), asignacion_familiar: fuenteEsp(daniado, 'asignacion_familiar'), pie: fuenteEsp(daniado, 'pie'), general: fuenteEsp(daniado, 'general') };
  for (const [key, rot, o] of [['subt31_proyectos', 'Ingreso', {}], ['recuperacion_llmm', 'Ingreso', { sinGasto: true }], ['asignacion_familiar', 'Ingreso Percibido', { sinBys: true }], ['pie', 'Ingreso', {}]]) {
    await hd.clickTab('of-' + key);
    const filas = await leerFilas(hd.page, key);
    const malas = Object.entries(espD[key].porId).filter(([id, e]) => clp(filas[id].ingreso) !== e.total.ingreso || clp(filas[id].saldo) !== e.total.saldo).map(([id]) => id);
    t.eq(malas, [], `4) ${key} con documentos dañados: cada fila = lectura tolerante esperada (texto numérico se convierte; nulos, objetos, arreglos y textos valen 0)`);
  }
  t.eq(clp((await leerFilas(hd.page, 'pie'))['1122'].ingreso), espD.pie.porId['1122'].total.ingreso, '4) PIE / 1122 con «ingreso_carrera_docente: 7» (número en vez de mapa): no rompe y suma lo demás');
  await hd.clickTab('of-recuperacion_llmm');
  t.eq(clp((await leerFilas(hd.page, 'recuperacion_llmm'))['1121'].ingreso), 1000, '4) Recuperación LLMM / 1121: solo «1000» (texto numérico) cuenta; «abc», nulo, objeto y la boleta guardada en un documento sin gasto no suman');
  await hd.clickTab('of-general');
  t.eq(clp((await leerFilas(hd.page, 'general'))['AC'].ingreso), espD.general.porId['AC'].total.ingreso, '4) General / AC: Carrera Docente con «80000» como texto, nulo y true = 80.000');
  await hd.clickTab('of-asignacion_familiar');
  const afD = await leerFilas(hd.page, 'asignacion_familiar');
  t.eq([afD['1122'].ingreso, afD['1122'].rem, afD['5402002'].ingreso], ['$0', '$2.500', '$0'], '4) Asignación Familiar: «ingreso: 5» (un número en vez del mapa de meses) = $0, remuneraciones «2500» = 2.500 (objeto y true = 0) y un documento con `asignacion_familiar` de texto = $0');
  t.eq((await hd.writes()).length, 0, '4) leer documentos dañados no escribe nada');
  t.noErrores(hd);
  await hd.close();

  // ================================================================ 5. guardado: un write de SOLO esa línea y mes
  const h5 = await boot({ fixture: 'fondos_fijos' });
  await abrirModal(h5, 'recuperacion_llmm', '1122');
  await h5.page.fill(celda('1122', 'recuperacion_llmm', 'of_ingreso_llmm_fonasa', 'MAYO'), '45000');
  await h5.flushWrites();
  let w = await escrituras(h5, '1122');
  t.eq(w.length, 1, '5) editar una celda de FONASA = UN write sobre el documento');
  t.ok(w[0].options.merge === true, '5) con merge:true');
  t.eq(JSON.stringify(w[0].payload.otras_fuentes), JSON.stringify({ recuperacion_llmm: { ingreso_llmm_fonasa: { meses: { MAYO: 45000 }, total: 45000 } } }), '5) payload = SOLO `otras_fuentes.recuperacion_llmm.ingreso_llmm_fonasa` con ese mes y su total (no Isapres ni SIL, ni otras fuentes)');
  t.eq(Object.keys(w[0].payload).filter(k => !['nombre', 'otras_fuentes', 'lastModifiedBy', 'lastModifiedAt'].includes(k)), [], '5) el documento solo recibe nombre, auditoría y esa línea');
  let st = (await h5.store())[RUTA('1122')].otras_fuentes;
  t.eq(st.recuperacion_llmm.ingreso_llmm_fonasa.meses.MAYO, 45000, '5) el servidor tiene el monto');
  t.eq(st.asignacion_familiar.ingreso.meses.ENERO, 400000, '5) y no tocó las otras fuentes del documento (Asignación Familiar de 1122 intacta)');
  await h5.page.fill(celda('1122', 'recuperacion_llmm', 'of_ingreso_llmm_isapres', 'MAYO'), '1.500');
  await h5.flushWrites();
  t.eq((await h5.store())[RUTA('1122')].otras_fuentes.recuperacion_llmm.ingreso_llmm_isapres.meses.MAYO, 1500, '5) «1.500» (separador de miles) = 1.500');
  await h5.page.fill(celda('1122', 'recuperacion_llmm', 'of_ingreso_llmm_sil', 'MAYO'), 'abc');
  await h5.flushWrites();
  t.eq(((await h5.store())[RUTA('1122')].otras_fuentes.recuperacion_llmm.ingreso_llmm_sil || { meses: {} }).meses.MAYO, undefined, '5) un texto no numérico no se guarda');
  const subt = await h5.page.evaluate(() => document.getElementById('otrasFuentesModalSubtitle').textContent.replace(/\s+/g, ' '));
  t.ok(subt.includes(fmt(45000 + 1500)) && /Gasto Total: \$0/.test(subt), '5) el subtítulo se actualiza en vivo (Ingreso Total = 46.500, gasto $0)', subt);
  await cerrarModal(h5);
  // Asignación Familiar
  await abrirModal(h5, 'asignacion_familiar', '1122');
  await h5.page.fill(celda('1122', 'asignacion_familiar', 'of_gasto_rem', 'JUNIO'), '70000');
  await h5.flushWrites();
  w = (await escrituras(h5, '1122')).slice(-1);
  t.eq(JSON.stringify(w[0].payload.otras_fuentes), JSON.stringify({ asignacion_familiar: { gasto_rem: { meses: { JUNIO: 70000 }, total: 170000 } } }), '5) Asignación Familiar: la remuneración viaja como `gasto_rem` (junio) con su total (100.000 + 70.000)');
  await cerrarModal(h5);
  // Subt. 31
  await abrirModal(h5, 'subt31_proyectos', '1122');
  await h5.page.fill(celda('1122', 'subt31_proyectos', 'of_ingreso', 'FEBRERO'), '80000');
  await h5.flushWrites();
  w = (await escrituras(h5, '1122')).slice(-1);
  t.eq(JSON.stringify(w[0].payload.otras_fuentes), JSON.stringify({ subt31_proyectos: { ingreso: { meses: { FEBRERO: 80000 }, total: 580000 } } }), '5) Subt. 31: el ingreso viaja como `ingreso` (febrero) con su total (500.000 + 80.000)');
  await cerrarModal(h5);
  // Carrera Docente de General y PIE
  await abrirModal(h5, 'general', '1122');
  await h5.page.fill(celda('1122', 'general', 'of_ingreso_carrera_docente', 'JUNIO'), '60000');
  await h5.flushWrites();
  w = (await escrituras(h5, '1122')).slice(-1);
  t.eq(JSON.stringify(w[0].payload.otras_fuentes), JSON.stringify({ general: { ingreso_carrera_docente: { meses: { JUNIO: 60000 }, total: 360000 } } }), '5) General: el Ingreso Carrera Docente viaja como `ingreso_carrera_docente` (junio) con su total (300.000 + 60.000) y NO toca `ingreso`');
  const gsub = await h5.page.evaluate(() => document.getElementById('otrasFuentesModalSubtitle').textContent.replace(/\s+/g, ' '));
  const eg1122 = esp.general.porId['1122'].total.ingreso + 60000;
  t.ok(gsub.includes(`Ingreso Total: ${fmt(eg1122)}`), `5) y el Ingreso Total del subtítulo suma Ingreso + Carrera Docente en vivo (${fmt(eg1122)})`, gsub);
  await cerrarModal(h5);
  await abrirModal(h5, 'pie', '1122');
  await h5.page.fill(celda('1122', 'pie', 'of_ingreso_carrera_docente', 'ENERO'), '120000');
  await h5.flushWrites();
  w = (await escrituras(h5, '1122')).slice(-1);
  t.eq(JSON.stringify(w[0].payload.otras_fuentes), JSON.stringify({ pie: { ingreso_carrera_docente: { meses: { ENERO: 120000 }, total: 120000 } } }), '5) PIE: lo mismo (enero 120.000)');
  await cerrarModal(h5);
  // recarga: lo guardado persiste y las cifras de las pestañas lo reflejan
  const docs5 = clon(docs);
  Object.assign(docs5['1122'], clon((await h5.store())[RUTA('1122')]));
  await h5.page.reload();
  await h5.page.waitForFunction(() => { const a = document.getElementById('app'); const d = document.getElementById('sync-indicator'); return a && !a.classList.contains('hidden') && d && d.classList.contains('green'); }, null, { timeout: 20000 });
  await h5.waitIdle();
  for (const [key, rot] of [['recuperacion_llmm', 'Ingreso'], ['asignacion_familiar', 'Ingreso Percibido'], ['subt31_proyectos', 'Ingreso'], ['pie', 'Ingreso'], ['general', 'Ingreso']]) {
    await h5.clickTab('of-' + key);
    const e = fuenteEsp(docs5, key).porId['1122'];
    const fila = (await leerFilas(h5.page, key))['1122'];
    t.eq([clp(fila.ingreso), clp(fila.saldo)], [e.total.ingreso, e.total.saldo], `5) tras recargar, ${key} / 1122 = cálculo independiente sobre lo guardado`);
  }
  t.noErrores(h5);
  await h5.close();

  // ================================================================ 6. honorarios en las fuentes nuevas
  const h6 = await boot({ fixture: 'fondos_fijos' });
  await abrirModal(h6, 'asignacion_familiar', '1121');
  t.ok(await h6.page.evaluate(() => !!document.querySelector('#otrasFuentesModalBody .hon-block .hon-form-grid')), '6) Asignación Familiar tiene el bloque de honorarios (formulario y registro)');
  await cerrarModal(h6);
  await abrirModal(h6, 'subt31_proyectos', '1121');
  t.ok(await h6.page.evaluate(() => !!document.querySelector('#otrasFuentesModalBody .hon-block .hon-form-grid')), '6) Subt. 31 también');
  await cerrarModal(h6);
  await abrirModal(h6, 'recuperacion_llmm', '1121');
  t.ok(await h6.page.evaluate(() => !document.querySelector('#otrasFuentesModalBody .hon-block')), '6) Recuperación LLMM NO (fuente solo de ingresos)');
  await cerrarModal(h6);
  await h6.clickTab('of-recuperacion_llmm');
  const fl = (await leerFilas(h6.page, 'recuperacion_llmm'))['1121'];
  t.eq([clp(fl.ingreso), fl.hon, fl.estado], [90000, '—', 'Superávit'], '6) la boleta de 200.000 guardada en el documento de Recuperación LLMM de 1121 NO cuenta: ingreso 90.000, sin honorarios, Superávit');
  t.eq((await h6.writes()).length, 0, '6) y nada se escribe');
  t.noErrores(h6);
  await h6.close();
});
