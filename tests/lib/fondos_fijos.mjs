// Ayudas compartidas por los specs de Fondos Fijos (PR K: fondos_fijos_modelo / _importador / _general / _a11y) y de las fuentes nuevas (fuentes_nuevas_*):
// oráculo INDEPENDIENTE de lo esperado a partir de los documentos del fixture `fondos_fijos` (sin pasar por el código del panel) y lectores de lo que muestra la pantalla.
//
// Reglas del control operativo de Fondos Fijos (campo `fondos_fijos` del documento de cada RBD / GESPARVU; AC NO es entidad de Fondos Fijos):
//   · gasto aceptado (mes) = max(0, rendido − observado);   pendiente en General = max(0, aceptado − registrado_general);   pendiente SIGFE = max(0, aceptado − compensado_sigfe)
//   · Estado: sin cupo, rendido ni aceptado → «Sin datos»; observado > 0 → «Con observaciones»; pendiente General > 0 → «Pendiente General»; pendiente SIGFE > 0 → «Pendiente SIGFE»; si no «Conciliado»
//   · SOLO `registrado_general` entra al gasto: se suma al B&S REAL de Subvención General de la misma entidad y mes (no a SEP ni a otra fuente); NO entra al saldo consolidado de otras
//     formas, ni al déficit propio, ni al CSV de compras. Un GESPARVU con registrado_general > 0 aparece como fila en General (los demás jardines no).
import { MESES, RBD_IDS, GESPARVU_IDS, corteFuente } from './corte.mjs';
import { FUENTES, entidadDe, fuenteEsperada, SIN_GASTO } from './honorarios_fuentes.mjs';

export { MESES, RBD_IDS, GESPARVU_IDS };
export const MESES_ABREV = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
export const CAMPOS_MONTO = ['saldo_inicial', 'rendido', 'observado', 'registrado_general', 'compensado_sigfe', 'reposicion'];
export const FOLIO_MAX = 40;
export const MONTO_ABS_MAX = 1e13;
/** Entidades de Fondos Fijos: los RBD y los GESPARVU (no AC), en ese orden. */
export const IDS_FF = [...RBD_IDS, ...GESPARVU_IDS];

const num = (v) => { const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN); return Number.isFinite(n) ? n : 0; };
const monto = (v) => { const n = num(v); return n >= MONTO_ABS_MAX ? 0 : Math.max(0, n); };
const texto = (v) => (typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : ''));
const plano = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
export const folioLeido = (v) => Array.from(texto(v).trim()).slice(0, FOLIO_MAX).join('');

/** Lo que el panel debe leer de `fondos_fijos` de un documento (tolerante): { cupo, meses:{MES:{campo…, folio}} } */
export function ffLeido(doc) {
  const raw = plano(plano(doc).fondos_fijos);
  const meses = {};
  MESES.forEach(m => {
    const x = plano(plano(raw.meses)[m]);
    meses[m] = {};
    CAMPOS_MONTO.forEach(c => { meses[m][c] = monto(x[c]); });
    meses[m].folio = folioLeido(x.folio);
  });
  return { cupo: monto(raw.cupo), meses };
}
/** Totales y Estado de una entidad de Fondos Fijos. */
export function ffEntidad(docs, id) {
  const ff = ffLeido(docs[id]);
  const t = { cupo: ff.cupo, rendido: 0, observado: 0, aceptado: 0, registrado: 0, compensado: 0, reposicion: 0 };
  MESES.forEach(m => {
    const x = ff.meses[m], ac = Math.max(0, x.rendido - x.observado);
    t.rendido += x.rendido; t.observado += x.observado; t.aceptado += ac; t.registrado += x.registrado_general; t.compensado += x.compensado_sigfe; t.reposicion += x.reposicion;
  });
  t.pendienteGeneral = Math.max(0, t.aceptado - t.registrado);
  t.pendienteSigfe = Math.max(0, t.aceptado - t.compensado);
  let estado;
  if (!t.cupo && !t.rendido && !t.aceptado) estado = 'Sin datos';
  else if (t.observado > 0) estado = 'Con observaciones';
  else if (t.pendienteGeneral > 0) estado = 'Pendiente General';
  else if (t.pendienteSigfe > 0) estado = 'Pendiente SIGFE';
  else estado = 'Conciliado';
  return { ...t, estado, meses: ff.meses };
}
/** Totales de todas las entidades (lo que muestran las 5 tarjetas de la pestaña). */
export function ffTotales(docs) {
  const t = { cupo: 0, aceptado: 0, pendienteGeneral: 0, pendienteSigfe: 0, observado: 0, registrado: 0, compensado: 0 };
  IDS_FF.forEach(id => { const e = ffEntidad(docs, id); Object.keys(t).forEach(k => { t[k] += e[k]; }); });
  return t;
}
/** Meses (12) registrados en General de una entidad (0 si no es de Fondos Fijos, p. ej. AC). */
export const registradoGeneral = (docs, id) => (IDS_FF.includes(id) ? MESES.map(m => ffLeido(docs[id]).meses[m].registrado_general) : new Array(12).fill(0));

/** Entidades que lista la pestaña General: RBD + AC (+ los GESPARVU con Fondo Fijo registrado en General), en ese orden. */
export const idsGeneral = (docs) => [...RBD_IDS, 'AC', ...GESPARVU_IDS.filter(id => registradoGeneral(docs, id).some(v => v > 0))];

/** Lo esperado de una entidad en General (con Fondos Fijos de RBD / GESPARVU y SIN los de AC): mismo formato que entidadDe. Para un jardín: solo el B&S de Fondos Fijos. */
export function generalDe(docs, id) {
  if (GESPARVU_IDS.includes(id)) {
    const reg = registradoGeneral(docs, id).reduce((a, b) => a + b, 0);
    const b = { ingreso: 0, rem: 0, hon: 0, bys: reg, gasto: reg, saldo: -reg };
    return { id, key: 'general', real: { ...b }, proy: { ingreso: 0, rem: 0, hon: 0, bys: 0, gasto: 0, saldo: 0 }, total: { ...b }, estado: -reg < 0 ? 'deficit' : 'superavit', causas: reg ? ['saldo'] : [] };
  }
  const e = entidadDe(docs, id, 'general');
  if (id !== 'AC') return e;
  // el oráculo de honorarios_fuentes suma los Fondos Fijos de cualquier documento, también AC; AC no es entidad de Fondos Fijos: se resta
  const fantasma = MESES.reduce((s, m) => s + num(docs.AC && docs.AC.fondos_fijos && docs.AC.fondos_fijos.meses && docs.AC.fondos_fijos.meses[m] && docs.AC.fondos_fijos.meses[m].registrado_general), 0);
  if (!fantasma) return e;
  const r = JSON.parse(JSON.stringify(e));
  ['real', 'total'].forEach(k => { r[k].bys -= fantasma; r[k].gasto -= fantasma; r[k].saldo += fantasma; });
  r.estado = r.total.saldo < 0 ? 'deficit' : 'superavit';
  r.causas = r.total.saldo < 0 ? ['saldo'] : [];
  return r;
}
/** Suma de Subvención General (RBD + AC + jardines con Fondos Fijos): { real, proy, total, nEntidades, nDeficit }. */
export function generalEsperada(docs) {
  const vacio = () => ({ ingreso: 0, rem: 0, hon: 0, bys: 0, gasto: 0, saldo: 0 });
  const acc = { real: vacio(), proy: vacio(), total: vacio(), nEntidades: 0, nDeficit: 0 };
  const porId = {};
  idsGeneral(docs).forEach(id => {
    const e = generalDe(docs, id); porId[id] = e;
    ['real', 'proy', 'total'].forEach(k => Object.keys(acc[k]).forEach(c => { acc[k][c] += e[k][c]; }));
    acc.nEntidades++; if (e.estado === 'deficit') acc.nDeficit++;
  });
  return { porId, suma: acc };
}
/** Esperado de una fuente cualquiera (General con su regla especial de universo; las demás, el oráculo de honorarios_fuentes). */
export function fuenteEsp(docs, key) {
  if (key === 'general') return generalEsperada(docs);
  const f = fuenteEsperada(docs, key);
  return { porId: f.porId, suma: f.suma };
}
/** Serie mensual del B&S de General de las entidades de la lista (o solo una): real/proy de 12 meses, con Fondos Fijos (siempre Real). */
export function fondosPorMes(docs, ids = IDS_FF) {
  const out = new Array(12).fill(0);
  ids.forEach(id => registradoGeneral(docs, id).forEach((v, i) => { out[i] += v; }));
  return out;
}

export { FUENTES, SIN_GASTO, corteFuente };

// ---------------------------------------------------------------- lectores de la pantalla
/** "$1.234.567" / "-$1.234" / "—" → entero. */
export const clp = (t) => { const s = String(t).replace(/\s/g, ''); const n = Number(s.replace(/[^\d]/g, '')); return /^-/.test(s) ? -n : n; };
export const fmt = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('es-CL');

/** Tarjetas de la pestaña de Fondos Fijos: { 'Cupo vigente': { valor, nota }, … }. */
export const leerKpisFF = (page) => page.evaluate(() => {
  const o = {};
  document.querySelectorAll('#fondosFijosKpis .kpi-card').forEach(c => { o[c.querySelector('.label').textContent.trim()] = { valor: c.querySelector('.value').textContent.trim(), nota: c.querySelector('.delta').textContent.trim() }; });
  return o;
});
/** Filas de la tabla de Fondos Fijos: { id: { nombre, cupo, aceptado, registrado, pendGeneral, compensado, pendSigfe, estado, rbdAttr, abrirAttr } }. */
export const leerFilasFF = (page) => page.evaluate(() => {
  const o = {};
  document.querySelectorAll('#fondosFijosTbody tr').forEach(tr => {
    const c = Array.from(tr.children).map(td => td.textContent.trim());
    o[c[0]] = { nombre: c[1], cupo: c[2], aceptado: c[3], registrado: c[4], pendGeneral: c[5], compensado: c[6], pendSigfe: c[7], estado: c[8], rbdAttr: tr.getAttribute('data-ff-rbd'), abrirAttr: (tr.querySelector('[data-ff-abrir]') || {}).dataset ? tr.querySelector('[data-ff-abrir]').dataset.ffAbrir : null };
  });
  return o;
});
/** Orden de las filas de una tabla (los objetos de JS reordenan las claves numéricas): ids de `tr[data-rbd]` (fuentes) o `tr[data-ff-rbd]` (Fondos Fijos). */
export const ordenFilas = (page, selector) => page.evaluate((sel) => Array.from(document.querySelectorAll(sel)).map(tr => tr.getAttribute('data-rbd') || tr.getAttribute('data-ff-rbd')), selector);
/** Abre el modal de Fondos Fijos de una entidad desde su pestaña. */
export async function abrirFF(h, id) {
  await h.clickTab('fondos fijos');
  await h.page.click(`#fondosFijosTbody [data-ff-abrir="${id}"]`);
  await h.waitIdle();
}
export async function cerrarFF(h) { await h.page.keyboard.press('Escape'); await h.waitIdle(); }
/** Valores de las celdas del modal abierto: { cupo, MES: { campo: texto } }. */
export const leerModalFF = (page) => page.evaluate(() => {
  const o = { meses: {} };
  document.querySelectorAll('#fondosFijosModalBody input.ff-input').forEach(i => {
    if (i.dataset.ffMes) { (o.meses[i.dataset.ffMes] = o.meses[i.dataset.ffMes] || {})[i.dataset.ffCampo] = i.value; } else o[i.dataset.ffCampo] = i.value;
  });
  o.calc = {};
  document.querySelectorAll('#fondosFijosModalBody tr.ff-calculada').forEach(tr => { o.calc[tr.children[0].textContent.trim()] = Array.from(tr.children).slice(1).map(td => td.textContent.trim()); });
  return o;
});
/** Teclea (o pega) un valor en una celda del modal y confirma con Tab (dispara `change`). */
export async function escribirFF(h, sel, valor) {
  const loc = h.page.locator(sel);
  await loc.fill(String(valor));
  await loc.press('Tab');
  await h.waitIdle();
}
export const celdaFF = (id, mes, campo) => (mes ? `#fondosFijosModalBody input.ff-input[data-ff-rbd="${id}"][data-ff-mes="${mes}"][data-ff-campo="${campo}"]` : `#fondosFijosModalBody input.ff-input[data-ff-rbd="${id}"][data-ff-campo="${campo}"]`);

/** Serie mensual esperada del B&S de General (con Fondos Fijos de RBD y GESPARVU, sin los de AC): { bys:{real:[12],proy:[12]} , ing, rem, hon, gas }. `soloId` = una entidad. Los Fondos Fijos son siempre Real. */
import { serieMensual } from './honorarios_fuentes.mjs';
export function serieGeneral(docs, soloId = null) {
  const sm = serieMensual(docs, 'general', soloId);
  const out = JSON.parse(JSON.stringify(sm));
  // el oráculo de honorarios_fuentes suma los Fondos Fijos de AC (documento de la fila AC) y no conoce los jardines de General: se corrige
  const ids = soloId ? [soloId] : null;
  const fantasma = new Array(12).fill(0);
  (ids || ['AC']).forEach(id => { if (id === 'AC') MESES.forEach((m, i) => { const v = Number(docs.AC && docs.AC.fondos_fijos && docs.AC.fondos_fijos.meses && docs.AC.fondos_fijos.meses[m] && docs.AC.fondos_fijos.meses[m].registrado_general) || 0; fantasma[i] += v; }); });
  const jardines = new Array(12).fill(0);
  GESPARVU_IDS.filter(id => !soloId || id === soloId).forEach(id => registradoGeneral(docs, id).forEach((v, i) => { jardines[i] += v; }));
  out.bys.real = out.bys.real.map((v, i) => v - fantasma[i] + jardines[i]);
  out.gas.real = out.gas.real.map((v, i) => v - fantasma[i] + jardines[i]);
  return out;
}
