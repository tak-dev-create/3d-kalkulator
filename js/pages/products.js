import { html, useState } from '../lib.js';
import * as S from '../store.js';
import { defaults, fieldOf, SCHEMAS } from '../schema.js';
import { money, fmt, pct, hoursToHM } from '../util.js';
import { productCostOf, byName, isLow } from '../model.js';
import { Fields, PageHead, ImageGallery, Thumb, SearchBox, Empty, StockBadge, textMatch, go, refLabel } from '../components.js';
import { useEditor, NotFound, StockPanel, SaveBar } from '../crud.js';

export function Products({ parts }) {
  return parts[1] ? html`<${ProductEditor} key=${parts[1]} id=${parts[1]}/>` : html`<${ProductList}/>`;
}

function ProductList() {
  const [q, setQ] = useState('');
  const items = S.list('products').filter(p => textMatch(q, p.name, p.barcode, p.category, p.customer, p.description)).sort(byName);
  return html`
    <${PageHead} title="Produkter & kalkyle"><button class="btn primary" onClick=${() => go('produkter/ny')}>+ Ny kalkyle</button><//>
    <${SearchBox} value=${q} onInput=${setQ} placeholder="Søk på navn, kunde, kategori, strekkode …"/>
    ${items.length === 0 ? html`<${Empty} icon="🧮" title="Ingen produkter ennå">Lag en ny kalkyle for å beregne pris på et 3D-print.<//>` : html`
    <div class="cards">${items.map(p => {
      const k = productCostOf(p);
      const mat = S.get('materials', p.materialId);
      return html`<a class="item" key=${p.id} href=${'#/produkter/' + p.id}>
        <${Thumb} src=${p.thumb} icon="🧩"/>
        <div class="grow">
          <div class="title">${p.name} ${isLow('products', p) && html`<span class="badge warn">Lavt lager</span>`}</div>
          <div class="muted small">${[mat && refLabel('materials', mat), p.grams ? fmt(p.grams, 0) + ' g' : '', p.printTime, p.customer].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="metric hide-sm"><div>${money(k.unitCost)}</div><div class="muted">selvkost</div></div>
        <div class="metric"><div>${k.quoted ? money(k.quoted) : money(k.suggested)}</div><div class="muted">${k.quoted ? 'salgspris' : 'foreslått'}</div></div>
        <div class="metric hide-sm"><${StockBadge} c="products" item=${p}/></div>
      </a>`;
    })}</div>`}`;
}

const F = keys => keys.map(k => fieldOf('products', k));
const GROUPS = [
  ['Produkt', F(['name', 'barcode', 'category', 'customer', 'date', 'description'])],
  ['Print', F(['printerId', 'materialId', 'grams', 'printTime', 'unitsPerPrint'])],
  ['Forberedelser', F(['cadMin', 'fileMin', 'matChangeMin', 'transferMin'])],
  ['Etterarbeid', F(['removeMin', 'supportMin', 'packMin'])],
  ['Diverse kostnader', F(['consumables', 'designCost'])],
  ['Pris', F(['markup', 'quotedPrice'])],
  ['Lager', F(['stock', 'lowStock', 'location', 'notes'])],
];

function ProductEditor({ id }) {
  const ed = useEditor('products', id, 'produkter', () => {
    const s = S.settings();
    const printers = S.list('printers').sort(byName), mats = S.list('materials').sort(byName);
    return defaults('products', { markup: s.defaultMarkup, printerId: printers[0]?.id || '', materialId: mats[0]?.id || '', date: new Date().toISOString().slice(0, 10) });
  });
  if (!ed.isNew && !ed.existing) return html`<${NotFound} back="produkter"/>`;
  const p = ed.d;
  const k = productCostOf(p);
  const s = S.settings();
  return html`
    <${PageHead} title=${ed.saved ? p.name || 'Produkt' : 'Ny kalkyle'} back="produkter"/>
    <div class="editor">
      <div>
        ${GROUPS.map(([title, fields]) => {
          const fl = fields.filter(f => !(f.stock && ed.saved));
          let extra = null;
          if (title === 'Forberedelser') extra = html`<p class="muted small" style="margin:8px 0 0">Sum: ${fmt(k.prepMin, 1)} min</p>`;
          if (title === 'Etterarbeid') extra = html`<p class="muted small" style="margin:8px 0 0">Sum: ${fmt(k.postMin, 1)} min</p>`;
          if (title === 'Pris') extra = html`<div class="row" style="margin-top:8px">
            <button class="btn small" onClick=${() => ed.setD(o => ({ ...o, quotedPrice: Math.ceil(k.suggested) }))}>Bruk foreslått pris (${money(Math.ceil(k.suggested))})</button></div>`;
          return html`<div class="panel" key=${title}><h2>${title}</h2><${Fields} fields=${fl} value=${p} set=${ed.setD}/>${extra}</div>`;
        })}
        <div class="panel"><h2>Bilder</h2><${ImageGallery} c="products" item=${p} saved=${ed.saved}/></div>
        <${SaveBar} ed=${ed}/>
      </div>
      <div class="aside">
        <${CostPanel} k=${k} s=${s}/>
        <${StockPanel} c="products" ed=${ed}/>
      </div>
    </div>`;
}

export function CostPanel({ k, s }) {
  const L = k.lines;
  return html`<div class="panel">
    <h2>Kalkyle</h2>
    ${(k.missing.printer || k.missing.material) && html`<div class="notice warn small">Velg ${k.missing.printer ? 'printer' : ''}${k.missing.printer && k.missing.material ? ' og ' : ''}${k.missing.material ? 'filament' : ''} for full beregning.</div>`}
    <table class="calc"><tbody>
      <tr class="sub"><td>Filament</td><td class="num">${fmt(k.grams, 1)} g · ${fmt(k.lengthM, 1)} m</td></tr>
      <tr class="sub"><td>Printtid</td><td class="num">${hoursToHM(k.hours)} (${fmt(k.hours, 2)} t)</td></tr>
      <tr><td>Design (ekstern)</td><td class="num">${money(L.design)}</td></tr>
      <tr><td>Filament</td><td class="num">${money(L.filament)}</td></tr>
      <tr><td>Strøm</td><td class="num">${money(L.energy)}</td></tr>
      <tr><td>Printerslitasje</td><td class="num">${money(L.wear)}</td></tr>
      <tr><td>Forberedelser <span class="muted small">${fmt(k.prepMin, 0)} min</span></td><td class="num">${money(L.prep)}</td></tr>
      <tr><td>Etterarbeid <span class="muted small">${fmt(k.postMin, 0)} min</span></td><td class="num">${money(L.post)}</td></tr>
      <tr><td>Forbruksartikler</td><td class="num">${money(L.consumables)}</td></tr>
      <tr class="sum"><td>Subtotal</td><td class="num">${money(k.subtotal)}</td></tr>
      <tr><td>Inkl. kvalitetstap (${fmt(s.failureRate, 1)} %)</td><td class="num">${money(k.withLoss)}</td></tr>
      ${k.units > 1 && html`<tr><td>Selvkost per stk (÷ ${k.units})</td><td class="num">${money(k.unitCost)}</td></tr>`}
      <tr><td>Påslag</td><td class="num">× ${fmt(k.markup, 2)}</td></tr>
      <tr class="hl"><td>Foreslått pris${k.units > 1 ? ' per stk' : ''}</td><td class="num">${money(k.suggested)}</td></tr>
      <tr><td>Salgspris${s.vatRate ? ' (inkl. MVA)' : ''}</td><td class="num">${k.quoted ? money(k.quoted) : '–'}</td></tr>
      ${s.vatRate > 0 && k.quoted > 0 && html`<tr class="sub"><td>Eks. MVA (${fmt(s.vatRate)} %)</td><td class="num">${money(k.net)}</td></tr>`}
      <tr class="sum"><td>Fortjeneste per stk</td><td class=${'num ' + (k.profit == null ? '' : k.profit >= 0 ? 'pos' : 'neg')}>${k.profit == null ? '–' : money(k.profit)}</td></tr>
      <tr class="sub"><td>Margin</td><td class="num">${pct(k.margin)}</td></tr>
    </tbody></table>
    ${s.laborCost === 0 && html`<p class="muted small" style="margin-bottom:0">Timepris for arbeid er 0 kr – endre under Innstillinger om arbeidstid skal prises.</p>`}
  </div>`;
}

export { SCHEMAS };
