// Fondos Fijos (⬆ Importar Control Fondos Fijos, hoja «FONDOS FIJOS P02») = REEMPLAZO TOTAL con la misma maquinaria de carga (resumen de control, writeBatch + mergeFields,
// respaldo + Deshacer, cuadratura, Vaciar). Antes importaba por campo con merge:true y un `confirm()`: una entidad que el libro ya no trae conservaba su cupo / rendido,
// las filas fuera del universo se contaban como «omitidas» y el resumen era un alert. Ahora la hoja gestiona SOLO: cupo y, por mes, saldo inicial, rendido, observado (y folio en
// marzo–septiembre); Registrado en General / Compensado SIGFE / Reposición entregada (se registran a mano) y todo lo demás del documento se conservan. Se verifica:
//   · carga con montos y folios exactos; el MISMO libro dos veces = sin escrituras; entidad ausente (con datos) queda en blanco en lo que la hoja gestiona y conserva lo manual;
//   · rechazos con fila y motivo (monto negativo, texto, id que no es RBD/GESPARVU, AC), repetida = la última manda, filas sin id ignoradas con aviso; leídas = cargadas + rechazadas;
//   · hoja ausente → aviso y nada se escribe; SEP y otras fuentes intactos; Cancelar/Esc; Deshacer; respaldo descargado en el mismo formato (reimportable); cuadratura; Vaciar.
import { boot, clickTab } from '../lib/boot.mjs';
import { correrSpec } from '../lib/spec.mjs';
import { libroXlsx } from '../lib/compras.mjs';
import { subirYConfirmar, leerModalCarga } from '../lib/carga.mjs';

const clon = (o) => JSON.parse(JSON.stringify(o));
const sinAud = (v) => { if (Array.isArray(v)) return v.map(sinAud); if (v && typeof v === 'object') { const o = {}; Object.keys(v).sort().forEach(k => { if (k !== 'lastModifiedAt' && k !== 'lastModifiedBy') o[k] = sinAud(v[k]); }); return o; } return v; };
const MAPA = [['MARZO', 7, 13], ['ABRIL', 15, 21], ['MAYO', 23, 29], ['JUNIO', 31, 37], ['JULIO', 39, 45], ['AGOSTO', 47, 53], ['SEPTIEMBRE', 55, 61], ['OCTUBRE', 63, null], ['NOVIEMBRE', 69, null], ['DICIEMBRE', 75, null]];
// Una fila del libro: id, nombre, cupo y por mes { s: saldo inicial, r: rendido, o: observado, f: folio }.
function filaP02(id, nombre, cupo, meses = {}) {
  const f = new Array(76).fill('');
  f[0] = id; f[1] = nombre; f[6] = cupo;
  MAPA.forEach(([mes, ini, colFolio]) => { const m = meses[mes]; if (!m) return; f[ini] = m.s ?? ''; f[ini + 2] = m.r ?? ''; f[ini + 3] = m.o ?? ''; if (colFolio !== null && m.f !== undefined) f[colFolio] = m.f; });
  return f;
}
const ENC1 = ['CONTROL FONDOS FIJOS P02', ...new Array(75).fill('')], ENC2 = ['RBD', 'Establecimiento', ...new Array(74).fill('')];
const libro = (h, filas, nombreHoja = 'FONDOS FIJOS P02') => libroXlsx(h.page, { [nombreHoja]: [ENC1, ENC2, ...filas] });
const MESES12 = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
const rellena = (f) => { if (!f) return f; const o = { cupo: f.cupo || 0, meses: {} }; MESES12.forEach(mes => { const m = (f.meses || {})[mes] || {}; o.meses[mes] = { saldo_inicial: m.saldo_inicial || 0, rendido: m.rendido || 0, observado: m.observado || 0, registrado_general: m.registrado_general || 0, compensado_sigfe: m.compensado_sigfe || 0, reposicion: m.reposicion || 0, folio: m.folio || '' }; }); return o; };
const docs = async (h) => sinAud(clon(await h.store()));
// Igual que docs() pero con Fondos Fijos con los ceros explícitos (un mes sin datos es lo mismo que un mes con todo en 0)
const docsN = async (h) => { const d = await docs(h); Object.values(d).forEach(x => { if (x.fondos_fijos) x.fondos_fijos = rellena(x.fondos_fijos); }); return d; };
const ff = async (h, rbd) => ((await h.store())['sep_carga_rbd/' + rbd] || {}).fondos_fijos;
const escribio = (ws) => ws.filter(w => w.path.startsWith('sep_carga_rbd/'));
async function escenario(t, nombre, fn) { try { await fn(); } catch (e) { t.ok(false, `${nombre}: excepción`, String(e.stack || e.message).split('\n').slice(0, 6).join(' | ')); } }
const sinFF = (d) => { const o = clon(d); Object.values(o).forEach(x => { delete x.fondos_fijos; }); return o; };

await correrSpec('carga_reemplazo_ff', async (t) => {
  // El fixture `fondos_fijos` trae Fondos Fijos con datos manuales (registrado_general, compensado_sigfe, reposicion) en 8 documentos.
  const h = await boot({ autoCarga: false, fixture: 'fondos_fijos' });
  const nombres = Object.fromEntries(Object.entries(await h.store()).map(([p, d]) => [p.split('/')[1], d.nombre]));
  const conFF = Object.entries(await h.store()).filter(([p, d]) => d.fondos_fijos).map(([p]) => p.split('/')[1]).filter(id => /^\d+$/.test(id)); // AC trae fondos_fijos en el fixture pero NO es entidad de Fondos Fijos
  await clickTab(h.page, 'of-fondos_fijos');
  const A = '1121', B = '1122', C = '1125'; // con datos de Fondos Fijos en el fixture (1121 trae además lo manual de marzo)

  await escenario(t, 'carga completa', async () => {
    const antes = await docs(h);
    const manualAntes = clon((await ff(h, A)).meses);
    await h.clearWrites();
    const r = await subirYConfirmar(h, 'fondos_fijos', await libro(h, [
      filaP02(Number(A), nombres[A], 750000, { MARZO: { s: 750000, r: 200000, o: 50000, f: 'FF-9/2026' }, JUNIO: { s: 10, r: 20, o: 30 }, DICIEMBRE: { s: 1, r: 2, o: 3 } }),
      filaP02(C, nombres[C], 400000, { ABRIL: { s: 400000, r: 123456, o: 0, f: 'FF-1' } }),
    ]));
    t.ok(r.control.abierto && /Revisar carga · Fondos Fijos/.test(r.control.titulo), 'aparece el resumen de control (no un confirm/alert)', r.control.titulo);
    t.ok(/FONDOS FIJOS P02/.test(r.control.texto) && /Panel hoy: filas/.test(r.control.texto), 'el resumen trae la hoja con panel hoy vs. archivo', r.control.texto.slice(0, 500));
    t.ok(/aplicado y verificado/.test(r.resultado.texto), 'la cuadratura dice que el panel coincide con el libro', r.resultado.texto.slice(0, 300));
    t.eq(h.dialogs.length, 0, 'ningún alert suelto');
    const a = await ff(h, A);
    t.eq(a.cupo, 750000, 'cupo exacto'); t.eq(a.meses.MARZO.rendido, 200000, 'rendido exacto'); t.eq(a.meses.MARZO.folio, 'FF-9/2026', 'folio'); t.eq(a.meses.DICIEMBRE.observado, 3, 'diciembre (sin folio) cargado');
    t.eq(a.meses.SEPTIEMBRE.rendido, 0, 'un mes que el libro no trae queda en 0 (reemplazo)');
    // lo manual se conserva
    t.eq(a.meses.MARZO.registrado_general, manualAntes.MARZO.registrado_general, 'Registrado en General (manual) se conserva');
    t.eq(a.meses.MARZO.compensado_sigfe, manualAntes.MARZO.compensado_sigfe, 'Compensado SIGFE (manual) se conserva');
    t.eq(a.meses.MARZO.reposicion, manualAntes.MARZO.reposicion, 'Reposición (manual) se conserva');
    t.eq(a.meses.JUNIO.registrado_general, manualAntes.JUNIO.registrado_general, 'lo manual de otro mes también');
    const post = await docs(h);
    t.eq(sinFF(post), sinFF(antes), 'fuera de fondos_fijos NINGÚN documento cambió (SEP, otras fuentes, _meta…)');
    t.ok(escribio(await h.writes()).every(w => w.options && Array.isArray(w.options.mergeFields) && w.options.mergeFields.every(f => /^(lastModifiedBy|lastModifiedAt|nombre|fondos_fijos\.)/.test(f))), 'todas las escrituras son mergeFields solo sobre fondos_fijos.*');
    const tabla = await h.page.evaluate(() => document.getElementById('fondosFijosTable').innerText.replace(/\s+/g, ' '));
    t.ok(tabla.includes('750.000'), 'la tabla de Fondos Fijos ya muestra el cupo nuevo sin recargar', tabla.slice(0, 300));
    t.noErrores(h);
  });

  await escenario(t, 'mismo libro dos veces y entidad ausente', async () => {
    const mismo = await libro(h, [
      filaP02(Number(A), nombres[A], 750000, { MARZO: { s: 750000, r: 200000, o: 50000, f: 'FF-9/2026' }, JUNIO: { s: 10, r: 20, o: 30 }, DICIEMBRE: { s: 1, r: 2, o: 3 } }),
      filaP02(C, nombres[C], 400000, { ABRIL: { s: 400000, r: 123456, o: 0, f: 'FF-1' } }),
    ]);
    await h.clearWrites();
    const antes = await docs(h);
    const r = await subirYConfirmar(h, 'fondos_fijos', mismo);
    t.ok(/idéntico a lo que ya hay/.test(r.control.texto), 'el mismo libro otra vez: el resumen dice que es idéntico', r.control.texto.slice(0, 400));
    t.eq(escribio(await h.writes()).length, 0, 'no se escribió nada'); t.eq(await docs(h), antes, 'ni cambió ningún documento');
    // entidad ausente: A y 1121 ya no vienen; solo B
    const manualB = clon((await ff(h, B)).meses);
    const r2 = await subirYConfirmar(h, 'fondos_fijos', await libro(h, [filaP02(Number(B), nombres[B], 5, { MAYO: { s: 5, r: 6, o: 7, f: 'x' } })]));
    t.ok(/quedarán en blanco/.test(r2.control.texto), 'el resumen avisa de las entidades que quedarán en blanco', r2.control.texto.slice(0, 700));
    const a = await ff(h, A), u = await ff(h, C);
    t.eq([a.cupo, a.meses.MARZO.rendido, a.meses.MARZO.folio, a.meses.JUNIO.observado], [0, 0, '', 0], 'la entidad ausente quedó en blanco en lo que la hoja gestiona (cupo, rendido, folio, observado)');
    t.ok(a.meses.MARZO.registrado_general !== undefined && a.meses.MARZO.compensado_sigfe !== undefined, 'pero conserva lo manual (Registrado en General / Compensado SIGFE)');
    t.eq(u.cupo, 0, 'C (con cupo antes) también quedó en blanco');
    t.eq((await ff(h, B)).meses.MAYO.rendido, 6, 'B con su valor nuevo');
    t.eq((await ff(h, B)).meses.MARZO.registrado_general, (manualB.MARZO || {}).registrado_general, 'y lo manual de B se conserva');
  });

  await escenario(t, 'rechazos', async () => {
    const h2 = await boot({ autoCarga: false, fixture: 'fondos_fijos' });
    await clickTab(h2.page, 'of-fondos_fijos');
    const antes = await docs(h2);
    const filas = [
      filaP02(1121, nombres['1121'], 100, { MARZO: { s: 1, r: 2, o: 3 } }),                       // válida
      filaP02(1122, nombres['1122'], -5, {}),                                                         // cupo negativo
      filaP02(1123, nombres['1123'], 'abc', {}),                                                      // cupo texto
      filaP02(1124, nombres['1124'], 1, { MARZO: { s: 1, r: 'mucho', o: 0 } }),                    // rendido texto
      filaP02('AC', 'Administración Central', 50, {}),                                                // AC no es entidad de Fondos Fijos
      filaP02(99999, 'No existe', 50, {}),                                                            // id fuera del universo
      filaP02(1121, nombres['1121'], 200, { MARZO: { s: 9, r: 9, o: 9, f: 'x'.repeat(60) } }),    // 1121 repetida: la última manda; folio largo (se recorta)
      filaP02('', 'TOTAL', 999999, {}),                                                               // total sin id: no es entidad (se avisa)
    ];
    const r = await subirYConfirmar(h2, 'fondos_fijos', await libro(h2, filas), { confirmar: false, cerrar: false });
    t.ok(/Filas que NO se cargarán \(6\)/.test(r.control.texto), 'se informan 6 filas rechazadas (negativo, texto ×2, AC, id inexistente y la repetida)', r.control.texto.slice(-1300));
    for (const m of ['no puede ser negativo', 'no es un número válido', 'no es un RBD ni un GESPARVU', 'se repite más abajo']) t.ok(r.control.texto.includes(m), `motivo visible: ${m}`);
    t.ok(/Hoja FONDOS FIJOS P02, fila \d+:/.test(r.control.texto), 'cada rechazo trae hoja y fila de Excel');
    t.ok(/1 fila sin id/.test(r.control.texto) && /1 folio se recortó/.test(r.control.texto), 'avisa la fila sin id (total) ignorada y el folio recortado', r.control.texto.slice(0, 900));
    t.ok(/FONDOS FIJOS P02 \d+ \$[\d.]+ 7 6 1 /.test(r.control.texto), 'leídas (7) = cargadas (1) + rechazadas (6)', (r.control.texto.match(/FONDOS FIJOS P02[^A-Z]{0,90}/) || [''])[0]);
    await h2.page.keyboard.press('Escape'); await h2.waitIdle();
    t.eq(await docs(h2), antes, 'Esc: no cambió nada'); t.eq(escribio(await h2.writes()).length, 0, 'ni escribió');
    await h2.close();
  });

  await escenario(t, 'hoja ausente y respaldo', async () => {
    const h3 = await boot({ autoCarga: false, fixture: 'fondos_fijos' });
    await clickTab(h3.page, 'of-fondos_fijos');
    const antes = await docs(h3);
    await h3.page.setInputFiles('#importFondosFijosInput', { name: 'otro.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await libroXlsx(h3.page, { OTRA: [['x']] }) });
    await h3.page.waitForSelector('#cargaCerrarBtn');
    t.ok(/No se encontró la hoja “FONDOS FIJOS P02”\. No se importó nada\./.test((await leerModalCarga(h3.page)).texto), 'sin la hoja se avisa y no se importa nada');
    await h3.page.click('#cargaCerrarBtn'); await h3.waitIdle();
    t.eq(await docs(h3), antes, 'nada cambió');
    // mayúsculas/espacios del nombre de la hoja no importan (como antes)
    const r0 = await subirYConfirmar(h3, 'fondos_fijos', await libro(h3, [filaP02(1121, nombres['1121'], 321, {})], ' fondos fijos p02 '));
    t.ok(/aplicado y verificado/.test(r0.resultado.texto), 'el nombre de la hoja se reconoce sin importar mayúsculas ni espacios');
    // el respaldo se descarga en el mismo formato y se puede reimportar para volver atrás
    await h3.page.setInputFiles('#importFondosFijosInput', { name: 'c.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: await libro(h3, [filaP02(1121, nombres['1121'], 999, { MARZO: { s: 1, r: 1, o: 1, f: 'q' } })]) });
    await h3.page.waitForSelector('#cargaOkBtn');
    const [dl] = await Promise.all([h3.page.waitForEvent('download'), h3.page.click('#cargaOkBtn')]);
    const buf = (await import('node:fs')).readFileSync(await dl.path());
    t.ok(/^respaldo_fondos_fijos_.*\.xlsx$/.test(dl.suggestedFilename()), 'se descargó el respaldo', dl.suggestedFilename());
    await h3.page.waitForSelector('#cargaCerrarBtn'); await h3.page.click('#cargaCerrarBtn'); await h3.flushWrites(); await h3.waitIdle();
    t.eq((await ff(h3, '1121')).cupo, 999, 'carga aplicada');
    const r = await subirYConfirmar(h3, 'fondos_fijos', buf, { nombre: dl.suggestedFilename() });
    t.ok(/aplicado y verificado/.test(r.resultado.texto), 'reimportar el respaldo funciona', r.resultado.texto.slice(0, 200));
    t.eq((await ff(h3, '1121')).cupo, 321, 'y devuelve el estado anterior a la carga');
    const r2 = await subirYConfirmar(h3, 'fondos_fijos', buf, { nombre: dl.suggestedFilename() });
    t.ok(/idéntico a lo que ya hay/.test(r2.control.texto), 'el respaldo reimportado dos veces es idempotente');
    await h3.close();
  });

  await escenario(t, 'cuadratura, Deshacer y Vaciar', async () => {
    const h4 = await boot({ autoCarga: false, fixture: 'fondos_fijos' });
    await clickTab(h4.page, 'of-fondos_fijos');
    const previo = await docsN(h4);
    await h4.page.evaluate(() => { window.__cargaTestHook = (fase, fk, cm) => { if (fase === 'memoria' || fase === 'guardado') cm.fondos_fijos_por_rbd['1121'].cupo += 1; }; });
    const rc = await subirYConfirmar(h4, 'fondos_fijos', await libro(h4, [filaP02(1121, nombres['1121'], 1000, {})]), { cerrar: false });
    t.ok(/NO cuadra con el Excel/.test(rc.resultado.texto), 'la cuadratura detecta el desajuste inyectado', rc.resultado.texto.slice(0, 400));
    t.ok(/NO cuadra con el Excel en FONDOS FIJOS P02/.test((await leerModalCarga(h4.page)).banner), 'banner rojo persistente');
    await h4.page.click('#cargaCerrarBtn'); await h4.page.click('#cargaBannerCerrar');
    await h4.page.evaluate(() => { window.__cargaTestHook = null; });
    // Deshacer
    await h4.page.click('#undoCargaOFBtn-fondos_fijos'); await h4.page.waitForSelector('#cargaOkBtn'); await h4.page.click('#cargaOkBtn');
    await h4.page.waitForSelector('#cargaCerrarBtn'); await h4.page.click('#cargaCerrarBtn'); await h4.flushWrites(); await h4.waitIdle();
    t.eq(await docsN(h4), previo, 'Deshacer devuelve los documentos como estaban (incluido lo manual; un mes sin datos = un mes en ceros)');
    // Vaciar
    t.eq(await h4.page.evaluate(() => !document.getElementById('vaciarOFBtn-fondos_fijos').classList.contains('hidden')), true, '«Vaciar Fondos Fijos» se ve para administración');
    await h4.page.click('#vaciarOFBtn-fondos_fijos'); await h4.page.waitForSelector('#cargaConfirmaNombre');
    t.eq(await h4.page.evaluate(() => document.getElementById('cargaOkBtn').disabled), true, 'sin escribir el nombre está deshabilitado');
    await h4.page.fill('#cargaConfirmaNombre', 'fondos fijos');
    await h4.page.click('#cargaOkBtn'); await h4.page.waitForSelector('#cargaCerrarBtn'); await h4.page.click('#cargaCerrarBtn'); await h4.flushWrites(); await h4.waitIdle();
    const st = await docsN(h4);
    const MESES_FOLIO = ['MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE']; // los únicos meses con columna de folio en la hoja (el folio de otros meses no se gestiona)
    const noVacios = Object.keys(st).filter(p => p !== 'sep_carga_rbd/AC' && p !== 'sep_carga_rbd/_meta').filter(p => { const f = st[p].fondos_fijos; if (!f) return false; if (f.cupo) return true; return Object.entries(f.meses || {}).filter(([mes]) => mes !== 'ENERO' && mes !== 'FEBRERO').some(([mes, m]) => m.saldo_inicial || m.rendido || m.observado || (MESES_FOLIO.includes(mes) && m.folio)); });
    t.eq(noVacios, [], 'Vaciar: cupo, saldo inicial, rendido, observado y folio en blanco en todas las entidades');
    t.ok(Object.values(st).some(d => d.fondos_fijos && Object.values(d.fondos_fijos.meses || {}).some(m => m.registrado_general)), 'lo manual (Registrado en General) se conserva');
    t.eq(st['sep_carga_rbd/1128'].fondos_fijos.meses.FEBRERO.rendido, 20000, 'enero y febrero (la hoja no los trae) no se tocan');
    t.eq(st['sep_carga_rbd/AC'].fondos_fijos, previo['sep_carga_rbd/AC'].fondos_fijos, 'AC (no es entidad de Fondos Fijos) no se toca');
    t.eq(sinFF(st), sinFF(previo), 'SEP y otras fuentes intactos');
    await h4.close();
    const h5 = await boot({ autoCarga: false, fixture: 'fondos_fijos', user: 'authorized-nonadmin' });
    await clickTab(h5.page, 'of-fondos_fijos');
    t.eq(await h5.page.evaluate(() => document.getElementById('vaciarOFBtn-fondos_fijos').classList.contains('hidden')), true, 'sin permisos de administración NO se ve «Vaciar Fondos Fijos»');
    await h5.close();
  });
  await h.close();
});
