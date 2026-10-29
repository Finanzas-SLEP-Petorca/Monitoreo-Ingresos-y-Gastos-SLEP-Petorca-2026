// fondos_fijos_validacion (PR K, endurecimiento) — lo que se TECLEA en el modal de Fondos Fijos y su seguridad. Fixture `fondos_fijos`.
//
//   1. montos: solo números FINITOS y no negativos bajo MONTO_ABS_MAX; un valor rechazado NO se guarda (0 writes), avisa con un mensaje claro y la celda vuelve a lo guardado; vacío = 0; el tope exacto vale
//   2. folio: hasta 40 caracteres (se cuentan caracteres, no unidades UTF-16); más largo se guarda recortado y se AVISA; en el borde (40) no hay aviso; los espacios de los bordes se quitan
//   3. claves de mapa y entidades: una celda con `data-ff-campo` / `data-ff-mes` / `data-ff-rbd` manipulados (otro campo, `__proto__`, `__x__`, AC, un id inexistente) NO escribe ni crea documentos
//   4. errores de guardado: un rechazo permanente deja el cambio en pantalla, el indicador en rojo con «Reintentar» (también dentro del modal) y el reintento lo guarda
//   5. XSS: un folio con marcado se ve literal (en la celda y tras recargar) y no se ejecuta; un id de entidad hostil (copia del HTML con un GESPARVU de código `5402002"><img …>`) no inyecta nada ni en
//      `data-ff-rbd` / `data-ff-abrir` de la tabla ni en los `data-ff-*` del modal
import fs from 'node:fs';
import path from 'node:path';
import { boot } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { TMP_DIR } from '../lib/config.mjs';
import { resolverAppHtml } from '../lib/html-source.mjs';
import { docsDe, clon } from '../lib/corte.mjs';
import { abrirFF, cerrarFF, escribirFF, celdaFF, leerModalFF, FOLIO_MAX, fmt } from '../lib/fondos_fijos.mjs';

const RUTA = (id) => `sep_carga_rbd/${id}`;
const escrituras = async (h, id) => (await h.writes()).filter(w => w.path === RUTA(id) && w.payload && w.payload.fondos_fijos);
const alertas = (h, desde) => h.dialogs.slice(desde).filter(d => d.type === 'alert').map(d => d.message);
const valorCelda = (page, sel) => page.evaluate((s) => document.querySelector(s).value, sel);
const guardado = async (h, id) => ((await h.store())[RUTA(id)] || {}).fondos_fijos;

await correrSpec('fondos_fijos_validacion', async (t) => {
  const docs = docsDe('fondos_fijos');
  const h = await boot({ fixture: 'fondos_fijos' });
  const { page } = h;
  await abrirFF(h, '1122');
  const obs = celdaFF('1122', 'ABRIL', 'observado');
  const rend = celdaFF('1122', 'ABRIL', 'rendido');
  const antes = JSON.stringify(await guardado(h, '1122'));

  // ================================================================ 1. montos
  let d0 = h.dialogs.length;
  await escribirFF(h, obs, '-5000');
  await h.flushWrites();
  let a = alertas(h, d0);
  t.eq((await escrituras(h, '1122')).length, 0, '1) un monto NEGATIVO no se guarda (0 writes)');
  t.ok(a.length === 1 && /Monto observado de Abril: no puede ser negativo\. No se guardó/.test(a[0]), '1) y avisa con un mensaje claro que nombra la celda', a);
  t.eq(await valorCelda(page, obs), '', '1) la celda vuelve al valor guardado (vacío = 0), no se queda con -5000');
  t.eq(JSON.stringify(await guardado(h, '1122')), antes, '1) el servidor no cambió');

  d0 = h.dialogs.length;
  await escribirFF(h, rend, '10000000000000');   // 1e13 = MONTO_ABS_MAX
  await h.flushWrites();
  a = alertas(h, d0);
  t.ok((await escrituras(h, '1122')).length === 0 && a.length === 1 && /Rendido por director\(a\) de Abril: es demasiado grande \(el máximo es \$9\.999\.999\.999\.999\)/.test(a[0]), '1) un monto igual o mayor que MONTO_ABS_MAX (1e13) se rechaza con el máximo permitido', a);
  t.eq(await valorCelda(page, rend), '100000', '1) y la celda conserva lo guardado (100000)');

  // no finito / texto: el <input type=number> devuelve '' con badInput; antes eso se guardaba como 0 y BORRABA el dato
  d0 = h.dialogs.length;
  await page.click(rend);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('1e999');
  const bad = await page.evaluate((s) => ({ v: document.querySelector(s).value, bad: document.querySelector(s).validity.badInput }), rend);
  await page.keyboard.press('Tab');
  await h.waitIdle(); await h.flushWrites();
  a = alertas(h, d0);
  t.ok(bad.bad && (await escrituras(h, '1122')).length === 0, '1) «1e999» (infinito) / texto a medias: el navegador lo marca como no válido y NO se guarda un 0 (que borraría el dato)', { bad, writes: (await escrituras(h, '1122')).length });
  t.ok(a.length === 1 && /no es un número válido/.test(a[0]), '1) con el aviso «no es un número válido»', a);
  t.eq(await valorCelda(page, rend), '100000', '1) y la celda conserva lo guardado');

  // lo válido sigue funcionando: el tope exacto, un decimal y vaciar
  await h.clearWrites();
  await escribirFF(h, obs, '9999999999999');
  await h.flushWrites();
  let w = await escrituras(h, '1122');
  t.eq([w.length, w[0] && JSON.stringify(w[0].payload.fondos_fijos)], [1, JSON.stringify({ meses: { ABRIL: { observado: 9999999999999 } } })], '1) 9.999.999.999.999 (justo bajo el tope) se guarda');
  await h.clearWrites();
  await escribirFF(h, obs, '');
  await h.flushWrites();
  w = await escrituras(h, '1122');
  t.eq([w.length, w[0] && JSON.stringify(w[0].payload.fondos_fijos)], [1, JSON.stringify({ meses: { ABRIL: { observado: 0 } } })], '1) vaciar la celda = 0 (vacío es «sin valor»; escribe 0, no borra la clave)');
  await h.clearWrites();
  await escribirFF(h, obs, '12.5');
  await h.flushWrites();
  w = await escrituras(h, '1122');
  t.eq(w[0] && w[0].payload.fondos_fijos.meses.ABRIL.observado, 12.5, '1) un decimal finito se guarda tal cual (como en las demás celdas de monto)');
  await h.clearWrites();
  await escribirFF(h, celdaFF('1122', null, 'cupo'), '-1');
  await h.flushWrites();
  t.ok((await escrituras(h, '1122')).length === 0 && /Cupo vigente: no puede ser negativo/.test(alertas(h, d0).pop() || ''), '1) el cupo también rechaza un negativo (mensaje «Cupo vigente: …»)', alertas(h, d0));
  const cupoTras = await valorCelda(page, celdaFF('1122', null, 'cupo'));
  t.eq(cupoTras, '300000', '1) y vuelve a 300000');
  // ningún valor guardado es NaN / Infinity / negativo tras todo lo anterior
  const numeros = []; const recorrer = (o) => { if (o && typeof o === 'object') Object.values(o).forEach(recorrer); else numeros.push(o); };
  recorrer(await guardado(h, '1122'));
  t.ok(numeros.every(v => v === null ? false : (typeof v === 'number' ? Number.isFinite(v) && v >= 0 : typeof v === 'string')), '1) el documento del servidor no tiene NaN, Infinity, nulos ni números negativos', numeros);

  // ================================================================ 2. folio
  const folio = celdaFF('1122', 'MAYO', 'folio');
  await h.clearWrites();
  d0 = h.dialogs.length;
  await escribirFF(h, folio, 'X'.repeat(FOLIO_MAX));
  await h.flushWrites();
  w = await escrituras(h, '1122');
  t.ok(w.length === 1 && w[0].payload.fondos_fijos.meses.MAYO.folio === 'X'.repeat(FOLIO_MAX) && alertas(h, d0).length === 0, `2) un folio de exactamente ${FOLIO_MAX} caracteres se guarda completo y sin aviso`, alertas(h, d0));
  await h.clearWrites();
  d0 = h.dialogs.length;
  await escribirFF(h, folio, 'Y'.repeat(FOLIO_MAX + 1));
  await h.flushWrites();
  w = await escrituras(h, '1122');
  a = alertas(h, d0);
  t.eq(w.length === 1 && w[0].payload.fondos_fijos.meses.MAYO.folio, 'Y'.repeat(FOLIO_MAX), `2) un folio de ${FOLIO_MAX + 1} caracteres se guarda recortado a ${FOLIO_MAX}`);
  t.ok(a.length === 1 && new RegExp(`demasiado largo.*recortado a ${FOLIO_MAX} caracteres`).test(a[0]) && a[0].includes('Mayo'), '2) y avisa con un mensaje claro (recortado a 40, mes de la celda)', a);
  t.eq(await valorCelda(page, folio), 'Y'.repeat(FOLIO_MAX), '2) la celda muestra el folio ya recortado');
  await h.clearWrites();
  d0 = h.dialogs.length;
  await escribirFF(h, folio, '😀'.repeat(FOLIO_MAX + 5));
  await h.flushWrites();
  w = await escrituras(h, '1122');
  t.eq(w.length === 1 && Array.from(w[0].payload.fondos_fijos.meses.MAYO.folio).length, FOLIO_MAX, '2) el largo cuenta caracteres, no unidades UTF-16: 45 emojis → 40 emojis completos (ningún par partido)');
  t.ok(w[0] && !/[\ud800-\udbff](?![\udc00-\udfff])/.test(w[0].payload.fondos_fijos.meses.MAYO.folio), '2) sin sustitutos sueltos');
  await h.clearWrites();
  await escribirFF(h, folio, '   FF-9   ');
  await h.flushWrites();
  w = await escrituras(h, '1122');
  t.eq(w[0] && w[0].payload.fondos_fijos.meses.MAYO.folio, 'FF-9', '2) los espacios de los bordes se quitan');
  await h.clearWrites();
  await escribirFF(h, folio, '');
  await h.flushWrites();
  w = await escrituras(h, '1122');
  t.eq(w[0] && w[0].payload.fondos_fijos.meses.MAYO.folio, '', '2) vaciar el folio guarda texto vacío');

  // ================================================================ 3. claves de mapa y entidades manipuladas
  await h.clearWrites();
  d0 = h.dialogs.length;
  const manipular = (cambios) => page.evaluate(([s, c]) => {
    const el = document.querySelector(s);
    const prev = { ...el.dataset };
    Object.entries(c).forEach(([k, v]) => { el.dataset[k] = v; });
    el.value = '777';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    Object.keys(c).forEach(k => { if (prev[k] === undefined) delete el.dataset[k]; else el.dataset[k] = prev[k]; });
  }, [rend, cambios]);
  const casos = [
    ['campo desconocido', { ffCampo: 'bypass' }], ['campo __proto__', { ffCampo: '__proto__' }], ['campo constructor', { ffCampo: 'constructor' }], ['campo con punto', { ffCampo: 'rendido.x' }],
    ['mes __x__', { ffMes: '__x__' }], ['mes inexistente', { ffMes: 'ENERO2' }], ['mes en minúscula', { ffMes: 'abril' }], ['mes vacío con campo mensual', { ffMes: '' }],
    ['entidad AC', { ffRbd: 'AC' }], ['entidad inexistente', { ffRbd: '9999' }], ['entidad con barra', { ffRbd: 'sep_carga_rbd/1121' }], ['entidad vacía', { ffRbd: '' }],
  ];
  for (const [nombre, c] of casos) {
    const n0 = (await h.writes()).length;
    await manipular(c);
    await h.page.waitForTimeout(550); // pasa el debounce de 400 ms: si hubiera algo pendiente, ya se habría escrito
    await h.waitIdle();
    t.eq([(await h.writes()).length - n0, alertas(h, d0).length], [0, 0], `3) ${nombre}: el cambio se ignora (0 writes, ningún documento nuevo, sin aviso)`);
  }
  t.ok(!(await h.store())[RUTA('AC')] || JSON.stringify((await guardado(h, 'AC'))) === JSON.stringify(docs['AC'].fondos_fijos), '3) el documento de AC no se tocó y no se creó el de «9999» ni «sep_carga_rbd/1121»', Object.keys(await h.store()).filter(k => /9999|sep_carga_rbd\/sep/.test(k)));
  t.ok(!Object.keys(await h.store()).some(k => /9999/.test(k)), '3) no se creó ningún documento nuevo');
  await cerrarFF(h);

  // ================================================================ 4. error de guardado permanente: queda en pantalla, rojo con «Reintentar» (también dentro del modal)
  h.expectErrors(/Error guardando RBD 1125/);
  await abrirFF(h, '1125');
  await h.mock('failNextWrite', 'permission-denied');
  await escribirFF(h, celdaFF('1125', 'NOVIEMBRE', 'rendido'), 4321);
  await h.flushWrites();
  await page.waitForFunction(() => document.getElementById('sync-indicator').className.includes('red'), null, { timeout: 8000 });
  const rojo = await page.evaluate(() => ({ txt: document.getElementById('sync-text').textContent, retry: !document.getElementById('sync-retry').classList.contains('hidden'),
    enModal: (() => { const m = document.querySelector('#fondosFijosModal .modal-sync'); return { visible: !m.classList.contains('hidden'), retry: !m.querySelector('.modal-sync-retry').classList.contains('hidden') }; })() }));
  t.ok(/sin guardar/.test(rojo.txt) && rojo.retry, '4) un rechazo permanente deja el indicador en rojo («cambios sin guardar») con «Reintentar»', rojo);
  t.ok(rojo.enModal.visible && rojo.enModal.retry, '4) y el aviso con «Reintentar» también se ve DENTRO del modal de Fondos Fijos (el modal cubre la barra de estado)', rojo);
  t.eq(await valorCelda(page, celdaFF('1125', 'NOVIEMBRE', 'rendido')), '4321', '4) el valor tecleado sigue en pantalla');
  await page.click('#fondosFijosModal .modal-sync-retry');
  await h.waitIdle(); await h.flushWrites();
  t.eq(((await guardado(h, '1125')).meses.NOVIEMBRE || {}).rendido, 4321, '4) «Reintentar» (desde el modal) lo guarda');
  await cerrarFF(h);

  // ================================================================ 5. XSS
  await abrirFF(h, '1129');
  const mx = await leerModalFF(page);
  t.eq(mx.meses.ENERO.folio, '<img src=x onerror=alert(1)>&"\'', '5) el folio con marcado del fixture se ve LITERAL en la celda (sin interpretarse)');
  t.eq(await page.evaluate(() => document.querySelectorAll('#fondosFijosModalBody img, #fondosFijosTbody img, #app img[src="x"]').length), 0, '5) y no se inyecta ninguna <img>');
  await escribirFF(h, celdaFF('1129', 'FEBRERO', 'folio'), '<script>window.__xss=1</script>"&\'');
  await h.flushWrites();
  t.eq((await guardado(h, '1129')).meses.FEBRERO.folio, '<script>window.__xss=1</script>"&\'', '5) un folio con marcado se guarda tal cual (texto), sin neutralizarlo ni alterarlo');
  t.eq(await page.evaluate(() => [window.__xss, document.querySelectorAll('#fondosFijosModalBody script, #fondosFijosModalBody b').length]), [undefined, 0], '5) y tras guardarlo (repintado del modal) no se ejecuta ni se inyecta nada');
  await cerrarFF(h);
  await page.reload();
  await page.waitForFunction(() => { const a = document.getElementById('app'); const d = document.getElementById('sync-indicator'); return a && !a.classList.contains('hidden') && d && d.classList.contains('green'); }, null, { timeout: 20000 });
  await h.waitIdle();
  await abrirFF(h, '1129');
  const mx2 = await leerModalFF(page);
  t.eq([mx2.meses.ENERO.folio, mx2.meses.FEBRERO.folio, await page.evaluate(() => window.__xss)], ['<img src=x onerror=alert(1)>&"\'', '<script>window.__xss=1</script>"&\'', undefined], '5) tras recargar el folio sigue literal y no se ejecuta');
  await cerrarFF(h);
  t.eq(h.dialogs.filter(d => d.type === 'alert' && /^1$/.test(d.message)).length, 0, '5) ningún alert(1) se disparó');
  t.noErrores(h);
  await h.close();

  // ---- id de entidad hostil: copia del HTML con un GESPARVU de código con marcado (los ids de entidad vienen del código, pero data-ff-* debe escaparse igual que el resto del panel)
  const { ruta } = resolverAppHtml();
  const HOSTIL = '5402002"><img src=x onerror=window.__xssid=1>';
  let html = fs.readFileSync(ruta, 'utf8');
  const original = "{ rbd: '5402002', nombre: 'RINCONCITO', comuna: 'Cabildo' }";
  if (!html.includes(original)) { t.ok(false, '5) el index.html declara el GESPARVU 5402002 (el spec lo reemplaza por un id con marcado en una copia)'); return; }
  html = html.replace(original, `{ rbd: '${HOSTIL}', nombre: 'RINCONCITO', comuna: 'Cabildo' }`);
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const copia = path.join(TMP_DIR, 'index_ff_xss.html');
  fs.writeFileSync(copia, html);
  const dx = clon(docs); dx[HOSTIL] = dx['5402002']; delete dx['5402002']; dx[HOSTIL].rbd = HOSTIL;
  const hx = await boot({ fixture: dx, html: copia, allowErrors: [/./] });
  await hx.clickTab('fondos fijos');
  const filas = await hx.page.evaluate((id) => ({ trs: document.querySelectorAll('#fondosFijosTbody tr').length, imgs: document.querySelectorAll('#fondosFijosTbody img, #fondosFijosKpis img, #tab-of-fondos_fijos img[src="x"]').length,
    hostiles: Array.from(document.querySelectorAll('#fondosFijosTbody tr')).filter(tr => tr.getAttribute('data-ff-rbd') === id).length,
    botones: Array.from(document.querySelectorAll('#fondosFijosTbody [data-ff-abrir]')).filter(b => b.getAttribute('data-ff-abrir') === id).length }), HOSTIL);
  t.eq([filas.trs, filas.imgs, filas.hostiles, filas.botones], [68, 0, 1, 1], '5) con un id de entidad con marcado la tabla de Fondos Fijos lista 68 filas, no inyecta ninguna <img> y los atributos data-ff-rbd / data-ff-abrir conservan el id literal (el resto de las pestañas no se mide: sus ids vienen del código)');
  await hx.page.click(`#fondosFijosTbody [data-ff-abrir="${HOSTIL.replace(/"/g, '\\"')}"]`);
  await hx.waitIdle();
  const modal = await hx.page.evaluate((id) => ({ inputs: document.querySelectorAll('#fondosFijosModalBody input.ff-input').length, ok: Array.from(document.querySelectorAll('#fondosFijosModalBody input.ff-input')).every(i => i.getAttribute('data-ff-rbd') === id),
    imgs: document.querySelectorAll('#fondosFijosModal img').length, titulo: document.getElementById('fondosFijosModalTitle').textContent }), HOSTIL);
  t.eq([modal.inputs, modal.ok, modal.imgs], [85, true, 0], '5) y en el modal las 85 celdas llevan el id literal en data-ff-rbd, sin inyectar nada (antes el id iba SIN escapar dentro del atributo)');
  t.ok(modal.titulo.includes(HOSTIL), '5) el título del modal lo muestra como texto', modal.titulo);
  await escribirFF(hx, `#fondosFijosModalBody input.ff-input[data-ff-mes="MARZO"][data-ff-campo="rendido"]`, 1234);
  await hx.flushWrites();
  t.eq(((await hx.store())[`sep_carga_rbd/${HOSTIL}`].fondos_fijos.meses.MARZO || {}).rendido, 1234, '5) y guardar una celda de esa entidad escribe en SU documento (el id se lee tal cual del atributo)');
  await hx.close();
});
