// JUNJI · el Gasto de Remuneraciones en 4 líneas (Operación, Homologación, Carrera Docente Parvularia, BDL), como los Ingresos. Fixture `junji_rem` (ver generate.mjs) contra un cálculo INDEPENDIENTE
// (tests/lib/junji_rem.mjs: lee los documentos de Firestore, no pasa por el código del panel).
// INVARIANTE: el `gasto_rem` de una entidad = la suma de sus 4 líneas (Real/Proy por el corte «Real hasta» de la entidad) y los MISMOS números salen en la pestaña (tarjetas y filas),
// Panel principal, % Ejecución, Visualizador, Reporte personalizado, CSV / PDF por fila y respaldo JSON, en Total / Real / Proyectado.
// También: modal (8 tablas, nombres accesibles únicos, saldos por línea en vivo), guardado con merge de SOLO la línea editada (nunca el campo antiguo `gasto_rem`), lectura de documentos antiguos
// (la fila única `gasto_rem` = Operación, mes a mes, sin escribir ni doblar) y dañados, convivencia con un cliente viejo, y que el reconciliador del modal no pierda foco ni lo tecleado.
// Debe FALLAR contra APP_HTML=@217e33a (JUNJI con una sola fila «Gasto Remuneraciones»).
import { boot, clickTab, cargarFixture } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { capturarDescarga, parseCsvPuntoYComa } from '../lib/capture-utils.mjs';
import { MESES, GESPARVU_IDS, corteFuente, parseCLP, kpis, clon } from '../lib/corte.mjs';
import { LINEAS, remLineasDe, remEfectivoDe, saldosJunjiDe, sumaMeses } from '../lib/junji_rem.mjs';
import { filasFuente } from '../lib/estado.mjs';

const RUTA = (id) => `sep_carga_rbd/${id}`;
const MOD = '#otrasFuentesModalBody';
const NOMBRE_LINEAS = LINEAS.map(l => l.titulo);
const r = Math.round;
const corte = (docs, id) => corteFuente(docs, id, 'junji');
const ofJ = (docs, id) => (docs[id] && docs[id].otras_fuentes && docs[id].otras_fuentes.junji) || {};
const parte = (l, c) => { let real = 0, proy = 0; MESES.forEach((m, i) => { const v = Number(l && l.meses && l.meses[m]) || 0; if (i + 1 <= c) real += v; else proy += v; }); return { real, proy }; };

// Esperado de una entidad: rem por línea (Real/Proy/Total) y la suma, ingreso y B&S (sin documento) por el corte.
function esperado(docs, id) {
  const of = ofJ(docs, id), c = corte(docs, id), rem = remLineasDe(of);
  const lineas = {};
  LINEAS.forEach(l => { const p = parte(rem[l.key], c); lineas[l.key] = { real: r(p.real), proy: r(p.proy), total: r(p.real) + r(p.proy) }; });
  const sum = (k) => LINEAS.reduce((s, l) => s + lineas[l.key][k], 0);
  const ing = ['ingreso_operacion', 'ingreso_homologacion', 'ingreso_carrera_docente', 'ingreso_bdl'].reduce((a, k) => { const p = parte(of[k], c); return { real: a.real + p.real, proy: a.proy + p.proy }; }, { real: 0, proy: 0 });
  const bys = Object.values(of.bys_items || {}).reduce((a, it) => { const p = parte(it, c); return { real: a.real + p.real, proy: a.proy + p.proy }; }, { real: 0, proy: 0 });
  const mk = (k) => { const ingreso = r(ing[k]), rm = sum(k), by = r(bys[k]); return { ingreso, rem: rm, bys: by, gasto: rm + by, saldo: ingreso - rm - by }; };
  const real = mk('real'), proy = mk('proy');
  const total = { ingreso: real.ingreso + proy.ingreso, rem: real.rem + proy.rem, bys: real.bys + proy.bys, gasto: real.gasto + proy.gasto, saldo: real.saldo + proy.saldo };
  return { lineas, real, proy, total, corte: c, saldos: saldosJunjiDe(of, total.bys) };
}
const cifras = (b) => [b.ingreso, b.rem, b.bys, b.gasto, b.saldo];
const leerTabla = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesTbody-junji tr[data-rbd]')).map(tr => ({ rbd: tr.dataset.rbd, cifras: [3, 4, 6, 7, 8].map(i => tr.children[i].textContent.trim()) })));
const celda = (id, modo, mes) => `${MOD} input.celda-input[data-rbd="${id}"][data-fuente="junji"][data-modo="${modo}"][data-mes="${mes}"]`;
async function abrir(h, id) {
  await h.clickTab('junji');
  await h.page.click(`#otrasFuentesTbody-junji td[data-abrir-otra-fuente="${id}"]`);
  await h.waitIdle();
}
async function cerrar(h) { await h.page.keyboard.press('Escape'); await h.waitIdle(); }
const txt = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); return e ? e.textContent.trim() : null; }, sel);

await correrSpec('junji_rem_lineas', async (t) => {
  const docs = cargarFixture('junji_rem').docs;
  const E = Object.fromEntries(GESPARVU_IDS.map(id => [id, esperado(docs, id)]));
  const h = await boot({ fixture: 'junji_rem', user: 'authorized' });
  const { page } = h;

  // ---------------------------------------------------------------- 0) oráculo y diseño del fixture
  t.eq(E['5402002'].lineas.operacion, { real: 2800000, proy: 2000000, total: 4800000 }, 'oráculo: Rem. Operación de 5402002 = 400.000 × 12 (7 meses Real, 5 Proyectados)');
  t.eq([E['5402002'].total.rem, E['5402002'].saldos.saldoOp], [r(12 * (400000 + 250000 + 150000 + 50000)), 12 * (500000 - 400000 - 60000)], 'oráculo: Rem. total = suma de las 4 líneas; Operación para B&S = +480.000');
  t.eq(E['5401003'].lineas.operacion.total, 100000 + 50000 + 300000, 'oráculo: 5401003 mezcla `gasto_rem` y `gasto_rem_operacion` mes a mes → Operación 450.000 (el mes de febrero manda el campo nuevo; no se suman)');
  t.eq(E['5401005'].lineas.operacion.total, 2000000, 'oráculo: 5401005 (documento antiguo) → la fila única es Operación');
  t.eq(GESPARVU_IDS.filter(id => JSON.stringify(Object.keys(ofJ(docs, id))) === '[]').length, 0, 'todos los jardines tienen JUNJI en el fixture');

  // ---------------------------------------------------------------- 1) pestaña: filas y tarjetas = oráculo, en las 3 vistas (el «gasto_rem» de la entidad es la suma de las 4 líneas)
  await clickTab(page, 'junji');
  for (const v of ['total', 'real', 'proy']) {
    await page.click(`#tab-of-junji .of-chip[data-of-vista="${v}"]`);
    await h.waitIdle();
    const filas = await leerTabla(page);
    t.eq(filas.filter(f => JSON.stringify(f.cifras.map(parseCLP)) !== JSON.stringify(cifras(E[f.rbd][v]))).map(f => f.rbd), [], `JUNJI · ${v}: Ingreso, Rem., B&S, Gasto y Saldo de las 13 filas = oráculo (Rem. = suma de las 4 líneas)`);
    const suf = { total: 'Total', real: 'Real', proy: 'Proyectado' }[v];
    const k = await kpis(page, `#ofKpiRow-${v}-junji`);
    const esp = GESPARVU_IDS.reduce((a, id) => { cifras(E[id][v]).forEach((x, i) => { a[i] += x; }); return a; }, [0, 0, 0, 0, 0]);
    t.eq([k[`Ingreso (${suf})`], k[`Gasto Remuneraciones (${suf})`], k[`Gasto Bienes y Servicios (${suf})`], k[`Gasto Total (${suf})`], k[`Saldo (${suf})`]].map(parseCLP), esp, `JUNJI · ${v}: tarjetas = suma de las 13 entidades`);
  }
  await page.click('#tab-of-junji .of-chip[data-of-vista="total"]');
  t.eq(await page.evaluate(() => /cuatro líneas, una por cada ingreso \(Operación, Homologación, Carrera Docente Parvularia y BDL\)/.test(document.querySelectorAll('#tab-of-junji .detalle-empty')[0].textContent)), true, 'el texto de ayuda de la pestaña JUNJI explica las 4 líneas de gasto de Remuneraciones');

  // ---------------------------------------------------------------- 2) modal de 5402002: 8 tablas, nombres accesibles, totales, saldos por línea
  await abrir(h, '5402002');
  const tablas = await page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody table.detalle-table thead th:first-child')).map(x => x.textContent.trim()));
  t.eq(tablas.slice(0, 8), ['Ingreso Operación', 'Ingreso Homologación', 'Ingreso Carrera Docente Parvularia', 'Ingreso Bono Desempeño Laboral (BDL)', ...NOMBRE_LINEAS], 'modal: 4 tablas de ingreso (la tercera renombrada «Carrera Docente Parvularia») y 4 de Gasto Remuneraciones, en ese orden');
  t.ok(!tablas.includes('Gasto Remuneraciones') && !tablas.includes('Ingreso Carrera Docente'), 'ya no existe la fila única «Gasto Remuneraciones» ni el rótulo «Ingreso Carrera Docente» en JUNJI');
  const E1 = E['5402002'];
  for (const l of LINEAS) {
    t.eq(await page.getAttribute(celda('5402002', 'of_' + l.campo, 'MARZO'), 'aria-label'), `${l.titulo}, marzo, GESPARVU 5402002`, `nombre accesible de la celda ${l.titulo}`);
    t.eq(await txt(page, `#oftotal-5402002-junji-of_${l.campo}`), '$' + E1.lineas[l.key].total.toLocaleString('es-CL'), `total de ${l.titulo}`);
  }
  const nombres = await page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody input.celda-input')).map(i => i.getAttribute('aria-label')));
  t.eq(nombres.length - new Set(nombres).size, 0, `los ${nombres.length} nombres accesibles de las celdas del modal son únicos`);
  const sa = E1.saldos;
  const filasSaldos = await page.evaluate(() => Array.from(document.querySelectorAll('#ofjsaldos-5402002-junji tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
  t.eq(filasSaldos.map(f => f[0]), ['Operación', 'Homologación', 'Carrera Docente Parvularia', 'BDL'], 'cuadro «Saldos por línea»: una fila por línea');
  t.eq(filasSaldos.map(f => [parseCLP(f[1]), parseCLP(f[2]), parseCLP(f[3])]), sa.lineas.map(l => [l.ingreso, l.gasto, l.saldo]), 'ingreso, gasto y saldo propio de cada línea = oráculo (Homologación 50.000 × 12 = 600.000, etc.)');
  t.eq(parseCLP(await txt(page, '#ofjs-op-5402002-junji')), sa.saldoOp, 'Saldo de Operación para B&S del cuadro = oráculo (+480.000)');
  t.eq(parseCLP(await txt(page, '[id^="ofsaldoopbys-"]')), sa.saldoOp, 'y es el mismo que el «Saldo Operación disponible para B&S» del resumen de B&S');
  // Real / Proyectado por el corte de la entidad (julio) en las 4 tablas de gasto
  const hdr = await page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody table.detalle-table')).slice(4, 8).map(tb => Array.from(tb.querySelectorAll('thead th.num')).slice(0, 12).map(th => (th.classList.contains('mes-real') ? 'R' : 'P')).join('')));
  t.eq(hdr, ['RRRRRRRPPPPP', 'RRRRRRRPPPPP', 'RRRRRRRPPPPP', 'RRRRRRRPPPPP'], 'las 4 tablas de gasto marcan 7 meses Real y 5 Proyectados (Real hasta julio)');
  await cerrar(h);

  // ---------------------------------------------------------------- 3) guardado: SOLO la línea editada, con merge, nunca el campo antiguo
  await abrir(h, '5402002');
  await h.clearWrites();
  await page.fill(celda('5402002', 'of_gasto_rem_homologacion', 'MARZO'), '300000');
  await h.flushWrites();
  let w = (await h.writes()).filter(x => x.path === RUTA('5402002'));
  const u = w[w.length - 1];
  t.ok(u && u.options.merge === true, 'el guardado es con merge:true');
  t.eq(u && u.payload.otras_fuentes, { junji: { gasto_rem_homologacion: { meses: { MARZO: 300000 }, total: 3050000 } } }, '…y SOLO otras_fuentes.junji.gasto_rem_homologacion del mes editado (ni `gasto_rem`, ni otras líneas ni fuentes)');
  t.ok(w.every(x => !/estado|causa|saldo_operacion|\brp\b/i.test(JSON.stringify(x.payload))), 'lo derivado nunca se guarda');
  const stj = (await h.store())[RUTA('5402002')].otras_fuentes.junji;
  t.eq([stj.gasto_rem_homologacion.meses.MARZO, stj.gasto_rem_homologacion.meses.ABRIL, stj.gasto_rem_operacion.meses.MARZO, stj.gasto_rem_bdl.meses.MARZO], [300000, 250000, 400000, 50000], 'en el servidor las otras líneas y los otros meses siguen intactos (deep-merge)');
  // en vivo: saldo propio y de Operación (Homologación pasa a gastar 600.000 más que... 300.000 en marzo)
  const eHom = remLineasDe(stj).homologacion;
  const gastoHom = r(sumaMeses(eHom));
  t.eq(parseCLP(await txt(page, '#ofjs-1-gas-5402002-junji')), gastoHom, 'el cuadro de saldos se actualiza al teclear (gasto de Homologación)');
  t.eq(parseCLP(await txt(page, '#ofjs-1-sal-5402002-junji')), 3600000 - gastoHom, '…y su saldo propio (ingreso 3.600.000 − gasto)');
  // Operación también escribe su propia línea
  await h.clearWrites();
  await page.fill(celda('5402002', 'of_gasto_rem_operacion', 'AGOSTO'), '1');
  await h.flushWrites();
  w = (await h.writes()).filter(x => x.path === RUTA('5402002'));
  t.eq(Object.keys(w[w.length - 1].payload.otras_fuentes.junji), ['gasto_rem_operacion'], 'editar Operación escribe `gasto_rem_operacion` (el campo antiguo `gasto_rem` ya no se escribe)');
  await page.fill(celda('5402002', 'of_gasto_rem_operacion', 'AGOSTO'), '400000');
  await page.fill(celda('5402002', 'of_gasto_rem_homologacion', 'MARZO'), '250000');
  await h.flushWrites();
  await cerrar(h);

  // ---------------------------------------------------------------- 4) documentos ANTIGUOS: la fila única es Operación (mes a mes), sin escribir ni doblar
  t.eq((await h.writes()).filter(x => x.path === RUTA('5401005')).length, 0, 'leer el documento antiguo 5401005 no escribió nada');
  await abrir(h, '5401005');
  t.eq(await txt(page, '#oftotal-5401005-junji-of_gasto_rem_operacion'), '$2.000.000', 'documento antiguo (solo `gasto_rem`): la fila única aparece como Gasto Remuneraciones Operación ($2.000.000)');
  t.eq(await page.evaluate(() => ['homologacion', 'carrera_docente', 'bdl'].map(k => document.getElementById('oftotal-5401005-junji-of_gasto_rem_' + k).textContent.trim())), ['$0', '$0', '$0'], '…y las otras 3 líneas parten en $0');
  t.eq((await leerTabla(page === null ? null : page)).length, 13, 'la tabla sigue con 13 jardines');
  await cerrar(h);
  // mezcla 5401003: ENE 100.000 (solo antiguo) · FEB 50.000 (manda el campo nuevo, no 200.000) · MAR 300.000 (solo antiguo)
  await abrir(h, '5401003');
  t.eq(await page.evaluate(() => ['ENERO', 'FEBRERO', 'MARZO'].map(m => document.querySelector(`#otrasFuentesModalBody input[data-rbd="5401003"][data-modo="of_gasto_rem_operacion"][data-mes="${m}"]`).value)), ['100000', '50000', '300000'], 'mezcla (5401003): Operación toma cada mes del campo nuevo si existe y, si no, del antiguo: 100000 · 50000 · 300000 (nunca se suman)');
  t.eq(await txt(page, '#oftotal-5401003-junji-of_gasto_rem_operacion'), '$450.000', '…total $450.000 (no $650.000)');
  // un cliente VIEJO sigue escribiendo `gasto_rem`: un mes que el campo nuevo no tiene se ve; uno que sí tiene, no lo pisa
  await h.remoto('5401003', 'd.otras_fuentes.junji.gasto_rem.meses.ABRIL = 70000; d.otras_fuentes.junji.gasto_rem.meses.FEBRERO = 999000;');
  await h.waitIdle();
  t.eq(await page.evaluate(() => ['FEBRERO', 'ABRIL'].map(m => document.querySelector(`#otrasFuentesModalBody input[data-rbd="5401003"][data-modo="of_gasto_rem_operacion"][data-mes="${m}"]`).value)), ['50000', '70000'], 'cliente viejo: abril (que solo está en `gasto_rem`) aparece; febrero (ya en el campo nuevo) NO se pisa ni se dobla');
  t.eq(await txt(page, '#oftotal-5401003-junji-of_gasto_rem_operacion'), '$520.000', '…total $520.000');
  // editar Operación escribe el campo nuevo; poner 0 en un mes que el campo antiguo tenía NO lo hace «resucitar»
  await h.clearWrites();
  await page.fill(celda('5401003', 'of_gasto_rem_operacion', 'MARZO'), '0');
  await h.flushWrites();
  const w3 = (await h.writes()).filter(x => x.path === RUTA('5401003'));
  t.eq(w3[w3.length - 1].payload.otras_fuentes.junji.gasto_rem_operacion.meses, { MARZO: 0 }, 'editar un mes de Operación escribe solo ese mes de `gasto_rem_operacion`');
  const st3 = (await h.store())[RUTA('5401003')].otras_fuentes.junji;
  t.eq([st3.gasto_rem.meses.MARZO, st3.gasto_rem_operacion.meses.MARZO], [300000, 0], 'el campo antiguo no se toca (300.000) y el nuevo guarda el 0');
  t.eq(await txt(page, '#oftotal-5401003-junji-of_gasto_rem_operacion'), '$220.000', 'y el 0 gana al valor antiguo (MAR = 0): total $220.000');
  await cerrar(h);

  // ---------------------------------------------------------------- 5) reconciliador: no pierde foco ni lo tecleado cuando otra persona cambia otra celda
  await abrir(h, '5402004');
  const selFoco = celda('5402004', 'of_gasto_rem_homologacion', 'ENERO');
  await page.focus(selFoco);
  await page.keyboard.press('End');
  await page.keyboard.type('5');
  await h.remoto('5402004', 'd.otras_fuentes.junji.gasto_rem_bdl = { meses: { FEBRERO: 11111 }, total: 11111 };');
  await h.waitIdle();
  t.eq(await page.evaluate((s) => [document.activeElement === document.querySelector(s), document.querySelector(s).value], selFoco), [true, '15000005'], 'otra persona edita otra línea con el modal abierto: la celda con foco conserva foco y lo tecleado (15000005)');
  t.eq(await page.inputValue(celda('5402004', 'of_gasto_rem_bdl', 'FEBRERO')), '11111', '…y la celda ajena toma el valor remoto');
  await page.fill(selFoco, '1500000');
  await h.flushWrites();
  await h.remoto('5402004', 'd.otras_fuentes.junji.gasto_rem_bdl = { meses: { FEBRERO: 0 }, total: 0 };');
  await cerrar(h);

  // ---------------------------------------------------------------- 6) Panel principal: tarjeta JUNJI, franja y evolución mensual = suma de las líneas
  const stNow = await h.store();
  const docsNow = Object.fromEntries(Object.entries(stNow).map(([p, d]) => [p.split('/')[1], d]));
  const EN = Object.fromEntries(GESPARVU_IDS.map(id => [id, esperado(docsNow, id)]));
  await clickTab(page, 'Panel principal');
  for (const v of ['total', 'real', 'proy']) {
    await page.click(`.dash-chips button[data-dash-vista="${v}"]`);
    await h.waitIdle();
    const c = await page.evaluate(() => { const e = document.querySelector('#dashCards .dash-card[data-fuente="junji"]'); return { rem: +e.dataset.rem, ing: +e.dataset.ing, gasto: +e.dataset.gas }; });
    const remEsp = GESPARVU_IDS.reduce((s, id) => s + EN[id][v].rem, 0);
    t.eq(c.rem, remEsp, `Panel principal · ${v}: la tarjeta JUNJI trae Remuneraciones = Σ de las 4 líneas de los 13 jardines (${remEsp})`);
    t.eq(c.gasto, GESPARVU_IDS.reduce((s, id) => s + EN[id][v].gasto, 0), `Panel principal · ${v}: …y el gasto total de la tarjeta`);
  }
  await page.click('.dash-chips button[data-dash-vista="total"]');

  // ---------------------------------------------------------------- 7) % Ejecución de JUNJI (un jardín): Remuneraciones = la suma de las 4 líneas
  await clickTab(page, '% Ejecución');
  await page.click('#ejecFuenteChips .of-chip[data-ejec-fuente="junji"]');
  await page.selectOption('#ejecRbdSelect', '5402002');
  await h.waitIdle();
  const kEj = await kpis(page, '#ejecKpiRow');
  const jj = EN['5402002'];
  const pct = (v) => v.toFixed(1).replace('.', ',') + '%';
  t.eq(kEj['% Ejec. Remuneraciones — Real+Proy a diciembre'], pct(jj.total.rem / jj.total.ingreso * 100), `% Ejecución · 5402002: «% Ejec. Remuneraciones» a diciembre = Rem. (suma de las 4 líneas, ${jj.total.rem}) / Ingreso (${jj.total.ingreso})`);
  t.eq(kEj['% Ejec. Remuneraciones — Real'], pct(jj.real.rem / jj.total.ingreso * 100), '…y el Real (lo ejecutado hasta el corte)');

  // ---------------------------------------------------------------- 8) Reportes: Visualizador (una línea por Remuneración) y Reporte personalizado (concepto por línea + total)
  await clickTab(page, 'Reportes');
  await page.click('#vzFuentesNinguna');
  await page.click('#vzFuenteChips [data-vz-fuente="junji"]');
  await page.evaluate(() => { document.getElementById('vzEntidadesDet').open = true; });
  await page.click('#vzEntNinguno');
  await page.evaluate(() => { const cb = document.querySelector('#vzEntList input[data-vz-ent="5402002"]'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('#vzExpGas');
  await h.waitIdle();
  const vz = await page.evaluate(() => Array.from(document.querySelectorAll('#vzTablaGas tr')).map(tr => Array.from(tr.children).map(td => td.textContent.replace(/\s+/g, ' ').trim())));
  const nodo = (nombre) => vz.find(f => f[0].includes(nombre));
  const e2 = EN['5402002'];
  for (const l of LINEAS) {
    const f = nodo(l.titulo);
    t.ok(f, `Visualizador (JUNJI, 5402002): árbol de gastos con la línea «${l.titulo}»`);
    t.eq(f && f.slice(1, 4).map(parseCLP), f ? [e2.lineas[l.key].real, e2.lineas[l.key].proy, e2.lineas[l.key].total] : null, `…con Real / Proyectado / Total de esa línea`);
  }
  const hojas = LINEAS.map(l => nodo(l.titulo)).filter(Boolean);
  const totRem = hojas.reduce((a, f) => a + parseCLP(f[3]), 0);
  t.eq(totRem, e2.total.rem, 'las 4 líneas del Visualizador suman la Remuneración total de la entidad (invariante)');
  await page.click('#vzLimpiarBtn');
  await page.click('#reporteVistaChips [data-reporte-vista="personalizado"]');
  await h.waitIdle();
  const catalogo = await page.evaluate(() => Array.from(document.querySelectorAll('#reporteConceptoList input[data-concepto-check]')).map(e => ({ key: e.dataset.conceptoCheck, label: e.closest('label').textContent.trim() })).filter(x => x.key.startsWith('of|junji|') && /rem|carrera|ingreso_carrera/.test(x.key)));
  t.eq(catalogo.map(c => c.key), ['of|junji|ingreso_carrera_docente', 'of|junji|rem', ...LINEAS.map(l => 'of|junji|' + l.campo)], 'Reporte personalizado: JUNJI ofrece el total «rem» y un concepto por línea de Remuneración (gasto_rem_operacion … gasto_rem_bdl)');
  t.eq(catalogo.map(c => c.label), ['[JUNJI] Ingreso Carrera Docente Parvularia', '[JUNJI] Remuneraciones — total (suma de las 4 líneas)', ...NOMBRE_LINEAS.map(n => '[JUNJI] ' + n)], '…con sus etiquetas (el ingreso renombrado a «Carrera Docente Parvularia»)');
  await page.click('#reporteRbdNinguno'); await page.click('#reporteConceptoNinguno'); await page.click('#reporteMesTodos');
  await page.evaluate((claves) => {
    const cb = document.querySelector('#reporteRbdList input[data-rbd-check="5402002"]'); cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true }));
    claves.forEach(k => { const c = document.querySelector(`#reporteConceptoList input[data-concepto-check="${k}"]`); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  }, ['of|junji|rem', ...LINEAS.map(l => 'of|junji|' + l.campo)]);
  await h.waitIdle();
  const filasRep = await page.evaluate(() => Array.from(document.querySelectorAll('#reporteTbody tr')).map(tr => ({ rbd: tr.children[0].textContent.trim(), concepto: tr.children[2].textContent.trim(), celdas: Array.from(tr.querySelectorAll('td.num')).map(td => td.textContent.trim()) })).filter(f => f.rbd === '5402002'));
  const totalFila = (nom) => { const f = filasRep.find(x => x.concepto.includes(nom)); return f ? parseCLP(f.celdas[12]) : null; };
  t.eq(totalFila('total (suma'), e2.total.rem, 'Reporte personalizado: el concepto «Remuneraciones — total» de 5402002 = suma de las 4 líneas');
  t.eq(LINEAS.map(l => totalFila(l.titulo)), LINEAS.map(l => e2.lineas[l.key].total), '…y cada línea trae su total anual');
  t.noErrores(h);

  // ---------------------------------------------------------------- 9) CSV / PDF por fila y respaldo JSON
  await clickTab(page, 'junji');
  const dl = await capturarDescarga(page, () => page.click('#otrasFuentesTbody-junji button.row-action-btn[data-action="csv"][data-rbd="5402002"]'));
  const csv = parseCsvPuntoYComa(dl.buffer.toString('utf8'));
  t.eq(csv.map(f => f[0]).slice(1, 9), ['Ingreso Operación', 'Ingreso Homologación', 'Ingreso Carrera Docente Parvularia', 'Ingreso Bono Desempeño Laboral (BDL)', ...NOMBRE_LINEAS], 'CSV de detalle: 4 líneas de ingreso y 4 de Remuneraciones');
  const sumaCsv = NOMBRE_LINEAS.reduce((s, n) => s + parseCLP(csv.find(f => f[0] === n).slice(-1)[0]), 0);
  const eNow = EN['5402002'];
  t.eq(sumaCsv, eNow.total.rem, 'las 4 filas de Remuneración del CSV suman la Remuneración de la entidad');
  t.eq(parseCLP(csv.find(f => f[0] === 'Gasto Total (Real+Proyectado)').slice(-1)[0]), eNow.total.gasto, '…y «Gasto Total» del CSV = oráculo');
  t.eq(parseCLP(csv.find(f => f[0] === 'Saldo Operación para B&S').slice(-1)[0]), eNow.saldos.saldoOp, 'el CSV trae «Saldo Operación para B&S»');
  await page.evaluate(() => { window.__prints = []; });
  await page.click('#otrasFuentesTbody-junji button.row-action-btn[data-action="pdf"][data-rbd="5402002"]');
  const pr = (await h.prints())[0];
  t.ok(pr && NOMBRE_LINEAS.every(n => pr.printWrap.includes(n)) && pr.printWrap.includes('Saldos por línea') && pr.printWrap.includes('Ingreso Carrera Docente Parvularia'), 'el PDF de la entidad trae las 4 tablas de Remuneraciones, «Saldos por línea» y «Ingreso Carrera Docente Parvularia»');
  const dj = await capturarDescarga(page, () => page.click('#downloadCargaOFBtn-junji'));
  const js = JSON.parse(dj.buffer.toString('utf8')).otras_fuentes_por_rbd['5402002'];
  t.eq([js.gasto_rem_homologacion.total, js.gasto_rem_operacion.total, js.gasto_rem.total, js.rp.total.rem], [eNow.lineas.homologacion.total, eNow.lineas.operacion.total, eNow.total.rem, eNow.total.rem], 'respaldo JSON: cada línea y el `gasto_rem` derivado (= suma) coinciden con el oráculo');
  await h.close();

  // ---------------------------------------------------------------- 10) documentos DAÑADOS: no tumban el documento ni al resto
  const dan = clon(docs);
  dan['5402002'].otras_fuentes.junji.gasto_rem_homologacion = 'texto';
  dan['5402004'].otras_fuentes.junji.gasto_rem_bdl = null;
  dan['5401006'].otras_fuentes.junji.gasto_rem_carrera_docente = { meses: { ENERO: 'abc', FEBRERO: null, MARZO: '1000', ABRIL: {}, MAYO: true }, total: 'basura' };
  dan['5401007'].otras_fuentes.junji.gasto_rem_operacion = { meses: 'x', total: 'y' };
  dan['5401003'].otras_fuentes.junji.gasto_rem_operacion = { meses: { ENERO: 'x', FEBRERO: null, MARZO: [1] }, total: 5 };   // inválidos: cae al mes del campo antiguo
  dan['5401005'].otras_fuentes.junji.gasto_rem_homologacion = [1, 2, 3];
  const h3 = await boot({ fixture: dan, user: 'authorized' });
  t.ok(await h3.page.evaluate(() => document.getElementById('sync-indicator').classList.contains('green')), 'con 6 documentos de JUNJI con una línea de Remuneración dañada el indicador sigue verde (ningún documento se omite)');
  await clickTab(h3.page, 'junji');
  const filasD = await leerTabla(h3.page);
  t.eq(filasD.length, 13, 'JUNJI sigue listando los 13 jardines');
  const ED = (id) => esperado(dan, id);
  t.eq(filasD.filter(f => JSON.stringify(f.cifras.map(parseCLP)) !== JSON.stringify(cifras(ED(f.rbd).total))).map(f => f.rbd), [], 'cada fila coincide con el oráculo que toma lo dañado como 0 (el texto numérico «1000» vale 1.000) y, en Operación, cae al mes del campo antiguo');
  t.eq(ED('5401003').lineas.operacion.total, 100000 + 200000 + 300000, 'oráculo: Operación de 5401003 con valores inválidos en el campo nuevo = el antiguo (100.000 + 200.000 + 300.000)');
  await h3.page.click('#otrasFuentesTbody-junji td[data-abrir-otra-fuente="5401006"]');
  await h3.waitIdle();
  t.eq(await h3.page.inputValue(celda('5401006', 'of_gasto_rem_carrera_docente', 'MARZO')), '1000', 'meses sucios: solo lo numérico se muestra (marzo = 1000)');
  await h3.page.keyboard.press('Escape');
  await clickTab(h3.page, 'Panel principal');
  t.eq((await h3.writes()).length, 0, 'leer los documentos dañados no escribe nada (no se «arreglan» solos)');
  t.noErrores(h3);
  await h3.close();

  // ---------------------------------------------------------------- 11) documentos del fixture `default` (todos antiguos): las cifras de JUNJI son las de siempre
  const dDef = cargarFixture('default').docs;
  const h2 = await boot({ fixture: 'default', user: 'authorized' });
  await clickTab(h2.page, 'junji');
  const filasDef = await leerTabla(h2.page);
  const malas = filasDef.filter(f => {
    const of = ofJ(dDef, f.rbd), c = corteFuente(dDef, f.rbd, 'junji');
    const rem = parte(of.gasto_rem, c);
    return parseCLP(f.cifras[1]) !== r(rem.real) + r(rem.proy);
  }).map(f => f.rbd);
  t.eq(malas, [], 'fixture default (solo `gasto_rem` antiguo): la Remuneración de cada fila es la de siempre (todo en Operación)');
  t.eq((await h2.writes()).length, 0, 'y no se escribe nada');
  t.eq(remEfectivoDe(ofJ(dDef, '5402002')).meses.ENERO, Number(ofJ(dDef, '5402002').gasto_rem.meses.ENERO) || 0, 'oráculo: sin campos nuevos, la suma de las líneas es la fila antigua');
  t.noErrores(h2);
  await h2.close();
  void filasFuente;
});
