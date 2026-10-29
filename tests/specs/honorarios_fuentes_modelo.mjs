// Honorarios (Subt. 21) por boleta en las 9 fuentes (PR-3): MODELO, lectura y guardado. Fixture `honorarios_fuentes`.
//   · lectura de `otras_fuentes.<fuente>.honorarios` y `.hon_proyeccion_items` SIN escribir; fila de boletas por mes (siempre Real), proyección por cuenta/concepto, registro y avisos
//     contra un cálculo independiente (tests/lib/honorarios_fuentes.mjs), con cuenta (General, AC, PIE, Mantenimiento, Pro-Retención) y con concepto (JUNJI, FAEP, FIGA, Aportes);
//   · el selector de cuenta sale de la columna del Plan de Cuentas de la subvención (General 35, Adm. Central General 26, PIE 8, Mantenimiento 13, Pro-Retención 12) y el de tipo solo ofrece
//     los que esa cuenta acepta; las fuentes por concepto llevan un campo Concepto (con sugerencias) y los 5 tipos;
//   · alta / edición / duplicado / borrado = un write merge de SOLO `otras_fuentes.<fuente>.honorarios.<id>` (nada de compras, ingreso, remuneraciones ni B&S); validaciones sin write;
//   · proyección: agregar la cuenta o el concepto, teclear un mes (write parcial de ese mes) y quitarla (deleteField); sin duplicados; clave inválida rechazada;
//   · otra persona editando otra boleta con el formulario a medias; documentos dañados; recarga; las compras antiguas con tipo de honorarios (marca «⚠ muévelo a Honorarios»).
import { boot } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { docsDe, clon } from '../lib/corte.mjs';
import {
  MESES, honFuenteDe, entidadDe, abrirModal, cerrarModal, filaBoletasMeses, filaProyeccionOF, llenarFormHonOF, filasRegistroHon, leerFilas, clp, cuentasHabilitadasDe,
  boletaCuenta, boletaConcepto,
} from '../lib/honorarios_fuentes.mjs';

const MODAL = '#otrasFuentesModalBody';
const FORM = `${MODAL} .hon-form-grid`;
const BTN_ADD = `${FORM} .add-hon-btn`;
const enMeses = (o) => MESES.map(m => o[m] || 0);

const opcionesDe = (page, campo) => page.evaluate(([f, sel]) => Array.from(document.querySelectorAll(`${sel} .hon-input[data-field="${f}"] option`)).map(o => o.value).filter(Boolean), [campo, FORM]);
// Marcas ⚠ de FECHA de cada fila (las de cuenta, concepto y tipo se prueban aparte).
const marcasPorFila = (page) => page.evaluate(() => {
  const o = {};
  document.querySelectorAll('#otrasFuentesModalBody table.hon-table tbody tr[data-hon-id]').forEach(tr => { o[tr.dataset.honId] = Array.from(tr.querySelectorAll('.compra-aviso-fecha')).map(s => s.textContent.trim()).filter(x => /fecha/.test(x)); });
  return o;
});
const resumenHon = (page) => page.evaluate(() => (document.querySelector('#otrasFuentesModalBody .hon-avisos-resumen') || {}).textContent || '');
const escritosDe = (h, id) => h.writes().then(ws => ws.filter(w => w.path === `sep_carga_rbd/${id}`));

await correrSpec('honorarios_fuentes_modelo', async (t) => {
  const docs = docsDe('honorarios_fuentes');

  // ============================== 1. LECTURA con cuenta: General / 1121 y la fila AC (sin escribir) ==============================
  let h = await boot({ fixture: 'honorarios_fuentes' });
  await abrirModal(h, 'general', '1121');
  let hon = honFuenteDe(docs, '1121', 'general');
  t.eq((await h.writes()).length, 0, 'leer las boletas no escribe nada en Firestore');
  const fila = await filaBoletasMeses(h.page);
  t.eq(enMeses(fila), hon.porMes, 'fila «Honorarios (Subt. 21)»: boletas por mes de su Fecha Documento = cálculo independiente (fecha de 2025 en diciembre; la inválida y la de cuenta 999999 fuera)');
  t.eq(fila.total, 1040000, 'total de boletas $1.040.000 (400.000 + 250.000 + 150.000 + 90.000 + 70.000 + 45.000 + 35.000)');
  t.eq(await filaProyeccionOF(h.page, '410803', false), Object.fromEntries(MESES.map((m, i) => [m, hon.proyPorClave['410803'][i]])), 'proyección de 410803 (enero 50.000 y agosto-diciembre 100.000) en celdas editables');
  t.eq(await filaProyeccionOF(h.page, '410304', false), Object.fromEntries(MESES.map((m, i) => [m, hon.proyPorClave['410304'][i]])), 'proyección de 410304');
  t.ok(/enero/i.test(await h.page.evaluate(() => (document.querySelector('#otrasFuentesModalBody .hon-aviso-doble') || {}).textContent || '')), 'aviso: enero tiene boleta y proyección a la vez (se SUMAN)');
  const filas = await filasRegistroHon(h.page);
  t.eq(filas.length, 9, 'el registro lista las 9 boletas (también las que no entran en los totales)');
  const byId = Object.fromEntries(filas.map(f => [f.id, f.celdas]));
  t.eq([byId.gh1121_2[0], byId.gh1121_2[1], byId.gh1121_2[2], byId.gh1121_2[3], byId.gh1121_2[8], byId.gh1121_2[10]],
    ['410304 · OTROS GASTOS EN PERSONAL', 'Boleta de honorarios exenta', '102', '2026-03-03', '$250.000', 'DC_801'], 'una boleta: cuenta con su nombre, tipo con su nombre, N°, fecha, monto gasto y N° DC');
  t.eq([byId.gh1121_3[8], byId.gh1121_3[9]], ['$150.000', '$400.000'], 'reparto: Monto Gasto 150.000 de un documento de 400.000 (suma el Monto Gasto)');
  const ordenado = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => a[0].localeCompare(b[0])));
  t.eq(ordenado(await marcasPorFila(h.page)), ordenado({
    gh1121_1: [], gh1121_2: [], gh1121_3: [], gh1121_especial: [],
    gh1121_f2025: ['⚠ fecha fuera de 2026'], gh1121_invalida: ['⚠ fecha no válida: no se contabiliza'], gh1121_cuenta_x: [], gh1121_tipo_fac: [], gh1121_tipo_np: [],
  }), 'marcas de fecha por fila (las de cuenta y tipo se prueban abajo)');
  const marcasTodas = await h.page.evaluate(() => { const o = {}; document.querySelectorAll('#otrasFuentesModalBody table.hon-table tbody tr[data-hon-id]').forEach(tr => { o[tr.dataset.honId] = Array.from(tr.querySelectorAll('[class*="compra-aviso"]')).map(s => s.textContent.trim()); }); return o; });
  t.ok((marcasTodas.gh1121_cuenta_x || []).some(m => /cuenta no reconocida/.test(m)), 'cuenta 999999: «cuenta no reconocida: no se contabiliza»', marcasTodas.gh1121_cuenta_x);
  t.ok((marcasTodas.gh1121_tipo_fac || []).some(m => /no es un tipo de honorarios/.test(m)), 'tipo FAC: «no es un tipo de honorarios»', marcasTodas.gh1121_tipo_fac);
  t.ok((marcasTodas.gh1121_tipo_np || []).some(m => /tipo no permitido para la cuenta/.test(m)), '410904 con BHE: «tipo no permitido para la cuenta»', marcasTodas.gh1121_tipo_np);
  const res = await resumenHon(h.page);
  t.ok(/5 boletas con avisos; \$115\.000 sin contabilizar \(2 boletas que no entran/.test(res), 'resumen: 5 boletas con avisos y $115.000 sin contabilizar (2 que no entran en ningún total)', res);
  t.eq((await opcionesDe(h.page, 'codigo')).length, cuentasHabilitadasDe('general', '1121').length, 'selector de cuenta: las 35 cuentas del catálogo habilitadas en la columna «General»');
  t.eq(cuentasHabilitadasDe('general', '1121').length, 35, 'cálculo independiente: 35 cuentas en General');
  t.eq(await opcionesDe(h.page, 'tipoDocumento'), ['BOLH', 'BHE', 'BOLHE', 'BPST', 'BPSTE'], 'sin cuenta elegida el selector ofrece los 5 tipos de honorarios');
  await h.page.selectOption(`${FORM} .hon-input[data-field="codigo"]`, '410801');
  await h.waitIdle();
  t.eq(await opcionesDe(h.page, 'tipoDocumento'), ['BOLH', 'BHE', 'BPST', 'BPSTE'], 'con la cuenta 410801 (sin BOLHE) el selector solo ofrece los 4 que acepta');
  t.eq(await h.page.evaluate(() => document.querySelectorAll('#otrasFuentesModalBody .hon-input[data-field="concepto"]').length), 0, 'una fuente con cuenta NO tiene campo Concepto');
  t.ok(/35 cuentas aceptan documentos de honorarios de 36/.test(await h.page.evaluate(() => document.querySelector('#otrasFuentesModalBody .hon-section .plan-nota').textContent)), 'la nota dice cuántas cuentas acepta la subvención');
  // totales de la fila de la pestaña
  await cerrarModal(h);
  const e = entidadDe(docs, '1121', 'general');
  const f1121 = (await leerFilas(h.page, 'general'))['1121'];
  t.eq([clp(f1121.hon), clp(f1121.gasto), clp(f1121.saldo)], [e.total.hon, e.total.gasto, e.total.saldo], 'fila 1121 de General: Honorarios, Gasto Total (rem + hon + B&S) y Saldo = cálculo independiente');
  t.eq(e.total.hon, 1040000 + 870000, 'honorarios de la fila = boletas 1.040.000 + proyección 870.000 (se SUMAN)');
  // la fila AC usa la columna «Adm. Central General»
  await abrirModal(h, 'general', 'AC');
  t.eq((await opcionesDe(h.page, 'codigo')).length, 26, 'la fila AC de General habilita 26 cuentas (columna «Adm. Central General»)');
  t.ok(/Subvención General — Administración Central/.test(await h.page.evaluate(() => document.querySelector('#otrasFuentesModalBody .hon-section .plan-nota').textContent)), 'la nota nombra a Administración Central');
  const marcasAC = await h.page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody tr[data-hon-id="gh_ac_nohab"] [class*="compra-aviso"]')).map(s => s.textContent.trim()));
  t.ok(marcasAC.some(m => /cuenta no habilitada para Subvención General/.test(m)), '410608 en AC: «cuenta no habilitada» (se cuenta igual en los totales)', marcasAC);
  t.eq(enMeses(await filaBoletasMeses(h.page)), honFuenteDe(docs, 'AC', 'general').porMes, 'boletas de AC por mes = cálculo independiente (la no habilitada suma)');
  await cerrarModal(h);

  // ---- PIE, Mantenimiento y Pro-Retención: columnas propias del Plan de Cuentas
  for (const [fuente, id, nCuentas] of [['pie', '1121', 8], ['mantenimiento', '1121', 13], ['prorretencion', '1121', 12]]) {
    await abrirModal(h, fuente, id);
    const hf = honFuenteDe(docs, id, fuente);
    t.eq((await opcionesDe(h.page, 'codigo')).length, nCuentas, `${fuente}: el selector de cuenta ofrece las ${nCuentas} cuentas de su columna`);
    t.eq(cuentasHabilitadasDe(fuente, id).length, nCuentas, `${fuente}: cálculo independiente de la columna (${nCuentas})`);
    t.eq(enMeses(await filaBoletasMeses(h.page)), hf.porMes, `${fuente} / ${id}: boletas por mes = cálculo independiente`);
    await cerrarModal(h);
  }
  await abrirModal(h, 'mantenimiento', '1121');
  t.ok((await h.page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody tr[data-hon-id="mh1121_nohab"] [class*="compra-aviso"]')).map(s => s.textContent))).some(m => /cuenta no habilitada para Subv\. Mantenimiento/.test(m)),
    'Mantenimiento: la cuenta 410304 (personal) no está habilitada y se marca ⚠ (suma igual)');
  await cerrarModal(h);
  t.noErrores(h);
  await h.close();

  // ============================== 2. LECTURA por concepto: JUNJI / 5402002 y FAEP / AC ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  await abrirModal(h, 'junji', '5402002');
  hon = honFuenteDe(docs, '5402002', 'junji');
  t.eq(enMeses(await filaBoletasMeses(h.page)), hon.porMes, 'JUNJI 5402002: boletas por mes = cálculo independiente (octubre, después del corte en julio, igual Real; sin concepto y fecha inválida fuera)');
  t.eq(await filaProyeccionOF(h.page, 'Apoyo pedagógico', true), Object.fromEntries(MESES.map((m, i) => [m, hon.proyPorClave['Apoyo pedagógico'][i]])), 'proyección por concepto «Apoyo pedagógico»');
  t.eq(await filaProyeccionOF(h.page, 'Taller de música', true), Object.fromEntries(MESES.map((m, i) => [m, hon.proyPorClave['Taller de música'][i]])), 'proyección por concepto «Taller de música»');
  t.eq(await h.page.evaluate(() => document.querySelectorAll('#otrasFuentesModalBody .hon-input[data-field="codigo"]').length), 0, 'JUNJI NO tiene selector de cuenta de honorarios');
  t.eq(await h.page.evaluate(() => { const i = document.querySelector('#otrasFuentesModalBody .hon-form-grid .hon-input[data-field="concepto"]'); return i ? i.getAttribute('list') : null; }), 'ofhonconceptos-5402002-junji', 'el campo Concepto apunta a su lista de sugerencias');
  t.eq(await h.page.evaluate(() => Array.from(document.querySelectorAll('#ofhonconceptos-5402002-junji option')).map(o => o.value)), ['Apoyo pedagógico', 'Educadora "extra" & <b>x</b>', 'Taller de música'], 'sugerencias: los conceptos de honorarios de la entidad (boletas y proyección), sin repetir y ordenados');
  t.eq(await opcionesDe(h.page, 'tipoDocumento'), ['BOLH', 'BHE', 'BOLHE', 'BPST', 'BPSTE'], 'sin cuenta, el selector de tipo ofrece los 5 de honorarios');
  const filasJ = await filasRegistroHon(h.page);
  t.eq(filasJ.length, 9, 'el registro lista las 9 boletas');
  t.eq(filasJ.find(f => f.id === 'jh5402002_3').celdas.slice(0, 3).concat([filasJ.find(f => f.id === 'jh5402002_3').celdas[10]]), ['Taller de música', 'Boleta honorarios prestación de servicios a terceros', '703', 'DC_901'], 'una boleta por concepto: concepto, tipo, N° y N° DC');
  const marcasJ = await h.page.evaluate(() => { const o = {}; document.querySelectorAll('#otrasFuentesModalBody table.hon-table tbody tr[data-hon-id]').forEach(tr => { o[tr.dataset.honId] = Array.from(tr.querySelectorAll('[class*="compra-aviso"]')).map(s => s.textContent.trim()); }); return o; });
  t.ok((marcasJ.jh5402002_sinconcepto || []).some(m => /concepto vacío: no se contabiliza/.test(m)), 'boleta sin concepto: «⚠ concepto vacío: no se contabiliza»', marcasJ.jh5402002_sinconcepto);
  t.ok((marcasJ.jh5402002_f2025 || []).some(m => /fecha fuera de 2026/.test(m)), 'fecha de 2025: «⚠ fecha fuera de 2026»');
  t.ok((marcasJ.jh5402002_invalida || []).some(m => /fecha no válida: no se contabiliza/.test(m)), 'fecha 10/03/2026: no se contabiliza');
  t.ok((marcasJ.jh5402002_tipo_fac || []).some(m => /no es un tipo de honorarios/.test(m)), 'tipo FAC: «no es un tipo de honorarios»');
  t.ok(!(marcasJ.jh5402002_1 || []).length && !(marcasJ.jh5402002_especial || []).length, 'las boletas sin problemas no llevan marcas');
  t.ok(/4 boletas con avisos; \$70\.000 sin contabilizar \(2 boletas que no entran/.test(await resumenHon(h.page)), 'resumen: 4 boletas con avisos y $70.000 sin contabilizar (sin concepto + fecha inválida)', await resumenHon(h.page));
  t.ok(/no tiene código de cuenta SUPEREDUC/.test(await h.page.evaluate(() => document.querySelector('#otrasFuentesModalBody .hon-section .plan-nota').textContent)), 'la nota explica que se identifica por concepto');
  t.ok(/NO cuentan en el saldo de Operación/.test(await h.page.evaluate(() => document.querySelector('#otrasFuentesModalBody .hon-section .detalle-sub').textContent)), 'en JUNJI el texto aclara que los honorarios no cuentan en el saldo de Operación para B&S');
  await cerrarModal(h);
  await abrirModal(h, 'faep', 'AC');
  t.eq(enMeses(await filaBoletasMeses(h.page)), honFuenteDe(docs, 'AC', 'faep').porMes, 'FAEP / AC: boletas por mes');
  await cerrarModal(h);
  await abrirModal(h, 'faep', '5402002');
  t.eq(enMeses(await filaBoletasMeses(h.page)), honFuenteDe(docs, '5402002', 'faep').porMes, 'FAEP / jardín GESPARVU: boletas por mes');
  await cerrarModal(h);
  t.noErrores(h);
  await h.close();

  // ============================== 3. ALTA / EDICIÓN / DUPLICADO / BORRADO con cuenta: General / 1122 (un write por boleta) ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  await abrirModal(h, 'general', '1122');
  t.eq((await filaBoletasMeses(h.page)).total, 0, 'General 1122 parte sin boletas (solo proyección)');
  await llenarFormHonOF(h.page, { codigo: '410803', tipoDocumento: 'BOLHE', nroDocumento: '555', fechaDocumento: '2026-03-09', fechaPago: '2026-03-16', descripcion: 'Alta de prueba', rutProveedor: '11111111-1', nombreProveedor: 'Prueba SpA', montoGasto: '500000', documentoContable: 'DC_5' });
  await h.page.click(BTN_ADD);
  await h.flushWrites(); await h.waitIdle();
  let w = await escritosDe(h, '1122');
  t.eq(w.length, 1, 'agregar una boleta = un solo write en el documento de la entidad');
  t.ok(w[0].options && w[0].options.merge === true, 'setDoc con merge:true');
  const mapa = w[0].payload.otras_fuentes && w[0].payload.otras_fuentes.general && w[0].payload.otras_fuentes.general.honorarios;
  const ids = mapa ? Object.keys(mapa) : [];
  t.eq(ids.length, 1, 'el payload trae exactamente UNA boleta');
  t.eq(Object.keys(w[0].payload.otras_fuentes.general), ['honorarios'], 'bajo `general` solo viaja `honorarios` (no se tocan compras, ingreso, remuneraciones ni la proyección)');
  t.eq(Object.keys(w[0].payload).filter(k => !['nombre', 'otras_fuentes', 'lastModifiedBy', 'lastModifiedAt'].includes(k)), [], 'el documento solo recibe nombre, auditoría y esa boleta');
  const b0 = mapa[ids[0]];
  t.eq({ codigo: b0.codigo, tipo: b0.tipoDocumento, nro: b0.nroDocumento, doc: b0.fechaDocumento, pago: b0.fechaPago, gasto: b0.montoGasto, mdoc: b0.montoDocumento, dc: b0.documentoContable, orig: 'documentoOriginal' in b0 },
    { codigo: '410803', tipo: 'BOLHE', nro: '555', doc: '2026-03-09', pago: '2026-03-16', gasto: 500000, mdoc: 500000, dc: 'DC_5', orig: false }, 'la boleta guarda cuenta, tipo como CÓDIGO, N°, fechas, monto bruto (documento = gasto si se deja vacío), N° DC y sin Doc. original');
  t.eq((await filaBoletasMeses(h.page)).MARZO, 500000, 'la fila mensual muestra la boleta en MARZO (mes de su Fecha Documento)');
  const formVacio = await h.page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody .hon-form-grid .hon-input')).map(e => e.value).filter(Boolean));
  t.eq(formVacio, [], 'el formulario queda limpio después de guardar');
  const idNuevo = ids[0];
  // Edición
  await h.clearWrites();
  await h.page.click(`${MODAL} button.hon-edit-btn[data-hon-id="${idNuevo}"]`);
  t.eq(await h.page.evaluate(() => { const g = document.querySelector('#otrasFuentesModalBody .hon-form-grid'); return { editing: g.dataset.editingId, boton: g.querySelector('.add-hon-btn').textContent.trim(), cancelar: !g.querySelector('.cancelar-edicion-hon-btn').classList.contains('hidden'), cuenta: g.querySelector('[data-field="codigo"]').value, monto: g.querySelector('[data-field="montoGasto"]').value }; }),
    { editing: idNuevo, boton: '💾 Guardar cambios de honorario', cancelar: true, cuenta: '410803', monto: '500000' }, '✏️ carga la boleta (modo edición)');
  await llenarFormHonOF(h.page, { montoGasto: '650000', montoDocumento: '650000' });
  await h.page.click(BTN_ADD);
  await h.flushWrites(); await h.waitIdle();
  w = await escritosDe(h, '1122');
  t.eq([w.length, Object.keys(w[0].payload.otras_fuentes.general.honorarios), w[0].payload.otras_fuentes.general.honorarios[idNuevo].montoGasto], [1, [idNuevo], 650000], 'editar = un write de la MISMA boleta con el monto nuevo');
  t.eq((await filaBoletasMeses(h.page)).MARZO, 650000, 'la fila mensual refleja el monto editado');
  // Duplicado
  await h.clearWrites();
  await h.page.click(`${MODAL} button.hon-dup-btn[data-hon-id="${idNuevo}"]`);
  t.eq(await h.page.evaluate(() => { const g = document.querySelector('#otrasFuentesModalBody .hon-form-grid'); return [g.dataset.editingId || '', g.querySelector('[data-field="nroDocumento"]').value]; }), ['', '555'], '⧉ carga los datos SIN modo edición');
  await h.page.click(BTN_ADD);
  await h.flushWrites(); await h.waitIdle();
  w = await escritosDe(h, '1122');
  const idDup = Object.keys(w[0].payload.otras_fuentes.general.honorarios)[0];
  t.ok(w.length === 1 && idDup && idDup !== idNuevo, 'duplicar guarda una boleta con otro id (un solo write)');
  t.eq((await filaBoletasMeses(h.page)).MARZO, 1300000, 'las dos boletas suman 1.300.000');
  // Borrado
  await h.clearWrites();
  await h.page.click(`${MODAL} button.hon-del-btn[data-hon-id="${idDup}"]`);
  await h.flushWrites(); await h.waitIdle();
  w = await escritosDe(h, '1122');
  t.eq([w.length, JSON.stringify(w[0].payload.otras_fuentes)], [1, JSON.stringify({ general: { honorarios: { [idDup]: { __sentinel: 'deleteField' } } } })], 'borrar = deleteField SOLO de `otras_fuentes.general.honorarios.<id>`');
  t.eq((await filaBoletasMeses(h.page)).MARZO, 650000, 'el total baja en lo borrado');
  t.eq(Object.keys((await h.store())['sep_carga_rbd/1122'].otras_fuentes.general.honorarios), [idNuevo], 'el servidor conserva solo la boleta que queda');
  // Recarga: lo guardado vuelve
  await h.page.reload({ waitUntil: 'load' });
  await h.waitIdle();
  await h.page.waitForFunction(() => document.getElementById('sync-indicator').classList.contains('green'));
  await abrirModal(h, 'general', '1122');
  t.eq((await filaBoletasMeses(h.page)).MARZO, 650000, 'tras recargar la boleta sigue en el detalle');
  t.noErrores(h);
  await h.close();

  // ============================== 4. ALTA por concepto en las 5 fuentes y con cuenta en las 4: ruta del write y totales de la fila ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  const casos = [['general', '1125', true], ['pie', '1125', true], ['mantenimiento', '1125', true], ['prorretencion', '1125', true],
    ['junji', '5404003', false], ['faep', '1125', false], ['figa', '1125', false], ['aporte_educ', '1125', false], ['aporte_junji', '5404003', false]];
  for (const [fuente, id, conCuenta] of casos) {
    await abrirModal(h, fuente, id);
    await h.clearWrites();
    const antes = clp((await leerFilas(h.page, fuente))[id].hon);
    const cuenta = conCuenta ? (fuente === 'mantenimiento' ? '411601' : (fuente === 'pie' ? '410304' : '410803')) : null;
    await llenarFormHonOF(h.page, { ...(conCuenta ? { codigo: cuenta } : { concepto: 'Concepto de ' + fuente }), tipoDocumento: 'BOLHE', fechaDocumento: '2026-05-10', montoGasto: '123456' });
    await h.page.click(BTN_ADD);
    await h.flushWrites(); await h.waitIdle();
    const ws = await escritosDe(h, id);
    const hm = ws[0] && ws[0].payload.otras_fuentes && ws[0].payload.otras_fuentes[fuente] && ws[0].payload.otras_fuentes[fuente].honorarios;
    t.ok(ws.length === 1 && hm && Object.keys(hm).length === 1 && Object.keys(ws[0].payload.otras_fuentes).join() === fuente && Object.keys(ws[0].payload.otras_fuentes[fuente]).join() === 'honorarios',
      `${fuente} / ${id}: la boleta viaja en un write de SOLO \`otras_fuentes.${fuente}.honorarios.<id>\``, JSON.stringify(ws.map(x => x.payload)));
    const b = hm && Object.values(hm)[0];
    t.ok(b && (conCuenta ? b.codigo === cuenta && !('concepto' in b) : b.concepto === 'Concepto de ' + fuente && !('codigo' in b)), `${fuente}: la boleta lleva ${conCuenta ? 'cuenta' : 'concepto'} (y no ${conCuenta ? 'concepto' : 'cuenta'})`);
    await cerrarModal(h);
    t.eq(clp((await leerFilas(h.page, fuente))[id].hon), antes + 123456, `${fuente} / ${id}: la columna «Gasto Honorarios» de la pestaña sube en el monto registrado`);
  }
  t.noErrores(h);
  await h.close();

  // ============================== 5. VALIDACIONES sin write ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  const intentar = async (campos, patron, desc) => {
    await h.clearWrites();
    const n0 = h.dialogs.length;
    await h.page.click(`${FORM} .cancelar-edicion-hon-btn`, { force: true }).catch(() => {});
    await h.page.evaluate(() => { document.querySelectorAll('#otrasFuentesModalBody .hon-form-grid .hon-input').forEach(el => { el.value = ''; }); });   // formulario en blanco: cada intento arranca limpio
    await llenarFormHonOF(h.page, campos);
    await h.page.click(BTN_ADD);
    await h.waitIdle();
    const msg = h.dialogs.slice(n0).map(d => d.message).join(' | ');
    t.ok(patron.test(msg), desc + ' — aviso: ' + msg);
    t.eq((await h.writes()).length, 0, desc + ' — no escribe nada');
  };
  await abrirModal(h, 'pie', '1122');
  await intentar({ tipoDocumento: 'BOLHE', fechaDocumento: '2026-03-09', montoGasto: '1000' }, /cuenta de honorarios/i, 'sin cuenta');
  await intentar({ codigo: '410304', fechaDocumento: '2026-03-09', montoGasto: '1000' }, /tipo de documento de honorarios/i, 'sin tipo');
  await intentar({ codigo: '410304', tipoDocumento: 'BOLHE', montoGasto: '1000' }, /fecha de la boleta/i, 'sin fecha');
  await intentar({ codigo: '410304', tipoDocumento: 'BOLHE', fechaDocumento: '2026-03-09', montoGasto: '0' }, /monto del gasto/i, 'monto cero');
  await intentar({ codigo: '410304', tipoDocumento: 'BOLHE', fechaDocumento: '2026-03-09', montoGasto: '-500' }, /monto/i, 'monto negativo (las boletas son gasto positivo)');
  await intentar({ codigo: '410304', tipoDocumento: 'BOLHE', fechaDocumento: '2026-03-09', montoGasto: 'abc' }, /monto no válido/i, 'monto con texto');
  await cerrarModal(h);
  await abrirModal(h, 'faep', '1122');
  await intentar({ tipoDocumento: 'BOLHE', fechaDocumento: '2026-03-09', montoGasto: '1000' }, /concepto/i, 'concepto vacío');
  await intentar({ concepto: '__interno__', tipoDocumento: 'BOLHE', fechaDocumento: '2026-03-09', montoGasto: '1000' }, /no es válido/, 'concepto «__x__» (Firestore lo rechaza como clave)');
  await intentar({ concepto: 'C'.repeat(1500), tipoDocumento: 'BOLHE', fechaDocumento: '2026-03-09', montoGasto: '1000' }, /demasiado largo/, 'concepto de más de 1400 bytes');
  await intentar({ concepto: 'Apoyo', fechaDocumento: '2026-03-09', montoGasto: '1000' }, /tipo de documento de honorarios/i, 'sin tipo (por concepto)');
  await intentar({ concepto: 'Apoyo', tipoDocumento: 'BOLHE', fechaDocumento: '2026-03-09', montoGasto: '0' }, /monto del gasto/i, 'monto cero (por concepto)');
  // Un tipo que la cuenta NO acepta es imposible de elegir en el selector (se filtra): se comprueba contra la validación de la boleta
  await cerrarModal(h);
  await abrirModal(h, 'general', '1122');
  await h.page.selectOption(`${FORM} .hon-input[data-field="codigo"]`, '411601');
  await h.waitIdle();
  t.ok(!(await opcionesDe(h.page, 'tipoDocumento')).includes('BHE'), 'la cuenta 411601 no acepta BHE: el selector no lo ofrece');
  t.noErrores(h);
  await h.close();

  // ============================== 6. PROYECCIÓN: agregar, teclear un mes, quitar (cuenta y concepto) ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  await abrirModal(h, 'general', '1122');
  await h.clearWrites();
  await h.page.selectOption(`${MODAL} .honproy-add-select`, '410803');
  await h.page.click(`${MODAL} .add-honproy-btn`);
  await h.flushWrites(); await h.waitIdle();
  w = await escritosDe(h, '1122');
  t.eq(JSON.stringify(w[0].payload.otras_fuentes), JSON.stringify({ general: { hon_proyeccion_items: { '410803': { codigo: '410803', meses: Object.fromEntries(MESES.map(m => [m, 0])), total: 0 } } } }), 'agregar la cuenta a la proyección escribe SOLO `hon_proyeccion_items.410803` (en $0)');
  const celda = `${MODAL} input.celda-input[data-modo="of_hon_proy_item"][data-codigo="410803"][data-mes="SEPTIEMBRE"]`;
  await h.clearWrites();
  await h.page.fill(celda, '75000');
  await h.page.dispatchEvent(celda, 'blur');
  await h.flushWrites(); await h.waitIdle();
  w = await escritosDe(h, '1122');
  t.eq(JSON.stringify(w[0].payload.otras_fuentes.general.hon_proyeccion_items), JSON.stringify({ '410803': { codigo: '410803', meses: { SEPTIEMBRE: 75000 }, total: 75000 } }), 'teclear un mes escribe SOLO ese mes de esa cuenta (más su total)');
  t.eq(await h.page.evaluate(() => document.getElementById('honproytotal-1122-general').textContent.trim()), clp.name ? '$' + (75000 + 50000 * 10).toLocaleString('es-CL') : '', 'el total de la proyección se actualiza en vivo');
  const e1122 = (await leerFilas(h.page, 'general'));
  await cerrarModal(h);
  t.eq(clp((await leerFilas(h.page, 'general'))['1122'].hon), 50000 * 10 + 75000, 'la fila de la pestaña suma la proyección (50.000 × 10 meses + 75.000)');
  await abrirModal(h, 'general', '1122');
  await h.clearWrites();
  await h.page.click(`${MODAL} .honproy-del-btn[data-codigo="410803"]`);
  await h.flushWrites(); await h.waitIdle();
  w = await escritosDe(h, '1122');
  t.eq(JSON.stringify(w[0].payload.otras_fuentes), JSON.stringify({ general: { hon_proyeccion_items: { '410803': { __sentinel: 'deleteField' } } } }), 'quitar la cuenta = deleteField de SOLO `hon_proyeccion_items.410803`');
  t.ok(e1122['1122'], 'sanity');
  await cerrarModal(h);
  // Por concepto
  await abrirModal(h, 'faep', '1122');
  await h.clearWrites();
  await h.page.fill(`${MODAL} .honproy-add-input`, 'Monitor de taller');
  await h.page.click(`${MODAL} .add-honproy-btn`);
  await h.flushWrites(); await h.waitIdle();
  w = await escritosDe(h, '1122');
  t.eq(JSON.stringify(w[0].payload.otras_fuentes), JSON.stringify({ faep: { hon_proyeccion_items: { 'Monitor de taller': { concepto: 'Monitor de taller', meses: Object.fromEntries(MESES.map(m => [m, 0])), total: 0 } } } }), 'agregar el concepto a la proyección escribe SOLO `hon_proyeccion_items.<concepto>`');
  t.eq(await h.page.evaluate(() => document.querySelector('#otrasFuentesModalBody .honproy-add-input').value), '', 'el campo de concepto se limpia');
  const celdaC = `${MODAL} input.celda-input[data-modo="of_hon_proy_item"][data-concepto="Monitor de taller"][data-mes="AGOSTO"]`;
  await h.clearWrites();
  await h.page.fill(celdaC, '42000');
  await h.page.dispatchEvent(celdaC, 'blur');
  await h.flushWrites(); await h.waitIdle();
  w = await escritosDe(h, '1122');
  t.eq(JSON.stringify(w[0].payload.otras_fuentes.faep.hon_proyeccion_items), JSON.stringify({ 'Monitor de taller': { concepto: 'Monitor de taller', meses: { AGOSTO: 42000 }, total: 42000 } }), 'teclear un mes escribe SOLO ese mes del concepto');
  // duplicado y clave inválida
  const n0 = h.dialogs.length;
  await h.clearWrites();
  await h.page.fill(`${MODAL} .honproy-add-input`, 'Monitor de taller');
  await h.page.click(`${MODAL} .add-honproy-btn`);
  t.ok(/ya existe/i.test(h.dialogs.slice(n0).map(d => d.message).join(' ')), 'un concepto repetido en la proyección se rechaza');
  await h.page.fill(`${MODAL} .honproy-add-input`, '__x__');
  await h.page.click(`${MODAL} .add-honproy-btn`);
  t.ok(/no es válido/.test(h.dialogs.slice(n0).map(d => d.message).join(' ')), 'un concepto «__x__» se rechaza (Firestore lo rechazaría como clave)');
  await h.page.fill(`${MODAL} .honproy-add-input`, '');
  await h.page.click(`${MODAL} .add-honproy-btn`);
  t.ok(/escribe un concepto/i.test(h.dialogs.slice(n0).map(d => d.message).join(' ')), 'un concepto vacío se rechaza');
  t.eq((await h.writes()).length, 0, 'ninguna validación escribe');
  await h.page.click(`${MODAL} .honproy-del-btn[data-concepto="Monitor de taller"]`);
  await h.flushWrites(); await h.waitIdle();
  w = await escritosDe(h, '1122');
  t.eq(JSON.stringify(w[0].payload.otras_fuentes), JSON.stringify({ faep: { hon_proyeccion_items: { 'Monitor de taller': { __sentinel: 'deleteField' } } } }), 'quitar el concepto = deleteField de SOLO su clave');
  t.noErrores(h);
  await h.close();

  // ============================== 7. OTRA PERSONA edita otra boleta de la MISMA entidad con el formulario a medias ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  await abrirModal(h, 'junji', '5402002');
  await llenarFormHonOF(h.page, { concepto: 'Borrador a medias', tipoDocumento: 'BOLH', descripcion: 'sin terminar', montoGasto: '77777', fechaDocumento: '2026-02-02' });
  await h.page.focus(`${FORM} [data-field="descripcion"]`);
  await h.remoto('5402002', 'd.otras_fuentes.junji.honorarios.jh5402002_1.montoGasto = 999000; d.otras_fuentes.junji.honorarios.jh5402002_1.montoDocumento = 999000;');
  await h.waitIdle();
  t.eq(await h.page.evaluate(() => { const g = document.querySelector('#otrasFuentesModalBody .hon-form-grid'); return { concepto: g.querySelector('[data-field="concepto"]').value, desc: g.querySelector('[data-field="descripcion"]').value, monto: g.querySelector('[data-field="montoGasto"]').value, foco: document.activeElement && document.activeElement.dataset.field }; }),
    { concepto: 'Borrador a medias', desc: 'sin terminar', monto: '77777', foco: 'descripcion' }, 'un cambio ajeno NO borra lo escrito a medias en el formulario ni le quita el foco');
  t.eq((await filaBoletasMeses(h.page)).ENERO, 999000, 'la fila mensual refleja la boleta que cambió la otra persona');
  await h.page.click(BTN_ADD);
  await h.flushWrites(); await h.waitIdle();
  const serv = (await h.store())['sep_carga_rbd/5402002'].otras_fuentes.junji.honorarios;
  t.eq(serv.jh5402002_1.montoGasto, 999000, 'guardar la boleta propia NO pisa el cambio de la otra persona en otra boleta');
  t.eq(Object.keys(serv).length, 10, 'el servidor tiene las 9 boletas de antes + la nueva');
  const wPropio = (await h.writes()).filter(x => x.path === 'sep_carga_rbd/5402002' && x.payload.otras_fuentes);
  t.ok(wPropio.length === 1 && Object.keys(wPropio[0].payload.otras_fuentes.junji.honorarios).length === 1, 'el write propio lleva solo su boleta');
  // modo edición + borrado ajeno
  await h.page.click(`${MODAL} button.hon-edit-btn[data-hon-id="jh5402002_3"]`);
  t.eq(await h.page.evaluate(() => document.querySelector('#otrasFuentesModalBody .hon-form-grid').dataset.editingId), 'jh5402002_3', 'editando jh5402002_3');
  await h.remoto('5402002', 'delete d.otras_fuentes.junji.honorarios.jh5402002_3;');
  await h.waitIdle();
  t.eq(await h.page.evaluate(() => { const g = document.querySelector('#otrasFuentesModalBody .hon-form-grid'); return { editing: g.dataset.editingId || '', boton: g.querySelector('.add-hon-btn').textContent.trim(), concepto: g.querySelector('[data-field="concepto"]').value }; }),
    { editing: '', boton: '+ Agregar honorario', concepto: 'Taller de música' }, 'si borran la boleta en edición, el formulario conserva lo escrito pero pasa a «boleta nueva» (no la recrea)');
  // una boleta ajena nueva y un ítem de proyección borrado aparecen / desaparecen
  await h.remoto('5402002', "d.otras_fuentes.junji.honorarios.jh_remota = { concepto: 'Concepto remoto', tipoDocumento: 'BOLH', nroDocumento: '1', fechaDocumento: '2026-11-03', fechaPago: '2026-11-10', descripcion: 'ajena', rutProveedor: '', nombreProveedor: '', montoGasto: 11000, montoDocumento: 11000 }; delete d.otras_fuentes.junji.hon_proyeccion_items['Taller de música'];");
  await h.waitIdle();
  t.eq((await filaBoletasMeses(h.page)).NOVIEMBRE, 11000 + 200000 * 0, 'una boleta que otra persona agrega aparece sin reabrir el modal');
  t.eq(await filaProyeccionOF(h.page, 'Taller de música', true), null, 'un ítem de proyección que otra persona borra desaparece (no resucita)');
  t.noErrores(h);
  await h.close();

  // ============================== 8. DOCUMENTOS DAÑADOS ==============================
  const dañados = clon(docs);
  const of = (id, key) => dañados[id].otras_fuentes[key];
  of('1121', 'general').honorarios = {
    ok: boletaCuenta({ montoGasto: 1000, fechaDocumento: '2026-02-03' }),
    texto: 'esto no es una boleta', nulo: null, arreglo: [1, 2, 3], numero: 42,
    montoTexto: boletaCuenta({ montoGasto: '2500', montoDocumento: 'abc', fechaDocumento: '2026-04-04' }),
    montoRaro: boletaCuenta({ montoGasto: { x: 1 }, fechaDocumento: '2026-04-05' }),
    cuentaNula: boletaCuenta({ codigo: null, montoGasto: 700 }),
    cuentaNumerica: boletaCuenta({ codigo: 410803, montoGasto: 800, fechaDocumento: '2026-05-05' }),
    tipoNombre: boletaCuenta({ tipoDocumento: 'Boleta de honorarios exenta', montoGasto: 900, fechaDocumento: '2026-06-06' }),
    fechaObjeto: boletaCuenta({ montoGasto: 600, fechaDocumento: { a: 1 } }),
  };
  of('1121', 'general').hon_proyeccion_items = { '410803': { codigo: '410803', meses: { ENERO: '3000', FEBRERO: 'x', MARZO: null, ABRIL: { a: 1 }, MAYO: 4000 } }, '410304': 'texto', '410904': null };
  of('AC', 'general').honorarios = 'texto en vez de mapa';
  of('AC', 'general').hon_proyeccion_items = [1, 2];
  of('1122', 'general').honorarios = [1, 2];
  of('1121', 'pie').honorarios = null;
  of('1121', 'pie').hon_proyeccion_items = 12345;
  of('5402002', 'junji').honorarios = {
    ok: boletaConcepto({ montoGasto: 1000, fechaDocumento: '2026-02-03' }), texto: 'x', nulo: null,
    conceptoNulo: boletaConcepto({ concepto: null, montoGasto: 700 }), conceptoNumerico: boletaConcepto({ concepto: 123, montoGasto: 800, fechaDocumento: '2026-05-05' }),
    conceptoObjeto: boletaConcepto({ concepto: { a: 1 }, montoGasto: 900 }), montoTexto: boletaConcepto({ montoGasto: '2500', fechaDocumento: '2026-04-04' }),
  };
  of('5402002', 'junji').hon_proyeccion_items = { 'Bueno': { concepto: 'Bueno', meses: { JUNIO: 5000 } }, 'Malo': 'texto', 'Nulo': null, 'Arreglo': [1] };
  of('1121', 'faep').honorarios = 'texto'; of('1121', 'faep').hon_proyeccion_items = 'texto';
  of('AC', 'faep').honorarios = [1]; of('5402002', 'faep').honorarios = null; of('1121', 'figa').honorarios = 12345; of('1121', 'aporte_educ').hon_proyeccion_items = [1, 2];
  h = await boot({ fixture: dañados });
  await h.clickTab('of-general');
  const esp1 = entidadDe(dañados, '1121', 'general');
  t.eq(esp1.hon.boletas, 1000 + 2500 + 800 + 900, 'cálculo independiente: solo cuentan las boletas válidas (monto de texto numérico, cuenta numérica y tipo con nombre sí; nulos, objetos y sin fecha valen 0 o fuera)');
  const dF = await leerFilas(h.page, 'general');
  t.eq(clp(dF['1121'].hon), esp1.total.hon, 'boletas dañadas: «Gasto Honorarios» de la fila sigue el cálculo (la proyección dañada cuenta solo lo numérico: 3.000 + 4.000)');
  t.eq(esp1.hon.proy, 7000, 'cálculo independiente: proyección = 3.000 (texto numérico) + 4.000');
  t.eq([clp(dF.AC.hon), clp(dF['1122'].hon)].join(), [entidadDe(dañados, 'AC', 'general').total.hon, entidadDe(dañados, '1122', 'general').total.hon].join(), '`honorarios` que no es un mapa (texto, arreglo) se ignora; AC conserva solo lo bueno');
  await h.clickTab('of-pie');
  t.eq(clp((await leerFilas(h.page, 'pie'))['1121'].hon), 0, '`honorarios` nulo y `hon_proyeccion_items` numérico: $0 sin romper');
  await abrirModal(h, 'general', '1121');
  t.eq((await filasRegistroHon(h.page)).length, 7, 'el registro lista solo las entradas que son objetos');
  await cerrarModal(h);
  await h.clickTab('of-junji');
  const dJ = await leerFilas(h.page, 'junji');
  t.eq(clp(dJ['5402002'].hon), entidadDe(dañados, '5402002', 'junji').total.hon, 'JUNJI: concepto nulo/objeto fuera, concepto numérico («123») cuenta, ítems de proyección dañados ignorados');
  for (const [fuente, id] of [['faep', '1121'], ['faep', 'AC'], ['faep', '5402002'], ['figa', '1121'], ['aporte_educ', '1121']]) {
    await h.clickTab('of-' + fuente);
    t.eq(clp((await leerFilas(h.page, fuente))[id].hon), entidadDe(dañados, id, fuente).total.hon, `${fuente} / ${id}: honorarios dañados (texto, arreglo, nulo, número) = $0 o solo lo bueno, sin romper`);
  }
  t.eq((await h.writes()).length, 0, 'leer documentos dañados no escribe');
  t.noErrores(h);
  await h.close();

  // ============================== 9. COMPRAS ANTIGUAS con tipo de honorarios: marca «⚠ muévelo a Honorarios» (también por concepto), sin botón de migración ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  for (const [fuente, id, idCompra] of [['general', '1121', 'g1121_hon_antigua'], ['faep', '1121', 'fa1121_hon_antigua'], ['junji', '5402002', 'jn5402002_hon_antigua']]) {
    await abrirModal(h, fuente, id);
    const r = await h.page.evaluate((cid) => {
      const tr = document.querySelector(`#otrasFuentesModalBody table.compras-table tr[data-compra-id="${cid}"]`);
      return { marca: tr ? (tr.querySelector('.compra-aviso-tipo-hon') || {}).textContent || '' : null, resumen: (document.querySelector('#otrasFuentesModalBody .compras-hon-resumen') || {}).textContent || '',
        tiposForm: Array.from(document.querySelectorAll('#otrasFuentesModalBody .compra-form-grid select[data-field="tipoDocumento"] option')).map(o => o.value),
        botonMigrar: !!document.querySelector('#otrasFuentesModalBody [class*="migrar"], #otrasFuentesModalBody [id*="igrar"]') };
    }, idCompra);
    t.eq(r.marca, '⚠ muévelo a Honorarios', `${fuente}: la compra antigua con tipo de honorarios lleva la marca «⚠ muévelo a Honorarios»`);
    t.ok(/1 compra con un tipo de documento de honorarios/.test(r.resumen), `${fuente}: resumen «1 compra con un tipo de documento de honorarios»`, r.resumen);
    t.ok(!r.tiposForm.some(x => /honorarios|BOLH|BHE|BPST/i.test(x)), `${fuente}: el selector de tipo de las COMPRAS ya no ofrece los tipos de honorarios`, r.tiposForm.join());
    t.ok(!r.botonMigrar, `${fuente}: no hay botón de migración`);
    await cerrarModal(h);
  }
  // sigue sumando en B&S (cero cambio de cifras): la compra antigua cuenta como compra
  const eG = entidadDe(docs, '1121', 'general');
  t.eq(clp((await leerFilas(h.page, 'faep'))['1121'].bys), entidadDe(docs, '1121', 'faep').total.bys, 'la compra antigua con tipo de honorarios sigue sumando en Bienes y Servicios');
  t.ok(eG.total.bys > 0, 'sanity');
  t.noErrores(h);
  await h.close();

  // ============================== 9. FUENTES NUEVAS de `main`: Subt. 31 y Asignación Familiar (concepto) llevan honorarios; Recuperación LLMM (solo ingresos) NO ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  for (const [fuente, id] of [['subt31_proyectos', '1121'], ['subt31_proyectos', 'AC'], ['subt31_proyectos', '5402002'], ['asignacion_familiar', '1121'], ['asignacion_familiar', '5402002']]) {
    await abrirModal(h, fuente, id);
    const hon = honFuenteDe(docs, id, fuente);
    t.eq(enMeses(await filaBoletasMeses(h.page)), hon.porMes, `${fuente} / ${id}: la fila «Honorarios (Subt. 21)» = boletas por mes (siempre Real) del cálculo independiente`);
    t.eq((await filasRegistroHon(h.page)).map(x => x.id).sort(), Object.keys(docs[id].otras_fuentes[fuente].honorarios).sort(), `${fuente} / ${id}: el registro lista todas las boletas`);
    for (const [clave, meses] of Object.entries(hon.proyPorClave)) t.eq(enMeses(await filaProyeccionOF(h.page, clave, true) || {}), meses, `${fuente} / ${id}: proyección «${clave}» (por concepto)`);
    t.eq(await h.page.evaluate(() => !!document.querySelector('#otrasFuentesModalBody .hon-form-grid [data-field="concepto"]') && !document.querySelector('#otrasFuentesModalBody .hon-form-grid [data-field="codigo"]')), true, `${fuente} / ${id}: el formulario pide Concepto (no cuenta)`);
    await cerrarModal(h);
  }
  // Encabezados: las boletas son SIEMPRE Real (los 12 meses, sin importar el «Real hasta» de la entidad) y la proyección SIEMPRE Proy.
  for (const [fuente, id] of [['general', '1121'], ['junji', '5402002'], ['subt31_proyectos', '1121'], ['asignacion_familiar', '1121']]) {
    await abrirModal(h, fuente, id);
    const tags = await h.page.evaluate(() => { const t = (re) => Array.from(document.querySelectorAll('#otrasFuentesModalBody .hon-block table.detalle-table thead')).filter(x => re.test(x.textContent)).map(x => Array.from(x.querySelectorAll('.mes-tag')).map(m => m.textContent)); return { bol: t(/— boletas/), proy: t(/\(Proyección\)/) }; });
    t.eq([tags.bol.length, tags.bol[0].every(x => x === 'Real'), tags.bol[0].length], [1, true, 12], `${fuente} / ${id}: el encabezado de las boletas marca los 12 meses «Real» aunque la entidad tenga corte anterior`);
    t.eq([tags.proy.length, tags.proy[0].every(x => x === 'Proy.')], [1, true], `${fuente} / ${id}: el encabezado de la proyección de honorarios marca los 12 meses «Proy.»`);
    await cerrarModal(h);
  }
  // alta en vivo en Asignación Familiar: un write merge SOLO de `otras_fuentes.asignacion_familiar.honorarios.<id>`; el gasto, el saldo y el Estado de la fila se mueven
  await abrirModal(h, 'asignacion_familiar', '5402002');
  const antesAF = (await leerFilas(h.page, 'asignacion_familiar'))['5402002'];
  await h.clearWrites();
  await llenarFormHonOF(h.page, { concepto: 'Refuerzo', tipoDocumento: 'BOLHE', nroDocumento: '12', fechaDocumento: '2026-06-02', fechaPago: '2026-06-09', montoGasto: '40000' });
  await h.page.click(BTN_ADD);
  await h.flushWrites(); await h.waitIdle();
  const wAF = await escritosDe(h, '5402002');
  t.eq([wAF.length, Object.keys(wAF[0].payload), Object.keys(wAF[0].payload.otras_fuentes), Object.keys(wAF[0].payload.otras_fuentes.asignacion_familiar)], [1, ['nombre', 'otras_fuentes', 'lastModifiedBy', 'lastModifiedAt'], ['asignacion_familiar'], ['honorarios']], 'Asignación Familiar: agregar una boleta = un write de SOLO `otras_fuentes.asignacion_familiar.honorarios.<id>`');
  const docsAF = clon(docs); docsAF['5402002'].otras_fuentes.asignacion_familiar.honorarios.nueva = { concepto: 'Refuerzo', tipoDocumento: 'BOLHE', nroDocumento: '12', fechaDocumento: '2026-06-02', fechaPago: '2026-06-09', montoGasto: 40000, montoDocumento: 40000 };
  await cerrarModal(h);
  const despuesAF = (await leerFilas(h.page, 'asignacion_familiar'))['5402002'];
  const eAF = entidadDe(docsAF, '5402002', 'asignacion_familiar');
  t.eq([clp(despuesAF.hon), clp(despuesAF.gasto), clp(despuesAF.saldo)], [eAF.total.hon, eAF.total.gasto, eAF.total.saldo], 'Asignación Familiar: la fila refleja la boleta nueva en honorarios, gasto total y saldo');
  t.eq(clp(despuesAF.gasto) - clp(antesAF.gasto), 40000, 'Asignación Familiar: el gasto sube exactamente el monto de la boleta');
  t.eq(clp(despuesAF.gasto), clp(despuesAF.rem) + clp(despuesAF.hon), 'Asignación Familiar: gasto total = remuneraciones + honorarios (sin B&S ni 70/30)');
  // Recuperación LLMM: ni formulario, ni fila, ni tarjeta, ni columna, ni catálogo; la boleta que el fixture dejó guardada no cuenta
  await abrirModal(h, 'recuperacion_llmm', '1121');
  t.eq(await h.page.evaluate(() => ({ bloque: !!document.querySelector('#otrasFuentesModalBody .hon-block, #otrasFuentesModalBody .hon-form-grid'), texto: /Honorarios/.test(document.getElementById('otrasFuentesModalBody').innerText) })), { bloque: false, texto: false }, 'Recuperación LLMM: el modal no trae bloque de honorarios (fuente solo de ingresos)');
  await cerrarModal(h);
  const filaLLMM = (await leerFilas(h.page, 'recuperacion_llmm'))['1121'];
  t.eq([clp(filaLLMM.ingreso), clp(filaLLMM.hon), clp(filaLLMM.gasto)], [90000, 0, 0], 'Recuperación LLMM / 1121: ingreso 90.000 (Isapres + FONASA + SIL), sin gasto: la boleta guardada en el documento se ignora');
  t.eq(await h.page.evaluate(() => /Honorarios/.test(document.getElementById('tab-of-recuperacion_llmm').innerText)), false, 'Recuperación LLMM: la pestaña no menciona honorarios');
  t.noErrores(h);
  await h.close();
}, { modoBug: 'enforced' });
