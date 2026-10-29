// fondos_fijos_modelo (PR K) — control operativo de Fondos Fijos (campo `fondos_fijos` del documento de cada RBD / GESPARVU): LECTURA, MODELO y GUARDADO. Fixture `fondos_fijos`.
//
//   1. lectura SIN escribir: tarjetas y tabla = cálculo independiente (tests/lib/fondos_fijos.mjs) en las 68 entidades (55 RBD + 13 GESPARVU; AC NO es entidad de Fondos Fijos), Estado de cada una y modal
//   2. lectura TOLERANTE: un documento con valores no numéricos, nulos, negativos, enormes, folio que no es texto o más largo que el máximo no tumba el documento ni el panel (estado verde, 0 escrituras)
//   3. universo: lo guardado en `fondos_fijos` de AC se ignora (no suma a General); un jardín solo aparece en General si tiene algo registrado allí
//   4. guardado: un write de SOLO ese campo / mes (`fondos_fijos.meses.<MES>.<campo>`, `merge:true`), el servidor conserva los demás campos y meses, persiste tras recargar, y lo registrado en General
//      mueve el B&S de General en el acto (fila, modal, Panel principal) y el jardín entra / sale de General
//   5. cambios de otra persona: el modal abierto los refleja sin pisar la celda en edición
import { boot, cargarFixture } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { docsDe, clon } from '../lib/corte.mjs';
import { leerFilas, leerTarjetas } from '../lib/honorarios_fuentes.mjs';
import { IDS_FF, MESES, ffEntidad, ffLeido, ffTotales, generalEsperada, idsGeneral, fmt, clp, leerKpisFF, leerFilasFF, ordenFilas, abrirFF, cerrarFF, leerModalFF, escribirFF, celdaFF, FOLIO_MAX } from '../lib/fondos_fijos.mjs';

const RUTA = (id) => `sep_carga_rbd/${id}`;
const escrituras = async (h, id) => (await h.writes()).filter(w => w.path === RUTA(id) && w.options && w.options.merge && w.payload && w.payload.fondos_fijos);
const estadoSync = (page) => page.evaluate(() => ({ txt: document.getElementById('sync-text').textContent, cls: document.getElementById('sync-indicator').className }));
const esperado = (e) => ({ cupo: fmt(e.cupo), aceptado: fmt(e.aceptado), registrado: fmt(e.registrado), pendGeneral: fmt(e.pendienteGeneral), compensado: fmt(e.compensado), pendSigfe: fmt(e.pendienteSigfe), estado: e.estado });

await correrSpec('fondos_fijos_modelo', async (t) => {
  const docs = docsDe('fondos_fijos');
  const h = await boot({ fixture: 'fondos_fijos' });
  const { page } = h;

  // ================================================================ 1. lectura sin escribir
  await h.clickTab('fondos fijos');
  t.eq((await h.writes()).length, 0, '1) abrir el panel y la pestaña no escribe nada');
  const filas = await leerFilasFF(page);
  t.eq(await ordenFilas(page, '#fondosFijosTbody tr'), IDS_FF, '1) la pestaña lista las 68 entidades de Fondos Fijos: los 55 RBD y los 13 GESPARVU, en ese orden, sin AC');
  const malas = [];
  IDS_FF.forEach(id => { const e = ffEntidad(docs, id), f = filas[id]; const a = { cupo: f.cupo, aceptado: f.aceptado, registrado: f.registrado, pendGeneral: f.pendGeneral, compensado: f.compensado, pendSigfe: f.pendSigfe, estado: f.estado }; if (JSON.stringify(a) !== JSON.stringify(esperado(e))) malas.push(`${id}: ${JSON.stringify(a)} ≠ ${JSON.stringify(esperado(e))}`); });
  t.eq(malas, [], '1) cada fila (cupo, gasto aceptado, registrado en General, pendiente General, compensado SIGFE, pendiente SIGFE y Estado) = cálculo independiente');
  t.eq(['1121', '1122', '1125', '1128', '1129', '5402002', '5401006', '1123'].map(id => filas[id].estado),
    ['Con observaciones', 'Pendiente General', 'Conciliado', 'Pendiente SIGFE', 'Conciliado', 'Pendiente SIGFE', 'Pendiente General', 'Sin datos'], '1) Estados de los casos del fixture (observado > pendiente General > pendiente SIGFE > conciliado; sin datos)');
  t.eq(filas['1121'], { ...filas['1121'], cupo: '$500.000', aceptado: '$200.000', registrado: '$200.000', pendGeneral: '$0', compensado: '$140.000', pendSigfe: '$60.000' }, '1) 1121: cupo 500.000, aceptado 200.000 (rendido 270.000 − observado 70.000), registrado 200.000, compensado 140.000, pendiente SIGFE 60.000');
  const tot = ffTotales(docs);
  const kp = await leerKpisFF(page);
  t.eq([clp(kp['Cupo vigente'].valor), clp(kp['Gasto aceptado'].valor), clp(kp['Pendiente en General'].valor), clp(kp['Pendiente SIGFE'].valor), clp(kp['Observado'].valor)],
    [tot.cupo, tot.aceptado, tot.pendienteGeneral, tot.pendienteSigfe, tot.observado], '1) las 5 tarjetas = suma de las 68 entidades (cupo, aceptado, pendientes, observado)');
  t.eq([tot.cupo, tot.aceptado, tot.pendienteGeneral, tot.pendienteSigfe, tot.observado], [1360000, 540000, 150000, 240000, 70000], '1) y son las cifras fijas del fixture');
  t.ok(/Referencial; no es ingreso/.test(kp['Cupo vigente'].nota) && /Rendido menos observado/.test(kp['Gasto aceptado'].nota), '1) las notas de las tarjetas aclaran que el cupo no es ingreso y qué es el aceptado');
  const dash = await (async () => { await h.clickTab('Panel principal'); return page.evaluate(() => document.getElementById('dashFondosFijos').innerText.replace(/\s+/g, ' ')); })();
  t.ok(dash.includes(fmt(tot.aceptado)) && dash.includes(fmt(tot.pendienteGeneral)) && dash.includes(fmt(tot.pendienteSigfe)) && /No participa en el ingreso, gasto, saldo ni déficit consolidados/.test(dash), '1) el recuadro del Panel principal repite aceptado y pendientes y aclara que no participa del consolidado', dash);

  // modal de 1121: cada celda y las filas calculadas
  await abrirFF(h, '1121');
  const m = await leerModalFF(page);
  const e1121 = ffEntidad(docs, '1121');
  t.eq(m.cupo, '500000', '1) modal 1121: Cupo vigente = 500000');
  const celdasMal = [];
  MESES.forEach(mes => ['saldo_inicial', 'rendido', 'observado', 'registrado_general', 'compensado_sigfe', 'reposicion'].forEach(c => { const v = e1121.meses[mes][c]; if ((m.meses[mes] || {})[c] !== (v ? String(v) : '')) celdasMal.push(`${mes}.${c}: ${(m.meses[mes] || {})[c]} ≠ ${v}`); }));
  MESES.forEach(mes => { if ((m.meses[mes] || {}).folio !== e1121.meses[mes].folio) celdasMal.push(`${mes}.folio`); });
  t.eq(celdasMal, [], '1) modal 1121: las 6 filas de montos y la de folio muestran lo guardado (vacío donde es 0 / sin folio)');
  const aceptadoMes = MESES.map(mes => Math.max(0, e1121.meses[mes].rendido - e1121.meses[mes].observado));
  t.eq(m.calc['Gasto aceptado'].slice(0, 12).map(clp), aceptadoMes, '1) fila calculada «Gasto aceptado» = max(0, rendido − observado) mes a mes');
  t.eq(clp(m.calc['Gasto aceptado'][12]), e1121.aceptado, '1) y su total');
  t.eq(m.calc['Pendiente General'].slice(0, 12).map(clp), MESES.map((mes, i) => Math.max(0, aceptadoMes[i] - e1121.meses[mes].registrado_general)), '1) «Pendiente General» = aceptado − registrado (≥ 0) mes a mes');
  t.eq(m.calc['Pendiente SIGFE'].slice(0, 12).map(clp), MESES.map((mes, i) => Math.max(0, aceptadoMes[i] - e1121.meses[mes].compensado_sigfe)), '1) «Pendiente SIGFE» = aceptado − compensado (≥ 0) mes a mes');
  t.eq(m.calc['Saldo final de caja'].slice(0, 12).map(clp), MESES.map((mes, i) => e1121.meses[mes].saldo_inicial - aceptadoMes[i] + e1121.meses[mes].reposicion), '1) «Saldo final de caja» = saldo inicial − aceptado + reposición mes a mes');
  const sub = await page.evaluate(() => document.getElementById('fondosFijosModalSubtitle').textContent.replace(/\s+/g, ' '));
  t.ok(sub.includes(fmt(200000)) && sub.includes(fmt(60000)), '1) el subtítulo del modal repite aceptado y pendientes', sub);
  await cerrarFF(h);
  t.eq((await h.writes()).length, 0, '1) abrir y cerrar el modal no escribe nada');
  t.noErrores(h);
  await h.close();

  // ================================================================ 2. lectura TOLERANTE de un documento dañado
  const daniado = clon(docs);
  daniado['1121'].fondos_fijos = { cupo: 'abc', meses: {
    ENERO: { saldo_inicial: '1000', rendido: true, observado: -500, registrado_general: null, compensado_sigfe: { a: 1 }, reposicion: 1e300, folio: 12345 },
    FEBRERO: [1, 2, 3], MARZO: 'texto', ABRIL: { rendido: '2500', observado: 'NaN', folio: { x: 1 } },
    MAYO: { rendido: 300000, observado: 50000, registrado_general: 250000, compensado_sigfe: 250000, folio: 'F'.repeat(60) },
    JUNIO: { folio: '   ' }, JULIO: { folio: '  espacios  ' }, AGOSTO: { rendido: -1, folio: '😀'.repeat(45) },
  } };
  daniado['1122'].fondos_fijos = 'texto';
  daniado['1123'].fondos_fijos = null;
  daniado['1125'].fondos_fijos = [1, 2, 3];
  daniado['1128'].fondos_fijos = { cupo: -300000, meses: 'x' };
  daniado['1129'].fondos_fijos = { cupo: 1e13, meses: { ENERO: { rendido: 9999999999999, registrado_general: 1e13 } } };
  daniado['5402004'].fondos_fijos = { cupo: 100, meses: { ENERO: { registrado_general: -300, rendido: 400 } } };
  const hd = await boot({ fixture: daniado });
  const sd = await estadoSync(hd.page);
  t.ok(/green/.test(sd.cls) && !/inv[aá]lid/i.test(sd.txt), '2) un `fondos_fijos` dañado NO deja el panel en rojo ni marca el documento como inválido (se lee de forma tolerante)', sd);
  await hd.clickTab('fondos fijos');
  const fd = await leerFilasFF(hd.page);
  const malasD = [];
  IDS_FF.forEach(id => { const e = ffEntidad(daniado, id), f = fd[id]; const a = { cupo: f.cupo, aceptado: f.aceptado, registrado: f.registrado, pendGeneral: f.pendGeneral, compensado: f.compensado, pendSigfe: f.pendSigfe, estado: f.estado }; if (JSON.stringify(a) !== JSON.stringify(esperado(e))) malasD.push(`${id}: ${JSON.stringify(a)} ≠ ${JSON.stringify(esperado(e))}`); });
  t.eq(malasD, [], '2) las 68 filas = lectura tolerante esperada (texto numérico se convierte; nulos, objetos, negativos, ≥ MONTO_ABS_MAX y textos no numéricos valen 0)');
  const e1 = ffEntidad(daniado, '1121');
  t.eq([e1.cupo, e1.rendido, e1.observado, e1.aceptado, e1.registrado], [0, 2500 + 300000 + 0, 50000, 252500, 250000], '2) 1121 dañado: cupo "abc" = 0; "2500" = 2500; observado -500 y "NaN" = 0; 1e300 = 0; el resto sano suma');
  t.eq([fd['1122'].estado, fd['1123'].estado, fd['1125'].estado], ['Sin datos', 'Sin datos', 'Sin datos'], '2) `fondos_fijos` que es texto, nulo o arreglo = sin datos');
  t.eq([fd['1128'].cupo, fd['1129'].cupo, fd['1129'].aceptado, fd['1129'].registrado, fd['5402004'].registrado], ['$0', '$0', fmt(9999999999999), '$0', '$0'], '2) cupo negativo y ≥ 1e13 y registrado ≥ 1e13 o negativo valen 0; un rendido de 9.999.999.999.999 (justo bajo el tope) sí se lee');
  await abrirFF(hd, '1121');
  const md = await leerModalFF(hd.page);
  t.eq([md.meses.ENERO.folio, md.meses.ABRIL.folio, md.meses.MAYO.folio, md.meses.JUNIO.folio, md.meses.JULIO.folio], ['12345', '', 'F'.repeat(FOLIO_MAX), '', 'espacios'], '2) folios: el número se lee como texto, un objeto y los espacios quedan vacíos, 60 caracteres se recortan a 40 y se quitan los espacios de los bordes');
  t.eq(Array.from(md.meses.AGOSTO.folio).length, FOLIO_MAX, '2) el recorte cuenta caracteres, no unidades UTF-16 (45 emojis → 40 emojis completos)');
  t.ok(md.meses.AGOSTO.rendido === '' && md.meses.ENERO.reposicion === '' && md.meses.ENERO.observado === '', '2) las celdas de montos dañados quedan vacías (0), no «NaN» ni «Infinity»');
  await cerrarFF(hd);
  // General: solo lo sano de lo registrado entra al gasto
  await hd.clickTab('of-general');
  const fg = await leerFilas(hd.page, 'general');
  t.eq(fg['1121'] && Number(fg['1121'].bys.replace(/\D/g, '')) >= 250000, true, '2) General suma el registrado sano de 1121 (250.000) y nada de lo dañado');
  t.ok(!('5402004' in fg), '2) el registrado negativo de un jardín (= 0) no lo agrega como fila de General', Object.keys(fg).slice(-3));
  t.eq((await hd.writes()).length, 0, '2) leer documentos dañados no escribe nada (no se «corrigen» solos)');
  t.noErrores(hd);
  await hd.close();

  // ================================================================ 3. universo: AC y lo que está fuera de él
  const h3 = await boot({ fixture: 'fondos_fijos' });
  await h3.clickTab('of-general');
  const g3 = await leerFilas(h3.page, 'general');
  const espG = generalEsperada(docs);
  t.eq(await ordenFilas(h3.page, '#otrasFuentesTbody-general tr[data-rbd]'), idsGeneral(docs), '3) la pestaña General lista los RBD, AC y SOLO el jardín con Fondos Fijos registrados en General (5402002); 5401006 (rendido, sin registrar) no aparece');
  t.eq(g3['AC'].bys.replace(/\D/g, ''), String(espG.porId['AC'].total.bys), '3) AC trae `fondos_fijos` en su documento (registrado 5.000) pero NO es entidad de Fondos Fijos: no suma a su B&S de General');
  t.eq(g3['5402002'], { ingreso: '$0', rem: '$0', hon: '$0', bys: '$100.000', gasto: '$100.000', saldo: '-$100.000', estado: 'Déficit' }, '3) el jardín 5402002: solo el B&S de Fondos Fijos (90.000 + 10.000), sin el «ingreso» de General guardado fuera de su universo (999.999); Déficit');
  await h3.clickTab('fondos fijos');
  t.ok(!('AC' in (await leerFilasFF(h3.page))), '3) AC no está en la pestaña de Fondos Fijos');
  t.eq((await h3.writes()).length, 0, '3) nada se escribe');

  // ================================================================ 4. guardado: un write de SOLO ese campo / mes
  await abrirFF(h3, '1122');
  await escribirFF(h3, celdaFF('1122', 'ABRIL', 'rendido'), 120000);
  await h3.flushWrites();
  let w = await escrituras(h3, '1122');
  t.eq(w.length, 1, '4) editar «Rendido» de abril = UN write sobre el documento 1122');
  t.ok(w[0].options.merge === true, '4) con merge:true');
  t.eq(JSON.stringify(w[0].payload.fondos_fijos), JSON.stringify({ meses: { ABRIL: { rendido: 120000 } } }), '4) y el payload de Fondos Fijos es SOLO `meses.ABRIL.rendido` (no reenvía el cupo, los otros meses ni el folio)');
  t.eq(Object.keys(w[0].payload).filter(k => !['nombre', 'fondos_fijos', 'lastModifiedBy', 'lastModifiedAt'].includes(k)), [], '4) el documento solo recibe nombre, auditoría y ese campo (nada de ingresos, compras ni otras fuentes)');
  let srv = (await h3.store())[RUTA('1122')];
  t.eq(srv.fondos_fijos.meses.ABRIL, { rendido: 120000, folio: 'FF-0100' }, '4) el servidor hizo merge profundo: el folio guardado de abril sigue ahí y rendido = 120000');
  t.eq(srv.fondos_fijos.cupo, 300000, '4) y el cupo no cambió');
  await h3.clearWrites();
  await escribirFF(h3, celdaFF('1122', null, 'cupo'), 450000);
  await h3.flushWrites();
  w = await escrituras(h3, '1122');
  t.eq(w.length === 1 && JSON.stringify(w[0].payload.fondos_fijos), JSON.stringify({ cupo: 450000 }), '4) editar el cupo = write de SOLO `fondos_fijos.cupo`');
  await h3.clearWrites();
  await escribirFF(h3, celdaFF('1122', 'ABRIL', 'folio'), '  FF-0100-B  ');
  await h3.flushWrites();
  w = await escrituras(h3, '1122');
  t.eq(w.length === 1 && JSON.stringify(w[0].payload.fondos_fijos), JSON.stringify({ meses: { ABRIL: { folio: 'FF-0100-B' } } }), '4) editar el folio guarda el texto sin espacios de los bordes, solo ese campo');
  await h3.clearWrites();
  await escribirFF(h3, celdaFF('1122', 'JUNIO', 'rendido'), 30000);
  await escribirFF(h3, celdaFF('1122', 'JUNIO', 'registrado_general'), 30000);
  await h3.flushWrites();
  srv = (await h3.store())[RUTA('1122')];
  t.eq(srv.fondos_fijos.meses.JUNIO, { rendido: 30000, registrado_general: 30000 }, '4) dos campos del mismo mes se acumulan en el servidor (merge por campo)');
  t.eq(srv.fondos_fijos.meses.ABRIL, { rendido: 120000, folio: 'FF-0100-B' }, '4) y abril conserva lo anterior');
  const otro = (await h3.store())[RUTA('1121')].fondos_fijos;
  t.eq(JSON.stringify(otro), JSON.stringify(cargarFixture('fondos_fijos').docs['1121'].fondos_fijos), '4) otras entidades no se tocan (1121 idéntico)');

  // lo registrado en General mueve General, el Panel principal y el modal de General EN EL ACTO
  const docs2 = clon(docs);
  docs2['1122'].fondos_fijos = clon((await h3.store())[RUTA('1122')].fondos_fijos);
  await cerrarFF(h3);
  await h3.clickTab('of-general');
  const g4 = await leerFilas(h3.page, 'general');
  const espG2 = generalEsperada(docs2);
  t.eq(g4['1122'].bys.replace(/\D/g, ''), String(espG2.porId['1122'].total.bys), '4) registrar 30.000 en General de 1122 sube su B&S de General en ese monto (fila de la pestaña)');
  const tj = await leerTarjetas(h3.page, 'general');
  t.eq(clp(tj.total['Gasto Bienes y Servicios (Total)'].valor), espG2.suma.total.bys, '4) y la tarjeta de B&S de General (Total) = cálculo independiente');
  await h3.page.click('#otrasFuentesTbody-general td[data-abrir-otra-fuente="1122"]');
  await h3.waitIdle();
  const bloque = await h3.page.evaluate(() => { const b = Array.from(document.querySelectorAll('#otrasFuentesModalBody .compras-section')).find(x => /Fondos Fijos rendidos/.test(x.textContent)); return b ? b.innerText.replace(/\s+/g, ' ') : null; });
  t.ok(bloque && bloque.includes('$30.000') && /Solo lectura/.test(bloque), '4) el modal de General de 1122 muestra el bloque de solo lectura «Fondos Fijos rendidos — B&S General» con $30.000', bloque);
  await cerrarFF(h3);
  await h3.clickTab('Panel principal');
  const dg = await h3.page.evaluate(() => { const c = Array.from(document.querySelectorAll('#dashCards .dash-card')).find(x => x.dataset.fuente === 'general'); return { bys: Number(c.dataset.bys), gas: Number(c.dataset.gas) }; });
  t.eq([dg.bys, dg.gas], [espG2.suma.total.bys, espG2.suma.total.gasto], '4) el Panel principal (tarjeta de General) refleja el mismo B&S y gasto');

  // el jardín entra y sale de General según lo registrado
  await abrirFF(h3, '5401006');
  await escribirFF(h3, celdaFF('5401006', 'JULIO', 'registrado_general'), 50000);
  await h3.flushWrites();
  await cerrarFF(h3);
  await h3.clickTab('of-general');
  let gj = await leerFilas(h3.page, 'general');
  t.ok('5401006' in gj && gj['5401006'].bys === '$50.000' && gj['5401006'].estado === 'Déficit', '4) al registrar 50.000 en General de un GESPARVU, ese jardín aparece como fila de General (Déficit por el B&S)', gj['5401006']);
  await abrirFF(h3, '5401006');
  await escribirFF(h3, celdaFF('5401006', 'JULIO', 'registrado_general'), 0);
  await h3.flushWrites();
  await cerrarFF(h3);
  await h3.clickTab('of-general');
  gj = await leerFilas(h3.page, 'general');
  t.ok(!('5401006' in gj), '4) y al dejarlo en 0 la fila del jardín desaparece de General', Object.keys(gj).slice(-3));
  t.eq(((await h3.store())[RUTA('5401006')].fondos_fijos.meses.JULIO).registrado_general, 0, '4) el servidor guardó 0 (no borra la clave)');

  // recarga: lo guardado persiste
  await h3.page.reload();
  await h3.page.waitForFunction(() => { const a = document.getElementById('app'); const d = document.getElementById('sync-indicator'); return a && !a.classList.contains('hidden') && d && d.classList.contains('green'); }, null, { timeout: 20000 });
  await h3.waitIdle();
  await h3.clickTab('fondos fijos');
  const fr = await leerFilasFF(h3.page);
  t.eq([fr['1122'].cupo, fr['1122'].aceptado], ['$450.000', fmt(120000 + 30000)], '4) tras recargar la página el cupo y el aceptado guardados siguen ahí (1122: aceptado 120.000 + 30.000)');
  t.noErrores(h3);

  // ================================================================ 5. cambios de otra persona con el modal abierto
  await abrirFF(h3, '1125');
  const celda = celdaFF('1125', 'OCTUBRE', 'observado');
  await h3.page.click(celda);
  await h3.page.keyboard.type('12');
  await h3.remoto('1125', "d.fondos_fijos.meses.OCTUBRE.rendido = 70000; d.fondos_fijos.meses.NOVIEMBRE = { rendido: 5000 }");
  await h3.waitIdle();
  const m5 = await leerModalFF(h3.page);
  t.eq([m5.meses.OCTUBRE.rendido, m5.meses.NOVIEMBRE.rendido], ['70000', '5000'], '5) un cambio remoto de otras celdas se refleja en el modal abierto');
  t.eq(await h3.page.evaluate((s) => ({ v: document.querySelector(s).value, foco: document.activeElement === document.querySelector(s) }), celda), { v: '12', foco: true }, '5) y la celda que se está tecleando conserva su texto y su foco');
  await h3.page.keyboard.press('Tab');
  await h3.waitIdle();
  await h3.flushWrites();
  t.eq(((await h3.store())[RUTA('1125')].fondos_fijos.meses.OCTUBRE).observado, 12, '5) al confirmar la celda se guarda lo tecleado (observado = 12) sin pisar el rendido remoto (70.000)');
  t.eq(((await h3.store())[RUTA('1125')].fondos_fijos.meses.OCTUBRE).rendido, 70000, '5) el rendido remoto sigue en el servidor');
  await cerrarFF(h3);
  t.noErrores(h3);
  await h3.close();
});
