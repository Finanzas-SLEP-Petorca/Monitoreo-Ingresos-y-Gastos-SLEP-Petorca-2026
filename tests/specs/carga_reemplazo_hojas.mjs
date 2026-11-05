// Carga por fuente = reemplazo total · semántica por TIPO de hoja en las fuentes por CONCEPTO (FAEP, JUNJI…) y en las de solo ingresos (Recuperación LLMM):
//   · COMPRAS por concepto, BYS_ITEMS, HONORARIOS y HON_PROYECCION: la hoja del archivo reemplaza todo; la entidad ausente queda vacía en esa hoja; una hoja que el archivo NO trae se conserva;
//   · una hoja con el encabezado de otra fuente («Codigo» en una fuente por concepto) se OMITE ENTERA (se conserva lo que hay) y el resumen lo dice;
//   · JUNJI: REM_* por línea; la hoja REMUNERACIONES del Excel antiguo va a Operación y se ignora si el archivo trae REM_OPERACION; META es espejo por entidad;
//   · Recuperación LLMM (solo ingresos): una hoja REMUNERACIONES / COMPRAS del archivo no se usa y no escribe gasto;
//   · idempotencia general: exportar y volver a subir CADA una de las 12 fuentes no cambia nada.
import { boot, clickTab } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { capturarDescarga, leerXlsx } from '../lib/capture-utils.mjs';
import { subirYConfirmar, libroXlsx, docFuente, comprasServidor } from '../lib/carga.mjs';

const FUENTES = ['general', 'pie', 'mantenimiento', 'prorretencion', 'junji', 'faep', 'subt31_proyectos', 'recuperacion_llmm', 'asignacion_familiar', 'figa', 'aporte_educ', 'aporte_junji'];
async function exportar(h, fuente) {
  await clickTab(h.page, 'of-' + fuente);
  const dl = await capturarDescarga(h.page, () => h.page.click(`#downloadExcelOFBtn-${fuente}`));
  return { ...dl, hojas: (await leerXlsx(h.page, dl.buffer)).hojas };
}
async function escenario(t, nombre, fn) { try { await fn(); } catch (e) { t.ok(false, `${nombre}: excepción`, String(e.stack || e.message).split('\n').slice(0, 5).join(' | ')); } }
const cuerpo = (x, hoja) => x.hojas[hoja].slice(1);
const nHon = async (h, f, rbd) => Object.keys(((await docFuente(h, rbd, f)) || {}).honorarios || {}).length;

await correrSpec('carga_reemplazo_hojas', async (t) => {
  // ======================= FAEP (por concepto) =======================
  const h = await boot({ autoCarga: false, fixture: 'honorarios_fuentes' });
  await escenario(t, 'faep', async () => {
    const x = await exportar(h, 'faep');
    t.ok(cuerpo(x, 'HONORARIOS').filter(r => r[1] !== '').length >= 4, 'partida: FAEP trae boletas en varias entidades');
    const honAC = await nHon(h, 'faep', 'AC'), hon1121 = await nHon(h, 'faep', 1121);
    const comprasAntes = (await comprasServidor(h, 'faep')).length;
    const proy5402002 = (await docFuente(h, '5402002', 'faep') || {}).hon_proyeccion_items;
    // El archivo nuevo: BYS_ITEMS solo con la entidad 1121 (AC y 5402002… quedan vacías en esa hoja); HONORARIOS solo con UNA boleta de AC; HON_PROYECCION no viene; COMPRAS trae la hoja de la otra clase («Codigo»).
    const encBys = x.hojas.BYS_ITEMS[0], encHon = x.hojas.HONORARIOS[0];
    const hon = cuerpo(x, 'HONORARIOS').filter(r => String(r[1]) === 'AC').slice(0, 1);
    const comprasMala = [['ID', 'RBD', 'Nombre', 'Codigo', 'TipoDocumento', 'NroDocumento', 'FechaDocumento', 'FechaPago', 'Descripcion', 'RutProveedor', 'NombreProveedor', 'MontoGasto', 'MontoDocumento', 'DocumentoOriginal', 'N° DC'],
      ['x1', 1121, 'LICEO', '410606', 'FAC', '1', '2026-03-10', '2026-03-20', 'd', '', '', 1000, 1190, '', '']];
    const libro = await libroXlsx(h.page, {
      BYS_ITEMS: [encBys, [1121, 'LICEO PULMAHUE DE LA LIGUA', 'Colaciones', ...new Array(12).fill(1000), 12000]],
      HONORARIOS: [encHon, ...hon],
      COMPRAS: comprasMala,
    });
    const r = await subirYConfirmar(h, 'faep', libro);
    t.ok(/COMPRAS NO se carga/.test(r.control.texto.replace('La hoja ', '').replace('NO se carga', 'NO se carga')) || /NO se carga: la columna 4 se llama «Codigo»/.test(r.control.texto), 'la hoja COMPRAS con «Codigo» en una fuente por concepto se omite entera y se avisa', r.control.texto.slice(0, 900));
    t.ok(/HON_PROYECCION.*No viene en el archivo: se conserva/.test(r.control.texto), 'HON_PROYECCION no viene: se conserva');
    const f1121 = await docFuente(h, '1121', 'faep');
    t.eq(Object.keys(f1121.bys_items), ['Colaciones'], 'BYS_ITEMS: 1121 quedó SOLO con el concepto del archivo (los demás desaparecieron)');
    t.eq(await docFuente(h, 'AC', 'faep').then(d => d.bys_items), {}, 'BYS_ITEMS: AC (ausente de la hoja) quedó vacía');
    t.eq(await nHon(h, 'faep', 'AC'), 1, 'HONORARIOS: AC queda con la única boleta del archivo');
    t.eq(await nHon(h, 'faep', 1121), 0, 'HONORARIOS: 1121 (ausente de la hoja) quedó sin boletas');
    t.ok(honAC >= 1 && hon1121 >= 1, 'antes había boletas en AC y 1121');
    t.eq((await docFuente(h, '5402002', 'faep') || {}).hon_proyeccion_items, proy5402002, 'HON_PROYECCION (hoja ausente) intacta');
    t.eq(await comprasServidor(h, 'faep').then(c => c.length), comprasAntes, `COMPRAS omitida: se conserva lo que había (${comprasAntes} filas)`);
    t.ok(/aplicado y verificado/.test(r.resultado.texto), 'cuadratura OK', r.resultado.texto.slice(0, 300));
  });
  await escenario(t, 'faep concepto compras', async () => {
    const enc = ['ID', 'RBD', 'Nombre', 'Concepto', 'TipoDocumento', 'NroDocumento', 'FechaDocumento', 'FechaPago', 'Descripcion', 'RutProveedor', 'NombreProveedor', 'MontoGasto', 'MontoDocumento', 'DocumentoOriginal', 'N° DC'];
    const fila = (id, nro, concepto, fp, dc) => [id, 1121, 'LICEO PULMAHUE DE LA LIGUA', concepto, 'Factura electrónica', nro, '2026-03-12', fp, 'x', '76123456-7', 'Prov', 5000, 5950, '', dc];
    await subirYConfirmar(h, 'faep', await libroXlsx(h.page, { COMPRAS: [enc, fila('a', '1', 'Alimentación', '2026-03-30', 'DC_1'), fila('b', '2', 'Alimentación', '2026-03-30', 'DC_1'), fila('', '3', 'Útiles', '2026-03-30', '')] }));
    t.eq((await comprasServidor(h, 'faep')).length, 3, 'COMPRAS por concepto: 3 filas');
    // fila 1: cambia el concepto y la FechaPago (con el MISMO ID); fila 2 eliminada; fila 3 sin ID (cambia la FechaPago)
    await subirYConfirmar(h, 'faep', await libroXlsx(h.page, { COMPRAS: [enc, fila('a', '1', 'Colaciones', '2026-04-30', 'DC_1'), fila('', '3', 'Útiles', '2026-05-30', '')] }));
    const cs = await comprasServidor(h, 'faep');
    t.eq(cs.map(c => [c.nroDocumento, c.concepto, c.fechaPago]).sort().join('|'), ['1,Colaciones,2026-04-30', '3,Útiles,2026-05-30'].join('|'), 'concepto y FechaPago modificados: una sola fila por documento; la eliminada desapareció');
    // la columna N° DC ausente NO hereda el N° DC anterior
    const encSinDc = enc.slice(0, 14);
    await subirYConfirmar(h, 'faep', await libroXlsx(h.page, { COMPRAS: [encSinDc, fila('a', '1', 'Colaciones', '2026-04-30', 'DC_1').slice(0, 14)] }));
    const c2 = (await comprasServidor(h, 'faep'))[0];
    t.ok(c2.documentoContable === undefined || c2.documentoContable === '', 'un Excel sin la columna N° DC no hereda el N° DC anterior (espejo exacto)', c2);
  });

  // ======================= JUNJI =======================
  await escenario(t, 'junji', async () => {
    const x = await exportar(h, 'junji');
    const enc = x.hojas.REM_OPERACION[0];
    const antesHom = (await docFuente(h, '5401002', 'junji') || {}).gasto_rem_homologacion;
    const libro = await libroXlsx(h.page, {
      REMUNERACIONES: [enc, [5401002, 'JARDIN', ...new Array(12).fill(100), 1200]],                   // Excel antiguo: va a Operación
      REM_OPERACION: [enc, [5401003, 'JARDIN', ...new Array(12).fill(300), 3600]],                   // y esta hoja manda
    });
    const r = await subirYConfirmar(h, 'junji', libro);
    t.ok(/se ignora porque el archivo trae REM_OPERACION/.test(r.control.texto), 'REMUNERACIONES se ignora porque el archivo trae REM_OPERACION (y el resumen lo dice)', r.control.texto.slice(0, 700));
    t.eq((await docFuente(h, '5401003', 'junji')).gasto_rem_operacion.total, 3600, 'Operación: manda REM_OPERACION');
    t.eq((await docFuente(h, '5401002', 'junji')).gasto_rem_operacion.total, 0, 'Operación: una entidad ausente de REM_OPERACION quedó en $0 (no hereda lo de REMUNERACIONES ni el valor antiguo)');
    t.eq((await docFuente(h, '5401002', 'junji') || {}).gasto_rem_homologacion, antesHom, 'REM_HOMOLOGACION (hoja ausente) intacta');
    const libro2 = await libroXlsx(h.page, { REMUNERACIONES: [enc, [5401002, 'JARDIN', ...new Array(12).fill(100), 1200]] });
    await subirYConfirmar(h, 'junji', libro2);
    t.eq((await docFuente(h, '5401002', 'junji')).gasto_rem_operacion.total, 1200, 'Excel antiguo (solo REMUNERACIONES): se carga en Operación');
    t.eq((await docFuente(h, '5401003', 'junji')).gasto_rem_operacion.total, 0, '…y las demás entidades quedan en $0 en esa línea');
    // META espejo: solo una entidad con corte propio → las demás vuelven al corte por defecto
    await subirYConfirmar(h, 'junji', await libroXlsx(h.page, { META: [['RBD', 'Nombre', 'RealHastaMes'], [5401002, 'JARDIN', 4]] }));
    t.eq((await docFuente(h, '5401002', 'junji')).real_hasta_mes, 4, 'META: corte propio de la entidad del archivo');
    const otras = await Promise.all(['5401003', '5402002', '5404001'].map(async id => ((await docFuente(h, id, 'junji')) || {}).real_hasta_mes));
    t.ok(otras.every(v => v === undefined || v === 7), 'META: las entidades ausentes del archivo vuelven al corte por defecto (7 = el de siempre; si tenían otro valor el campo se borra)', otras);
    await subirYConfirmar(h, 'junji', await libroXlsx(h.page, { META: [['RBD', 'Nombre', 'RealHastaMes'], [5401002, 'JARDIN', 4], [5402002, 'JARDIN', 2]] }));
    await subirYConfirmar(h, 'junji', await libroXlsx(h.page, { META: [['RBD', 'Nombre', 'RealHastaMes'], [5401002, 'JARDIN', 4]] }));
    t.eq((await docFuente(h, '5402002', 'junji')).real_hasta_mes, undefined, 'META: una entidad con corte propio que sale del archivo pierde ese corte (campo borrado en el servidor)');
  });

  // ======================= Recuperación LLMM (solo ingresos) =======================
  await escenario(t, 'llmm', async () => {
    const x = await exportar(h, 'recuperacion_llmm');
    t.eq(Object.keys(x.hojas), ['ING_LLMM_ISAPRES', 'ING_LLMM_FONASA', 'ING_LLMM_SIL', 'META'], 'LLMM solo tiene hojas de ingresos y META');
    const enc = x.hojas.ING_LLMM_SIL[0];
    const r = await subirYConfirmar(h, 'recuperacion_llmm', await libroXlsx(h.page, { ING_LLMM_SIL: [enc, [1121, 'LICEO', ...new Array(12).fill(10), 120]], REMUNERACIONES: [enc, [1121, 'LICEO', ...new Array(12).fill(99), 1188]] }));
    t.ok(/Hojas del archivo que Recuperación Licencias Médicas no usa \(se ignoran\): REMUNERACIONES/.test(r.control.texto), 'una hoja REMUNERACIONES en la fuente de solo ingresos se informa como no usada', r.control.texto.slice(-300));
    const d = await docFuente(h, '1121', 'recuperacion_llmm');
    t.eq(d.ingreso_llmm_sil.total, 120, 'ING_LLMM_SIL cargado');
    t.eq(d.gasto_rem, undefined, 'no se escribió gasto en una fuente sin gasto');
  });
  t.noErrores(h);
  await h.close();

  // ======================= Idempotencia en las 12 fuentes =======================
  await escenario(t, 'idempotencia 12 fuentes', async () => {
    for (const fx of ['default', 'compras_conceptos', 'junji_rem', 'jardines']) {
      const hh = await boot({ autoCarga: false, fixture: fx });
      for (const f of FUENTES) {
        const x = await exportar(hh, f);
        const r = await subirYConfirmar(hh, f, x.buffer, { nombre: x.filename, confirmar: false });
        t.ok(/idéntico a lo que ya hay/.test(r.control.texto) || /Filas que NO se cargarán/.test(r.control.texto), `${fx}/${f}: exportar → subir no cambia nada (o solo se rechazan filas inválidas del fixture)`, r.control.texto.slice(0, 400));
      }
      await hh.close();
    }
  });
});
