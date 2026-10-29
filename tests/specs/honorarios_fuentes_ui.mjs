// Honorarios (PR-3) · interfaz del bloque «Honorarios (Subt. 21)» en el modal de cada fuente (fixture `honorarios_fuentes`):
//   · accesibilidad: todo control con nombre accesible propio (no coincide con el del registro de compras del mismo modal), celdas de la proyección «<concepto>, <mes>, <entidad>» únicas,
//     botones solo-icono con aria-label, nombres concretos con cuenta (General) y con concepto (JUNJI);
//   · escritura sin pisar lo tecleado: «1500000» con pausas de 100 / 450 ms en una celda de la proyección con otra persona guardando otra celda (el valor final y lo guardado es lo tecleado,
//     la celda conserva el foco y los nodos del modal no se reemplazan); montos pegados con formato es-CL; el formulario a medias y el modo edición sobreviven a snapshots ajenos;
//   · el bloque aparece justo debajo de «Remuneraciones» y arriba de Bienes y Servicios, sin desborde horizontal a 1024 y 390 px;
//   · el modal reconciliado es idéntico al reconstruido tras cambios remotos de boletas y proyección (cuentas y conceptos).
import { boot } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { nombresAccesibles, controlesSinNombre } from '../lib/a11y.mjs';
import { MESES, abrirModal, cerrarModal, llenarFormHonOF } from '../lib/honorarios_fuentes.mjs';

const MODAL = '#otrasFuentesModalBody';
const celdaProy = (campo, clave, mes) => `${MODAL} input.celda-input[data-modo="of_hon_proy_item"][data-${campo}="${clave}"][data-mes="${mes}"]`;
const RE_CELDA = /^.+, (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre), (RBD \d+|Administración Central|GESPARVU \d+)$/;
const resumen = (c) => `${c.sel} «${c.nombre}»`;
const prng = (seed) => { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// Firma estructural del contenido del modal (sin los formularios, que no se reconcilian y parten vacíos en ambos casos).
const FIRMA = (sel) => {
  const out = [];
  const walk = (n) => {
    if (n.nodeType === 3) { const t = n.nodeValue.replace(/\s+/g, ' ').trim(); if (t) out.push('T:' + t); return; }
    if (n.nodeType !== 1) return;
    const attrs = Array.from(n.attributes).filter(a => !(n.tagName === 'INPUT' && a.name === 'value') && !['title', 'aria-invalid', 'style'].includes(a.name)).map(a => a.name + '=' + a.value).sort().join(';');
    out.push('<' + n.tagName + (attrs ? ' ' + attrs : '') + ((n.tagName === 'INPUT' || n.tagName === 'SELECT') && !n.closest('.compra-form-grid, .hon-form-grid') ? ' val=' + n.value : '') + '>');
    n.childNodes.forEach(walk);
    out.push('</' + n.tagName + '>');
  };
  walk(document.querySelector(sel));
  return out;
};
const primeraDiferencia = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return `línea ${i}: «${a[i]}» ≠ «${b[i]}»`; return null; };

await correrSpec('honorarios_fuentes_ui', async (t) => {
  // ============================== 1. ACCESIBILIDAD ==============================
  let h = await boot({ fixture: 'honorarios_fuentes', viewport: { width: 1500, height: 1000 } });
  const sinNom = [], mal = [], dup = [], iconosSin = [];
  let nHon = 0, nCeldas = 0;
  for (const [fuente, id] of [['general', '1121'], ['general', 'AC'], ['pie', '1121'], ['mantenimiento', '1121'], ['prorretencion', '1121'], ['junji', '5402002'], ['faep', '1121'], ['faep', '5402002'], ['figa', '1121'], ['aporte_educ', 'AC'], ['aporte_junji', '5402002']]) {
    await abrirModal(h, fuente, id);
    const lista = await nombresAccesibles(h.page, { scope: '#otrasFuentesModal .modal-panel' });
    controlesSinNombre(lista).forEach(c => sinNom.push(`${fuente}/${id}: ${resumen(c)}`));
    const celdas = lista.filter(c => /^input\.celda-input/.test(c.sel));
    nCeldas += celdas.length;
    const vistos = new Map();
    celdas.forEach(c => { if (!RE_CELDA.test(c.nombre)) mal.push(`${fuente}/${id}: ${c.nombre}`); vistos.set(c.nombre, (vistos.get(c.nombre) || 0) + 1); });
    vistos.forEach((n, nom) => { if (n > 1) dup.push(`${fuente}/${id}: «${nom}» ×${n}`); });
    const hon = lista.filter(c => !/^input\.celda-input/.test(c.sel) && /hon-|honorario|Honorario|prestador|boleta|Cuenta de honorarios|Concepto de honorarios|N° boleta|Fecha boleta/i.test(c.sel + ' ' + c.nombre));
    nHon += hon.length;
    const cuenta = new Map(); hon.forEach(c => cuenta.set(c.nombre, (cuenta.get(c.nombre) || 0) + 1));
    cuenta.forEach((n, nom) => { if (n > 1) dup.push(`${fuente}/${id}: control «${nom}» ×${n}`); });
    const compras = lista.filter(c => /compra-input|add-compra-btn|cancelar-edicion-btn/.test(c.sel)).map(c => c.nombre);
    hon.filter(c => /hon-input|add-hon-btn|cancelar-edicion-hon-btn/.test(c.sel)).forEach(c => { if (compras.includes(c.nombre)) dup.push(`${fuente}/${id}: «${c.nombre}» coincide con un control de compras`); });
    (await h.page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody .hon-block button')).filter(b => b.getClientRects().length > 0 && !b.getAttribute('aria-label') && !/[\p{L}\p{N}]/u.test(b.textContent.replace(/\s/g, ''))).map(b => b.className))).forEach(x => iconosSin.push(`${fuente}/${id}: ${x}`));
    await cerrarModal(h);
  }
  t.ok(nHon > 100 && nCeldas > 100, `A0) se midieron 11 modales: ${nHon} controles del bloque de honorarios y ${nCeldas} celdas de monto`, { nHon, nCeldas });
  t.eq(sinNom, [], 'A1) ningún control del bloque de honorarios (formulario, selector, botones ✏️ ⧉ 🗑, proyección) queda sin nombre accesible en ninguna fuente');
  t.eq(mal, [], 'A2) las celdas de la proyección se llaman "<concepto>, <mes>, <entidad>"');
  t.eq(dup, [], 'A3) nombres únicos: sin celdas ni controles repetidos en el bloque de honorarios ni coincidencias con el formulario de compras');
  t.eq(iconosSin, [], 'A4) los botones solo-icono de honorarios tienen aria-label');
  const nom = async (sel) => (await nombresAccesibles(h.page, { scope: sel }))[0].nombre;
  await abrirModal(h, 'general', '1121');
  t.eq((await nom(`${MODAL} .hon-form-grid select[data-field="codigo"]`)).toLowerCase(), 'cuenta de honorarios', 'A5) General: el selector de cuenta se llama «Cuenta de honorarios»');
  t.eq(await nom(`${MODAL} .add-hon-btn`), '+ Agregar honorario', 'A5) el botón de alta se llama «+ Agregar honorario» (distinto de «+ Agregar compra»)');
  t.ok(/^Editar honorario BOLHE N° 101 2026-01-14$/.test(await nom(`${MODAL} tr[data-hon-id="gh1121_1"] .hon-edit-btn`)), 'A5) «Editar honorario BOLHE N° 101 2026-01-14»');
  t.ok(/^Quitar cuenta de la proyección de honorarios: 410803 · TALLERES/.test(await nom(`${MODAL} .honproy-del-btn[data-codigo="410803"]`)), 'A5) «Quitar cuenta de la proyección de honorarios: 410803 · …»');
  t.eq(await nom('#honproyAddSelect-1121-general'), 'Cuenta de proyección de honorarios para agregar, RBD 1121', 'A5) el selector de la proyección dice de qué entidad es');
  t.eq(await nom(celdaProy('codigo', '410803', 'MARZO')), 'Proyección honorarios 410803 · TALLERES EXTRAPROGRAMÁTICOS, marzo, RBD 1121', 'A5) celda de la proyección por cuenta');
  await cerrarModal(h);
  await abrirModal(h, 'junji', '5402002');
  t.eq((await nom(`${MODAL} .hon-form-grid input[data-field="concepto"]`)).toLowerCase(), 'concepto de honorarios', 'A6) JUNJI: el campo se llama «Concepto de honorarios» (el del registro de compras es «Concepto de la compra»)');
  t.eq(await nom(`${MODAL} .compra-form-grid input[data-field="concepto"]`), 'Concepto de la compra', 'A6) y los dos campos de concepto no se confunden');
  t.eq(await nom('#honproyAddInput-5402002-junji'), 'Concepto de proyección de honorarios para agregar, GESPARVU 5402002', 'A6) el campo de la proyección dice de qué entidad es');
  t.eq(await nom(celdaProy('concepto', 'Apoyo pedagógico', 'AGOSTO')), 'Proyección honorarios Apoyo pedagógico, agosto, GESPARVU 5402002', 'A6) celda de la proyección por concepto');
  t.ok(/^Quitar concepto de la proyección de honorarios: Apoyo pedagógico$/.test(await nom(`${MODAL} .honproy-del-btn[data-concepto="Apoyo pedagógico"]`)), 'A6) «Quitar concepto de la proyección de honorarios: Apoyo pedagógico»');
  t.noErrores(h);
  await h.close();

  // ============================== 2. UBICACIÓN y DESBORDE ==============================
  h = await boot({ fixture: 'honorarios_fuentes', viewport: { width: 1024, height: 900 } });
  for (const [fuente, id] of [['general', '1121'], ['junji', '5402002']]) {
    await abrirModal(h, fuente, id);
    const orden = await h.page.evaluate(() => {
      const raiz = document.querySelector('#otrasFuentesModalBody');
      const pos = (el) => (el ? Array.from(raiz.querySelectorAll('*')).indexOf(el) : -1);
      const rem = Array.from(raiz.querySelectorAll('td.item-label')).find(x => /^Gasto Remuneraciones/.test(x.textContent.trim()));
      const hon = raiz.querySelector('.hon-block');
      const bys = Array.from(raiz.querySelectorAll('.compras-section')).find(x => !x.closest('.hon-block'));
      return [pos(rem), pos(hon), pos(bys)];
    });
    t.ok(orden[0] >= 0 && orden[0] < orden[1] && orden[1] < orden[2], `${fuente}: el bloque «Honorarios (Subt. 21)» va debajo de Remuneraciones y arriba de Bienes y Servicios`, orden);
    for (const ancho of [1024, 390]) {
      await h.page.setViewportSize({ width: ancho, height: 900 });
      await h.waitIdle();
      const d = await h.page.evaluate(() => {
        const panel = document.querySelector('#otrasFuentesModal .modal-panel');
        const bloque = document.querySelector('#otrasFuentesModalBody .hon-block');
        return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, panel: panel.scrollWidth - panel.clientWidth, form: (() => { const f = bloque.querySelector('.hon-form-grid'); const r = f.getBoundingClientRect(); const p = panel.getBoundingClientRect(); return Math.round(r.right - p.right); })() };
      });
      t.ok(d.page <= 1 && d.panel <= 1 && d.form <= 1, `${fuente} a ${ancho} px: sin scroll horizontal de la página ni del modal y el formulario de honorarios cabe`, d);
    }
    await h.page.setViewportSize({ width: 1024, height: 900 });
    await cerrarModal(h);
  }
  t.noErrores(h);
  await h.close();

  // ============================== 3. TECLEO en la proyección sin que los snapshots pisen lo escrito ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  await abrirModal(h, 'general', '1122');
  await h.page.evaluate(() => { document.querySelectorAll('#otrasFuentesModalBody *').forEach((e, i) => { e.__marca = i + 1; }); });
  for (const [pausa, mes] of [[100, 'ENERO'], [450, 'FEBRERO']]) {   // enero y febrero de la proyección de 410304 parten vacíos
    const sel = celdaProy('codigo', '410304', mes);
    await h.page.click(sel);
    for (const ch of '1500000') { await h.page.keyboard.type(ch); await h.page.waitForTimeout(pausa); }
    t.eq(await h.page.inputValue(sel), '1500000', `teclear «1500000» con pausas de ${pausa} ms deja exactamente 1500000 en la celda de la proyección`);
    t.eq(await h.page.evaluate((s) => document.activeElement === document.querySelector(s), sel), true, `${pausa} ms: la celda conserva el foco`);
    await h.page.dispatchEvent(sel, 'blur');
    await h.flushWrites(); await h.waitIdle();
    t.eq((((await h.store())['sep_carga_rbd/1122'].otras_fuentes.general.hon_proyeccion_items['410304'] || {}).meses || {})[mes], 1500000, `${pausa} ms: lo guardado es 1500000`);
  }
  const nuevos = await h.page.evaluate(() => Array.from(document.querySelectorAll('#otrasFuentesModalBody *')).filter(e => e.__marca === undefined).map(e => e.outerHTML.slice(0, 160)));
  t.eq(nuevos, [], 'ningún nodo del modal fue reemplazado por los snapshots (ni los de la propia escritura; solo puede aparecer la fila «Total» al primer monto)');
  // otra persona guarda OTRA celda del mismo ítem mientras se teclea: «1234» queda en 1234
  const sel2 = celdaProy('codigo', '410304', 'OCTUBRE');
  await h.page.click(sel2);
  await h.page.keyboard.press('Control+A');   // reemplaza el 50.000 que ya tenía
  await h.page.keyboard.type('12');
  await h.remoto('1122', 'd.otras_fuentes.general.hon_proyeccion_items["410304"].meses.NOVIEMBRE = 777;');
  await h.page.keyboard.type('34');
  await h.waitIdle();
  t.eq(await h.page.inputValue(sel2), '1234', 'otra persona guardando otra celda mientras se teclea NO altera lo tecleado («1234»)');
  t.eq(await h.page.inputValue(celdaProy('codigo', '410304', 'NOVIEMBRE')), '777', 'y la celda ajena toma el valor nuevo');
  await h.page.dispatchEvent(sel2, 'blur');
  await h.flushWrites();
  // montos pegados con formato es-CL
  for (const [txt, esperado] of [['1.500.000', 1500000], ['1,5', 1.5], ['$ 2.000', 2000]]) {
    await h.page.evaluate(([s, v]) => { const el = document.querySelector(s); el.focus(); el.value = v; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: v })); }, [celdaProy('codigo', '410304', 'DICIEMBRE'), txt]);
    await h.page.dispatchEvent(celdaProy('codigo', '410304', 'DICIEMBRE'), 'blur');
    await h.flushWrites(); await h.waitIdle();
    t.eq((((await h.store())['sep_carga_rbd/1122'].otras_fuentes.general.hon_proyeccion_items['410304'] || {}).meses || {}).DICIEMBRE, esperado, `pegar «${txt}» guarda ${esperado}`);
  }
  await h.clearWrites();
  await h.page.evaluate(([s]) => { const el = document.querySelector(s); el.focus(); el.value = 'abc'; el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste', data: 'abc' })); }, [celdaProy('codigo', '410304', 'DICIEMBRE')]);
  await h.page.dispatchEvent(celdaProy('codigo', '410304', 'DICIEMBRE'), 'blur');
  await h.waitIdle();
  t.eq((await h.writes()).filter(w => w.payload && w.payload.otras_fuentes).length, 0, 'un texto no numérico se rechaza sin escribir ni tocar lo guardado');
  t.noErrores(h);
  await h.close();

  // formulario a medias y modo edición con snapshots ajenos de OTRA entidad
  h = await boot({ fixture: 'honorarios_fuentes' });
  await abrirModal(h, 'faep', '1121');
  await llenarFormHonOF(h.page, { concepto: 'Borrador', tipoDocumento: 'BOLH', montoGasto: '1500', descripcion: 'a medias' });
  await h.page.click(`${MODAL} button.hon-edit-btn[data-hon-id="fh1121_2"]`);
  const antes = await h.page.evaluate(() => { const g = document.querySelector('#otrasFuentesModalBody .hon-form-grid'); return [g.dataset.editingId, g.querySelector('[data-field="concepto"]').value, g.querySelector('[data-field="montoGasto"]').value]; });
  await h.remoto('1122', 'd.otras_fuentes = d.otras_fuentes || {}; d.otras_fuentes.faep = d.otras_fuentes.faep || {}; d.otras_fuentes.faep.gasto_rem = { meses: { ENERO: 5 }, total: 5 };');
  await h.remoto('AC', 'd.otras_fuentes.faep.honorarios.fh_ac_1.montoGasto = 351000;');
  await h.waitIdle();
  t.eq(await h.page.evaluate(() => { const g = document.querySelector('#otrasFuentesModalBody .hon-form-grid'); return [g.dataset.editingId, g.querySelector('[data-field="concepto"]').value, g.querySelector('[data-field="montoGasto"]').value]; }), antes, 'snapshots de OTRAS entidades no tocan el formulario (ni el modo edición)');
  t.eq(await h.page.evaluate(() => document.querySelector('#otrasFuentesModalBody .hon-form-grid .add-hon-btn').textContent.trim()), '💾 Guardar cambios de honorario', 'el botón sigue siendo «Guardar cambios de honorario»');
  t.noErrores(h);
  await h.close();

  // ============================== 4. EQUIVALENCIA: modal reconciliado = reconstruido (cuentas y conceptos) ==============================
  h = await boot({ fixture: 'honorarios_fuentes' });
  const rnd = prng(20261027);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const meses0 = (v = 0) => `{ ${MESES.map(m => `${m}: ${v}`).join(', ')} }`;
  const casos = [['general', '1121', 'general', false], ['junji', '5402002', 'junji', true]];
  let fallas = 0, pasos = 0;
  for (const [fuente, id, key, concepto] of casos) {
    await abrirModal(h, fuente, id);
    const reabrir = async () => { await cerrarModal(h); await abrirModal(h, fuente, id); };
    for (let i = 0; i < 30; i++) {
      const n = Math.floor(rnd() * 1000), mes = pick(MESES);
      const clave = concepto ? pick(['Apoyo pedagógico', 'Taller de música', 'Concepto & <b>"x"</b>']) : pick(['410803', '410304', '410904']);
      const tipo = pick(['BOLH', 'BHE', 'BOLHE', 'BPST', 'FAC']);
      const op = pick(['addHon', 'delHon', 'editHon', 'addProy', 'delProy', 'editProy', 'addHon']);
      const rutaH = `d.otras_fuentes.${key}`;
      const cuerpo = {
        addHon: `${rutaH}.honorarios = ${rutaH}.honorarios || {}; ${rutaH}.honorarios['hx${n}'] = { ${concepto ? 'concepto' : 'codigo'}: ${JSON.stringify(clave)}, tipoDocumento: '${tipo}', nroDocumento: 'B-${n}', fechaDocumento: '2026-0${1 + (n % 9)}-1${n % 9}', fechaPago: '', descripcion: 'Boleta ${n} <b>&</b> "q"', rutProveedor: '', nombreProveedor: 'Prestador ${n}', montoGasto: ${1000 + n}, montoDocumento: ${1000 + n} };`,
        delHon: `const ids = Object.keys(${rutaH}.honorarios || {}); if (ids.length > 1) delete ${rutaH}.honorarios[ids[${n} % ids.length]];`,
        editHon: `const ids = Object.keys(${rutaH}.honorarios || {}); if (ids.length) ${rutaH}.honorarios[ids[${n} % ids.length]].descripcion = 'Editada ${n} & <i>';`,
        addProy: `${rutaH}.hon_proyeccion_items = ${rutaH}.hon_proyeccion_items || {}; ${rutaH}.hon_proyeccion_items[${JSON.stringify(clave)}] = { ${concepto ? 'concepto' : 'codigo'}: ${JSON.stringify(clave)}, meses: ${meses0(n)}, total: 0 };`,
        delProy: `if (${rutaH}.hon_proyeccion_items) delete ${rutaH}.hon_proyeccion_items[${JSON.stringify(clave)}];`,
        editProy: `const ks = Object.keys(${rutaH}.hon_proyeccion_items || {}); if (ks.length) ${rutaH}.hon_proyeccion_items[ks[${n} % ks.length]].meses.${mes} = ${n * 5};`,
      }[op];
      await h.remoto(id, cuerpo);
      await h.waitIdle();
      const A = await h.page.evaluate(FIRMA, MODAL);
      await reabrir();
      const B = await h.page.evaluate(FIRMA, MODAL);
      const d = primeraDiferencia(A, B);
      pasos++;
      if (d) { fallas++; t.ok(false, `${fuente} paso ${i} (${op}): el modal reconciliado difiere del reconstruido — ${d}`); }
    }
    await cerrarModal(h);
  }
  t.eq([pasos, fallas], [60, 0], 'tras 60 cambios remotos aleatorios (boletas y proyección por cuenta y por concepto, con & < > ") el modal reconciliado es idéntico al reconstruido desde cero (General y JUNJI)');
  t.noErrores(h);
  await h.close();
}, { modoBug: 'enforced' });
