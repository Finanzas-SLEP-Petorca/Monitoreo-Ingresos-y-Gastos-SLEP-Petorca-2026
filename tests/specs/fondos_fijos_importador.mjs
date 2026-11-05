// fondos_fijos_importador (PR K, adaptado al REEMPLAZO TOTAL) — «⬆ Importar Control Fondos Fijos» (hoja «FONDOS FIJOS P02»). Fixture `fondos_fijos`.
//
//   1. el mapa de columnas (RBD, cupo y, por mes de marzo a diciembre, saldo inicial, rendido, observado y folio); lo que la planilla no identifica (Registrado en General, Compensado SIGFE,
//      Reposición) NO se toca y las columnas intermedias NO se leen; enero y febrero no se tocan (la hoja no los trae); octubre a diciembre no traen folio; TODAS las entidades quedan como la
//      hoja (una que no aparece queda en blanco en lo que la hoja gestiona)
//   2. el write de cada entidad que cambia = SOLO `fondos_fijos.*` con `mergeFields` (no merge:true) en un writeBatch; reimportar el mismo archivo es idempotente (sin escrituras)
//   3. filas vacías ignoradas; entidades FUERA del universo (AC, ids inexistentes, decimales, negativos, texto) RECHAZADAS con su motivo (antes se «omitían» contándolas); hoja con otro nombre en
//      mayúsculas / espacios; archivo sin la hoja; Cancelar
//   4. cantidades inválidas (texto, ±Infinity, negativas, ≥ MONTO_ABS_MAX): la FILA se rechaza completa con motivo y el resto se importa; el folio se recorta a 40 con aviso
//   5. un servidor que RECHAZA el batch: error visible y la pantalla vuelve a lo guardado
// Ya no existen el `confirm()`/`alert` del importador ni su guardado entidad por entidad («N de M guardadas», «Reintentar», plazo de 20 s sin conexión): ahora es UN batch con resumen de control y
// cuadratura (ver tests/README, «Carga por fuente = reemplazo total»; el SDK real lo cubre 18_carga_sep_ff).
import { boot } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { docsDe, clon } from '../lib/corte.mjs';
import { libroXlsx } from '../lib/compras.mjs';
import { subirYConfirmar, leerModalCarga } from '../lib/carga.mjs';
import { IDS_FF, leerFilasFF, fmt, FOLIO_MAX } from '../lib/fondos_fijos.mjs';

const RUTA = (id) => `sep_carga_rbd/${id}`;
const HOJA = 'FONDOS FIJOS P02';
const COL = [['MARZO', 7, 13], ['ABRIL', 15, 21], ['MAYO', 23, 29], ['JUNIO', 31, 37], ['JULIO', 39, 45], ['AGOSTO', 47, 53], ['SEPTIEMBRE', 55, 61], ['OCTUBRE', 63, null], ['NOVIEMBRE', 69, null], ['DICIEMBRE', 75, null]];
const MESES12 = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const BASURA = [777, 888, 999]; // en las columnas que el importador NO debe leer (ini+1, ini+4, ini+5)

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
const val = (k, campo) => (k + 1) * 1000 + ({ saldo: 100, rendido: 200, obs: 300 })[campo] + 7; // únicos por mes y campo: detectan una columna mal leída
const mesesUnicos = () => Object.fromEntries(COL.map(([mes, , cf], k) => [mes, { saldo: val(k, 'saldo'), rendido: val(k, 'rendido'), obs: val(k, 'obs'), folio: cf === null ? undefined : `F-${mes.slice(0, 3)}` }]));
/** Documento esperado con la regla del REEMPLAZO: marzo–diciembre salen de la fila (lo que no trae = 0 / sin folio); enero, febrero, folios de oct–dic y lo manual se conservan. */
function aplicarEsperado(doc, cupo, meses) {
  const ff = doc.fondos_fijos = doc.fondos_fijos || { cupo: 0, meses: {} };
  ff.cupo = cupo; ff.meses = ff.meses || {};
  COL.forEach(([mes, , cf]) => {
    const m = meses[mes] || {}, x = ff.meses[mes] = ff.meses[mes] || {};
    x.saldo_inicial = m.saldo || 0; x.rendido = m.rendido || 0; x.observado = m.obs || 0;
    if (cf !== null) x.folio = m.folio !== undefined ? Array.from(String(m.folio).trim()).slice(0, FOLIO_MAX).join('') : '';
  });
}
// Un mes sin datos = un mes con todo en 0 (la lectura los rellena)
const rellena = (f) => { const o = { cupo: (f && f.cupo) || 0, meses: {} }; MESES12.forEach(mes => { const m = ((f || {}).meses || {})[mes] || {}; o.meses[mes] = { saldo_inicial: m.saldo_inicial || 0, rendido: m.rendido || 0, observado: m.observado || 0, registrado_general: m.registrado_general || 0, compensado_sigfe: m.compensado_sigfe || 0, reposicion: m.reposicion || 0, folio: m.folio || '' }; }); return o; };
const fondosEnServidor = async (h, id) => ((await h.store())[RUTA(id)] || {}).fondos_fijos;
const sub = (h, buffer, o) => subirYConfirmar(h, 'fondos_fijos', buffer, o);
const escribio = async (h) => (await h.writes()).filter(x => x.path.startsWith('sep_carga_rbd/'));

await correrSpec('fondos_fijos_importador', async (t) => {
  const docs = docsDe('fondos_fijos');
  const h = await boot({ autoCarga: false, fixture: 'fondos_fijos' });
  const { page } = h;
  await h.clickTab('fondos fijos');

  // ===== 1-2. mapa de columnas, write por entidad y conservación
  const unicos = mesesUnicos();
  const libro1 = await libroXlsx(page, { [HOJA]: [...ENC, fila('1121', 600000, unicos), fila('1129', 77000, { MARZO: { saldo: 1, rendido: 2, obs: 3, folio: 'FF-X' } })] });
  const r1 = await sub(h, libro1);
  t.ok(/Revisar carga · Fondos Fijos/.test(r1.control.titulo) && /No se toca Registrado en General, Compensado SIGFE ni Reposición/.test(r1.control.texto), '1) el resumen de control explica que lo manual se conserva', r1.control.texto.slice(0, 400));
  t.ok(/aplicado y verificado/.test(r1.resultado.texto), '1) la cuadratura dice que el panel coincide con el libro', r1.resultado.texto.slice(0, 200));
  const esp = clon(docs);
  IDS_FF.forEach(id => aplicarEsperado(esp[id], 0, {}));       // todas quedan como la hoja: las que no aparecen, en blanco
  aplicarEsperado(esp['1121'], 600000, unicos);
  aplicarEsperado(esp['1129'], 77000, { MARZO: { saldo: 1, rendido: 2, obs: 3, folio: 'FF-X' } });
  const s1121 = await fondosEnServidor(h, '1121');
  t.eq(s1121.cupo, 600000, '1) cupo = columna 7 (G)');
  const malMapa = [];
  COL.forEach(([mes, , cf], k) => {
    const m = s1121.meses[mes] || {};
    const e = { saldo_inicial: val(k, 'saldo'), rendido: val(k, 'rendido'), observado: val(k, 'obs') };
    ['saldo_inicial', 'rendido', 'observado'].forEach(c => { if (m[c] !== e[c]) malMapa.push(`${mes}.${c}: ${m[c]} ≠ ${e[c]}`); });
    if (cf !== null && m.folio !== `F-${mes.slice(0, 3)}`) malMapa.push(`${mes}.folio: ${m.folio}`);
  });
  t.eq(malMapa, [], '1) mapa de columnas: saldo inicial, rendido, observado y folio de cada mes de marzo a diciembre salen de las columnas indicadas');
  const st = await h.store();
  t.eq(IDS_FF.filter(id => JSON.stringify(rellena(st[RUTA(id)].fondos_fijos)) !== JSON.stringify(rellena(esp[id].fondos_fijos))), [], '1) las 68 entidades quedan como la hoja (lo manual, enero/febrero y los folios de oct–dic se conservan; la basura 777/888/999 no entra)');
  t.eq(s1121.meses.MARZO.registrado_general + s1121.meses.JUNIO.registrado_general + s1121.meses.MARZO.compensado_sigfe + s1121.meses.MARZO.reposicion, 120000 + 80000 + 60000 + 100000, '1) Registrado en General, Compensado SIGFE y Reposición intactos');
  t.eq((await fondosEnServidor(h, '1129')).meses.ENERO, docs['1129'].fondos_fijos.meses.ENERO, '1) enero y febrero no existen en la planilla: lo guardado en enero (1129) no se toca');
  t.eq((await fondosEnServidor(h, '1125')).meses.OCTUBRE.rendido, 0, '1) una entidad que NO está en el archivo (1125) queda en blanco en lo que la hoja gestiona');
  t.eq((await fondosEnServidor(h, '1125')).meses.OCTUBRE.folio, 'FF-OCT', '1) ... y conserva el folio de octubre (la hoja no lo trae)');
  const w = (await escribio(h)).filter(x => x.path === RUTA('1121'));
  t.eq(w.length, 1, '2) un write por entidad que cambia');
  t.ok(w[0].options.merge === false && Array.isArray(w[0].options.mergeFields), '2) con mergeFields (no merge:true)');
  t.ok(w[0].options.mergeFields.every(f => /^(lastModifiedBy|lastModifiedAt|nombre|fondos_fijos\.)/.test(f)), '2) solo nombre, auditoría y rutas fondos_fijos.*', w[0].options.mergeFields.slice(0, 6));
  t.ok(!w[0].options.mergeFields.some(f => /registrado_general|compensado_sigfe|reposicion|meses\.(ENERO|FEBRERO)|meses\.(OCTUBRE|NOVIEMBRE|DICIEMBRE)\.folio/.test(f)), '2) ninguna ruta toca lo manual, enero/febrero ni folios de octubre a diciembre');
  const ff1 = await leerFilasFF(page);
  t.eq(ff1['1121'].cupo, fmt(600000), '2) la tabla de Fondos Fijos ya muestra el cupo importado');

  await h.clearWrites();
  const r1b = await sub(h, libro1);
  t.ok(/idéntico a lo que ya hay/.test(r1b.control.texto) && /Sin cambios/.test(r1b.resultado.texto), '2) reimportar el mismo archivo: «idéntico», sin cambios');
  t.eq((await escribio(h)).length, 0, '2) idempotente: no se escribe nada');

  // ===== 3. filas vacías, fuera del universo, hoja con otro nombre, archivo sin la hoja, cancelar
  await h.clearWrites();
  const filaVacia = new Array(81).fill(null);
  const filaSoloNumeros = new Array(81).fill(null); filaSoloNumeros[9] = 5;
  const libro3 = await libroXlsx(page, { ['fondos fijos p02']: [...ENC, filaVacia, fila('1122', 111000, { ABRIL: { saldo: 10, rendido: 20, obs: 0, folio: 'OK-1122' } }), filaVacia, filaSoloNumeros,
    fila('AC', 5, { ABRIL: { saldo: 1, rendido: 1, obs: 0 } }), fila(9999, 5), fila('1121.5', 5), fila(-1121, 5), fila('TOTAL', 5), fila('5401006', 33000, { JULIO: { saldo: 33, rendido: 66, obs: 0 } }), fila('0', 1), fila('12abc', 1), fila(' 1123 ', 44000)] });
  const r3 = await sub(h, libro3, { confirmar: false, cerrar: false });
  t.ok(/Filas que NO se cargarán \(6\)/.test(r3.control.texto), '3) hoja en minúsculas y con espacios reconocida; 6 filas fuera del universo RECHAZADAS con motivo (AC, 9999, 1121.5, -1121, TOTAL, «12abc»)', r3.control.texto.slice(-900));
  t.ok(/fila \d+: el id "AC" no es un RBD ni un GESPARVU/.test(r3.control.texto), '3) cada una con hoja, fila y motivo (AC incluida)');
  t.ok(/filas? sin id/.test(r3.control.texto), '3) las filas sin id (separadores) se ignoran con aviso', r3.control.texto.slice(0, 900));
  await page.click('#cargaCancelarBtn'); await h.waitIdle();
  t.eq((await escribio(h)).length, 0, '3) Cancelar no escribe ni cambia nada');
  const rOk = await sub(h, libro3);
  t.ok(/aplicado y verificado/.test(rOk.resultado.texto), '3) confirmar aplica y cuadra');
  t.eq(await fondosEnServidor(h, 'AC'), docs['AC'].fondos_fijos, '3) AC no es entidad de Fondos Fijos: su documento no se modifica');
  t.ok(!(await h.store())[RUTA('9999')], '3) no se crea ningún documento para un id inexistente');
  t.eq((await fondosEnServidor(h, '1122')).meses.ABRIL.folio, 'OK-1122', '3) 1122 importa su fila');
  t.eq((await fondosEnServidor(h, '1122')).meses.MARZO.folio, '', '3) una celda de folio vacía queda sin folio (no «0»)');
  t.eq((await fondosEnServidor(h, '1123')).cupo, 44000, '3) «1123» como texto con espacios se reconoce');
  t.eq((await fondosEnServidor(h, '1121')).cupo, 0, '3) 1121 (ausente de este libro) queda en blanco por el reemplazo');

  await h.clearWrites();
  const libroSin = await libroXlsx(page, { 'OTRA HOJA': [...ENC, fila('1121', 1)], 'FONDOS FIJOS': [...ENC, fila('1121', 1)] });
  await page.setInputFiles('#importFondosFijosInput', { name: 'sin.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: libroSin });
  await page.waitForSelector('#cargaCerrarBtn');
  t.ok(/No se encontró la hoja “FONDOS FIJOS P02”\. No se importó nada\./.test((await leerModalCarga(page)).texto), '3) un archivo sin la hoja avisa y no importa nada');
  await page.click('#cargaCerrarBtn'); await h.waitIdle();
  t.eq((await h.writes()).length, 0, '3) sin writes');

  // ===== 4. cantidades inválidas
  await h.clearWrites();
  const libro4 = await libroXlsx(page, { [HOJA]: [...ENC,
    fila('1125', 250000, { ABRIL: { saldo: 1, rendido: -500, obs: 0 } }),
    fila('1128', 'abc', { MARZO: { saldo: 1, rendido: 2, obs: 3 } }),
    fila('1130', 1, { MAYO: { saldo: 1, rendido: 1e13, obs: 0 } }),
    fila('1131', 1, { JUNIO: { saldo: 1, rendido: Infinity, obs: 0 } }),
    fila('1132', 1, { JUNIO: { saldo: 1, rendido: 5, obs: '#DIV/0!' } }),
    fila('1133', 9999999999999, { JULIO: { saldo: 9999999999999, rendido: 1, obs: 0 } }),
    fila('1134', 10, { AGOSTO: { saldo: 0, rendido: '1.500.000', obs: '$ 500.000', folio: 'F'.repeat(55) } }),
    fila('1135', 20, { SEPTIEMBRE: { saldo: 1, rendido: 2, obs: 3, folio: 123456 } })] });
  const r4 = await sub(h, libro4, { cerrar: false });
  const tx = r4.control.texto;
  t.ok(/Filas que NO se cargarán \(5\)/.test(tx), '4) de 8 filas se cargan 3 y 5 se rechazan', tx.slice(-1200));
  t.ok(/FONDOS FIJOS P02 \d+ \$[\d.]+ 8 5 3 /.test(tx), '4) leídas (8) = cargadas (3) + rechazadas (5)', (tx.match(/FONDOS FIJOS P02[^A-Z]{0,90}/) || [''])[0]);
  t.ok(/Abril: Rendido no puede ser negativo/.test(tx) && /Cupo no es un número válido/.test(tx) && /Mayo: Rendido es demasiado grande/.test(tx) && /Junio: Rendido no es un número válido/.test(tx), '4) motivo claro de cada una', tx.slice(-1200));
  t.ok(/1 folio se recortó a 40 caracteres/.test(tx), '4) aviso del folio recortado');
  t.ok(/aplicado y verificado/.test(r4.resultado.texto), '4) la carga cuadra');
  await page.click('#cargaCerrarBtn'); await h.flushWrites(); await h.waitIdle();
  t.eq(rellena(await fondosEnServidor(h, '1128')).cupo, 0, '4) una fila rechazada no se importa ni a medias: 1128 queda como entidad ausente (en blanco)');
  t.eq((await fondosEnServidor(h, '1133')).cupo, 9999999999999, '4) justo bajo el tope se importa');
  const m1134 = (await fondosEnServidor(h, '1134')).meses.AGOSTO;
  t.eq([m1134.rendido, m1134.observado], [1500000, 500000], '4) «1.500.000» y «$ 500.000» se leen como pesos');
  t.eq(Array.from(m1134.folio).length, FOLIO_MAX, '4) folio de 55 caracteres recortado a 40');
  t.eq((await fondosEnServidor(h, '1135')).meses.SEPTIEMBRE.folio, '123456', '4) folio numérico guardado como texto');

  // ===== 5. el servidor RECHAZA el batch
  await h.clearWrites();
  h.expectErrors(/Error guardando la carga/);
  const antes5 = JSON.stringify(rellena(await fondosEnServidor(h, '1136')));
  await h.mock('failNextWrite', 'permission-denied');
  const r5 = await sub(h, await libroXlsx(page, { [HOJA]: [...ENC, fila('1136', 10, { MARZO: { saldo: 1, rendido: 2, obs: 0 } })] }), { cerrar: false });
  t.ok(/El servidor NO guardó la carga/.test(r5.resultado.texto) && /No tienes permiso para guardar estos cambios/.test(r5.resultado.texto), '5) dice que el servidor NO guardó y por qué', r5.resultado.texto.slice(0, 400));
  t.ok(/la carga no se guardó en el servidor/.test((await leerModalCarga(page)).banner), '5) banner rojo persistente');
  await page.click('#cargaCerrarBtn'); await page.click('#cargaBannerCerrar'); await h.waitIdle();
  t.eq(JSON.stringify(rellena(await fondosEnServidor(h, '1136'))), antes5, '5) el servidor conserva lo que había');
  t.eq((await leerFilasFF(page))['1136'].cupo, fmt(rellena(await fondosEnServidor(h, '1136')).cupo), '5) la pantalla volvió a lo guardado');
  t.noErrores(h);
  await h.close();
});
