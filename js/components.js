import { html, useState, useEffect, useRef } from './lib.js';
import * as S from './store.js';
import {
  num, uid, compressImage, makeThumb, generateEan, loadScript, SCANNER_URL, JSZIP_URL, JSBARCODE_URL,
  downloadBlob, dataUrlToBlob, dataUrlBase64, safeName, fmt, isEan13, money,
} from './util.js';
import {
  allBarcodes, stockField, unitOf, stockOf, moveStock, setCount, registerPrint, packPackage, sellPackageDirect,
  componentEntries, printNeeds, byName, TYPE_LABEL,
} from './model.js';

export const go = p => { location.hash = '#/' + p; };

// Forhåndsutfylte verdier til et nytt element (f.eks. strekkode fra skanning)
let draft = null;
export const setDraft = d => { draft = d; };
export const takeDraft = () => { const d = draft; draft = null; return d || {}; };

/* ---------- Toasts ---------- */
let toasts = [];
const tl = new Set();
export function toast(msg, kind = 'ok') {
  const id = Math.random();
  toasts = [...toasts, { id, msg, kind }];
  tl.forEach(f => f());
  setTimeout(() => { toasts = toasts.filter(t => t.id !== id); tl.forEach(f => f()); }, kind === 'err' ? 6000 : 3000);
}
export function Toasts() {
  const [, s] = useState(0);
  useEffect(() => { const f = () => s(x => x + 1); tl.add(f); return () => tl.delete(f); }, []);
  return html`<div class="toasts" role="status">${toasts.map(t => html`<div key=${t.id} class=${'toast ' + t.kind}>${t.msg}</div>`)}</div>`;
}

/* ---------- Layout bits ---------- */
export function Modal({ title, onClose, children, wide }) {
  useEffect(() => {
    const k = e => { if (e.key === 'Escape') onClose?.(); };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  return html`<div class="modal-bg" onMouseDown=${e => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div class=${'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label=${title}>
      <div class="modal-head"><h3>${title}</h3><button class="icon-btn" onClick=${onClose} aria-label="Lukk">✕</button></div>
      <div class="modal-body">${children}</div>
    </div></div>`;
}
export function PageHead({ title, children, back }) {
  return html`<div class="page-head">
    ${back && html`<a class="btn small" href=${'#/' + back}>← Tilbake</a>`}
    <h1>${title}</h1>${children}</div>`;
}
export const Thumb = ({ src, icon = '🖼️' }) => html`<div class="thumb">${src ? html`<img src=${src} alt="" loading="lazy"/>` : icon}</div>`;
export const Empty = ({ icon = '📭', title, children }) => html`<div class="empty"><div class="big">${icon}</div><h3>${title}</h3><div>${children}</div></div>`;
export function SearchBox({ value, onInput, placeholder = 'Søk …' }) {
  return html`<div class="search"><input type="search" placeholder=${placeholder} value=${value} onInput=${e => onInput(e.target.value)}/></div>`;
}
export function Seg({ value, options, onChange }) {
  return html`<div class="seg">${options.map(([v, l]) => html`<button type="button" class=${v === value ? 'on' : ''} onClick=${() => onChange(v)}>${l}</button>`)}</div>`;
}
export const StockBadge = ({ c, item }) => {
  const v = stockOf(c, item), low = num(item.lowStock);
  const cls = v <= 0 ? 'danger' : (low > 0 && v < low ? 'warn' : 'ok');
  return html`<span class=${'badge ' + cls}>${fmt(v, c === 'materials' ? 0 : 2)} ${unitOf(c, item)}</span>`;
};
export function textMatch(q, ...vals) {
  q = q.trim().toLowerCase();
  if (!q) return true;
  return vals.some(v => String(v || '').toLowerCase().includes(q));
}

// Summerer lager, selvkost, salgsverdi og fortjeneste for en liste.
// rows: [{ stock, cost, price, profit }] der price/profit er per stk (salgspris, ellers foreslått pris)
export function ProfitSummary({ rows, count }) {
  let units = 0, cost = 0, value = 0, profit = 0;
  for (const r of rows) {
    const n = Math.max(0, num(r.stock));
    units += n; cost += n * r.cost; value += n * r.price; profit += n * r.profit;
  }
  const margin = value > 0 ? profit / value : null;
  return html`<div class="grid-stats">
    <div class="stat"><div class="v">${fmt(count, 0)}</div><div class="l">Varer i listen</div></div>
    <div class="stat"><div class="v">${fmt(units, 0)} stk</div><div class="l">På lager</div></div>
    <div class="stat"><div class="v">${money(cost)}</div><div class="l">Selvkost lager</div></div>
    <div class="stat"><div class="v">${money(value)}</div><div class="l">Salgsverdi lager</div></div>
    <div class="stat"><div class="v ${profit < 0 ? 'neg' : 'pos'}">${money(profit)}</div>
      <div class="l">Sum fortjeneste lager${margin != null ? ` (${fmt(margin * 100, 1)} %)` : ''}</div></div>
  </div>`;
}

/* ---------- Inputs ---------- */
const toInput = v => (v == null || v === '' ? '' : String(v).replace('.', ','));
export function NumInput({ value, onChange, int, ...rest }) {
  const [s, setS] = useState(toInput(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setS(toInput(value)); }, [value]);
  return html`<input type="text" inputmode=${int ? 'numeric' : 'decimal'} autocomplete="off" value=${s}
    onFocus=${e => { focused.current = true; e.target.select?.(); }}
    onBlur=${() => { focused.current = false; setS(toInput(value)); }}
    onInput=${e => { setS(e.target.value); onChange(int ? Math.round(num(e.target.value)) : num(e.target.value)); }} ...${rest}/>`;
}

export function BarcodeInput({ value, onChange }) {
  const [scan, setScan] = useState(false);
  return html`<div class="input-group">
    <input type="text" inputmode="numeric" value=${value || ''} onInput=${e => onChange(e.target.value.trim())} placeholder="Skann eller skriv"/>
    <button type="button" class="btn small" title="Skann med kamera" onClick=${() => setScan(true)}>📷</button>
    <button type="button" class="btn small" title="Lag ny intern EAN-kode" onClick=${() => onChange(generateEan(allBarcodes()))}>Ny</button>
    ${scan && html`<${ScannerModal} onCode=${c => onChange(c)} onClose=${() => setScan(false)}/>`}
  </div>`;
}

// Visningsnavn i nedtrekkslister – filament viser fabrikant, materiale og farge
export function refLabel(c, o) {
  if (c === 'materials') {
    const extra = [o.material, o.color].filter(Boolean).join(', ');
    return extra ? `${o.name} – ${extra}` : o.name;
  }
  return o.name;
}
function materialDetails(m) {
  return [
    m.color && `Farge: ${m.color}`,
    m.material,
    num(m.diameter) ? `${fmt(m.diameter)} mm` : '',
    `Lager: ${fmt(num(m.stockGrams), 0)} g`,
    m.location && `Plass: ${m.location}`,
  ].filter(Boolean).join(' · ');
}

export function Field({ f, value, onChange, readOnly }) {
  let input;
  if (readOnly) input = html`<input readonly value=${f.t === 'num' || f.t === 'int' ? toInput(value) : (value ?? '')}/>`;
  else if (f.t === 'textarea') input = html`<textarea value=${value || ''} placeholder=${f.ph || ''} onInput=${e => onChange(e.target.value)}/>`;
  else if (f.t === 'num' || f.t === 'int') input = html`<${NumInput} int=${f.t === 'int'} value=${value} onChange=${onChange}/>`;
  else if (f.t === 'ref') {
    const opts = S.list(f.ref).sort((a, b) => byName(a, b) || String(a.color || '').localeCompare(String(b.color || ''), 'nb'));
    const sel = S.get(f.ref, value);
    input = html`<select value=${value || ''} onChange=${e => onChange(e.target.value)}>
      <option value="">– velg –</option>${opts.map(o => html`<option value=${o.id}>${refLabel(f.ref, o)}</option>`)}</select>
      ${f.ref === 'materials' && sel && html`<span class="help">${materialDetails(sel)}</span>`}`;
  } else if (f.t === 'barcode') input = html`<${BarcodeInput} value=${value} onChange=${onChange}/>`;
  else if (f.t === 'date') input = html`<input type="date" value=${value || ''} onInput=${e => onChange(e.target.value)}/>`;
  else if (f.t === 'hm') input = html`<input type="text" inputmode="numeric" placeholder="t:mm" value=${value || ''} onInput=${e => onChange(e.target.value)}/>`;
  else input = html`<input type="text" value=${value || ''} placeholder=${f.ph || ''} onInput=${e => onChange(e.target.value)}/>`;
  return html`<label class=${'field' + (f.wide ? ' wide' : '')}>
    <span>${f.l}${f.u ? ` (${f.u})` : ''}${f.req ? ' *' : ''}</span>${input}
    ${f.help && html`<span class="help">${f.help}</span>`}
  </label>`;
}

// Viser en liste av felter fra et skjema
export function Fields({ fields, value, set, readOnlyKeys = [] }) {
  return html`<div class="form-grid">${fields.filter(f => f.t !== 'id').map(f => html`<${Field} key=${f.k} f=${f}
    value=${value[f.k]} readOnly=${readOnlyKeys.includes(f.k)} onChange=${v => set(o => ({ ...o, [f.k]: v }))}/>`)}</div>`;
}

/* ---------- Strekkode-skanner (kamera) ---------- */
function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 1100; g.gain.value = 0.08;
    o.connect(g); g.connect(ctx.destination); o.start();
    setTimeout(() => { o.stop(); ctx.close(); }, 90);
  } catch { /* ignore */ }
}
export function ScannerModal({ onCode, onClose, continuous, title = 'Skann strekkode' }) {
  const id = useRef('scan-' + uid()).current;
  const cb = useRef(onCode);
  cb.current = onCode;
  const [err, setErr] = useState(null);
  const [last, setLast] = useState('');
  useEffect(() => {
    let sc = null, stopped = false, prev = '', prevT = 0;
    (async () => {
      try {
        await loadScript(SCANNER_URL);
        if (stopped) return;
        const Fm = window.Html5QrcodeSupportedFormats;
        sc = new window.Html5Qrcode(id, {
          verbose: false,
          formatsToSupport: [Fm.EAN_13, Fm.EAN_8, Fm.UPC_A, Fm.UPC_E, Fm.CODE_128, Fm.CODE_39, Fm.ITF, Fm.QR_CODE, Fm.DATA_MATRIX],
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        });
        await sc.start({ facingMode: 'environment' }, {
          fps: 12,
          qrbox: (w, h) => ({ width: Math.floor(Math.min(w * 0.9, 360)), height: Math.floor(Math.min(h * 0.6, 200)) }),
        }, txt => {
          const now = Date.now();
          if (txt === prev && now - prevT < 2500) return;
          prev = txt; prevT = now;
          navigator.vibrate?.(60);
          beep();
          setLast(txt);
          cb.current(txt);
          if (!continuous) onClose();
        });
        if (stopped) sc.stop().catch(() => {});
      } catch (e) {
        const m = String(e?.message || e);
        setErr(/NotAllowed|Permission/i.test(m) ? 'Kameratilgang ble nektet. Gi nettleseren tilgang til kameraet i innstillingene.' : m);
      }
    })();
    return () => {
      stopped = true;
      if (sc) { try { sc.stop().then(() => sc.clear()).catch(() => {}); } catch { /* ignore */ } }
    };
  }, []);
  return html`<${Modal} title=${title} onClose=${onClose}>
    ${err ? html`<div class="notice danger">${err}</div>` : html`<div id=${id} class="scanner-box"></div>`}
    <p class="muted small">Hold strekkoden innenfor rammen. ${continuous ? 'Skanneren fortsetter til du lukker den.' : ''}</p>
    ${last && html`<p>Sist lest: <b>${last}</b></p>`}
    <div class="modal-foot"><button class="btn" onClick=${onClose}>Lukk</button></div>
  <//>`;
}

/* ---------- Strekkode som SVG (for etiketter) ---------- */
export function useScript(url) {
  const [ok, setOk] = useState(false);
  useEffect(() => { loadScript(url).then(() => setOk(true), e => toast(e.message, 'err')); }, [url]);
  return ok;
}
const svgCache = new Map();
export function barcodeSvg(code, height = 40) {
  const key = code + '|' + height;
  if (svgCache.has(key)) return svgCache.get(key);
  if (!window.JsBarcode || !code) return '';
  const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  try {
    window.JsBarcode(el, code, {
      format: isEan13(code) ? 'EAN13' : 'CODE128', height, width: 2, margin: 0, fontSize: 14, textMargin: 1, flat: isEan13(code) ? false : true,
    });
    el.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const w = el.getAttribute('width'), h = el.getAttribute('height');
    el.setAttribute('viewBox', `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
    el.removeAttribute('width');
    el.removeAttribute('height');
    const out = el.outerHTML;
    svgCache.set(key, out);
    return out;
  } catch {
    return '';
  }
}
export { JSBARCODE_URL };

/* ---------- Bildegalleri ---------- */
export function ImageGallery({ c, item, saved }) {
  const [imgs, setImgs] = useState(null);
  const [view, setView] = useState(null);
  const [busy, setBusy] = useState(false);
  const camRef = useRef(), fileRef = useRef();
  const live = S.get(c, item.id) || item;
  useEffect(() => {
    if (!saved) { setImgs([]); return; }
    S.images.byItem(item.id).then(r => setImgs(r.sort((a, b) => a.createdAt - b.createdAt)), e => { setImgs([]); toast('Kunne ikke hente bilder: ' + e.message, 'err'); });
  }, [item.id, saved]);

  async function add(files) {
    if (!files?.length) return;
    setBusy(true);
    let list = [...(imgs || [])];
    try {
      for (const f of files) {
        const { dataUrl, w, h } = await compressImage(f);
        const img = { id: uid(), c, itemId: item.id, itemName: live.name || '', dataUrl, w, h, createdAt: Date.now(), createdBy: S.userEmail() };
        S.images.put(img).catch(e => toast('Bilde ble ikke lagret: ' + e.message, 'err'));
        list = [...list, img];
        setImgs(list);
        if (!live.thumb && list.length === 1) await S.write([{ t: 'upd', c, id: item.id, d: { thumb: await makeThumb(dataUrl) } }]);
      }
      toast(files.length > 1 ? `${files.length} bilder lagt til` : 'Bilde lagt til');
    } catch (e) {
      toast(e.message, 'err');
    }
    setBusy(false);
  }
  async function remove(img) {
    if (!confirm('Slette dette bildet?')) return;
    await S.images.del(img.id);
    const rest = imgs.filter(i => i.id !== img.id);
    setImgs(rest);
    setView(null);
    await S.write([{ t: 'upd', c, id: item.id, d: { thumb: rest[0] ? await makeThumb(rest[0].dataUrl) : '' } }]);
  }
  async function primary(img) {
    await S.write([{ t: 'upd', c, id: item.id, d: { thumb: await makeThumb(img.dataUrl) } }]);
    toast('Satt som hovedbilde');
  }
  function downloadOne(img, i) {
    downloadBlob(dataUrlToBlob(img.dataUrl), `${safeName(live.name)}_${i + 1}.jpg`);
  }
  async function downloadAll() {
    await loadScript(JSZIP_URL);
    const zip = new window.JSZip();
    imgs.forEach((img, i) => zip.file(`${safeName(live.name)}_${i + 1}.jpg`, dataUrlBase64(img.dataUrl), { base64: true }));
    downloadBlob(await zip.generateAsync({ type: 'blob' }), `${safeName(live.name)}_bilder.zip`);
  }

  if (!saved) return html`<p class="muted">Lagre først for å legge til bilder.</p>`;
  return html`<div>
    <div class="row" style="margin-bottom:10px">
      <button class="btn small" disabled=${busy} onClick=${() => camRef.current.click()}>📷 Ta bilde</button>
      <button class="btn small" disabled=${busy} onClick=${() => fileRef.current.click()}>🖼️ Velg filer</button>
      ${imgs?.length > 0 && html`<button class="btn small" onClick=${downloadAll}>⬇ Last ned alle (${imgs.length})</button>`}
      ${busy && html`<span class="muted small">Komprimerer …</span>`}
    </div>
    <input ref=${camRef} type="file" accept="image/*" capture="environment" hidden onChange=${e => { add([...e.target.files]); e.target.value = ''; }}/>
    <input ref=${fileRef} type="file" accept="image/*" multiple hidden onChange=${e => { add([...e.target.files]); e.target.value = ''; }}/>
    ${imgs === null ? html`<p class="muted">Henter bilder …</p>` : imgs.length === 0 ? html`<p class="muted small">Ingen bilder ennå.</p>` : html`
      <div class="gallery">${imgs.map((img, i) => html`<div class="g" key=${img.id} onClick=${() => setView({ img, i })}>
        <img src=${img.dataUrl} alt="" loading="lazy"/></div>`)}</div>`}
    ${view && html`<${Modal} title=${`Bilde ${view.i + 1} av ${imgs.length}`} onClose=${() => setView(null)} wide>
      <div class="viewer"><img src=${view.img.dataUrl} alt=""/></div>
      <p class="muted small">${view.img.w}×${view.img.h} px · ${fmt(view.img.dataUrl.length * 0.75 / 1024, 0)} kB</p>
      <div class="modal-foot">
        <button class="btn danger" onClick=${() => remove(view.img)}>Slett</button>
        <button class="btn" onClick=${() => primary(view.img)}>Sett som hovedbilde</button>
        <button class="btn primary" onClick=${() => downloadOne(view.img, view.i)}>⬇ Last ned</button>
      </div>
    <//>`}
  </div>`;
}

/* ---------- Lagerjustering ---------- */
export function StockDialog({ c, item, onClose, initialMode }) {
  const live = S.get(c, item.id) || item;
  const isMat = c === 'materials', isProd = c === 'products', isPkg = c === 'packages';
  const modes = isPkg
    ? [['pack', 'Pakk til lager'], ['sellStock', 'Selg ferdigpakket'], ['sellDirect', 'Selg (plukk deler)'], ['in', 'Inn +'], ['out', 'Ut −'], ['count', 'Telling']]
    : isProd ? [['print', 'Registrer print'], ['in', 'Inn +'], ['out', 'Ut −'], ['count', 'Telling']]
      : [['in', 'Inn +'], ['out', 'Ut −'], ['count', 'Telling']];
  const spool = num(live.spoolKg) * 1000 || 1000;
  const [mode, setMode] = useState(initialMode || modes[0][0]);
  const [qty, setQty] = useState(isMat ? spool : 1);
  const [note, setNote] = useState('');
  const reasons = mode === 'in' ? ['Varemottak', 'Produsert', 'Retur', 'Korrigering'] : mode === 'out' ? ['Salg', 'Brukt i produksjon', 'Svinn', 'Korrigering'] : [];
  const [reason, setReason] = useState(reasons[0] || '');
  const cur = stockOf(c, live), unit = unitOf(c, live);

  function changeMode(m) {
    setMode(m);
    setQty(m === 'count' ? cur : (isMat ? spool : 1));
    setReason(m === 'in' ? 'Varemottak' : m === 'out' ? 'Salg' : '');
  }
  // Behov av komponenter for valgt handling
  let needs = [];
  if (mode === 'pack' || mode === 'sellDirect') {
    needs = componentEntries(live, num(qty)).map(e => ({ ...e, item: S.get(e.c, e.id) }));
  } else if (mode === 'print') {
    const n = printNeeds(live, num(qty));
    if (n.materialId) needs = [{ c: 'materials', id: n.materialId, delta: -n.grams, item: S.get('materials', n.materialId) }];
  }
  const q = num(qty);
  async function submit() {
    if (mode !== 'count' && q <= 0) return toast('Angi et antall større enn 0', 'err');
    if (mode === 'sellStock' && q > cur && !confirm(`Det er bare ${fmt(cur)} ferdigpakket på lager. Fortsette likevel?`)) return;
    const short = needs.filter(n => n.item && stockOf(n.c, n.item) + n.delta < 0);
    if (short.length && !confirm(`For lite på lager av: ${short.map(s => s.item.name).join(', ')}.\nLageret blir negativt. Fortsette?`)) return;
    switch (mode) {
      case 'in': await moveStock([{ c, id: live.id, delta: q }], reason, note); break;
      case 'out': await moveStock([{ c, id: live.id, delta: -q }], reason, note); break;
      case 'count': await setCount(c, live.id, q, note); break;
      case 'print': await registerPrint(live, q, note); break;
      case 'pack': await packPackage(live, q, note); break;
      case 'sellStock': await moveStock([{ c, id: live.id, delta: -q }], 'Salg', note); break;
      case 'sellDirect': await sellPackageDirect(live, q, note); break;
    }
    toast('Lager oppdatert');
    onClose();
  }
  const qtyLabel = mode === 'count' ? `Ny beholdning (${unit})` : isMat ? 'Mengde (g)' : `Antall (${isPkg || isProd ? 'stk' : unit})`;
  return html`<${Modal} title=${'Lager: ' + live.name} onClose=${onClose}>
    <p>Nå på lager: <b>${fmt(cur, 2)} ${unit}</b>${isPkg ? ' ferdigpakket' : ''}</p>
    <div style="margin-bottom:12px"><${Seg} value=${mode} options=${modes} onChange=${changeMode}/></div>
    <div class="form-grid">
      <label class="field"><span>${qtyLabel}</span><${NumInput} value=${qty} onChange=${setQty} autofocus/></label>
      ${reasons.length > 0 && html`<label class="field"><span>Årsak</span><select value=${reason} onChange=${e => setReason(e.target.value)}>${reasons.map(r => html`<option value=${r} selected=${r === reason}>${r}</option>`)}</select></label>`}
      <label class="field wide"><span>Notat (valgfritt)</span><input value=${note} onInput=${e => setNote(e.target.value)} placeholder="F.eks. ordrenummer eller kunde"/></label>
    </div>
    ${isMat && mode !== 'count' && html`<div class="row" style="margin-top:8px">
      ${[0.25, 0.5, 1, 2].map(k => html`<button class="btn small" onClick=${() => setQty(spool * k)}>${k === 1 ? '1 spole' : k + ' spole'} (${fmt(spool * k, 0)} g)</button>`)}</div>`}
    ${needs.length > 0 && html`<div style="margin-top:14px">
      <h4>${mode === 'print' ? 'Trekkes fra filamentlager' : 'Plukkes fra lager'}</h4>
      <table><tbody>${needs.map(n => {
        const have = stockOf(n.c, n.item), after = have + n.delta;
        return html`<tr><td>${n.item?.name || '(slettet)'} <span class="muted small">${TYPE_LABEL[n.c]}</span></td>
          <td class="num">${fmt(-n.delta, 2)} ${unitOf(n.c, n.item)}</td>
          <td class=${'num ' + (after < 0 ? 'neg' : 'muted')}>${after < 0 ? 'mangler ' + fmt(-after, 2) : 'igjen ' + fmt(after, 2)}</td></tr>`;
      })}</tbody></table></div>`}
    ${mode === 'print' && !needs.length && html`<p class="muted small">Ingen filament valgt på produktet – kun produktlageret økes.</p>`}
    <div class="modal-foot"><button class="btn" onClick=${onClose}>Avbryt</button><button class="btn primary" onClick=${submit}>Bekreft</button></div>
  <//>`;
}
