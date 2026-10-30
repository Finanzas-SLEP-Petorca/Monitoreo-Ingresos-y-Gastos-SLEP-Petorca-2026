// 16_junji_rem_lineas — JUNJI: el Gasto de Remuneraciones en 4 líneas (`gasto_rem_operacion`, `gasto_rem_homologacion`, `gasto_rem_carrera_docente`, `gasto_rem_bdl`) contra el SDK REAL de Firestore + emulador.
//
//   R1) Documento ANTIGUO (default.json: solo `otras_fuentes.junji.gasto_rem`): abrir el panel y el modal no escribe nada y la fila única se ve como «Gasto Remuneraciones Operación». Escribir UNA línea
//       (Homologación) es un setDoc con merge:true confirmado que toca SOLO `otras_fuentes.junji.gasto_rem_homologacion…`: el campo antiguo `gasto_rem`, las demás líneas, el resto del documento y los
//       demás documentos quedan idénticos (updateTime). Editar Operación escribe `gasto_rem_operacion` (nunca el campo antiguo) y tras recargar (IndexedDB real) Operación sale mes a mes: el mes escrito
//       del campo nuevo y los demás del antiguo, sin doblar el gasto.
//   R2) Convivencia con un cliente VIEJO (que sigue escribiendo `gasto_rem`): un mes que el campo nuevo no tiene aparece en Operación; uno que sí tiene NO se pisa ni se dobla.
//   R3) Documentos con líneas DAÑADAS que el servidor sí guarda (texto, nulo, arreglo, `meses` de texto, meses con basura): el panel los tolera (verde, 13 jardines, lo numérico se conserva, un valor inválido
//       de `gasto_rem_operacion` cae al mes del campo antiguo), no escribe nada y ningún documento cambia (updateTime).
// Esperado: PASS en la PR; FALLA en @217e33a (JUNJI con una sola fila «Gasto Remuneraciones»).
import { boot, prepararServidor, cargarFixture, estado, clickTab, cerrarModal } from '../lib/harness.mjs';
import { asegurarEmulador } from '../lib/emulator.mjs';
import { correrSpec } from '../lib/spec.mjs';

const esperar = async (cond, timeout = 20000, paso = 100) => { const t0 = Date.now(); for (;;) { const r = await cond(); if (r) return r; if (Date.now() - t0 > timeout) return null; await new Promise(r => setTimeout(r, paso)); } };
const clon = (o) => JSON.parse(JSON.stringify(o));
const canon = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(x => [x, v[x]])) : v));
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const writesDe = async (h, id) => (await h.writes()).filter(w => w.path === `sep_carga_rbd/${id}`);
const filasIds = (page, key) => page.evaluate((k) => Array.from(document.querySelectorAll(`#otrasFuentesTbody-${k} tr[data-rbd]`)).map(tr => tr.dataset.rbd), key);
async function abrirJunji(h, id) {
  await clickTab(h.page, 'of-junji');
  await h.page.click(`#otrasFuentesTbody-junji td[data-abrir-otra-fuente="${id}"]`);
  await h.page.waitForSelector('#otrasFuentesModal:not(.hidden)');
  await h.page.waitForTimeout(150);
}
const celda = (id, modo, mes) => `#otrasFuentesModalBody input.celda-input[data-rbd="${id}"][data-fuente="junji"][data-modo="${modo}"][data-mes="${mes}"]`;
const totalLinea = (page, id, campo) => page.evaluate(([i, c]) => document.getElementById(`oftotal-${i}-junji-of_${c}`).textContent.trim(), [id, campo]);
const clp = (n) => '$' + Number(n).toLocaleString('es-CL');
const suma = (m) => MESES.reduce((s, k) => s + (Number(m && m[k]) || 0), 0);

await correrSpec('16_junji_rem_lineas', async (t) => {
  const emu = await asegurarEmulador();
  const fx = cargarFixture('default');
  const legacy = clon(fx['5402002'].otras_fuentes.junji.gasto_rem);
  t.ok(suma(legacy.meses) > 0 && !('gasto_rem_operacion' in fx['5402002'].otras_fuentes.junji), 'el documento 5402002 del fixture es antiguo: solo `gasto_rem` (con montos)');

  // ============================================================ R1 + R2) documento antiguo, escritura de una línea con merge, y cliente viejo
  {
    const h = await boot({ fixture: 'default' });
    const { page } = h;
    await t.escenario('R1', async () => {
      const base = await emu.instantanea();
      const j0 = clon(base['5402002'].data.otras_fuentes.junji);
      await clickTab(page, 'of-junji');
      t.eq((await filasIds(page, 'junji')).length, 13, 'R1) JUNJI lista 13 jardines');
      t.eq((await h.writes()).length, 0, 'R1) abrir el panel con documentos antiguos no escribe nada');
      await abrirJunji(h, '5402002');
      t.eq(await totalLinea(page, '5402002', 'gasto_rem_operacion'), clp(suma(legacy.meses)), 'R1) la fila única antigua se ve como «Gasto Remuneraciones Operación» (' + clp(suma(legacy.meses)) + ')');
      t.eq(await Promise.all(['homologacion', 'carrera_docente', 'bdl'].map(k => totalLinea(page, '5402002', 'gasto_rem_' + k))), ['$0', '$0', '$0'], 'R1) …y las otras 3 líneas parten en $0');
      t.eq((await h.writes()).length, 0, 'R1) abrir el modal tampoco escribe');

      // ---- escribir UNA línea: Homologación
      await h.clearLog();
      await page.fill(celda('5402002', 'of_gasto_rem_homologacion', 'MARZO'), '123456');
      await h.flush();
      const w = await writesDe(h, '5402002');
      t.eq(w.length, 1, 'R1) editar una celda de Homologación = UN write');
      t.ok(w[0] && w[0].op === 'setDoc' && w[0].options && w[0].options.merge === true && w[0].status === 'acked', 'R1) setDoc con merge:true confirmado por el servidor', w[0] && { op: w[0].op, options: w[0].options, status: w[0].status });
      t.eq(w[0] && w[0].payload.otras_fuentes, { junji: { gasto_rem_homologacion: { meses: { MARZO: 123456 }, total: 123456 } } }, 'R1) el payload es SOLO otras_fuentes.junji.gasto_rem_homologacion del mes editado');
      t.eq(w[0] && Object.keys(w[0].payload).sort(), ['lastModifiedAt', 'lastModifiedBy', 'nombre', 'otras_fuentes'], 'R1) y lleva solo el nombre y la auditoría además');
      const s1 = await emu.leer('5402002');
      t.eq(canon(s1.data.otras_fuentes.junji.gasto_rem), canon(j0.gasto_rem), 'R1) servidor: el campo antiguo `gasto_rem` queda EXACTAMENTE igual');
      const sinHom = clon(s1.data.otras_fuentes.junji); delete sinHom.gasto_rem_homologacion;
      t.eq(canon(sinHom), canon(j0), 'R1) servidor: el resto de JUNJI (ingresos, B&S, corte, gasto_rem) idéntico; solo apareció gasto_rem_homologacion');
      t.eq(s1.data.otras_fuentes.junji.gasto_rem_homologacion.meses.MARZO, 123456, 'R1) servidor: Homologación MARZO = 123456');
      t.eq(canon(s1.data.otras_fuentes.aporte_junji), canon(base['5402002'].data.otras_fuentes.aporte_junji), 'R1) servidor: Aporte JUNJI intacto');
      const d1 = await emu.instantanea();
      t.eq(Object.keys(d1).filter(k => k !== '5402002' && d1[k].updateTime !== base[k].updateTime), [], 'R1) ningún otro documento recibió una escritura');
      t.eq(await totalLinea(page, '5402002', 'gasto_rem_homologacion'), clp(123456), 'R1) la pantalla: total de Homologación');

      // ---- escribir Operación: va al campo nuevo, nunca al antiguo
      await h.clearLog();
      await page.fill(celda('5402002', 'of_gasto_rem_operacion', 'ABRIL'), '4444');
      await h.flush();
      const w2 = await writesDe(h, '5402002');
      t.eq(w2.length, 1, 'R1) editar Operación = UN write');
      t.eq(w2[0] && Object.keys(w2[0].payload.otras_fuentes.junji), ['gasto_rem_operacion'], 'R1) escribe `gasto_rem_operacion` (el campo antiguo `gasto_rem` ya no se escribe)');
      t.eq(w2[0] && w2[0].payload.otras_fuentes.junji.gasto_rem_operacion.meses, { ABRIL: 4444 }, 'R1) …solo el mes editado');
      const s2 = await emu.leer('5402002');
      t.eq(canon(s2.data.otras_fuentes.junji.gasto_rem), canon(j0.gasto_rem), 'R1) servidor: `gasto_rem` sigue igual tras editar Operación');
      await cerrarModal(h);

      // ---- recarga (IndexedDB real): Operación mes a mes = ABRIL del campo nuevo, el resto del antiguo (sin doblar)
      await h.clearLog();
      await h.recargar();
      await h.esperarVerde({ timeout: 40000 });
      await abrirJunji(h, '5402002');
      const esperadoOp = { ...legacy.meses, ABRIL: 4444 };
      t.eq(await totalLinea(page, '5402002', 'gasto_rem_operacion'), clp(suma(esperadoOp)), 'R1) tras recargar: Operación = campo nuevo en abril + campo antiguo en los demás meses (' + clp(suma(esperadoOp)) + '), sin doblar');
      t.eq(await totalLinea(page, '5402002', 'gasto_rem_homologacion'), clp(123456), 'R1) tras recargar: Homologación conserva su valor');
      await cerrarModal(h);
      t.eq((await h.writes()).length, 0, 'R1) y recargar no escribe nada');
      const e = await estado(page);
      t.ok(e.color === 'green' && /^Sincronizado/.test(e.txt), 'R1) el indicador queda verde', e);
      await t.sinErrores(h);
    });
    await t.escenario('R2', async () => {
      // un cliente viejo escribe `gasto_rem` en MAYO (mes que el campo nuevo NO tiene) y en ABRIL (que sí tiene)
      await abrirJunji(h, '5402002');
      await emu.escribirComoOtro('5402002', { otras_fuentes: { junji: { gasto_rem: { meses: { MAYO: 777, ABRIL: 999999 } } } } });
      t.ok(!!(await esperar(async () => (await page.inputValue(celda('5402002', 'of_gasto_rem_operacion', 'MAYO'))) === '777')), 'R2) cliente viejo: el mes que solo está en `gasto_rem` (mayo) aparece en Operación con el modal abierto');
      t.eq(await page.inputValue(celda('5402002', 'of_gasto_rem_operacion', 'ABRIL')), '4444', 'R2) …y abril (ya en `gasto_rem_operacion`) NO se pisa');
      const esperadoOp = { ...legacy.meses, ABRIL: 4444, MAYO: 777 };
      t.eq(await totalLinea(page, '5402002', 'gasto_rem_operacion'), clp(suma(esperadoOp)), 'R2) total de Operación = ' + clp(suma(esperadoOp)) + ' (nunca se suman los dos campos)');
      const s = await emu.leer('5402002');
      t.eq([s.data.otras_fuentes.junji.gasto_rem_operacion.meses.ABRIL, s.data.otras_fuentes.junji.gasto_rem.meses.ABRIL, s.data.otras_fuentes.junji.gasto_rem_homologacion.meses.MARZO], [4444, 999999, 123456], 'R2) servidor: conviven los dos campos y la línea de Homologación sigue');
      await cerrarModal(h);
      await t.sinErrores(h);
    });
    await h.close();
  }

  // ============================================================ R3) líneas DAÑADAS en el servidor
  {
    await prepararServidor(emu, fx);
    await emu.sembrar({
      '5402002': { otras_fuentes: { junji: { gasto_rem_homologacion: 'texto' } } },
      '5402004': { otras_fuentes: { junji: { gasto_rem_bdl: null } } },
      '5401006': { otras_fuentes: { junji: { gasto_rem_carrera_docente: { meses: { ENERO: 'abc', FEBRERO: null, MARZO: '1000', ABRIL: 5, MAYO: true }, total: 'basura' } } } },
      '5401007': { otras_fuentes: { junji: { gasto_rem_operacion: { meses: 'x', total: 'y' } } } },
      '5403001': { otras_fuentes: { junji: { gasto_rem_operacion: { meses: { ENERO: 'x', FEBRERO: null, MARZO: [1] }, total: 5 }, gasto_rem: { meses: { ENERO: 70000, FEBRERO: 80000 }, total: 150000 } } } },
      '5403002': { otras_fuentes: { junji: { gasto_rem_homologacion: [1, 2, 3] } } },
    }, { merge: true, conAuditoria: false });
    const h = await boot({ prepararServidor: false, waitReady: false });
    const { page } = h;
    await t.escenario('R3', async () => {
      const antes = await emu.instantanea();
      await h.esperarVerde({ timeout: 40000 });
      await page.waitForTimeout(1000);
      const e = await estado(page);
      t.ok(e.color === 'green' && /^Sincronizado/.test(e.txt), 'R3) el panel queda VERDE: son datos tolerados, no documentos ilegibles', e);
      await clickTab(page, 'of-junji');
      t.eq((await filasIds(page, 'junji')).length, 13, 'R3) JUNJI lista los 13 jardines');
      await abrirJunji(h, '5402002');
      t.eq(await totalLinea(page, '5402002', 'gasto_rem_homologacion'), '$0', 'R3) 5402002 (gasto_rem_homologacion = "texto"): la línea queda en $0');
      await cerrarModal(h);
      await abrirJunji(h, '5401006');
      t.eq([await page.inputValue(celda('5401006', 'of_gasto_rem_carrera_docente', 'MARZO')), await page.inputValue(celda('5401006', 'of_gasto_rem_carrera_docente', 'ABRIL')), await page.inputValue(celda('5401006', 'of_gasto_rem_carrera_docente', 'ENERO'))], ['1000', '5', ''], 'R3) 5401006 (meses con basura): se conserva lo numérico (marzo «1000», abril 5) y lo demás queda vacío');
      t.eq(await totalLinea(page, '5401006', 'gasto_rem_carrera_docente'), '$1.005', 'R3) …y el total se recalcula desde los meses ($1.005), no del campo `total`');
      await cerrarModal(h);
      await abrirJunji(h, '5403001');
      t.eq([await page.inputValue(celda('5403001', 'of_gasto_rem_operacion', 'ENERO')), await page.inputValue(celda('5403001', 'of_gasto_rem_operacion', 'FEBRERO'))], ['70000', '80000'], 'R3) 5403001: un valor inválido de `gasto_rem_operacion` cae al mes del campo antiguo (70000 y 80000)');
      await cerrarModal(h);
      t.eq((await h.writes()).length, 0, 'R3) el panel no escribió nada (no «arregla» solo los documentos dañados)');
      const despues = await emu.instantanea();
      t.eq(Object.keys(antes).filter(id => antes[id].updateTime !== despues[id].updateTime), [], 'R3) ningún documento del servidor cambió (updateTime intacto)');
      t.eq(h.errors.filter(x => x.kind === 'pageerror'), [], 'R3) sin errores de página (pageerror)');
      await t.sinErrores(h);
    });
    await h.close();
  }
});
