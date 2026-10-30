// Oráculo INDEPENDIENTE (sin código de index.html) del gasto de Remuneraciones de JUNJI en 4 líneas.
//
// Documento de Firestore (`otras_fuentes.junji`): `gasto_rem_operacion`, `gasto_rem_homologacion`, `gasto_rem_carrera_docente`, `gasto_rem_bdl`, cada uno `{meses,total}`.
// El campo ANTIGUO `gasto_rem` solo es respaldo de lectura de Operación, MES A MES: si el mes está en `gasto_rem_operacion` (número finito) manda ese; si no, el mes de `gasto_rem`.
// Nunca se suman los dos. Las otras 3 líneas sin campo valen 0.
//
// Saldos (sobre el Total Real+Proy, pesos enteros): saldo propio de una línea = ingreso − gasto Rem.; una línea restringida (Homologación, Carrera Docente Parvularia, BDL) con saldo
// negativo carga el EXCESO a Operación; saldo de Operación para B&S = Ingreso Operación − Gasto Rem. Operación − exceso − B&S. Los honorarios no entran.
import { MESES } from './corte.mjs';

export const LINEAS = [
  { key: 'operacion', campo: 'gasto_rem_operacion', ingreso: 'ingreso_operacion', restringida: false, corto: 'Operación', titulo: 'Gasto Remuneraciones Operación', hoja: 'REM_OPERACION' },
  { key: 'homologacion', campo: 'gasto_rem_homologacion', ingreso: 'ingreso_homologacion', restringida: true, corto: 'Homologación', titulo: 'Gasto Remuneraciones Homologación', hoja: 'REM_HOMOLOGACION' },
  { key: 'carrera_docente', campo: 'gasto_rem_carrera_docente', ingreso: 'ingreso_carrera_docente', restringida: true, corto: 'Carrera Docente Parvularia', titulo: 'Gasto Remuneraciones Carrera Docente Parvularia', hoja: 'REM_CARRERA_DOCENTE_PARVULARIA' },
  { key: 'bdl', campo: 'gasto_rem_bdl', ingreso: 'ingreso_bdl', restringida: true, corto: 'BDL', titulo: 'Gasto Remuneraciones BDL', hoja: 'REM_BDL' },
];
const plano = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
const num = (v) => { const n = (typeof v === 'number') ? v : ((typeof v === 'string' && v.trim() !== '') ? Number(v) : NaN); return Number.isFinite(n) ? n : 0; };
export const sumaMeses = (o) => MESES.reduce((s, m) => s + num(o && o.meses && o.meses[m]), 0);

/** { operacion, homologacion, carrera_docente, bdl }, cada una `{meses}` con los 12 meses leídos como los lee el panel. */
export function remLineasDe(of) {
  of = plano(of);
  const ant = plano(plano(of.gasto_rem).meses), op = plano(plano(of.gasto_rem_operacion).meses);
  const out = {};
  LINEAS.forEach(l => {
    const crudo = plano(plano(of[l.campo]).meses), meses = {};
    MESES.forEach(m => {
      if (l.key === 'operacion') meses[m] = (typeof op[m] === 'number' && Number.isFinite(op[m])) ? op[m] : num(ant[m]);
      else meses[m] = num(crudo[m]);
    });
    out[l.key] = { meses };
  });
  return out;
}
/** El «gasto_rem» de la entidad = suma mensual de las 4 líneas (forma `{meses}`). */
export function remEfectivoDe(of) {
  const ls = remLineasDe(of), meses = {};
  MESES.forEach(m => { meses[m] = LINEAS.reduce((s, l) => s + ls[l.key].meses[m], 0); });
  return { meses };
}
/** Saldos por línea y de Operación. `bys` = B&S total (sin documento + documentado) de la entidad, en pesos. */
export function saldosJunjiDe(of, bys) {
  of = plano(of);
  const rem = remLineasDe(of);
  const lineas = LINEAS.map(l => {
    const ingreso = Math.round(sumaMeses(of[l.ingreso])), gasto = Math.round(sumaMeses(rem[l.key]));
    const saldo = ingreso - gasto;
    return { ...l, ingreso, gasto, saldo, exceso: (l.restringida && saldo < 0) ? -saldo : 0 };
  });
  const excesoTotal = lineas.reduce((s, l) => s + l.exceso, 0);
  const op = lineas[0];
  return { lineas, excesoTotal, saldoOp: op.ingreso - op.gasto - excesoTotal - Math.round(bys) };
}

/** Copia del documento con la Remuneración de Operación de JUNJI «unificada»: `gasto_rem_operacion` = Operación efectiva y sin el campo antiguo `gasto_rem`. Sirve para comparar documentos antes y después
 *  de una importación de Excel (que escribe Operación en el campo nuevo) sin que importe en cuál de los dos campos estaba el mismo valor. */
export function unificarRemJunji(doc) {
  const d = JSON.parse(JSON.stringify(doc));
  const j = d && d.otras_fuentes && d.otras_fuentes.junji;
  if (!j || typeof j !== 'object') return d;
  const op = remLineasDe(j).operacion;
  if (!sumaMeses(op) && !j.gasto_rem && !j.gasto_rem_operacion) return d;
  j.gasto_rem_operacion = { meses: op.meses, total: sumaMeses(op) };
  delete j.gasto_rem;
  return d;
}
