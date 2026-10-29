// Honorarios (PR-3) · TOTALES e INVARIANTE entre vistas. Fixture `honorarios_fuentes` (boletas y proyección en SEP y en las 9 fuentes) contra el cálculo independiente de
// tests/lib/honorarios_fuentes.mjs. En las fuentes NO hay 70/30: gasto total = remuneraciones + honorarios + B&S, y los MISMOS números salen en todas las vistas, en Total / Real / Proyectado:
//   · pestaña de cada fuente (tarjetas Real / Proyectado / Total y la columna «Gasto Honorarios» de cada fila, con su Estado y «N de M entidades en déficit»);
//   · Panel principal (tarjeta de cada fuente, franja consolidada, evolución mensual, «Atención»);
//   · % Ejecución (cada fuente, una entidad y el Consolidado) y Reportes (Visualizador y Reporte personalizado);
//   · JUNJI: los honorarios son gasto de personal: entran en el saldo total y en el Estado, pero NO en el saldo de Operación para B&S (se financian como las Remuneraciones);
//   · SIN honorarios cargados (fixture `compras_conceptos`) las cifras no cambian: «Gasto Honorarios» = $0 y el gasto es el de siempre.
import { boot, clickTab, cargarFixture } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { docsDe } from '../lib/corte.mjs';
import { honDe, leerCLP, tarjetas } from '../lib/honorarios.mjs';
import { FUENTES, MESES, entidadDe, fuenteEsperada, serieMensual, leerTarjetas, leerFilas, clp, fmt, abrirModal, cerrarModal, llenarFormHonOF } from '../lib/honorarios_fuentes.mjs';
import { RBD_IDS } from '../lib/corte.mjs';

const dashVista = async (h, v) => { await h.page.click(`.dash-chips button[data-dash-vista="${v}"]`); await h.waitIdle(); };
const strip = (page) => page.evaluate(() => { const o = {}; document.querySelectorAll('#dashStrip .dash-tile').forEach(t => { o[t.querySelector('.t-label').textContent.trim()] = t.querySelector('.t-value').textContent.trim(); }); return o; });
const tarjetasDash = (page) => page.evaluate(() => { const o = {}; document.querySelectorAll('#dashCards .dash-card').forEach(c => { o[c.dataset.fuente] = { ingreso: +c.dataset.ing, rem: +c.dataset.rem, hon: +c.dataset.hon, bys: +c.dataset.bys, gasto: +c.dataset.gas, saldo: +c.dataset.saldo, def: c.querySelector('.c-def').textContent.trim() }; }); return o; });
const sumaTarjetas = (tj, k) => Object.values(tj).reduce((s, c) => s + c[k], 0);
const filaMensualTotal = (page) => page.evaluate(() => { const filas = Array.from(document.querySelectorAll('#dashTablaMesBody tbody tr')); const u = filas[filas.length - 1]; return { ing: u.children[1].textContent.trim(), gas: u.children[2].textContent.trim(), saldo: u.children[3].textContent.trim() }; });
const vzTotales = (page, id) => page.evaluate((i) => Array.from(document.querySelector(`#${i} tr.vz-total-row`).querySelectorAll('td')).slice(1, 4).map(td => td.textContent.trim()), id);
const KEYS = { total: 'total', real: 'real', proy: 'proy' };
const SUF = { total: 'Total', real: 'Real', proy: 'Proyectado' };

await correrSpec('honorarios_fuentes_totales', async (t) => {
  const fx = cargarFixture('honorarios_fuentes').docs;
  const docs = docsDe('honorarios_fuentes');
  const esp = {};
  FUENTES.forEach(f => { esp[f.key] = fuenteEsperada(docs, f.key); });
  const honSep = RBD_IDS.reduce((a, k) => { const e = honDe(fx[k]); a.bol += e.boletas; a.proy += e.proy; return a; }, { bol: 0, proy: 0 });
  const honFuentes = FUENTES.reduce((s, f) => s + esp[f.key].suma.total.hon, 0);
  t.ok(honFuentes > 0 && honSep.bol + honSep.proy > 0, 'el fixture trae honorarios en SEP y en las fuentes');

  const h = await boot({ fixture: 'honorarios_fuentes' });
  const { page } = h;

  // ================================================================ 1. Pestaña de cada fuente: tarjetas y filas
  for (const f of FUENTES) {
    await clickTab(page, 'of-' + f.key);
    const tj = await leerTarjetas(page, f.key);
    for (const vista of ['real', 'proy', 'total']) {
      const b = esp[f.key].suma[vista], suf = SUF[vista];
      const lee = (rot) => clp((tj[vista][`${rot === 'Ingreso' && f.key === 'asignacion_familiar' ? 'Ingreso Percibido' : rot} (${suf})`] || {}).valor);
      t.eq([lee('Ingreso'), lee('Gasto Remuneraciones'), lee('Gasto Honorarios'), lee('Gasto Bienes y Servicios'), lee('Gasto Total'), lee('Saldo')],
        [b.ingreso, b.rem, b.hon, b.bys, b.gasto, b.saldo], `${f.key} · tarjetas ${suf}: Ingreso, Rem., Honorarios, B&S, Gasto Total y Saldo = cálculo independiente`);
      t.eq(b.gasto, b.rem + b.hon + b.bys, `${f.key} · ${suf}: gasto total = remuneraciones + honorarios + B&S (sin 70/30)`);
    }
    if (f.key !== 'recuperacion_llmm') t.ok(/Honorarios/.test((tj.total['Gasto Total (Total)'] || {}).nota), `${f.key}: la nota del Gasto Total dice «Remuneraciones + Honorarios + Bienes y Servicios»`, (tj.total['Gasto Total (Total)'] || {}).nota);
    if (f.key !== 'recuperacion_llmm') t.ok(new RegExp(`${esp[f.key].suma.nDeficit} de ${esp[f.key].suma.nEntidades} entidades en déficit`).test((tj.total['Saldo (Total)'] || {}).nota), `${f.key}: «${esp[f.key].suma.nDeficit} de ${esp[f.key].suma.nEntidades} entidades en déficit» (con los honorarios dentro del saldo)`, (tj.total['Saldo (Total)'] || {}).nota);
    const filas = await leerFilas(page, f.key);
    const malas = [];
    Object.entries(esp[f.key].porId).forEach(([id, e]) => {
      const r = filas[id];
      if (!r) { malas.push(id + ' (sin fila)'); return; }
      const ok = clp(r.ingreso) === e.total.ingreso && clp(r.rem) === e.total.rem && clp(r.hon) === e.total.hon && clp(r.bys) === e.total.bys && clp(r.gasto) === e.total.gasto && clp(r.saldo) === e.total.saldo
        && r.estado === (e.estado === 'deficit' ? 'Déficit' : 'Superávit');
      if (!ok) malas.push(`${id}: ${JSON.stringify(r)} ≠ ${JSON.stringify(e.total)} ${e.estado}`);
    });
    t.ok(!malas.length, `${f.key}: cada fila (${Object.keys(esp[f.key].porId).length} entidades) = cálculo independiente en Ingreso, Rem., Honorarios, B&S, Gasto Total, Saldo y Estado`, malas.slice(0, 4));
    // vista Real / Proyectado de la tabla
    for (const vista of ['real', 'proy']) {
      await page.click(`#tab-of-${f.key} .of-chip[data-of-vista="${vista}"]`);
      await h.waitIdle();
      const fv = await leerFilas(page, f.key);
      const malasV = Object.entries(esp[f.key].porId).filter(([id, e]) => clp(fv[id].hon) !== e[vista].hon || clp(fv[id].gasto) !== e[vista].gasto || clp(fv[id].saldo) !== e[vista].saldo).map(([id]) => id);
      t.ok(!malasV.length, `${f.key} · vista ${vista}: «Gasto Honorarios», Gasto Total y Saldo de cada fila = cálculo independiente (boletas Real, proyección Proyectado)`, malasV.slice(0, 4));
    }
    await page.click(`#tab-of-${f.key} .of-chip[data-of-vista="total"]`);
    await h.waitIdle();
  }
  // las boletas son Real aunque su mes sea posterior al corte; la proyección es Proyectada aunque su mes sea anterior
  const eJ = esp.junji.porId['5402002'];
  t.eq([eJ.real.hon, eJ.proy.hon], [eJ.hon.boletas, eJ.hon.proy], 'JUNJI 5402002 (Real hasta julio): Honorarios Real = TODAS las boletas (también la de octubre) y Proyectado = la proyección');
  t.ok(eJ.hon.boletas === 300000 + 250000 + 120000 + 80000 + 60000 + 55000 + 20000, 'cálculo independiente de las boletas de JUNJI 5402002 (sin la de concepto vacío ni la de fecha inválida; la de 2025 cuenta)');

  // ================================================================ 2. JUNJI: los honorarios NO entran en el saldo de Operación para B&S
  const op = { '5401003': esp.junji.porId['5401003'], '5401005': esp.junji.porId['5401005'], '5401002': esp.junji.porId['5401002'] };
  t.eq([op['5401003'].total.saldo, op['5401003'].saldoOp, op['5401003'].estado, op['5401003'].causas], [-600000, 1700000, 'deficit', ['saldo']], '5401003: honorarios 1.800.000 → saldo total -600.000 y Déficit SOLO por el saldo total (Operación − B&S = +1.700.000)');
  t.eq([op['5401005'].total.saldo, op['5401005'].saldoOp, op['5401005'].estado], [4800000, 600000, 'superavit'], '5401005: honorarios 700.000 financiados por Homologación: Superávit (si se descontaran de Operación daría -100.000 → Déficit)');
  t.eq([op['5401002'].saldoOp, op['5401002'].estado, op['5401002'].causas], [-500000, 'deficit', ['operacion_bys']], '5401002: los honorarios 1.000.000 no tocan el saldo de Operación (-500.000): Déficit solo por Operación');
  await clickTab(page, 'JUNJI');
  const fj = await leerFilas(page, 'junji');
  t.eq([fj['5401003'].estado, fj['5401005'].estado, fj['5401002'].estado], ['Déficit', 'Superávit', 'Déficit'], 'JUNJI en pantalla: Estado de 5401003 (Déficit por saldo total), 5401005 (Superávit) y 5401002 (Déficit por Operación)');
  const causas = await page.evaluate(() => { const o = {}; document.querySelectorAll('#otrasFuentesTbody-junji tr[data-rbd]').forEach(tr => { const c = tr.querySelector('.estado-causa'); o[tr.dataset.rbd] = c ? c.textContent.trim() : ''; }); return o; });
  t.eq([causas['5401003'], causas['5401005'], causas['5401002']], ['', '', 'Saldo Operación para B&S negativo'], 'el aviso «Saldo Operación para B&S negativo» solo sale donde interviene Operación (no por los honorarios)');
  // ================================================================ 3. Panel principal
  await clickTab(page, 'SEP');
  const T = await tarjetas(page, '#kpiRow'), R = await tarjetas(page, '#kpiRowReal'), P = await tarjetas(page, '#kpiRowProy');
  const sep = {
    total: { rem: leerCLP(T['Gasto Remuneraciones (a Diciembre)']), hon: leerCLP(T['Gasto Honorarios (a Diciembre)']), bys: leerCLP(T['Gasto Bienes y Servicios (a Diciembre)']), saldo: leerCLP(T['Saldo (a Diciembre)']) },
    real: { rem: leerCLP(R['Gasto Remuneraciones (Real)']), hon: leerCLP(R['Gasto Honorarios (Real)']), bys: leerCLP(R['Gasto Bienes y Servicios (Real)']), saldo: leerCLP(R['Saldo (Real)']) },
    proy: { rem: leerCLP(P['Gasto Remuneraciones (Proyectado)']), hon: leerCLP(P['Gasto Honorarios (Proyectado)']), bys: leerCLP(P['Gasto Bienes y Servicios (Proyectado)']), saldo: leerCLP(P['Saldo (Proyectado)']) },
  };
  Object.values(sep).forEach(v => { v.gasto = v.rem + v.hon + v.bys; });
  t.eq([sep.real.hon, sep.proy.hon], [honSep.bol, honSep.proy], 'SEP sigue igual: honorarios Real = boletas y Proyectado = proyección');
  await clickTab(page, 'Panel principal');
  for (const vista of ['total', 'real', 'proy']) {
    await dashVista(h, vista);
    const tj = await tarjetasDash(page);
    const malas = [];
    FUENTES.forEach(f => {
      const b = esp[f.key].suma[vista], c = tj[f.key];
      if (c.ingreso !== b.ingreso || c.rem !== b.rem || c.hon !== b.hon || c.bys !== b.bys || c.gasto !== b.gasto || c.saldo !== b.saldo) malas.push(`${f.key}: ${JSON.stringify(c)} ≠ ${JSON.stringify(b)}`);
      if (!new RegExp(`${esp[f.key].suma.nDeficit} de ${esp[f.key].suma.nEntidades} entidades en déficit`).test(c.def)) malas.push(`${f.key} déficit: ${c.def}`);
    });
    t.ok(!malas.length, `Panel principal (${vista}): la tarjeta de cada fuente tiene el mismo ingreso, rem., honorarios, B&S, gasto y saldo que su pestaña y que el cálculo independiente`, malas.slice(0, 3));
    t.eq([tj.sep.hon, tj.sep.gasto, tj.sep.saldo], [sep[vista].hon, sep[vista].gasto, sep[vista].saldo], `Panel principal (${vista}): la tarjeta SEP = la pestaña SEP`);
    const s = await strip(page);
    const lee = (r) => leerCLP(s[r] || s[r.toUpperCase()]);
    const gastoStrip = lee('Gasto Total');
    t.eq(gastoStrip, sumaTarjetas(tj, 'gasto'), `Panel principal (${vista}): el «Gasto Total» de la franja es la suma del gasto de las tarjetas (SEP y las 12 fuentes)`);
    t.eq(lee('Gasto Remuneraciones') + lee('Gasto Honorarios (Subt. 21)') + lee('Gasto Bienes y Servicios'), gastoStrip, `Panel principal (${vista}): Remuneraciones + Honorarios + B&S = Gasto Total en la franja`);
    const honEsp = vista === 'total' ? honSep.bol + honSep.proy + honFuentes : (vista === 'real' ? honSep.bol + FUENTES.reduce((x, f) => x + esp[f.key].suma.real.hon, 0) : honSep.proy + FUENTES.reduce((x, f) => x + esp[f.key].suma.proy.hon, 0));
    t.eq(lee('Gasto Honorarios (Subt. 21)'), honEsp, `Panel principal (${vista}): «Gasto Honorarios» de la franja = honorarios de SEP + de las 12 fuentes`);
    t.ok(/SEP \+ 12 fuentes/.test(await page.evaluate(() => Array.from(document.querySelectorAll('#dashStrip .dash-tile')).find(x => /Honorarios/i.test(x.querySelector('.t-label').textContent)).querySelector('.t-sub').textContent)), `Panel principal (${vista}): la tile de honorarios ya no dice «solo SEP»`);
    t.eq(sumaTarjetas(tj, 'saldo'), lee('Saldo consolidado'), `Panel principal (${vista}): el saldo consolidado es la suma de los saldos de las tarjetas`);
    const m = await filaMensualTotal(page);
    t.eq([leerCLP(m.gas), leerCLP(m.saldo)], [gastoStrip, lee('Saldo consolidado')], `Panel principal (${vista}): la evolución mensual suma el mismo gasto total y saldo que la franja`);
    // gráfico apilado: cada fila lleva sus honorarios y el segmento «Honorarios»
    const apilado = await page.evaluate(() => Array.from(document.querySelectorAll('#dashChartComp .dash-bar-row')).map(r => ({ f: r.dataset.dashFuente, segs: Array.from(r.querySelectorAll('.seg')).map(s => s.dataset.dashSeg), label: r.getAttribute('aria-label') })));
    const conHon = (k) => esp[k] ? esp[k].suma[vista].hon > 0 : sep[vista].hon > 0;
    const malasApil = apilado.filter(a => a.segs.includes('hon') !== conHon(a.f)).map(a => a.f);
    t.ok(!malasApil.length, `Panel principal (${vista}): el gráfico apilado muestra el segmento «Honorarios» exactamente en las fuentes que tienen honorarios`, malasApil);
    if (vista === 'total') {
      const tabla = await page.evaluate(() => Array.from(document.querySelectorAll('#dashTablaFuentesBody tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
      const malasT = FUENTES.filter(f => { const fila = tabla.find(r => r[0] === f.corto); return !fila || leerCLP(fila[3]) !== esp[f.key].suma.total.hon; }).map(f => f.key);
      t.ok(!malasT.length, 'la tabla «por fuente» tiene la columna «Honorarios (Subt. 21)» de cada fuente = cálculo independiente', malasT);
      // «Atención»: entidades en Déficit de cada fuente con su saldo (con los honorarios dentro)
      const at = await page.evaluate(() => Array.from(document.querySelectorAll('#dashAtencion li[data-atencion-rbd]')).map(li => ({ f: li.dataset.atencionFuente, id: li.dataset.atencionRbd, saldo: li.querySelector('.a-saldo').textContent.trim() })));
      const malasA = at.filter(a => a.f !== 'sep' && (!esp[a.f].porId[a.id] || '▼ ' + clp(a.saldo.replace('▼ ', '')) !== '▼ ' + esp[a.f].porId[a.id].total.saldo || esp[a.f].porId[a.id].estado !== 'deficit')).map(a => `${a.f} ${a.id} ${a.saldo}`);
      t.ok(!malasA.length, '«Atención» (Total): toda entidad de una fuente que aparece está en Déficit y con el saldo del cálculo independiente', malasA.slice(0, 4));
      const saldos = at.map(a => leerCLP(a.saldo));
      t.eq(saldos, saldos.slice().sort((x, y) => x - y), '«Atención»: ordenada por saldo, la más negativa primero');
      const nTotal = tj.sep.def.match(/^(\d+) de/) ? Number(tj.sep.def.match(/^(\d+) de/)[1]) + FUENTES.reduce((n, f) => n + esp[f.key].suma.nDeficit, 0) : -1;
      t.ok(new RegExp(`— ${nTotal} en total`).test(await page.evaluate(() => document.getElementById('dashNotaAtencion').textContent)), `«Atención» cuenta ${nTotal} entidades en Déficit entre SEP y las 12 fuentes (con los honorarios dentro de cada saldo)`);
    }
  }
  await dashVista(h, 'total');
  const totalDash = leerCLP((await strip(page))['Gasto Total'] || (await strip(page))['GASTO TOTAL']);

  // ================================================================ 4. % Ejecución: cada fuente, una entidad y el Consolidado
  await clickTab(page, '% Ejecución');
  const leerEjec = () => page.evaluate(() => Array.from(document.querySelectorAll('#ejecTbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
  const sumaCol = (filas, i) => filas.reduce((s, f) => s + leerCLP(f[i]), 0);
  const EJEC_COLS = { ing: 2, rem: 3, hon: 6, bys: 9 };
  t.eq(await page.evaluate(() => 0), 0, 'sanity');
  for (const f of FUENTES.filter(x => x.key !== 'recuperacion_llmm')) { // Recuperación LLMM es solo de ingresos: no tiene % de ejecución
    await page.click(`#ejecFuenteChips .of-chip[data-ejec-fuente="${f.key}"]`);
    await h.waitIdle();
    const th = await page.evaluate(() => Array.from(document.querySelectorAll('#ejecTable thead th')).map(x => x.textContent.trim()));
    t.eq(th, ['Mes', 'Tipo', 'Ingreso (mes)', 'Gasto Rem. (mes)', 'Δ vs mes ant.', '% Ejec. Rem. acum.', 'Gasto Hon. (mes)', 'Δ vs mes ant.', '% Ejec. Hon. acum.', 'Gasto B&S (mes)', 'Δ vs mes ant.', '% Ejec. B&S acum.', '% Ejec. Total acum.'], `% Ejecución ${f.key}: la tabla trae Gasto Hon. (mes), Δ y % Ejec. Hon. acum.`);
    const filas = await leerEjec();
    const sm = serieMensual(docs, f.key);
    t.eq(filas.map(r => leerCLP(r[EJEC_COLS.hon])), sm.hon.real.map((v, i) => v + sm.hon.proy[i]), `% Ejecución ${f.key}: «Gasto Hon. (mes)» mes a mes = boletas (por Fecha Documento) + proyección del cálculo independiente`);
    t.eq([sumaCol(filas, 3), sumaCol(filas, 6), sumaCol(filas, 9)], [esp[f.key].suma.total.rem, esp[f.key].suma.total.hon, esp[f.key].suma.total.bys], `% Ejecución ${f.key}: los 12 meses suman las mismas remuneraciones, honorarios y B&S que la pestaña`);
    const ultima = filas[11];
    const ingAnual = esp[f.key].suma.total.ingreso;
    t.eq(ultima[12], ingAnual > 0 ? (esp[f.key].suma.total.gasto / ingAnual * 100).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—', `% Ejecución ${f.key}: el % Total acumulado a diciembre = gasto total (rem + hon + B&S) / ingreso anual`);
    const kpi = await page.evaluate(() => Array.from(document.querySelectorAll('#ejecKpiRow .kpi-card')).map(c => c.querySelector('.label').textContent.trim()));
    t.eq(kpi.length, 8, `% Ejecución ${f.key}: 8 tarjetas (Rem., Honorarios, B&S y Total × Real y a diciembre)`);
    t.ok(kpi.includes('% Ejec. Honorarios — Real') && kpi.includes('% Ejec. Honorarios — Real+Proy a diciembre'), `% Ejecución ${f.key}: tarjetas de Honorarios`);
    t.eq(await page.evaluate(() => [document.getElementById('ejecToggleHonWrap').hidden, document.getElementById('ejecShowHon').checked]), [false, true], `% Ejecución ${f.key}: la serie «Honorarios (Subt. 21)» tiene su casilla y está activa`);
    t.eq(await page.evaluate(() => document.querySelectorAll('#ejecChartWrap svg polyline.ejec-series-line').length > 0), true, `% Ejecución ${f.key}: el gráfico dibuja líneas`);
  }
  // una entidad (JUNJI 5402002 y General 1121) y el filtro de la casilla
  await page.click('#ejecFuenteChips .of-chip[data-ejec-fuente="junji"]');
  await page.selectOption('#ejecRbdSelect', '5402002');
  await h.waitIdle();
  let filasE = await leerEjec();
  const sj = serieMensual(docs, 'junji', '5402002');
  t.eq(filasE.map(r => leerCLP(r[6])), sj.hon.real.map((v, i) => v + sj.hon.proy[i]), '% Ejecución JUNJI / 5402002: honorarios mes a mes de esa entidad (octubre, después del corte, es Real; la proyección, Proyectada)');
  t.eq(filasE.map(r => leerCLP(r[3])), sj.rem.real.map((v, i) => v + sj.rem.proy[i]), '… y sus remuneraciones');
  const polilineas = (idHon) => page.evaluate(() => document.querySelectorAll('#ejecChartWrap svg polyline.ejec-series-line').length);
  const n3 = await polilineas();
  await page.evaluate(() => { const c = document.getElementById('ejecShowHon'); c.checked = false; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await h.waitIdle();
  t.ok((await polilineas()) < n3, 'desmarcar «Honorarios (Subt. 21)» quita su línea del gráfico (tercera serie)');
  await page.evaluate(() => { const c = document.getElementById('ejecShowHon'); c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.selectOption('#ejecRbdSelect', '');
  // Consolidado: SEP + las 12 fuentes; el Total es EXACTAMENTE el del Panel principal
  await page.click('#ejecFuenteChips .of-chip[data-ejec-fuente="consolidado"]');
  await h.waitIdle();
  filasE = await leerEjec();
  const honConsol = honSep.bol + honSep.proy + honFuentes;
  t.eq(sumaCol(filasE, 6), honConsol, '% Ejecución Consolidado: «Gasto Hon. (mes)» suma los honorarios de SEP y de las 12 fuentes');
  const remConsol = sep.total.rem + FUENTES.reduce((s, f) => s + esp[f.key].suma.total.rem, 0), bysConsol = sep.total.bys + FUENTES.reduce((s, f) => s + esp[f.key].suma.total.bys, 0);
  t.eq([sumaCol(filasE, 3), sumaCol(filasE, 9)], [remConsol, bysConsol], '% Ejecución Consolidado: remuneraciones y B&S = SEP + las 12 fuentes');
  t.eq(sumaCol(filasE, 3) + sumaCol(filasE, 6) + sumaCol(filasE, 9), totalDash, '% Ejecución Consolidado: rem + hon + B&S a diciembre = el «Gasto Total» de la franja del Panel principal');
  const kc = await page.evaluate(() => Array.from(document.querySelectorAll('#ejecKpiRow .kpi-card')).map(c => ({ l: c.querySelector('.label').textContent.trim(), d: c.querySelector('.delta').textContent.trim() })));
  const anual = kc.find(k => k.l === '% Ejec. Total — Real+Proy a diciembre');
  t.ok(anual.d.startsWith('Rem. + Hon. + B&S a diciembre') && anual.d.includes(fmt(totalDash)), 'Consolidado: la tarjeta del Total dice «Rem. + Hon. + B&S» con el mismo monto que la franja', anual.d);
  t.ok(/Honorarios \(Subt\. 21\)/.test(await page.evaluate(() => document.getElementById('ejecCorteNota').textContent)), 'Consolidado: la nota aclara cómo se tratan los honorarios');

  // ================================================================ 5. Reportes: Visualizador y Reporte personalizado
  await clickTab(page, 'Reportes');
  await page.click('#vzFuentesNinguna');
  const porFuente = {};
  for (const f of [{ key: 'sep' }, ...FUENTES]) {
    await page.click('#vzFuentesNinguna');
    await page.click(`#vzFuenteChips [data-vz-fuente="${f.key}"]`);
    await h.waitIdle();
    const gas = (await vzTotales(page, 'vzBodyGas')).map(leerCLP);
    const b = f.key === 'sep' ? sep : { real: esp[f.key].suma.real, proy: esp[f.key].suma.proy, total: esp[f.key].suma.total };
    t.eq(gas, [b.real.gasto, b.proy.gasto, b.total.gasto], `Visualizador (${f.key}): Total Gastos Real / Proyectado / Total = los de su pestaña (con los honorarios dentro)`);
    porFuente[f.key] = gas;
    if (f.key !== 'sep') {
      await page.click('#vzExpGas');
      const nodos = await page.evaluate(() => Array.from(document.querySelectorAll('#vzBodyGas tr.vz-row')).map(tr => ({ n: tr.querySelector('.vz-name').textContent.trim().replace(/^[▸▾]\s*/, ''), real: tr.children[1].textContent.trim(), proy: tr.children[2].textContent.trim() })));
      const nHon = nodos.find(n => n.n === 'Honorarios (Subt. 21)'), nProy = nodos.find(n => n.n === 'Honorarios — Proyección');
      t.eq([nHon ? leerCLP(nHon.real) : 0, nProy ? leerCLP(nProy.proy) : 0], [esp[f.key].suma.real.hon, esp[f.key].suma.proy.hon], `Visualizador (${f.key}): tercera serie «Honorarios (Subt. 21)» (real) y «Honorarios — Proyección» (proyectada) = el cálculo independiente`);
      t.ok(!nodos.some(n => /^Honorarios/.test(n.n)) || (nHon || nProy), 'sanity');
    }
  }
  // todas las fuentes + SEP juntas
  await page.click('#vzFuentesTodas');
  await h.waitIdle();
  const gasTodas = (await vzTotales(page, 'vzBodyGas')).map(leerCLP);
  t.eq(gasTodas[2], totalDash, 'Visualizador (todas las fuentes): Total Gastos = el «Gasto Total» de la franja del Panel principal');
  t.eq(gasTodas[0] + gasTodas[1], gasTodas[2], 'Visualizador (todas): Real + Proyectado = Total');
  await page.click('#vzAgruparChips [data-vz-agrupar="codigo"]');
  await h.waitIdle();
  t.eq((await vzTotales(page, 'vzBodyGas')).map(leerCLP), gasTodas, 'Visualizador por código: los mismos totales');
  const textoGas = await page.evaluate(() => document.getElementById('vzBodyGas').innerText);
  t.ok(/Honorarios \(Subt\. 21\)/.test(textoGas) && /Honorarios — Proyección/.test(textoGas), 'Visualizador por código: los grupos de honorarios consolidan cuentas y conceptos de todas las fuentes');
  await page.click('#vzAgruparChips [data-vz-agrupar="fuente"]');
  // Reporte personalizado: conceptos nuevos de honorarios por fuente
  await page.click('#reporteVistaChips [data-reporte-vista="personalizado"]');
  await h.waitIdle();
  const catalogo = await page.evaluate(() => Array.from(document.querySelectorAll('#reporteConceptoList input[data-concepto-check]')).map(e => e.dataset.conceptoCheck));
  for (const f of FUENTES) {
    const lleva = f.key !== 'recuperacion_llmm'; // Recuperación LLMM es solo de ingresos: su catálogo NO ofrece honorarios
    t.eq(catalogo.includes(`of|${f.key}|hon`) && catalogo.includes(`of|${f.key}|hon_proy`), lleva, `Reporte personalizado: el catálogo de ${f.key} ${lleva ? 'trae «Honorarios (Subt. 21) — boletas» y «Honorarios (Proyección) — total»' : 'no ofrece honorarios (fuente solo de ingresos)'}`);
  }
  t.ok(catalogo.includes('of|general|hon_item|410803') && catalogo.includes('of|junji|hon_item|Apoyo pedagógico') && catalogo.includes('of|junji|hon_proy_item|Taller de música'), 'Reporte personalizado: una línea por cuenta (General) y por concepto (JUNJI), también en la proyección');
  await page.click('#reporteRbdNinguno');
  await page.click('#reporteConceptoNinguno');
  const marcar = (sel, v) => page.evaluate(([s, val]) => { const el = document.querySelector(s); if (!el) return false; el.checked = val; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }, [sel, v]);
  const casosRep = [['general', '1121'], ['general', 'AC'], ['pie', '1121'], ['mantenimiento', '1121'], ['prorretencion', '1121'], ['junji', '5402002'], ['faep', '1121'], ['faep', 'AC'], ['faep', '5402002'], ['figa', '1121'], ['aporte_educ', 'AC'], ['aporte_junji', '5402002']];
  await page.evaluate(() => { document.querySelectorAll('#reporteConceptoList details').forEach(d => { d.open = true; }); });
  for (const id of new Set(casosRep.map(c => c[1]))) await marcar(`#reporteRbdList input[data-rbd-check="${id}"]`, true);
  for (const f of new Set(casosRep.map(c => c[0]))) { await marcar(`#reporteConceptoList input[data-concepto-check="of|${f}|hon"]`, true); await marcar(`#reporteConceptoList input[data-concepto-check="of|${f}|hon_proy"]`, true); }
  await h.waitIdle();
  const filasRep = await page.evaluate(() => Array.from(document.querySelectorAll('#reporteTbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
  const totalDe = (rbd, etiqueta) => { const fl = filasRep.find(r => r[0] === rbd && r[2] === etiqueta); return fl ? leerCLP(fl[fl.length - 1]) : null; };
  const malRep = [];
  casosRep.forEach(([fk, id]) => {
    const pre = `[${({ general: 'Subv. General', pie: 'PIE', mantenimiento: 'Mantenimiento', prorretencion: 'Pro-Retención', junji: 'JUNJI', faep: 'FAEP', figa: 'FIGA', aporte_educ: 'Aporte Fiscal Educ.', aporte_junji: 'Aporte Fiscal JUNJI' })[fk]}]`;
    const e = esp[fk].porId[id].hon;
    const a = totalDe(id, `${pre} Honorarios (Subt. 21) — boletas`), b = totalDe(id, `${pre} Honorarios (Proyección) — total`);
    // una entidad aparece una vez por fuente: se busca por etiqueta y fuente
    if (a !== null && a !== Math.round(e.boletas)) malRep.push([fk, id, 'boletas', a, e.boletas]);
    if (b !== null && b !== Math.round(e.proy)) malRep.push([fk, id, 'proy', b, e.proy]);
    if (a === null && e.boletas) malRep.push([fk, id, 'boletas sin fila', a, e.boletas]);
  });
  t.ok(!malRep.length, 'Reporte personalizado: por entidad, «Honorarios (Subt. 21) — boletas» y «Honorarios (Proyección) — total» de cada fuente = cálculo independiente', malRep.slice(0, 5));
  t.eq(await page.evaluate(() => {
    const fila = (c) => Array.from(document.querySelectorAll('#reporteTbody tr')).find(tr => tr.children[0].textContent.trim() === '5402002' && tr.children[2].textContent.trim() === c);
    const clases = (tr) => tr ? Array.from(tr.querySelectorAll('td.num')).slice(0, 12).map(td => td.classList.contains('mes-real') ? 'R' : (td.classList.contains('mes-proy') ? 'P' : '-')).join('') : null;
    return [clases(fila('[JUNJI] Honorarios (Subt. 21) — boletas')), clases(fila('[JUNJI] Honorarios (Proyección) — total'))];
  }), ['RRRRRRRRRRRR', 'PPPPPPPPPPPP'], 'Reporte personalizado: las boletas son «real» en los 12 meses (aunque el corte sea julio) y la proyección «proyectada»');
  t.noErrores(h);
  await h.close();

  // ================================================================ 6. SIN honorarios cargados: las cifras no cambian
  const h2 = await boot({ fixture: 'compras_conceptos' });
  const docs2 = docsDe('compras_conceptos');
  const malas0 = [];
  for (const f of FUENTES) {
    await h2.clickTab('of-' + f.key);
    const e = fuenteEsperada(docs2, f.key);
    const tj = await leerTarjetas(h2.page, f.key);
    for (const vista of f.key === 'recuperacion_llmm' ? [] : ['real', 'proy', 'total']) {
      const suf = SUF[vista];
      if (clp(tj[vista][`Gasto Honorarios (${suf})`].valor) !== 0) malas0.push(`${f.key} ${vista}: honorarios ≠ $0`);
      if (clp(tj[vista][`Gasto Total (${suf})`].valor) !== e.suma[vista].rem + e.suma[vista].bys) malas0.push(`${f.key} ${vista}: gasto ≠ rem + B&S`);
      if (clp(tj[vista][`Saldo (${suf})`].valor) !== e.suma[vista].ingreso - e.suma[vista].rem - e.suma[vista].bys) malas0.push(`${f.key} ${vista}: saldo`);
    }
    const filas = await leerFilas(h2.page, f.key);
    Object.entries(e.porId).forEach(([id, en]) => { if (clp(filas[id].hon) !== 0 || clp(filas[id].gasto) !== en.total.rem + en.total.bys || filas[id].estado !== (en.estado === 'deficit' ? 'Déficit' : 'Superávit')) malas0.push(`${f.key} ${id}`); });
  }
  t.ok(!malas0.length, 'sin honorarios cargados: «Gasto Honorarios» = $0 en las 12 fuentes y el gasto, el saldo y el Estado son los de siempre (remuneraciones + B&S)', malas0.slice(0, 5));
  t.noErrores(h2);
  await h2.close();

  // ================================================================ 7. JUNJI en vivo: el saldo de Operación para B&S no cambia al agregar honorarios (el saldo total y el Estado sí)
  const h3 = await boot({ fixture: 'honorarios_fuentes' });
  await clickTab(h3.page, 'JUNJI');
  // en el modal: el saldo de Operación no cambia al agregar honorarios (en vivo) mientras el saldo total y el Estado sí
  await abrirModal(h3, 'junji', '5401005');
  const leerOp = () => h3.page.evaluate(() => ({ op: document.getElementById('ofsaldoopbys-5401005-junji').textContent.trim(), sub: document.getElementById('otrasFuentesModalSubtitle').textContent.replace(/\s+/g, ' ').trim() }));
  const antes = await leerOp();
  t.eq(clp(antes.op), 600000, 'modal 5401005: «Saldo Operación disponible para B&S» = +600.000');
  await llenarFormHonOF(h3.page, { concepto: 'Apoyo pedagógico', tipoDocumento: 'BOLHE', fechaDocumento: '2026-02-10', montoGasto: '5000000' });
  await h3.page.click('#otrasFuentesModalBody .hon-form-grid .add-hon-btn');
  await h3.flushWrites(); await h3.waitIdle();
  const despues = await leerOp();
  t.eq(clp(despues.op), 600000, 'tras agregar $5.000.000 de honorarios el saldo de Operación para B&S NO cambia (+600.000)');
  t.ok(/DÉFICIT/i.test(despues.sub) && /Saldo: -\$200\.000/.test(despues.sub), 'pero el saldo total pasa a -$200.000 y la entidad a Déficit (por el saldo total)', despues.sub);
  await cerrarModal(h3);
  t.ok(/saldo total es negativo/.test(await h3.page.evaluate(() => document.querySelector('#otrasFuentesTbody-junji tr[data-rbd="5401005"] .tag').getAttribute('title') || '')), 'el tooltip del Estado dice «el saldo total es negativo»');
  t.noErrores(h3);
  await h3.close();
});
