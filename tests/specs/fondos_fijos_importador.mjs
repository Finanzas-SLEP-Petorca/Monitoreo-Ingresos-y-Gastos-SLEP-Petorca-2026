// fondos_fijos_importador (PR K) — «⬆ Importar Control Fondos Fijos» (hoja «FONDOS FIJOS P02»). Fixture `fondos_fijos`.
//
//   1. el mapa de columnas (RBD, cupo y, por mes de marzo a diciembre, saldo inicial, rendido, observado y folio) contra un cálculo independiente; lo que la planilla no identifica (Registrado en General,
//      Compensado SIGFE, Reposición) NO se toca y las columnas intermedias NO se leen; enero y febrero no se tocan; octubre a diciembre no traen folio
//   2. el write de cada entidad = SOLO `fondos_fijos` (cupo + meses con esos campos), `merge:true`; el servidor conserva lo demás; reimportar el mismo archivo es idempotente
//   3. filas vacías, entidades FUERA del universo (AC, ids que no existen, decimales, negativos, texto) omitidas con su conteo; hoja con otro nombre en mayúsculas / espacios; archivo sin la hoja; cancelar
//   4. cantidades inválidas (texto, ±Infinity, negativas, ≥ MONTO_ABS_MAX): la FILA se rechaza completa con un mensaje claro y el resto se importa; el folio se recorta a 40 con aviso
//   5. fallo parcial: un rechazo permanente de una entidad (informa cuántas se guardaron, cuáles no y por qué; los datos quedan en pantalla; «Reintentar» las guarda), un error transitorio (queda pendiente y se
//      reintenta sola) y SIN conexión (no deja la pantalla esperando: plazo de 1,5 s en una copia del HTML)
import fs from 'node:fs';
import path from 'node:path';
import { boot } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { TMP_DIR } from '../lib/config.mjs';
import { resolverAppHtml } from '../lib/html-source.mjs';
import { docsDe, clon } from '../lib/corte.mjs';
import { libroXlsx } from '../lib/compras.mjs';
import { IDS_FF, MESES, ffEntidad, fmt, leerFilasFF, abrirFF, cerrarFF, leerModalFF, FOLIO_MAX } from '../lib/fondos_fijos.mjs';

const RUTA = (id) => `sep_carga_rbd/${id}`;
const HOJA = 'FONDOS FIJOS P02';
// Mapa de columnas de «FONDOS FIJOS P02» (columna de inicio de cada mes: saldo inicial en `inicio`, rendido en `inicio + 2`, observado en `inicio + 3`; folio en su propia columna salvo octubre-diciembre).
const COL = [['MARZO', 7, 13], ['ABRIL', 15, 21], ['MAYO', 23, 29], ['JUNIO', 31, 37], ['JULIO', 39, 45], ['AGOSTO', 47, 53], ['SEPTIEMBRE', 55, 61], ['OCTUBRE', 63, null], ['NOVIEMBRE', 69, null], ['DICIEMBRE', 75, null]];
const BASURA = [777, 888, 999]; // en las columnas que el importador NO debe leer (ini+1, ini+4, ini+5)

/** Fila de la hoja: `meses` = { MES: { saldo, rendido, obs, folio } } (lo no indicado queda vacío). Las columnas intermedias traen basura que NO debe importarse. */
function fila(id, cupo, meses = {}) {
  const r = new Array(81).fill(null);
  r[0] = id; r[1] = 'NOMBRE'; r[6] = cupo;
  COL.forEach(([mes, ini, cf]) => {
    const m = meses[mes];
    if (!m) return;
    r[ini] = m.saldo; r[ini + 1] = BASURA[0]; r[ini + 2] = m.rendido; r[ini + 3] = m.obs; r[ini + 4] = BASURA[1]; r[ini + 5] = BASURA[2];
    if (cf !== null && cf !== undefined && m.folio !== undefined) r[cf] = m.folio;
  });
  return r;
}
const ENC = [['CONTROL DE FONDOS FIJOS'], ['RBD', 'ESTABLECIMIENTO']];
/** Valores únicos por mes y campo: sirven para detectar una columna mal leída. */
const val = (k, campo) => (k + 1) * 1000 + ({ saldo: 100, rendido: 200, obs: 300 })[campo] + 7;
const mesesUnicos = () => Object.fromEntries(COL.map(([mes, , cf], k) => [mes, { saldo: val(k, 'saldo'), rendido: val(k, 'rendido'), obs: val(k, 'obs'), folio: cf === null ? undefined : `F-${mes.slice(0, 3)}` }]));

/** Aplica una fila (de las de `fila()`, con los mismos `meses`) a un documento esperado, con la regla del importador: cupo, saldo inicial, rendido, observado y (marzo-septiembre) folio. */
function aplicarEsperado(doc, cupo, meses, folioMax = FOLIO_MAX) {
  const ff = doc.fondos_fijos = doc.fondos_fijos || { cupo: 0, meses: {} };
  ff.cupo = cupo;
  ff.meses = ff.meses || {};
  COL.forEach(([mes, , cf]) => {
    const m = meses[mes];
    if (!m) return;
    const x = ff.meses[mes] = ff.meses[mes] || {};
    x.saldo_inicial = m.saldo; x.rendido = m.rendido; x.observado = m.obs;
    if (cf !== null && m.folio !== undefined) x.folio = Array.from(String(m.folio).trim()).slice(0, folioMax).join('');
  });
}

async function importar(h, buffer, { nombre = 'control.xlsx', esperarAlert = true, idle = true } = {}) {
  const antes = h.dialogs.length;
  await h.page.setInputFiles('#importFondosFijosInput', { name: nombre, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
  for (let i = 0; i < 400 && esperarAlert && !h.dialogs.slice(antes).some(d => d.type === 'alert'); i++) await h.page.waitForTimeout(50);
  if (idle) await h.waitIdle();
  const ds = h.dialogs.slice(antes);
  return { confirm: (ds.find(d => d.type === 'confirm') || {}).message || null, alert: (ds.filter(d => d.type === 'alert').pop() || {}).message || null, dialogos: ds };
}
const abrirTab = async (h) => { await h.clickTab('fondos fijos'); };
const ord = (o) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
const sinBloqueo = (h) => h.page.evaluate(() => ({ btn: document.getElementById('importFondosFijosBtn').disabled, sync: document.getElementById('sync-text').textContent }));
const fondosEnServidor = async (h, id) => ((await h.store())[RUTA(id)] || {}).fondos_fijos;
const escrituras = async (h, id) => (await h.writes()).filter(w => w.path === RUTA(id) && w.payload && w.payload.fondos_fijos);

await correrSpec('fondos_fijos_importador', async (t) => {
  const docs = docsDe('fondos_fijos');
  const h = await boot({ fixture: 'fondos_fijos' });
  const { page } = h;
  await abrirTab(h);

  // ================================================================ 1-2. mapa de columnas, write por entidad y conservación
  const unicos = mesesUnicos();
  const libro1 = await libroXlsx(page, { [HOJA]: [...ENC, fila('1121', 600000, unicos), fila('1129', 77000, { MARZO: { saldo: 1, rendido: 2, obs: 3, folio: 'FF-X' } })] });
  const r1 = await importar(h, libro1);
  t.ok(/FONDOS FIJOS P02/.test(r1.confirm || '') && /conservar/.test(r1.confirm || ''), '1) pide confirmación y explica que Registrado en General, Compensado SIGFE y Reposición se conservan', r1.confirm);
  t.ok(/2 de 2 entidades guardadas/.test(r1.alert || ''), '1) el resumen dice «2 de 2 entidades guardadas»', r1.alert);
  t.ok(/Reposición entregada, Registrado en General y Compensado SIGFE/.test(r1.alert || ''), '1) y recuerda lo que queda pendiente de conciliación', r1.alert);
  const esp1 = { '1121': clon(docs['1121']), '1129': clon(docs['1129']) };
  aplicarEsperado(esp1['1121'], 600000, unicos);
  aplicarEsperado(esp1['1129'], 77000, { MARZO: { saldo: 1, rendido: 2, obs: 3, folio: 'FF-X' } });
  const s1121 = await fondosEnServidor(h, '1121');
  t.eq(s1121.cupo, 600000, '1) cupo = columna 7 (G)');
  const malMapa = [];
  COL.forEach(([mes, , cf], k) => {
    const m = s1121.meses[mes] || {};
    const e = { saldo_inicial: val(k, 'saldo'), rendido: val(k, 'rendido'), observado: val(k, 'obs') };
    ['saldo_inicial', 'rendido', 'observado'].forEach(c => { if (m[c] !== e[c]) malMapa.push(`${mes}.${c}: ${m[c]} ≠ ${e[c]}`); });
    if (cf !== null && m.folio !== `F-${mes.slice(0, 3)}`) malMapa.push(`${mes}.folio: ${m.folio}`);
  });
  t.eq(malMapa, [], '1) mapa de columnas: saldo inicial, rendido, observado y folio de cada mes de marzo a diciembre salen de las columnas indicadas (cada valor es único)');
  t.eq(JSON.stringify(s1121), JSON.stringify(esp1['1121'].fondos_fijos), '1) el documento completo = esperado: lo no importado (Registrado en General 120.000 / 80.000, Compensado SIGFE 60.000 / 80.000, Reposición 100.000) se conserva y las columnas con basura (777 / 888 / 999) no entran en ninguna parte');
  t.eq(s1121.meses.MARZO.registrado_general + s1121.meses.JUNIO.registrado_general + s1121.meses.MARZO.compensado_sigfe + s1121.meses.MARZO.reposicion, 120000 + 80000 + 60000 + 100000, '1) Registrado en General, Compensado SIGFE y Reposición intactos');
  t.eq((await fondosEnServidor(h, '1129')).meses.ENERO, esp1['1129'].fondos_fijos.meses.ENERO, '1) enero y febrero no existen en la planilla: lo guardado en enero (1129) no se toca');
  t.eq((await fondosEnServidor(h, '1129')).meses.MARZO, { saldo_inicial: 1, rendido: 2, observado: 3, folio: 'FF-X' }, '1) 1129: solo los meses que trae la fila');
  t.ok(((await fondosEnServidor(h, '1125')).meses.OCTUBRE).folio === 'FF-OCT', '1) una entidad que NO está en el archivo (1125) queda exactamente igual');
  const w = await escrituras(h, '1121');
  t.eq(w.length, 1, '2) un write por entidad importada');
  t.ok(w[0].options.merge === true, '2) con merge:true');
  t.eq(Object.keys(w[0].payload).filter(k => !['nombre', 'fondos_fijos', 'lastModifiedBy', 'lastModifiedAt'].includes(k)), [], '2) solo nombre, auditoría y fondos_fijos');
  t.eq(Object.keys(w[0].payload.fondos_fijos), ['cupo', 'meses'], '2) fondos_fijos = cupo + meses');
  t.eq(Object.keys(w[0].payload.fondos_fijos.meses.OCTUBRE), ['saldo_inicial', 'rendido', 'observado'], '2) octubre a diciembre viajan sin folio (la planilla no lo trae)');
  t.ok(!Object.values(w[0].payload.fondos_fijos.meses).some(m => 'registrado_general' in m || 'compensado_sigfe' in m || 'reposicion' in m), '2) y ningún mes lleva Registrado en General, Compensado SIGFE ni Reposición');
  // pantalla = servidor = esperado
  const docsE = clon(docs); docsE['1121'] = esp1['1121']; docsE['1129'] = esp1['1129'];
  const ff1 = await leerFilasFF(page);
  const malPant = IDS_FF.filter(id => { const e = ffEntidad(docsE, id), f = ff1[id]; return f.cupo !== fmt(e.cupo) || f.aceptado !== fmt(e.aceptado) || f.registrado !== fmt(e.registrado) || f.estado !== e.estado; });
  t.eq(malPant, [], '2) la tabla de Fondos Fijos quedó con lo importado en las dos entidades y sin cambios en las otras 66');
  // el modal abierto refleja el resultado
  await abrirFF(h, '1121');
  const mm = await leerModalFF(page);
  t.eq([mm.cupo, mm.meses.MARZO.rendido, mm.meses.MARZO.folio, mm.meses.OCTUBRE.folio], ['600000', String(val(0, 'rendido')), 'F-MAR', ''], '2) el modal muestra lo importado (cupo, rendido y folio de marzo; octubre no trae folio)');
  await cerrarFF(h);

  // idempotente: el mismo archivo otra vez
  const antesStore = JSON.stringify((await h.store())[RUTA('1121')].fondos_fijos);
  const antesTabla = JSON.stringify(await leerFilasFF(page));
  const r1b = await importar(h, libro1);
  t.ok(/2 de 2 entidades guardadas/.test(r1b.alert || ''), '2) reimportar el mismo archivo: otra vez 2 de 2 guardadas');
  t.eq(JSON.stringify((await h.store())[RUTA('1121')].fondos_fijos), antesStore, '2) idempotente: el documento del servidor queda idéntico');
  t.eq(JSON.stringify(await leerFilasFF(page)), antesTabla, '2) y la pantalla también');
  t.eq(await page.evaluate(() => document.getElementById('sync-indicator').className.includes('green')), true, '2) el indicador de sincronización termina en verde');

  // ================================================================ 3. filas vacías, fuera del universo, hoja con otro nombre, archivo sin la hoja, cancelar
  await h.clearWrites();
  const filaVacia = new Array(81).fill(null);
  const filaSoloNumeros = new Array(81).fill(null); filaSoloNumeros[9] = 5; // sin RBD: separador con basura
  const libro3 = await libroXlsx(page, { ['fondos fijos p02']: [...ENC, filaVacia, fila('1122', 111000, { ABRIL: { saldo: 10, rendido: 20, obs: 0, folio: 'OK-1122' } }), filaVacia, filaSoloNumeros,
    fila('AC', 5, { ABRIL: { saldo: 1, rendido: 1, obs: 0 } }), fila(9999, 5), fila('1121.5', 5), fila(-1121, 5), fila('TOTAL', 5), fila('5401006', 33000, { JULIO: { saldo: 33, rendido: 66, obs: 0 } }), fila('0', 1), fila('12abc', 1), fila(' 1123 ', 44000)] });
  const r3 = await importar(h, libro3);
  t.ok(/3 de 3 entidades guardadas/.test(r3.alert || ''), '3) la hoja se reconoce aunque su nombre venga en minúsculas y con espacios; 3 entidades válidas (1122, 5401006 y 1123 escrito como texto con espacios)', r3.alert);
  t.ok(/6 filas omitidas por no pertenecer al universo RBD\/GESPARVU/.test(r3.alert || ''), '3) y cuenta las 6 omitidas fuera del universo (AC, 9999, 1121.5, -1121, TOTAL y «12abc»; la fila con «0» es un separador vacío y no se cuenta)', r3.alert);
  t.eq(await fondosEnServidor(h, '1121') && JSON.stringify(await fondosEnServidor(h, '1121')), antesStore, '3) las filas fuera del universo no tocan nada: 1121 (que 1121.5 NO debe alcanzar) igual');
  t.eq(await fondosEnServidor(h, 'AC'), docs['AC'].fondos_fijos, '3) AC no es entidad de Fondos Fijos: su documento no se modifica');
  t.ok(!(await h.store())[RUTA('9999')], '3) y no se crea ningún documento para un id inexistente');
  t.eq(ord((await fondosEnServidor(h, '1122')).meses.ABRIL), ord({ rendido: 20, saldo_inicial: 10, observado: 0, folio: 'OK-1122' }), '3) 1122: importa su fila (una fila vacía y una con solo basura no son entidades y no se cuentan como omitidas)');
  t.eq((await fondosEnServidor(h, '1122')).meses.MARZO.folio, '', '3) una celda de folio vacía queda sin folio (no el texto «0» que deja el valor por defecto de la lectura de la hoja)');
  t.eq((await fondosEnServidor(h, '1123')).cupo, 44000, '3) «1123» como texto con espacios se reconoce');
  t.eq((await escrituras(h, 'AC')).length + (await escrituras(h, '9999')).length, 0, '3) 0 writes a entidades fuera del universo');

  await h.clearWrites();
  const libroSin = await libroXlsx(page, { 'OTRA HOJA': [...ENC, fila('1121', 1)], 'FONDOS FIJOS': [...ENC, fila('1121', 1)] });
  const rSin = await importar(h, libroSin);
  t.ok(/No se encontró la hoja “FONDOS FIJOS P02”\. No se importó nada\./.test(rSin.alert || ''), '3) un archivo sin la hoja «FONDOS FIJOS P02» avisa y no importa nada', rSin.alert);
  t.eq((await h.writes()).length, 0, '3) sin writes');
  const libroVacio = await libroXlsx(page, { [HOJA]: [...ENC, filaVacia, fila('AC', 1), fila('7777', 1)] });
  const rVacio = await importar(h, libroVacio);
  t.ok(/No se encontraron RBD o GESPARVU coincidentes para importar\. No se importó nada\./.test(rVacio.alert || '') && /2 filas omitidas/.test(rVacio.alert || ''), '3) una hoja sin entidades válidas lo dice, con el conteo de omitidas, y no importa nada', rVacio.alert);
  t.eq((await h.writes()).length, 0, '3) sin writes');
  const hc = await boot({ fixture: 'fondos_fijos', onDialog: async (d) => (d.type() === 'confirm' ? 'dismiss' : undefined) });
  await hc.clickTab('fondos fijos');
  const libroC = await libroXlsx(hc.page, { [HOJA]: [...ENC, fila('1121', 123456)] });
  await hc.page.setInputFiles('#importFondosFijosInput', { name: 'c.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: libroC });
  await hc.page.waitForTimeout(800);
  await hc.waitIdle();
  t.eq([(await hc.writes()).length, (await fondosEnServidor(hc, '1121')).cupo], [0, 500000], '3) cancelar la confirmación no escribe ni cambia nada');
  await hc.close();

  // ================================================================ 4. cantidades inválidas: la fila se rechaza completa; el resto se importa
  await h.clearWrites();
  const antes1128 = JSON.stringify(await fondosEnServidor(h, '1128'));
  const largo = 'F'.repeat(55);
  const libro4 = await libroXlsx(page, { [HOJA]: [...ENC,
    fila('1125', 250000, { ABRIL: { saldo: 1, rendido: -500, obs: 0 } }),                                   // negativo
    fila('1128', 'abc', { MARZO: { saldo: 1, rendido: 2, obs: 3 } }),                                        // texto en el cupo
    fila('1130', 1, { MAYO: { saldo: 1, rendido: 1e13, obs: 0 } }),                                          // ≥ MONTO_ABS_MAX
    fila('1131', 1, { JUNIO: { saldo: 1, rendido: Infinity, obs: 0 } }),                                     // no finito
    fila('1132', 1, { JUNIO: { saldo: 1, rendido: 5, obs: '#DIV/0!' } }),                                    // error de Excel
    fila('1133', 9999999999999, { JULIO: { saldo: 9999999999999, rendido: 1, obs: 0 } }),                    // justo bajo el tope: válido
    fila('1134', 10, { AGOSTO: { saldo: 0, rendido: '1.500.000', obs: '$ 500.000', folio: largo } }),         // textos numéricos con formato es-CL y folio largo
    fila('1135', 20, { SEPTIEMBRE: { saldo: 1, rendido: 2, obs: 3, folio: 123456 } })] });                   // folio numérico
  const r4 = await importar(h, libro4);
  t.ok(/3 de 3 entidades guardadas/.test(r4.alert || ''), '4) de 8 filas se importan 3 (1133, 1134 y 1135) y las otras 5 se rechazan', r4.alert);
  t.ok(/5 filas NO se importaron por tener un dato inválido/.test(r4.alert || ''), '4) el resumen cuenta las 5 filas rechazadas', r4.alert);
  ['1125', '1128', '1130', '1131', '1132'].forEach(id => t.ok(new RegExp(`· ${id}: `).test(r4.alert || ''), `4) el mensaje nombra la fila ${id} y su dato`, r4.alert));
  t.ok(/Abril: Rendido no puede ser negativo/.test(r4.alert || '') && /Cupo no es un número válido/.test(r4.alert || '') && /Mayo: Rendido es demasiado grande/.test(r4.alert || '') && /Junio: Rendido no es un número válido/.test(r4.alert || ''), '4) con el motivo claro de cada una (negativo, no es número, demasiado grande, no finito)', r4.alert);
  t.ok(/números finitos, no negativos y menores que \$10\.000\.000\.000\.000/.test(r4.alert || ''), '4) y la regla (finitos, no negativos, bajo el tope)', r4.alert);
  t.eq(JSON.stringify(await fondosEnServidor(h, '1128')), antes1128, '4) una fila rechazada no se importa ni a medias (1128 igual)');
  t.eq([(await escrituras(h, '1125')).length, (await escrituras(h, '1130')).length, (await escrituras(h, '1131')).length, (await escrituras(h, '1132')).length], [0, 0, 0, 0], '4) y no escribe nada de ellas');
  t.eq((await fondosEnServidor(h, '1133')).cupo, 9999999999999, '4) 9.999.999.999.999 (justo bajo el tope) se importa');
  const m1134 = (await fondosEnServidor(h, '1134')).meses.AGOSTO;
  t.eq([m1134.rendido, m1134.observado], [1500000, 500000], '4) los textos «1.500.000» y «$ 500.000» de la planilla se leen como pesos');
  t.eq([m1134.folio, Array.from(m1134.folio).length], ['F'.repeat(FOLIO_MAX), FOLIO_MAX], '4) un folio de 55 caracteres se recorta a 40');
  t.ok(/1 folio fue recortado a 40 caracteres/.test(r4.alert || ''), '4) y el resumen lo avisa', r4.alert);
  t.eq((await fondosEnServidor(h, '1135')).meses.SEPTIEMBRE.folio, '123456', '4) un folio numérico de la planilla se guarda como texto');
  const s1134 = await fondosEnServidor(h, '1134');
  t.eq(Object.keys(s1134.meses), COL.map(c => c[0]), '4) la planilla es la fuente de marzo a diciembre: los 10 meses viajan, los que vienen sin datos como $0 y sin folio');
  t.eq(Object.values(s1134.meses).filter(m => m.folio !== '' && m.folio !== undefined).map(m => m.folio), ['F'.repeat(FOLIO_MAX)], '4) y ningún mes sin folio queda con el texto «0»');

  // ================================================================ 5. fallo parcial
  await h.clearWrites();
  h.expectErrors(/Error guardando RBD 1136/, /Error guardando RBD 1140/);
  await h.mock('failNextWrite', 'permission-denied');
  const libro5 = await libroXlsx(page, { [HOJA]: [...ENC, fila('1136', 10, { MARZO: { saldo: 1, rendido: 2, obs: 0 } }), fila('1137', 20, { MARZO: { saldo: 3, rendido: 4, obs: 0 } }), fila('1139', 30, { MARZO: { saldo: 5, rendido: 6, obs: 0 } })] });
  const r5 = await importar(h, libro5);
  t.ok(/2 de 3 entidades guardadas/.test(r5.alert || ''), '5) con el primer guardado rechazado: «2 de 3 entidades guardadas»', r5.alert);
  t.ok(/NO se pudieron guardar 1 entidad: 1136\./.test(r5.alert || ''), '5) dice CUÁL no se guardó (1136)', r5.alert);
  t.ok(/No tienes permiso para guardar estos cambios/.test(r5.alert || ''), '5) y por qué (el motivo de PR #57 para permission-denied)', r5.alert);
  t.ok(/Reintentar/.test(r5.alert || '') && /importar el mismo archivo/.test(r5.alert || ''), '5) indica cómo reintentar (el botón «Reintentar» o volver a importar el mismo archivo)', r5.alert);
  let ff5 = await leerFilasFF(page);
  t.eq([ff5['1136'].cupo, ff5['1137'].cupo, ff5['1139'].cupo], [fmt(10), fmt(20), fmt(30)], '5) la pantalla NO queda a medias: las 3 entidades muestran lo importado (también la que no se guardó)');
  const sync5 = await page.evaluate(() => ({ txt: document.getElementById('sync-text').textContent, cls: document.getElementById('sync-indicator').className, retry: !document.getElementById('sync-retry').classList.contains('hidden') }));
  t.ok(/red/.test(sync5.cls) && /sin guardar/.test(sync5.txt) && sync5.retry, '5) el indicador de sincronización queda en rojo con «Reintentar» (estado de errores permanentes de la PR #57)', sync5);
  const s1136 = await fondosEnServidor(h, '1136');
  t.eq([!s1136, (await fondosEnServidor(h, '1137')).cupo, (await fondosEnServidor(h, '1139')).cupo], [true, 20, 30], '5) en el servidor: 1137 y 1139 sí; 1136 sigue sin Fondos Fijos');
  await page.click('#sync-retry');
  await h.waitIdle();
  await h.flushWrites();
  t.eq((await fondosEnServidor(h, '1136')).cupo, 10, '5) «Reintentar» guarda lo que faltaba (1136) sin volver a importar');
  t.ok(await page.evaluate(() => document.getElementById('sync-indicator').className.includes('green')), '5) y el indicador vuelve a verde');

  // error transitorio: el primer guardado falla con «unavailable» → queda pendiente y se reintenta solo
  await h.clearWrites();
  await h.mock('failNextWrite', 'unavailable');
  const libro6 = await libroXlsx(page, { [HOJA]: [...ENC, fila('1140', 41, { MARZO: { saldo: 1, rendido: 2, obs: 0 } }), fila('1142', 42, { MARZO: { saldo: 3, rendido: 4, obs: 0 } })] });
  const r6 = await importar(h, libro6);
  t.ok(/1 de 2 entidades guardadas/.test(r6.alert || '') && /1 entidad queda pendiente de confirmar por el servidor \(1140\)/.test(r6.alert || ''), '5) un error transitorio no se da por guardado ni por perdido: «1 entidad queda pendiente de confirmar» (1140)', r6.alert);
  t.eq((await leerFilasFF(page))['1140'].cupo, fmt(41), '5) y su dato está en pantalla');
  await page.waitForFunction(() => document.getElementById('sync-indicator').className.includes('green'), null, { timeout: 15000 });
  await h.waitIdle();
  t.eq((await fondosEnServidor(h, '1140')).cupo, 41, '5) el reintento automático (espera de 2 s) lo guarda solo');
  t.noErrores(h);
  await h.close();

  // ================================================================ 5b. sin conexión: no deja la pantalla esperando (plazo de 1,5 s en una copia del HTML)
  const { ruta } = resolverAppHtml();
  let html = fs.readFileSync(ruta, 'utf8');
  const original = 'const IMPORT_FONDOS_FIJOS_PLAZO_MS = 20000;';
  if (html.includes(original)) {
    html = html.replace(original, 'const IMPORT_FONDOS_FIJOS_PLAZO_MS = 1500;');
    fs.mkdirSync(TMP_DIR, { recursive: true });
    const copia = path.join(TMP_DIR, 'index_ff_plazo.html');
    fs.writeFileSync(copia, html);
    const ho = await boot({ fixture: 'fondos_fijos', html: copia });
    await ho.clickTab('fondos fijos');
    const libroO = await libroXlsx(ho.page, { [HOJA]: [...ENC, fila('1143', 71, { MARZO: { saldo: 1, rendido: 2, obs: 0 } }), fila('1144', 72, { MARZO: { saldo: 3, rendido: 4, obs: 0 } }), fila('1145', 73, { MARZO: { saldo: 5, rendido: 6, obs: 0 } })] });
    await ho.mock('setOffline', true);
    const t0 = Date.now();
    const rO = await importar(ho, libroO, { idle: false });
    const seg = (Date.now() - t0) / 1000;
    t.ok(seg < 8, `5b) sin conexión la importación termina en ${seg.toFixed(1)} s (el SDK no confirma hasta reconectar: no se espera 20 s por entidad)`, seg);
    t.ok(/0 de 3 entidades guardadas/.test(rO.alert || '') && /3 entidades quedan pendientes de confirmar por el servidor \(1143, 1144, 1145\)/.test(rO.alert || ''), '5b) informa las 3 entidades pendientes de confirmar', rO.alert);
    t.eq((await leerFilasFF(ho.page))['1145'].cupo, fmt(73), '5b) todo lo importado está en pantalla');
    await ho.mock('setOffline', false);
    await ho.waitIdle();
    await ho.page.waitForFunction(() => document.getElementById('sync-indicator').className.includes('green'), null, { timeout: 15000 });
    await ho.waitIdle();
    t.eq([(await fondosEnServidor(ho, '1143')).cupo, (await fondosEnServidor(ho, '1144')).cupo, (await fondosEnServidor(ho, '1145')).cupo], [71, 72, 73], '5b) al reconectar el servidor recibe las 3 entidades (la cola del SDK las conserva)');
    await ho.close();
  } else t.ok(false, '5b) el index.html declara IMPORT_FONDOS_FIJOS_PLAZO_MS = 20000');
});
