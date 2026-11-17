// tablas_ordenables — las tablas de cada fuente (12 pestañas) y la de Fondos Fijos se ordenan al hacer clic en el título de la columna.
//
// Regla: primer clic = DECRECIENTE (mayor a menor; Z→A), segundo = creciente, tercero = decreciente. El orden se calcula aquí, sin leer el DOM, desde los documentos del fixture
// (oráculos de tests/lib: fuenteEsp, ffEntidad). RBD numérico con los códigos no numéricos (AC) SIEMPRE al final; «Real hasta» por número de mes; Estado por severidad
// (Déficit primero); empates por RBD ascendente. «Acciones» no se ordena. El título es un <button> y el <th> lleva aria-sort. El orden se conserva al llegar cambios en vivo, al
// cambiar la vista Real/Proyectado/Total y al cambiar de pestaña; sin clic queda el orden de siempre; ni los totales ni las exportaciones cambian.
import fs from 'node:fs';
import path from 'node:path';
import { boot } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { TESTS_DIR } from '../lib/config.mjs';
import { docsDe, clon, idsDeUniverso, corteFuente } from '../lib/corte.mjs';
import { FUENTES, fuenteEsp, idsGeneral, ffEntidad, IDS_FF } from '../lib/fondos_fijos.mjs';
import { leerTarjetas, leerFilas } from '../lib/honorarios_fuentes.mjs';
import { leerKpisFF, ordenFilas } from '../lib/fondos_fijos.mjs';
import { capturarDescarga, leerXlsx } from '../lib/capture-utils.mjs';

const RBDS = JSON.parse(fs.readFileSync(path.join(TESTS_DIR, 'fixtures', 'rbds.json'), 'utf8'));
const NOMBRE = { AC: 'Administración Central' };
[...RBDS.registros, ...RBDS.gesparvu].forEach((r) => { NOMBRE[r.rbd] = r.nombre; });
const COLLATOR = new Intl.Collator('es', { sensitivity: 'base' });

// ---- orden esperado (independiente del código del panel) ----
// items: [{ id, v:{col:valor} }]; tipos: col -> 'num' | 'texto' | 'rbd'; dir −1 = decreciente, +1 = creciente.
function ordenEsperado(items, col, tipos, dir) {
  const esNum = (id) => /^\d+$/.test(id);
  const rbdAsc = (a, b) => (esNum(a.id) && esNum(b.id) ? Number(a.id) - Number(b.id) : esNum(a.id) ? -1 : esNum(b.id) ? 1 : COLLATOR.compare(a.id, b.id));
  const cmp = (a, b) => {
    if (tipos[col] === 'rbd') return esNum(a.id) !== esNum(b.id) ? (esNum(a.id) ? -1 : 1) : rbdAsc(a, b) * dir;
    if (tipos[col] === 'texto') return COLLATOR.compare(a.v[col], b.v[col]) * dir;
    return (a.v[col] - b.v[col]) * dir;
  };
  return items.slice().sort((a, b) => cmp(a, b) || rbdAsc(a, b)).map((x) => x.id);
}

// ---- esperado por fuente (vista Total o la pedida) ----
const TIPOS_OF = { rbd: 'rbd', nombre: 'texto', real_hasta: 'num', ingreso: 'num', rem: 'num', hon: 'num', bys: 'num', gasto: 'num', saldo: 'num', estado: 'num' };
function itemsOF(docs, key, vista = 'total') {
  const f = FUENTES.find((x) => x.key === key);
  const esp = fuenteEsp(docs, key);
  const ids = key === 'general' ? idsGeneral(docs) : idsDeUniverso(f.universo);
  return ids.map((id) => {
    const e = esp.porId[id], b = e[vista];
    return { id, v: { rbd: id, nombre: NOMBRE[id], real_hasta: corteFuente(docs, id, key), ingreso: b.ingreso, rem: b.rem, hon: b.hon, bys: b.bys, gasto: b.gasto, saldo: b.saldo, estado: e.estado === 'deficit' ? 2 : 0 } };
  });
}
const SEV_FF = { 'Con observaciones': 4, 'Pendiente General': 3, 'Pendiente SIGFE': 2, Conciliado: 1, 'Sin datos': 0 };
const TIPOS_FF = { rbd: 'rbd', nombre: 'texto', cupo: 'num', aceptado: 'num', registrado: 'num', pendiente_general: 'num', compensado: 'num', pendiente_sigfe: 'num', estado: 'num' };
function itemsFF(docs) {
  return IDS_FF.map((id) => {
    const e = ffEntidad(docs, id);
    return { id, v: { rbd: id, nombre: NOMBRE[id], cupo: e.cupo, aceptado: e.aceptado, registrado: e.registrado, pendiente_general: e.pendienteGeneral, compensado: e.compensado, pendiente_sigfe: e.pendienteSigfe, estado: SEV_FF[e.estado] } };
  });
}

const selOF = (k) => ({ tabla: `#otrasFuentesTable-${k}`, filas: `#otrasFuentesTbody-${k} tr[data-rbd]` });
const SEL_FF = { tabla: '#fondosFijosTable', filas: '#fondosFijosTbody tr[data-ff-rbd]' };
const boton = (sel, col) => `${sel.tabla} thead th[data-orden-key="${col}"] button.th-orden`;
const ariaSorts = (page, sel) => page.evaluate((s) => Array.from(document.querySelectorAll(`${s} thead th[data-orden-key]`)).map((th) => [th.dataset.ordenKey, th.getAttribute('aria-sort')]), sel.tabla);

await correrSpec('tablas_ordenables', async (t) => {
  const docs = docsDe('fondos_fijos');
  const h = await boot({ fixture: 'fondos_fijos' });
  const { page } = h;

  // ============================================================ 1. las 12 pestañas: estructura, accesibilidad y orden inicial
  for (const f of FUENTES) {
    await h.clickTab('of-' + f.key);
    const sel = selOF(f.key);
    const th = await page.evaluate((s) => Array.from(document.querySelectorAll(`${s} thead th`)).map((x) => ({ txt: x.textContent.trim(), acciones: x.classList.contains('col-acciones'), btn: !!x.querySelector('button.th-orden[type="button"]'), aria: x.getAttribute('aria-sort'), titulo: (x.querySelector('button') || {}).title || '' })), sel.tabla);
    const ordenables = th.filter((x) => !x.acciones);
    t.ok(ordenables.length >= 6 && ordenables.every((x) => x.btn && x.aria === 'none' && /^(.+ — )?Ordenar por /.test(x.titulo) && x.titulo.includes(x.txt)), `${f.key}: ${ordenables.length} títulos ordenables, cada uno un <button type="button"> con aria-sort="none" y title «Ordenar por …»`, th);
    const acc = th.filter((x) => x.acciones);
    t.ok(acc.length === 1 && !acc[0].btn && acc[0].aria === null && acc[0].txt === 'Acciones', `${f.key}: «Acciones» no es ordenable (sin botón ni aria-sort)`, acc);
    t.eq(await ordenFilas(page, sel.filas), f.key === 'general' ? idsGeneral(docs) : idsDeUniverso(f.universo), `${f.key}: sin clic, el orden inicial de las filas es el de siempre (RBD, AC y jardines)`);
  }

  // ============================================================ 2. todas las columnas: decreciente, creciente, decreciente (general, junji, faep)
  const COLS_OF = { general: ['rbd', 'nombre', 'real_hasta', 'ingreso', 'rem', 'hon', 'bys', 'gasto', 'saldo', 'estado'], junji: ['rbd', 'nombre', 'real_hasta', 'ingreso', 'rem', 'hon', 'bys', 'gasto', 'saldo', 'estado'], faep: ['rbd', 'nombre', 'real_hasta', 'ingreso', 'rem', 'hon', 'bys', 'gasto', 'saldo', 'estado'] };
  for (const [key, cols] of Object.entries(COLS_OF)) {
    await h.clickTab('of-' + key);
    const sel = selOF(key);
    const items = itemsOF(docs, key);
    for (const col of cols) {
      const res = [];
      for (let i = 0; i < 3; i++) {
        await page.click(boton(sel, col));
        res.push(await ordenFilas(page, sel.filas));
      }
      const dec = ordenEsperado(items, col, TIPOS_OF, -1), cre = ordenEsperado(items, col, TIPOS_OF, 1);
      t.eq(res[0], dec, `${key} · ${col}: 1.er clic = decreciente`);
      t.eq(res[1], cre, `${key} · ${col}: 2.º clic = creciente`);
      t.eq(res[2], dec, `${key} · ${col}: 3.er clic = decreciente otra vez`);
    }
  }

  // ============================================================ 3. detalles de orden: negativos, empates, RBD no numérico, Real hasta, Estado
  await h.clickTab('of-faep');
  {
    const sel = selOF('faep'), items = itemsOF(docs, 'faep');
    await page.click(boton(sel, 'saldo'));
    const ord = await ordenFilas(page, sel.filas);
    const saldoDe = Object.fromEntries(items.map((x) => [x.id, x.v.saldo]));
    t.ok(items.some((x) => x.v.saldo < 0), 'sanity: FAEP tiene saldos negativos en el fixture');
    t.eq(ord.map((id) => saldoDe[id]), items.map((x) => x.v.saldo).sort((a, b) => b - a), 'FAEP · Saldo decreciente: valores con signo de mayor a menor (los negativos al final, el más negativo último)');
    const ceros = ord.filter((id) => saldoDe[id] === 0);
    t.ok(ceros.length > 5, `sanity: hay ${ceros.length} empates en saldo 0`);
    const num = ceros.filter((id) => /^\d+$/.test(id)).map(Number);
    t.eq(num, num.slice().sort((a, b) => a - b), 'empates: dentro de los iguales las filas quedan por RBD ascendente (no «saltan»)');
    await page.click(boton(sel, 'rbd'));
    let r = await ordenFilas(page, sel.filas);
    t.ok(r[r.length - 1] === 'AC' && /^\d+$/.test(r[0]) && Number(r[0]) > Number(r[1]), 'FAEP · RBD decreciente: numérico (mayor primero) y «AC» al final');
    await page.click(boton(sel, 'rbd'));
    r = await ordenFilas(page, sel.filas);
    t.ok(r[r.length - 1] === 'AC' && Number(r[0]) < Number(r[1]), 'FAEP · RBD creciente: numérico y «AC» sigue al final');
  }
  await h.clickTab('of-junji');
  {
    const sel = selOF('junji'), items = itemsOF(docs, 'junji');
    await page.click(boton(sel, 'real_hasta'));
    const ord = await ordenFilas(page, sel.filas);
    const corte = Object.fromEntries(items.map((x) => [x.id, x.v.real_hasta]));
    t.eq(ord.map((id) => corte[id]), items.map((x) => x.v.real_hasta).sort((a, b) => b - a), 'JUNJI · «Real hasta» decreciente: por número de mes (Dic, Jul, Jun), no alfabético');
    t.ok(new Set(Object.values(corte)).size >= 3, 'sanity: JUNJI tiene al menos 3 cortes distintos en el fixture');
    await page.click(boton(sel, 'estado'));
    const ord2 = await ordenFilas(page, sel.filas);
    const def = items.filter((x) => x.v.estado === 2).length;
    t.ok(def > 0 && def < items.length, `sanity: JUNJI tiene ${def} entidades en Déficit y ${items.length - def} en Superávit`);
    t.eq(ord2.slice(0, def).every((id) => items.find((x) => x.id === id).v.estado === 2), true, 'JUNJI · Estado decreciente: primero todas las que están en Déficit');
    const etiquetas = await page.evaluate((s) => Array.from(document.querySelectorAll(s)).map((tr) => tr.querySelector('.tag').textContent.trim()), sel.filas);
    t.eq([...new Set(etiquetas.slice(0, def))], ['Déficit'], 'JUNJI · Estado: lo que se ve en pantalla es «Déficit» en esas primeras filas');
    await page.click(boton(sel, 'estado'));
    const ord3 = await ordenFilas(page, sel.filas);
    t.eq(ord3.slice(0, items.length - def).every((id) => items.find((x) => x.id === id).v.estado === 0), true, 'JUNJI · Estado creciente: primero las de Superávit');
  }
  t.eq(await page.evaluate(() => [compararCeldaOrden('texto', 'Ángel', 'angel', 1), compararCeldaOrden('texto', 'ÁRBOL', 'zeta', 1) < 0, compararCeldaOrden('texto', 'zeta', 'Árbol', -1) < 0]),
    [0, true, true], 'Nombre: comparación insensible a tildes y mayúsculas (Ángel = angel; ÁRBOL antes que zeta)');

  // ============================================================ 4. aria-sort, teclado y «Acciones»
  await h.clickTab('of-general');
  {
    const sel = selOF('general');
    await page.click(boton(sel, 'saldo'));
    t.eq((await ariaSorts(page, sel)).filter(([, a]) => a !== 'none'), [['saldo', 'descending']], 'general: tras el 1.er clic solo Saldo tiene aria-sort="descending"');
    await page.click(boton(sel, 'saldo'));
    t.eq((await ariaSorts(page, sel)).filter(([, a]) => a !== 'none'), [['saldo', 'ascending']], 'general: 2.º clic → aria-sort="ascending"');
    await page.click(boton(sel, 'ingreso'));
    t.eq((await ariaSorts(page, sel)).filter(([, a]) => a !== 'none'), [['ingreso', 'descending']], 'general: otra columna → solo ella queda marcada, y empieza decreciente');
    const flecha = await page.evaluate((b) => getComputedStyle(document.querySelector(b), '::after').content, boton(sel, 'ingreso'));
    t.ok(/▼/.test(flecha), 'general: el encabezado activo muestra la flecha ▼ (decreciente)', flecha);
    const cur = await page.evaluate((b) => getComputedStyle(document.querySelector(b)).cursor, boton(sel, 'ingreso'));
    t.eq(cur, 'pointer', 'general: el título tiene cursor pointer');
    // Acciones: un clic en su celda no cambia nada
    const antes = await ordenFilas(page, sel.filas);
    await page.click(`${sel.tabla} thead th.col-acciones`);
    t.eq(await ordenFilas(page, sel.filas), antes, 'general: un clic en «Acciones» no reordena');
    t.eq((await ariaSorts(page, sel)).filter(([, a]) => a !== 'none'), [['ingreso', 'descending']], 'general: ni cambia el aria-sort');

    // teclado: Tab llega al botón; Enter y Espacio ordenan; el anillo de foco se ve
    await page.focus(boton(sel, 'hon'));
    await page.keyboard.press('Tab'); // llega con el teclado: el foco visible solo aplica a la navegación por teclado
    t.eq(await page.evaluate(() => document.activeElement.closest('th').dataset.ordenKey), 'bys', 'teclado: Tab llega al siguiente título ordenable');
    await page.focus(boton(sel, 'gasto'));
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    t.ok(await page.evaluate(() => { const a = document.activeElement; return a.matches(':focus-visible') && getComputedStyle(a).outlineStyle !== 'none' && parseFloat(getComputedStyle(a).outlineWidth) > 0; }), 'teclado: el botón enfocado muestra un anillo de foco visible');
    const items = itemsOF(docs, 'general');
    await page.keyboard.press('Enter');
    t.eq(await ordenFilas(page, sel.filas), ordenEsperado(items, 'gasto', TIPOS_OF, -1), 'teclado: Enter sobre el botón ordena decreciente');
    t.ok(await page.evaluate(() => document.activeElement.classList.contains('th-orden')), 'teclado: el foco se queda en el botón (no se pierde al reordenar)');
    await page.keyboard.press('Space');
    t.eq(await ordenFilas(page, sel.filas), ordenEsperado(items, 'gasto', TIPOS_OF, 1), 'teclado: Espacio sobre el botón invierte (creciente)');
    // Tab recorre los botones en orden
    await page.focus(boton(sel, 'rbd'));
    await page.keyboard.press('Tab');
    t.eq(await page.evaluate(() => document.activeElement.closest('th').dataset.ordenKey), 'nombre', 'teclado: Tab pasa de un título ordenable al siguiente');
  }

  // ============================================================ 5. el orden se conserva: cambio en vivo, vista Real/Proy/Total y pestañas
  {
    const sel = selOF('general');
    const sj = selOF('junji');
    await h.clickTab('of-general');
    await page.click(boton(sel, 'saldo')); // decreciente
    await page.click(boton(sel, 'saldo')); // creciente
    // cambio de otra persona: un RBD con gasto enorme pasa a saldo muy negativo
    const rbd = '1129', docs2 = clon(docs);
    docs2[rbd].otras_fuentes = docs2[rbd].otras_fuentes || {};
    docs2[rbd].otras_fuentes.general = docs2[rbd].otras_fuentes.general || {};
    docs2[rbd].otras_fuentes.general.gasto_rem = docs2[rbd].otras_fuentes.general.gasto_rem || { meses: {} };
    docs2[rbd].otras_fuentes.general.gasto_rem.meses = docs2[rbd].otras_fuentes.general.gasto_rem.meses || {};
    docs2[rbd].otras_fuentes.general.gasto_rem.meses.MARZO = 987654321;
    await h.remoto(rbd, 'd.otras_fuentes = d.otras_fuentes || {}; d.otras_fuentes.general = d.otras_fuentes.general || {}; d.otras_fuentes.general.gasto_rem = d.otras_fuentes.general.gasto_rem || { meses: {} }; d.otras_fuentes.general.gasto_rem.meses = d.otras_fuentes.general.gasto_rem.meses || {}; d.otras_fuentes.general.gasto_rem.meses.MARZO = 987654321;');
    await h.waitIdle();
    const items2 = itemsOF(docs2, 'general');
    const ord = await ordenFilas(page, sel.filas);
    t.eq(ord, ordenEsperado(items2, 'saldo', TIPOS_OF, 1), 'cambio en vivo de otra persona: la tabla se repinta con el orden elegido (Saldo creciente) y el RBD modificado queda primero');
    t.eq(ord[0], rbd, 'sanity: el RBD con 987.654.321 de gasto es el de menor saldo');
    t.eq((await ariaSorts(page, sel)).filter(([, a]) => a !== 'none'), [['saldo', 'ascending']], 'cambio en vivo: el indicador del encabezado se mantiene');

    // vista Real: el orden usa las cifras de esa vista
    await page.click('#tab-of-general .of-chip[data-of-vista="real"]');
    await h.waitIdle();
    t.eq(await ordenFilas(page, sel.filas), ordenEsperado(itemsOF(docs2, 'general', 'real'), 'saldo', TIPOS_OF, 1), 'vista Real: sigue ordenado por Saldo (creciente) con las cifras Reales');
    await page.click('#tab-of-general .of-chip[data-of-vista="total"]');
    await h.waitIdle();

    // por pestaña: JUNJI recuerda su propia columna; General no se contamina
    await h.clickTab('of-junji');
    t.eq((await ariaSorts(page, sj)).filter(([, a]) => a !== 'none'), [['estado', 'ascending']], 'JUNJI: su tabla conserva lo suyo (Estado ▲, del paso 3) y no heredó el orden de General');
    await page.click(boton(sj, 'ingreso'));
    await h.clickTab('of-general');
    t.eq((await ariaSorts(page, sel)).filter(([, a]) => a !== 'none'), [['saldo', 'ascending']], 'al volver a General sigue Saldo ▲');
    t.eq(await ordenFilas(page, sel.filas), ordenEsperado(items2, 'saldo', TIPOS_OF, 1), 'al volver a General el orden se mantiene');
    await h.clickTab('of-junji');
    t.eq(await ordenFilas(page, sj.filas), ordenEsperado(itemsOF(docs, 'junji'), 'ingreso', TIPOS_OF, -1), 'al volver a JUNJI se mantiene su Ingreso decreciente');
    await h.clickTab('of-general');
  }

  // ============================================================ 6. totales y exportaciones no cambian con el orden
  {
    const h2 = await boot({ fixture: 'fondos_fijos' });
    const p2 = h2.page;
    const exportar = async (hh, key) => { await hh.clickTab('of-' + key); const dl = await capturarDescarga(hh.page, () => hh.page.click(`#downloadExcelOFBtn-${key}`)); return (await leerXlsx(hh.page, dl.buffer)).hojas; };
    await h2.clickTab('of-general');
    const tarjetasAntes = await leerTarjetas(p2, 'general'), filasAntes = await leerFilas(p2, 'general');
    const excelAntes = await exportar(h2, 'general');
    await h2.clickTab('of-general');
    await p2.click(boton(selOF('general'), 'saldo'));
    await p2.click(boton(selOF('general'), 'nombre'));
    t.eq(await leerTarjetas(p2, 'general'), tarjetasAntes, 'ordenar no cambia las tarjetas (totales) de la pestaña');
    t.eq(await leerFilas(p2, 'general'), filasAntes, 'ordenar no cambia ninguna cifra de las filas (mismo contenido por RBD)');
    t.eq(await exportar(h2, 'general'), excelAntes, 'el Excel de la fuente tiene el mismo contenido con la tabla ordenada (no depende del orden de la pantalla)');
    await h2.close();
  }

  // ============================================================ 7. Fondos Fijos
  await h.clickTab('of-fondos_fijos');
  {
    const items = itemsFF(docs);
    t.eq(await ordenFilas(page, SEL_FF.filas), IDS_FF, 'Fondos Fijos: sin clic, orden inicial de siempre');
    const th = await page.evaluate(() => Array.from(document.querySelectorAll('#fondosFijosTable thead th')).map((x) => ({ txt: x.textContent.trim(), btn: !!x.querySelector('button.th-orden'), aria: x.getAttribute('aria-sort') })));
    t.eq(th.map((x) => [x.txt, x.btn, x.aria]), [['RBD / GESPARVU', true, 'none'], ['Nombre', true, 'none'], ['Cupo vigente', true, 'none'], ['Gasto aceptado', true, 'none'], ['Registrado en General', true, 'none'], ['Pendiente General', true, 'none'], ['Compensado SIGFE', true, 'none'], ['Pendiente SIGFE', true, 'none'], ['Estado', true, 'none'], ['Acciones', false, null]], 'Fondos Fijos: todos los títulos son botones con aria-sort, salvo «Acciones»');
    const kpisAntes = await leerKpisFF(page);
    for (const col of ['rbd', 'nombre', 'cupo', 'aceptado', 'registrado', 'pendiente_general', 'compensado', 'pendiente_sigfe', 'estado']) {
      const res = [];
      for (let i = 0; i < 3; i++) { await page.click(boton(SEL_FF, col)); res.push(await ordenFilas(page, SEL_FF.filas)); }
      const dec = ordenEsperado(items, col, TIPOS_FF, -1), cre = ordenEsperado(items, col, TIPOS_FF, 1);
      t.ok(JSON.stringify(res[0]) === JSON.stringify(dec) && JSON.stringify(res[1]) === JSON.stringify(cre) && JSON.stringify(res[2]) === JSON.stringify(dec), `Fondos Fijos · ${col}: decreciente → creciente → decreciente`, { res0: res[0].slice(0, 8), dec: dec.slice(0, 8) });
    }
    t.eq(await leerKpisFF(page), kpisAntes, 'Fondos Fijos: ordenar no cambia las tarjetas');
    // Estado: por severidad (Con observaciones, Pendiente General, Pendiente SIGFE, Conciliado, Sin datos)
    // (tras el bucle, Estado quedó en su 3.er clic = decreciente)
    const etq = await page.evaluate(() => Array.from(document.querySelectorAll('#fondosFijosTbody tr[data-ff-rbd] .c-estado')).map((x) => x.textContent.trim()));
    t.eq([...new Set(etq)], ['Con observaciones', 'Pendiente General', 'Pendiente SIGFE', 'Conciliado', 'Sin datos'], 'Fondos Fijos · Estado decreciente: lo peor primero (Con observaciones … Conciliado, Sin datos al final)');
    // cambio en vivo: un cupo nuevo reordena con la columna elegida
    await page.click(boton(SEL_FF, 'cupo')); // decreciente
    const docs3 = clon(docs);
    docs3['1130'].fondos_fijos = docs3['1130'].fondos_fijos || {};
    docs3['1130'].fondos_fijos.cupo = 77777777;
    await h.remoto('1130', 'd.fondos_fijos = d.fondos_fijos || {}; d.fondos_fijos.cupo = 77777777;');
    await h.waitIdle();
    const ord = await ordenFilas(page, SEL_FF.filas);
    t.eq(ord, ordenEsperado(itemsFF(docs3), 'cupo', TIPOS_FF, -1), 'Fondos Fijos: un cambio en vivo conserva el orden por Cupo (el RBD 1130 pasa primero)');
    t.eq(ord[0], '1130', 'sanity: 1130 con el cupo mayor queda primero');
    // teclado
    await page.focus(boton(SEL_FF, 'nombre'));
    await page.keyboard.press('Enter');
    t.eq(await ordenFilas(page, SEL_FF.filas), ordenEsperado(itemsFF(docs3), 'nombre', TIPOS_FF, -1), 'Fondos Fijos: Enter sobre «Nombre» ordena Z→A');
    // las pestañas de fuentes siguen su propio orden
    await h.clickTab('of-general');
    t.eq((await ariaSorts(page, selOF('general'))).filter(([, a]) => a !== 'none'), [['saldo', 'ascending']], 'Fondos Fijos y General llevan cada uno su propio orden');
  }

  // ============================================================ 8. SEP no cambia
  await h.clickTab('SEP');
  {
    const n = await page.evaluate(() => document.querySelectorAll('#tableBody').length ? document.querySelectorAll('table.data-table:not([id^="otrasFuentesTable"]):not(#fondosFijosTable) button.th-orden').length : -1);
    t.eq(n, 0, 'SEP: sus encabezados no cambian (sin botones nuevos; siguen con su propio orden por clic)');
    const filas = async () => page.evaluate(() => Array.from(document.querySelectorAll('#tableBody tr.rbd-row')).map((tr) => tr.getAttribute('data-rbd')));
    const nombres = await page.evaluate(() => Array.from(document.querySelectorAll('#tableBody tr.rbd-row')).map((tr) => tr.querySelector('.nombre-txt').textContent.trim()));
    t.eq(nombres.length > 10, true, 'sanity: la tabla SEP tiene filas');
    await page.click('table.data-table th[data-key="nombre"]');
    const desc = await page.evaluate(() => Array.from(document.querySelectorAll('#tableBody tr.rbd-row')).map((tr) => tr.querySelector('.nombre-txt').textContent.trim()));
    t.eq(desc, nombres.slice().sort((a, b) => String(b).localeCompare(String(a))), 'SEP: el primer clic en Nombre sigue ordenando decreciente');
    void filas;
  }

  t.noErrores(h, 'sin errores de consola/página/red');
  await h.close();
});
