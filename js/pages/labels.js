import { html, render, useState } from '../lib.js';
import * as S from '../store.js';
import { money, num, generateEan, lsGet, lsSet } from '../util.js';
import { allBarcodes, byName, TYPE_LABEL, STOCK_COLLS, productCostOf, packageCostOf } from '../model.js';
import { PageHead, NumInput, SearchBox, useScript, barcodeSvg, JSBARCODE_URL, textMatch, toast } from '../components.js';

// Vanlige A4-etikettark (mål i mm). Kan finjusteres under "Egendefinert".
const PRESETS = {
  '3x7': { name: 'A4 3×7 – 70 × 42,3 mm', cols: 3, rows: 7, w: 70, h: 42.3, top: 0, left: 0, gx: 0, gy: 0 },
  '3x8': { name: 'A4 3×8 – 70 × 37 mm', cols: 3, rows: 8, w: 70, h: 37, top: 0.5, left: 0, gx: 0, gy: 0 },
  '3x10': { name: 'A4 3×10 – 70 × 29,7 mm', cols: 3, rows: 10, w: 70, h: 29.7, top: 0, left: 0, gx: 0, gy: 0 },
  '2x8': { name: 'A4 2×8 – 105 × 37 mm', cols: 2, rows: 8, w: 105, h: 37, top: 0.5, left: 0, gx: 0, gy: 0 },
  '4x12': { name: 'A4 4×12 – 45,7 × 21,2 mm', cols: 4, rows: 12, w: 45.7, h: 21.2, top: 21.5, left: 9.7, gx: 2.6, gy: 0 },
  '5x13': { name: 'A4 5×13 – 38,1 × 21,2 mm', cols: 5, rows: 13, w: 38.1, h: 21.2, top: 10.7, left: 4.7, gx: 2.5, gy: 0 },
};
const DEFAULT = { preset: '3x7', ...PRESETS['3x7'], showName: true, showPrice: true, showCompany: false, start: 1 };

function priceOf(c, item) {
  if (c === 'products') return num(item.quotedPrice) || productCostOf(item).suggested;
  if (c === 'packages') return num(item.quotedPrice) || packageCostOf(item).suggested;
  return null;
}

export function Labels() {
  const ready = useScript(JSBARCODE_URL);
  const [cfg, setCfgRaw] = useState(() => ({ ...DEFAULT, ...lsGet('labelCfg', {}) }));
  const setCfg = patch => setCfgRaw(o => { const n = { ...o, ...patch }; lsSet('labelCfg', n); return n; });
  const [type, setType] = useState('products');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState({}); // key "c|id" -> antall
  const items = (type === 'all' ? STOCK_COLLS.flatMap(c => S.list(c).map(i => ({ c, i }))) : S.list(type).map(i => ({ c: type, i })))
    .filter(({ i }) => textMatch(q, i.name, i.barcode)).sort((a, b) => byName(a.i, b.i));

  const chosen = Object.entries(sel).filter(([, n]) => n > 0).map(([k, n]) => {
    const [c, id] = k.split('|');
    return { c, item: S.get(c, id), n };
  }).filter(x => x.item);
  const labels = [];
  for (let i = 1; i < Math.max(1, cfg.start); i++) labels.push(null);
  for (const x of chosen) for (let i = 0; i < x.n; i++) labels.push(x);
  const perPage = cfg.cols * cfg.rows;
  const pages = [];
  for (let i = 0; i < labels.length; i += perPage) pages.push(labels.slice(i, i + perPage));
  const missing = chosen.filter(x => !x.item.barcode);

  function genMissing() {
    const used = allBarcodes();
    const ops = missing.map(x => { const code = generateEan(used); used.add(code); return { t: 'upd', c: x.c, id: x.item.id, d: { barcode: code } }; });
    S.write(ops);
    toast(`Laget ${ops.length} strekkode(r)`);
  }
  function doPrint() {
    if (!chosen.length) return toast('Velg minst én vare', 'err');
    const root = document.getElementById('print-root');
    render(html`<${Sheets} pages=${pages} cfg=${cfg}/>`, root);
    setTimeout(() => { window.print(); }, 150);
  }
  const toggle = (k, v) => setSel(o => ({ ...o, [k]: v }));
  const s = S.settings();

  return html`
    <${PageHead} title="Etiketter"><button class="btn primary" onClick=${doPrint} disabled=${!ready}>🖨️ Skriv ut</button><//>
    <div class="editor">
      <div>
        <div class="panel">
          <h2>1. Velg varer</h2>
          <div class="row" style="margin-bottom:8px">
            <select style="width:auto" value=${type} onChange=${e => setType(e.target.value)}>
              ${STOCK_COLLS.map(c => html`<option value=${c}>${TYPE_LABEL[c]}</option>`)}<option value="all">Alle typer</option></select>
            <div class="grow"><${SearchBox} value=${q} onInput=${setQ}/></div>
          </div>
          <div class="table-wrap"><table><thead><tr><th></th><th>Vare</th><th>Strekkode</th><th class="num">Antall</th></tr></thead><tbody>
            ${items.map(({ c, i }) => {
              const k = c + '|' + i.id, n = sel[k] || 0;
              return html`<tr key=${k}>
                <td><input type="checkbox" checked=${n > 0} onChange=${e => toggle(k, e.target.checked ? 1 : 0)}/></td>
                <td>${i.name}${type === 'all' ? html` <span class="muted small">${TYPE_LABEL[c]}</span>` : ''}</td>
                <td class="small ${i.barcode ? '' : 'muted'}">${i.barcode || 'mangler'}</td>
                <td class="num" style="width:90px"><${NumInput} int value=${n} onChange=${v => toggle(k, Math.max(0, v))}/></td></tr>`;
            })}
          </tbody></table></div>
          ${missing.length > 0 && html`<div class="notice warn" style="margin-top:12px">${missing.length} valgt(e) vare(r) mangler strekkode.
            <button class="btn small" style="margin-left:8px" onClick=${genMissing}>Lag interne EAN-koder</button></div>`}
        </div>
      </div>
      <div class="aside">
        <div class="panel">
          <h2>2. Etikettark</h2>
          <label class="field"><span>Format</span><select value=${cfg.preset} onChange=${e => setCfg(e.target.value === 'custom' ? { preset: 'custom' } : { preset: e.target.value, ...PRESETS[e.target.value] })}>
            ${Object.entries(PRESETS).map(([k, p]) => html`<option value=${k}>${p.name}</option>`)}<option value="custom">Egendefinert</option></select></label>
          <div class="form-grid" style="grid-template-columns:1fr 1fr; margin-top:10px">
            ${[['cols', 'Kolonner'], ['rows', 'Rader'], ['w', 'Bredde mm'], ['h', 'Høyde mm'], ['top', 'Toppmarg mm'], ['left', 'Venstremarg mm'], ['gx', 'Mellomrom vannrett'], ['gy', 'Mellomrom loddrett']].map(([k, l]) => html`
              <label class="field"><span>${l}</span><${NumInput} value=${cfg[k]} onChange=${v => setCfg({ [k]: v, preset: 'custom' })}/></label>`)}
            <label class="field"><span>Start på etikett nr.</span><${NumInput} int value=${cfg.start} onChange=${v => setCfg({ start: Math.max(1, v) })}/></label>
          </div>
          <div style="margin-top:10px">
            <label class="row"><input type="checkbox" checked=${cfg.showName} onChange=${e => setCfg({ showName: e.target.checked })}/> Vis navn</label>
            <label class="row"><input type="checkbox" checked=${cfg.showPrice} onChange=${e => setCfg({ showPrice: e.target.checked })}/> Vis pris (produkter/pakker)</label>
            <label class="row"><input type="checkbox" checked=${cfg.showCompany} onChange=${e => setCfg({ showCompany: e.target.checked })}/> Vis firmanavn${s.companyName ? ` (${s.companyName})` : ''}</label>
          </div>
          <p class="muted small">Tips: skriv ut en testside på vanlig papir og hold den mot etikettarket. Velg «Faktisk størrelse / 100 %» i utskriftsdialogen.</p>
        </div>
      </div>
    </div>
    <div class="panel">
      <h2>Forhåndsvisning (${labels.length - (cfg.start - 1)} etiketter, ${pages.length} ark)</h2>
      ${!ready ? html`<p class="muted">Laster strekkodemotor …</p>` : pages.length === 0 ? html`<p class="muted">Velg varer for å se forhåndsvisning.</p>` : html`
        <div class="label-preview"><div style="zoom:0.6"><${Sheets} pages=${pages.slice(0, 2)} cfg=${cfg}/></div>
        ${pages.length > 2 && html`<p class="muted small">+ ${pages.length - 2} ark til</p>`}</div>`}
    </div>`;
}

function Sheets({ pages, cfg }) {
  const s = S.settings();
  const style = `grid-template-columns: repeat(${cfg.cols}, ${cfg.w}mm); grid-auto-rows: ${cfg.h}mm; column-gap: ${cfg.gx}mm; row-gap: ${cfg.gy}mm; padding: ${cfg.top}mm 0 0 ${cfg.left}mm;`;
  const bcH = Math.max(18, Math.min(60, cfg.h * 1.6));
  return html`${pages.map((pg, pi) => html`<div class="sheet" key=${pi} style=${style}>
    ${pg.map((x, i) => {
      if (!x) return html`<div class="lbl" key=${i}></div>`;
      const price = cfg.showPrice ? priceOf(x.c, x.item) : null;
      return html`<div class="lbl" key=${i}>
        ${cfg.showCompany && s.companyName && html`<div class="lc">${s.companyName}</div>`}
        ${cfg.showName && html`<div class="ln">${x.item.name}</div>`}
        ${price != null && price > 0 && html`<div class="lp">${money(Math.ceil(price))}</div>`}
        ${x.item.barcode ? html`<div class="bc" dangerouslySetInnerHTML=${{ __html: barcodeSvg(x.item.barcode, bcH) }}></div>` : html`<div class="lc">(mangler strekkode)</div>`}
      </div>`;
    })}</div>`)}`;
}
