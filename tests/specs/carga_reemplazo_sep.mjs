// Importador de SEP (⬆ Importar Excel de la pestaña principal) = REEMPLAZO TOTAL, con la misma maquinaria que las otras fuentes (resumen de control, writeBatch + mergeFields +
// deleteField, respaldo + Deshacer, cuadratura, Vaciar). Causa raíz que se prueba: antes importaba fila por fila con merge:true (una fila ausente se conservaba, una fila sin ID con
// el contenido cambiado quedaba duplicada, `indiceComprasPorFirma` fusionaba las idénticas y el N° DC anterior se heredaba). Se verifica (mock con mergeFields):
//   · cada hoja gestiona SOLO sus campos (INGRESO → ingreso_items, REMUNERACIONES → rem.meses/total, COMPRAS → compras, BYS_PROYECCION, HONORARIOS, HON_PROYECCION):
//     rem.real_hasta_mes, ingreso_real_hasta_mes, el mes de cierre global, fondos_fijos, otras_fuentes y las demás hojas quedan IDÉNTICOS;
//   · exportar («⬇ Excel») → reimportar es idempotente en TODOS los fixtures (sin escrituras, sin duplicados);
//   · fila eliminada desaparece (panel y servidor), fila modificada = una sola, idénticas = dos, ID repetido = ambas (-dup2), entidad ausente queda vacía en esa hoja, hoja ausente se conserva;
//   · DC_247 (53 antiguas + 66 nuevas = 66), sumas exactas con notas de crédito negativas, rechazos con hoja/fila/motivo (leídas = cargadas + rechazadas);
//   · Cancelar/Esc no escribe; Deshacer; cuadratura con desajuste inyectado (banner rojo); Vaciar (solo admin, escribiendo el nombre); ≥ 3.000 compras; honorarios y 70/30.
import { boot, clickTab } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { capturarDescarga, leerXlsx } from '../lib/capture-utils.mjs';
import { ENC_COMPRAS_SEP, filaCompra, compraBase, libroXlsx } from '../lib/compras.mjs';
import { subirYConfirmar, leerModalCarga } from '../lib/carga.mjs';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ENC_ING = ['RBD', 'Establecimiento', 'Item', ...MESES, 'Total Año'];
const ENC_PROY = ['RBD', 'Establecimiento', 'Codigo', 'Item', ...MESES, 'Total Año'];
const ENC_HON = ['ID', 'RBD', 'Establecimiento', 'Codigo', 'TipoDocumento', 'NroDocumento', 'FechaDocumento', 'FechaPago', 'Descripcion', 'RutProveedor', 'NombreProveedor', 'MontoGasto', 'MontoDocumento', 'N° DC'];
const clon = (o) => JSON.parse(JSON.stringify(o));
const suma = (xs) => xs.reduce((a, b) => a + b, 0);
const orden = (xs) => xs.map(x => JSON.stringify(x)).sort();
const sinAud = (v) => { if (Array.isArray(v)) return v.map(sinAud); if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { if (k !== 'lastModifiedAt' && k !== 'lastModifiedBy') o[k] = sinAud(v[k]); }); return o; } return v; };
const compra = (extra = {}) => compraBase({ codigo: '410606', ...extra });
const NOM = {};
const FILA = (id, rbd, c) => filaCompra(id, Number(rbd), NOM[rbd] || String(rbd), c);
const docs = async (h) => sinAud(clon(await h.store()));
const doc = async (h, rbd) => (await h.store())['sep_carga_rbd/' + rbd] || {};
const escribioSep = (ws) => ws.filter(w => w.path.startsWith('sep_carga_rbd/'));
async function escenario(t, nombre, fn) { try { await fn(); } catch (e) { t.ok(false, `${nombre}: excepción`, String(e.stack || e.message).split('\n').slice(0, 6).join(' | ')); } }

// Un documento SEP «limpio» en lo que se importa (lo demás —cortes, otras fuentes, fondos fijos, nombre— se conserva del fixture).
function limpiarSep(d) {
  Object.keys(d).forEach(k => {
    const x = d[k]; if (!x || k === '_meta') return;
    if (x.compras) x.compras = {};
    if (x.bys_proyeccion) x.bys_proyeccion = { items: {} };
    if (x.honorarios) x.honorarios = {};
    delete x.hon_proyeccion;
    if (x.ingreso_items) x.ingreso_items = {};
    if (x.rem) x.rem = { meses: {}, total: 0, real_hasta_mes: x.rem.real_hasta_mes };
  });
  return d;
}
const lib = (h, hojas) => libroXlsx(h.page, hojas);
async function exportarSep(h) {
  await clickTab(h.page, 'SEP');
  const dl = await capturarDescarga(h.page, () => h.page.click('#downloadExcelBtn'));
  return { ...dl, libro: await leerXlsx(h.page, dl.buffer) };
}
const hoja = (x, n) => (x.libro.hojas[n] || []).slice(1);
// Confirma capturando el respaldo que se descarga solo.
async function confirmarCapturando(h, buffer, nombre = 'carga.xlsx') {
  const { page } = h;
  await page.setInputFiles('#importExcelInput', { name: nombre, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await page.waitForFunction(() => !!document.getElementById('cargaOkBtn'), null, { timeout: 60000 });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#cargaOkBtn')]);
  const { readFileSync } = await import('node:fs');
  const respaldo = { filename: dl.suggestedFilename(), buffer: readFileSync(await dl.path()) };
  await page.waitForSelector('#cargaCerrarBtn');
  await page.waitForFunction(() => !/Guardando para el resto/.test(document.getElementById('cargaControlBody').innerText));
  const resultado = await leerModalCarga(page);
  await page.click('#cargaCerrarBtn'); await h.flushWrites(); await h.waitIdle();
  return { respaldo, resultado };
}

await correrSpec('carga_reemplazo_sep', async (t) => {
  // ======================= 0. Round-trip: exportar → reimportar es idempotente en todos los fixtures =======================
  // (Cuatro fixtures traen filas inválidas A PROPÓSITO —cuenta fuera del catálogo, tipo que no es de honorarios…—: la primera ida y vuelta las limpia y LO AVISA como «filas que NO se cargarán»;
  //  la segunda ya es idempotente. En los demás la primera ya es idéntica.)
  const conInvalidas = new Set(['honorarios', 'fondos_fijos', 'compras', 'honorarios_fuentes']);
  for (const fx of ['default', 'honorarios', 'fondos_fijos', 'cierre', 'estado', 'compras', 'jardines', 'junji_rem', 'honorarios_fuentes', 'compras_conceptos']) {
    await escenario(t, 'round-trip ' + fx, async () => {
      const h = await boot({ autoCarga: false, fixture: fx });
      let x = await exportarSep(h);
      if (conInvalidas.has(fx)) {
        const r0 = await subirYConfirmar(h, 'sep', x.buffer, { nombre: x.filename });
        t.ok(/Filas que NO se cargarán \(\d+\)/.test(r0.control.texto) && /Hoja \w+, fila \d+:/.test(r0.control.texto), `[${fx}] las filas inválidas del fixture se AVISAN con hoja, fila y motivo antes de limpiarse`, r0.control.texto.slice(-500));
        t.ok(/aplicado y verificado/.test(r0.resultado.texto), `[${fx}] la carga que las limpia cuadra`);
        x = await exportarSep(h);
      }
      const antes = await docs(h);
      await h.clearWrites();
      const r = await subirYConfirmar(h, 'sep', x.buffer, { nombre: x.filename });
      t.ok(/idéntico a lo que ya hay/.test(r.control.texto), `[${fx}] exportar → reimportar: el resumen dice que el archivo es idéntico al panel`, r.control.texto.slice(0, 700));
      t.eq(escribioSep(await h.writes()).length, 0, `[${fx}] ... y no se escribió NADA en Firestore`);
      t.eq(await docs(h), antes, `[${fx}] ... y ningún documento cambió`);
      t.noErrores(h);
      await h.close();
    });
  }

  // ======================= 1. Carga completa sobre un SEP vacío: exactitud y campos no gestionados intactos =======================
  const base = limpiarSep(clon((await (async () => { const h0 = await boot({ autoCarga: false, fixture: 'fondos_fijos' }); const s = clon(await h0.store()); await h0.close(); return Object.fromEntries(Object.entries(s).map(([p, v]) => [p.split('/')[1], v])); })())));
  Object.keys(base).forEach(k => { NOM[k] = base[k].nombre || k; });
  base['1121'].ingreso_real_hasta_mes = 4; base['1121'].rem.real_hasta_mes = 5;   // cortes propios: ninguna hoja los trae
  const h = await boot({ autoCarga: false, fixture: base });
  const cargaInicial = { ing: 1000000, rem: 400000 };
  await escenario(t, 'carga completa', async () => {
    const cs = [
      FILA('', '1121', compra({ nroDocumento: '100', montoGasto: 100000, montoDocumento: 119000 })),
      FILA('', '1121', compra({ nroDocumento: '101', montoGasto: 250000, montoDocumento: 297500, codigo: '410605' })),
      FILA('', '1122', compra({ nroDocumento: '200', montoGasto: 75500, montoDocumento: 89845 })),
      FILA('', '1122', compra({ nroDocumento: '201', tipoDocumento: 'Nota de crédito', montoGasto: 20000, montoDocumento: 23800, documentoOriginal: '100-FAC' })), // NC: negativo
    ];
    const meses = (v) => new Array(12).fill(v);
    const libro = await lib(h, {
      INGRESO: [ENC_ING, [1121, NOM['1121'], 'Ingreso SEP Preferente', ...meses(cargaInicial.ing), 12 * cargaInicial.ing], [1121, NOM['1121'], 'Carrera Docente', ...meses(30000), 360000], [1122, NOM['1122'], 'Ingreso SEP Prioritario', ...meses(500000), 6000000]],
      REMUNERACIONES: [ENC_ING, [1121, NOM['1121'], '', ...meses(cargaInicial.rem), 12 * cargaInicial.rem], [1122, NOM['1122'], '', ...meses(200000), 2400000]],
      COMPRAS: [ENC_COMPRAS_SEP, ...cs],
      BYS_PROYECCION: [ENC_PROY, [1121, NOM['1121'], '410605', 'x', ...meses(10000), 120000]],
      HONORARIOS: [ENC_HON, ['', 1121, NOM['1121'], '410803', 'BOLH', '10', '2026-02-12', '2026-02-19', 'Taller', '11111111-1', 'Nombre', 80000, 80000, '']],
      HON_PROYECCION: [ENC_PROY, [1121, NOM['1121'], '410803', 'x', ...meses(5000), 60000]],
    });
    await clickTab(h.page, 'SEP');
    const antes = await docs(h);
    await h.clearWrites();
    const r = await subirYConfirmar(h, 'sep', libro);
    t.ok(r.control.abierto && /Revisar carga · SEP/.test(r.control.titulo), 'aparece el resumen de control antes de escribir', r.control.titulo);
    t.ok(/INGRESO.*REMUNERACIONES.*COMPRAS.*BYS_PROYECCION.*HONORARIOS.*HON_PROYECCION/.test(r.control.texto) && /Suma de MontoGasto/.test(r.control.texto), 'el resumen trae las 6 hojas y el detalle de COMPRAS', r.control.texto.slice(0, 600));
    t.ok(/aplicado y verificado/.test(r.resultado.texto) && !/NO cuadra/.test(r.resultado.texto), 'la cuadratura posterior dice que el panel coincide con el Excel', r.resultado.texto.slice(0, 300));
    t.eq(h.dialogs.length, 0, 'ningún alert suelto (todo va por el modal)');
    const d1121 = await doc(h, '1121'), d1122 = await doc(h, '1122');
    const cs1 = Object.values(d1121.compras), cs2 = Object.values(d1122.compras);
    t.eq(suma([...cs1, ...cs2].map(c => c.montoGasto)), 100000 + 250000 + 75500 - 20000, 'COMPRAS: suma de MontoGasto exacta, con la nota de crédito en negativo');
    t.eq(cs2.find(c => c.nroDocumento === '201').montoGasto, -20000, 'la nota de crédito quedó en negativo');
    t.eq(d1121.ingreso_items['Ingreso SEP Preferente'].total, 12 * cargaInicial.ing, 'INGRESO: Total Año exacto');
    t.eq(d1121.ingreso_items['Carrera Docente'].total, 360000, 'INGRESO: Carrera Docente');
    t.eq(d1122.ingreso_items['Ingreso SEP Prioritario'].total, 6000000, 'INGRESO: 1122');
    t.eq(d1121.rem.total, 12 * cargaInicial.rem, 'REMUNERACIONES: total exacto');
    t.eq(d1121.rem.real_hasta_mes, 5, 'rem.real_hasta_mes (ninguna hoja lo trae) NO se tocó');
    t.eq(d1121.ingreso_real_hasta_mes, 4, 'ingreso_real_hasta_mes NO se tocó');
    t.eq(Object.keys(d1121.bys_proyeccion.items), ['410605'], 'BYS_PROYECCION: un ítem');
    t.eq(Object.keys(d1121.honorarios).length, 1, 'HONORARIOS: una boleta');
    t.eq(d1121.hon_proyeccion.items['410803'].total, 60000, 'HON_PROYECCION: total exacto');
    const despues = await docs(h);
    const camposGestionados = ['compras', 'ingreso_items', 'rem', 'bys_proyeccion', 'honorarios', 'hon_proyeccion'];
    const intactos = Object.keys(antes).filter(p => { const a = clon(antes[p]), b = clon(despues[p]); camposGestionados.forEach(c => { delete a[c]; delete b[c]; }); return JSON.stringify(a) !== JSON.stringify(b); });
    t.eq(intactos, [], 'fuera de los campos que gestionan las hojas (otras_fuentes, fondos_fijos, _meta, nombre…) NINGÚN documento cambió');
    t.eq(clon((await h.store())['sep_carga_rbd/_meta']).mes_cierre, antes['sep_carga_rbd/_meta'].mes_cierre, 'el mes de cierre global (_meta) no cambió');
    t.ok(escribioSep(await h.writes()).every(w => w.options && Array.isArray(w.options.mergeFields)), 'todas las escrituras usan mergeFields (reemplazo del campo completo, no merge)');
    // la pantalla ya muestra lo nuevo (sin recargar): exportar justo después
    const x = await exportarSep(h);
    t.eq(suma(hoja(x, 'COMPRAS').map(r => r[11])), 100000 + 250000 + 75500 - 20000, 'el ⬇ Excel justo después tiene la misma suma de MontoGasto');
    t.noErrores(h);
  });

  // ======================= 2. El MISMO Excel dos veces: sin cambios ni escrituras =======================
  await escenario(t, 'mismo Excel dos veces', async () => {
    const x = await exportarSep(h);
    await h.clearWrites();
    const antes = await docs(h);
    const r = await subirYConfirmar(h, 'sep', x.buffer, { nombre: x.filename });
    t.ok(/idéntico a lo que ya hay/.test(r.control.texto), 'el resumen dice que el archivo es idéntico', r.control.texto.slice(0, 400));
    t.ok(/Sin cambios/.test(r.resultado.texto), 'confirmar no cambia nada');
    t.eq(escribioSep(await h.writes()).length, 0, 'no se escribió NADA en Firestore');
    t.eq(await docs(h), antes, 'los documentos son los mismos (sin duplicados)');
  });

  // ======================= 3. Modificada = una; eliminadas desaparecen; entidad ausente vacía; hoja ausente se conserva =======================
  await escenario(t, 'modificada / eliminada / ausente / hoja ausente', async () => {
    const x = await exportarSep(h);
    const filas = hoja(x, 'COMPRAS');
    const f100 = filas.find(r => String(r[5]) === '100'), f101 = filas.find(r => String(r[5]) === '101'), f200 = filas.find(r => String(r[5]) === '200');
    const nuevas = [
      [...f100.slice(0, 3), '410605', ...f100.slice(4)],                                                  // 100: cambia el código de cuenta
      [f101[0], ...f101.slice(1, 5), '101-B', f101[6], '2026-06-30', ...f101.slice(8)],                     // 101: cambia N° documento y FechaPago
      ['', ...f200.slice(1, 7), '2026-05-05', ...f200.slice(8)],                                           // 200: SIN ID y con otra fecha de pago (antes: duplicada con otra clave imp-)
    ];                                                                                                     // 201 (NC) eliminada
    const libro = await lib(h, { COMPRAS: [ENC_COMPRAS_SEP, ...nuevas] });
    await h.clearWrites();
    const antes = await docs(h);
    const r = await subirYConfirmar(h, 'sep', libro);
    t.ok(/aplicado y verificado/.test(r.resultado.texto), 'carga aplicada y cuadrada', r.resultado.texto.slice(0, 300));
    const cs = [...Object.entries((await doc(h, '1121')).compras), ...Object.entries((await doc(h, '1122')).compras)].map(([id, c]) => c);
    t.eq(cs.length, 3, 'quedan EXACTAMENTE 3 compras (la eliminada desapareció; las modificadas no se duplicaron)');
    t.eq(orden(cs.map(c => [c.codigo, c.nroDocumento, c.fechaPago, c.montoGasto])), orden([['410605', '100', '2026-03-20', 100000], ['410605', '101-B', '2026-06-30', 250000], ['410606', '200', '2026-05-05', 75500]]), 'cada fila modificada quedó UNA vez con su valor nuevo');
    t.ok(/no viene en el archivo: se conserva/i.test(r.control.texto), 'el resumen dice que las hojas ausentes se conservan', r.control.texto.slice(0, 500));
    const despues = await docs(h);
    ['ingreso_items', 'rem', 'bys_proyeccion', 'honorarios', 'hon_proyeccion'].forEach(c => t.eq(despues['sep_carga_rbd/1121'][c], antes['sep_carga_rbd/1121'][c], `hoja ausente: ${c} se conserva`));
    t.eq(await h.page.evaluate(() => window.__mockfb.store['sep_carga_rbd/1122'].compras), (await h.store())['sep_carga_rbd/1122'].compras, 'consistente');
    // entidad ausente de COMPRAS (1122 tenía 1 antes de cargar solo 1121): la clave se borra
    const libro2 = await lib(h, { COMPRAS: [ENC_COMPRAS_SEP, nuevas[0]] });
    await subirYConfirmar(h, 'sep', libro2);
    t.eq((await doc(h, '1122')).compras, {}, 'la entidad ausente de la hoja COMPRAS (1122) quedó sin compras en el servidor (deleteField/mergeFields reemplaza)');
    t.eq(Object.keys((await doc(h, '1121')).compras).length, 1, '1121 conserva la única fila del archivo');
  });

  // ======================= 4. Idénticas = 2 filas; ID repetido = ambas =======================
  await escenario(t, 'idénticas e ID repetido', async () => {
    const igual = compra({ nroDocumento: '777', montoGasto: 5000, montoDocumento: 5950 });
    const libro = await lib(h, { COMPRAS: [ENC_COMPRAS_SEP, FILA('', '1121', igual), FILA('', '1121', igual), FILA('', '1121', igual), FILA('mismo', '1122', compra({ nroDocumento: '1', montoGasto: 11 })), FILA('mismo', '1122', compra({ nroDocumento: '2', montoGasto: 22 }))] });
    const r = await subirYConfirmar(h, 'sep', libro);
    t.ok(/ID repetido/.test(r.control.texto), 'el resumen avisa del ID repetido dentro del archivo', r.control.texto.slice(0, 1200));
    const c1 = Object.entries((await doc(h, '1121')).compras), c2 = Object.entries((await doc(h, '1122')).compras);
    t.eq(c1.length, 3, 'tres filas idénticas del Excel = TRES filas en el panel (sin dedupe)');
    t.eq(new Set(c1.map(([id]) => id)).size, 3, 'con tres IDs distintos y deterministas');
    t.eq(orden(c2.map(([id, c]) => [id, c.nroDocumento, c.montoGasto])), orden([['mismo', '1', 11], ['mismo-dup2', '2', 22]]), 'el mismo ID dos veces: ambas filas existen (la segunda con -dup2)');
    await h.clearWrites();
    const r2 = await subirYConfirmar(h, 'sep', libro);
    t.ok(/idéntico a lo que ya hay/.test(r2.control.texto), 'subir otra vez el mismo archivo no cambia nada (claves deterministas)', r2.control.texto.slice(0, 300));
    t.eq(escribioSep(await h.writes()).length, 0, 'y no escribe');
  });
  await h.close();

  // ======================= 5. DC_247: 53 antiguas + 66 nuevas = 66, y Deshacer =======================
  await escenario(t, 'DC_247 y Deshacer', async () => {
    const h3 = await boot({ autoCarga: false, fixture: base });
    await clickTab(h3.page, 'SEP');
    const viejas = Array.from({ length: 53 }, (_, i) => FILA('', '1121', compra({ nroDocumento: 'V' + i, montoGasto: 1000 + i, montoDocumento: 1000 + i, documentoContable: 'DC_247' })));
    await subirYConfirmar(h3, 'sep', await lib(h3, { COMPRAS: [ENC_COMPRAS_SEP, ...viejas] }));
    t.eq(Object.keys((await doc(h3, '1121')).compras).length, 53, 'versión anterior: 53 filas en DC_247');
    const nuevas = Array.from({ length: 66 }, (_, i) => FILA('', '1121', compra({ nroDocumento: i < 53 ? 'V' + i : 'N' + i, codigo: i % 3 === 0 ? '410605' : '410606', fechaPago: i % 2 ? '2026-04-01' : '2026-03-20', montoGasto: 1000 + i, montoDocumento: 1000 + i, documentoContable: 'DC_247' })));
    const r = await subirYConfirmar(h3, 'sep', await lib(h3, { COMPRAS: [ENC_COMPRAS_SEP, ...nuevas] }), { cerrar: true });
    t.ok(/DC_247/.test(r.control.texto), 'el resumen muestra la diferencia por N° DC (DC_247)', r.control.texto.slice(-700));
    const cs = Object.values((await doc(h3, '1121')).compras);
    t.eq(cs.length, 66, 'DC_247 queda con 66 filas (NO 53 + 66 = 119)');
    t.eq(suma(cs.map(c => c.montoGasto)), suma(nuevas.map(f => f[11])), 'y la suma de MontoGasto es la de la versión nueva');
    t.eq(cs.filter(c => c.documentoContable === 'DC_247').length, 66, 'las 66 con N° DC');
    // sin columna N° DC: el DC anterior NO se hereda
    const sinDc = nuevas.map(f => f.slice(0, 14));
    await subirYConfirmar(h3, 'sep', await lib(h3, { COMPRAS: [ENC_COMPRAS_SEP.slice(0, 14), ...sinDc] }));
    t.eq(Object.values((await doc(h3, '1121')).compras).filter(c => c.documentoContable).length, 0, 'un Excel sin columna N° DC deja las compras SIN N° DC (no hereda el anterior)');
    // Deshacer: vuelve al estado anterior a la última carga (66 con DC)
    await h3.page.click('#undoCargaOFBtn-sep'); await h3.page.waitForSelector('#cargaOkBtn');
    const ctl = await leerModalCarga(h3.page);
    t.ok(/Deshacer última carga · SEP/.test(ctl.titulo), 'Deshacer abre su propio resumen con confirmación', ctl.titulo);
    await h3.page.click('#cargaOkBtn'); await h3.page.waitForSelector('#cargaCerrarBtn'); await h3.page.click('#cargaCerrarBtn'); await h3.flushWrites(); await h3.waitIdle();
    t.eq(Object.values((await doc(h3, '1121')).compras).filter(c => c.documentoContable === 'DC_247').length, 66, 'Deshacer vuelve a las 66 con DC_247');
    t.eq(await h3.page.evaluate(() => document.getElementById('undoCargaOFBtn-sep').classList.contains('hidden')), true, 'y el botón desaparece (respaldo consumido)');
    await h3.close();
  });

  // ======================= 6. Rechazos con motivo; leídas = cargadas + rechazadas =======================
  await escenario(t, 'rechazos', async () => {
    const h4 = await boot({ autoCarga: false, fixture: base });
    await clickTab(h4.page, 'SEP');
    const libro = await lib(h4, {
      COMPRAS: [ENC_COMPRAS_SEP,
        FILA('', '1121', compra({ nroDocumento: '1', montoGasto: 1000 })),
        FILA('', '1121', compra({ nroDocumento: '2', codigo: '999999' })), FILA('', '1121', compra({ nroDocumento: '3', fechaDocumento: '' })), FILA('', '1121', compra({ nroDocumento: '4', montoGasto: 0 })),
        FILA('', '9999', compra({ nroDocumento: '5' })), FILA('', '1122', compra({ nroDocumento: '6', montoGasto: '1.500.000', montoDocumento: '1.785.000' })), FILA('', '1122', compra({ nroDocumento: '7', montoGasto: 'abc' }))],
      INGRESO: [ENC_ING, [1121, 'x', 'Ingreso Raro', ...new Array(12).fill(5), 60], [1121, 'x', 'Carrera Docente', ...new Array(12).fill(7), 84]],
      BYS_PROYECCION: [ENC_PROY, [1121, 'x', '999999', 'x', ...new Array(12).fill(1), 12]],
      HONORARIOS: [ENC_HON, ['', 1121, 'x', '410803', 'FAC', '1', '2026-01-01', '', 'd', 'r', 'n', 100, 100, '']],
    });
    const r = await subirYConfirmar(h4, 'sep', libro);
    t.ok(/Filas que NO se cargarán \(8\)/.test(r.control.texto), 'el resumen cuenta las 8 filas rechazadas', r.control.texto.slice(-1500));
    for (const motivo of ['no está en el catálogo de cuentas de compras', 'falta la fecha del documento', 'el monto gasto está vacío o es 0', 'no es parte de SEP', 'el monto gasto no es un número', 'no es uno de los ítems de ingreso de SEP', 'no está en el catálogo de cuentas de Bienes y Servicios de SEP', 'no es de honorarios']) t.ok(r.control.texto.includes(motivo), `motivo visible: ${motivo}`);
    t.ok(/Hoja COMPRAS, fila 3:/.test(r.control.texto) && /Hoja INGRESO, fila 2:/.test(r.control.texto), 'cada rechazo trae hoja y número de fila de Excel');
    t.ok(/COMPRAS 0 \$0 7 5 2 \$1\.501\.000/.test(r.control.texto), 'COMPRAS: leídas (7) = cargadas (2) + rechazadas (5)', (r.control.texto.match(/COMPRAS[^A-Z]{0,80}/) || [''])[0]);
    const d = await doc(h4, '1121');
    t.eq(orden(Object.values(d.compras).map(c => [c.nroDocumento, c.montoGasto])), orden([['1', 1000]]), '1121: solo la fila válida');
    t.eq(Object.values((await doc(h4, '1122')).compras).map(c => c.montoGasto), [1500000], '«1.500.000» como texto se lee como 1500000');
    t.eq(Object.keys(d.ingreso_items), ['Carrera Docente'], 'INGRESO: el ítem desconocido se rechazó y el válido se cargó');
    await h4.close();
  });

  // ======================= 7. Cancelar / Esc no escriben; cuadratura con desajuste; Vaciar (solo admin) =======================
  await escenario(t, 'cancelar, cuadratura y vaciar', async () => {
    const h5 = await boot({ autoCarga: false, fixture: 'fondos_fijos' });
    await clickTab(h5.page, 'SEP');
    const antes = await docs(h5);
    await h5.clearWrites();
    const r = await subirYConfirmar(h5, 'sep', await lib(h5, { COMPRAS: [ENC_COMPRAS_SEP], INGRESO: [ENC_ING] }), { confirmar: false, cerrar: false });
    t.ok(/se eliminarán todas las filas|SIN filas válidas/.test(r.control.texto), 'avisa que una hoja vacía eliminaría todo lo que hay hoy', r.control.texto.slice(0, 600));
    const a11y = await h5.page.evaluate(() => { const p = document.querySelector('#cargaControlModal .modal-panel'); return { rol: p.getAttribute('role'), modal: p.getAttribute('aria-modal'), foco: p.contains(document.activeElement) }; });
    t.ok(a11y.rol === 'dialog' && a11y.modal === 'true' && a11y.foco, 'el resumen es un diálogo accesible con el foco dentro', JSON.stringify(a11y));
    await h5.page.keyboard.press('Escape'); await h5.waitIdle();
    t.eq((await leerModalCarga(h5.page)).abierto, false, 'Escape cancela');
    t.eq(escribioSep(await h5.writes()).length, 0, 'Cancelar no escribió nada');
    t.eq(await docs(h5), antes, 'ni cambió ningún documento');
    // cuadratura
    await h5.page.evaluate(() => { window.__cargaTestHook = (fase, fk, cm) => { if (fase === 'memoria' || fase === 'guardado') { const c = cm.compras_por_rbd['1121']; delete c[Object.keys(c)[0]]; } }; });
    const rc = await subirYConfirmar(h5, 'sep', await lib(h5, { COMPRAS: [ENC_COMPRAS_SEP, FILA('', '1121', compra({ nroDocumento: '1', montoGasto: 10 })), FILA('', '1121', compra({ nroDocumento: '2', montoGasto: 20 }))] }), { cerrar: false });
    t.ok(/NO cuadra con el Excel/.test(rc.resultado.texto) && /✗ NO/.test(rc.resultado.texto), 'la cuadratura detecta el desajuste inyectado y marca la hoja con ✗', rc.resultado.texto.slice(0, 400));
    const m = await leerModalCarga(h5.page);
    t.ok(/NO cuadra con el Excel en COMPRAS \(esperado 2 filas.*obtenido 1 filas/.test(m.banner), 'banner rojo persistente con hoja, esperado y obtenido', m.banner);
    await h5.page.click('#cargaCerrarBtn'); await h5.waitIdle();
    t.ok((await leerModalCarga(h5.page)).banner !== '', 'el banner sigue al cerrar el modal');
    await h5.page.click('#cargaBannerCerrar');
    await h5.page.evaluate(() => { window.__cargaTestHook = null; });
    await h5.close();

    const h6 = await boot({ autoCarga: false, fixture: 'fondos_fijos' });
    await clickTab(h6.page, 'SEP');
    t.eq(await h6.page.evaluate(() => !document.getElementById('vaciarOFBtn-sep').classList.contains('hidden')), true, '«Vaciar SEP» se ve para administración');
    const previo = await docs(h6);
    const previoExport = await exportarSep(h6);
    await h6.page.click('#vaciarOFBtn-sep'); await h6.page.waitForSelector('#cargaConfirmaNombre');
    t.eq(await h6.page.evaluate(() => document.getElementById('cargaOkBtn').disabled), true, 'sin escribir el nombre el botón está deshabilitado');
    await h6.page.fill('#cargaConfirmaNombre', 'sep');
    t.eq(await h6.page.evaluate(() => document.getElementById('cargaOkBtn').disabled), false, 'con el nombre se habilita');
    await h6.page.click('#cargaOkBtn'); await h6.page.waitForSelector('#cargaCerrarBtn'); await h6.page.click('#cargaCerrarBtn'); await h6.flushWrites(); await h6.waitIdle();
    const post = await docs(h6);
    const vacio = Object.keys(post).filter(p => p !== 'sep_carga_rbd/_meta' && (Object.keys(post[p].compras || {}).length || Object.keys(post[p].honorarios || {}).length || Object.keys(post[p].ingreso_items || {}).length || (post[p].rem && post[p].rem.total) || Object.keys((post[p].bys_proyeccion || {}).items || {}).length));
    t.eq(vacio, [], 'SEP quedó vacío en lo que gestiona el importador (compras, honorarios, ingresos, rem, proyección)');
    const intactos = Object.keys(previo).filter(p => { const a = clon(previo[p]), b = clon(post[p]); ['compras', 'ingreso_items', 'honorarios', 'hon_proyeccion', 'bys_proyeccion'].forEach(c => { delete a[c]; delete b[c]; }); if (a.rem) { delete a.rem.meses; delete a.rem.total; } if (b.rem) { delete b.rem.meses; delete b.rem.total; } return JSON.stringify(a) !== JSON.stringify(b); });
    t.eq(intactos, [], 'Vaciar no tocó cortes, otras fuentes, Fondos Fijos ni el mes de cierre');
    await h6.page.click('#undoCargaOFBtn-sep'); await h6.page.waitForSelector('#cargaOkBtn'); await h6.page.click('#cargaOkBtn');
    await h6.page.waitForSelector('#cargaCerrarBtn'); await h6.page.click('#cargaCerrarBtn'); await h6.flushWrites(); await h6.waitIdle();
    t.eq((await exportarSep(h6)).libro.hojas, previoExport.libro.hojas, 'Deshacer el vaciado devuelve TODO lo que el Excel exporta, igual que antes');
    const pos2 = await docs(h6);
    const ajeno = Object.keys(previo).filter(p => { const a = clon(previo[p]), b = clon(pos2[p]); ['compras', 'ingreso_items', 'honorarios', 'hon_proyeccion', 'bys_proyeccion', 'rem'].forEach(c => { delete a[c]; delete b[c]; }); return JSON.stringify(a) !== JSON.stringify(b); });
    t.eq(ajeno, [], 'y lo que no gestiona el importador sigue idéntico');
    await h6.close();
    const h7 = await boot({ autoCarga: false, fixture: 'default', user: 'authorized-nonadmin' });
    await clickTab(h7.page, 'SEP');
    t.eq(await h7.page.evaluate(() => document.getElementById('vaciarOFBtn-sep').classList.contains('hidden')), true, 'una persona sin permisos de administración NO ve «Vaciar SEP»');
    await h7.close();
  });

  // ======================= 8. Respaldo descargado: reimportable; hon. 70/30 intacto con COMPRAS sola; Excel grande =======================
  await escenario(t, 'respaldo y honorarios', async () => {
    const h8 = await boot({ autoCarga: false, fixture: 'honorarios' });
    await clickTab(h8.page, 'SEP');
    await subirYConfirmar(h8, 'sep', (await exportarSep(h8)).buffer); // purga primero las boletas inválidas a propósito del fixture
    await clickTab(h8.page, 'SEP');
    const filaRbd = () => h8.page.evaluate(() => Array.from(document.querySelectorAll('#tableBody tr')).map(tr => tr.innerText.replace(/\s+/g, ' ')).join('|'));
    const tablaAntes = await filaRbd();
    const honAntes = clon(Object.fromEntries(Object.entries(await h8.store()).map(([p, d]) => [p, d.honorarios || null])));
    const { respaldo } = await confirmarCapturando(h8, await lib(h8, { COMPRAS: [ENC_COMPRAS_SEP, FILA('', '1121', compra({ nroDocumento: 'Z', montoGasto: 1 }))] }));
    t.ok(/^respaldo_sep_.*\.xlsx$/.test(respaldo.filename), 'se descargó el respaldo del estado anterior', respaldo.filename);
    t.eq(clon(Object.fromEntries(Object.entries(await h8.store()).map(([p, d]) => [p, d.honorarios || null]))), honAntes, 'HONORARIOS ausente del archivo: las boletas (y su parte del 70 % personal) NO se alteran');
    // el respaldo se reimporta con el mismo botón y devuelve el estado anterior (round-trip del propio respaldo)
    const r = await subirYConfirmar(h8, 'sep', respaldo.buffer, { nombre: respaldo.filename });
    t.ok(/aplicado y verificado/.test(r.resultado.texto), 'reimportar el respaldo cuadra', r.resultado.texto.slice(0, 200));
    t.eq(await filaRbd(), tablaAntes, 'tras reimportar el respaldo la tabla principal (ejecución, estado, %) es la de antes de cargar');
    // con HONORARIOS presente SÍ reemplaza
    await subirYConfirmar(h8, 'sep', await lib(h8, { HONORARIOS: [ENC_HON, ['', 1121, 'x', '410803', 'BOLH', '10', '2026-02-12', '2026-02-19', 'Taller', '11111111-1', 'Nombre', 80000, 80000, '']] }));
    const st = await h8.store();
    t.eq(Object.keys(st).filter(p => Object.keys(st[p].honorarios || {}).length).sort(), ['sep_carga_rbd/1121'], 'HONORARIOS presente: reemplaza (solo queda la boleta del archivo)');
    await h8.close();
  });
  await escenario(t, 'excel grande', async () => {
    const h9 = await boot({ autoCarga: false, fixture: base });
    await clickTab(h9.page, 'SEP');
    const rbds = Object.keys(base).filter(k => /^\d+$/.test(k) && base[k].ingreso_items !== undefined).slice(0, 50);
    const N = 3200;
    const filas = Array.from({ length: N }, (_, i) => FILA('', rbds[i % rbds.length], compra({ nroDocumento: String(10000 + i), montoGasto: 1000 + (i % 97) * 13, montoDocumento: 1200 + (i % 97) * 13, fechaDocumento: `2026-${String(1 + (i % 7)).padStart(2, '0')}-10` })));
    const esperado = suma(filas.map(f => f[11]));
    const t0 = Date.now();
    const r = await subirYConfirmar(h9, 'sep', await lib(h9, { COMPRAS: [ENC_COMPRAS_SEP, ...filas] }), { nombre: 'grande.xlsx' });
    const st = await h9.store();
    const cs = Object.keys(st).filter(p => p.startsWith('sep_carga_rbd/')).flatMap(p => Object.values(st[p].compras || {}));
    t.eq(cs.length, N, `${N} filas de COMPRAS guardadas`);
    t.eq(suma(cs.map(c => c.montoGasto)), esperado, 'suma de MontoGasto exacta');
    t.ok(/aplicado y verificado/.test(r.resultado.texto), 'cuadra', r.resultado.texto.slice(0, 200));
    t.info(`carga de ${N} compras en SEP: ${Date.now() - t0} ms`);
    await h9.close();
  });
});
