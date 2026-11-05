// 18_carga_sep_ff — la carga «reemplazo total» del importador de SEP y del de Fondos Fijos contra el SDK REAL de Firestore + emulador (el mock no prueba que `mergeFields` con rutas anidadas
// —rem.meses, ingreso_items.<ítem>, fondos_fijos.meses.<mes>.<campo>— y `deleteField()` reemplacen/borren de verdad).
//   S1) SEP: Excel completo → lo guardado es EXACTAMENTE el archivo (ingresos, rem, compras con NC negativa, B&S proyectado, honorarios, proyección de honorarios); NO se tocan rem.real_hasta_mes,
//       ingreso_real_hasta_mes, otras_fuentes, fondos_fijos ni `_meta` (updateTime intacto); solo se escriben los documentos que cambian.
//   S2) el MISMO Excel (el que exporta el panel) otra vez = sin escrituras; fila modificada = una sola; fila eliminada y entidad ausente desaparecen del servidor; hoja ausente se conserva.
//   S3) DC_247: 53 antiguas + 66 nuevas = 66; 3.200 compras en 50 RBD.
//   S4) servidor que rechaza (reglas de solo lectura): error visible y el panel vuelve a lo guardado.
//   S5) Deshacer y Vaciar SEP contra el servidor real (lo no gestionado sigue intacto).
//   F1) Fondos Fijos: carga exacta, lo manual (registrado_general…) y enero/febrero intactos, entidad ausente en blanco, mismo libro = sin escrituras; Vaciar; Deshacer.
// Esperado: PASS en la PR.
import { boot, clickTab } from '../lib/harness.mjs';
import { asegurarEmulador, REGLAS_ABIERTAS, REGLAS_SOLO_LECTURA } from '../lib/emulator.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { libroXlsx, ENC_COMPRAS_SEP, filaCompra, compraBase } from '../../lib/compras.mjs';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ENC_ING = ['RBD', 'Establecimiento', 'Item', ...MESES, 'Total Año'];
const ENC_PROY = ['RBD', 'Establecimiento', 'Codigo', 'Item', ...MESES, 'Total Año'];
const ENC_HON = ['ID', 'RBD', 'Establecimiento', 'Codigo', 'TipoDocumento', 'NroDocumento', 'FechaDocumento', 'FechaPago', 'Descripcion', 'RutProveedor', 'NombreProveedor', 'MontoGasto', 'MontoDocumento', 'N° DC'];
const clon = (o) => JSON.parse(JSON.stringify(o));
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v));
const compra = (extra) => compraBase({ codigo: '410606', ...extra });
const NOM = { 1121: 'LICEO PULMAHUE DE LA LIGUA', 1122: 'ESCUELA REPUBLICA DE VENEZUELA' };
const fila = (id, rbd, c) => filaCompra(id, Number(rbd), NOM[rbd] || String(rbd), c);
const meses = (v) => new Array(12).fill(v);
const suma = (m) => Object.values(m || {}).reduce((s, c) => s + Number(c.montoGasto), 0);
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function subir(h, sel, buffer, { confirmar = true } = {}) {
  const { page } = h;
  await page.setInputFiles(sel, { name: 'carga.xlsx', mimeType: MIME, buffer });
  await page.waitForFunction(() => !!document.getElementById('cargaOkBtn') || !!document.getElementById('cargaCerrarBtn'), null, { timeout: 90000 });
  const control = await page.evaluate(() => document.getElementById('cargaControlBody').innerText.replace(/\s+/g, ' '));
  if (!confirmar) { await page.click('#cargaCancelarBtn'); return { control }; }
  if (!await page.$('#cargaOkBtn')) { await page.click('#cargaCerrarBtn'); return { control }; }
  if (await page.$('#cargaConfirmaMasivo')) await page.check('#cargaConfirmaMasivo'); // aviso de vaciado masivo: hay que marcar la casilla para poder reemplazar
  await page.click('#cargaOkBtn');
  await page.waitForFunction(() => !!document.getElementById('cargaCerrarBtn') && !document.getElementById('cargaOkBtn') && !/Guardando para el resto/.test(document.getElementById('cargaControlBody').innerText), null, { timeout: 120000 });
  const resultado = await page.evaluate(() => document.getElementById('cargaControlBody').innerText.replace(/\s+/g, ' '));
  await page.click('#cargaCerrarBtn');
  await h.esperarEscriturasListas().catch(() => {});
  return { control, resultado };
}
async function clic(h, id, nombre) { // botones Deshacer / Vaciar
  const { page } = h;
  await page.click(id);
  await page.waitForSelector('#cargaOkBtn');
  if (nombre) await page.fill('#cargaConfirmaNombre', nombre);
  if (await page.$('#cargaConfirmaMasivo')) await page.check('#cargaConfirmaMasivo');
  await page.click('#cargaOkBtn');
  await page.waitForFunction(() => !!document.getElementById('cargaCerrarBtn') && !document.getElementById('cargaOkBtn') && !/Guardando para el resto/.test(document.getElementById('cargaControlBody').innerText), null, { timeout: 120000 });
  const resultado = await page.evaluate(() => document.getElementById('cargaControlBody').innerText.replace(/\s+/g, ' '));
  await page.click('#cargaCerrarBtn');
  await h.esperarEscriturasListas().catch(() => {});
  return resultado;
}
const SEP = ['compras', 'ingreso_items', 'bys_proyeccion', 'honorarios', 'hon_proyeccion'];
const sinGestionado = (d) => { const o = clon(d); SEP.forEach(c => delete o[c]); if (o.rem) { delete o.rem.meses; delete o.rem.total; } delete o.lastModifiedAt; delete o.lastModifiedBy; return canon(o); };

await correrSpec('18_carga_sep_ff', async (t) => {
  const emu = await asegurarEmulador();
  await emu.reglas(REGLAS_ABIERTAS);

  // ============================================================ S1-S3, S5) SEP
  {
    const h = await boot({ fixture: 'fondos_fijos' });
    const { page } = h;
    await clickTab(page, 'panel');
    // cortes propios que ninguna hoja trae
    await t.escenario('S1', async () => {
      const base = await emu.instantanea();
      const ajenoAntes = Object.fromEntries(Object.entries(base).map(([id, d]) => [id, sinGestionado(d.data)]));
      const cs = [fila('', 1121, compra({ nroDocumento: '100', montoGasto: 100000, montoDocumento: 119000 })), fila('', 1121, compra({ nroDocumento: '101', montoGasto: 250000, montoDocumento: 297500, codigo: '410605' })),
        fila('', 1122, compra({ nroDocumento: '200', montoGasto: 75500 })), fila('', 1122, compra({ nroDocumento: '201', tipoDocumento: 'Nota de crédito', montoGasto: 20000, montoDocumento: 23800, documentoOriginal: '100-FAC' }))];
      const libro = await libroXlsx(page, {
        INGRESO: [ENC_ING, [1121, NOM[1121], 'Ingreso SEP Preferente', ...meses(1000000), 12000000], [1121, NOM[1121], 'Carrera Docente', ...meses(30000), 360000]],
        REMUNERACIONES: [ENC_ING, [1121, NOM[1121], '', ...meses(400000), 4800000], [1122, NOM[1122], '', ...meses(200000), 2400000]],
        COMPRAS: [ENC_COMPRAS_SEP, ...cs],
        BYS_PROYECCION: [ENC_PROY, [1121, NOM[1121], '410605', 'x', ...meses(10000), 120000]],
        HONORARIOS: [ENC_HON, ['', 1121, NOM[1121], '410803', 'BOLH', '10', '2026-02-12', '2026-02-19', 'Taller', '11111111-1', 'Nombre', 80000, 80000, '']],
        HON_PROYECCION: [ENC_PROY, [1121, NOM[1121], '410803', 'x', ...meses(5000), 60000]],
      });
      await h.clearLog();
      const r = await subir(h, '#importExcelInput', libro);
      t.ok(/aplicado y verificado/.test(r.resultado), 'S1) la carga se aplica y el panel cuadra con el Excel', r.resultado && r.resultado.slice(0, 300));
      const d1121 = (await emu.leer('1121')).data, d1122 = (await emu.leer('1122')).data;
      t.eq(suma(d1121.compras) + suma(d1122.compras), 100000 + 250000 + 75500 - 20000, 'S1) servidor: suma de MontoGasto exacta (NC en negativo)');
      t.eq([d1121.ingreso_items['Ingreso SEP Preferente'].total, d1121.ingreso_items['Carrera Docente'].total, d1121.rem.total, d1122.rem.total], [12000000, 360000, 4800000, 2400000], 'S1) servidor: ingresos y remuneraciones exactos');
      t.eq([Object.keys(d1121.bys_proyeccion.items), Object.keys(d1121.honorarios).length, d1121.hon_proyeccion.items['410803'].total], [['410605'], 1, 60000], 'S1) servidor: B&S proyectado, honorarios y su proyección');
      const w = (await h.writes()).filter(x => x.op === 'batch.set');
      t.ok(w.length > 0 && w.every(x => x.options && Array.isArray(x.options.mergeFields) && x.status === 'acked'), 'S1) batch.set con mergeFields, todas confirmadas', w[0] && w[0].options);
      const despues = await emu.instantanea();
      t.eq(Object.keys(despues).filter(id => sinGestionado(despues[id].data) !== ajenoAntes[id]), [], 'S1) servidor: fuera de los campos que gestionan las hojas NADA cambió (rem.real_hasta_mes, cortes, otras_fuentes, fondos_fijos, nombre…)');
      t.ok(despues['_meta'] && despues['_meta'].updateTime === base['_meta'].updateTime, 'S1) el documento _meta (mes de cierre global) no se escribió');
      t.eq(d1121.rem.real_hasta_mes, base['1121'].data.rem.real_hasta_mes, 'S1) rem.real_hasta_mes intacto');
      t.ok(Object.keys(despues).filter(id => despues[id].updateTime === base[id].updateTime).length > 0, 'S1) los documentos que no cambian no se reescriben');
    });
    await t.escenario('S2', async () => {
      const { capturarDescarga } = await import('../../lib/capture-utils.mjs');
      const dl = await capturarDescarga(page, () => page.click('#downloadExcelBtn'));
      await h.clearLog();
      const r0 = await subir(h, '#importExcelInput', dl.buffer);
      t.ok(/idéntico a lo que ya hay/.test(r0.control) && (await h.writes()).length === 0, 'S2) el Excel que exporta el panel, otra vez: «idéntico» y sin ninguna escritura');
      const antes = await emu.instantanea();
      const mod = [fila('', 1121, compra({ nroDocumento: '100', montoGasto: 100000, montoDocumento: 119000, codigo: '410605', fechaPago: '2026-07-07' }))];
      const r = await subir(h, '#importExcelInput', await libroXlsx(page, { COMPRAS: [ENC_COMPRAS_SEP, ...mod] }));
      t.ok(/aplicado y verificado/.test(r.resultado), 'S2) carga aplicada y cuadrada');
      const d1121 = (await emu.leer('1121')).data;
      t.eq(Object.values(d1121.compras).map(c => [c.nroDocumento, c.codigo, c.fechaPago]), [['100', '410605', '2026-07-07']], 'S2) servidor 1121: UNA sola compra con el valor nuevo');
      t.eq((await emu.leer('1122')).data.compras, {}, 'S2) servidor 1122 (ausente de la hoja): compras vacías (la clave se borró de verdad)');
      t.eq(d1121.rem.total, 4800000, 'S2) REMUNERACIONES (hoja ausente) se conserva');
      const despues = await emu.instantanea();
      t.ok(despues['1123'].updateTime === antes['1123'].updateTime, 'S2) un documento que no cambia no se escribe');
    });
    await t.escenario('S3', async () => {
      const viejas = Array.from({ length: 53 }, (_, i) => fila('', 1121, compra({ nroDocumento: 'V' + i, montoGasto: 1000 + i, documentoContable: 'DC_247' })));
      await subir(h, '#importExcelInput', await libroXlsx(page, { COMPRAS: [ENC_COMPRAS_SEP, ...viejas] }));
      const nuevas = Array.from({ length: 66 }, (_, i) => fila('', 1121, compra({ nroDocumento: i < 53 ? 'V' + i : 'N' + i, codigo: i % 3 ? '410606' : '410605', fechaPago: i % 2 ? '2026-04-01' : '2026-03-20', montoGasto: 1000 + i, documentoContable: 'DC_247' })));
      const r = await subir(h, '#importExcelInput', await libroXlsx(page, { COMPRAS: [ENC_COMPRAS_SEP, ...nuevas] }));
      t.ok(/DC_247/.test(r.control), 'S3) el resumen muestra DC_247');
      t.eq(Object.keys((await emu.leer('1121')).data.compras).length, 66, 'S3) servidor: DC_247 queda con 66 (no 119)');
      const N = 3200, ents = Object.keys(await emu.instantanea()).filter(id => /^\d{4,5}$/.test(id)).slice(0, 50);
      const filas = Array.from({ length: N }, (_, i) => fila('', ents[i % ents.length], compra({ nroDocumento: String(10000 + i), montoGasto: 1000 + (i % 97) * 13, fechaDocumento: `2026-0${1 + (i % 7)}-10` })));
      const t0 = Date.now();
      const rg = await subir(h, '#importExcelInput', await libroXlsx(page, { COMPRAS: [ENC_COMPRAS_SEP, ...filas] }));
      t.ok(/aplicado y verificado/.test(rg.resultado), 'S3) 3.200 compras: aplicado y verificado', rg.resultado && rg.resultado.slice(0, 200));
      const snap = await emu.instantanea();
      const tot = Object.values(snap).reduce((a, d) => [a[0] + Object.keys(d.data.compras || {}).length, a[1] + suma(d.data.compras)], [0, 0]);
      t.eq(tot, [N, filas.reduce((s, f) => s + f[11], 0)], 'S3) servidor: 3.200 filas y suma exacta');
      t.info(`3.200 compras SEP: ${Date.now() - t0} ms`);
    });
    await t.escenario('S5', async () => {
      const previo = await emu.instantanea();
      const ajeno = Object.fromEntries(Object.entries(previo).map(([id, d]) => [id, sinGestionado(d.data)]));
      const res = await clic(h, '#vaciarOFBtn-sep', 'SEP');
      t.ok(/aplicado y verificado/.test(res), 'S5) Vaciar SEP aplicado y verificado');
      const post = await emu.instantanea();
      const noVacio = Object.keys(post).filter(id => id !== '_meta' && (Object.keys(post[id].data.compras || {}).length || Object.keys(post[id].data.honorarios || {}).length || (post[id].data.rem && post[id].data.rem.total)));
      t.eq(noVacio, [], 'S5) servidor: compras, honorarios y remuneraciones vaciados en todos los RBD');
      t.eq(Object.keys(post).filter(id => sinGestionado(post[id].data) !== ajeno[id]), [], 'S5) servidor: Vaciar no tocó cortes, otras fuentes, Fondos Fijos ni _meta');
      await clic(h, '#undoCargaOFBtn-sep');
      const back = await emu.instantanea();
      t.eq(Object.values(back).reduce((n, d) => n + Object.keys(d.data.compras || {}).length, 0), 3200, 'S5) Deshacer devuelve las 3.200 compras al servidor');
    });
    // S6) Vaciado masivo: tras S5 hay compras en 50 RBD; un Excel con las de UNA sola entidad deja vacías a las otras 49 → aviso rojo, «Reemplazar» deshabilitado hasta marcar la casilla.
    await t.escenario('S6', async () => {
      const antes = await emu.instantanea();
      const nConCompras = (snap) => Object.keys(snap).filter(id => Object.keys((snap[id].data || {}).compras || {}).length).length;
      t.eq(nConCompras(antes), 50, 'S6) partida: 50 RBD con compras');
      const libro1 = await libroXlsx(page, { COMPRAS: [ENC_COMPRAS_SEP, fila('', 1121, compra({ nroDocumento: 'SOLO-1', montoGasto: 5000, montoDocumento: 5950 }))] });
      await h.clearLog();
      await page.setInputFiles('#importExcelInput', { name: 'una_entidad.xlsx', mimeType: MIME, buffer: libro1 });
      await page.waitForSelector('#cargaOkBtn', { timeout: 90000 });
      const ui = await page.evaluate(() => ({ aviso: (document.getElementById('cargaAvisoMasivo') || {}).innerText || '', role: (document.getElementById('cargaAvisoMasivo') || { getAttribute() {} }).getAttribute('role'), deshabilitado: document.getElementById('cargaOkBtn').disabled, foco: document.activeElement.id }));
      t.ok(/trae solo 1 de 55 entidades.*49 entidades quedarán en \$0 \/ sin datos en: COMPRAS/.test(ui.aviso.replace(/\s+/g, ' ')), 'S6) aviso rojo: 1 de 55 entidades, 49 quedarían vacías en COMPRAS', ui.aviso);
      t.eq([ui.role, ui.deshabilitado, ui.foco], ['alert', true, 'cargaCancelarBtn'], 'S6) role=alert, «Reemplazar» deshabilitado y foco en «Cancelar»');
      await page.keyboard.press('Escape');
      t.eq([(await h.writes()).length, nConCompras(await emu.instantanea())], [0, 50], 'S6) Esc: sin escrituras y el servidor intacto (50 RBD con compras)');
      const r = await subir(h, '#importExcelInput', libro1);
      t.ok(/aplicado y verificado/.test(r.resultado), 'S6) con la casilla marcada reemplaza y cuadra', r.resultado && r.resultado.slice(0, 200));
      const despues = await emu.instantanea();
      t.eq([nConCompras(despues), Object.values(despues['1121'].data.compras).map(c => c.nroDocumento)], [1, ['SOLO-1']], 'S6) servidor: solo 1121 conserva compras (las otras 49 se borraron de verdad)');
    });
    t.eq(await h.inesperados(), [], 'S1-S6) sin errores inesperados');
    await h.close();
  }

  // ============================================================ S4) el servidor rechaza la escritura
  {
    const h = await boot({ fixture: 'default' });
    const { page } = h;
    h.expectErrors(/permission|insufficient|Missing or insufficient/i, /Error guardando/i);
    await clickTab(page, 'panel');
    await t.escenario('S4', async () => {
      await emu.reglas(REGLAS_SOLO_LECTURA);
      const antes = await emu.instantanea();
      const r = await subir(h, '#importExcelInput', await libroXlsx(page, { REMUNERACIONES: [ENC_ING, [1121, NOM[1121], '', ...meses(777), 9324]] }));
      t.ok(/NO guardó la carga/.test(r.resultado), 'S4) el resultado dice que el servidor NO guardó la carga', r.resultado && r.resultado.slice(0, 300));
      const despues = await emu.instantanea();
      t.eq(Object.keys(despues).filter(id => despues[id].updateTime !== antes[id].updateTime), [], 'S4) el servidor no cambió');
      t.eq(await page.evaluate(() => !document.getElementById('undoCargaOFBtn-sep').classList.contains('hidden')), false, 'S4) y no se ofrece «Deshacer»');
      await emu.reglas(REGLAS_ABIERTAS);
    });
    await h.close();
  }

  // ============================================================ F1) Fondos Fijos
  {
    const h = await boot({ fixture: 'fondos_fijos' });
    const { page } = h;
    await clickTab(page, 'of-fondos_fijos');
    const P = (id, cupo, mes) => { const f = new Array(76).fill(''); f[0] = id; f[1] = 'N'; f[6] = cupo; Object.entries(mes || {}).forEach(([c, v]) => { f[c] = v; }); return f; };
    const libro = (filas) => libroXlsx(page, { 'FONDOS FIJOS P02': [['T'], ['RBD'], ...filas] });
    await t.escenario('F1', async () => {
      const base = await emu.instantanea();
      const manual = clon(base['1121'].data.fondos_fijos.meses.MARZO);
      const ajeno = Object.fromEntries(Object.entries(base).map(([id, d]) => { const o = clon(d.data); delete o.fondos_fijos; delete o.lastModifiedAt; delete o.lastModifiedBy; return [id, canon(o)]; }));
      await h.clearLog();
      // 1121: cupo 750.000; marzo: saldo(7)=750000, rendido(9)=200000, observado(10)=50000, folio(13)
      const L = await libro([P(1121, 750000, { 7: 750000, 9: 200000, 10: 50000, 13: 'FF-9' }), P(1122, 5, {})]);
      const r = await subir(h, '#importFondosFijosInput', L);
      t.ok(/aplicado y verificado/.test(r.resultado), 'F1) la carga se aplica y cuadra', r.resultado && r.resultado.slice(0, 300));
      const a = (await emu.leer('1121')).data.fondos_fijos;
      t.eq([a.cupo, a.meses.MARZO.saldo_inicial, a.meses.MARZO.rendido, a.meses.MARZO.observado, a.meses.MARZO.folio], [750000, 750000, 200000, 50000, 'FF-9'], 'F1) servidor: cupo, saldo, rendido, observado y folio exactos');
      t.eq([a.meses.MARZO.registrado_general, a.meses.MARZO.compensado_sigfe, a.meses.MARZO.reposicion], [manual.registrado_general, manual.compensado_sigfe, manual.reposicion], 'F1) servidor: lo manual (Registrado en General, Compensado SIGFE, Reposición) intacto');
      const b = (await emu.leer('1125')).data.fondos_fijos;
      t.eq([b.cupo, b.meses.OCTUBRE.rendido, b.meses.OCTUBRE.registrado_general, b.meses.OCTUBRE.folio], [0, 0, 60000, 'FF-OCT'], 'F1) servidor: la entidad ausente (1125) queda en blanco en lo gestionado y conserva lo manual y el folio de octubre');
      t.eq((await emu.leer('1128')).data.fondos_fijos.meses.FEBRERO.rendido, 20000, 'F1) servidor: febrero (la hoja no lo trae) intacto');
      const w = (await h.writes()).filter(x => x.op === 'batch.set');
      t.ok(w.length > 0 && w.every(x => x.options.mergeFields.every(f => /^(lastModifiedBy|lastModifiedAt|nombre|fondos_fijos\.)/.test(f)) && x.status === 'acked'), 'F1) batch.set con mergeFields solo sobre fondos_fijos.*');
      const despues = await emu.instantanea();
      t.eq(Object.keys(despues).filter(id => { const o = clon(despues[id].data); delete o.fondos_fijos; delete o.lastModifiedAt; delete o.lastModifiedBy; return canon(o) !== ajeno[id]; }), [], 'F1) servidor: fuera de fondos_fijos nada cambió');
      await h.clearLog();
      const r2 = await subir(h, '#importFondosFijosInput', L);
      t.ok(/idéntico a lo que ya hay/.test(r2.control) && (await h.writes()).length === 0, 'F1) el mismo libro otra vez: «idéntico» y sin escrituras');
      const antesV = await emu.instantanea();
      const res = await clic(h, '#vaciarOFBtn-fondos_fijos', 'Fondos Fijos');
      t.ok(/aplicado y verificado/.test(res), 'F1) Vaciar Fondos Fijos aplicado');
      const v = (await emu.leer('1121')).data.fondos_fijos;
      t.eq([v.cupo, v.meses.MARZO.rendido, v.meses.MARZO.folio, v.meses.MARZO.registrado_general], [0, 0, '', manual.registrado_general], 'F1) servidor: vaciado en lo gestionado, lo manual se conserva');
      await clic(h, '#undoCargaOFBtn-fondos_fijos');
      t.eq((await emu.leer('1121')).data.fondos_fijos.cupo, 750000, 'F1) Deshacer devuelve el cupo al servidor');
      void antesV;
    });
    t.eq(await h.inesperados(), [], 'F1) sin errores inesperados');
    await h.close();
  }
});
