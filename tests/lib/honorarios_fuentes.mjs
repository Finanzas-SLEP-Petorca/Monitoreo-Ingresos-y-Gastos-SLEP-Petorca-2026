// Ayudas compartidas por los specs de Honorarios en las 9 fuentes (PR-3: honorarios_fuentes_modelo / _totales / _excel / _series / _ui): oráculo INDEPENDIENTE de lo esperado a partir de
// los documentos del fixture `honorarios_fuentes` (sin pasar por el código del panel; el catálogo de cuentas sale de data/honorarios_cuentas_2026.json) y lectores de las vistas.
//
// Reglas (docs/honorarios_spec.md, decisiones del usuario):
//   · Una boleta entra en los totales si (fuentes con cuenta: General, PIE, Mantención, Pro-Retención) su cuenta está en el catálogo de honorarios o (fuentes por concepto: JUNJI, FAEP, FIGA,
//     Aportes) tiene concepto, y en ambos casos su Fecha Documento empieza con aaaa-mm-dd con un mes que existe (cualquier año). Se suma el Monto Gasto (bruto). La Fecha de Pago no mueve el mes.
//   · Las boletas son SIEMPRE «Real» (sin importar el corte «Real hasta» de la entidad); la proyección (por cuenta o concepto) es SIEMPRE «Proyectada» y se SUMA a las boletas.
//   · NO hay 70/30 en las fuentes: gasto = remuneraciones + honorarios + B&S; saldo = ingreso − gasto; Déficit ⇔ saldo < 0. JUNJI: además Déficit si Operación − B&S < 0, y los honorarios (gasto de
//     personal) NO entran en ese saldo de Operación (se financian como las Remuneraciones, con cualquiera de sus ingresos).
import { MESES, FUENTES, idsDeUniverso, corteFuente } from './corte.mjs';
import { documentadoDe } from './compras_conceptos.mjs';
import { CATALOGO, CUENTAS_HON, mesDeFecha } from './honorarios.mjs';

export { MESES, FUENTES };
export const FUENTES_CUENTA = ['general', 'pie', 'mantenimiento', 'prorretencion'];
export const FUENTES_CONCEPTO = ['junji', 'faep', 'subt31_proyectos', 'recuperacion_llmm', 'asignacion_familiar', 'figa', 'aporte_educ', 'aporte_junji'];
export const esConcepto = (key) => FUENTES_CONCEPTO.includes(key);
/** Recuperación LLMM es solo de ingresos: no lleva honorarios (una boleta guardada en su documento no cuenta). Asignación Familiar solo lleva Remuneraciones y honorarios (sin B&S). */
export const SIN_GASTO = ['recuperacion_llmm'];
export const SIN_BYS = ['recuperacion_llmm', 'asignacion_familiar'];
const lineasIngreso = (key, of) => (key === 'junji' ? [of.ingreso_operacion, of.ingreso_homologacion, of.ingreso_carrera_docente, of.ingreso_bdl]
  : key === 'recuperacion_llmm' ? [of.ingreso_llmm_isapres, of.ingreso_llmm_fonasa, of.ingreso_llmm_sil]
  : (key === 'general' || key === 'pie') ? [of.ingreso, of.ingreso_carrera_docente] : [of.ingreso]);
/** Meses (12) de Fondos Fijos ya registrados en el gasto de Subvención General de la entidad. */
const fondosGeneral = (docs, id) => MESES.map(m => num(docs[id] && docs[id].fondos_fijos && docs[id].fondos_fijos.meses && docs[id].fondos_fijos.meses[m] && docs[id].fondos_fijos.meses[m].registrado_general));
/** Columna del Plan de Cuentas que rige a una entidad en una fuente con cuenta (la fila AC de General usa la de «Adm. Central General»). null en las fuentes por concepto. */
export const colPlan = (key, id) => ({ general: id === 'AC' ? 'adm_central_general' : 'general', pie: 'pie', mantenimiento: 'mantenimiento', prorretencion: 'proretencion' })[key] || null;
/** Cuentas del catálogo habilitadas para la entidad en la fuente, en el orden del manual. */
export const cuentasHabilitadasDe = (key, id) => { const c = colPlan(key, id); return c ? CATALOGO.cuentas.filter(x => x.subvenciones.includes(c)) : []; };

const num = (v) => { const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN); return Number.isFinite(n) ? n : 0; };
const texto = (v) => (typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v) ? String(v) : ''));
const plano = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const z12 = () => new Array(12).fill(0);
const idx = (fecha) => { const m = mesDeFecha(fecha); return m ? MESES.indexOf(m) : null; };
const sumaMeses = (o) => MESES.reduce((s, m) => s + num(o && o.meses && o.meses[m]), 0);
const ofDe = (docs, id, key) => (docs[id] && docs[id].otras_fuentes && docs[id].otras_fuentes[key]) || {};

/** Honorarios de una entidad en una fuente: { porMes:[12] (boletas), proyPorMes:[12], boletas, proy, total, porClave:{clave→[12]}, proyPorClave:{clave→[12]}, excluidas:[ids], nBoletas }. */
export function honFuenteDe(docs, id, key) {
  const of = ofDe(docs, id, key);
  const porConcepto = esConcepto(key);
  const porMes = z12(), proyPorMes = z12(), porClave = {}, proyPorClave = {}, excluidas = [];
  let nBoletas = 0;
  if (SIN_GASTO.includes(key)) return { porMes, proyPorMes, boletas: 0, proy: 0, total: 0, porClave, proyPorClave, excluidas, nBoletas };
  Object.entries(plano(of.honorarios)).forEach(([bid, h]) => {
    if (!h || typeof h !== 'object' || Array.isArray(h)) return;
    nBoletas++;
    const i = idx(h.fechaDocumento);
    const clave = porConcepto ? texto(h.concepto).trim() : texto(h.codigo);
    if (i === null || !clave || (!porConcepto && !CUENTAS_HON.has(clave))) { excluidas.push(bid); return; }
    porMes[i] += num(h.montoGasto);
    (porClave[clave] = porClave[clave] || z12())[i] += num(h.montoGasto);
  });
  Object.entries(plano(of.hon_proyeccion_items)).forEach(([clave, it]) => {
    MESES.forEach((m, i) => { const v = num(it && it.meses && it.meses[m]); proyPorMes[i] += v; (proyPorClave[clave] = proyPorClave[clave] || z12())[i] += v; });
  });
  const s = (a) => a.reduce((x, y) => x + y, 0);
  return { porMes, proyPorMes, boletas: s(porMes), proy: s(proyPorMes), total: s(porMes) + s(proyPorMes), porClave, proyPorClave, excluidas, nBoletas };
}

/** Todo lo esperado de una entidad en una fuente (los 9 tipos), con honorarios: { real, proy, total } cada uno { ingreso, rem, hon, bys, gasto, saldo }, saldoOp (JUNJI), estado, causas. */
export function entidadDe(docs, id, key) {
  const hon = honFuenteDe(docs, id, key);
  const r = Math.round;
  const honReal = r(hon.boletas), honProy = r(hon.proy);
  let real, proy, total, saldoOp = null;
  const of = ofDe(docs, id, key);
  const corte = corteFuente(docs, id, key);
  const parte = (l) => { let a = 0, b = 0; MESES.forEach((m, i) => { const v = num(l && l.meses && l.meses[m]); if (i + 1 <= corte) a += v; else b += v; }); return { real: a, proy: b }; };
  const ing = lineasIngreso(key, of).map(parte).reduce((a, p) => ({ real: a.real + p.real, proy: a.proy + p.proy }), { real: 0, proy: 0 });
  const rem = SIN_GASTO.includes(key) ? { real: 0, proy: 0 } : parte(of.gasto_rem);
  if (esConcepto(key)) {
    // por concepto: «sin documento» (montos mensuales, Real hasta el corte y Proyectado después) + «documentado» (compras, siempre Real); ni una ni otra en las fuentes sin B&S
    const sin = SIN_BYS.includes(key) ? { real: 0, proy: 0 } : Object.values(plano(of.bys_items)).filter(it => it && typeof it === 'object').map(parte).reduce((a, p) => ({ real: a.real + p.real, proy: a.proy + p.proy }), { real: 0, proy: 0 });
    const doc = SIN_BYS.includes(key) ? { total: 0 } : documentadoDe(docs, id, key);
    const bysDoc = r(doc.total), bysSinReal = r(sin.real), bysSinProy = r(sin.proy);
    real = { ingreso: r(ing.real), rem: r(rem.real), bys: bysSinReal + bysDoc };
    proy = { ingreso: r(ing.proy), rem: r(rem.proy), bys: bysSinProy };
    total = { ingreso: real.ingreso + proy.ingreso, rem: real.rem + proy.rem, bys: real.bys + proy.bys };
    if (key === 'junji') saldoOp = r(sumaMeses(of.ingreso_operacion)) - total.bys;
  } else {
    const compras = Object.values(plano(of.compras)).filter(c => c && typeof c === 'object').reduce((s, c) => s + (/^nota de cr[eé]dito/i.test(texto(c.tipoDocumento)) ? -Math.abs(num(c.montoGasto)) : (/^nota de d[eé]bito/i.test(texto(c.tipoDocumento)) ? Math.abs(num(c.montoGasto)) : num(c.montoGasto))), 0);
    const fondos = key === 'general' ? fondosGeneral(docs, id).reduce((a, b) => a + b, 0) : 0; // Fondos Fijos registrados en General: B&S Real
    const bysProy = Object.values(plano(of.bys_proy_items)).reduce((s, it) => s + sumaMeses(it), 0);
    real = { ingreso: r(ing.real), rem: r(rem.real), bys: r(compras + fondos) };
    proy = { ingreso: r(ing.proy), rem: r(rem.proy), bys: r(bysProy) };
    total = { ingreso: real.ingreso + proy.ingreso, rem: real.rem + proy.rem, bys: real.bys + proy.bys };
  }
  real.hon = honReal; proy.hon = honProy; total.hon = honReal + honProy;
  [real, proy, total].forEach(b => { b.gasto = b.rem + b.hon + b.bys; b.saldo = b.ingreso - b.gasto; });
  const causas = [];
  if (total.saldo < 0) causas.push('saldo');
  if (saldoOp !== null && saldoOp < 0) causas.push('operacion_bys');
  return { id, key, corte: corteFuente(docs, id, key), real, proy, total, saldoOp, estado: causas.length ? 'deficit' : 'superavit', causas, hon };
}

/** Esperado de TODAS las entidades de una fuente: { porId, suma:{real,proy,total,nEntidades,nDeficit} }. */
export function fuenteEsperada(docs, key) {
  const f = FUENTES.find(x => x.key === key);
  const porId = {};
  idsDeUniverso(f.universo).forEach(id => { porId[id] = entidadDe(docs, id, key); });
  const vacio = () => ({ ingreso: 0, rem: 0, hon: 0, bys: 0, gasto: 0, saldo: 0 });
  const suma = { real: vacio(), proy: vacio(), total: vacio(), nEntidades: 0, nDeficit: 0 };
  Object.values(porId).forEach(e => {
    ['real', 'proy', 'total'].forEach(k => Object.keys(suma[k]).forEach(c => { suma[k][c] += e[k][c]; }));
    suma.nEntidades++;
    if (e.estado === 'deficit') suma.nDeficit++;
  });
  return { porId, suma };
}

/** Serie mensual esperada de una fuente (o de una sola entidad): { ing, rem, hon, bys, gas }, cada una { real:[12], proy:[12] }. La documentada y las compras son siempre Real. */
export function serieMensual(docs, key, soloId = null) {
  const f = FUENTES.find(x => x.key === key);
  const out = { ing: { real: z12(), proy: z12() }, rem: { real: z12(), proy: z12() }, hon: { real: z12(), proy: z12() }, bys: { real: z12(), proy: z12() }, gas: { real: z12(), proy: z12() } };
  idsDeUniverso(f.universo).forEach(id => {
    if (soloId && id !== soloId) return;
    const of = ofDe(docs, id, key);
    const corte = corteFuente(docs, id, key);
    const poner = (l, dst) => MESES.forEach((m, i) => { const v = num(l && l.meses && l.meses[m]); (i + 1 <= corte ? dst.real : dst.proy)[i] += v; });
    lineasIngreso(key, of).forEach(l => poner(l, out.ing));
    if (!SIN_GASTO.includes(key)) poner(of.gasto_rem, out.rem);
    if (esConcepto(key)) {
      if (!SIN_BYS.includes(key)) {
        Object.values(plano(of.bys_items)).filter(it => it && typeof it === 'object').forEach(it => poner(it, out.bys));
        documentadoDe(docs, id, key).porMes.forEach((v, i) => { out.bys.real[i] += v; });
      }
    } else {
      Object.values(plano(of.compras)).filter(c => c && typeof c === 'object').forEach(c => {
        const i = idx(c.fechaDocumento);
        if (i === null) return;
        const t = texto(c.tipoDocumento), v = num(c.montoGasto);
        out.bys.real[i] += /^nota de cr[eé]dito/i.test(t) ? -Math.abs(v) : (/^nota de d[eé]bito/i.test(t) ? Math.abs(v) : v);
      });
      Object.values(plano(of.bys_proy_items)).forEach(it => MESES.forEach((m, i) => { out.bys.proy[i] += num(it && it.meses && it.meses[m]); }));
      if (key === 'general') fondosGeneral(docs, id).forEach((v, i) => { out.bys.real[i] += v; });
    }
  });
  idsDeUniverso(f.universo).forEach(id => {
    if (soloId && id !== soloId) return;
    const h = honFuenteDe(docs, id, key);
    h.porMes.forEach((v, i) => { out.hon.real[i] += v; });
    h.proyPorMes.forEach((v, i) => { out.hon.proy[i] += v; });
  });
  ['real', 'proy'].forEach(k => { out.gas[k] = out.rem[k].map((v, i) => v + out.hon[k][i] + out.bys[k][i]); });
  return out;
}

// ---------------------------------------------------------------- lectores de la pantalla
/** "$1.234.567" / "-$1.234" / "—" → número entero. */
export const clp = (t) => { const s = String(t).replace(/\s/g, ''); const n = Number(s.replace(/[^\d]/g, '')); return /^-/.test(s) ? -n : n; };
export const fmt = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round(n)).toLocaleString('es-CL');

/** Tarjetas KPI de la pestaña de una fuente: { real|proy|total: { rótulo → { valor, nota } } }. */
export function leerTarjetas(page, key) {
  return page.evaluate((k) => {
    const out = {};
    for (const tipo of ['real', 'proy', 'total']) {
      const por = {};
      document.querySelectorAll(`#ofKpiRow-${tipo}-${k} .kpi-card`).forEach(c => { por[c.querySelector('.label').textContent.trim()] = { valor: c.querySelector('.value').textContent.trim(), nota: c.querySelector('.delta').textContent.trim() }; });
      out[tipo] = por;
    }
    return out;
  }, key);
}
/** Filas de la tabla de una fuente: { id: { ingreso, rem, hon, bys, gasto, saldo, estado } } (texto de las celdas; B&S sin el «Doc. $X · S/doc. $Y»). */
export function leerFilas(page, key) {
  return page.evaluate((k) => {
    const out = {};
    const tabla = document.querySelector(`#otrasFuentesTable-${k}`);
    // las columnas se ubican por el rótulo del encabezado: Asignación Familiar no lleva B&S y Recuperación LLMM solo ingreso y saldo
    const cols = Array.from(tabla.querySelectorAll('thead th')).map(th => th.textContent.trim());
    const col = (re) => cols.findIndex(t => re.test(t));
    const ix = { ingreso: col(/^Ingreso/), rem: col(/^Gasto Remuneraciones/), hon: col(/^Gasto Honorarios/), bys: col(/^Gasto Bienes/), gasto: col(/^Gasto Total/), saldo: col(/^Saldo/) };
    document.querySelectorAll(`#otrasFuentesTbody-${k} tr[data-rbd]`).forEach(tr => {
      const c = Array.from(tr.children).map(td => td.cloneNode(true));
      const leer = (n) => { if (n < 0) return '—'; const sp = c[n].querySelector('.of-bys-split'); if (sp) sp.remove(); return c[n].textContent.trim(); };
      const tag = tr.querySelector('.tag');
      out[tr.dataset.rbd] = { ingreso: leer(ix.ingreso), rem: leer(ix.rem), hon: leer(ix.hon), bys: leer(ix.bys), gasto: leer(ix.gasto), saldo: leer(ix.saldo), estado: tag ? tag.textContent.trim() : '' };
    });
    return out;
  }, key);
}
export async function abrirModal(h, fuente, id) {
  await h.clickTab('of-' + fuente);
  await h.page.click(`#otrasFuentesTbody-${fuente} td[data-abrir-otra-fuente="${id}"]`);
  await h.waitIdle();
}
export async function cerrarModal(h) { await h.page.keyboard.press('Escape'); await h.waitIdle(); }
/** Meses de la fila de solo lectura «Honorarios (Subt. 21)» del modal abierto: { ENERO: n, …, total }. */
export function filaBoletasMeses(page) {
  return page.evaluate((meses) => {
    const tr = Array.from(document.querySelectorAll('#otrasFuentesModalBody .hon-block tr')).find(x => { const l = x.querySelector('td.item-label'); return l && l.textContent.trim() === 'Honorarios (Subt. 21)' && !x.querySelector('input'); });
    if (!tr) return null;
    const n = (t) => { const s = t.replace(/[^\d-]/g, ''); return /\d/.test(t) ? Number(s) : 0; };
    const o = {}; meses.forEach((m, i) => { o[m] = n(tr.children[1 + i].textContent); }); o.total = n(tr.children[13].textContent); return o;
  }, MESES);
}
/** Celdas editables de la fila de proyección de una cuenta o concepto: { ENERO: n, … } o null. */
export function filaProyeccionOF(page, clave, porConcepto) {
  return page.evaluate(([c, pc, meses]) => {
    const campo = pc ? 'concepto' : 'codigo';
    const inputs = Array.from(document.querySelectorAll('#otrasFuentesModalBody input.celda-input[data-modo="of_hon_proy_item"]')).filter(i => i.dataset[campo] === c);
    if (!inputs.length) return null;
    const o = {}; inputs.forEach(i => { o[i.dataset.mes] = i.value === '' ? 0 : Number(i.value.replace(',', '.')); });
    return meses.reduce((a, m) => { a[m] = o[m] || 0; return a; }, {});
  }, [clave, !!porConcepto, MESES]);
}
/** Rellena el formulario de honorarios del modal de una fuente (campos por data-field; los <select> reciben el valor de la opción). */
export async function llenarFormHonOF(page, campos) {
  await page.evaluate((cs) => {
    const wrap = document.querySelector('#otrasFuentesModalBody .hon-form-grid');
    Object.entries(cs).forEach(([field, valor]) => {
      const el = wrap.querySelector(`.hon-input[data-field="${field}"]`);
      if (!el) throw new Error('no existe el campo ' + field);
      el.value = valor;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }, campos);
}
/** Filas del registro de honorarios del modal abierto: [{ id, celdas:[texto…] }]. */
export function filasRegistroHon(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody table.hon-table tbody tr[data-hon-id]')).map(tr => ({
    id: tr.dataset.honId, celdas: Array.from(tr.children).slice(0, 11).map(td => td.textContent.replace(/\s+/g, ' ').trim()), html: tr.innerHTML,
  })));
}
/** Boleta de ejemplo con cuenta (General, PIE, Mantención, Pro-Retención) o con concepto. */
export const boletaCuenta = (extra = {}) => ({ codigo: '410803', tipoDocumento: 'BOLHE', nroDocumento: '54', fechaDocumento: '2026-01-21', fechaPago: '2026-01-28', descripcion: 'Taller de ajedrez enero 2026', rutProveedor: '11111111-1', nombreProveedor: 'Nombre Apellido Apellido', montoGasto: 600000, montoDocumento: 600000, ...extra });
export const boletaConcepto = (extra = {}) => { const b = boletaCuenta({ concepto: 'Apoyo pedagógico', ...extra }); delete b.codigo; return b; };
