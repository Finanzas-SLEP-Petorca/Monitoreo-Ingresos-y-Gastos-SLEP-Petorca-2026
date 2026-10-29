// 14_honorarios_fuentes — Honorarios (Subt. 21) por boleta en las FUENTES (PR-3) contra el SDK REAL de Firestore + emulador.
//   H1) Alta / edición / borrado de una boleta en una fuente CON CUENTA (General), una POR CONCEPTO (Subt. 31, Asignación Familiar) = UN setDoc con merge:true confirmado que toca SOLO
//       `otras_fuentes.<fuente>.honorarios.<id>` (más nombre y auditoría); el resto del documento queda idéntico en el servidor. Otra persona edita OTRA boleta de la misma entidad: ambas conviven.
//       Sobrevive a recargar (IndexedDB real) y recargar no escribe. AC y un jardín (GESPARVU) funcionan igual. La proyección por concepto escribe solo ese mes.
//   H2) Recuperación LLMM (solo ingresos) NO ofrece honorarios: ni formulario ni escritura; una boleta guardada en su documento no se toca ni cuenta.
//   H3) Documentos dañados que el servidor sí guarda (boletas que no son objetos, montos de texto, `honorarios` / `hon_proyeccion_items` de otro tipo): el panel los tolera (verde), no escribe nada
//       y ningún documento cambia.
// Esperado: PASS en la PR; FALLA en @1bb8ccc (las fuentes no tienen honorarios).
import { boot, prepararServidor, cargarFixture, estado, clickTab, cerrarModal } from '../lib/harness.mjs';
import { asegurarEmulador } from '../lib/emulator.mjs';
import { correrSpec } from '../lib/spec.mjs';

const esperar = async (cond, timeout = 20000, paso = 100) => { const t0 = Date.now(); for (;;) { const r = await cond(); if (r) return r; if (Date.now() - t0 > timeout) return null; await new Promise(r => setTimeout(r, paso)); } };
const clon = (o) => JSON.parse(JSON.stringify(o));
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v));
const writesDe = async (h, id) => (await h.writes()).filter(w => w.path === `sep_carga_rbd/${id}`);
async function abrirFuente(h, key, id) {
  await clickTab(h.page, 'of-' + key);
  await h.page.click(`#otrasFuentesTbody-${key} td[data-abrir-otra-fuente="${id}"]`);
  await h.page.waitForSelector('#otrasFuentesModal:not(.hidden)');
  await h.page.waitForTimeout(150);
}
const campo = (f) => `#otrasFuentesModalBody .hon-form-grid .hon-input[data-field="${f}"]`;
const BTN = '#otrasFuentesModalBody .hon-form-grid .add-hon-btn';

await correrSpec('14_honorarios_fuentes', async (t) => {
  const emu = await asegurarEmulador();
  const fx = cargarFixture('honorarios_fuentes');

  // ============================================================ H1) alta / edición / borrado con el SDK real
  {
    const h = await boot({ fixture: 'honorarios_fuentes' });
    const { page } = h;
    await t.escenario('H1', async () => {
      // --- por concepto: Asignación Familiar / 1122 (la entidad no trae esa fuente: el mapa se crea solo con la boleta)
      const base = await emu.instantanea();
      const of0 = clon(base['1122'].data.otras_fuentes || {});
      await abrirFuente(h, 'asignacion_familiar', '1122');
      await h.clearLog();
      await page.fill(campo('concepto'), 'Reemplazo real');
      await page.selectOption(campo('tipoDocumento'), 'BOLHE');
      await page.fill(campo('nroDocumento'), 'R-1');
      await page.fill(campo('fechaDocumento'), '2026-05-05');
      await page.fill(campo('montoGasto'), '321000');
      await page.click(BTN);
      await h.flush();
      let w = await writesDe(h, '1122');
      const id = Object.keys((w[0] && w[0].payload.otras_fuentes.asignacion_familiar.honorarios) || {})[0];
      t.eq(w.length, 1, 'H1) agregar una boleta = UN write');
      t.ok(w[0] && w[0].op === 'setDoc' && w[0].options && w[0].options.merge === true && w[0].status === 'acked', 'H1) setDoc con merge:true confirmado por el servidor');
      t.eq([Object.keys(w[0].payload.otras_fuentes), Object.keys(w[0].payload.otras_fuentes.asignacion_familiar), Object.keys(w[0].payload.otras_fuentes.asignacion_familiar.honorarios).length], [['asignacion_familiar'], ['honorarios'], 1], 'H1) el payload toca solo otras_fuentes.asignacion_familiar.honorarios.<id>');
      let s = await emu.leer('1122');
      t.eq([s.data.otras_fuentes.asignacion_familiar.honorarios[id].concepto, s.data.otras_fuentes.asignacion_familiar.honorarios[id].montoGasto, s.data.otras_fuentes.asignacion_familiar.honorarios[id].tipoDocumento], ['Reemplazo real', 321000, 'BOLHE'], 'H1) servidor: la boleta con su concepto, monto y tipo (código)');
      const sinHon = clon(s.data.otras_fuentes); delete sinHon.asignacion_familiar.honorarios; if (!Object.keys(sinHon.asignacion_familiar).length) delete sinHon.asignacion_familiar;
      const ref = clon(of0); if (ref.asignacion_familiar) delete ref.asignacion_familiar.honorarios;
      t.eq(canon(sinHon), canon(ref), 'H1) servidor: el resto de otras_fuentes queda EXACTAMENTE igual');
      // edición
      await h.clearLog();
      await page.click(`#otrasFuentesModalBody button.hon-edit-btn[data-hon-id="${id}"]`);
      await page.fill(campo('montoGasto'), '400000');
      await page.click(BTN);
      await h.flush();
      w = await writesDe(h, '1122');
      t.ok(w.length === 1 && Object.keys(w[0].payload.otras_fuentes.asignacion_familiar.honorarios).join() === id && w[0].status === 'acked', 'H1) editar = un write de esa boleta');
      t.eq((await emu.leer('1122')).data.otras_fuentes.asignacion_familiar.honorarios[id].montoGasto, 400000, 'H1) servidor: monto editado');
      // otra persona agrega OTRA boleta de la misma entidad
      await emu.escribirComoOtro('1122', { otras_fuentes: { asignacion_familiar: { honorarios: { ajena: { concepto: 'De otra persona', tipoDocumento: 'BOLH', nroDocumento: '9', fechaDocumento: '2026-06-06', fechaPago: '', descripcion: 'ajena', rutProveedor: '', nombreProveedor: '', montoGasto: 1000, montoDocumento: 1000 } } } } });
      t.ok(!!(await esperar(async () => (await page.locator('#otrasFuentesModalBody tr[data-hon-id="ajena"]').count()) === 1)), 'H1) la boleta de la otra persona aparece en el modal abierto, sin recargar');
      s = await emu.leer('1122');
      t.eq(Object.keys(s.data.otras_fuentes.asignacion_familiar.honorarios).sort(), ['ajena', id].sort(), 'H1) servidor: ambas boletas conviven');
      // borrado
      await h.clearLog();
      await page.click(`#otrasFuentesModalBody button.hon-del-btn[data-hon-id="${id}"]`);
      await h.flush();
      s = await emu.leer('1122');
      t.eq(Object.keys(s.data.otras_fuentes.asignacion_familiar.honorarios), ['ajena'], 'H1) servidor: borrar quita solo esa boleta');
      await cerrarModal(h);
      // recarga
      await h.clearLog();
      await h.recargar();
      await h.esperarVerde({ timeout: 40000 });
      await abrirFuente(h, 'asignacion_familiar', '1122');
      t.eq(await page.locator('#otrasFuentesModalBody tr[data-hon-id="ajena"]').count(), 1, 'H1) tras recargar (IndexedDB real) la boleta sigue ahí');
      await cerrarModal(h);
      t.eq((await h.writes()).length, 0, 'H1) recargar no escribe nada');
      // --- con cuenta (General / 1122), AC y un jardín por concepto (Subt. 31): mismo mecanismo
      await abrirFuente(h, 'general', '1122');
      await h.clearLog();
      await page.selectOption(campo('codigo'), '410803');
      await page.selectOption(campo('tipoDocumento'), 'BOLHE');
      await page.fill(campo('fechaDocumento'), '2026-07-07');
      await page.fill(campo('montoGasto'), '1500');
      await page.click(BTN);
      await h.flush();
      const wg = await writesDe(h, '1122');
      t.ok(wg.length === 1 && wg[0].options.merge === true && wg[0].status === 'acked' && Object.keys(wg[0].payload.otras_fuentes).join() === 'general' && Object.keys(wg[0].payload.otras_fuentes.general).join() === 'honorarios', 'H1) general / 1122 (con cuenta): un setDoc merge confirmado que toca solo general.honorarios');
      await cerrarModal(h);
      for (const [fuente, ent] of [['subt31_proyectos', 'AC'], ['subt31_proyectos', '5404001']]) {
        await abrirFuente(h, fuente, ent);
        await h.clearLog();
        await page.fill(campo('concepto'), 'Nuevo en ' + ent);
        await page.selectOption(campo('tipoDocumento'), 'BOLHE');
        await page.fill(campo('fechaDocumento'), '2026-07-07');
        await page.fill(campo('montoGasto'), '1500');
        await page.click(BTN);
        await h.flush();
        const wa = await writesDe(h, ent);
        t.ok(wa.length === 1 && wa[0].options.merge === true && wa[0].status === 'acked' && Object.keys(wa[0].payload.otras_fuentes).join() === fuente && Object.keys(wa[0].payload.otras_fuentes[fuente]).join() === 'honorarios', `H1) ${fuente} / ${ent}: un setDoc merge confirmado que toca solo ${fuente}.honorarios`);
        await cerrarModal(h);
      }
      // proyección por concepto: agregar y teclear un mes
      await abrirFuente(h, 'subt31_proyectos', '1122');
      await h.clearLog();
      await page.fill('#otrasFuentesModalBody .honproy-add-input', 'Monitor real');
      await page.click('#otrasFuentesModalBody .add-honproy-btn');
      await h.flush();
      const celda = '#otrasFuentesModalBody input.celda-input[data-modo="of_hon_proy_item"][data-concepto="Monitor real"][data-mes="AGOSTO"]';
      await h.clearLog();
      await page.fill(celda, '42000');
      await page.dispatchEvent(celda, 'blur');
      await h.flush();
      const wp = await writesDe(h, '1122');
      t.ok(wp.length === 1 && wp[0].status === 'acked', 'H1) teclear un mes de la proyección = un write confirmado');
      t.eq((await emu.leer('1122')).data.otras_fuentes.subt31_proyectos.hon_proyeccion_items['Monitor real'].meses.AGOSTO, 42000, 'H1) servidor: el mes de la proyección por concepto');
      await cerrarModal(h);
      const e = await estado(page);
      t.ok(e.color === 'green', 'H1) el indicador queda verde', e);
      await t.sinErrores(h);
    });
    await h.close();
  }

  // ============================================================ H2) Recuperación LLMM: sin honorarios
  {
    await prepararServidor(emu, fx);
    const h = await boot({ prepararServidor: false });
    const { page } = h;
    await t.escenario('H2', async () => {
      const antes = await emu.instantanea();
      await abrirFuente(h, 'recuperacion_llmm', '1121');
      t.eq(await page.locator('#otrasFuentesModalBody .hon-form-grid, #otrasFuentesModalBody .hon-block').count(), 0, 'H2) el modal de Recuperación LLMM no trae formulario ni bloque de honorarios');
      await cerrarModal(h);
      t.eq((await h.writes()).length, 0, 'H2) abrirlo no escribe nada');
      const despues = await emu.instantanea();
      t.eq(canon(despues['1121'].data.otras_fuentes.recuperacion_llmm.honorarios), canon(antes['1121'].data.otras_fuentes.recuperacion_llmm.honorarios), 'H2) la boleta guardada en su documento queda intacta en el servidor');
      await t.sinErrores(h);
    });
    await h.close();
  }

  // ============================================================ H3) documentos dañados
  {
    await prepararServidor(emu, fx);
    await emu.sembrar({
      '1121': { otras_fuentes: { subt31_proyectos: { honorarios: { texto: 'no es una boleta', nulo: null, arreglo: [1], montoTexto: { concepto: 'X', tipoDocumento: 'BOLH', fechaDocumento: '2026-04-04', montoGasto: '2500' } } }, asignacion_familiar: { hon_proyeccion_items: 'texto' } } },
      'AC': { otras_fuentes: { subt31_proyectos: { honorarios: 'texto en vez de mapa' }, general: { honorarios: [1] } } },
      '5404001': { otras_fuentes: { asignacion_familiar: { honorarios: [1, 2] } } },
    }, { merge: true, conAuditoria: false });
    const h = await boot({ prepararServidor: false, waitReady: false });
    const { page } = h;
    await t.escenario('H3', async () => {
      const antes = await emu.instantanea();
      await h.esperarVerde({ timeout: 40000 });
      await page.waitForTimeout(1000);
      const e = await estado(page);
      t.ok(e.color === 'green' && /^Sincronizado/.test(e.txt), 'H3) el panel queda VERDE con honorarios dañados', e);
      await abrirFuente(h, 'subt31_proyectos', '1121');
      t.ok((await page.locator('#otrasFuentesModalBody tr[data-hon-id]').count()) >= 1, 'H3) el registro se muestra (solo las entradas que son objetos)');
      await cerrarModal(h);
      t.eq((await h.writes()).length, 0, 'H3) el panel no escribió nada');
      const despues = await emu.instantanea();
      t.eq(Object.keys(antes).filter(id => antes[id].updateTime !== despues[id].updateTime), [], 'H3) ningún documento cambió (updateTime intacto)');
      await t.sinErrores(h);
    });
    await h.close();
  }
});
