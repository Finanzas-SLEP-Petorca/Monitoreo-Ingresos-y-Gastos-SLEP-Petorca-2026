// JUNJI · saldos por línea, exceso de las líneas restringidas y Estado con el Gasto de Remuneraciones en 4 líneas. Fixture `junji_rem` + oráculo independiente (tests/lib/junji_rem.mjs).
// Reglas (decisión del usuario):
//   · saldo propio de una línea restringida (Homologación, Carrera Docente Parvularia, BDL) = su ingreso − su gasto de Remuneraciones;
//   · si gasta MÁS que su ingreso, el EXCESO se carga al saldo de Operación;
//   · Saldo de Operación para B&S = Ingreso Operación − Gasto Rem. Operación − exceso − B&S (sin documento + documentado); los honorarios NO entran (regla de la PR #67);
//   · Estado = Déficit si el saldo total < 0 O el saldo de Operación < 0 (estadoDeEntidad); la causa nombra la(s) línea(s) que se exceden (fila, tooltip, modal, «Atención», CSV y PDF).
// Debe FALLAR contra APP_HTML=@217e33a.
import { boot, clickTab, cargarFixture } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { capturarDescarga, parseCsvPuntoYComa } from '../lib/capture-utils.mjs';
import { GESPARVU_IDS, parseCLP } from '../lib/corte.mjs';
import { LINEAS, saldosJunjiDe } from '../lib/junji_rem.mjs';
import { ETIQUETA, fuenteDe, filasFuente, leerDashboard } from '../lib/estado.mjs';

const MOD = '#otrasFuentesModalBody';
const CORTO_OP = 'Saldo Operación para B&S negativo';
const CORTO_AMBAS = 'Saldo total y saldo Operación para B&S negativos';
const celda = (id, modo, mes) => `${MOD} input.celda-input[data-rbd="${id}"][data-fuente="junji"][data-modo="${modo}"][data-mes="${mes}"]`;
const sub = (page) => page.evaluate(() => document.getElementById('otrasFuentesModalSubtitle').innerText.replace(/\s+/g, ' ').trim());
const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel);
async function abrir(h, id) {
  await h.clickTab('junji');
  await h.page.click(`#otrasFuentesTbody-junji td[data-abrir-otra-fuente="${id}"]`);
  await h.waitIdle();
}
async function cerrar(h) { await h.page.keyboard.press('Escape'); await h.waitIdle(); }

await correrSpec('junji_rem_estado', async (t) => {
  const docs = cargarFixture('junji_rem').docs;
  const F = Object.fromEntries(GESPARVU_IDS.map(id => [id, fuenteDe(docs, id, 'junji')]));
  const S = (id) => saldosJunjiDe(docs[id].otras_fuentes.junji, 0); // solo se usan las líneas; el saldo de Operación completo sale de F[id].saldoOp
  const h = await boot({ fixture: 'junji_rem', user: 'authorized' });
  const { page } = h;

  // ---------------------------------------------------------------- 0) oráculo (diseño del fixture)
  t.eq(['5402002', '5402004', '5401006', '5401007', '5401005'].map(id => [F[id].estado, F[id].causas, F[id].saldoOp]), [
    ['superavit', [], 480000], ['superavit', [], 500000], ['deficit', ['saldo', 'operacion_bys'], -300000], ['deficit', ['operacion_bys'], -100000], ['deficit', ['operacion_bys'], -1000000]],
  'oráculo: 5402002 Superávit (+480.000); 5402004 con exceso de Homologación pero Operación +500.000 → Superávit; 5401006 ambas (-300.000); 5401007 solo Operación (-100.000); 5401005 (documento antiguo, Rem. en Operación) Déficit solo por Operación (saldo total +2.000.000)');
  t.eq(S('5402004').lineas.map(l => [l.corto, l.saldo, l.exceso]), [['Operación', 2000000, 0], ['Homologación', -500000, 500000], ['Carrera Docente Parvularia', 0, 0], ['BDL', 0, 0]], 'oráculo: 5402004 → Homologación con saldo propio -500.000 y exceso 500.000');
  t.eq(S('5401006').lineas.filter(l => l.exceso).map(l => [l.corto, l.exceso]), [['Carrera Docente Parvularia', 300000], ['BDL', 300000]], 'oráculo: 5401006 → exceso de Carrera Docente Parvularia y de BDL (300.000 cada una)');
  t.eq(F['5401007'].saldo > 0, true, 'oráculo: 5401007 tiene saldo total positivo (+900.000): Déficit solo por Operación');

  // ---------------------------------------------------------------- 1) tabla de JUNJI: Estado de las 13 filas y causa
  await clickTab(page, 'junji');
  const filas = await filasFuente(page, 'junji');
  t.eq(GESPARVU_IDS.filter(id => filas[id].estado !== ETIQUETA[F[id].estado]).length, 0, 'el Estado de las 13 filas = oráculo');
  t.eq([filas['5402004'].estado, filas['5402004'].causa], ['Superávit', ''], '5402004: la línea Homologación se excede (-500.000) pero Operación lo cubre: Superávit y sin aviso');
  t.eq([filas['5401007'].estado, filas['5401007'].causa, filas['5401007'].saldo], ['Déficit', CORTO_OP, '$900.000'], '5401007: Déficit SOLO por Operación (saldo total +$900.000), sin línea que se exceda');
  t.eq([filas['5401006'].estado, filas['5401006'].causa], ['Déficit', CORTO_AMBAS + ' · exceso en Carrera Docente Parvularia, BDL'], '5401006: Déficit por ambas causas y la fila nombra las líneas restringidas que se exceden');
  t.ok(/saldo de Operación para Bienes y Servicios es negativo \(-\$300\.000\)/.test(filas['5401006'].title) && /Carrera Docente Parvularia gasta \$300\.000 más que su ingreso y ese exceso se carga a Operación/.test(filas['5401006'].title) && /BDL gasta \$300\.000 más que su ingreso/.test(filas['5401006'].title),
    'tooltip de 5401006: la causa de Operación con su monto y cada línea que se excede con su exceso → ' + filas['5401006'].title);
  t.ok(/Ingreso Operación − Gasto Remuneraciones Operación − exceso de las líneas restringidas − B&S/.test(filas['5401006'].title), 'y explica la fórmula del saldo de Operación');
  t.ok(/saldo de Operación para Bienes y Servicios es negativo \(-\$100\.000\)/.test(filas['5401007'].title) && !/gasta .* más que su ingreso/.test(filas['5401007'].title), 'tooltip de 5401007: solo Operación, sin líneas excedidas');
  const conAviso = Object.entries(filas).filter(([, f]) => f.causa).map(([id]) => id).sort();
  t.eq(conAviso, GESPARVU_IDS.filter(id => F[id].causas.includes('operacion_bys')).sort(), 'el aviso visible aparece exactamente donde interviene el saldo de Operación');

  // ---------------------------------------------------------------- 2) modal: cuadro «Saldos por línea» y subtítulo
  await abrir(h, '5402004');
  const cuadro = await page.evaluate(() => Array.from(document.querySelectorAll('#ofjsaldos-5402004-junji tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
  t.eq(cuadro.map(f => [f[0], parseCLP(f[3]), f[4] === '—' ? '—' : parseCLP(f[4])]), [['Operación', 2000000, '—'], ['Homologación', -500000, 500000], ['Carrera Docente Parvularia', 0, 0], ['BDL', 0, 0]], '5402004: saldo propio de cada línea y exceso cargado a Operación (Homologación -500.000 → exceso 500.000)');
  t.ok(/rgb\(181, 47, 47\)/.test(await page.evaluate(() => getComputedStyle(document.getElementById('ofjs-1-sal-5402004-junji')).color)), 'el saldo propio negativo de Homologación va en rojo');
  t.eq(parseCLP(await txt(page, '#ofjs-op-5402004-junji')), 500000, 'Saldo de Operación para B&S = 3.000.000 − 1.000.000 − 500.000 − 1.000.000 = +500.000');
  t.eq(parseCLP(await txt(page, '[id^="ofsaldoopbys-"]')), 500000, '…y es el mismo que el del resumen de B&S');
  t.ok(/SUPERÁVIT/i.test(await sub(page)), 'subtítulo del modal: Superávit');
  // edición en vivo: bajar el gasto de Homologación a 1.000.000 (sin exceso) sube Operación a +1.000.000; subirlo a 2.500.000 (exceso 1.500.000) la deja en -500.000 → Déficit
  for (const [valor, op, exceso, estado] of [['1000000', 1000000, 0, 'SUPERÁVIT'], ['2500000', -500000, 1500000, 'DÉFICIT'], ['2000000', 0, 1000000, 'SUPERÁVIT'], ['2000001', -1, 1000001, 'DÉFICIT'], ['1500000', 500000, 500000, 'SUPERÁVIT']]) {
    await page.fill(celda('5402004', 'of_gasto_rem_homologacion', 'ENERO'), valor);
    await h.waitIdle();
    t.eq([parseCLP(await txt(page, '#ofjs-op-5402004-junji')), parseCLP(await txt(page, '#ofjs-1-exc-5402004-junji')), (new RegExp(estado, 'i').test(await sub(page)))], [op, exceso, true], `Homologación gasta ${valor}: Operación para B&S ${op}, exceso ${exceso}, ${estado}`);
    const f = (await filasFuente(page, 'junji'))['5402004'];
    // con Homologación excedida y Operación negativa el saldo total también es negativo (total − Operación = Σ max(0, ingreso − gasto) de las restringidas ≥ 0, sin honorarios)
    t.eq([f.estado, f.causa], estado === 'DÉFICIT' ? ['Déficit', CORTO_AMBAS + ' · exceso en Homologación'] : ['Superávit', ''], `…y la fila de la tabla (detrás del modal) → ${estado}${estado === 'DÉFICIT' ? ' con la causa y la línea que se excede' : ''}`);
  }
  await page.fill(celda('5402004', 'of_gasto_rem_homologacion', 'ENERO'), '1500000');
  await cerrar(h);

  // ---------------------------------------------------------------- 3) el exceso de una línea restringida NO baja el saldo de otra restringida ni se «reparte»: va entero a Operación
  const sa = saldosJunjiDe(docs['5401006'].otras_fuentes.junji, 200000);
  t.eq([sa.excesoTotal, sa.saldoOp], [600000, -300000], 'oráculo: dos excesos (300.000 + 300.000) se suman y se cargan enteros a Operación: 1.000.000 − 500.000 − 600.000 − 200.000 = -300.000');

  // ---------------------------------------------------------------- 4) «Atención»: la causa con la línea que se excede
  // «Atención» muestra solo las 8 peores; se empuja a 5401006 al primer lugar subiendo su B&S (las causas y las líneas excedidas no cambian) y luego se restituye.
  await h.remoto('5401006', `const j = d.otras_fuentes.junji; j.bys_items['Alimentación'].meses.ENERO = 9000000000; j.bys_items['Alimentación'].total = 9000000000;`);
  await h.waitIdle();
  await clickTab(page, 'Panel principal');
  const D = await leerDashboard(page);
  const i6 = D.items.find(i => i.fuente === 'junji' && i.rbd === '5401006');
  t.ok(i6 && i6.causa === CORTO_AMBAS + ' · exceso en Carrera Docente Parvularia, BDL', '«Atención» (Total): 5401006 con su causa y las líneas excedidas → ' + (i6 && i6.causa));
  const i7 = D.items.find(i => i.fuente === 'junji' && i.rbd === '5401007');
  t.ok(!i7 || i7.causa === CORTO_OP, '«Atención»: 5401007 (solo Operación) con la causa de siempre' + (i7 ? '' : ' (no entra entre las 8 más negativas)'));
  t.ok(!D.items.some(i => i.rbd === '5402004' && i.fuente === 'junji'), '5402004 (exceso cubierto por Operación, Superávit) no figura en «Atención»');
  await h.remoto('5401006', `const j = d.otras_fuentes.junji; j.bys_items['Alimentación'].meses.ENERO = 200000; j.bys_items['Alimentación'].total = 200000;`);
  await h.waitIdle();

  // ---------------------------------------------------------------- 5) CSV y PDF por entidad
  await clickTab(page, 'junji');
  const dl = await capturarDescarga(page, () => page.click('#otrasFuentesTbody-junji button.row-action-btn[data-action="csv"][data-rbd="5401006"]'));
  const csv = parseCsvPuntoYComa(dl.buffer.toString('utf8'));
  const val = (n) => { const f = csv.find(x => x[0] === n); return f && f[f.length - 1]; };
  t.eq([parseCLP(val('Saldo Operación para B&S')), parseCLP(val('Saldo propio Carrera Docente Parvularia')), parseCLP(val('Saldo propio BDL')), parseCLP(val('Saldo propio Homologación')), val('Estado (Total)')], [-300000, -300000, -300000, 0, 'Déficit'], 'CSV de 5401006: saldo de Operación, saldos propios de las líneas restringidas y Estado');
  await page.evaluate(() => { window.__prints = []; });
  await page.click('#otrasFuentesTbody-junji button.row-action-btn[data-action="pdf"][data-rbd="5401006"]');
  const pr = (await h.prints())[0];
  t.ok(pr && /DÉFICIT/i.test(pr.printWrap) && pr.printWrap.includes('exceso en Carrera Docente Parvularia, BDL') && pr.printWrap.includes('Saldos por línea'), 'PDF de 5401006: Estado Déficit con la causa y las líneas excedidas, y el cuadro de saldos por línea');

  // ---------------------------------------------------------------- 6) los honorarios NO entran en el saldo de Operación
  await h.remoto('5402004', `d.otras_fuentes.junji.hon_proyeccion_items = { 'Apoyo': { meses: { ENERO: 100000000 } } };`);
  await h.waitIdle();
  const f4 = (await filasFuente(page, 'junji'))['5402004'];
  t.eq([f4.estado, f4.causa], ['Déficit', ''], 'honorarios por $100 M en 5402004: Déficit por el saldo total (los honorarios son gasto de personal) y SIN causa de Operación: Operación para B&S sigue en +500.000');
  await abrir(h, '5402004');
  t.eq(parseCLP(await txt(page, '#ofjs-op-5402004-junji')), 500000, 'el cuadro sigue con Operación para B&S = +500.000 (los honorarios no lo tocan)');
  await cerrar(h);

  // ---------------------------------------------------------------- 7) nada derivado se guarda
  const w = await h.writes();
  t.ok(w.length === 0 || !w.some(x => /estado|causa|saldo_operacion|exceso/i.test(JSON.stringify(x.payload || {}))), 'lo derivado (Estado, causa, saldo de Operación, exceso) nunca se guarda en Firestore');
  t.noErrores(h);
  await h.close();
  void LINEAS;
});
