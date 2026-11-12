import { html, useState } from '../lib.js';
import * as S from '../store.js';
import { defaults, fieldOf } from '../schema.js';
import { money, fmt, pct, num } from '../util.js';
import { packageCostOf, packagesPossible, byName, findByBarcode, stockOf, unitOf, isLow, TYPE_LABEL } from '../model.js';
import { Fields, PageHead, ImageGallery, Thumb, SearchBox, Empty, StockBadge, NumInput, ScannerModal, textMatch, toast, go, ProfitSummary } from '../components.js';
import { useEditor, NotFound, StockPanel, SaveBar } from '../crud.js';

export function Packages({ parts }) {
  return parts[1] ? html`<${PackageEditor} key=${parts[1]} id=${parts[1]}/>` : html`<${PackageList}/>`;
}

function PackageList() {
  const [q, setQ] = useState('');
  const items = S.list('packages').filter(p => textMatch(q, p.name, p.barcode, p.category, p.description)).sort(byName);
  const s = S.settings();
  const costs = new Map(items.map(p => [p.id, packageCostOf(p)]));
  const rows = items.map(p => {
    const k = costs.get(p.id);
    const price = k.quoted > 0 ? k.net : k.suggested;
    return { stock: p.stock, cost: k.cost, price, profit: price - k.cost };
  });
  return html`
    <${PageHead} title="Pakker"><button class="btn primary" onClick=${() => go('pakker/ny')}>+ Ny pakke</button><//>
    <p class="muted">En pakke er en samling produkter og rekvisita, f.eks. 3 coastere + 3 korkplater + 1 pose. Pris = selvkost × påslag.</p>
    <${SearchBox} value=${q} onInput=${setQ}/>
    ${items.length > 0 && html`<${ProfitSummary} rows=${rows} count=${items.length}/>
      <p class="muted small" style="margin-top:-6px">Lagersummer gjelder ferdigpakkede pakker og bruker salgspris${s.vatRate ? ' eks. MVA' : ''}, eller foreslått pris der salgspris mangler. Linjene viser fortjeneste per pakke (* = beregnet fra foreslått pris).</p>`}
    ${items.length === 0 ? html`<${Empty} icon="🎁" title="Ingen pakker ennå">Lag en pakke for å beregne pris på et sett av produkter og rekvisita.<//>` : html`
    <div class="cards">${items.map(p => {
      const k = costs.get(p.id);
      const pr = k.profit ?? (k.suggested - k.cost);
      const can = packagesPossible(p);
      return html`<a class="item" key=${p.id} href=${'#/pakker/' + p.id}>
        <${Thumb} src=${p.thumb} icon="🎁"/>
        <div class="grow">
          <div class="title">${p.name} ${isLow('packages', p) && html`<span class="badge warn">Lavt lager</span>`}</div>
          <div class="muted small">${(p.items || []).length} varelinjer · kan lages: ${fmt(can, 0)}</div>
        </div>
        <div class="metric hide-sm"><div>${money(k.cost)}</div><div class="muted">selvkost</div></div>
        <div class="metric"><div>${k.quoted ? money(k.quoted) : money(k.suggested)}</div><div class="muted">${k.quoted ? 'salgspris' : 'foreslått'}</div></div>
        <div class="metric"><div class=${pr < 0 ? 'neg' : 'pos'}>${money(pr)}</div><div class="muted">fortjeneste${k.quoted ? '' : '*'}</div></div>
        <div class="metric hide-sm"><${StockBadge} c="packages" item=${p}/></div>
      </a>`;
    })}</div>`}`;
}

const FIELDS = ['name', 'barcode', 'category', 'description', 'packMin', 'extraCost', 'markup', 'quotedPrice', 'stock', 'lowStock', 'location', 'notes'].map(k => fieldOf('packages', k));

function PackageEditor({ id }) {
  const ed = useEditor('packages', id, 'pakker', () => defaults('packages', { markup: S.settings().defaultMarkup, items: [] }));
  if (!ed.isNew && !ed.existing) return html`<${NotFound} back="pakker"/>`;
  const p = ed.d;
  const k = packageCostOf(p);
  const s = S.settings();
  const fields = FIELDS.filter(f => !(f.stock && ed.saved));
  return html`
    <${PageHead} title=${ed.saved ? p.name || 'Pakke' : 'Ny pakke'} back="pakker"/>
    <div class="editor">
      <div>
        <div class="panel"><h2>Pakke</h2><${Fields} fields=${fields} value=${p} set=${ed.setD}/>
          <div class="row" style="margin-top:8px"><button class="btn small" onClick=${() => ed.setD(o => ({ ...o, quotedPrice: Math.ceil(k.suggested) }))}>Bruk foreslått pris (${money(Math.ceil(k.suggested))})</button></div>
        </div>
        <div class="panel"><h2>Innhold</h2><${ItemsEditor} items=${p.items || []} onChange=${items => ed.setD(o => ({ ...o, items }))}/></div>
        <div class="panel"><h2>Bilder</h2><${ImageGallery} c="packages" item=${p} saved=${ed.saved}/></div>
        <${SaveBar} ed=${ed}/>
      </div>
      <div class="aside">
        <div class="panel">
          <h2>Kalkyle</h2>
          <table class="calc"><tbody>
            ${k.lines.map(l => html`<tr><td>${fmt(l.qty)} × ${l.name}</td><td class="num">${money(l.total)}</td></tr>`)}
            ${k.lines.length === 0 && html`<tr class="sub"><td colspan="2">Legg til produkter og rekvisita.</td></tr>`}
            <tr class="sum"><td>Komponenter</td><td class="num">${money(k.componentCost)}</td></tr>
            <tr><td>Pakking <span class="muted small">${fmt(num(p.packMin), 0)} min</span></td><td class="num">${money(k.labor)}</td></tr>
            <tr><td>Ekstra kostnad</td><td class="num">${money(k.extra)}</td></tr>
            <tr class="sum"><td>Selvkost</td><td class="num">${money(k.cost)}</td></tr>
            <tr><td>Påslag</td><td class="num">× ${fmt(k.markup, 2)}</td></tr>
            <tr class="hl"><td>Foreslått pris</td><td class="num">${money(k.suggested)}</td></tr>
            <tr class="sub"><td>Sum enkeltpriser (referanse)</td><td class="num">${money(k.listValue)}</td></tr>
            <tr><td>Salgspris</td><td class="num">${k.quoted ? money(k.quoted) : '–'}</td></tr>
            ${s.vatRate > 0 && k.quoted > 0 && html`<tr class="sub"><td>Eks. MVA</td><td class="num">${money(k.net)}</td></tr>`}
            <tr class="sum"><td>Fortjeneste</td><td class=${'num ' + (k.profit == null ? '' : k.profit >= 0 ? 'pos' : 'neg')}>${k.profit == null ? '–' : money(k.profit)}</td></tr>
            <tr class="sub"><td>Margin</td><td class="num">${pct(k.margin)}</td></tr>
          </tbody></table>
          <p class="muted small" style="margin-bottom:0">Kan lages av nåværende lager: <b>${fmt(packagesPossible(p), 0)}</b></p>
        </div>
        <${StockPanel} c="packages" ed=${ed}/>
      </div>
    </div>`;
}

function ItemsEditor({ items, onChange }) {
  const [type, setType] = useState('products');
  const [sel, setSel] = useState('');
  const [qty, setQty] = useState(1);
  const [scan, setScan] = useState(false);
  const opts = S.list(type).sort(byName);
  function add(t, id, q) {
    if (!id) return toast('Velg en vare', 'err');
    const i = items.findIndex(x => x.type === t && x.id === id);
    if (i >= 0) onChange(items.map((x, j) => (j === i ? { ...x, qty: num(x.qty) + num(q) } : x)));
    else onChange([...items, { type: t, id, qty: num(q) || 1 }]);
    setSel('');
  }
  function onScan(code) {
    const f = findByBarcode(code);
    if (!f || !['products', 'supplies'].includes(f.c)) return toast(`Fant ikke produkt/rekvisita med kode ${code}`, 'err');
    add(f.c, f.item.id, 1);
    toast(`La til ${f.item.name}`);
  }
  return html`<div>
    ${items.length > 0 && html`<div class="table-wrap"><table><thead><tr><th>Vare</th><th>Type</th><th class="num">Antall</th><th class="num">Lager</th><th></th></tr></thead><tbody>
      ${items.map((it, i) => {
        const item = S.get(it.type, it.id);
        return html`<tr key=${it.type + it.id}>
          <td>${item ? html`<a href=${'#/' + (it.type === 'products' ? 'produkter' : 'rekvisita') + '/' + it.id}>${item.name}</a>` : html`<span class="neg">(slettet vare)</span>`}</td>
          <td class="muted small">${TYPE_LABEL[it.type]}</td>
          <td class="num" style="width:110px"><${NumInput} value=${it.qty} onChange=${v => onChange(items.map((x, j) => (j === i ? { ...x, qty: v } : x)))}/></td>
          <td class="num muted">${item ? fmt(stockOf(it.type, item)) + ' ' + unitOf(it.type, item) : ''}</td>
          <td class="num"><button class="icon-btn" title="Fjern" onClick=${() => onChange(items.filter((_, j) => j !== i))}>✕</button></td>
        </tr>`;
      })}</tbody></table></div>`}
    <div class="form-grid" style="margin-top:12px; align-items:end">
      <label class="field"><span>Type</span><select value=${type} onChange=${e => { setType(e.target.value); setSel(''); }}>
        <option value="products">Produkt</option><option value="supplies">Rekvisita</option></select></label>
      <label class="field"><span>Vare</span><select value=${sel} onChange=${e => setSel(e.target.value)}>
        <option value="">– velg –</option>${opts.map(o => html`<option value=${o.id}>${o.name}</option>`)}</select></label>
      <label class="field"><span>Antall</span><${NumInput} value=${qty} onChange=${setQty}/></label>
      <div class="row nowrap"><button class="btn primary" onClick=${() => add(type, sel, qty)}>+ Legg til</button>
        <button class="btn" title="Skann for å legge til" onClick=${() => setScan(true)}>📷</button></div>
    </div>
    ${scan && html`<${ScannerModal} continuous title="Skann varer til pakken" onCode=${onScan} onClose=${() => setScan(false)}/>`}
  </div>`;
}
