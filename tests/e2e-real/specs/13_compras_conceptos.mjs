// 13_compras_conceptos — registro de compras por CONCEPTO (JUNJI, FAEP, FIGA, Aportes Fiscales) contra el SDK REAL de Firestore + emulador.
//   K1) Alta / edición / borrado de un documento en una fuente por concepto = UN setDoc con merge:true confirmado que toca SOLO `otras_fuentes.<fuente>.compras.<id>` (más nombre y auditoría);
//       el resto del documento (ingreso, rem, bys_items «sin documento», otras fuentes) queda idéntico en el servidor. Otra persona edita OTRA compra de la misma entidad: ambas conviven.
//       Sobrevive a recargar (IndexedDB real) y recargar no escribe. Un jardín (GESPARVU) y AC funcionan igual.
//   K2) Documentos dañados que el servidor sí guarda (compras que no son objetos, montos de texto, `compras` de otro tipo): el panel los tolera (verde), no escribe nada y ningún documento cambia.
// Esperado: PASS en la PR; FALLA en @9002538 (no existe el registro).
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
const campo = (f) => `#otrasFuentesModalBody .compra-form-grid .of-compra-input[data-field="${f}"]`;

await correrSpec('13_compras_conceptos', async (t) => {
  const emu = await asegurarEmulador();
  const fx = cargarFixture('compras_conceptos');

  // ============================================================ K1) alta / edición / borrado con el SDK real
  {
    const h = await boot({ fixture: 'compras_conceptos' });
    const { page } = h;
    await t.escenario('K1', async () => {
      const base = await emu.instantanea();
      const of0 = clon(base['1122'].data.otras_fuentes);
      await abrirFuente(h, 'faep', '1122');
      await h.clearLog();
      await page.fill(campo('concepto'), 'Concepto de prueba real');
      await page.selectOption(campo('tipoDocumento'), 'Factura');
      await page.fill(campo('nroDocumento'), 'R-1');
      await page.fill(campo('fechaDocumento'), '2026-05-05');
      await page.fill(campo('montoGasto'), '321000');
      await page.click('#otrasFuentesModalBody .of-add-compra-btn');
      await h.flush();
      let w = await writesDe(h, '1122');
      const id = Object.keys((w[0] && w[0].payload.otras_fuentes.faep.compras) || {})[0];
      t.eq(w.length, 1, 'K1) agregar una compra = UN write');
      t.ok(w[0] && w[0].op === 'setDoc' && w[0].options && w[0].options.merge === true && w[0].status === 'acked', 'K1) setDoc con merge:true confirmado por el servidor');
      t.eq([Object.keys(w[0].payload.otras_fuentes), Object.keys(w[0].payload.otras_fuentes.faep), Object.keys(w[0].payload.otras_fuentes.faep.compras).length], [['faep'], ['compras'], 1], 'K1) el payload toca solo otras_fuentes.faep.compras.<id>');
      let s = await emu.leer('1122');
      t.eq([s.data.otras_fuentes.faep.compras[id].concepto, s.data.otras_fuentes.faep.compras[id].montoGasto], ['Concepto de prueba real', 321000], 'K1) servidor: la compra con su concepto y monto');
      const sinCompras = clon(s.data.otras_fuentes); delete sinCompras.faep.compras;
      const ref = clon(of0); if (ref.faep) delete ref.faep.compras;
      t.eq(canon(sinCompras), canon(ref), 'K1) servidor: el resto de otras_fuentes (ingreso, rem, «sin documento», otras fuentes) queda EXACTAMENTE igual');
      // edición
      await h.clearLog();
      await page.click(`#otrasFuentesModalBody button.of-compra-edit-btn[data-compra-id="${id}"]`);
      await page.fill(campo('montoGasto'), '400000');
      await page.click('#otrasFuentesModalBody .of-add-compra-btn');
      await h.flush();
      w = await writesDe(h, '1122');
      t.ok(w.length === 1 && Object.keys(w[0].payload.otras_fuentes.faep.compras).join() === id && w[0].status === 'acked', 'K1) editar = un write de esa compra');
      t.eq((await emu.leer('1122')).data.otras_fuentes.faep.compras[id].montoGasto, 400000, 'K1) servidor: monto editado');
      // otra persona agrega OTRA compra de la misma entidad
      await emu.escribirComoOtro('1122', { otras_fuentes: { faep: { compras: { ajena: { concepto: 'De otra persona', tipoDocumento: 'Boleta', nroDocumento: '9', fechaDocumento: '2026-06-06', fechaPago: '', descripcion: '', rutProveedor: '', nombreProveedor: '', montoGasto: 777, montoDocumento: 777, documentoOriginal: '' } } } } });
      t.ok(!!(await esperar(async () => (await page.locator('#otrasFuentesModalBody tr[data-compra-id="ajena"]').count()) === 1)), 'K1) la compra de la otra persona aparece en el modal abierto, sin recargar');
      s = await emu.leer('1122');
      t.eq(Object.keys(s.data.otras_fuentes.faep.compras).sort(), ['ajena', id].sort(), 'K1) servidor: ambas compras conviven');
      // borrado
      await h.clearLog();
      page.once('dialog', d => d.accept());
      await page.click(`#otrasFuentesModalBody button.of-compra-del-btn[data-compra-id="${id}"]`);
      await h.flush();
      s = await emu.leer('1122');
      t.eq(Object.keys(s.data.otras_fuentes.faep.compras), ['ajena'], 'K1) servidor: borrar quita solo esa compra');
      await cerrarModal(h);
      // recarga
      await h.clearLog();
      await h.recargar();
      await h.esperarVerde({ timeout: 40000 });
      await abrirFuente(h, 'faep', '1122');
      t.eq(await page.locator('#otrasFuentesModalBody tr[data-compra-id="ajena"]').count(), 1, 'K1) tras recargar (IndexedDB real) la compra sigue ahí');
      await cerrarModal(h);
      t.eq((await h.writes()).length, 0, 'K1) recargar no escribe nada');
      // AC y jardín: mismo mecanismo
      for (const [fuente, ent] of [['faep', 'AC'], ['figa', '5404001']]) {
        await abrirFuente(h, fuente, ent);
        await h.clearLog();
        await page.fill(campo('concepto'), 'Nuevo en ' + ent);
        await page.fill(campo('fechaDocumento'), '2026-07-07');
        await page.fill(campo('montoGasto'), '1500');
        await page.click('#otrasFuentesModalBody .of-add-compra-btn');
        await h.flush();
        const wa = await writesDe(h, ent);
        t.ok(wa.length === 1 && wa[0].options.merge === true && wa[0].status === 'acked' && Object.keys(wa[0].payload.otras_fuentes).join() === fuente, `K1) ${fuente} / ${ent}: un setDoc merge confirmado que toca solo otras_fuentes.${fuente}`);
        await cerrarModal(h);
      }
      const e = await estado(page);
      t.ok(e.color === 'green', 'K1) el indicador queda verde', e);
      await t.sinErrores(h);
    });
    await h.close();
  }

  // ============================================================ K2) documentos dañados
  {
    await prepararServidor(emu, fx);
    await emu.sembrar({
      '1121': { otras_fuentes: { faep: { compras: { texto: 'no es una compra', nulo: null, arreglo: [1], montoTexto: { concepto: 'X', fechaDocumento: '2026-04-04', montoGasto: '2500' } } } } },
      'AC': { otras_fuentes: { faep: { compras: 'texto en vez de mapa' } } },
      '5404001': { otras_fuentes: { figa: { compras: [1, 2] } } },
    }, { merge: true, conAuditoria: false });
    const h = await boot({ prepararServidor: false, waitReady: false });
    const { page } = h;
    await t.escenario('K2', async () => {
      const antes = await emu.instantanea();
      await h.esperarVerde({ timeout: 40000 });
      await page.waitForTimeout(1000);
      const e = await estado(page);
      t.ok(e.color === 'green' && /^Sincronizado/.test(e.txt), 'K2) el panel queda VERDE con compras dañadas', e);
      await abrirFuente(h, 'faep', '1121');
      t.ok((await page.locator('#otrasFuentesModalBody tr[data-compra-id]').count()) >= 1, 'K2) el registro se muestra (solo las entradas que son objetos)');
      await cerrarModal(h);
      t.eq((await h.writes()).length, 0, 'K2) el panel no escribió nada');
      const despues = await emu.instantanea();
      t.eq(Object.keys(antes).filter(id => antes[id].updateTime !== despues[id].updateTime), [], 'K2) ningún documento cambió (updateTime intacto)');
      t.eq(h.errors.filter(x => x.kind === 'pageerror'), [], 'K2) sin errores de página');
      await t.sinErrores(h);
    });
    await h.close();
  }
});
