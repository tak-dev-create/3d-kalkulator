import { html, useState, useRef, useEffect } from '../lib.js';
import * as S from '../store.js';
import { fmt, num } from '../util.js';
import {
  findByBarcode, moveStock, registerPrint, packPackage, sellPackageDirect, stockOf, unitOf, byName,
  TYPE_LABEL, TYPE_ROUTE, TYPE_ICON, STOCK_COLLS,
} from '../model.js';
import { PageHead, Seg, NumInput, ScannerModal, StockDialog, Thumb, StockBadge, toast, go, setDraft } from '../components.js';

const MODES = [['lookup', '🔍 Slå opp'], ['in', '➕ Inn'], ['out', '➖ Ut / salg']];

export function Scan() {
  const [mode, setMode] = useState('lookup');
  const [qty, setQty] = useState(1);
  const [cam, setCam] = useState(false);
  const [code, setCode] = useState('');
  const [current, setCurrent] = useState(null);
  const [log, setLog] = useState([]);
  const [dlg, setDlg] = useState(false);
  const inputRef = useRef();
  const modeRef = useRef(mode), qtyRef = useRef(qty);
  modeRef.current = mode; qtyRef.current = qty;
  useEffect(() => { inputRef.current?.focus(); }, []);

  async function handle(raw) {
    const c = String(raw || '').trim();
    if (!c) return;
    const f = findByBarcode(c);
    const m = modeRef.current, q = num(qtyRef.current) || 1;
    if (!f) { setCurrent({ code: c, notFound: true }); setCam(false); return; }
    setCurrent({ code: c, ...f });
    if (m === 'lookup') return;
    const { c: coll, item } = f;
    let text = '';
    if (m === 'in') {
      if (coll === 'products') { await registerPrint(item, q, 'Skann'); text = `+${fmt(q)} stk (print, filament trukket)`; }
      else if (coll === 'packages') { await packPackage(item, q, 'Skann'); text = `+${fmt(q)} pakket (deler plukket)`; }
      else if (coll === 'materials') { const g = (num(item.spoolKg) || 1) * 1000 * q; await moveStock([{ c: coll, id: item.id, delta: g }], 'Varemottak', 'Skann'); text = `+${fmt(q)} spole (${fmt(g, 0)} g)`; }
      else { await moveStock([{ c: coll, id: item.id, delta: q }], 'Varemottak', 'Skann'); text = `+${fmt(q)} ${unitOf(coll, item)}`; }
    } else {
      if (coll === 'packages') {
        if (stockOf(coll, item) >= q) { await moveStock([{ c: coll, id: item.id, delta: -q }], 'Salg', 'Skann'); text = `−${fmt(q)} ferdigpakket`; }
        else { await sellPackageDirect(item, q, 'Skann'); text = `solgt ${fmt(q)} (deler plukket)`; }
      } else if (coll === 'materials') { const g = (num(item.spoolKg) || 1) * 1000 * q; await moveStock([{ c: coll, id: item.id, delta: -g }], 'Brukt i produksjon', 'Skann'); text = `−${fmt(q)} spole (${fmt(g, 0)} g)`; }
      else { await moveStock([{ c: coll, id: item.id, delta: -q }], coll === 'products' ? 'Salg' : 'Brukt i produksjon', 'Skann'); text = `−${fmt(q)} ${unitOf(coll, item)}`; }
    }
    setLog(l => [{ t: Date.now(), name: item.name, text }, ...l].slice(0, 30));
    toast(`${item.name}: ${text}`);
  }
  function submitCode(e) { e.preventDefault(); handle(code); setCode(''); }

  return html`
    <${PageHead} title="Skann"/>
    <div class="panel">
      <div class="row" style="margin-bottom:12px"><${Seg} value=${mode} options=${MODES} onChange=${setMode}/></div>
      ${mode !== 'lookup' && html`<div class="form-grid" style="margin-bottom:12px">
        <label class="field"><span>Antall per skann</span><${NumInput} value=${qty} onChange=${setQty}/></label></div>
        <p class="muted small">${mode === 'in'
          ? 'Inn: rekvisita legges til lager. Produkter registreres som printet (filament trekkes). Pakker pakkes (deler plukkes). Filament telles i hele spoler.'
          : 'Ut: rekvisita/produkter trekkes fra lager. Pakker selges fra ferdigpakket lager hvis nok, ellers plukkes delene. Filament telles i hele spoler.'}</p>`}
      <div class="row">
        <button class="btn primary" style="min-height:52px; font-size:1.05rem" onClick=${() => setCam(true)}>📷 Start kamera</button>
        <form class="grow row nowrap" style="min-width:240px" onSubmit=${submitCode}>
          <input ref=${inputRef} value=${code} onInput=${e => setCode(e.target.value)} placeholder="…eller skriv/bruk håndskanner + Enter" inputmode="numeric"/>
          <button class="btn" type="submit">OK</button>
        </form>
      </div>
    </div>

    ${current && (current.notFound ? html`<${NotFoundCard} code=${current.code} onDone=${() => setCurrent(null)}/>` : html`
      <div class="panel">
        <div class="row nowrap">
          <${Thumb} src=${current.item.thumb} icon=${TYPE_ICON[current.c]}/>
          <div class="grow"><div class="title"><b>${current.item.name}</b></div>
            <div class="muted small">${TYPE_LABEL[current.c]} · ${current.code}</div></div>
          <${StockBadge} c=${current.c} item=${S.get(current.c, current.item.id) || current.item}/>
        </div>
        <div class="row" style="margin-top:12px">
          <button class="btn primary" onClick=${() => setDlg(true)}>Juster lager</button>
          <button class="btn" onClick=${() => go(TYPE_ROUTE[current.c] + '/' + current.item.id)}>Åpne</button>
        </div>
        ${dlg && html`<${StockDialog} c=${current.c} item=${current.item} onClose=${() => setDlg(false)}/>`}
      </div>`)}

    ${log.length > 0 && html`<div class="panel"><h2>Skannet nå</h2><table><tbody>
      ${log.map(l => html`<tr><td class="muted small">${new Date(l.t).toLocaleTimeString('nb-NO')}</td><td>${l.name}</td><td class="num">${l.text}</td></tr>`)}
    </tbody></table></div>`}

    ${cam && html`<${ScannerModal} continuous=${mode !== 'lookup'} onCode=${handle} onClose=${() => setCam(false)}/>`}
  `;
}

function NotFoundCard({ code, onDone }) {
  const [type, setType] = useState('supplies');
  const [sel, setSel] = useState('');
  const opts = S.list(type).sort(byName);
  function create(c) {
    setDraft({ barcode: code });
    go(TYPE_ROUTE[c] + '/ny');
  }
  function link() {
    if (!sel) return toast('Velg en vare', 'err');
    const item = S.get(type, sel);
    if (item.barcode && !confirm(`«${item.name}» har allerede strekkode ${item.barcode}. Erstatte?`)) return;
    S.write([{ t: 'upd', c: type, id: sel, d: { barcode: code } }]);
    toast(`Strekkode knyttet til ${item.name}`);
    onDone();
  }
  return html`<div class="panel">
    <div class="notice warn">Ukjent strekkode: <b>${code}</b></div>
    <h3>Opprett ny vare med denne koden</h3>
    <div class="row">
      <button class="btn primary" onClick=${() => create('supplies')}>📦 Ny rekvisita</button>
      <button class="btn" onClick=${() => create('materials')}>🧵 Nytt filament</button>
      <button class="btn" onClick=${() => create('products')}>🧩 Nytt produkt</button>
      <button class="btn" onClick=${() => create('packages')}>🎁 Ny pakke</button>
    </div>
    <h3 style="margin-top:16px">…eller knytt til eksisterende vare</h3>
    <div class="form-grid" style="align-items:end">
      <label class="field"><span>Type</span><select value=${type} onChange=${e => { setType(e.target.value); setSel(''); }}>
        ${STOCK_COLLS.map(c => html`<option value=${c}>${TYPE_LABEL[c]}</option>`)}</select></label>
      <label class="field"><span>Vare</span><select value=${sel} onChange=${e => setSel(e.target.value)}>
        <option value="">– velg –</option>${opts.map(o => html`<option value=${o.id}>${o.name}${o.barcode ? ' (har kode)' : ''}</option>`)}</select></label>
      <div><button class="btn" onClick=${link}>Knytt strekkode</button></div>
    </div>
  </div>`;
}
