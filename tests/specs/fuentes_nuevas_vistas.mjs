// fuentes_nuevas_vistas (PR K) — las fuentes nuevas de `main` (Subtítulo 31, Recuperación LLMM, Asignación Familiar) y el Ingreso Carrera Docente de General / PIE en las vistas que consolidan: Panel principal, % Ejecución,
// Visualizador y Reporte personalizado. Fixture `fondos_fijos`, contra el cálculo independiente de tests/lib/honorarios_fuentes.mjs / tests/lib/fondos_fijos.mjs.
//
//   1. Panel principal: la tarjeta, la fila de la tabla «por fuente», el gráfico y la franja de las 12 fuentes = cálculo independiente (Total / Real / Proyectado); la evolución mensual cuadra con la franja
//   2. % Ejecución: Subt. 31 y Asignación Familiar (una fuente, una entidad) y Consolidado; Recuperación LLMM (solo ingresos) no tiene serie de ejecución
//   3. Visualizador: totales de ingresos y gastos por fuente, líneas de ingreso de Recuperación LLMM (Isapres / FONASA / SIL) y de Carrera Docente (General / PIE), Excel y CSV
//   4. Reporte personalizado: catálogo de conceptos de cada fuente nueva, valores por entidad contra el oráculo y UNIVERSO de entidades (Asignación Familiar sin AC; Recuperación LLMM sin remuneraciones ni honorarios)
import { boot } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { docsDe } from '../lib/corte.mjs';
import { leerCLP, tarjetas } from '../lib/honorarios.mjs';
import { serieMensual } from '../lib/honorarios_fuentes.mjs';
import { capturarDescarga, leerXlsx } from '../lib/capture-utils.mjs';
import { FUENTES, MESES, fuenteEsp, serieGeneral, fmt } from '../lib/fondos_fijos.mjs';

const dashVista = async (h, v) => { await h.page.click(`.dash-chips button[data-dash-vista="${v}"]`); await h.waitIdle(); };
const strip = (page) => page.evaluate(() => { const o = {}; document.querySelectorAll('#dashStrip .dash-tile').forEach(t => { o[t.querySelector('.t-label').textContent.trim()] = t.querySelector('.t-value').textContent.trim(); }); return o; });
const tarjetasDash = (page) => page.evaluate(() => { const o = {}; document.querySelectorAll('#dashCards .dash-card').forEach(c => { o[c.dataset.fuente] = { ingreso: +c.dataset.ing, rem: +c.dataset.rem, hon: +c.dataset.hon, bys: +c.dataset.bys, gasto: +c.dataset.gas, saldo: +c.dataset.saldo, texto: c.textContent.replace(/\s+/g, ' ') }; }); return o; });
const vzTotales = (page, id) => page.evaluate((i) => Array.from(document.querySelector(`#${i} tr.vz-total-row`).querySelectorAll('td')).slice(1, 4).map(td => td.textContent.trim()), id);
const NUEVAS = [['subt31_proyectos', 'Subt. 31'], ['recuperacion_llmm', 'Recup. LLMM'], ['asignacion_familiar', 'Asig. Familiar']];
const suma = (a) => a.reduce((x, y) => x + y, 0);

await correrSpec('fuentes_nuevas_vistas', async (t) => {
  const docs = docsDe('fondos_fijos');
  const esp = {};
  FUENTES.forEach(f => { esp[f.key] = fuenteEsp(docs, f.key); });
  const h = await boot({ fixture: 'fondos_fijos' });
  const { page } = h;

  // ================================================================ 1. Panel principal
  await h.clickTab('SEP');
  const T = await tarjetas(page, '#kpiRow'), R = await tarjetas(page, '#kpiRowReal'), P = await tarjetas(page, '#kpiRowProy');
  const gastoSep = (X, suf) => leerCLP(X[`Gasto Remuneraciones (${suf})`]) + leerCLP(X[`Gasto Honorarios (${suf})`]) + leerCLP(X[`Gasto Bienes y Servicios (${suf})`]);
  const ingSep = (X, suf) => leerCLP(X[`Ingreso SEP (${suf})`] || X[`Ingreso (${suf})`] || '$0');
  void ingSep;
  const sepGasto = { total: gastoSep(T, 'a Diciembre'), real: gastoSep(R, 'Real'), proy: gastoSep(P, 'Proyectado') };
  await h.clickTab('Panel principal');
  for (const vista of ['total', 'real', 'proy']) {
    await dashVista(h, vista);
    const tj = await tarjetasDash(page);
    t.eq(Object.keys(tj), ['sep', ...FUENTES.map(f => f.key)], `1) Panel principal (${vista}): 13 tarjetas (SEP + 12 fuentes) en el orden de las pestañas`);
    const malas = FUENTES.filter(f => { const b = esp[f.key].suma[vista], c = tj[f.key]; return c.ingreso !== b.ingreso || c.rem !== b.rem || c.hon !== b.hon || c.bys !== b.bys || c.gasto !== b.gasto || c.saldo !== b.saldo; }).map(f => f.key);
    t.eq(malas, [], `1) Panel principal (${vista}): las 12 tarjetas (ingreso, rem., honorarios, B&S, gasto y saldo) = cálculo independiente`);
    NUEVAS.forEach(([k, corto]) => t.ok(tj[k].texto.includes(corto), `1) la tarjeta de ${k} se rotula «${corto}»`, tj[k].texto.slice(0, 60)));
    t.eq([tj.recuperacion_llmm.gasto, tj.recuperacion_llmm.rem, tj.recuperacion_llmm.hon, tj.recuperacion_llmm.bys], [0, 0, 0, 0], `1) (${vista}) Recuperación LLMM: sin gasto de ningún tipo`);
    t.eq([tj.asignacion_familiar.bys], [0], `1) (${vista}) Asignación Familiar: sin B&S`);
    const s = await strip(page);
    const lee = (r) => leerCLP(s[r] || s[r.toUpperCase()]);
    const ingTotal = FUENTES.reduce((x, f) => x + tj[f.key].ingreso, 0) + tj.sep.ingreso;
    t.eq(lee('Ingreso'), ingTotal, `1) Panel principal (${vista}): el «Ingreso» de la franja suma SEP y las 12 fuentes (con Carrera Docente de General / PIE y las líneas de Recuperación LLMM)`);
    t.eq(lee('Gasto Total'), tj.sep.gasto + FUENTES.reduce((x, f) => x + tj[f.key].gasto, 0), `1) Panel principal (${vista}): el «Gasto Total» de la franja suma SEP y las 12 fuentes`);
    t.eq(tj.sep.gasto, sepGasto[vista], `1) Panel principal (${vista}): SEP no cambia (= su pestaña)`);
    if (vista === 'total') {
      const tabla = await page.evaluate(() => Array.from(document.querySelectorAll('#dashTablaFuentesBody tbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
      const malasT = FUENTES.filter(f => { const nombre = ({ subt31_proyectos: 'Subt. 31', recuperacion_llmm: 'Recup. LLMM', asignacion_familiar: 'Asig. Familiar', general: 'Subv. General', mantenimiento: 'Mantenimiento', prorretencion: 'Pro-Retención', aporte_educ: 'Aporte Fiscal Educ.', aporte_junji: 'Aporte Fiscal JUNJI' })[f.key] || f.corto; const fila = tabla.find(r => r[0] === nombre); const b = esp[f.key].suma.total; return !fila || leerCLP(fila[1]) !== b.ingreso || leerCLP(fila[2]) !== b.rem || leerCLP(fila[3]) !== b.hon || leerCLP(fila[4]) !== b.bys || leerCLP(fila[5]) !== b.gasto || leerCLP(fila[6]) !== b.saldo; }).map(f => f.key);
      t.eq(malasT, [], '1) la tabla «por fuente» trae una fila por cada una de las 12 fuentes con las mismas cifras');
      const barras = await page.evaluate(() => Array.from(document.querySelectorAll('#dashChartComp .dash-bar-row')).map(r => r.dataset.dashFuente));
      t.eq(barras, ['sep', ...FUENTES.map(f => f.key)], '1) el gráfico apilado trae las 13 barras (SEP y las 12 fuentes)');
      const m = await page.evaluate(() => { const filas = Array.from(document.querySelectorAll('#dashTablaMesBody tbody tr')); const u = filas[filas.length - 1]; return { ing: u.children[1].textContent.trim(), gas: u.children[2].textContent.trim() }; });
      t.eq([leerCLP(m.ing), leerCLP(m.gas)], [lee('Ingreso'), lee('Gasto Total')], '1) la evolución mensual suma el mismo ingreso y gasto que la franja');
    }
  }
  await dashVista(h, 'total');
  const strip0 = await strip(page);
  const totalIng = leerCLP(strip0['Ingreso'] || strip0['INGRESO']);
  const totalGas = leerCLP(strip0['Gasto Total'] || strip0['GASTO TOTAL']);

  // ================================================================ 2. % Ejecución
  await h.clickTab('% Ejecución');
  const chips = await page.evaluate(() => Array.from(document.querySelectorAll('#ejecFuenteChips .of-chip')).map(b => b.dataset.ejecFuente));
  t.eq(chips, ['sep', ...FUENTES.map(f => f.key).filter(k => k !== 'recuperacion_llmm'), 'consolidado'], '2) los chips de % Ejecución traen Subt. 31 y Asignación Familiar; Recuperación LLMM (solo ingresos, sin gasto que ejecutar) no tiene');
  const leerEjec = () => page.evaluate(() => Array.from(document.querySelectorAll('#ejecTbody tr')).map(tr => Array.from(tr.children).map(td => td.textContent.trim())));
  const col = { ing: 2, rem: 3, hon: 6, bys: 9 };
  for (const key of ['subt31_proyectos', 'asignacion_familiar', 'pie', 'general']) {
    await page.click(`#ejecFuenteChips .of-chip[data-ejec-fuente="${key}"]`);
    await h.waitIdle();
    const f = await leerEjec();
    const sm = key === 'general' ? serieGeneral(docs) : serieMensual(docs, key);
    const mes = (o) => o.real.map((v, i) => v + o.proy[i]);
    t.eq([f.map(r => leerCLP(r[col.ing])), f.map(r => leerCLP(r[col.rem])), f.map(r => leerCLP(r[col.hon])), f.map(r => leerCLP(r[col.bys]))], [mes(sm.ing), mes(sm.rem), mes(sm.hon), mes(sm.bys)], `2) % Ejecución ${key}: ingreso, remuneraciones, honorarios y B&S mes a mes = cálculo independiente${key === 'pie' || key === 'general' ? ' (el ingreso incluye Carrera Docente)' : ''}`);
    const b = esp[key].suma.total;
    const ultima = f[11];
    t.eq(ultima[12], b.ingreso > 0 ? (b.gasto / b.ingreso * 100).toLocaleString('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%' : '—', `2) % Ejecución ${key}: el % Total acumulado a diciembre = gasto total / ingreso anual`);
  }
  // una entidad
  await page.click('#ejecFuenteChips .of-chip[data-ejec-fuente="asignacion_familiar"]');
  await page.selectOption('#ejecRbdSelect', '1122');
  await h.waitIdle();
  const smA = serieMensual(docs, 'asignacion_familiar', '1122');
  const fA = await leerEjec();
  t.eq([fA.map(r => leerCLP(r[col.ing])), fA.map(r => leerCLP(r[col.rem]))], [smA.ing.real.map((v, i) => v + smA.ing.proy[i]), smA.rem.real.map((v, i) => v + smA.rem.proy[i])], '2) % Ejecución Asignación Familiar / 1122: sus 400.000 de ingreso y 100.000 de remuneración de enero');
  const opcionesAF = await page.evaluate(() => Array.from(document.querySelectorAll('#ejecRbdSelect option')).map(o => o.value).filter(Boolean));
  t.ok(!opcionesAF.includes('AC') && opcionesAF.length === 68, '2) el selector de entidad de Asignación Familiar trae 68 (55 RBD + 13 GESPARVU, sin AC)', opcionesAF.length);
  await page.click('#ejecFuenteChips .of-chip[data-ejec-fuente="subt31_proyectos"]');
  await page.selectOption('#ejecRbdSelect', '5402004');
  await h.waitIdle();
  const sS = serieMensual(docs, 'subt31_proyectos', '5402004');
  t.eq((await leerEjec()).map(r => leerCLP(r[col.ing])), sS.ing.real.map((v, i) => v + sS.ing.proy[i]), '2) % Ejecución Subt. 31 / jardín 5402004: 120.000 de ingreso en enero');
  await page.selectOption('#ejecRbdSelect', '');
  await page.click('#ejecFuenteChips .of-chip[data-ejec-fuente="consolidado"]');
  await h.waitIdle();
  const fc = await leerEjec();
  t.eq(fc.reduce((s, r) => s + leerCLP(r[col.ing]), 0), totalIng, '2) % Ejecución Consolidado: el ingreso de los 12 meses = el «Ingreso» de la franja del Panel principal');
  t.eq(fc.reduce((s, r) => s + leerCLP(r[col.rem]) + leerCLP(r[col.hon]) + leerCLP(r[col.bys]), 0), totalGas, '2) % Ejecución Consolidado: rem + hon + B&S = el «Gasto Total» de la franja');

  // ================================================================ 3. Visualizador
  await h.clickTab('Reportes');
  for (const f of FUENTES.filter(f => ['subt31_proyectos', 'recuperacion_llmm', 'asignacion_familiar', 'general', 'pie'].includes(f.key))) {
    await page.click('#vzFuentesNinguna');
    await page.click(`#vzFuenteChips [data-vz-fuente="${f.key}"]`);
    await h.waitIdle();
    const b = esp[f.key].suma;
    t.eq((await vzTotales(page, 'vzBodyIng')).map(leerCLP), [b.real.ingreso, b.proy.ingreso, b.total.ingreso], `3) Visualizador (${f.key}): Total Ingresos Real / Proyectado / Total = los de su pestaña${f.key === 'general' || f.key === 'pie' ? ' (Ingreso + Carrera Docente; antes el Visualizador omitía la Carrera Docente)' : ''}`);
    t.eq((await vzTotales(page, 'vzBodyGas')).map(leerCLP), [b.real.gasto, b.proy.gasto, b.total.gasto], `3) Visualizador (${f.key}): Total Gastos = los de su pestaña`);
    await page.click('#vzExpIng');
    const nodosIng = await page.evaluate(() => Array.from(document.querySelectorAll('#vzBodyIng tr.vz-row')).map(tr => ({ n: tr.querySelector('.vz-name').textContent.trim().replace(/^[▸▾]\s*/, ''), total: tr.children[3].textContent.trim() })));
    if (f.key === 'recuperacion_llmm') {
      const sil = suma(MESES.map(m => Number(docs['1121'].otras_fuentes.recuperacion_llmm.ingreso_llmm_sil.meses[m]) || 0));
      t.ok(['Recuperación LLMM Isapres', 'Recuperación LLMM FONASA', 'Recuperación LLMM SIL'].every(n => nodosIng.some(x => x.n === n)), '3) Visualizador (Recuperación LLMM): las 3 líneas de ingreso (Isapres, FONASA, SIL)', nodosIng.map(x => x.n));
      t.eq(leerCLP(nodosIng.find(x => x.n === 'Recuperación LLMM SIL').total) >= sil, true, '3) y la línea SIL suma al menos lo de 1121');
      const gas = await page.evaluate(() => document.getElementById('vzBodyGas').innerText);
      t.ok(!/Remuneraciones|Honorarios|Bienes y Servicios/.test(gas.replace(/Sin datos.*/s, '')), '3) y no trae remuneraciones, honorarios ni B&S');
    }
    if (f.key === 'general' || f.key === 'pie') {
      const cd = nodosIng.find(x => x.n === 'Ingreso Carrera Docente');
      const esperadoCD = RBDS_CD(docs, f.key);
      t.ok(cd && leerCLP(cd.total) === esperadoCD, `3) Visualizador (${f.key}): la línea «Ingreso Carrera Docente» suma ${fmt(esperadoCD)} (lo guardado en ingreso_carrera_docente de todas las entidades)`, { cd, esperadoCD });
      t.eq(nodosIng.filter(x => /^Ingreso$/.test(x.n)).length, 1, `3) y la línea «Ingreso» sigue aparte (una sola)`);
    }
    if (f.key === 'asignacion_familiar') t.ok(!(await page.evaluate(() => /Bienes y Servicios|compras/i.test(document.getElementById('vzBodyGas').innerText))), '3) Visualizador (Asignación Familiar): sin Bienes y Servicios');
  }
  // CSV y Excel de ingresos: la Carrera Docente de General y PIE sale como línea propia
  await page.click('#vzFuentesNinguna');
  await page.click('#vzFuenteChips [data-vz-fuente="general"]');
  await page.click('#vzFuenteChips [data-vz-fuente="pie"]');
  await h.waitIdle();
  const csv = (await capturarDescarga(page, () => page.click('#vzCsvBtn'))).buffer.toString('utf8').split(/\r?\n/);
  const lcd = csv.filter(l => /Ingreso Carrera Docente/.test(l));
  t.ok(lcd.length === 2 && lcd.every(l => /^Ingreso;/.test(l)), '3) Visualizador · CSV: «Ingreso Carrera Docente» sale una vez por fuente (General y PIE) como línea de ingreso', lcd);
  t.eq(lcd.map(l => Number(l.split(';').slice(-1)[0])), [RBDS_CD(docs, 'general'), RBDS_CD(docs, 'pie')], '3) con los totales de cada una');
  const xl = await leerXlsx(page, (await capturarDescarga(page, () => page.click('#vzExcelIng'))).buffer);
  const filasCD = xl.hojas['Detalle'].filter(r => r[3] === 'Ingreso Carrera Docente');
  t.eq(filasCD.map(r => r[6]), [RBDS_CD(docs, 'general'), RBDS_CD(docs, 'pie')], '3) Visualizador · Excel de Ingresos, hoja Detalle: una fila «Ingreso Carrera Docente» por fuente con su total');
  const totalIngXl = xl.hojas['Detalle'].find(r => r[3] === 'TOTAL');
  t.eq(totalIngXl[6], esp.general.suma.total.ingreso + esp.pie.suma.total.ingreso, '3) y el TOTAL del Excel = ingreso de General + PIE (con Carrera Docente)');
  // AC con Asignación Familiar: sin datos
  await page.click('#vzFuentesNinguna');
  await page.click('#vzFuenteChips [data-vz-fuente="asignacion_familiar"]');
  await page.evaluate(() => { document.getElementById('vzEntidadesDet').open = true; });
  await page.click('#vzEntNinguno');
  await page.evaluate(() => { const el = document.querySelector('#vzEntList input[data-vz-ent="AC"]'); if (el) { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); } });
  await h.waitIdle();
  t.eq((await vzTotales(page, 'vzBodyIng')).map(leerCLP), [0, 0, 0], '3) Visualizador: Asignación Familiar con solo AC seleccionada = $0 (AC no es entidad de esa fuente: su 888.888 guardado fuera del universo no cuenta)');
  await page.click('#vzFuentesNinguna');
  await page.click('#vzFuenteChips [data-vz-fuente="recuperacion_llmm"]');
  await h.waitIdle();
  t.eq((await vzTotales(page, 'vzBodyIng')).map(leerCLP), [25000, 0, 25000], '3) Visualizador: Recuperación LLMM con solo AC = 25.000 (AC sí es entidad de esa fuente)');
  await page.click('#vzEntTodos');
  await h.waitIdle();

  // ================================================================ 4. Reporte personalizado
  await page.click('#reporteVistaChips [data-reporte-vista="personalizado"]');
  await h.waitIdle();
  const catalogo = await page.evaluate(() => Array.from(document.querySelectorAll('#reporteConceptoList input[data-concepto-check]')).map(e => e.dataset.conceptoCheck));
  const de = (k) => catalogo.filter(c => c.startsWith(`of|${k}|`)).map(c => c.split('|').slice(2).join('|'));
  t.eq(de('recuperacion_llmm'), ['ingreso_llmm_isapres', 'ingreso_llmm_fonasa', 'ingreso_llmm_sil'], '4) catálogo de Recuperación LLMM: solo sus 3 líneas de ingreso (sin Remuneraciones, honorarios ni B&S)');
  t.ok(de('asignacion_familiar').includes('ingreso') && de('asignacion_familiar').includes('rem') && de('asignacion_familiar').includes('hon') && de('asignacion_familiar').includes('hon_proy') && !de('asignacion_familiar').some(c => /^bys/.test(c)), '4) catálogo de Asignación Familiar: Ingreso, Remuneraciones y honorarios; sin Bienes y Servicios', de('asignacion_familiar'));
  t.ok(['ingreso', 'rem', 'hon', 'hon_proy', 'bys_total'].every(c => de('subt31_proyectos').includes(c)), '4) catálogo de Subt. 31: ingreso, remuneraciones, honorarios y B&S');
  t.ok(de('general').includes('ingreso_carrera_docente') && de('pie').includes('ingreso_carrera_docente') && !de('mantenimiento').includes('ingreso_carrera_docente'), '4) catálogo de General y PIE: «Ingreso Carrera Docente»; Mantenimiento no');
  await page.click('#reporteRbdNinguno');
  await page.click('#reporteConceptoNinguno');
  const marcar = (sel, v) => page.evaluate(([s, val]) => { const el = document.querySelector(s); if (!el) return false; el.checked = val; el.dispatchEvent(new Event('change', { bubbles: true })); return true; }, [sel, v]);
  await page.evaluate(() => { document.querySelectorAll('#reporteConceptoList details').forEach(d => { d.open = true; }); });
  const ids = ['1121', '1122', 'AC', '5402002', '5402004'];
  for (const id of ids) await marcar(`#reporteRbdList input[data-rbd-check="${id}"]`, true);
  const conceptos = ['of|recuperacion_llmm|ingreso_llmm_isapres', 'of|recuperacion_llmm|ingreso_llmm_fonasa', 'of|recuperacion_llmm|ingreso_llmm_sil', 'of|asignacion_familiar|ingreso', 'of|asignacion_familiar|rem', 'of|subt31_proyectos|ingreso', 'of|general|ingreso_carrera_docente', 'of|pie|ingreso_carrera_docente'];
  for (const c of conceptos) await marcar(`#reporteConceptoList input[data-concepto-check="${c}"]`, true);
  await h.waitIdle();
  const filasRep = await page.evaluate(() => Array.from(document.querySelectorAll('#reporteTbody tr')).map(tr => ({ c: Array.from(tr.children).map(td => td.textContent.trim()), flags: Array.from(tr.querySelectorAll('td.num')).slice(0, 12).map(td => (td.classList.contains('mes-real') ? 'R' : (td.classList.contains('mes-proy') ? 'P' : '-'))).join('') })));
  const fila = (id, etiqueta) => filasRep.find(r => r.c[0] === id && r.c[2] === etiqueta);
  const total = (r) => (r ? leerCLP(r.c[r.c.length - 1]) : null);
  const lineaTotal = (id, key, campo) => suma(MESES.map(m => Number((((docs[id].otras_fuentes || {})[key] || {})[campo] || { meses: {} }).meses[m]) || 0));
  const malRep = [];
  const casos = [['recuperacion_llmm', 'ingreso_llmm_isapres', '[Recup. LLMM] Recuperación LLMM Isapres'], ['recuperacion_llmm', 'ingreso_llmm_fonasa', '[Recup. LLMM] Recuperación LLMM FONASA'], ['recuperacion_llmm', 'ingreso_llmm_sil', '[Recup. LLMM] Recuperación LLMM SIL'],
    ['asignacion_familiar', 'ingreso', '[Asig. Familiar] Ingreso'], ['asignacion_familiar', 'gasto_rem', '[Asig. Familiar] Remuneraciones'], ['subt31_proyectos', 'ingreso', '[Subt. 31] Ingreso'], ['general', 'ingreso_carrera_docente', '[Subv. General] Ingreso Carrera Docente'], ['pie', 'ingreso_carrera_docente', '[PIE] Ingreso Carrera Docente']];
  const universo = { recuperacion_llmm: ['1121', '1122', 'AC', '5402002', '5402004'], asignacion_familiar: ['1121', '1122', '5402002', '5402004'], subt31_proyectos: ['1121', '1122', 'AC', '5402002', '5402004'], general: ['1121', '1122', 'AC', '5402002'], pie: ['1121', '1122', 'AC'] };
  casos.forEach(([key, campo, etiqueta]) => {
    ids.forEach(id => {
      const r = fila(id, etiqueta);
      const aplica = universo[key].includes(id);
      if (aplica && !r) malRep.push(`${key}/${campo}/${id}: sin fila`);
      else if (!aplica && r) malRep.push(`${key}/${campo}/${id}: fila de una entidad que no es de la fuente`);
      else if (aplica && total(r) !== lineaTotal(id, key, campo)) malRep.push(`${key}/${campo}/${id}: ${total(r)} ≠ ${lineaTotal(id, key, campo)}`);
    });
  });
  t.eq(malRep, [], '4) Reporte personalizado: cada concepto nuevo da una fila por entidad de SU universo (Asignación Familiar sin AC; General solo con el jardín que tiene Fondos Fijos; PIE sin jardines) con el total del cálculo independiente');
  t.eq(fila('1121', '[Recup. LLMM] Recuperación LLMM Isapres').flags, 'RRRRRRRPPPPP', '4) Reporte personalizado: los ingresos de Recuperación LLMM se colorean por el «Real hasta» de la entidad (julio: 7 Real, 5 Proyectado)');
  t.eq(fila('1122', '[PIE] Ingreso Carrera Docente').flags, 'RRRRRRRPPPPP', '4) y la Carrera Docente de PIE también');
  t.eq(fila('1121', '[Asig. Familiar] Remuneraciones').flags, 'RRRRRRRPPPPP', '4) y la remuneración de Asignación Familiar');
  const subt = filasRep.filter(r => /^Subtotal — \[Asig\. Familiar\] Ingreso$/.test(r.c[0] + (r.c[2] ? '' : '') + r.c[1]) || /Subtotal — \[Asig\. Familiar\] Ingreso/.test(r.c.join(' ')));
  t.ok(subt.length >= 1, '4) hay subtotal por concepto cuando hay varias entidades');
  t.noErrores(h);
  await h.close();
});

/** Suma del Ingreso Carrera Docente (12 meses) de todas las entidades de la fuente (General / PIE: RBD + AC; más el jardín de General que no lo tiene). */
function RBDS_CD(docs, key) {
  return Object.entries(docs).filter(([id]) => id !== '_meta').reduce((s, [id, d]) => s + (key === 'general' || key === 'pie' ? (((d.otras_fuentes || {})[key] || {}).ingreso_carrera_docente ? MESES.reduce((a, m) => a + (Number(d.otras_fuentes[key].ingreso_carrera_docente.meses[m]) || 0), 0) : 0) : 0), 0)
    - (key === 'general' ? 0 : 0);
}
