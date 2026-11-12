export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function num(v) {
  if (v === '' || v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}
export const round = (v, d = 2) => { const f = 10 ** d; return Math.round((v || 0) * f) / f; };
export const sum = arr => arr.reduce((a, b) => a + (b || 0), 0);

let currency = 'NOK';
export const setCurrency = c => { currency = (c || 'NOK').toUpperCase(); };
export function money(v) {
  if (v == null || Number.isNaN(v)) return '–';
  try {
    return new Intl.NumberFormat('nb-NO', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
  } catch {
    return `${fmt(v, 2)} ${currency}`;
  }
}
export function fmt(v, d = 2) {
  return new Intl.NumberFormat('nb-NO', { maximumFractionDigits: d }).format(v || 0);
}
export function pct(v) { return v == null ? '–' : `${fmt(v * 100, 1)} %`; }

export function parseHours(s) {
  if (typeof s === 'number') return s;
  s = String(s || '').trim();
  if (!s) return 0;
  if (s.includes(':')) {
    const [h, m] = s.split(':');
    return num(h) + num(m) / 60;
  }
  return num(s);
}
export function hoursToHM(h) {
  const t = Math.round((h || 0) * 60);
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

export function eanCheckDigit(d12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += Number(d12[i]) * (i % 2 ? 3 : 1);
  return (10 - (s % 10)) % 10;
}
export function isEan13(code) {
  return /^\d{13}$/.test(code) && eanCheckDigit(code.slice(0, 12)) === Number(code[12]);
}
// Intern EAN-13 i området 20–29 (reservert for butikkintern bruk) – kan skannes av alle EAN-lesere.
export function generateEan(existing) {
  for (;;) {
    let s = '20';
    for (let i = 0; i < 10; i++) s += Math.floor(Math.random() * 10);
    s += eanCheckDigit(s);
    if (!existing.has(s)) return s;
  }
}

export function safeName(s) {
  const out = String(s || '').replace(/[\\/:*?"<>|#%&{}$!'@+`=]+/g, '').trim().replace(/\s+/g, '_').slice(0, 60);
  return out || 'uten-navn';
}
export function stamp(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
export function fmtDate(ts, withTime = true) {
  if (!ts) return '–';
  const d = new Date(ts);
  return withTime
    ? d.toLocaleString('nb-NO', { dateStyle: 'short', timeStyle: 'short' })
    : d.toLocaleDateString('nb-NO');
}
export const todayISO = () => new Date().toISOString().slice(0, 10);

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export function dataUrlToBlob(dataUrl) {
  const [head, b64] = dataUrl.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
export const dataUrlBase64 = d => d.slice(d.indexOf(',') + 1);

const scripts = {};
export function loadScript(src) {
  if (!scripts[src]) {
    scripts[src] = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => res();
      s.onerror = () => { delete scripts[src]; rej(new Error('Kunne ikke laste ' + src + ' (er du på nett?)')); };
      document.head.appendChild(s);
    });
  }
  return scripts[src];
}
export const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
export const JSBARCODE_URL = 'https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js';
export const SCANNER_URL = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';

export function loadImage(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('Kunne ikke lese bildet (formatet støttes kanskje ikke)'));
    i.src = src;
  });
}
function drawScaled(img, maxDim, q) {
  const s = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * s));
  const h = Math.max(1, Math.round(img.naturalHeight * s));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: cv.toDataURL('image/jpeg', q), w, h };
}
// Komprimerer til JPEG slik at hvert bilde holder seg godt under Firestores grense på 1 MB per dokument.
export async function compressImage(file, maxDim = 1600) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    let dim = maxDim, q = 0.82, out;
    for (let i = 0; i < 8; i++) {
      out = drawScaled(img, dim, q);
      if (out.dataUrl.length < 700000) break;
      q -= 0.1;
      if (q < 0.5) { dim = Math.round(dim * 0.8); q = 0.75; }
    }
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
export async function makeThumb(dataUrl, size = 240) {
  const img = await loadImage(dataUrl);
  return drawScaled(img, size, 0.7).dataUrl;
}

export const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
export const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
