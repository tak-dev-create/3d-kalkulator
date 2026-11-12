// Rekvisita + Filament & printere
import { html, useState } from '../lib.js';
import * as S from '../store.js';
import { money, fmt } from '../util.js';
import { byName, isLow, usedInPackages } from '../model.js';
import { printerDepreciation, materialPricePerKg, lengthPerRoll } from '../calc.js';
import { PageHead, Thumb, SearchBox, Empty, StockBadge, Seg, textMatch, go } from '../components.js';
import { CrudEditor } from '../crud.js';

export function Supplies({ parts }) {
  if (parts[1]) return html`<${CrudEditor} key=${parts[1]} c="supplies" id=${parts[1]} back="rekvisita" aside=${d => html`<div class="panel">
    <h2>Brukes i pakker</h2>${usedInPackages('supplies', d.id).map(p => html`<div><a href=${'#/pakker/' + p.id}>${p.name}</a></div>`)}
    ${usedInPackages('supplies', d.id).length === 0 && html`<p class="muted small">Ikke i bruk i noen pakke.</p>`}</div>`}/>`;
  return html`<${SupplyList}/>`;
}

function SupplyList() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const all = S.list('supplies');
  const cats = [...new Set(all.map(s => s.category).filter(Boolean))].sort();
  const items = all.filter(s => (!cat || s.category === cat) && textMatch(q, s.name, s.barcode, s.category, s.supplier, s.location)).sort(byName);
  return html`
    <${PageHead} title="Rekvisita"><button class="btn primary" onClick=${() => go('rekvisita/ny')}>+ Ny rekvisita</button><//>
    <p class="muted">Emballasje, korkplater, poser, magneter, skruer og annet som inngår i produkter og pakker.</p>
    <div class="row" style="margin-bottom:12px">
      <div class="grow" style="min-width:220px"><${SearchBox} value=${q} onInput=${setQ}/></div>
      ${cats.length > 0 && html`<select style="width:auto; margin-bottom:12px" value=${cat} onChange=${e => setCat(e.target.value)}>
        <option value="">Alle kategorier</option>${cats.map(c => html`<option>${c}</option>`)}</select>`}
    </div>
    ${items.length === 0 ? html`<${Empty} icon="📦" title="Ingen rekvisita">Legg til varer manuelt eller skann en strekkode.<//>` : html`
    <div class="cards">${items.map(s => html`<a class="item" key=${s.id} href=${'#/rekvisita/' + s.id}>
      <${Thumb} src=${s.thumb} icon="📦"/>
      <div class="grow"><div class="title">${s.name} ${isLow('supplies', s) && html`<span class="badge warn">Lavt lager</span>`}</div>
        <div class="muted small">${[s.category, s.supplier, s.location, s.barcode].filter(Boolean).join(' · ')}</div></div>
      <div class="metric hide-sm"><div>${money(s.unitCost)}</div><div class="muted">per ${s.unit || 'stk'}</div></div>
      <div class="metric"><${StockBadge} c="supplies" item=${s}/></div>
    </a>`)}</div>`}`;
}

export function Equipment({ parts }) {
  const tab = parts[1] === 'printere' ? 'printere' : 'filament';
  if (parts[2]) {
    return tab === 'printere'
      ? html`<${CrudEditor} key=${parts[2]} c="printers" id=${parts[2]} back="utstyr/printere" aside=${d => html`<div class="panel"><h2>Beregnet</h2>
          <p>Avskrivning: <b>${money(printerDepreciation(d))}</b> per time</p><p class="muted small">(Innkjøpspris + servicekost) ÷ levetid</p></div>`}/>`
      : html`<${CrudEditor} key=${parts[2]} c="materials" id=${parts[2]} back="utstyr/filament" aside=${d => html`<div class="panel"><h2>Beregnet</h2>
          <p>Pris per kg: <b>${money(materialPricePerKg(d))}</b></p><p>Lengde per spole: <b>${fmt(lengthPerRoll(d), 1)} m</b></p></div>`}/>`;
  }
  return html`
    <${PageHead} title="Filament & printere">
      <button class="btn primary" onClick=${() => go(`utstyr/${tab}/ny`)}>+ Ny ${tab === 'printere' ? 'printer' : 'filament'}</button><//>
    <div class="tabs"><${Seg} value=${tab} options=${[['filament', '🧵 Filament'], ['printere', '🖨️ Printere']]} onChange=${t => go('utstyr/' + t)}/></div>
    ${tab === 'filament' ? html`<${MaterialList}/>` : html`<${PrinterList}/>`}`;
}

function MaterialList() {
  const items = S.list('materials').sort(byName);
  if (!items.length) return html`<${Empty} icon="🧵" title="Ingen filament registrert">Legg til filamenttyper med spolepris og tetthet.<//>`;
  return html`<div class="cards">${items.map(m => html`<a class="item" key=${m.id} href=${'#/utstyr/filament/' + m.id}>
    <${Thumb} src=${m.thumb} icon="🧵"/>
    <div class="grow"><div class="title">${m.name} ${isLow('materials', m) && html`<span class="badge warn">Lavt lager</span>`}</div>
      <div class="muted small">${[m.material, m.color, `${fmt(m.diameter)} mm`, `${fmt(m.spoolKg)} kg spole`].filter(Boolean).join(' · ')}</div></div>
    <div class="metric hide-sm"><div>${money(materialPricePerKg(m))}</div><div class="muted">per kg</div></div>
    <div class="metric"><${StockBadge} c="materials" item=${m}/></div>
  </a>`)}</div>`;
}

function PrinterList() {
  const items = S.list('printers').sort(byName);
  if (!items.length) return html`<${Empty} icon="🖨️" title="Ingen printere registrert"><//>`;
  return html`<div class="panel table-wrap"><table>
    <thead><tr><th>Navn</th><th class="num">Innkjøp</th><th class="num">Levetid</th><th class="num">Strøm</th><th class="num">Avskrivning/t</th></tr></thead>
    <tbody>${items.map(p => html`<tr class="click" key=${p.id} onClick=${() => go('utstyr/printere/' + p.id)}>
      <td><b>${p.name}</b></td><td class="num">${money(p.price)}</td><td class="num">${fmt(p.deprecTime, 0)} t</td>
      <td class="num">${fmt(p.energy)} kWh/t</td><td class="num">${money(printerDepreciation(p))}</td></tr>`)}</tbody>
  </table></div>`;
}
