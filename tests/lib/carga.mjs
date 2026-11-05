// Ayudas de los specs de la carga por fuente («reemplazo total»):
//   subirYConfirmar(h, fuente, buffer, opts)  sube el .xlsx por el <input type=file> de la pestaña de la fuente, espera el RESUMEN DE CONTROL (modal #cargaControlModal),
//                                              lo lee, (por defecto) pulsa «Reemplazar», espera el resultado y lo lee. Devuelve { control, resultado, ... } (textos normalizados).
//   leerModalCarga(page)                      texto del modal de control / resultado (y si hay banner de error visible)
//   docFuente(h, rbd, fuente)                 lo que hay GUARDADO en el «servidor» (mock) para esa entidad y fuente
//   comprasServidor(h, fuente)                todas las compras guardadas de la fuente: [{ rbd, id, ...campos }]
import { libroXlsx } from './compras.mjs';
export { libroXlsx };

export const inputFuente = (fuente) => fuente === 'sep' ? '#importExcelInput' : fuente === 'fondos_fijos' ? '#importFondosFijosInput' : `#importExcelOFInput-${fuente}`;
const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function leerModalCarga(page) {
  return page.evaluate(() => {
    const m = document.getElementById('cargaControlModal');
    const b = document.getElementById('cargaErrorBanner');
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return {
      abierto: !m.classList.contains('hidden'),
      titulo: norm(document.getElementById('cargaControlTitle').textContent),
      texto: norm(document.getElementById('cargaControlBody').innerText),
      pie: norm(document.getElementById('cargaControlFooter').innerText),
      banner: b.classList.contains('hidden') ? '' : norm(b.innerText),
    };
  });
}
async function esperarModal(page, cond, desc, timeout = 60000) {
  try { await page.waitForFunction(cond, null, { timeout }); }
  catch (e) { throw new Error('No apareció ' + desc + ': ' + JSON.stringify(await leerModalCarga(page)).slice(0, 600)); }
}
// Aviso de vaciado masivo: si el resumen pide la casilla «Entiendo que K entidades quedarán vacías…», la marca (sin aviso no hace nada). Devuelve si había casilla.
export async function marcarCasillaMasiva(page) {
  if (!await page.$('#cargaConfirmaMasivo')) return false;
  await page.check('#cargaConfirmaMasivo');
  return true;
}
// `casilla:false` = no marca la casilla (para probar que el botón queda deshabilitado); por defecto la marca, como haría la persona que sí quiere reemplazar.
export async function subirYConfirmar(h, fuente, buffer, { nombre = 'carga.xlsx', confirmar = true, cerrar = true, casilla = true } = {}) {
  const { page } = h;
  await page.setInputFiles(inputFuente(fuente), { name: nombre, mimeType: MIME, buffer });
  await esperarModal(page, () => !document.getElementById('cargaControlModal').classList.contains('hidden') && (document.getElementById('cargaOkBtn') || document.getElementById('cargaCerrarBtn')), 'el resumen de control');
  const control = await leerModalCarga(page);
  const out = { control, resultado: null };
  if (!confirmar) { if (cerrar && await page.$('#cargaCancelarBtn')) await page.click('#cargaCancelarBtn'); else if (cerrar && await page.$('#cargaCerrarBtn')) await page.click('#cargaCerrarBtn'); await h.waitIdle(); return out; }
  if (!await page.$('#cargaOkBtn')) { out.resultado = control; if (cerrar) await page.click('#cargaCerrarBtn'); await h.waitIdle(); return out; }
  out.masivo = casilla ? await marcarCasillaMasiva(page) : !!await page.$('#cargaConfirmaMasivo');
  await page.click('#cargaOkBtn');
  await esperarModal(page, () => !!document.getElementById('cargaCerrarBtn') && !document.getElementById('cargaOkBtn'), 'el resultado de la carga');
  await page.waitForTimeout(150);
  out.resultado = await leerModalCarga(page);
  if (cerrar) await page.click('#cargaCerrarBtn');
  await h.flushWrites(); await h.waitIdle();
  return out;
}
export async function docFuente(h, rbd, fuente) {
  const st = await h.store();
  const d = st['sep_carga_rbd/' + rbd];
  return d && d.otras_fuentes ? (d.otras_fuentes[fuente] || null) : null;
}
export async function comprasServidor(h, fuente) {
  const st = await h.store();
  const out = [];
  Object.keys(st).filter(p => p.startsWith('sep_carga_rbd/') && !p.endsWith('/_meta')).forEach(p => {
    const c = ((st[p].otras_fuentes || {})[fuente] || {}).compras || {};
    Object.entries(c).forEach(([id, v]) => out.push({ rbd: p.split('/')[1], id, ...v }));
  });
  return out;
}
