// Registro de compras por CONCEPTO · interfaz del modal de la entidad (JUNJI, FAEP, FIGA y Aportes Fiscales):
//   · formulario con los mismos campos de las compras de las demás fuentes pero con «Concepto» (texto libre con lista de sugerencias) en lugar de «Código de cuenta»;
//   · avisos en vivo del formulario (ayuda de signo de NC/ND, fecha de 2025, pago anterior al documento, fecha a medio teclear) que NO impiden guardar;
//   · nombres accesibles ÚNICOS en el formulario y la tabla nuevos (el «Concepto» del registro frente al «Concepto» de «sin documento»), botones ✏️ ⧉ 🗑 con nombre por compra;
//   · «Documentado $X · Sin documento $Y» en el resumen del modal, que se refresca mientras se teclea una celda «sin documento» sin perder foco ni cursor;
//   · el reconciliador no pisa lo escrito en el formulario (ni el cursor del campo Concepto) cuando llegan cambios ajenos, y la lista de sugerencias SÍ se actualiza;
//   · «Documentado por concepto»: solo lectura, todo Real; la tabla de la pestaña no desborda con el desglose «Doc. · S/doc.».
import { boot } from '../lib/boot.mjs';
import { nombresAccesibles, controlesSinNombre } from '../lib/a11y.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { abrirModalConcepto, cerrarModalConcepto, llenarFormConcepto, compraCBase, clp } from '../lib/compras_conceptos.mjs';

const MODAL = '#otrasFuentesModal .modal-panel';
const avisosForm = (page) => page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody .compra-form-avisos .plan-nota')).map(d => d.textContent.trim()));

await correrSpec('compras_conceptos_ui', async (t) => {
  const h = await boot({ fixture: 'compras_conceptos' });
  const { page } = h;
  await abrirModalConcepto(h, 'faep', '1121');

  // ============================== 1. FORMULARIO ==============================
  const campos = await page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody .compra-form-grid label.compra-field')).map(l => ({
    rotulo: l.querySelector('.compra-field-label').textContent.trim(), campo: l.querySelector('.compra-input').dataset.field, tag: l.querySelector('.compra-input').tagName.toLowerCase(), tipo: l.querySelector('.compra-input').type })));
  t.eq(campos.map(c => c.rotulo), ['Concepto', 'Tipo de documento', 'N° documento', 'Fecha documento', 'Fecha pago', 'Descripción', 'RUT proveedor', 'Nombre proveedor', 'Monto gasto', 'Monto documento', 'N° DC', 'Doc. original (NC/ND)'],
    'el formulario lleva los mismos campos de las compras de las demás fuentes con «Concepto» en lugar de «Código de cuenta»');
  t.eq(campos.map(c => c.campo), ['concepto', 'tipoDocumento', 'nroDocumento', 'fechaDocumento', 'fechaPago', 'descripcion', 'rutProveedor', 'nombreProveedor', 'montoGasto', 'montoDocumento', 'documentoContable', 'documentoOriginal'], 'cada campo se guarda en la clave del modelo (concepto, …, documentoContable, documentoOriginal)');
  t.eq([campos[0].tag, campos[0].tipo, campos[1].tag], ['input', 'text', 'select'], 'Concepto es texto libre (input de texto) y el tipo de documento un selector');
  t.eq(await page.evaluate(() => document.querySelector('#otrasFuentesModalBody .compra-input[data-field="concepto"]').list.options.length), 4, 'el campo Concepto tiene su lista desplegable con los 4 conceptos de la entidad');
  const tipos = await page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody .compra-input[data-field="tipoDocumento"] option')).map(o => o.textContent.trim()));
  t.ok(tipos.includes('Factura electrónica') && tipos.includes('Nota de crédito') && !tipos.includes('Boleta de honorarios manual'), 'el selector de tipo de documento es el de las compras (sin los 5 tipos de honorarios)');
  t.eq(await page.evaluate(() => document.querySelector('#otrasFuentesModalBody .of-cancelar-edicion-btn').classList.contains('hidden')), true, '«Cancelar edición» está oculto mientras no se edita');
  // «Doc. original»: se atenúa salvo con NC/ND, pero no se deshabilita.
  const estiloDoc = () => page.evaluate(() => { const el = document.querySelector('#otrasFuentesModalBody .compra-input[data-field="documentoOriginal"]'); return { borde: getComputedStyle(el).borderStyle, deshabilitado: el.disabled }; });
  t.eq(await estiloDoc(), { borde: 'dashed', deshabilitado: false }, 'Doc. original se atenúa (borde punteado) con un tipo que no es NC/ND, pero no se deshabilita');
  await llenarFormConcepto(page, { tipoDocumento: 'Nota de crédito' });
  t.eq(await estiloDoc(), { borde: 'solid', deshabilitado: false }, 'con una nota de crédito vuelve al estilo normal');

  // ============================== 2. AVISOS EN VIVO ==============================
  t.eq(await avisosForm(page), ['ℹ Las notas de crédito se registran con monto negativo; se ajusta automáticamente.'], 'nota de crédito: ayuda del signo');
  await llenarFormConcepto(page, { tipoDocumento: 'Nota de débito' });
  t.eq(await avisosForm(page), ['ℹ Las notas de débito se registran con monto positivo; se ajusta automáticamente.'], 'nota de débito: ayuda del signo');
  await llenarFormConcepto(page, { tipoDocumento: 'Factura', fechaDocumento: '2025-12-30', fechaPago: '2025-12-01' });
  const av = await avisosForm(page);
  t.ok(av.some(a => /fuera de 2026/.test(a)) && av.some(a => /anterior a la fecha del documento/.test(a)), 'fecha de 2025 y pago anterior al documento se avisan en vivo', av);
  t.ok(av.every(a => a.startsWith('⚠')), 'son avisos (⚠), no ayudas');
  await page.evaluate(() => { const el = document.querySelector('#otrasFuentesModalBody .compra-input[data-field="fechaDocumento"]'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); });
  // Los avisos NO impiden guardar: se guarda una compra con fecha de 2025.
  await llenarFormConcepto(page, { ...compraCBase({ concepto: 'Aviso no bloquea', fechaDocumento: '2025-11-05', fechaPago: '2025-11-06', nroDocumento: '5555', montoGasto: 1234 }) });
  t.ok((await avisosForm(page)).some(a => /fuera de 2026/.test(a)), 'con fecha de 2025 el aviso sigue visible');
  await h.clearWrites();
  await page.click('#otrasFuentesModalBody .of-add-compra-btn');
  await h.flushWrites(); await h.waitIdle();
  const w = (await h.writes()).filter(x => x.path === 'sep_carga_rbd/1121');
  t.eq(w.length, 1, 'los avisos no impiden guardar: la compra con fecha de 2025 se guardó');
  t.eq(await avisosForm(page), [], 'al guardar el formulario queda limpio y sin avisos');
  const resumen = await page.evaluate(() => (document.querySelector('#otrasFuentesModalBody .compras-avisos-resumen') || {}).textContent || '');
  t.ok(/4 compras con avisos/.test(resumen) && /2 con fecha de documento fuera de 2026/.test(resumen), 'el resumen de la tabla cuenta la nueva compra con aviso (4 compras, 2 fuera de 2026)', resumen);

  // ============================== 3. NOMBRES ACCESIBLES ÚNICOS ==============================
  const lista = await nombresAccesibles(page, { scope: MODAL });
  t.eq(controlesSinNombre(lista).map(c => c.sel), [], 'ningún control del modal (formulario, tabla del registro, «sin documento») queda sin nombre accesible');
  const delRegistro = lista.filter(c => /compra-input|of-add-compra-btn|of-cancelar-edicion-btn|of-compra-(edit|dup|del)-btn/.test(c.sel));
  const cuenta = new Map(); delRegistro.forEach(c => cuenta.set(c.nombre, (cuenta.get(c.nombre) || 0) + 1));
  t.eq(Array.from(cuenta).filter(([, n]) => n > 1), [], 'nombres únicos en el formulario y las acciones del registro (ninguno se repite)');
  const nombreConcepto = lista.find(c => /compra-input\[field=concepto|data-field=concepto|\[field=concepto\]/.test(c.sel) || (/compra-input/.test(c.sel) && /concepto/i.test(c.nombre) && c.tag === 'input'));
  t.ok(nombreConcepto && /^Concepto/.test(nombreConcepto.nombre), 'el campo Concepto del registro tiene nombre que EMPIEZA con su rótulo visible («Concepto…»)', nombreConcepto);
  const conceptoSinDoc = lista.find(c => /juncon-1121-faep/.test(c.sel));
  t.ok(conceptoSinDoc && conceptoSinDoc.nombre !== (nombreConcepto && nombreConcepto.nombre), 'el «Concepto» de «sin documento» tiene otro nombre que el del registro de compras', { a: conceptoSinDoc && conceptoSinDoc.nombre, b: nombreConcepto && nombreConcepto.nombre });
  const accion = (re) => lista.find(c => re.test(c.nombre));
  t.ok(accion(/^Editar compra Factura electrónica N° 1001$/) && accion(/^Duplicar compra Factura electrónica N° 1001$/) && accion(/^Eliminar compra Factura electrónica N° 1001$/), 'cada compra tiene «Editar / Duplicar / Eliminar compra <tipo> N° <n>»');
  t.ok(accion(/^Eliminar compra concepto fa1121_sinconcepto$/) || accion(/^Eliminar compra Boleta N° 78$/), 'una compra sin concepto igual tiene un nombre de acción propio');
  const iconos = await page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody table.compras-table button')).filter(b => !b.getAttribute('aria-label')).length);
  t.eq(iconos, 0, 'los botones solo-icono del registro tienen aria-label');

  // ============================== 4. RESUMEN «Documentado · Sin documento» EN VIVO al teclear una celda «sin documento» ==============================
  await cerrarModalConcepto(h);
  await abrirModalConcepto(h, 'faep', '1121');
  const antes = await page.evaluate(() => ({ sin: document.getElementById('ofbyssin-1121-faep').textContent, tot: document.getElementById('ofbystot-1121-faep').textContent, doc: document.getElementById('ofbysdoc-1121-faep').textContent }));
  const celda = '#otrasFuentesModalBody input.celda-input[data-modo="of_bys_item"][data-concepto="Alimentación"][data-mes="DICIEMBRE"]';
  await h.clearWrites();
  await page.click(celda);
  await page.keyboard.press('Control+A');
  await page.keyboard.type('1500000', { delay: 20 });
  const vivo = await page.evaluate((sel) => ({ sin: document.getElementById('ofbyssin-1121-faep').textContent, tot: document.getElementById('ofbystot-1121-faep').textContent, doc: document.getElementById('ofbysdoc-1121-faep').textContent,
    foco: document.activeElement === document.querySelector(sel), valor: document.querySelector(sel).value,
    sub: document.getElementById('otrasFuentesModalSubtitle').textContent.replace(/\s+/g, ' ') }), celda);
  t.eq([vivo.foco, vivo.valor], [true, '1500000'], 'teclear en una celda «sin documento» conserva foco y valor');
  t.eq(clp(vivo.sin) - clp(antes.sin), 1500000 - 1176000, 'el «Sin documento» del modal se actualiza EN VIVO con lo tecleado (1.500.000 en lugar de 1.176.000)');
  t.eq([vivo.doc, clp(vivo.tot) - clp(antes.tot)], [antes.doc, 1500000 - 1176000], 'el «Documentado» no cambia y el Total sube lo mismo');
  t.ok(vivo.sub.includes(`Sin documento ${vivo.sin}`), 'el subtítulo del modal también se actualiza en vivo', vivo.sub);
  await page.keyboard.press('Tab');
  await h.waitIdle();
  const w2 = (await h.writes()).filter(x => x.path === 'sep_carga_rbd/1121');
  t.ok(w2.length >= 1 && w2.every(x => !x.payload.otras_fuentes.faep.compras), 'editar una celda «sin documento» no toca el mapa de compras');
  await page.keyboard.press('Escape'); await h.waitIdle();

  // ============================== 5. EL FORMULARIO Y SU CAMPO CONCEPTO SOBREVIVEN A CAMBIOS AJENOS; LAS SUGERENCIAS SE ACTUALIZAN ==============================
  await abrirModalConcepto(h, 'faep', '1121');
  await page.click('#otrasFuentesModalBody .compra-input[data-field="concepto"]');
  await page.keyboard.type('Capac', { delay: 15 });
  await h.remoto('1121', `d.otras_fuentes.faep.compras.ajena_1 = { concepto: 'Capacitación remota', tipoDocumento: 'Factura', nroDocumento: '1', fechaDocumento: '2026-06-01', fechaPago: '', descripcion: 'de otra persona', rutProveedor: '', nombreProveedor: '', montoGasto: 42000, montoDocumento: 42000, documentoOriginal: '' };`);
  await h.waitIdle();
  const trasAjeno = await page.evaluate(() => {
    const el = document.querySelector('#otrasFuentesModalBody .compra-input[data-field="concepto"]');
    return { valor: el.value, foco: document.activeElement === el, caret: el.selectionStart, sugerencias: Array.from(el.list.options).map(o => o.value),
      filas: document.querySelectorAll('#otrasFuentesModalBody table.compras-table tbody tr[data-compra-id]').length };
  });
  t.eq([trasAjeno.valor, trasAjeno.foco, trasAjeno.caret], ['Capac', true, 5], 'un cambio ajeno NO pisa lo tecleado en Concepto (texto, foco y cursor)');
  t.ok(trasAjeno.sugerencias.includes('Capacitación remota'), 'la lista de sugerencias SÍ incluye el concepto nuevo de la otra persona', trasAjeno.sugerencias);
  t.eq(trasAjeno.filas, 10, 'la tabla del registro recibe la compra ajena (9 + 1; las 8 del fixture + la guardada antes + la remota)');
  // Un cambio ajeno en lo «sin documento» también se refleja en el resumen.
  const sinAntes = await page.evaluate(() => document.getElementById('ofbyssin-1121-faep').textContent);
  await h.remoto('1121', `d.otras_fuentes.faep.bys_items['Servicios básicos'].meses.DICIEMBRE = 9000000;`);
  await h.waitIdle();
  const sinDespues = await page.evaluate(() => document.getElementById('ofbyssin-1121-faep').textContent);
  t.ok(clp(sinDespues) !== clp(sinAntes), 'un cambio ajeno en lo «sin documento» actualiza el resumen del modal', { sinAntes, sinDespues });
  t.eq(await page.evaluate(() => document.querySelector('#otrasFuentesModalBody .compra-input[data-field="concepto"]').value), 'Capac', 'y el campo Concepto sigue intacto');
  await page.evaluate(() => { document.querySelector('#otrasFuentesModalBody .compra-input[data-field="concepto"]').value = ''; });
  t.ok(await page.evaluate(() => document.querySelector('#otrasFuentesModalBody input[list]#juncon-1121-faep').getAttribute('list') === 'ofconceptos-1121-faep'), 'el «Agregar concepto» de «sin documento» usa la misma lista de sugerencias');

  // ============================== 6. DOCUMENTADO POR CONCEPTO: solo lectura y todo Real ==============================
  const tabla = await page.evaluate(() => {
    const filas = Array.from(document.querySelectorAll('#otrasFuentesModalBody tr[id^="ofdoc-1121-faep-"]'));
    const t0 = filas[0].closest('table');
    return { inputs: t0.querySelectorAll('input').length, celdasReal: Array.from(filas[0].querySelectorAll('td.num')).slice(0, 12).every(td => td.classList.contains('mes-real')),
      encabezados: Array.from(t0.querySelectorAll('thead th.num')).slice(0, 12).map(th => th.querySelector('.mes-tag').textContent.trim()), total: !!document.getElementById('ofdoctotal-1121-faep') };
  });
  t.eq([tabla.inputs, tabla.celdasReal, [...new Set(tabla.encabezados)], tabla.total], [0, true, ['Real'], true], '«Documentado por concepto»: sin celdas editables, los 12 meses marcados Real y con fila «Total documentado»');
  t.noErrores(h);
  await h.close();

  // ============================== 7. LA TABLA DE LA PESTAÑA NO DESBORDA con el desglose «Doc. · S/doc.» ==============================
  const hs = await boot({ fixture: 'compras_conceptos', viewport: { width: 1024, height: 800 } });
  for (const k of ['faep', 'figa', 'junji', 'aporte_educ', 'aporte_junji']) {
    await hs.clickTab('of-' + k);
    const m = await hs.page.evaluate(() => ({ pagina: document.documentElement.scrollWidth - document.documentElement.clientWidth, split: document.querySelectorAll('.of-bys-split').length }));
    t.eq(m.pagina <= 0, true, `${k}: con el desglose «Doc. · S/doc.» (${m.split} filas) la página no tiene scroll horizontal a 1024 px`);
  }
  t.noErrores(hs);
  await hs.close();
}, { modoBug: 'enforced' });
