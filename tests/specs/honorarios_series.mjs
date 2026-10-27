// Honorarios (PR-3) · la tercera serie «Honorarios (Subt. 21)» en los gráficos y listados (fixture `honorarios_fuentes`):
//   · % Ejecución de cada fuente y del Consolidado: casilla, línea (color propio), leyenda del PDF, tooltip, columna y tarjetas; SEP sigue midiendo «Personal» (Rem.+Hon.) sin la casilla;
//   · Panel principal: gráfico apilado (segmento «Honorarios» proporcional, tooltip y etiqueta accesible), tabla «por fuente» y evolución mensual = el mismo gasto mes a mes que el cálculo independiente;
//   · Visualizador: el grupo «Honorarios (Subt. 21)» y «Honorarios — Proyección» por fuente y por código (cuentas y conceptos), CSV con sus líneas (real / proyectado);
//   · Reporte personalizado: los conceptos nuevos por fuente y por cuenta / concepto, con su CSV.
import { boot, clickTab } from '../lib/boot.mjs';
import { capturarDescarga, parseCsvPuntoYComa } from '../lib/capture-utils.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { docsDe } from '../lib/corte.mjs';
import { leerCLP } from '../lib/honorarios.mjs';
import { FUENTES, MESES, fuenteEsperada, serieMensual, honFuenteDe, esConcepto, fmt } from '../lib/honorarios_fuentes.mjs';

const CORTO = { general: 'Subv. General', pie: 'PIE', mantenimiento: 'Mantención', prorretencion: 'Pro-Retención', junji: 'JUNJI', faep: 'FAEP', figa: 'FIGA', aporte_educ: 'Aporte Fiscal Educ.', aporte_junji: 'Aporte Fiscal JUNJI' };
const num = (v) => Math.round(v);

await correrSpec('honorarios_series', async (t) => {
  const docs = docsDe('honorarios_fuentes');
  const esp = {};
  FUENTES.forEach(f => { esp[f.key] = fuenteEsperada(docs, f.key); });
  const h = await boot({ fixture: 'honorarios_fuentes' });
  const { page } = h;

  // ================================================================ 1. % Ejecución: la tercera serie
  await clickTab(page, '% Ejecución');
  await page.click('#ejecFuenteChips .of-chip[data-ejec-fuente="faep"]');
  await h.waitIdle();
  const lineas = () => page.evaluate(() => Array.from(document.querySelectorAll('#ejecChartWrap svg polyline.ejec-series-line:not(.proy)')).map(p => p.getAttribute('style')));
  const estilos = await lineas();
  t.eq(estilos.length, 4, '% Ejecución FAEP: 4 líneas (Remuneraciones, Honorarios, B&S y Total)');
  t.ok(estilos.some(s => /var\(--series-hon\)/.test(s)), 'la línea de Honorarios tiene su color propio (--series-hon)');
  t.eq(await page.evaluate(() => [document.getElementById('ejecToggleHonWrap').textContent.trim(), document.querySelector('#ejecToggleHonWrap .ejec-legend-dot').getAttribute('style')]), ['Honorarios (Subt. 21)', 'background:var(--series-hon)'], 'casilla «Honorarios (Subt. 21)» con su punto de leyenda');
  t.eq(await page.evaluate(() => document.getElementById('ejecToggleTotalWrap').textContent.trim()), 'Total (Rem. + Hon. + B&S)', 'la casilla del Total se llama «Total (Rem. + Hon. + B&S)»');
  // tooltip del gráfico
  const tt = await page.evaluate(() => { const col = document.querySelectorAll('#ejecChartWrap .ejec-hit-col')[7]; col.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true })); return document.getElementById('ejecTooltip').innerText.replace(/\s+/g, ' '); });
  t.ok(/Honorarios \(Subt\. 21\): [\d,]+% acum\./.test(tt) && /Remuneraciones:/.test(tt) && /Bienes y Servicios:/.test(tt) && /Total:/.test(tt), 'tooltip de un mes: Remuneraciones, Honorarios, B&S y Total', tt);
  // la serie coincide con el cálculo independiente: % acumulado de honorarios a diciembre
  const sm = serieMensual(docs, 'faep');
  const honAnual = sm.hon.real.reduce((a, b) => a + b, 0) + sm.hon.proy.reduce((a, b) => a + b, 0);
  const ingAnual = esp.faep.suma.total.ingreso;
  const ult = await page.evaluate(() => Array.from(document.querySelectorAll('#ejecTbody tr')).pop().children[8].textContent.trim());
  t.eq(ult, (honAnual / ingAnual * 100).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%', '% Ejec. Hon. acumulado a diciembre = honorarios / ingreso anual (cálculo independiente)');
  // desmarcar las otras series deja solo la de honorarios; desmarcar honorarios la quita
  const toggle = (id, v) => page.evaluate(([i, val]) => { const c = document.getElementById(i); c.checked = val; c.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  for (const id of ['ejecShowRem', 'ejecShowBys', 'ejecShowTotal']) await toggle(id, false);
  await h.waitIdle();
  t.eq((await lineas()).length, 1, 'con solo «Honorarios» marcado el gráfico dibuja 1 línea');
  await toggle('ejecShowHon', false);
  await h.waitIdle();
  t.eq((await lineas()).length, 0, 'sin ninguna serie no hay líneas');
  for (const id of ['ejecShowRem', 'ejecShowBys', 'ejecShowTotal', 'ejecShowHon']) await toggle(id, true);
  await h.waitIdle();
  // PDF de % Ejecución: leyenda con la serie
  await page.evaluate(() => { window.__prints = []; });
  await page.click('#ejecPdfBtn');
  const pr = await h.prints();
  t.ok(/Honorarios \(Subt\. 21\)/.test(pr[0] && pr[0].printWrap) && /Total \(Rem\. \+ Hon\. \+ B&S\)/.test(pr[0] && pr[0].printWrap), 'PDF de % Ejecución: la leyenda trae «Honorarios (Subt. 21)» y «Total (Rem. + Hon. + B&S)»', (pr[0] || {}).printWrap && pr[0].printWrap.slice(0, 300));
  // SEP: sin casilla de honorarios (sigue «Personal» = Rem. + Hon.)
  await page.click('#ejecFuenteChips .of-chip[data-ejec-fuente="sep"]');
  await h.waitIdle();
  t.eq(await page.evaluate(() => [document.getElementById('ejecToggleHonWrap').hidden, document.getElementById('ejecLblRem').textContent, document.querySelectorAll('#ejecKpiRow .kpi-card').length]), [true, 'Personal (Remuneraciones + Honorarios)', 4], '% Ejecución SEP: sin casilla de honorarios, serie «Personal (Remuneraciones + Honorarios)» y 4 tarjetas (sin cambio)');
  // Consolidado: la serie suma SEP y las 9 fuentes
  await page.click('#ejecFuenteChips .of-chip[data-ejec-fuente="consolidado"]');
  await h.waitIdle();
  t.eq((await lineas()).length, 4, '% Ejecución Consolidado: también 4 líneas');
  const filasC = await page.evaluate(() => Array.from(document.querySelectorAll('#ejecTbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
  const honMes = filasC.map(r => leerCLP(r[6]));
  t.ok(honMes.every(v => Number.isFinite(v)), 'Consolidado: los 12 meses de «Gasto Hon. (mes)» son números');
  const sumaFuentes = MESES.map((m, i) => FUENTES.reduce((s, f) => { const x = serieMensual(docs, f.key); return s + x.hon.real[i] + x.hon.proy[i]; }, 0));
  const diferencias = honMes.map((v, i) => v - sumaFuentes[i]);
  t.ok(diferencias.every(d => d >= 0), 'Consolidado: cada mes trae AL MENOS los honorarios de las 9 fuentes (más los de SEP)', diferencias);
  t.eq(diferencias.reduce((a, b) => a + b, 0), 13390000 + 4450000, 'Consolidado: lo que sobra sobre las fuentes son exactamente los honorarios de SEP ($13.390.000 de boletas + $4.450.000 de proyección)');

  // ================================================================ 2. Panel principal: gráfico apilado, tabla y evolución mensual
  await clickTab(page, 'Panel principal');
  for (const vista of ['total', 'real', 'proy']) {
    await page.click(`.dash-chips button[data-dash-vista="${vista}"]`);
    await h.waitIdle();
    const filas = await page.evaluate(() => Array.from(document.querySelectorAll('#dashChartComp .dash-bar-row')).map(r => ({
      f: r.dataset.dashFuente, label: r.getAttribute('aria-label'),
      segs: Array.from(r.querySelectorAll('.seg')).map(s => ({ tipo: s.dataset.dashSeg, flex: parseFloat(s.style.flexGrow || s.style.flex) })),
    })));
    let ok = true; const detalle = [];
    FUENTES.forEach(f => {
      const b = esp[f.key].suma[vista];
      const fila = filas.find(x => x.f === f.key);
      const sh = fila.segs.find(s => s.tipo === 'hon');
      if (!!sh !== (b.hon > 0)) { ok = false; detalle.push(`${f.key}: segmento hon ${!!sh} vs ${b.hon}`); }
      if (sh && Math.round(sh.flex) !== Math.round(b.hon)) { ok = false; detalle.push(`${f.key}: flex ${sh.flex} vs ${b.hon}`); }
      if (b.hon > 0 && !new RegExp(`honorarios ${fmt(b.hon).replace(/[$.]/g, '\\$&')}`).test(fila.label)) { ok = false; detalle.push(`${f.key}: etiqueta ${fila.label}`); }
    });
    t.ok(ok, `Panel principal (${vista}): el segmento «Honorarios» de cada barra apilada es proporcional a sus honorarios y la etiqueta accesible lo dice`, detalle);
  }
  await page.click('.dash-chips button[data-dash-vista="total"]');
  await h.waitIdle();
  // tooltip de una barra apilada
  const ttDash = await page.evaluate(() => { const r = document.querySelector('#dashChartComp .dash-bar-row[data-dash-fuente="junji"]'); r.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true, clientX: 50, clientY: 50 })); return document.getElementById('dashTooltip').innerText.replace(/\s+/g, ' '); });
  t.ok(/Honorarios \(Subt\. 21\)/.test(ttDash) && /Remuneraciones/.test(ttDash) && /Bienes y Servicios/.test(ttDash), 'tooltip de la barra de JUNJI: Remuneraciones, Honorarios (Subt. 21) y Bienes y Servicios', ttDash);
  t.ok(/Honorarios/.test(await page.evaluate(() => document.querySelector('#dashChartComp').closest('.dash-panel, section, div').parentElement.innerText)), 'la leyenda del gráfico trae «Honorarios»');
  // evolución mensual (tabla de datos): gasto de cada mes = suma de SEP y las 9 fuentes
  const tablaMes = await page.evaluate(() => Array.from(document.querySelectorAll('#dashTablaMesBody tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
  t.eq(tablaMes.length >= 12, true, 'la evolución mensual lista los 12 meses (y el total)');
  const gasMesFuentes = MESES.map((m, i) => FUENTES.reduce((s, f) => { const x = serieMensual(docs, f.key); return s + x.gas.real[i] + x.gas.proy[i]; }, 0));
  const gasMesDash = tablaMes.slice(0, 12).map(r => leerCLP(r[2]));
  const difMes = gasMesDash.map((v, i) => v - gasMesFuentes[i]);
  t.ok(difMes.every(d => d >= 0), 'evolución mensual (Total): cada mes trae el gasto de las 9 fuentes (rem + hon + B&S) más el de SEP', difMes);
  const mesesDash = ['real', 'proy'];
  for (const v of mesesDash) {
    await page.click(`.dash-chips button[data-dash-vista="${v}"]`);
    await h.waitIdle();
    const tm = await page.evaluate(() => Array.from(document.querySelectorAll('#dashTablaMesBody tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
    const gm = MESES.map((m, i) => FUENTES.reduce((s, f) => s + serieMensual(docs, f.key).gas[v][i], 0));
    const dm = tm.slice(0, 12).map((r, i) => leerCLP(r[2]) - gm[i]);
    t.ok(dm.every(d => d >= 0), `evolución mensual (${v}): cada mes trae el gasto de las 9 fuentes con sus honorarios (boletas siempre reales, proyección siempre proyectada)`, dm);
  }
  await page.click('.dash-chips button[data-dash-vista="total"]');
  await h.waitIdle();

  // ================================================================ 3. Visualizador: tercera serie por fuente y por código; CSV
  await clickTab(page, 'Reportes');
  await page.click('#vzFuentesNinguna');
  await page.click('#vzFuenteChips [data-vz-fuente="general"]');
  await page.click('#vzFuenteChips [data-vz-fuente="junji"]');
  await h.waitIdle();
  await page.click('#vzExpGas');
  const arbol = await page.evaluate(() => Array.from(document.querySelectorAll('#vzBodyGas tr.vz-row')).map(tr => ({ n: tr.querySelector('.vz-name').textContent.trim().replace(/^[▸▾]\s*/, ''), real: tr.children[1].textContent.trim(), proy: tr.children[2].textContent.trim() })));
  const nombres = arbol.map(a => a.n);
  t.ok(nombres.includes('Honorarios (Subt. 21)') && nombres.includes('Honorarios — Proyección'), 'Visualizador por fuente: cada fuente con honorarios tiene los grupos «Honorarios (Subt. 21)» y «Honorarios — Proyección»');
  t.ok(nombres.includes('410803 · TALLERES EXTRAPROGRAMÁTICOS') && nombres.includes('Apoyo pedagógico') && nombres.includes('Taller de música'), 'el árbol baja hasta la cuenta (General: «410803 · …») o el concepto (JUNJI)');
  await page.click('#vzAgruparChips [data-vz-agrupar="codigo"]');
  await h.waitIdle();
  await page.click('#vzExpGas');
  const arbolC = await page.evaluate(() => Array.from(document.querySelectorAll('#vzBodyGas tr.vz-row')).map(tr => ({ n: tr.querySelector('.vz-name').textContent.trim().replace(/^[▸▾]\s*/, ''), real: tr.children[1].textContent.trim() })));
  t.ok(arbolC.some(a => a.n === 'Honorarios (Subt. 21)') && arbolC.some(a => /^410803 · /.test(a.n)) && arbolC.some(a => a.n === 'Apoyo pedagógico'), 'Visualizador por código: «Honorarios (Subt. 21)» consolida cuentas (General) y conceptos (JUNJI) sin mezclarlos');
  const csv = await capturarDescarga(page, () => page.click('#vzCsvBtn'));
  const filasCsv = parseCsvPuntoYComa(csv.buffer.toString('utf8'));
  const csvHon = filasCsv.filter(l => /^Honorarios/.test(l[1]));
  // columnas (por código): Tipo, Subcategoria, Codigo, Concepto, Fuente, Real, Proyectado, Total
  const boletasEsp = (key, tipo) => Object.keys(docs).filter(id => id !== '_meta').reduce((s, id) => s + (tipo === 'boletas' ? honFuenteDe(docs, id, key).boletas : honFuenteDe(docs, id, key).proy), 0);
  const csvSuma = (fuente, subcat, col) => filasCsv.filter(l => l[0] === 'Gasto' && l[1] === subcat && l[4] === fuente).reduce((s, l) => s + Number(l[col]), 0);
  t.ok(csvHon.length > 0, 'el CSV del Visualizador trae las líneas de honorarios');
  t.eq([csvSuma('Subvención General', 'Honorarios (Subt. 21)', 5), csvSuma('Subvención General', 'Honorarios (Subt. 21)', 6), csvSuma('JUNJI', 'Honorarios (Subt. 21)', 5)], [boletasEsp('general', 'boletas'), 0, boletasEsp('junji', 'boletas')], 'CSV por código: las boletas de honorarios son SOLO «Real» (columna Real = cálculo independiente, Proyectado = 0)');
  t.eq([csvSuma('Subvención General', 'Honorarios — Proyección', 6), csvSuma('Subvención General', 'Honorarios — Proyección', 5), csvSuma('JUNJI', 'Honorarios — Proyección', 6)], [boletasEsp('general', 'proy'), 0, boletasEsp('junji', 'proy')], 'CSV por código: la proyección de honorarios es SOLO «Proyectado»');
  t.noErrores(h);
  await page.click('#vzAgruparChips [data-vz-agrupar="fuente"]');

  // ================================================================ 4. Reporte personalizado: conceptos nuevos y su CSV
  await page.click('#reporteVistaChips [data-reporte-vista="personalizado"]');
  await h.waitIdle();
  await page.click('#reporteRbdNinguno');
  await page.click('#reporteConceptoNinguno');
  const marcar = (sel, v) => page.evaluate(([s, val]) => { const el = document.querySelector(s); if (!el) return false; el.checked = val; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }, [sel, v]);
  await page.evaluate(() => { document.querySelectorAll('#reporteConceptoList details').forEach(d => { d.open = true; }); });
  await marcar('#reporteRbdList input[data-rbd-check="1121"]', true);
  await marcar('#reporteRbdList input[data-rbd-check="5402002"]', true);
  const cuentas = ['of|general|hon_item|410803', 'of|general|hon_item|410304', 'of|general|hon_proy_item|410803', 'of|junji|hon_item|Apoyo pedagógico', 'of|junji|hon_item|Taller de música', 'of|junji|hon_proy_item|Apoyo pedagógico'];
  for (const c of cuentas) t.ok(await marcar(`#reporteConceptoList input[data-concepto-check="${c}"]`, true), `Reporte personalizado: existe el concepto ${c}`);
  await h.waitIdle();
  const filasRep = await page.evaluate(() => Array.from(document.querySelectorAll('#reporteTbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
  const tot = (rbd, etiqueta) => { const f = filasRep.find(r => r[0] === rbd && r[2] === etiqueta); return f ? leerCLP(f[f.length - 1]) : null; };
  const g = honFuenteDe(docs, '1121', 'general'), j = honFuenteDe(docs, '5402002', 'junji');
  const sumaC = (a) => a.reduce((x, y) => x + y, 0);
  t.eq([tot('1121', '[Subv. General] Honorarios — 410803 · TALLERES EXTRAPROGRAMÁTICOS'), tot('1121', '[Subv. General] Honorarios — 410304 · OTROS GASTOS EN PERSONAL'), tot('1121', '[Subv. General] Honorarios Proyección — 410803 · TALLERES EXTRAPROGRAMÁTICOS')],
    [sumaC(g.porClave['410803']), sumaC(g.porClave['410304']), sumaC(g.proyPorClave['410803'])], 'Reporte personalizado (General 1121): boletas por cuenta y proyección por cuenta = cálculo independiente');
  t.eq([tot('5402002', '[JUNJI] Honorarios — Apoyo pedagógico'), tot('5402002', '[JUNJI] Honorarios — Taller de música'), tot('5402002', '[JUNJI] Honorarios Proyección — Apoyo pedagógico')],
    [sumaC(j.porClave['Apoyo pedagógico']), sumaC(j.porClave['Taller de música']), sumaC(j.proyPorClave['Apoyo pedagógico'])], 'Reporte personalizado (JUNJI 5402002): boletas por concepto y proyección por concepto = cálculo independiente');
  const csvR = await capturarDescarga(page, () => page.click('#reporteCsvBtn'));
  const txtR = csvR.buffer.toString('utf8');
  t.ok(/Honorarios — 410803/.test(txtR) && /Honorarios — Apoyo pedagógico/.test(txtR) && /Honorarios Proyección — Taller de música|Honorarios Proyección — Apoyo pedagógico/.test(txtR), 'el CSV del Reporte personalizado trae las filas de honorarios con su etiqueta');
  t.noErrores(h);
  await h.close();
});
