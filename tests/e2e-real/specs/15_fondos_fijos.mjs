// 15_fondos_fijos — Fondos Fijos (PR K) contra el SDK REAL de Firestore + emulador.
//   F1) Guardado con merge por campo: editar una celda del modal = UN setDoc con merge:true confirmado que toca SOLO `fondos_fijos.meses.<MES>.<campo>` (o `fondos_fijos.cupo`); el servidor conserva lo demás
//       (folio, otros meses, otros documentos); otra persona (cliente del SDK real) escribe OTRO mes del mismo RBD y ambos conviven; sobrevive a recargar (IndexedDB real) y recargar no escribe.
//       Un valor inválido (negativo) no se envía; el folio se recorta a 40; lo registrado en General sube el B&S de General en el panel.
//   F2) Importación en lote («FONDOS FIJOS P02», 3 entidades): un setDoc confirmado por entidad, el servidor recibe cupo / saldo inicial / rendido / observado / folio y CONSERVA Registrado en General, Compensado SIGFE
//       y Reposición; reimportar es idempotente; una fila con un monto negativo se rechaza y NO se escribe; con un rechazo permanente del servidor (reglas que niegan la escritura de una entidad) el resumen dice cuántas
//       se guardaron y cuáles no, los datos quedan en pantalla y el indicador queda rojo con «Reintentar».
//   F3) Lectura de `fondos_fijos` DAÑADO que el servidor sí guarda (texto, negativos, folio que no es texto o de 200 caracteres, AC con Fondos Fijos): el panel queda verde, no escribe nada y ningún documento cambia.
// Esperado: PASS en la PR; FALLA en @13653a5 (sin validación, sin recorte de folio, importador sin resumen de fallos).
import { boot, prepararServidor, cargarFixture, estado, clickTab, cerrarModal } from '../lib/harness.mjs';
import { asegurarEmulador, REGLAS_SIN_ESCRITURA_EN, REGLAS_ABIERTAS } from '../lib/emulator.mjs';
import { correrSpec } from '../lib/spec.mjs';

const esperar = async (cond, timeout = 20000, paso = 100) => { const t0 = Date.now(); for (;;) { const r = await cond(); if (r) return r; if (Date.now() - t0 > timeout) return null; await new Promise(r => setTimeout(r, paso)); } };
const clon = (o) => JSON.parse(JSON.stringify(o));
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v));
const writesDe = async (h, id) => (await h.writes()).filter(w => w.path === `sep_carga_rbd/${id}`);
async function abrirFF(h, id) {
  await clickTab(h.page, 'of-fondos_fijos');
  await h.page.click(`#fondosFijosTbody [data-ff-abrir="${id}"]`);
  await h.page.waitForSelector('#fondosFijosModal:not(.hidden)');
  await h.page.waitForTimeout(150);
}
const celda = (id, mes, campo) => (mes ? `#fondosFijosModalBody input.ff-input[data-ff-rbd="${id}"][data-ff-mes="${mes}"][data-ff-campo="${campo}"]` : `#fondosFijosModalBody input.ff-input[data-ff-rbd="${id}"][data-ff-campo="${campo}"]`);
async function escribir(h, sel, valor) { await h.page.fill(sel, String(valor)); await h.page.press(sel, 'Tab'); await h.flush(); }
const HOJA = 'FONDOS FIJOS P02';
const COL = [['MARZO', 7, 13], ['ABRIL', 15, 21], ['OCTUBRE', 63, null]];
function fila(id, cupo, meses) {
  const r = new Array(81).fill(null); r[0] = id; r[6] = cupo;
  COL.forEach(([mes, ini, cf]) => { const m = meses[mes]; if (!m) return; r[ini] = m.saldo; r[ini + 2] = m.rendido; r[ini + 3] = m.obs; if (cf !== null && m.folio !== undefined) r[cf] = m.folio; });
  return r;
}
async function libro(page, filas) {
  const bytes = await page.evaluate((f) => { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(f), 'FONDOS FIJOS P02'); return Array.from(new Uint8Array(XLSX.write(wb, { bookType: 'xlsx', type: 'array' }))); }, filas);
  return Buffer.from(bytes);
}
async function importar(h, buffer) {
  const antes = h.dialogs.length;
  await h.page.setInputFiles('#importFondosFijosInput', { name: 'control.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  await esperar(async () => h.dialogs.slice(antes).some(d => d.type === 'alert'), 30000);
  await h.page.waitForTimeout(300);
  return (h.dialogs.slice(antes).filter(d => d.type === 'alert').pop() || {}).message || '';
}

await correrSpec('15_fondos_fijos', async (t) => {
  const emu = await asegurarEmulador();
  const fx = cargarFixture('fondos_fijos');

  // ============================================================ F1) guardado con merge por campo
  {
    const h = await boot({ fixture: 'fondos_fijos' });
    const { page } = h;
    await t.escenario('F1', async () => {
      const base = await emu.instantanea();
      await abrirFF(h, '1122');
      await h.clearLog();
      await escribir(h, celda('1122', 'ABRIL', 'rendido'), 120000);
      let w = await writesDe(h, '1122');
      t.eq(w.length, 1, 'F1) editar «Rendido» de abril = UN write');
      t.ok(w[0] && w[0].op === 'setDoc' && w[0].options && w[0].options.merge === true && w[0].status === 'acked', 'F1) setDoc con merge:true confirmado por el servidor');
      t.eq(JSON.stringify(w[0].payload.fondos_fijos), JSON.stringify({ meses: { ABRIL: { rendido: 120000 } } }), 'F1) el payload de Fondos Fijos es SOLO `meses.ABRIL.rendido`');
      let s = await emu.leer('1122');
      t.eq(canon(s.data.fondos_fijos.meses.ABRIL), canon({ rendido: 120000, folio: 'FF-0100' }), 'F1) servidor: merge profundo (el folio de abril sigue ahí)');
      t.eq(s.data.fondos_fijos.cupo, 300000, 'F1) servidor: el cupo no cambió');
      // el resto del documento y los demás documentos quedan idénticos
      const sinFF = (d) => { const c = clon(d.data); delete c.fondos_fijos; delete c.lastModifiedBy; delete c.lastModifiedAt; return canon(c); };
      t.eq(sinFF(s), sinFF(base['1122']), 'F1) servidor: lo que no es Fondos Fijos queda EXACTAMENTE igual');
      t.eq(canon((await emu.leer('1121')).data.fondos_fijos), canon(base['1121'].data.fondos_fijos), 'F1) servidor: otro documento (1121) no se tocó');
      // cupo y folio
      await h.clearLog();
      await escribir(h, celda('1122', null, 'cupo'), 450000);
      w = await writesDe(h, '1122');
      t.ok(w.length === 1 && JSON.stringify(w[0].payload.fondos_fijos) === JSON.stringify({ cupo: 450000 }) && w[0].status === 'acked', 'F1) el cupo = un write de SOLO `fondos_fijos.cupo`');
      await h.clearLog();
      await escribir(h, celda('1122', 'ABRIL', 'folio'), 'X'.repeat(60));
      w = await writesDe(h, '1122');
      t.eq(w.length === 1 && w[0].payload.fondos_fijos.meses.ABRIL.folio, 'X'.repeat(40), 'F1) un folio de 60 caracteres viaja recortado a 40');
      t.ok(h.dialogs.some(d => d.type === 'alert' && /recortado a 40 caracteres/.test(d.message)), 'F1) y se avisó');
      t.eq((await emu.leer('1122')).data.fondos_fijos.meses.ABRIL.folio, 'X'.repeat(40), 'F1) servidor: folio recortado');
      // negativo: no se envía
      await h.clearLog();
      await escribir(h, celda('1122', 'ABRIL', 'observado'), '-5');
      t.eq((await writesDe(h, '1122')).length, 0, 'F1) un monto negativo NO se envía al servidor (0 writes)');
      t.ok(h.dialogs.some(d => d.type === 'alert' && /no puede ser negativo/.test(d.message)), 'F1) y avisa');
      // otra persona escribe OTRO mes del mismo RBD (cliente del SDK real)
      await emu.escribirComoOtro('1122', { fondos_fijos: { meses: { JUNIO: { observado: 777 } } } });
      t.ok(!!(await esperar(async () => (await page.inputValue(celda('1122', 'JUNIO', 'observado'))) === '777')), 'F1) el cambio de la otra persona aparece en el modal abierto, sin recargar');
      await escribir(h, celda('1122', 'JULIO', 'rendido'), 5000);
      s = await emu.leer('1122');
      t.eq([s.data.fondos_fijos.meses.JUNIO.observado, s.data.fondos_fijos.meses.JULIO.rendido, s.data.fondos_fijos.meses.ABRIL.rendido], [777, 5000, 120000], 'F1) servidor: las dos ediciones conviven (la ajena y la propia)');
      await cerrarModal(h);
      // registrar en General mueve el B&S de General en el panel
      await abrirFF(h, '5401006');
      await escribir(h, celda('5401006', 'JULIO', 'registrado_general'), 50000);
      await cerrarModal(h);
      await clickTab(page, 'of-general');
      const fila = await page.evaluate(() => { const tr = document.querySelector('#otrasFuentesTbody-general tr[data-rbd="5401006"]'); return tr ? tr.children[6].textContent.trim() : null; });
      t.eq(fila && fila.replace(/\D/g, ''), '50000', 'F1) un jardín con Fondos Fijos registrados en General aparece como fila de General con ese B&S');
      // recarga
      await h.clearLog();
      await h.recargar();
      await h.esperarVerde({ timeout: 40000 });
      await abrirFF(h, '1122');
      t.eq([await page.inputValue(celda('1122', 'ABRIL', 'rendido')), await page.inputValue(celda('1122', null, 'cupo'))], ['120000', '450000'], 'F1) tras recargar (IndexedDB real) lo guardado sigue ahí');
      await cerrarModal(h);
      t.eq((await h.writes()).length, 0, 'F1) recargar no escribe nada');
      t.ok((await estado(page)).color === 'green', 'F1) el indicador queda verde');
      await t.sinErrores(h);
    });
    await h.close();
  }

  // ============================================================ F2) importación en lote
  {
    await prepararServidor(emu, fx);
    const h = await boot({ prepararServidor: false });
    const { page } = h;
    await t.escenario('F2', async () => {
      await clickTab(page, 'of-fondos_fijos');
      const filas = [['CONTROL'], ['RBD'],
        fila('1121', 600000, { MARZO: { saldo: 1, rendido: 160000, obs: 20000, folio: 'FF-IMP-3' }, OCTUBRE: { saldo: 5, rendido: 6, obs: 0 } }),
        fila('1130', 11000, { ABRIL: { saldo: 1, rendido: 2, obs: 0, folio: 'A'.repeat(50) } }),
        fila('5401006', 22000, { MARZO: { saldo: 3, rendido: 4, obs: 0 } }),
        fila('1131', 5, { MARZO: { saldo: 1, rendido: -50, obs: 0 } })];
      const antes = await emu.instantanea();
      await h.clearLog();
      const msg = await importar(h, await libro(page, filas));
      t.ok(/3 de 3 entidades guardadas/.test(msg) && /1 fila NO se importó/.test(msg) && /· 1131: .*Rendido no puede ser negativo/.test(msg) && /1 folio fue recortado/.test(msg), 'F2) resumen: 3 de 3 guardadas, 1 fila rechazada (1131, negativa) y 1 folio recortado', msg);
      const wr = (await h.writes()).filter(w => w.payload && w.payload.fondos_fijos);
      t.ok(wr.length === 3 && wr.every(w => w.op === 'setDoc' && w.options.merge === true && w.status === 'acked'), 'F2) UN setDoc confirmado con merge:true por cada entidad válida (3)', wr.map(w => [w.path, w.status]));
      t.eq((await writesDe(h, '1131')).length, 0, 'F2) la fila rechazada (1131) no escribe nada');
      const s1121 = (await emu.leer('1121')).data.fondos_fijos;
      t.eq([s1121.cupo, s1121.meses.MARZO.rendido, s1121.meses.MARZO.folio, s1121.meses.OCTUBRE.rendido], [600000, 160000, 'FF-IMP-3', 6], 'F2) servidor: cupo, rendido, folio (marzo) y octubre importados');
      t.eq([s1121.meses.MARZO.registrado_general, s1121.meses.MARZO.compensado_sigfe, s1121.meses.MARZO.reposicion, s1121.meses.JUNIO.registrado_general], [120000, 60000, 100000, 80000], 'F2) servidor: Registrado en General, Compensado SIGFE y Reposición se CONSERVAN');
      t.eq((await emu.leer('1130')).data.fondos_fijos.meses.ABRIL.folio, 'A'.repeat(40), 'F2) servidor: el folio de 50 caracteres quedó en 40');
      t.eq(canon((await emu.leer('1131')).data), canon(antes['1131'].data), 'F2) servidor: 1131 igual que antes');
      t.eq(canon((await emu.leer('1125')).data), canon(antes['1125'].data), 'F2) servidor: una entidad que no estaba en el archivo (1125) no se tocó');
      // idempotente
      const snap = canon(Object.fromEntries(Object.entries(await emu.instantanea()).map(([k, v]) => [k, (({ lastModifiedAt, lastModifiedBy, ...r }) => r)(v.data)])));
      await h.clearLog();
      await importar(h, await libro(page, filas));
      const snap2 = canon(Object.fromEntries(Object.entries(await emu.instantanea()).map(([k, v]) => [k, (({ lastModifiedAt, lastModifiedBy, ...r }) => r)(v.data)])));
      t.eq(snap2, snap, 'F2) reimportar el mismo archivo deja TODOS los documentos idénticos (idempotente)');
      t.ok((await estado(page)).color === 'green', 'F2) indicador verde');
      await t.sinErrores(h);
    });
    await h.close();

    // rechazo permanente del servidor para UNA entidad (reglas que niegan la escritura de 1132)
    await prepararServidor(emu, fx);
    const h2 = await boot({ prepararServidor: false });
    h2.expectErrors(/Error guardando RBD 1132/, /permission-denied|PERMISSION_DENIED|Missing or insufficient permissions/i);
    await t.escenario('F2b', async () => {
      await clickTab(h2.page, 'of-fondos_fijos');
      await emu.reglas(REGLAS_SIN_ESCRITURA_EN('1132'));
      await h2.clearLog();
      const msg = await importar(h2, await libro(h2.page, [['CONTROL'], ['RBD'], fila('1132', 1, { MARZO: { saldo: 1, rendido: 2, obs: 0 } }), fila('1133', 2, { MARZO: { saldo: 3, rendido: 4, obs: 0 } }), fila('1134', 3, { MARZO: { saldo: 5, rendido: 6, obs: 0 } })]));
      t.ok(/2 de 3 entidades guardadas/.test(msg) && /NO se pudieron guardar 1 entidad: 1132\./.test(msg) && /Reintentar/.test(msg), 'F2b) con un rechazo permanente de 1132: «2 de 3 entidades guardadas», dice cuál no y cómo reintentar', msg);
      const e = await estado(h2.page);
      t.ok(e.color === 'red' && /sin guardar/.test(e.txt) && e.retry, 'F2b) el indicador queda en rojo con «Reintentar»', e);
      const fil = await h2.page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll('#fondosFijosTbody tr')).filter(tr => ['1132', '1133', '1134'].includes(tr.children[0].textContent.trim())).map(tr => [tr.children[0].textContent.trim(), tr.children[2].textContent.replace(/\D/g, '')])));
      t.eq(fil, { 1132: '1', 1133: '2', 1134: '3' }, 'F2b) la pantalla muestra lo importado en las 3 entidades (no queda a medias)');
      t.eq([(await emu.leer('1133')).data.fondos_fijos.cupo, (await emu.leer('1134')).data.fondos_fijos.cupo, ((await emu.leer('1132')).data.fondos_fijos || {}).cupo], [2, 3, undefined], 'F2b) servidor: 1133 y 1134 sí; 1132 no');
      await emu.reglas(REGLAS_ABIERTAS);
      await h2.page.click('#sync-retry');
      await esperar(async () => ((await emu.leer('1132')).data.fondos_fijos || {}).cupo === 1, 20000);
      t.eq((await emu.leer('1132')).data.fondos_fijos.cupo, 1, 'F2b) con las reglas restablecidas «Reintentar» lo guarda sin volver a importar');
      await t.sinErrores(h2, 'F2b) sin errores inesperados (el rechazo de 1132 era el esperado)');
    });
    await h2.close();
  }

  // ============================================================ F3) documentos dañados
  {
    await prepararServidor(emu, fx);
    await emu.sembrar({
      '1121': { fondos_fijos: { cupo: 'abc', meses: { ENERO: { saldo_inicial: '1000', rendido: true, observado: -500, registrado_general: null, compensado_sigfe: { a: 1 }, folio: 12345 }, MARZO: 'texto', ABRIL: { folio: 'F'.repeat(200) } } } },
      '1123': { fondos_fijos: 'texto' },
      '1125': { fondos_fijos: { cupo: -1, meses: [1, 2] } },
      'AC': { fondos_fijos: { cupo: 5, meses: { ENERO: { rendido: 5000, registrado_general: 5000 } } } },
    }, { merge: true, conAuditoria: false });
    const h = await boot({ prepararServidor: false, waitReady: false });
    const { page } = h;
    await t.escenario('F3', async () => {
      const antes = await emu.instantanea();
      await h.esperarVerde({ timeout: 40000 });
      await page.waitForTimeout(1000);
      const e = await estado(page);
      t.ok(e.color === 'green' && /^Sincronizado/.test(e.txt), 'F3) el panel queda VERDE con Fondos Fijos dañados', e);
      await abrirFF(h, '1121');
      t.eq([await page.inputValue(celda('1121', 'ENERO', 'folio')), (await page.inputValue(celda('1121', 'ABRIL', 'folio'))).length, await page.inputValue(celda('1121', 'ENERO', 'saldo_inicial')), await page.inputValue(celda('1121', 'ENERO', 'observado'))], ['12345', 40, '1000', ''], 'F3) lectura tolerante: folio numérico = texto, folio de 200 caracteres = 40, «1000» = 1000, negativo = vacío (0)');
      await cerrarModal(h);
      await clickTab(page, 'of-general');
      const ac = await page.evaluate(() => { const tr = document.querySelector('#otrasFuentesTbody-general tr[data-rbd="AC"]'); return tr.children[6].textContent.trim(); });
      t.eq(ac, '$14.181.000', 'F3) AC con `fondos_fijos` (5.000 registrados) en su documento: AC no es entidad de Fondos Fijos y su B&S de General (14.181.000) no los suma');
      t.eq((await h.writes()).length, 0, 'F3) el panel no escribió nada');
      const despues = await emu.instantanea();
      t.eq(Object.keys(antes).filter(id => antes[id].updateTime !== despues[id].updateTime), [], 'F3) ningún documento cambió (updateTime intacto)');
      await t.sinErrores(h);
    });
    await h.close();
  }
});
