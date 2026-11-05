// 17_carga_reemplazo_total — carga por fuente = REEMPLAZO TOTAL contra el SDK REAL de Firestore + emulador (el mock no prueba que `mergeFields` y `deleteField()` borren de verdad).
//
//   C1) Subir un Excel de General: lo guardado en el servidor (REST) es EXACTAMENTE el archivo (filas y suma de MontoGasto, Total Año de INGRESO/REMUNERACIONES); solo se escriben los documentos que cambian;
//       el resto de los campos del documento, las otras fuentes y SEP quedan idénticos (updateTime de los demás documentos intacto).
//   C2) Un Excel con filas eliminadas / modificadas / entidad ausente: en el servidor desaparecen de verdad las claves (el merge:true anterior las conservaba) y no hay duplicados; el mismo Excel otra vez NO escribe.
//   C3) 3.200 compras: el SDK real acepta los lotes (≤ 400 documentos por batch), el servidor guarda todo y el panel cuadra; un documento que pasaría de 1 MiB se bloquea ANTES de escribir.
//   C4) Servidor que RECHAZA la escritura (reglas de solo lectura): error visible y persistente, el panel vuelve a mostrar lo guardado, no se ofrece «Deshacer» y no queda nada a medias.
//   C5) Deshacer última carga y Vaciar fuente contra el servidor real (`otras_fuentes.general` desaparece de verdad; el respaldo devuelve el estado anterior).
//   C6) Las reglas REALES de firestore.rules permiten el batch con mergeFields + deleteField (las reglas prohíben borrar DOCUMENTOS, no campos).
// Esperado: PASS en la PR; en @d67b30a (merge:true) el spec no aplica (no existe el resumen de control).
import fs from 'node:fs';
import path from 'node:path';
import { boot, clickTab } from '../lib/harness.mjs';
import { asegurarEmulador, REGLAS_ABIERTAS, REGLAS_SOLO_LECTURA } from '../lib/emulator.mjs';
import { PROJECT_ID, REPO_DIR, requireDeps } from '../lib/env.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { libroXlsx, ENC_COMPRAS_FUENTE, filaCompra, compraBase } from '../../lib/compras.mjs';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const ENC = ['RBD', 'Nombre', ...MESES, 'Total Año'];
const clon = (o) => JSON.parse(JSON.stringify(o));
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v));
const mensual = (rbd, nombre, v) => [Number(rbd) || rbd, nombre, ...new Array(12).fill(v), 12 * v];
const compra = (extra) => compraBase({ codigo: '410606', ...extra });
const NOMBRE = { 1121: 'LICEO PULMAHUE DE LA LIGUA', 1122: 'ESCUELA 1122', AC: 'Administración Central' };
const fila = (id, rbd, c) => filaCompra(id, Number(rbd) || rbd, NOMBRE[rbd] || String(rbd), c);
const comprasDe = async (emu, rbd) => ((await emu.leer(rbd)).data.otras_fuentes || {}).general ? (((await emu.leer(rbd)).data.otras_fuentes.general).compras || {}) : {};
const suma = (m) => Object.values(m).reduce((s, c) => s + Number(c.montoGasto), 0);
async function subir(h, buffer, { confirmar = true } = {}) {
  const { page } = h;
  await page.setInputFiles('#importExcelOFInput-general', { name: 'carga.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await page.waitForFunction(() => !!document.getElementById('cargaOkBtn') || !!document.getElementById('cargaCerrarBtn'), null, { timeout: 90000 });
  const control = await page.evaluate(() => document.getElementById('cargaControlBody').innerText.replace(/\s+/g, ' '));
  if (!confirmar) { await page.click('#cargaCancelarBtn'); return { control }; }
  if (!await page.$('#cargaOkBtn')) { await page.click('#cargaCerrarBtn'); return { control }; }
  if (await page.evaluate(() => document.getElementById('cargaOkBtn').disabled)) { await page.click('#cargaCancelarBtn'); return { control, bloqueado: true }; } // el resumen bloquea la carga (p. ej. documento de más de 1 MiB)
  await page.click('#cargaOkBtn');
  await page.waitForFunction(() => !!document.getElementById('cargaCerrarBtn') && !document.getElementById('cargaOkBtn') && !/Guardando para el resto/.test(document.getElementById('cargaControlBody').innerText), null, { timeout: 120000 });
  const resultado = await page.evaluate(() => document.getElementById('cargaControlBody').innerText.replace(/\s+/g, ' '));
  const banner = await page.evaluate(() => { const b = document.getElementById('cargaErrorBanner'); return b.classList.contains('hidden') ? '' : b.innerText.replace(/\s+/g, ' '); });
  await page.click('#cargaCerrarBtn');
  await h.esperarEscriturasListas().catch(() => {});
  return { control, resultado, banner };
}

await correrSpec('17_carga_reemplazo_total', async (t) => {
  const emu = await asegurarEmulador();

  // ============================================================ C1 + C2) servidor real
  {
    const h = await boot({ fixture: 'default' });
    const { page } = h;
    await clickTab(page, 'of-general');
    await t.escenario('C1', async () => {
      const base = await emu.instantanea();
      const otrasAntes = {};
      Object.entries(base).forEach(([id, d]) => { const o = clon(d.data); if (o.otras_fuentes) delete o.otras_fuentes.general; delete o.lastModifiedAt; delete o.lastModifiedBy; otrasAntes[id] = canon(o); });
      const cs = [fila('', 1121, compra({ nroDocumento: '100', montoGasto: 100000 })), fila('', 1121, compra({ nroDocumento: '101', montoGasto: 250000, codigo: '410605' })),
        fila('', 1122, compra({ nroDocumento: '200', montoGasto: 75500 })), fila('', 1122, compra({ nroDocumento: '201', tipoDocumento: 'Nota de crédito', montoGasto: 20000, documentoOriginal: '100-FAC' }))];
      const libro = await libroXlsx(page, { INGRESO: [ENC, mensual(1121, NOMBRE[1121], 1000000)], REMUNERACIONES: [ENC, mensual(1121, NOMBRE[1121], 400000)], COMPRAS: [ENC_COMPRAS_FUENTE, ...cs] });
      await h.clearLog();
      const r = await subir(h, libro);
      t.ok(/aplicado y verificado/.test(r.resultado), 'C1) la carga se aplica y el panel cuadra con el Excel', r.resultado && r.resultado.slice(0, 300));
      const c1121 = await comprasDe(emu, '1121'), c1122 = await comprasDe(emu, '1122');
      t.eq([Object.keys(c1121).length, Object.keys(c1122).length], [2, 2], 'C1) servidor: 2 + 2 compras');
      t.eq(suma(c1121) + suma(c1122), 100000 + 250000 + 75500 - 20000, 'C1) servidor: suma de MontoGasto exacta (la nota de crédito en negativo)');
      const g = (await emu.leer('1121')).data.otras_fuentes.general;
      t.eq([g.ingreso.total, g.gasto_rem.total], [12000000, 4800000], 'C1) servidor: Total Año de INGRESO y de REMUNERACIONES');
      const w = (await h.writes()).filter(x => x.op === 'batch.set');
      t.ok(w.length > 0 && w.every(x => x.options && Array.isArray(x.options.mergeFields)), 'C1) las escrituras son batch.set con mergeFields (reemplazo de campos, no merge)', w[0] && w[0].options);
      t.ok(w.every(x => x.status === 'acked'), 'C1) todas confirmadas por el servidor');
      const despues = await emu.instantanea();
      const distintos = [];
      Object.entries(despues).forEach(([id, d]) => { const o = clon(d.data); if (o.otras_fuentes) delete o.otras_fuentes.general; delete o.lastModifiedAt; delete o.lastModifiedBy; if (canon(o) !== otrasAntes[id]) distintos.push(id); });
      t.eq(distintos, [], 'C1) servidor: fuera de General nada cambió (SEP, PIE, FAEP, JUNJI…)');
      t.eq(Object.keys(despues).filter(id => despues[id].updateTime !== base[id].updateTime).sort(), ['1121', '1122', 'AC'], 'C1) solo se escribieron los documentos que cambian (1121, 1122 y AC, que tenía datos de General y quedó vacía en INGRESO/REMUNERACIONES)');
    });
    await t.escenario('C2', async () => {
      const antes = await emu.instantanea();
      // el MISMO Excel (el que exporta el panel) otra vez: no escribe nada
      const { capturarDescarga } = await import('../../lib/capture-utils.mjs');
      const dl = await capturarDescarga(page, () => page.click('#downloadExcelOFBtn-general'));
      await h.clearLog();
      const r0 = await subir(h, dl.buffer);
      t.ok(/idéntico a lo que ya hay/.test(r0.control) && (await h.writes()).length === 0, 'C2) el mismo Excel otra vez: «idéntico» y sin ninguna escritura');
      // fila modificada (código y FechaPago), una eliminada y una entidad ausente
      const cs = [fila('', 1121, compra({ nroDocumento: '100', montoGasto: 100000, codigo: '410605', fechaPago: '2026-07-07' }))];
      const r = await subir(h, await libroXlsx(page, { COMPRAS: [ENC_COMPRAS_FUENTE, ...cs] }));
      t.ok(/aplicado y verificado/.test(r.resultado), 'C2) carga aplicada y cuadrada');
      const c1121 = await comprasDe(emu, '1121');
      t.eq(Object.values(c1121).map(c => [c.nroDocumento, c.codigo, c.fechaPago]), [['100', '410605', '2026-07-07']], 'C2) servidor 1121: UNA sola compra, con el valor nuevo (la antigua y la «101» ya no existen)');
      t.eq(await comprasDe(emu, '1122'), {}, 'C2) servidor 1122 (ausente de la hoja): sin compras (la clave se borró de verdad)');
      const despues = await emu.instantanea();
      t.eq(despues['1121'].data.otras_fuentes.general.ingreso.total, 12000000, 'C2) INGRESO (hoja ausente) se conserva');
      t.ok(despues['1123'].updateTime === antes['1123'].updateTime, 'C2) un documento que no cambia no se escribe');
    });
    t.eq(await h.inesperados(), [], 'C1/C2) sin errores inesperados en la página');
    await h.close();
  }

  // ============================================================ C3) Excel grande y límite de documento
  {
    const h = await boot({ fixture: 'default' });
    const { page } = h;
    await clickTab(page, 'of-general');
    await t.escenario('C3', async () => {
      const N = 3200, ents = [1121, 1122, 'AC'];
      const filas = Array.from({ length: N }, (_, i) => fila('', ents[i % 3], compra({ nroDocumento: String(10000 + i), montoGasto: 1000 + (i % 97) * 13, fechaDocumento: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 27)).padStart(2, '0')}`, documentoContable: 'DC_' + (i % 40) })));
      const t0 = Date.now();
      const r = await subir(h, await libroXlsx(page, { COMPRAS: [ENC_COMPRAS_FUENTE, ...filas] }));
      const ms = Date.now() - t0;
      t.ok(/aplicado y verificado/.test(r.resultado), 'C3) 3.200 compras: aplicado y verificado', r.resultado && r.resultado.slice(0, 300));
      const total = (await Promise.all(ents.map(async e => { const m = await comprasDe(emu, e); return [Object.keys(m).length, suma(m)]; }))).reduce((a, b) => [a[0] + b[0], a[1] + b[1]], [0, 0]);
      t.eq(total, [N, filas.reduce((s, f) => s + f[11], 0)], 'C3) servidor: 3.200 filas y la suma exacta de MontoGasto');
      t.info(`3.200 compras: subir + resumen + guardar + verificar = ${ms} ms`);
      // documento > 1 MiB: 5.000 compras de una sola entidad
      const grande = Array.from({ length: 5000 }, (_, i) => fila('', 1121, compra({ nroDocumento: String(50000 + i), descripcion: 'x'.repeat(150), montoGasto: 100 + i })));
      const antes = await emu.instantanea();
      await h.clearLog();
      const rg = await subir(h, await libroXlsx(page, { COMPRAS: [ENC_COMPRAS_FUENTE, ...grande] }));
      t.ok(rg.bloqueado && /supera el límite de Firestore \(1 MiB\)/.test(rg.control), 'C3) una carga que dejaría un documento de más de 1 MiB se BLOQUEA antes de escribir (botón deshabilitado y mensaje claro)', rg.control.slice(0, 400));
      t.eq((await h.writes()).length, 0, 'C3) y no se escribió nada');
      const despues = await emu.instantanea();
      t.eq(Object.keys(despues).filter(id => despues[id].updateTime !== antes[id].updateTime), [], 'C3) ningún documento cambió en el servidor');
    });
    await h.close();
  }

  // ============================================================ C4) el servidor rechaza la escritura
  {
    const h = await boot({ fixture: 'default' });
    const { page } = h;
    h.expectErrors(/permission|insufficient|Missing or insufficient/i, /Error guardando/i);
    await clickTab(page, 'of-general');
    await t.escenario('C4', async () => {
      await emu.reglas(REGLAS_SOLO_LECTURA);
      const antes = await emu.instantanea();
      const libro = await libroXlsx(page, { INGRESO: [ENC, mensual(1121, NOMBRE[1121], 777)] });
      const r = await subir(h, libro);
      t.ok(/NO guardó la carga/.test(r.resultado), 'C4) el resultado dice que el servidor NO guardó la carga (rojo)', r.resultado && r.resultado.slice(0, 300));
      t.ok(/la carga no se guardó en el servidor/.test(r.banner), 'C4) banner rojo persistente', r.banner);
      t.eq(await page.evaluate(() => document.getElementById('undoCargaOFBtn-general').classList.contains('hidden')), true, 'C4) no se ofrece «Deshacer» (no hay nada que deshacer)');
      const despues = await emu.instantanea();
      t.eq(Object.keys(despues).filter(id => despues[id].updateTime !== antes[id].updateTime), [], 'C4) el servidor no cambió');
      await page.waitForTimeout(500);
      const ing = await page.evaluate(() => { const td = document.querySelector('#otrasFuentesTbody-general td[data-abrir-otra-fuente="1121"]'); return td ? td.closest('tr').innerText.replace(/\s+/g, ' ') : ''; });
      t.ok(!ing.includes('9.324.000'), 'C4) el panel volvió a mostrar lo guardado (no quedó el ingreso rechazado)', ing);
      await emu.reglas(REGLAS_ABIERTAS);
    });
    await h.close();
  }

  // ============================================================ C5) Deshacer y Vaciar
  {
    const h = await boot({ fixture: 'default' });
    const { page } = h;
    await clickTab(page, 'of-general');
    await t.escenario('C5', async () => {
      const g0 = canon((await emu.leer('1121')).data.otras_fuentes.general);
      await subir(h, await libroXlsx(page, { INGRESO: [ENC, mensual(1121, NOMBRE[1121], 5)], COMPRAS: [ENC_COMPRAS_FUENTE] }));
      t.ok(canon((await emu.leer('1121')).data.otras_fuentes.general) !== g0, 'C5) la carga cambió General');
      await page.click('#undoCargaOFBtn-general'); await page.waitForSelector('#cargaOkBtn'); await page.click('#cargaOkBtn');
      await page.waitForFunction(() => !!document.getElementById('cargaCerrarBtn') && !/Guardando para el resto/.test(document.getElementById('cargaControlBody').innerText), null, { timeout: 60000 });
      await page.click('#cargaCerrarBtn'); await h.esperarEscriturasListas();
      const g1 = (await emu.leer('1121')).data.otras_fuentes.general;
      const g0o = JSON.parse(g0);
      t.eq([g1.ingreso.total, Object.keys(g1.compras).length], [g0o.ingreso.total, Object.keys(g0o.compras).length], 'C5) Deshacer devuelve en el servidor el ingreso y las compras anteriores');
      // Vaciar fuente
      await page.click('#vaciarOFBtn-general'); await page.fill('#cargaConfirmaNombre', 'Subvención General'); await page.click('#cargaOkBtn');
      await page.waitForFunction(() => !!document.getElementById('cargaCerrarBtn') && !/Guardando para el resto/.test(document.getElementById('cargaControlBody').innerText), null, { timeout: 60000 });
      await page.click('#cargaCerrarBtn'); await h.esperarEscriturasListas();
      const inst = await emu.instantanea();
      t.eq(Object.keys(inst).filter(id => inst[id].data.otras_fuentes && inst[id].data.otras_fuentes.general), [], 'C5) Vaciar fuente: `otras_fuentes.general` desapareció de TODOS los documentos del servidor');
      t.ok(Object.keys(inst).some(id => inst[id].data.otras_fuentes && inst[id].data.otras_fuentes.pie), 'C5) …y PIE sigue ahí');
    });
    await h.close();
  }

  // ============================================================ C6) reglas reales
  await t.escenario('C6', async () => {
    const reglas = fs.readFileSync(path.join(REPO_DIR, 'firestore.rules'), 'utf8');
    const { initializeTestEnvironment, assertSucceeds, assertFails } = requireDeps('@firebase/rules-unit-testing');
    const env = await initializeTestEnvironment({ projectId: PROJECT_ID, firestore: { host: emu.host, port: emu.port, rules: reglas } });
    try {
      await env.withSecurityRulesDisabled(async (ctx) => { await ctx.firestore().doc('sep_carga_rbd/1121').set({ rbd: '1121', otras_fuentes: { general: { compras: { a: { montoGasto: 1 }, b: { montoGasto: 2 } }, real_hasta_mes: 3 } } }); });
      const db = env.authenticatedContext('u1', { email: 'wilson.rojas@sleppetorca.gob.cl' }).firestore();
      const FV = requireDeps('firebase/compat/app').default.firestore.FieldValue;
      const lote = (d) => { const b = d.batch(); b.set(d.doc('sep_carga_rbd/1121'), { otras_fuentes: { general: { compras: {}, real_hasta_mes: FV.delete() } }, lastModifiedBy: 'x' }, { mergeFields: ['otras_fuentes.general.compras', 'otras_fuentes.general.real_hasta_mes', 'lastModifiedBy'] }); return b.commit(); };
      let ok = true; try { await assertSucceeds(lote(db)); } catch (e) { ok = false; }
      t.ok(ok, 'C6) las reglas reales permiten un batch con mergeFields + deleteField() de un campo (borrar campos no es borrar el documento)');
      const noAut = env.authenticatedContext('u2', { email: 'otra@gmail.com' }).firestore();
      let bloqueado = true; try { await assertFails(lote(noAut)); } catch (e) { bloqueado = false; }
      t.ok(bloqueado, 'C6) y un correo fuera de la lista sigue sin poder escribir');
      const docFinal = await emu.leer('1121');
      t.eq(docFinal.data.otras_fuentes.general, { compras: {} }, 'C6) el documento quedó con compras {} y sin real_hasta_mes');
    } finally { await env.cleanup(); await emu.reglas(REGLAS_ABIERTAS); }
  });
});
