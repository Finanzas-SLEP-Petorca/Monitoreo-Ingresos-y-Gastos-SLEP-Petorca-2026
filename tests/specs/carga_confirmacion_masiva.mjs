// Carga por reemplazo total · CONFIRMACIÓN EXTRA por «vaciado masivo». Riesgo que cubre: subir por error el «⬇ XLS» de UNA sola entidad, que al reimportar deja vacías a las
// demás en las hojas que trae. Regla (index.html: UMBRAL_VACIADO_MASIVO, esVaciadoMasivo, calcularVaciadoMasivo): se pide la casilla «Entiendo que K entidades quedarán
// vacías…» cuando, en alguna hoja (o sumando las entidades distintas de todas), las entidades que HOY tienen datos y quedarían sin ninguno son ≥ 50, o ≥ 50 % del universo de la
// fuente si este tiene ≥ 10 entidades. Se verifica en los tres flujos (SEP, Fondos Fijos y otras fuentes: General y Aporte Fiscal JUNJI) y en «Deshacer»:
//   · 1 sola entidad en SEP (55 con datos) → aviso rojo (role=alert, dialog aria-describedby), «Reemplazar» deshabilitado, casilla con label, foco inicial en «Cancelar»;
//   · Cancelar y Esc no escriben; con la casilla se habilita (y al desmarcarla se vuelve a deshabilitar) y al confirmar reemplaza como antes;
//   · archivo completo → sin aviso, sin casilla, botón habilitado de entrada;
//   · umbral: justo bajo / sobre el límite relativo (27 / 28 de 55; 6 / 7 de 13) y la función pura con el límite absoluto (49 / 50 de 200);
//   · las entidades que ya estaban vacías NO cuentan; «Vaciar» no usa este aviso; «Deshacer» sí.
import fs from 'node:fs';
import { boot, clickTab } from '../lib/boot.mjs';
import { resolverAppHtml } from '../lib/html-source.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { libroXlsx, leerModalCarga, subirYConfirmar, inputFuente } from '../lib/carga.mjs';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const MESES_K = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const ENC_ING = ['RBD', 'Establecimiento', 'Item', ...MESES, 'Total Año'];
const ENC_MENSUAL = ['RBD', 'Nombre', ...MESES, 'Total Año'];
const ITEM = 'Ingreso SEP Preferente';
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const clon = (o) => JSON.parse(JSON.stringify(o));
const celda = (r) => /^\d+$/.test(String(r)) ? Number(r) : String(r);
const mesesK = (v) => Object.fromEntries(MESES_K.map(m => [m, v]));
async function escenario(t, nombre, fn) { try { await fn(); } catch (e) { t.ok(false, `${nombre}: excepción`, String(e.stack || e.message).split('\n').slice(0, 6).join(' | ')); } }
const escribio = (ws) => ws.filter(w => w.path.startsWith('sep_carga_rbd/'));

// ---- Estado de partida: el fixture `fondos_fijos` (55 RBD + 13 GESPARVU) con datos SOLO en las entidades pedidas, en las 4 fuentes que se prueban.
async function base() {
  const h0 = await boot({ autoCarga: false, fixture: 'fondos_fijos' });
  const s = clon(await h0.store());
  const todos = Object.keys(s).map(p => p.split('/')[1]).filter(id => id !== '_meta');
  const rbd = todos.filter(id => /^\d{1,6}$/.test(id)), gesparvu = todos.filter(id => /^\d{7}$/.test(id)); // 55 RBD, 13 GESPARVU y la fila AC
  const ids = { sep: rbd, general: [...rbd, 'AC'], junji: gesparvu, ff: [...rbd, ...gesparvu] };
  await h0.close();
  const docs = Object.fromEntries(Object.entries(s).map(([p, v]) => [p.split('/')[1], v]));
  return { docs, ids };
}
function conDatos(b, { sep = [], general = [], junji = [], ff = [] }) {
  const docs = clon(b.docs);
  Object.entries(docs).forEach(([id, d]) => {
    if (!d || id === '_meta') return;
    if (b.ids.sep.includes(id)) {
      const tiene = sep.includes(id);
      d.ingreso_items = tiene ? { [ITEM]: { item: ITEM, meses: mesesK(1000), total: 12000 } } : {};
      d.rem = { meses: tiene ? mesesK(500) : {}, total: tiene ? 6000 : 0, ...(d.rem && d.rem.real_hasta_mes !== undefined ? { real_hasta_mes: d.rem.real_hasta_mes } : {}) };
    }
    d.otras_fuentes = d.otras_fuentes || {};
    delete d.otras_fuentes.general; delete d.otras_fuentes.aporte_junji;
    if (general.includes(id)) d.otras_fuentes.general = { ingreso: { meses: mesesK(2000), total: 24000 } };
    if (junji.includes(id)) d.otras_fuentes.aporte_junji = { ingreso: { meses: mesesK(3000), total: 36000 } };
    if (b.ids.ff.includes(id)) { if (ff.includes(id)) d.fondos_fijos = { cupo: 100000, meses: { MARZO: { saldo_inicial: 100000, rendido: 20000, observado: 0 } } }; else delete d.fondos_fijos; }
  });
  return docs;
}
const nombre = (docs, id) => (docs[id] && docs[id].nombre) || id;
const libroSep = (h, docs, idsConValor, v = 1000) => libroXlsx(h.page, {
  INGRESO: [ENC_ING, ...idsConValor.map(id => [celda(id), nombre(docs, id), ITEM, ...new Array(12).fill(v), 12 * v])],
  REMUNERACIONES: [ENC_ING, ...idsConValor.map(id => [celda(id), nombre(docs, id), '', ...new Array(12).fill(v / 2), 6 * v])],
});
const libroMensual = (h, docs, ids, v = 2000) => libroXlsx(h.page, { INGRESO: [ENC_MENSUAL, ...ids.map(id => [celda(id), nombre(docs, id), ...new Array(12).fill(v), 12 * v])] });
const MAPA_MARZO = 7;
const filaP02 = (id, nom, cupo) => { const f = new Array(76).fill(''); f[0] = celda(id); f[1] = nom; f[6] = cupo; f[MAPA_MARZO] = cupo; f[MAPA_MARZO + 2] = 20000; f[MAPA_MARZO + 3] = 0; return f; };
const libroFF = (h, docs, ids) => libroXlsx(h.page, { 'FONDOS FIJOS P02': [['CONTROL FONDOS FIJOS P02', ...new Array(75).fill('')], ['RBD', 'Establecimiento', ...new Array(74).fill('')], ...ids.map(id => filaP02(id, nombre(docs, id), 100000))] });

// Abre el resumen SIN confirmar ni cerrar y devuelve lo que importa para el aviso.
async function abrir(h, fuente, buffer) {
  const r = await subirYConfirmar(h, fuente, buffer, { confirmar: false, cerrar: false });
  const info = await h.page.evaluate(() => {
    const ok = document.getElementById('cargaOkBtn'), cb = document.getElementById('cargaConfirmaMasivo'), av = document.getElementById('cargaAvisoMasivo');
    const panel = document.querySelector('#cargaControlModal .modal-panel');
    const act = document.activeElement;
    return {
      okDeshabilitado: ok ? ok.disabled : null,
      hayCasilla: !!cb, marcada: cb ? cb.checked : null,
      labelCasilla: cb && cb.labels && cb.labels[0] ? cb.labels[0].textContent.replace(/\s+/g, ' ').trim() : '',
      aviso: av ? av.innerText.replace(/\s+/g, ' ').trim() : '',
      avisoRole: av ? av.getAttribute('role') : null,
      describedby: panel.getAttribute('aria-describedby'),
      foco: act ? act.id : '',
    };
  });
  return { ...r, ...info };
}
const cerrarConEsc = async (h) => { await h.page.keyboard.press('Escape'); await h.waitIdle(); return h.page.evaluate(() => document.getElementById('cargaControlModal').classList.contains('hidden')); };
const estadoSep = async (h, ids) => { const st = await h.store(); return Object.fromEntries(ids.map(id => [id, Object.keys(((st['sep_carga_rbd/' + id] || {}).ingreso_items) || {}).length])); };

await correrSpec('carga_confirmacion_masiva', async (t) => {
  const b = await base();
  const SEP = b.ids.sep, M = SEP.length;
  t.eq(M, 55, 'universo de SEP = 55 RBD');
  t.eq([b.ids.general.length, b.ids.junji.length, b.ids.ff.length], [56, 13, 68], 'universos: General 56 (55 RBD + AC), Aporte JUNJI 13 (GESPARVU), Fondos Fijos 68');

  // ======================= 0. La regla pura (límite absoluto y relativo) =======================
  await escenario(t, 'regla pura', async () => {
    // El módulo del panel no expone sus funciones: se extraen del propio index.html bajo prueba las constantes y la función de la regla.
    const html = fs.readFileSync(resolverAppHtml().ruta, 'utf8');
    const m1 = /^const UMBRAL_VACIADO_MASIVO = [^\n]*$/m.exec(html), m2 = /^const esVaciadoMasivo = [^\n]*$/m.exec(html);
    t.ok(m1 && m2, 'la regla está en index.html (UMBRAL_VACIADO_MASIVO, esVaciadoMasivo)');
    const { C, f } = new Function(`${m1[0]}\n${m2[0]}\nreturn { C: [UMBRAL_VACIADO_MASIVO, UMBRAL_VACIADO_RELATIVO, UNIVERSO_MIN_RELATIVO], f: esVaciadoMasivo };`)();
    t.eq(C, [50, 0.5, 10], 'constantes con nombre: 50 entidades, 50 % y universo mínimo 10');
    t.eq([f(49, 200), f(50, 200)], [false, true], 'límite absoluto: 49 de 200 no pide confirmación, 50 de 200 sí');
    t.eq([f(49, 400), f(50, 400)], [false, true], 'límite absoluto con universo grande (49 / 50 de 400)');
    t.eq([f(27, 55), f(28, 55)], [false, true], 'límite relativo en 55: 27 no, 28 (≥ 50 %) sí');
    t.eq([f(6, 13), f(7, 13)], [false, true], 'límite relativo en 13: 6 no, 7 sí');
    t.eq([f(4, 9), f(9, 9)], [false, false], 'universo < 10: el criterio relativo no aplica (9 de 9 no pide confirmación)');
    t.eq([f(5, 10), f(4, 10)], [true, false], 'universo = 10: 5 de 10 (50 %) sí, 4 no');
    t.eq(f(0, 5), false, 'cero entidades afectadas nunca pide confirmación');
  });

  // ======================= 1. SEP: Excel de UNA sola entidad (55 con datos) =======================
  const docs55 = conDatos(b, { sep: SEP });
  const h = await boot({ autoCarga: false, fixture: docs55 });
  await clickTab(h.page, 'SEP');
  await escenario(t, 'SEP una entidad', async () => {
    const lib1 = await libroSep(h, docs55, ['1121']);
    await h.clearWrites();
    let r = await abrir(h, 'sep', lib1);
    t.ok(r.hayCasilla && r.aviso !== '', 'aparece el aviso rojo y la casilla de confirmación', r.control.texto.slice(0, 400));
    t.ok(/Este archivo trae solo 1 de 55 entidades\. Si confirmas, 54 entidades quedarán en \$0 \/ sin datos en: INGRESO, REMUNERACIONES\./.test(r.aviso) && /¿Subiste el Excel de una sola entidad por error\?/.test(r.aviso), 'el aviso, en lenguaje simple: N de M, K entidades, hojas y la pregunta', r.aviso);
    t.ok(/INGRESO: 54 entidades hoy con datos \(54 filas, \$648\.000\).*se perderían \$648\.000/.test(r.aviso) && /REMUNERACIONES: 54 entidades hoy con datos \(54 filas, \$324\.000\).*se perderían \$324\.000/.test(r.aviso), 'la lista corta por hoja trae entidades afectadas y los pesos que se perderían', r.aviso);
    t.eq(r.avisoRole, 'alert', 'el aviso tiene role="alert"');
    t.eq(r.describedby, 'cargaAvisoMasivo', 'el diálogo queda asociado al aviso con aria-describedby');
    t.eq(r.okDeshabilitado, true, '«Reemplazar» está DESHABILITADO hasta marcar la casilla');
    t.eq(r.marcada, false, 'la casilla parte desmarcada');
    t.eq(r.foco, 'cargaCancelarBtn', 'el foco inicial va a «Cancelar»');
    t.ok(/Entiendo que 54 entidades quedarán vacías y que este archivo no trae sus datos/.test(r.labelCasilla), 'la casilla tiene label con el texto pedido', r.labelCasilla);
    t.eq(r.control.pie.includes('Cancelar'), true, 'el pie trae «Cancelar»');
    // El botón no escribe nada aunque se fuerce el clic sin casilla.
    await h.page.evaluate(() => { const b = document.getElementById('cargaOkBtn'); b.disabled = false; b.click(); });
    await h.page.waitForTimeout(300);
    t.eq((await leerModalCarga(h.page)).texto.includes('Resumen por hoja'), true, 'forzar el clic sin la casilla no aplica la carga (sigue el resumen)');
    t.eq(escribio(await h.writes()).length, 0, '... y no se escribió nada');
    // Esc cancela
    t.eq(await cerrarConEsc(h), true, 'Esc cierra el resumen');
    t.eq(escribio(await h.writes()).length, 0, 'Esc no escribe nada en Firestore');
    t.eq(Object.values(await estadoSep(h, SEP)).every(n => n === 1), true, 'las 55 entidades siguen con su ingreso');
    // Cancelar
    r = await abrir(h, 'sep', lib1);
    await h.page.click('#cargaCancelarBtn'); await h.waitIdle();
    t.eq(escribio(await h.writes()).length, 0, 'Cancelar no escribe nada en Firestore');
    t.eq(await h.page.evaluate(() => document.getElementById('cargaControlModal').classList.contains('hidden')), true, 'Cancelar cierra el resumen');
    // Casilla: habilita y deshabilita
    r = await abrir(h, 'sep', lib1);
    await h.page.check('#cargaConfirmaMasivo');
    t.eq(await h.page.evaluate(() => document.getElementById('cargaOkBtn').disabled), false, 'al marcar la casilla se habilita «Reemplazar»');
    await h.page.uncheck('#cargaConfirmaMasivo');
    t.eq(await h.page.evaluate(() => document.getElementById('cargaOkBtn').disabled), true, 'al desmarcarla se vuelve a deshabilitar');
    await h.page.check('#cargaConfirmaMasivo');
    await h.page.click('#cargaOkBtn');
    await h.page.waitForFunction(() => !!document.getElementById('cargaCerrarBtn') && !document.getElementById('cargaOkBtn') && !/Guardando para el resto/.test(document.getElementById('cargaControlBody').innerText), null, { timeout: 60000 });
    const res = await leerModalCarga(h.page);
    await h.page.click('#cargaCerrarBtn'); await h.flushWrites(); await h.waitIdle();
    t.ok(/aplicado y verificado/.test(res.texto), 'al confirmar con la casilla reemplaza y la cuadratura cuadra', res.texto.slice(0, 300));
    const n = await estadoSep(h, SEP);
    t.eq([n['1121'], SEP.filter(id => id !== '1121').every(id => n[id] === 0)], [1, true], 'queda 1121 y las otras 54 entidades quedaron vacías (como antes del aviso)');
    t.noErrores(h);
  });

  // ======================= 6. Deshacer: restaurar un estado que deja muchas entidades vacías pide la casilla =======================
  await escenario(t, 'deshacer', async () => {
    // Estado actual: solo 1121 con datos. Se carga el archivo COMPLETO (55 entidades) → sin aviso; después «Deshacer» vuelve a 1 entidad → 54 quedarían vacías.
    const r = await abrir(h, 'sep', await libroSep(h, docs55, SEP, 7000));
    t.eq([r.hayCasilla, r.okDeshabilitado, r.aviso], [false, false, ''], 'archivo completo (55 de 55): sin aviso, sin casilla y «Reemplazar» habilitado de entrada');
    await h.page.click('#cargaOkBtn');
    await h.page.waitForFunction(() => !!document.getElementById('cargaCerrarBtn') && !document.getElementById('cargaOkBtn') && !/Guardando para el resto/.test(document.getElementById('cargaControlBody').innerText), null, { timeout: 60000 });
    await h.page.click('#cargaCerrarBtn'); await h.flushWrites(); await h.waitIdle();
    t.eq(Object.values(await estadoSep(h, SEP)).every(x => x === 1), true, 'el archivo completo cargó las 55 entidades');
    await h.clearWrites();
    await h.page.click('#undoCargaOFBtn-sep'); await h.page.waitForSelector('#cargaOkBtn');
    const u = await h.page.evaluate(() => ({ ok: document.getElementById('cargaOkBtn').disabled, cb: !!document.getElementById('cargaConfirmaMasivo'), aviso: (document.getElementById('cargaAvisoMasivo') || {}).innerText || '', foco: document.activeElement.id, etiqueta: (document.querySelector('label[for=cargaConfirmaMasivo]') || {}).textContent || '' }));
    t.eq([u.ok, u.cb, u.foco], [true, true, 'cargaCancelarBtn'], '«Deshacer» que dejaría 54 entidades vacías: botón deshabilitado, con casilla y foco en «Cancelar»', JSON.stringify(u));
    t.ok(/El estado que se restaura trae solo 1 de 55 entidades/.test(u.aviso.replace(/\s+/g, ' ')) && /54 entidades quedarán en \$0/.test(u.aviso), 'el aviso de «Deshacer» habla del estado que se restaura', u.aviso);
    await h.page.keyboard.press('Escape'); await h.waitIdle();
    t.eq(escribio(await h.writes()).length, 0, 'Esc en «Deshacer» no escribe');
    await h.page.click('#undoCargaOFBtn-sep'); await h.page.waitForSelector('#cargaOkBtn');
    await h.page.check('#cargaConfirmaMasivo'); await h.page.click('#cargaOkBtn');
    await h.page.waitForFunction(() => !!document.getElementById('cargaCerrarBtn') && !document.getElementById('cargaOkBtn') && !/Guardando para el resto/.test(document.getElementById('cargaControlBody').innerText), null, { timeout: 60000 });
    await h.page.click('#cargaCerrarBtn'); await h.flushWrites(); await h.waitIdle();
    const n = await estadoSep(h, SEP);
    t.eq([n['1121'], SEP.filter(id => id !== '1121').every(id => n[id] === 0)], [1, true], 'con la casilla, «Deshacer» restaura el estado anterior (solo 1121)');
  });
  await h.close();

  // ======================= 3 y 4. Límites en SEP (27 / 28 de 55) y entidades que ya estaban vacías =======================
  await escenario(t, 'límite relativo SEP', async () => {
    const hl = await boot({ autoCarga: false, fixture: docs55 });
    await clickTab(hl.page, 'SEP');
    // 28 entidades con datos en el archivo → 27 quedarían vacías (49 %): sin aviso. 27 en el archivo → 28 vacías (51 %): con aviso.
    let r = await abrir(hl, 'sep', await libroSep(hl, docs55, SEP.slice(0, 28)));
    t.eq([r.hayCasilla, r.okDeshabilitado], [false, false], '27 entidades quedarían vacías (justo bajo el límite): sin aviso y botón habilitado');
    t.ok(/Se modificarían los datos de 27 entidades/.test(r.control.texto), 'el resumen sí dice que se modifican 27 entidades', r.control.texto.slice(0, 300));
    await hl.page.click('#cargaCancelarBtn');
    r = await abrir(hl, 'sep', await libroSep(hl, docs55, SEP.slice(0, 27)));
    t.eq([r.hayCasilla, r.okDeshabilitado], [true, true], '28 entidades quedarían vacías (≥ 50 % de 55): con aviso y botón deshabilitado');
    t.ok(/trae solo 27 de 55 entidades.*28 entidades quedarán/.test(r.aviso), 'el aviso cuenta 27 de 55 y 28 vacías', r.aviso);
    await hl.page.click('#cargaCancelarBtn');
    t.eq(escribio(await hl.writes()).length, 0, 'ninguno de los dos resúmenes escribió');
    await hl.close();
    // 4. Solo 20 entidades tenían datos: subir 1 sola deja 19 vacías (35 %) → sin aviso, aunque «54 no aparecen en el archivo».
    const poco = conDatos(b, { sep: SEP.slice(0, 20) });
    const hv = await boot({ autoCarga: false, fixture: poco });
    await clickTab(hv.page, 'SEP');
    r = await abrir(hv, 'sep', await libroSep(hv, poco, ['1121']));
    t.eq([r.hayCasilla, r.okDeshabilitado], [false, false], 'las entidades que YA estaban vacías no cuentan: 20 con datos y 1 en el archivo → 19 vacías, sin aviso');
    t.ok(/54 de 55 entidades de SEP no aparecen|no aparecen en esta hoja/.test(r.control.texto) || /Se modificarían los datos de 19 entidades/.test(r.control.texto), 'el resumen normal sigue informando', r.control.texto.slice(0, 300));
    await hv.page.click('#cargaCancelarBtn');
    // 29 con datos: 1 en el archivo (que ya tenía datos) → 28 vacías → aviso (el umbral mide a las que hoy TIENEN datos)
    const m29 = conDatos(b, { sep: SEP.slice(0, 29) });
    const hw = await boot({ autoCarga: false, fixture: m29 });
    await clickTab(hw.page, 'SEP');
    r = await abrir(hw, 'sep', await libroSep(hw, m29, [SEP[0]]));
    t.eq([r.hayCasilla, /trae solo 1 de 55 entidades.*28 entidades quedarán/.test(r.aviso)], [true, true], '29 con datos y 1 en el archivo → 28 vacías → aviso (cuenta solo las que tenían datos)', r.aviso);
    await hw.page.click('#cargaCancelarBtn');
    await hv.close(); await hw.close();
  });

  // ======================= 8a. Otras fuentes: General (56) y Aporte JUNJI (13, criterio relativo en una fuente pequeña) =======================
  await escenario(t, 'otras fuentes', async () => {
    const todos = conDatos(b, { general: b.ids.general, junji: b.ids.junji });
    const hg = await boot({ autoCarga: false, fixture: todos });
    await clickTab(hg.page, 'of-general');
    let r = await abrir(hg, 'general', await libroMensual(hg, todos, ['1121']));
    t.eq([r.hayCasilla, r.okDeshabilitado, r.foco, r.avisoRole, r.describedby], [true, true, 'cargaCancelarBtn', 'alert', 'cargaAvisoMasivo'], 'General: 1 entidad de 56 → aviso, botón deshabilitado, foco en Cancelar, role=alert');
    t.ok(/trae solo 1 de 56 entidades.*55 entidades quedarán en \$0 \/ sin datos en: INGRESO/.test(r.aviso) && /se perderían \$1\.320\.000/.test(r.aviso), 'General: texto con 55 vacías y los pesos que se perderían (55 × $24.000)', r.aviso);
    await hg.page.click('#cargaCancelarBtn');
    t.eq(escribio(await hg.writes()).length, 0, 'General: Cancelar no escribe');
    r = await abrir(hg, 'general', await libroMensual(hg, todos, b.ids.general));
    t.eq([r.hayCasilla, r.okDeshabilitado], [false, false], 'General: archivo completo (56 de 56) sin aviso');
    await hg.page.click('#cargaCancelarBtn');
    // Aporte Fiscal JUNJI: 13 entidades. 7 vacías (54 %) → aviso; 6 vacías (46 %) → sin aviso.
    await clickTab(hg.page, 'of-aporte_junji');
    r = await abrir(hg, 'aporte_junji', await libroMensual(hg, todos, b.ids.junji.slice(0, 6)));
    t.eq([r.hayCasilla, r.okDeshabilitado], [true, true], 'Aporte JUNJI (13 entidades): 7 quedarían vacías (≥ 50 %) → aviso');
    t.ok(/trae solo 6 de 13 entidades.*7 entidades quedarán/.test(r.aviso), 'Aporte JUNJI: 6 de 13, 7 vacías', r.aviso);
    await hg.page.click('#cargaCancelarBtn');
    r = await abrir(hg, 'aporte_junji', await libroMensual(hg, todos, b.ids.junji.slice(0, 7)));
    t.eq([r.hayCasilla, r.okDeshabilitado], [false, false], 'Aporte JUNJI: 6 quedarían vacías (46 %) → sin aviso');
    await hg.page.click('#cargaCancelarBtn');
    t.eq(escribio(await hg.writes()).length, 0, 'ninguno de los resúmenes escribió');
    // Con la casilla, General reemplaza como antes (55 entidades quedan en $0)
    await clickTab(hg.page, 'of-general');
    const x = await subirYConfirmar(hg, 'general', await libroMensual(hg, todos, ['1121'], 5000));
    t.ok(x.masivo && /aplicado y verificado/.test(x.resultado.texto), 'General: con la casilla reemplaza y cuadra', x.resultado.texto.slice(0, 200));
    const st = await hg.store();
    const gen = (id) => (((st['sep_carga_rbd/' + id] || {}).otras_fuentes || {}).general || {}).ingreso;
    t.eq([gen('1121').total, b.ids.general.filter(id => id !== '1121').every(id => !gen(id) || gen(id).total === 0)], [60000, true], 'General: 1121 con lo del archivo y las demás en $0');
    t.noErrores(hg);
    await hg.close();
  });

  // ======================= 8b. Fondos Fijos (68 entidades) =======================
  await escenario(t, 'fondos fijos', async () => {
    const ffDocs = conDatos(b, { ff: b.ids.ff });
    const hf = await boot({ autoCarga: false, fixture: ffDocs });
    await clickTab(hf.page, 'of-fondos_fijos');
    let r = await abrir(hf, 'fondos_fijos', await libroFF(hf, ffDocs, ['1121']));
    t.eq([r.hayCasilla, r.okDeshabilitado, r.foco, r.avisoRole], [true, true, 'cargaCancelarBtn', 'alert'], 'Fondos Fijos: 1 entidad de 68 → aviso, botón deshabilitado, foco en Cancelar, role=alert');
    t.ok(/trae solo 1 de 68 entidades.*67 entidades quedarán en \$0 \/ sin datos en: FONDOS FIJOS P02/.test(r.aviso), 'Fondos Fijos: el aviso cuenta 1 de 68 y 67 vacías', r.aviso);
    t.ok(/Entiendo que 67 entidades quedarán vacías/.test(r.labelCasilla), 'Fondos Fijos: casilla con su label', r.labelCasilla);
    await hf.page.click('#cargaCancelarBtn');
    t.eq(escribio(await hf.writes()).length, 0, 'Fondos Fijos: Cancelar no escribe');
    r = await abrir(hf, 'fondos_fijos', await libroFF(hf, ffDocs, b.ids.ff));
    t.eq([r.hayCasilla, r.okDeshabilitado], [false, false], 'Fondos Fijos: archivo completo sin aviso');
    await hf.page.click('#cargaCancelarBtn');
    const x = await subirYConfirmar(hf, 'fondos_fijos', await libroFF(hf, ffDocs, ['1121']));
    t.ok(x.masivo && /aplicado y verificado/.test(x.resultado.texto), 'Fondos Fijos: con la casilla reemplaza y cuadra', x.resultado.texto.slice(0, 200));
    const st = await hf.store();
    t.eq([(st['sep_carga_rbd/1121'].fondos_fijos || {}).cupo, b.ids.ff.filter(id => id !== '1121').every(id => !((st['sep_carga_rbd/' + id] || {}).fondos_fijos || {}).cupo)], [100000, true], 'Fondos Fijos: 1121 con su cupo y las demás en blanco (como antes)');
    t.noErrores(hf);
    await hf.close();
  });

  // ======================= 9. «Vaciar» no usa este aviso (tiene su propia confirmación con el nombre) =======================
  await escenario(t, 'vaciar', async () => {
    const hz = await boot({ autoCarga: false, fixture: docs55 });
    await clickTab(hz.page, 'SEP');
    await hz.page.click('#vaciarOFBtn-sep'); await hz.page.waitForSelector('#cargaOkBtn');
    const v = await hz.page.evaluate(() => ({ cb: !!document.getElementById('cargaConfirmaMasivo'), av: !!document.getElementById('cargaAvisoMasivo'), nombre: !!document.getElementById('cargaConfirmaNombre'), foco: document.activeElement.id }));
    t.eq(v, { cb: false, av: false, nombre: true, foco: 'cargaConfirmaNombre' }, '«Vaciar»: sin casilla ni aviso masivo; sigue pidiendo escribir el nombre (foco en el campo)');
    await hz.page.keyboard.press('Escape');
    await hz.close();
  });
});
