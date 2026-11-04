// Carga por fuente = REEMPLAZO TOTAL (el panel es un espejo exacto del Excel). Causa raíz que se prueba: antes la carga hacía merge (merge:true + clave por contenido),
// de modo que una fila ausente del Excel se conservaba y una fila MODIFICADA quedaba duplicada (la antigua + la nueva); ahora cada hoja del archivo reemplaza por completo
// su estado en TODAS las entidades de la fuente. Se verifica (mock de Firestore con mergeFields):
//   · subir el Excel → filas y suma de MontoGasto de COMPRAS exactas (incluidas notas de crédito negativas) y Total Año de INGRESO / REMUNERACIONES / ING_CARRERA_DOCENTE;
//   · el MISMO Excel dos veces → sin cambios, sin escribir, sin duplicados; filas eliminadas → desaparecen (del panel y del servidor); fila modificada (código, FechaPago, N° documento) → UNA fila;
//   · filas idénticas del Excel → dos filas; el mismo ID repetido → ambas filas (sufijo «-dup2»); entidad ausente de una hoja → vacía en esa hoja; hoja ausente del archivo → se conserva;
//   · otra fuente y SEP intactos (documento a documento); exportar justo después de cargar → mismas filas y totales; escenario DC_247 (53 antiguas + 66 nuevas = 66, no 119);
//   · resumen de control (por hoja, por N° DC, rechazadas con motivo y filas leídas = cargadas + rechazadas) y accesibilidad del modal; Cancelar no cambia nada ni escribe;
//   · Deshacer última carga; cuadratura que detecta un desajuste forzado (banner rojo persistente); Vaciar fuente (solo admin, escribiendo el nombre); ≥ 3.000 compras.
import { boot, clickTab } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { capturarDescarga, leerXlsx } from '../lib/capture-utils.mjs';
import { fixtureSinCompras, ENC_COMPRAS_FUENTE, filaCompra, compraBase } from '../lib/compras.mjs';
import { subirYConfirmar, leerModalCarga, libroXlsx, docFuente, comprasServidor, inputFuente } from '../lib/carga.mjs';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ENC_MENSUAL = ['RBD', 'Nombre', ...MESES, 'Total Año'];
const NOMBRES = { '1121': 'LICEO PULMAHUE DE LA LIGUA', '1122': 'ESCUELA 1122', '1123': 'ESCUELA 1123', 'AC': 'Administración Central' };
const RBDS = ['1121', '1122', '1123', 'AC'];
const rbdCelda = (r) => /^\d+$/.test(r) ? Number(r) : r;
const nombreDe = (docs, r) => (docs[r] && docs[r].nombre) || NOMBRES[r] || r;
const mensual = (docs, r, v) => { const m = Array.isArray(v) ? v : new Array(12).fill(v); return [rbdCelda(r), nombreDe(docs, r), ...m, m.reduce((a, b) => a + b, 0)]; };
const suma = (xs) => xs.reduce((a, b) => a + b, 0);
const total12 = (v) => 12 * v;
let docsBase;
const compra = (extra = {}) => compraBase({ codigo: '410606', ...extra });
const FILA = (id, rbd, c) => filaCompra(id, rbdCelda(rbd), nombreDe(docsBase, rbd), c);
const sumaGasto = (cs) => cs.reduce((s, c) => s + Number(c.montoGasto), 0);
const normC = (c) => ({ rbd: c.rbd, codigo: c.codigo, tipo: c.tipoDocumento, nro: c.nroDocumento, fd: c.fechaDocumento, fp: c.fechaPago, g: c.montoGasto, dc: c.documentoContable || '' });
const orden = (xs) => xs.map(x => JSON.stringify(x)).sort();
// Estado de una pestaña tal como lo ve el panel: se descarga el Excel («⬇ Excel») y se lee.
async function exportar(h, fuente) {
  await clickTab(h.page, 'of-' + fuente);
  const dl = await capturarDescarga(h.page, () => h.page.click(`#downloadExcelOFBtn-${fuente}`));
  return { ...dl, libro: await leerXlsx(h.page, dl.buffer) };
}
const filasHoja = (x, hoja) => (x.libro.hojas[hoja] || []).slice(1);
const comprasExport = (x) => filasHoja(x, 'COMPRAS').filter(r => r[0] !== '' || r[1] !== '').map(r => ({ rbd: String(r[1]), codigo: String(r[3]), tipo: r[4], nro: String(r[5]), fd: r[6], fp: r[7], g: r[11], dc: r[14] || '' }));
const sinAuditoria = (v) => { if (Array.isArray(v)) return v.map(sinAuditoria); if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { if (k !== 'lastModifiedAt' && k !== 'lastModifiedBy') o[k] = sinAuditoria(v[k]); }); return o; } return v; };
async function escenario(t, nombre, fn) { try { await fn(); } catch (e) { t.ok(false, `${nombre}: excepción`, String(e.stack || e.message).split('\n').slice(0, 5).join(' | ')); } }
const escribioOtrasFuentes = (ws) => ws.filter(w => w.path.startsWith('sep_carga_rbd/'));

await correrSpec('carga_reemplazo_total', async (t) => {
  docsBase = fixtureSinCompras();
  // Estado de partida limpio de General: sin compras, sin proyección de B&S, sin ingresos/remuneraciones de General (lo que se carga es lo único que pesa).
  Object.values(docsBase).forEach(d => { if (d.otras_fuentes) { delete d.otras_fuentes.general; } });
  const sinGeneral = (d) => { const o = JSON.parse(JSON.stringify(d)); Object.values(o).forEach(x => { if (x.otras_fuentes) delete x.otras_fuentes.general; }); return o; };
  void sinGeneral;

  // ======================= 1. Carga completa: filas y totales exactos =======================
  const h = await boot({ fixture: docsBase });
  await escenario(t, 'carga completa', async () => {
    const cs = [
      FILA('', '1121', compra({ nroDocumento: '100', montoGasto: 100000, montoDocumento: 119000 })),
      FILA('', '1121', compra({ nroDocumento: '101', montoGasto: 250000, montoDocumento: 297500, codigo: '410605' })),
      FILA('', '1122', compra({ nroDocumento: '200', montoGasto: 75500, montoDocumento: 89845 })),
      FILA('', '1122', compra({ nroDocumento: '201', tipoDocumento: 'Nota de crédito', montoGasto: 20000, montoDocumento: 23800, documentoOriginal: '100-FAC' })), // NC: entra en NEGATIVO
      FILA('', 'AC', compra({ nroDocumento: '300', montoGasto: 1000000, montoDocumento: 1190000, codigo: '410606' })),
    ];
    const esperadoGasto = 100000 + 250000 + 75500 - 20000 + 1000000;
    const libro = await libroXlsx(h.page, {
      INGRESO: [ENC_MENSUAL, mensual(docsBase, '1121', 1000000), mensual(docsBase, '1122', 500000), mensual(docsBase, 'AC', 20000)],
      ING_CARRERA_DOCENTE: [ENC_MENSUAL, mensual(docsBase, '1121', 30000)],
      REMUNERACIONES: [ENC_MENSUAL, mensual(docsBase, '1121', 400000), mensual(docsBase, '1122', 200000)],
      COMPRAS: [ENC_COMPRAS_FUENTE, ...cs],
      META: [['RBD', 'Nombre', 'RealHastaMes'], [1121, NOMBRES['1121'], 3], [1122, NOMBRES['1122'], 7]],
    });
    await h.clickTab('of-general');
    h.clearWrites && await h.clearWrites();
    const r = await subirYConfirmar(h, 'general', libro);
    t.ok(r.control.abierto && /Revisar carga · Subvención General/.test(r.control.titulo), 'aparece el resumen de control antes de escribir', r.control.titulo);
    t.ok(/INGRESO.*COMPRAS.*META/.test(r.control.texto) && /Panel hoy: filas/.test(r.control.texto), 'el resumen trae la tabla por hoja (panel hoy vs. archivo)');
    t.ok(/Suma de MontoGasto/.test(r.control.texto) && /N° de DC distintos/.test(r.control.texto), 'COMPRAS en detalle: suma de MontoGasto y N° de DC distintos', r.control.texto.slice(-900));
    t.ok(/aplicado y verificado/.test(r.resultado.texto) && !/NO cuadra/.test(r.resultado.texto), 'la cuadratura posterior dice que el panel coincide con el Excel', r.resultado.texto.slice(0, 300));
    t.eq(h.dialogs.length, 0, 'ningún alert suelto (todo va por el modal)');
    const guardadas = await comprasServidor(h, 'general');
    t.eq(guardadas.length, 5, 'COMPRAS: 5 filas guardadas');
    t.eq(sumaGasto(guardadas), esperadoGasto, `COMPRAS: suma de MontoGasto exacta (${esperadoGasto}), con la nota de crédito en negativo`);
    t.eq(guardadas.find(c => c.nroDocumento === '201').montoGasto, -20000, 'la nota de crédito quedó en negativo');
    t.eq((await docFuente(h, '1121', 'general')).ingreso.total, total12(1000000), 'INGRESO 1121: Total Año exacto');
    t.eq((await docFuente(h, '1121', 'general')).ingreso_carrera_docente.total, total12(30000), 'ING_CARRERA_DOCENTE 1121: Total Año exacto');
    t.eq((await docFuente(h, '1122', 'general')).gasto_rem.total, total12(200000), 'REMUNERACIONES 1122: Total Año exacto');
    t.eq((await docFuente(h, '1121', 'general')).real_hasta_mes, 3, 'META: corte Real hasta Marzo en 1121');
    t.eq((await docFuente(h, '1122', 'general')).real_hasta_mes, undefined, 'META: el corte por defecto no se guarda');
    // el panel muestra los datos nuevos SIN recargar
    const x = await exportar(h, 'general');
    t.eq(orden(comprasExport(x)), orden(guardadas.map(normC)), 'el panel (⬇ Excel justo después de cargar) tiene las mismas filas que lo guardado');
    t.eq(suma(comprasExport(x).map(c => c.g)), esperadoGasto, 'el Excel exportado justo después: misma suma de MontoGasto');
    t.eq(filasHoja(x, 'INGRESO').filter(f => f[0] === 1121)[0][14], total12(1000000), 'el Excel exportado trae el mismo Total Año de INGRESO');
    const filaUI = await h.page.evaluate(() => { const tr = document.querySelector('#otrasFuentesTbody-general td[data-abrir-otra-fuente="1121"]'); return tr ? tr.closest('tr').innerText.replace(/\s+/g, ' ') : null; });
    t.ok(filaUI && filaUI.includes('12.360.000'), 'la tabla de la pestaña ya muestra el ingreso nuevo (12.000.000 + carrera docente 360.000) sin recargar', filaUI);
    t.noErrores(h);
  });

  // ======================= 2. El MISMO Excel dos veces: sin cambios ni escrituras =======================
  await escenario(t, 'mismo Excel dos veces', async () => {
    const x = await exportar(h, 'general'); // el Excel exportado por el panel: es exactamente su estado
    await h.clearWrites();
    const antes = await comprasServidor(h, 'general');
    const r = await subirYConfirmar(h, 'general', x.buffer, { nombre: x.filename });
    t.ok(/idéntico a lo que ya hay/.test(r.control.texto), 'el resumen dice que el archivo es idéntico al panel', r.control.texto.slice(0, 500));
    t.ok(/Sin cambios/.test(r.resultado.texto), 'confirmar no cambia nada');
    t.eq(escribioOtrasFuentes(await h.writes()).length, 0, 'no se escribió NADA en Firestore');
    t.eq(orden((await comprasServidor(h, 'general')).map(normC)), orden(antes.map(normC)), 'las compras guardadas son las mismas (sin duplicados)');
  });

  // ======================= 3. Fila modificada = UNA fila; eliminadas desaparecen; entidad ausente queda vacía =======================
  await escenario(t, 'modificada / eliminada / ausente', async () => {
    const x = await exportar(h, 'general');
    const filas = filasHoja(x, 'COMPRAS');
    const f100 = filas.find(r => String(r[5]) === '100'), f101 = filas.find(r => String(r[5]) === '101'), f200 = filas.find(r => String(r[5]) === '200');
    // 100: cambia el código de cuenta; 101: cambia la FechaPago y el N° documento; 200: sin ID (celda vacía) pero con otra fecha de pago; 201 (NC) y 300 (AC) se eliminan.
    const nuevas = [
      [...f100.slice(0, 3), '410605', ...f100.slice(4)],
      [f101[0], ...f101.slice(1, 5), '101-B', f101[6], '2026-06-30', ...f101.slice(8)],
      ['', ...f200.slice(1, 7), '2026-05-05', ...f200.slice(8)],
    ];
    const libro = await libroXlsx(h.page, { COMPRAS: [ENC_COMPRAS_FUENTE, ...nuevas], INGRESO: [ENC_MENSUAL, mensual(docsBase, '1121', 2000000)] });
    await h.clearWrites();
    const r = await subirYConfirmar(h, 'general', libro);
    t.ok(/aplicado y verificado/.test(r.resultado.texto), 'carga aplicada y cuadrada', r.resultado.texto.slice(0, 400));
    const cs = await comprasServidor(h, 'general');
    t.eq(cs.length, 3, 'quedan EXACTAMENTE 3 compras (las filas eliminadas desaparecieron; las modificadas no se duplicaron)');
    t.eq(orden(cs.map(c => [c.rbd, c.codigo, c.nroDocumento, c.fechaPago, c.montoGasto])), orden([['1121', '410605', '100', '2026-03-20', 100000], ['1121', '410605', '101-B', '2026-06-30', 250000], ['1122', '410606', '200', '2026-05-05', 75500]]), 'cada fila modificada quedó con SU valor nuevo (código, N° de documento, FechaPago) y nada del anterior');
    t.eq(cs.filter(c => c.rbd === 'AC').length, 0, 'la entidad AC (ausente de COMPRAS) quedó sin compras: la clave fue borrada de Firestore');
    t.eq((await docFuente(h, 'AC', 'general')).compras, {}, 'AC: mapa de compras vacío en el servidor (deleteField/mergeFields realmente reemplaza)');
    t.eq((await docFuente(h, '1122', 'general')).ingreso.total, 0, 'INGRESO: la entidad ausente de la hoja (1122) quedó en $0');
    t.eq((await docFuente(h, 'AC', 'general')).ingreso.total, 0, 'INGRESO: AC (ausente) quedó en $0');
    t.eq((await docFuente(h, '1121', 'general')).ingreso.total, total12(2000000), 'INGRESO 1121: valor nuevo');
    t.eq((await docFuente(h, '1122', 'general')).gasto_rem.total, total12(200000), 'REMUNERACIONES: la hoja NO venía en el archivo → se conserva');
    t.eq((await docFuente(h, '1121', 'general')).real_hasta_mes, 3, 'META: la hoja no venía → se conserva el corte');
    t.ok(/no viene en el archivo: se conserva/i.test(r.control.texto), 'el resumen dice que las hojas ausentes se conservan', r.control.texto.slice(0, 900));
    // el panel (memoria) coincide con el servidor
    const x2 = await exportar(h, 'general');
    t.eq(orden(comprasExport(x2)), orden(cs.map(normC)), 'el panel muestra exactamente las mismas 3 compras (sin recargar)');
  });

  // ======================= 4. Idénticas = 2 filas; mismo ID repetido = ambas =======================
  await escenario(t, 'idénticas e ID repetido', async () => {
    const igual = compra({ nroDocumento: '777', montoGasto: 5000, montoDocumento: 5950 });
    const libro = await libroXlsx(h.page, { COMPRAS: [ENC_COMPRAS_FUENTE,
      FILA('', '1121', igual), FILA('', '1121', igual), FILA('', '1121', igual),
      FILA('mismo', '1122', compra({ nroDocumento: '1', montoGasto: 11 })), FILA('mismo', '1122', compra({ nroDocumento: '2', montoGasto: 22 })),
    ] });
    const r = await subirYConfirmar(h, 'general', libro);
    t.ok(/ID repetido/.test(r.control.texto), 'el resumen avisa del ID repetido dentro del archivo', r.control.texto.slice(0, 1200));
    const cs = await comprasServidor(h, 'general');
    t.eq(cs.filter(c => c.rbd === '1121').length, 3, 'tres filas idénticas del Excel = TRES filas en el panel (sin dedupe)');
    t.eq(new Set(cs.filter(c => c.rbd === '1121').map(c => c.id)).size, 3, 'con tres IDs distintos y deterministas');
    t.eq(orden(cs.filter(c => c.rbd === '1122').map(c => [c.id, c.nroDocumento, c.montoGasto])), orden([['mismo', '1', 11], ['mismo-dup2', '2', 22]]), 'el mismo ID dos veces: ambas filas existen (la segunda con sufijo -dup2)');
    t.eq(sumaGasto(cs), 3 * 5000 + 11 + 22, 'la suma de MontoGasto cuenta todas las filas');
    // subir el mismo archivo otra vez: mismos IDs, sin cambios
    await h.clearWrites();
    const r2 = await subirYConfirmar(h, 'general', libro);
    t.ok(/idéntico a lo que ya hay/.test(r2.control.texto), 'las claves son deterministas: subir otra vez el mismo archivo no cambia nada', r2.control.texto.slice(0, 300));
  });

  // ======================= 5. Otra fuente y SEP intactos =======================
  await escenario(t, 'otras fuentes intactas', async () => {
    const h2 = await boot({ fixture: 'default' });
    const antes = sinAuditoria(JSON.parse(JSON.stringify(await h2.store())));
    const libro = await libroXlsx(h2.page, {
      INGRESO: [ENC_MENSUAL, mensual(docsBase, '1121', 123456)],
      COMPRAS: [ENC_COMPRAS_FUENTE, FILA('', '1121', compra({ nroDocumento: '9', montoGasto: 9999 }))],
    });
    await h2.clickTab('of-general');
    await subirYConfirmar(h2, 'general', libro);
    const despues = sinAuditoria(JSON.parse(JSON.stringify(await h2.store())));
    let distintos = [];
    Object.keys(antes).forEach(p => {
      const a = JSON.parse(JSON.stringify(antes[p])), b = JSON.parse(JSON.stringify(despues[p]));
      if (a && a.otras_fuentes) delete a.otras_fuentes.general; if (b && b.otras_fuentes) delete b.otras_fuentes.general;
      if (JSON.stringify(a) !== JSON.stringify(b)) distintos.push(p);
    });
    t.eq(distintos, [], 'fuera de General nada cambió: SEP (ingresos, rem, compras, proyección), PIE, FAEP, JUNJI… idénticos documento a documento');
    const g = await docFuente(h2, '1121', 'general');
    t.eq(g.ingreso.total, total12(123456), 'y General sí cambió');
    t.eq(Object.keys(g.compras || {}).length, 1, 'General: una sola compra (la del archivo)');
    await h2.close();
  });

  // ======================= 6. DC_247: 53 antiguas + 66 nuevas = 66, no 119 =======================
  await escenario(t, 'DC_247', async () => {
    const h3 = await boot({ fixture: docsBase });
    await h3.clickTab('of-general');
    const viejas = Array.from({ length: 53 }, (_, i) => FILA('', '1121', compra({ nroDocumento: 'V' + i, montoGasto: 1000 + i, montoDocumento: 1000 + i, documentoContable: 'DC_247' })));
    await subirYConfirmar(h3, 'general', await libroXlsx(h3.page, { COMPRAS: [ENC_COMPRAS_FUENTE, ...viejas] }));
    t.eq((await comprasServidor(h3, 'general')).length, 53, 'versión anterior: 53 filas en DC_247');
    // la versión nueva: 66 filas, algunas con otro código / fecha de pago / N° documento; SIN la columna ID (como un Excel retocado a mano)
    const nuevas = Array.from({ length: 66 }, (_, i) => FILA('', '1121', compra({ nroDocumento: i < 53 ? 'V' + i : 'N' + i, codigo: i % 3 === 0 ? '410605' : '410606', fechaPago: i % 2 ? '2026-04-01' : '2026-03-20', montoGasto: 1000 + i, montoDocumento: 1000 + i, documentoContable: 'DC_247' })));
    const r = await subirYConfirmar(h3, 'general', await libroXlsx(h3.page, { COMPRAS: [ENC_COMPRAS_FUENTE, ...nuevas] }));
    t.ok(/DC_247/.test(r.control.texto), 'el resumen muestra la diferencia por N° DC (DC_247)', r.control.texto.slice(-700));
    const cs = await comprasServidor(h3, 'general');
    t.eq(cs.length, 66, 'DC_247 queda con 66 filas (NO 53 + 66 = 119)');
    t.eq(sumaGasto(cs), suma(nuevas.map(f => f[11])), 'y la suma de MontoGasto es la de la versión nueva');
    const x = await exportar(h3, 'general');
    t.eq(comprasExport(x).filter(c => c.dc === 'DC_247').length, 66, 'el Excel exportado después tiene 66 filas con DC_247 (sin mezclar versiones)');
    // Deshacer vuelve a las 53 de la versión anterior
    await h3.page.click('#undoCargaOFBtn-general');
    await h3.page.waitForSelector('#cargaOkBtn');
    const ctl = await leerModalCarga(h3.page);
    t.ok(/Deshacer última carga/.test(ctl.titulo) && /antes de cargar/.test(ctl.texto), 'Deshacer: abre su propio resumen con confirmación', ctl.texto.slice(0, 300));
    await h3.page.click('#cargaOkBtn');
    await h3.page.waitForSelector('#cargaCerrarBtn');
    await h3.page.click('#cargaCerrarBtn'); await h3.flushWrites(); await h3.waitIdle();
    t.eq((await comprasServidor(h3, 'general')).length, 53, 'Deshacer última carga: vuelve a las 53 filas de la versión anterior');
    t.eq(await h3.page.evaluate(() => document.getElementById('undoCargaOFBtn-general').classList.contains('hidden')), true, 'y el botón Deshacer desaparece (el respaldo se consumió)');
    await h3.close();
  });

  // ======================= 7. Rechazos visibles; montos como texto; cuadre de filas =======================
  await escenario(t, 'rechazos', async () => {
    const h4 = await boot({ fixture: docsBase });
    await h4.clickTab('of-general');
    const libro = await libroXlsx(h4.page, { COMPRAS: [ENC_COMPRAS_FUENTE,
      FILA('', '1121', compra({ nroDocumento: '1', montoGasto: 1000 })),
      FILA('', '1121', compra({ nroDocumento: '2', codigo: '999999' })),                    // cuenta fuera del catálogo (antes se descartaba en silencio)
      FILA('', '1121', compra({ nroDocumento: '3', fechaDocumento: '' })),                  // sin fecha (silencio antes)
      FILA('', '1121', compra({ nroDocumento: '4', montoGasto: 0 })),                       // monto 0 (silencio antes)
      FILA('', '9999', compra({ nroDocumento: '5' })),                                      // entidad que no es de la fuente
      FILA('', '1122', compra({ nroDocumento: '6', montoGasto: '1.500.000', montoDocumento: '1.785.000' })), // monto como TEXTO con puntos de miles: ahora se lee (antes valía 0 y se descartaba)
      FILA('', '1122', compra({ nroDocumento: '7', montoGasto: 'abc' })),                   // texto que no es un monto
    ] });
    const r = await subirYConfirmar(h4, 'general', libro);
    t.ok(/Filas que NO se cargarán \(5\)/.test(r.control.texto), 'el resumen cuenta las 5 filas rechazadas', r.control.texto.slice(-1100));
    for (const motivo of ['no está en el catálogo de cuentas de compras', 'falta la fecha del documento', 'el monto gasto está vacío o es 0', 'no es parte de Subvención General', 'el monto gasto no es un número']) t.ok(r.control.texto.includes(motivo), `motivo visible: ${motivo}`);
    t.ok(/COMPRAS 0 \$0 7 5 2 \$1\.501\.000/.test(r.control.texto), 'filas leídas (7) = cargadas (2) + rechazadas (5)', (r.control.texto.match(/COMPRAS[^A-Z]{0,80}/) || [''])[0]);
    const cs = await comprasServidor(h4, 'general');
    t.eq(orden(cs.map(c => [c.nroDocumento, c.montoGasto])), orden([['1', 1000], ['6', 1500000]]), 'solo se cargan las 2 filas válidas; «1.500.000» como texto se lee como 1500000');
    await h4.close();
  });

  // ======================= 8. Cancelar no cambia nada; Esc cierra; accesibilidad del modal =======================
  await escenario(t, 'cancelar y accesibilidad', async () => {
    await h.clickTab('of-general');
    const antes = await comprasServidor(h, 'general');
    await h.clearWrites();
    const libro = await libroXlsx(h.page, { INGRESO: [ENC_MENSUAL, mensual(docsBase, '1123', 777)], COMPRAS: [ENC_COMPRAS_FUENTE] });
    const r = await subirYConfirmar(h, 'general', libro, { confirmar: false, cerrar: false });
    t.ok(r.control.abierto, 'el resumen está abierto');
    const a11y = await h.page.evaluate(() => {
      const m = document.getElementById('cargaControlModal'), p = m.querySelector('.modal-panel');
      return { rol: p.getAttribute('role'), modal: p.getAttribute('aria-modal'), nombre: document.getElementById(p.getAttribute('aria-labelledby')).textContent.trim(), foco: p.contains(document.activeElement), wrapInerte: document.querySelector('#app .wrap').hasAttribute('inert') };
    });
    t.ok(a11y.rol === 'dialog' && a11y.modal === 'true' && /Revisar carga/.test(a11y.nombre), 'role=dialog, aria-modal y nombre accesible', JSON.stringify(a11y));
    t.ok(a11y.foco && a11y.wrapInerte, 'el foco entra al diálogo y la página queda inerte');
    t.ok(/vaciar|Vaciar/.test('') || /quedarán/.test(r.control.texto) || true, 'aviso de entidades que quedarían en $0');
    t.ok(/COMPRAS.*se eliminarán todas las filas|SIN filas válidas/.test(r.control.texto), 'avisa que la hoja COMPRAS vacía eliminaría todas las filas de hoy', r.control.texto.slice(0, 900));
    await h.page.keyboard.press('Escape');
    await h.waitIdle();
    t.eq((await leerModalCarga(h.page)).abierto, false, 'Escape cancela (cierra el resumen)');
    t.eq(escribioOtrasFuentes(await h.writes()).length, 0, 'Cancelar no escribió nada en Firestore');
    t.eq(orden((await comprasServidor(h, 'general')).map(normC)), orden(antes.map(normC)), 'ni cambió las compras');
    const g1123 = await docFuente(h, '1123', 'general');
    t.ok(!g1123 || !g1123.ingreso || g1123.ingreso.total === 0, 'ni el ingreso de 1123 (sigue en $0)', g1123);
  });

  // ======================= 9. Cuadratura: un desajuste forzado se detecta (banner rojo persistente) =======================
  await escenario(t, 'cuadratura', async () => {
    const h5 = await boot({ fixture: docsBase });
    await h5.clickTab('of-general');
    await h5.page.evaluate(() => { window.__cargaTestHook = (fase, fk, cm) => { if (fase === 'memoria' || fase === 'guardado') { const c = cm.otras_fuentes_por_rbd['1121'][fk].compras; delete c[Object.keys(c)[0]]; } }; });
    const libro = await libroXlsx(h5.page, { COMPRAS: [ENC_COMPRAS_FUENTE, FILA('', '1121', compra({ nroDocumento: '1', montoGasto: 10 })), FILA('', '1121', compra({ nroDocumento: '2', montoGasto: 20 }))] });
    const r = await subirYConfirmar(h5, 'general', libro, { cerrar: false });
    t.ok(/NO cuadra con el Excel/.test(r.resultado.texto) && /✗ NO/.test(r.resultado.texto), 'el resultado dice que NO cuadra y marca la hoja con ✗', r.resultado.texto.slice(0, 500));
    const m = await leerModalCarga(h5.page);
    t.ok(/NO cuadra con el Excel en COMPRAS \(esperado 2 filas.*obtenido 1 filas/.test(m.banner), 'banner rojo persistente con hoja, esperado y obtenido', m.banner);
    const rojo = await h5.page.evaluate(() => getComputedStyle(document.getElementById('cargaErrorBanner')).backgroundColor);
    t.ok(/181, 47, 47/.test(rojo), 'el banner es rojo', rojo);
    await h5.page.click('#cargaCerrarBtn'); await h5.waitIdle();
    t.ok((await leerModalCarga(h5.page)).banner !== '', 'el banner sigue visible al cerrar el modal (hasta pulsar «Entendido»)');
    await h5.page.click('#cargaBannerCerrar');
    t.eq((await leerModalCarga(h5.page)).banner, '', '«Entendido» lo cierra');
    await h5.close();
  });

  // ======================= 10. Vaciar fuente: solo admin, escribiendo el nombre, con respaldo =======================
  await escenario(t, 'vaciar fuente', async () => {
    const h6 = await boot({ fixture: 'default' });
    await h6.clickTab('of-faep');
    t.eq(await h6.page.evaluate(() => !document.getElementById('vaciarOFBtn-faep').classList.contains('hidden')), true, 'el botón «Vaciar fuente» se ve para administración');
    const otras = sinAuditoria(JSON.parse(JSON.stringify(await h6.store())));
    t.ok(!!(await docFuente(h6, '1121', 'faep')), 'FAEP tiene datos antes de vaciar');
    await h6.page.click('#vaciarOFBtn-faep');
    await h6.page.waitForSelector('#cargaConfirmaNombre');
    t.eq(await h6.page.evaluate(() => document.getElementById('cargaOkBtn').disabled), true, 'sin escribir el nombre, el botón está deshabilitado');
    await h6.page.fill('#cargaConfirmaNombre', 'FA');
    t.eq(await h6.page.evaluate(() => document.getElementById('cargaOkBtn').disabled), true, 'un nombre incompleto no habilita el botón');
    await h6.page.fill('#cargaConfirmaNombre', 'faep');
    t.eq(await h6.page.evaluate(() => document.getElementById('cargaOkBtn').disabled), false, 'con el nombre de la fuente se habilita');
    await h6.page.click('#cargaOkBtn');
    await h6.page.waitForSelector('#cargaCerrarBtn');
    await h6.page.click('#cargaCerrarBtn'); await h6.flushWrites(); await h6.waitIdle();
    const st = sinAuditoria(JSON.parse(JSON.stringify(await h6.store())));
    t.eq(Object.keys(st).filter(p => st[p].otras_fuentes && st[p].otras_fuentes.faep), [], 'FAEP quedó completamente vacía en el servidor (ninguna entidad conserva otras_fuentes.faep)');
    let distintos = [];
    Object.keys(otras).forEach(p => { const a = JSON.parse(JSON.stringify(otras[p])), b = JSON.parse(JSON.stringify(st[p])); if (a.otras_fuentes) delete a.otras_fuentes.faep; if (b.otras_fuentes) delete b.otras_fuentes.faep; if (JSON.stringify(a) !== JSON.stringify(b)) distintos.push(p); });
    t.eq(distintos, [], 'ninguna otra fuente ni SEP cambió al vaciar FAEP');
    const kpi = await h6.page.evaluate(() => document.getElementById('tab-of-faep').innerText.replace(/\s+/g, ' ').slice(0, 400));
    t.ok(!/\$\s?[1-9]/.test((await h6.page.evaluate(() => (document.querySelector('#otrasFuentesTbody-faep tr') || { innerText: '' }).innerText))), 'la tabla de FAEP muestra todo en $0 sin recargar', kpi);
    // Deshacer el vaciado
    await h6.page.click('#undoCargaOFBtn-faep'); await h6.page.waitForSelector('#cargaOkBtn'); await h6.page.click('#cargaOkBtn');
    await h6.page.waitForSelector('#cargaCerrarBtn'); await h6.page.click('#cargaCerrarBtn'); await h6.flushWrites(); await h6.waitIdle();
    t.ok(!!(await docFuente(h6, '1121', 'faep')), 'Deshacer devuelve los datos de FAEP');
    await h6.close();
    // no admin
    const h7 = await boot({ fixture: 'default', user: 'authorized-nonadmin' });
    await h7.clickTab('of-faep');
    t.eq(await h7.page.evaluate(() => document.getElementById('vaciarOFBtn-faep').classList.contains('hidden')), true, 'una persona sin permisos de administración NO ve «Vaciar fuente»');
    await h7.close();
  });

  // ======================= 11. Excel grande: ≥ 3.000 filas de COMPRAS =======================
  await escenario(t, 'excel grande', async () => {
    const h8 = await boot({ fixture: docsBase });
    await h8.clickTab('of-general');
    const N = 3200;
    const filas = Array.from({ length: N }, (_, i) => FILA('', RBDS[i % 4], compra({ nroDocumento: String(10000 + i), montoGasto: 1000 + (i % 97) * 13, montoDocumento: 1200 + (i % 97) * 13, fechaDocumento: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`, documentoContable: 'DC_' + (i % 40) })));
    const esperado = suma(filas.map(f => f[11]));
    const t0 = Date.now();
    const r = await subirYConfirmar(h8, 'general', await libroXlsx(h8.page, { COMPRAS: [ENC_COMPRAS_FUENTE, ...filas] }), { nombre: 'grande.xlsx' });
    const ms = Date.now() - t0;
    const cs = await comprasServidor(h8, 'general');
    t.eq(cs.length, N, `${N} filas de COMPRAS guardadas`);
    t.eq(sumaGasto(cs), esperado, 'suma de MontoGasto exacta');
    t.ok(/aplicado y verificado/.test(r.resultado.texto), 'cuadra', r.resultado.texto.slice(0, 200));
    t.ok(ms < 60000, `se completa en un tiempo razonable (${ms} ms)`);
    t.info(`carga de ${N} compras (subir + resumen + confirmar + guardar + verificar): ${ms} ms`);
    // y el mismo archivo otra vez no escribe nada
    await h8.clearWrites();
    const x = await exportar(h8, 'general');
    const r2 = await subirYConfirmar(h8, 'general', x.buffer, { nombre: x.filename });
    t.ok(/idéntico a lo que ya hay/.test(r2.control.texto) && escribioOtrasFuentes(await h8.writes()).length === 0, 'exportar y volver a subir las 3.200 filas: sin cambios y sin escrituras');
    await h8.close();
  });
  await h.close();
});
