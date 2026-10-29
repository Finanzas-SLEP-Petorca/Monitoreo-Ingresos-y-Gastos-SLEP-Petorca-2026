// fondos_fijos_general (PR K) — el VÍNCULO de Fondos Fijos con el gasto de Subvención General y su INVARIANTE entre vistas. Fixture `fondos_fijos`, contra el cálculo independiente de tests/lib/fondos_fijos.mjs.
//
// Regla (README «Fondos Fijos»): solo `registrado_general` entra al gasto: se suma, una sola vez, al B&S REAL de Subvención General de la MISMA entidad y mes (siempre Real, sin importar el «Real hasta»).
// Un GESPARVU con algo registrado es además fila de General. El cupo, lo rendido, observado, compensado en SIGFE, la reposición y el saldo inicial NO mueven ninguna cifra. AC no es entidad de Fondos Fijos.
// Las MISMAS cifras de General salen en: la pestaña General (tarjetas Real / Proyectado / Total, filas, Estado, «N de M en déficit»), el modal y el CSV de detalle y el PDF de la fila, el Panel principal
// (tarjeta, franja, evolución mensual, «Atención»), % Ejecución (agregado, una entidad y Consolidado), el Visualizador (árbol, Excel y CSV) y el Reporte personalizado.
import { boot, cargarFixture } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { docsDe, clon } from '../lib/corte.mjs';
import { leerCLP, tarjetas } from '../lib/honorarios.mjs';
import { leerTarjetas, leerFilas, abrirModal, cerrarModal } from '../lib/honorarios_fuentes.mjs';
import { capturarDescarga, leerXlsx, parseCsvPuntoYComa } from '../lib/capture-utils.mjs';
import { FUENTES, MESES, IDS_FF, GESPARVU_IDS, generalEsperada, fuenteEsp, serieGeneral, fondosPorMes, registradoGeneral, idsGeneral, ffTotales, clp, fmt } from '../lib/fondos_fijos.mjs';

const SUF = { total: 'Total', real: 'Real', proy: 'Proyectado' };
const dashVista = async (h, v) => { await h.page.click(`.dash-chips button[data-dash-vista="${v}"]`); await h.waitIdle(); };
const strip = (page) => page.evaluate(() => { const o = {}; document.querySelectorAll('#dashStrip .dash-tile').forEach(t => { o[t.querySelector('.t-label').textContent.trim()] = t.querySelector('.t-value').textContent.trim(); }); return o; });
const tarjetasDash = (page) => page.evaluate(() => { const o = {}; document.querySelectorAll('#dashCards .dash-card').forEach(c => { o[c.dataset.fuente] = { ingreso: +c.dataset.ing, rem: +c.dataset.rem, hon: +c.dataset.hon, bys: +c.dataset.bys, gasto: +c.dataset.gas, saldo: +c.dataset.saldo, def: c.textContent.replace(/\s+/g, ' ') }; }); return o; });
const vzTotales = (page, id) => page.evaluate((i) => Array.from(document.querySelector(`#${i} tr.vz-total-row`).querySelectorAll('td')).slice(1, 4).map(td => td.textContent.trim()), id);
const suma12 = (a) => a.reduce((x, y) => x + y, 0);

await correrSpec('fondos_fijos_general', async (t) => {
  const docs = docsDe('fondos_fijos');
  const eg = generalEsperada(docs);
  const ff = ffTotales(docs);
  const regTotal = suma12(fondosPorMes(docs));
  t.eq(regTotal, 390000, 'el fixture registra 390.000 en General (1121: 120.000 + 80.000; 1125: 60.000; 1128: 20.000; 1129: 10.000; 5402002: 90.000 + 10.000), sin los 5.000 de AC');
  t.eq(eg.suma.nEntidades, 57, 'General lista 57 entidades: 55 RBD + AC + el jardín 5402002');
  const h = await boot({ fixture: 'fondos_fijos' });
  const { page } = h;

  // ================================================================ 1. pestaña General
  await h.clickTab('of-general');
  const tj = await leerTarjetas(page, 'general');
  for (const vista of ['real', 'proy', 'total']) {
    const b = eg.suma[vista], suf = SUF[vista];
    const lee = (r) => clp((tj[vista][`${r} (${suf})`] || {}).valor);
    t.eq([lee('Ingreso'), lee('Gasto Remuneraciones'), lee('Gasto Honorarios'), lee('Gasto Bienes y Servicios'), lee('Gasto Total'), lee('Saldo')], [b.ingreso, b.rem, b.hon, b.bys, b.gasto, b.saldo], `General · tarjetas ${suf} = cálculo independiente (con los Fondos Fijos registrados dentro del B&S ${vista === 'proy' ? '— Proyectado no los incluye' : '(siempre Real)'})`);
  }
  t.eq(eg.suma.real.bys - eg.suma.total.bys + eg.suma.proy.bys, 0, 'sanity: el B&S Real + Proyectado = Total');
  t.ok(new RegExp(`${eg.suma.nDeficit} de ${eg.suma.nEntidades} entidades en déficit`).test((tj.total['Saldo (Total)'] || {}).nota), `General: «${eg.suma.nDeficit} de ${eg.suma.nEntidades} entidades en déficit» (cuenta al jardín 5402002, en Déficit por su B&S de Fondos Fijos)`, (tj.total['Saldo (Total)'] || {}).nota);
  const filas = await leerFilas(page, 'general');
  const malas = [];
  Object.entries(eg.porId).forEach(([id, e]) => { const r = filas[id]; if (!r) { malas.push(id + ' (sin fila)'); return; } const ok = clp(r.ingreso) === e.total.ingreso && clp(r.rem) === e.total.rem && clp(r.hon) === e.total.hon && clp(r.bys) === e.total.bys && clp(r.gasto) === e.total.gasto && clp(r.saldo) === e.total.saldo && r.estado === (e.estado === 'deficit' ? 'Déficit' : 'Superávit'); if (!ok) malas.push(`${id}: ${JSON.stringify(r)} ≠ ${JSON.stringify(e.total)}`); });
  t.eq(malas, [], 'General: cada una de las 57 filas = cálculo independiente (Ingreso, Rem., Honorarios, B&S, Gasto Total, Saldo, Estado)');
  t.eq(Object.keys(filas).length, 57, 'General: 57 filas (el jardín 5401006, con Fondos Fijos sin registrar, no aparece)');
  for (const vista of ['real', 'proy']) {
    await page.click(`#tab-of-general .of-chip[data-of-vista="${vista}"]`);
    await h.waitIdle();
    const fv = await leerFilas(page, 'general');
    const malasV = Object.entries(eg.porId).filter(([id, e]) => clp(fv[id].bys) !== e[vista].bys || clp(fv[id].saldo) !== e[vista].saldo).map(([id]) => id);
    t.eq(malasV, [], `General · vista ${vista}: B&S y Saldo de cada fila = cálculo independiente (Fondos Fijos solo en Real, también el de octubre, posterior al «Real hasta» de julio)`);
  }
  await page.click('#tab-of-general .of-chip[data-of-vista="total"]');
  await h.waitIdle();
  // el Fondo Fijo de octubre (1125) es Real aunque el «Real hasta» de General sea julio
  const e1125 = eg.porId['1125'];
  t.ok(e1125.real.bys >= 60000, 'sanity: el Fondo Fijo de 1125 (octubre, 60.000) está en su B&S Real');
  const modalesGeneral = {};
  await abrirModal(h, 'general', '5402002');
  modalesGeneral.jardin = await page.evaluate(() => ({ titulo: document.getElementById('otrasFuentesModalTitle').textContent, sub: document.getElementById('otrasFuentesModalSubtitle').textContent.replace(/\s+/g, ' '),
    bloque: (Array.from(document.querySelectorAll('#otrasFuentesModalBody .compras-section')).find(x => /Fondos Fijos rendidos/.test(x.textContent)) || { innerText: '' }).innerText.replace(/\s+/g, ' '),
    celdasEditables: document.querySelectorAll('#otrasFuentesModalBody input.celda-input').length }));
  t.ok(/GESPARVU 5402002/.test(modalesGeneral.jardin.titulo) && /Subvención General/.test(modalesGeneral.jardin.titulo), 'modal del jardín en General: título «GESPARVU 5402002 — RINCONCITO · Subvención General»', modalesGeneral.jardin.titulo);
  t.ok(/\$100\.000/.test(modalesGeneral.jardin.bloque) && /Solo lectura/.test(modalesGeneral.jardin.bloque), 'el modal del jardín muestra el bloque de solo lectura «Fondos Fijos rendidos — B&S General» con $100.000', modalesGeneral.jardin.bloque);
  t.ok(/DÉFICIT/i.test(modalesGeneral.jardin.sub) && /-\$100\.000/.test(modalesGeneral.jardin.sub), 'y su subtítulo dice Déficit con saldo -$100.000', modalesGeneral.jardin.sub);
  await cerrarModal(h);
  t.eq((await h.writes()).length, 0, 'abrir y mirar no escribe nada');

  // ================================================================ 2. Panel principal
  await h.clickTab('SEP');
  const T = await tarjetas(page, '#kpiRow'), R = await tarjetas(page, '#kpiRowReal'), P = await tarjetas(page, '#kpiRowProy');
  const gastoSep = (X, suf) => leerCLP(X[`Gasto Remuneraciones (${suf})`]) + leerCLP(X[`Gasto Honorarios (${suf})`]) + leerCLP(X[`Gasto Bienes y Servicios (${suf})`]);
  const sep = {
    total: { gasto: gastoSep(T, 'a Diciembre') },
    real: { gasto: gastoSep(R, 'Real') },
    proy: { gasto: gastoSep(P, 'Proyectado') },
  };
  const esp = {};
  FUENTES.forEach(f => { esp[f.key] = fuenteEsp(docs, f.key); });
  await h.clickTab('Panel principal');
  for (const vista of ['total', 'real', 'proy']) {
    await dashVista(h, vista);
    const tjd = await tarjetasDash(page);
    const g = eg.suma[vista], c = tjd.general;
    t.eq([c.ingreso, c.rem, c.hon, c.bys, c.gasto, c.saldo], [g.ingreso, g.rem, g.hon, g.bys, g.gasto, g.saldo], `Panel principal (${vista}): la tarjeta de Subv. General = su pestaña = cálculo independiente (con Fondos Fijos)`);
    t.ok(new RegExp(`${eg.suma.nDeficit} de ${eg.suma.nEntidades} entidades en déficit`).test(c.def), `Panel principal (${vista}): la tarjeta de General dice «${eg.suma.nDeficit} de ${eg.suma.nEntidades} entidades en déficit»`, c.def);
    const otras = FUENTES.filter(f => f.key !== 'general').filter(f => esp[f.key].suma[vista].bys !== undefined);
    const malasO = otras.filter(f => { const b = esp[f.key].suma[vista], x = tjd[f.key]; return x.bys !== b.bys || x.gasto !== b.gasto || x.saldo !== b.saldo; }).map(f => f.key);
    t.eq(malasO, [], `Panel principal (${vista}): las otras 11 fuentes NO cambian por los Fondos Fijos (solo registrado en General mueve General)`);
    const s = await strip(page);
    const lee = (r) => leerCLP(s[r] || s[r.toUpperCase()]);
    const sumaGasto = tjd.sep.gasto + FUENTES.reduce((x, f) => x + tjd[f.key].gasto, 0);
    t.eq(lee('Gasto Total'), sumaGasto, `Panel principal (${vista}): el «Gasto Total» de la franja suma SEP y las 12 fuentes (con los Fondos Fijos dentro de General)`);
    t.eq(lee('Saldo consolidado'), tjd.sep.saldo + FUENTES.reduce((x, f) => x + tjd[f.key].saldo, 0), `Panel principal (${vista}): el saldo consolidado = suma de los saldos de las tarjetas`);
    t.eq(tjd.sep.gasto, sep[vista].gasto, `Panel principal (${vista}): la tarjeta de SEP no cambia (= su pestaña)`);
    if (vista === 'total') {
      const m = await page.evaluate(() => { const filasM = Array.from(document.querySelectorAll('#dashTablaMesBody tbody tr')); const u = filasM[filasM.length - 1]; return { gas: u.children[2].textContent.trim(), saldo: u.children[3].textContent.trim() }; });
      t.eq([leerCLP(m.gas), leerCLP(m.saldo)], [lee('Gasto Total'), lee('Saldo consolidado')], 'Panel principal (Total): la evolución mensual suma el mismo gasto y saldo que la franja');
      const at = await page.evaluate(() => Array.from(document.querySelectorAll('#dashAtencion li[data-atencion-rbd]')).map(li => ({ f: li.dataset.atencionFuente, id: li.dataset.atencionRbd, saldo: li.querySelector('.a-saldo').textContent.trim(), txt: li.textContent.replace(/\s+/g, ' ') })));
      const malasA = at.filter(a => a.f === 'general').filter(a => !eg.porId[a.id] || eg.porId[a.id].estado !== 'deficit' || leerCLP(a.saldo) !== eg.porId[a.id].total.saldo).map(a => a.id);
      t.eq(malasA, [], '«Atención»: toda entidad de General que aparece está en Déficit y con el saldo del cálculo independiente');
      const nTotal = Number(tjd.sep.def.match(/(\d+) de/)[1]) + FUENTES.reduce((n, f) => n + esp[f.key].suma.nDeficit, 0);
      t.ok(new RegExp(`— ${nTotal} en total`).test(await page.evaluate(() => document.getElementById('dashNotaAtencion').textContent)), `«Atención» cuenta ${nTotal} entidades en Déficit entre SEP y las 12 fuentes (incluida la de General por Fondos Fijos: el jardín 5402002)`);
    }
  }
  await dashVista(h, 'total');
  const dashFF = await page.evaluate(() => document.getElementById('dashFondosFijos').innerText.replace(/\s+/g, ' '));
  t.ok(dashFF.includes(fmt(ff.aceptado)) && dashFF.includes(fmt(ff.pendienteGeneral)) && dashFF.includes(fmt(ff.pendienteSigfe)), 'el recuadro de Fondos Fijos del Panel principal trae aceptado, pendiente General y pendiente SIGFE del cálculo independiente', dashFF);

  // ================================================================ 3. % Ejecución
  await h.clickTab('% Ejecución');
  const leerEjec = () => page.evaluate(() => Array.from(document.querySelectorAll('#ejecTbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
  await page.click('#ejecFuenteChips .of-chip[data-ejec-fuente="general"]');
  await h.waitIdle();
  let f = await leerEjec();
  const sg = serieGeneral(docs);
  t.eq(f.map(r => leerCLP(r[9])), sg.bys.real.map((v, i) => v + sg.bys.proy[i]), '% Ejecución General: «Gasto B&S (mes)» mes a mes = cálculo independiente (compras + proyección + Fondos Fijos de RBD y del jardín; sin los de AC)');
  t.eq([f.reduce((s, r) => s + leerCLP(r[9]), 0), f.reduce((s, r) => s + leerCLP(r[3]), 0)], [eg.suma.total.bys, eg.suma.total.rem], '% Ejecución General: los 12 meses suman el B&S y las remuneraciones de la pestaña');
  const opts = await page.evaluate(() => Array.from(document.querySelectorAll('#ejecRbdSelect option')).map(o => o.value));
  t.ok(opts.includes('5402002') && !opts.includes('5401006'), '% Ejecución General: el selector de entidad incluye al jardín con Fondos Fijos registrados (5402002) y no a los demás jardines', opts.filter(o => /^54/.test(o)));
  await page.selectOption('#ejecRbdSelect', '5402002');
  await h.waitIdle();
  f = await leerEjec();
  t.eq(f.map(r => leerCLP(r[9])), registradoGeneral(docs, '5402002'), '% Ejecución General / 5402002: el B&S mensual del jardín son sus Fondos Fijos (90.000 en mayo y 10.000 en agosto)');
  await page.selectOption('#ejecRbdSelect', '1121');
  await h.waitIdle();
  const s1121 = serieGeneral(docs, '1121');
  f = await leerEjec();
  t.eq(f.map(r => leerCLP(r[9])), s1121.bys.real.map((v, i) => v + s1121.bys.proy[i]), '% Ejecución General / 1121: el B&S mensual incluye los Fondos Fijos de marzo (120.000) y junio (80.000)');
  await page.selectOption('#ejecRbdSelect', 'AC');
  await h.waitIdle();
  const sAC = serieGeneral(docs, 'AC');
  f = await leerEjec();
  t.eq(f.map(r => leerCLP(r[9])), sAC.bys.real.map((v, i) => v + sAC.bys.proy[i]), '% Ejecución General / AC: SIN los 5.000 que trae su documento (AC no es entidad de Fondos Fijos)');
  await page.selectOption('#ejecRbdSelect', '');
  await page.click('#ejecFuenteChips .of-chip[data-ejec-fuente="consolidado"]');
  await h.waitIdle();
  f = await leerEjec();
  const strip2 = await (async () => { await h.clickTab('Panel principal'); await dashVista(h, 'total'); return strip(page); })();
  await h.clickTab('% Ejecución');
  const totalDash = leerCLP(strip2['Gasto Total'] || strip2['GASTO TOTAL']);
  t.eq(f.reduce((s, r) => s + leerCLP(r[3]) + leerCLP(r[6]) + leerCLP(r[9]), 0), totalDash, '% Ejecución Consolidado: rem + hon + B&S a diciembre = el «Gasto Total» de la franja del Panel principal (con los Fondos Fijos)');

  // ================================================================ 4. Reportes: Visualizador (árbol, Excel y CSV) y Reporte personalizado
  await h.clickTab('Reportes');
  await page.click('#vzFuentesNinguna');
  await page.click('#vzFuenteChips [data-vz-fuente="general"]');
  await h.waitIdle();
  const gas = (await vzTotales(page, 'vzBodyGas')).map(leerCLP);
  t.eq(gas, [eg.suma.real.gasto, eg.suma.proy.gasto, eg.suma.total.gasto], 'Visualizador (General): Total Gastos Real / Proyectado / Total = los de la pestaña (con los Fondos Fijos)');
  await page.click('#vzExpGas');
  const nodos = await page.evaluate(() => Array.from(document.querySelectorAll('#vzBodyGas tr.vz-row')).map(tr => ({ n: tr.querySelector('.vz-name').textContent.trim().replace(/^[▸▾]\s*/, ''), cls: tr.className, real: tr.children[1].textContent.trim(), proy: tr.children[2].textContent.trim(), total: tr.children[3].textContent.trim() })));
  const nFF = nodos.find(n => n.n === 'Bienes y Servicios — Fondos Fijos rendidos');
  const hojaFF = nodos.find(n => n.n === 'Fondos Fijos rendidos');
  t.ok(nFF && leerCLP(nFF.real) === regTotal && leerCLP(nFF.proy) === 0, `Visualizador (por fuente): existe el grupo «Bienes y Servicios — Fondos Fijos rendidos» con ${fmt(regTotal)} Real y $0 Proyectado (antes la línea no salía en el árbol y el total no cuadraba con sus filas)`, nFF);
  t.ok(hojaFF && leerCLP(hojaFF.total) === regTotal, 'Visualizador: y su fila «Fondos Fijos rendidos» con el mismo total', hojaFF);
  const nodoFuente = nodos.find(n => /vz-d0/.test(n.cls));
  const hijos = nodos.filter(n => /vz-d1/.test(n.cls)).reduce((s, n) => s + leerCLP(n.real), 0);
  t.eq([leerCLP(nodoFuente.real), hijos], [eg.suma.real.gasto, eg.suma.real.gasto], 'Visualizador: el nodo de la fuente (Real) = la suma de sus grupos (Remuneraciones, Honorarios, B&S, Fondos Fijos…): el árbol cuadra');
  const csv = (await capturarDescarga(page, () => page.click('#vzCsvBtn'))).buffer.toString('utf8').split(/\r?\n/);
  const lineaFF = csv.find(l => /Fondos Fijos rendidos/.test(l));
  t.ok(lineaFF && /^Gasto;Subvención General;Bienes y Servicios — Fondos Fijos rendidos;/.test(lineaFF) && lineaFF.split(';').slice(-1)[0] === String(regTotal), 'Visualizador · CSV: la línea de Fondos Fijos está en su propia subcategoría «Bienes y Servicios — Fondos Fijos rendidos» (no en «Proyección») y suma el total', lineaFF);
  const dlX = await capturarDescarga(page, () => page.click('#vzExcelGas'));
  const libro = await leerXlsx(page, dlX.buffer);
  const detalle = libro.hojas['Detalle'].find(r => r[3] === 'Fondos Fijos rendidos');
  t.ok(detalle && detalle[1] === 'Bienes y Servicios — Fondos Fijos rendidos' && detalle[4] === regTotal && detalle[5] === 0, 'Visualizador · Excel de Gastos, hoja Detalle: subcategoría propia y Real = el total de Fondos Fijos', detalle);
  const mensual = libro.hojas['Mensual Real'].find(r => r[3] === 'Fondos Fijos rendidos');
  t.eq(mensual ? mensual.slice(4, 16) : null, fondosPorMes(docs), 'Visualizador · Excel, hoja «Mensual Real»: los Fondos Fijos mes a mes = cálculo independiente');
  // por código
  await page.click('#vzAgruparChips [data-vz-agrupar="codigo"]');
  await h.waitIdle();
  const gasC = (await vzTotales(page, 'vzBodyGas')).map(leerCLP);
  t.eq(gasC, gas, 'Visualizador por código: los mismos totales');
  await page.click('#vzExpGas');
  const textoC = await page.evaluate(() => document.getElementById('vzBodyGas').innerText);
  t.ok(/Bienes y Servicios — Fondos Fijos rendidos/.test(textoC), 'Visualizador por código: también muestra el grupo de Fondos Fijos');
  await page.click('#vzAgruparChips [data-vz-agrupar="fuente"]');
  // todas las fuentes + SEP: el total coincide con la franja
  await page.click('#vzFuentesTodas');
  await h.waitIdle();
  const gasTodas = (await vzTotales(page, 'vzBodyGas')).map(leerCLP);
  t.eq(gasTodas[2], totalDash, 'Visualizador (todas las fuentes): Total Gastos = el «Gasto Total» de la franja del Panel principal');
  // los jardines que no tienen Fondos Fijos registrados no generan nada en General
  await page.click('#vzFuentesNinguna');
  await page.click('#vzFuenteChips [data-vz-fuente="general"]');
  await h.waitIdle();

  // Reporte personalizado
  await page.click('#reporteVistaChips [data-reporte-vista="personalizado"]');
  await h.waitIdle();
  const catalogo = await page.evaluate(() => Array.from(document.querySelectorAll('#reporteConceptoList input[data-concepto-check]')).map(e => e.dataset.conceptoCheck));
  t.ok(catalogo.includes('of|general|bys_fondos') && catalogo.includes('of|general|ingreso_carrera_docente') && !catalogo.includes('of|recuperacion_llmm|rem'), 'Reporte personalizado: el catálogo de General ofrece «Fondos Fijos rendidos» y «Ingreso Carrera Docente»; Recuperación LLMM (solo ingresos) NO ofrece «Remuneraciones»');
  await page.click('#reporteRbdNinguno');
  await page.click('#reporteConceptoNinguno');
  const marcar = (sel, v) => page.evaluate(([s, val]) => { const el = document.querySelector(s); if (!el) return false; el.checked = val; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }, [sel, v]);
  await page.evaluate(() => { document.querySelectorAll('#reporteConceptoList details').forEach(d => { d.open = true; }); });
  const ids = ['1121', '1125', '5402002', 'AC', '1122'];
  for (const id of ids) await marcar(`#reporteRbdList input[data-rbd-check="${id}"]`, true);
  for (const c of ['bys_total', 'bys_fondos', 'ingreso_carrera_docente']) await marcar(`#reporteConceptoList input[data-concepto-check="of|general|${c}"]`, true);
  await h.waitIdle();
  const filasRep = await page.evaluate(() => Array.from(document.querySelectorAll('#reporteTbody tr')).map(tr => ({ c: Array.from(tr.children).map(td => td.textContent.trim()), real: Array.from(tr.querySelectorAll('td.num')).slice(0, 12).map(td => (td.classList.contains('mes-real') ? 'R' : (td.classList.contains('mes-proy') ? 'P' : '-'))).join('') })));
  const fila = (rbd, concepto) => filasRep.find(r => r.c[0] === rbd && r.c[2] === `[Subv. General] ${concepto}`);
  const malRep = [];
  ids.forEach(id => {
    const e = eg.porId[id];
    const b = fila(id, 'Bienes y Servicios — total (Real+Proy)');
    if (!b) { malRep.push(`${id}: sin fila B&S total`); return; }
    if (leerCLP(b.c[b.c.length - 1]) !== e.total.bys) malRep.push(`${id}: B&S total ${b.c[b.c.length - 1]} ≠ ${e.total.bys}`);
    const reg = suma12(registradoGeneral(docs, id));
    const ffr = fila(id, 'Bienes y Servicios — Fondos Fijos rendidos (control operativo)');
    if (reg && (!ffr || leerCLP(ffr.c[ffr.c.length - 1]) !== reg)) malRep.push(`${id}: Fondos Fijos ${ffr && ffr.c[ffr.c.length - 1]} ≠ ${reg}`);
    if (!reg && ffr && leerCLP(ffr.c[ffr.c.length - 1]) !== 0) malRep.push(`${id}: Fondos Fijos de más`);
  });
  t.eq(malRep, [], 'Reporte personalizado: «B&S total» de General por entidad = cálculo independiente (con Fondos Fijos, también del jardín 5402002 y sin los de AC) y la línea «Fondos Fijos rendidos» = lo registrado');
  t.eq(fila('5402002', 'Bienes y Servicios — Fondos Fijos rendidos (control operativo)').real, 'RRRRRRRRRRRR', 'Reporte personalizado: los Fondos Fijos son Real en los 12 meses (siempre reales)');
  t.eq(fila('1122', 'Ingreso Carrera Docente') && leerCLP(fila('1122', 'Ingreso Carrera Docente').c.slice(-1)[0]), 300000, 'Reporte personalizado: «Ingreso Carrera Docente» de General / 1122 = 300.000 (250.000 en enero + 50.000 en marzo)');
  const ingC = fila('AC', 'Ingreso Carrera Docente');
  t.eq(ingC && leerCLP(ingC.c.slice(-1)[0]), 80000, 'Reporte personalizado: «Ingreso Carrera Docente» de General / AC = 80.000');
  await page.click('#reporteVistaChips [data-reporte-vista="visualizador"]');
  await h.waitIdle();

  // ================================================================ 5. exportaciones de una fila de General: PDF, XLS y CSV SUPEREDUC (el CSV de detalle mensual existe solo en las fuentes sin SUPEREDUC)
  await h.clickTab('of-general');
  const dl = async (id, accion) => capturarDescarga(page, () => page.click(`#otrasFuentesTbody-general button.row-action-btn[data-action="${accion}"][data-rbd="${id}"]`));
  // PDF por fila (HTML imprimible)
  for (const id of ['1121', '5402002']) {
    await page.click(`#otrasFuentesTbody-general button.row-action-btn[data-action="pdf"][data-rbd="${id}"]`);
    await h.waitIdle();
    const pr = (await h.prints()).slice(-1)[0];
    const html = pr.printWrap || '';
    t.ok(/Fondos Fijos rendidos/.test(html) && html.includes(fmt(suma12(registradoGeneral(docs, id)))), `PDF de General / ${id}: incluye el bloque de Fondos Fijos rendidos con su total (los KPI de B&S ya los sumaban sin mostrar de dónde salían)`);
    if (id === '1121') t.ok(/Ingreso Carrera Docente/.test(html) && html.includes('$700.000'), 'PDF de General / 1121: incluye la tabla «Ingreso Carrera Docente» (700.000)');
  }
  // XLS y CSV SUPEREDUC de General: los Fondos Fijos NO van en el libro de compras
  const xls = await dl('1121', 'excel');
  const lib = await leerXlsx(page, xls.buffer);
  t.ok(lib.orden.includes('ING_CARRERA_DOCENTE'), 'XLS de General / 1121: trae la hoja ING_CARRERA_DOCENTE');
  t.eq(lib.hojas['ING_CARRERA_DOCENTE'].find(r => String(r[0]) === '1121').slice(2, 14).reduce((s, v) => s + (Number(v) || 0), 0), 700000, 'con los 700.000 de Carrera Docente de 1121');
  t.ok(!JSON.stringify(lib.hojas).includes('Fondos'), 'el XLS de General no trae Fondos Fijos (se controlan aparte; el B&S del XLS es el de las compras)');
  const supereduc = (await capturarDescarga(page, () => page.click('#downloadComprasOFBtn-general'))).buffer.toString('utf8');
  t.ok(!/Fondos Fijos/i.test(supereduc), 'el CSV SUPEREDUC de compras de General NO incluye Fondos Fijos');

  // ================================================================ 6. el cupo, lo rendido, observado, compensado, reposición y saldo inicial NO mueven ninguna cifra; registrado en General sí
  await h.clickTab('Panel principal');
  await dashVista(h, 'total');
  const antes = { tj: JSON.stringify(await tarjetasDash(page)), strip: JSON.stringify(await strip(page)) };
  await h.remoto('1121', "d.fondos_fijos.cupo = 9999999; d.fondos_fijos.meses.ENERO = { saldo_inicial: 2000000, rendido: 1000000, observado: 300000, compensado_sigfe: 400000, reposicion: 3000000, folio: 'X' }; d.fondos_fijos.meses.MARZO.observado = 123456; d.fondos_fijos.meses.MARZO.compensado_sigfe = 1");
  await h.waitIdle();
  t.eq([JSON.stringify(await tarjetasDash(page)), JSON.stringify(await strip(page))], [antes.tj, antes.strip], 'cambiar cupo, saldo inicial, rendido, observado, compensado SIGFE y reposición NO cambia ninguna cifra del Panel principal (ni de General: no entran al gasto)');
  const dashFF2 = await page.evaluate(() => document.getElementById('dashFondosFijos').innerText.replace(/\s+/g, ' '));
  t.ok(dashFF2 !== dashFF, 'pero el recuadro de Fondos Fijos sí cambia (aceptado y pendientes)', dashFF2);
  await h.remoto('1121', 'd.fondos_fijos.meses.JULIO = { registrado_general: 25000 }');
  await h.waitIdle();
  const t0 = await tarjetasDash(page);
  // el servidor tiene el documento completo de 1121 + lo remoto; se recalcula el esperado con ese mismo documento
  const docRemoto = (await h.store())['sep_carga_rbd/1121'];
  const docs3 = clon(docs); docs3['1121'] = docRemoto;
  const eg3 = generalEsperada(docs3);
  t.eq([t0.general.bys, t0.general.gasto, t0.general.saldo], [eg3.suma.total.bys, eg3.suma.total.gasto, eg3.suma.total.saldo], 'registrar 25.000 más en General desde otra sesión mueve el B&S de General en el Panel principal en el acto (cálculo independiente sobre el documento del servidor)');
  t.eq(IDS_FF.length, 68, 'sanity: 68 entidades de Fondos Fijos');
  void GESPARVU_IDS; void idsGeneral; void cargarFixture;
  t.noErrores(h);
  await h.close();
});
