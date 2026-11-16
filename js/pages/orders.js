// Bestillinger: kunde, varer (fra katalog eller fritekst), farge/variant, levering, betaling og status.
import { html, useState } from '../lib.js';
import * as S from '../store.js';
import { money, fmt, num, uid, todayISO } from '../util.js';
import { byName, stockOf, TYPE_LABEL } from '../model.js';
import {
  ORDER_STATUS, orderTotal, orderCost, orderRemaining, nextOrderNo, deliverOrder, undoDelivery,
  listPriceOf, unitCostOf, eventStockOf, dayLabel, activeEvents,
} from '../events.js';
import { PageHead, Modal, Seg, NumInput, SearchBox, Empty, toast, go, textMatch } from '../components.js';

const LINE_TYPES = [['products', 'Produkt'], ['packages', 'Pakke'], ['custom', 'Fritekst']];
const statusBadge = o => html`<span class=${'badge ' + (o.status === 'levert' ? 'ok' : o.status === 'kansellert' ? '' : 'accent')}>${ORDER_STATUS[o.status] || o.status}</span>`;
const payBadge = o => (o.status === 'kansellert' ? null : o.paid ? html`<span class="badge ok">Betalt</span>`
  : num(o.deposit) > 0 ? html`<span class="badge warn">Forskudd ${money(o.deposit)}</span>` : html`<span class="badge warn">Ikke betalt</span>`);
const overdue = o => o.status === 'ny' && o.dueDate && o.dueDate < todayISO();

export function Orders({ parts }) {
  if (parts[1]) return html`<${OrderEditor} key=${parts[1]} id=${parts[1]}/>`;
  return html`<${OrderList}/>`;
}

function OrderList() {
  const params = new URLSearchParams(location.hash.split('?')[1] || '');
  const eventFilter = params.get('messe') || '';
  const [filter, setFilter] = useState(eventFilter ? 'alle' : 'ny');
  const [q, setQ] = useState('');
  const ev = eventFilter ? S.get('events', eventFilter) : null;
  const list = S.list('orders')
    .filter(o => (filter === 'alle' || o.status === filter) && (!eventFilter || o.eventId === eventFilter))
    .filter(o => textMatch(q, o.customer, o.phone, o.email, o.address, o.notes, String(o.no), ...(o.lines || []).flatMap(l => [l.name, l.variant])))
    .sort((a, b) => (filter === 'ny'
      ? String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))
      : num(b.no) - num(a.no)));
  const open = S.list('orders').filter(o => o.status === 'ny');
  const openSum = open.reduce((a, o) => a + orderTotal(o), 0), openRemaining = open.reduce((a, o) => a + orderRemaining(o), 0);
  return html`
    <${PageHead} title="Bestillinger"><button class="btn primary" onClick=${() => go('bestillinger/ny')}>+ Ny bestilling</button><//>
    ${ev && html`<div class="notice info row"><span class="grow">Viser bestillinger knyttet til <b>${ev.name}</b>.</span><a class="btn small" href="#/bestillinger">Vis alle</a></div>`}
    <div class="grid-stats">
      <div class="stat"><div class="v">${open.length}</div><div class="l">Åpne bestillinger</div></div>
      <div class="stat"><div class="v">${money(openSum)}</div><div class="l">Verdi åpne</div></div>
      <div class="stat"><div class="v">${money(openRemaining)}</div><div class="l">Utestående betaling</div></div>
      <div class="stat"><div class="v ${open.some(overdue) ? 'neg' : ''}">${open.filter(overdue).length}</div><div class="l">Forfalt levering</div></div>
    </div>
    <div class="row" style="margin-bottom:10px">
      <${Seg} value=${filter} onChange=${setFilter} options=${[['ny', 'Åpne'], ['levert', 'Levert'], ['kansellert', 'Kansellert'], ['alle', 'Alle']]}/>
    </div>
    <${SearchBox} value=${q} onInput=${setQ} placeholder="Søk på kunde, telefon, vare, farge …"/>
    ${list.length === 0 ? html`<${Empty} icon="📝" title="Ingen bestillinger her">Registrer bestillinger på varer i andre farger eller ting som er utsolgt.<//>` : html`
    <div class="cards">${list.map(o => html`<a class="item" key=${o.id} href=${'#/bestillinger/' + o.id}>
      <div class="thumb">#${o.no}</div>
      <div class="grow">
        <div class="title">${o.customer || '(uten navn)'} ${statusBadge(o)} ${payBadge(o)}</div>
        <div class="muted small">${(o.lines || []).map(l => `${fmt(l.qty)} × ${l.name}${l.variant ? ` (${l.variant})` : ''}`).join(', ') || 'Ingen varer'}</div>
        <div class="small ${overdue(o) ? 'neg' : 'muted'}">${[o.dueDate && (overdue(o) ? 'Forfalt ' : 'Avtalt ') + dayLabel(o.dueDate), o.delivery === 'levering' ? '🚚 Levering' : '🏠 Henting', o.phone].filter(Boolean).join(' · ')}</div>
      </div>
      <div class="metric"><div>${money(orderTotal(o))}</div><div class="muted">${orderRemaining(o) > 0 ? 'rest ' + money(orderRemaining(o)) : 'sum'}</div></div>
    </a>`)}</div>`}`;
}

function newOrder() {
  return { id: uid(), no: nextOrderNo(), customer: '', phone: '', email: '', delivery: 'henting', address: '', dueDate: '', eventId: '', status: 'ny', deposit: 0, paid: false, notes: '', lines: [] };
}

function OrderEditor({ id }) {
  const isNew = id === 'ny';
  const existing = isNew ? null : S.get('orders', id);
  const [o, setO] = useState(() => (existing ? { ...existing, lines: [...(existing.lines || [])] } : newOrder()));
  const [saved, setSaved] = useState(!isNew);
  const [deliver, setDeliver] = useState(false);
  if (!isNew && !existing) return html`<${Empty} icon="🔍" title="Fant ikke bestillingen"><a href="#/bestillinger">Tilbake</a><//>`;
  const live = S.get('orders', o.id) || o;
  const set = (k, v) => setO(x => ({ ...x, [k]: v }));
  const total = orderTotal(o), cost = orderCost(o);
  const locked = live.status === 'levert';

  function save(extra = {}) {
    if (!o.customer.trim()) { toast('Skriv inn kundens navn', 'err'); return false; }
    const doc = { ...o, ...extra, customer: o.customer.trim(), updatedAt: Date.now(), updatedBy: S.userEmail() };
    delete doc.id;
    if (!saved) { doc.createdAt = Date.now(); doc.createdBy = S.userEmail(); }
    // status og leveringsfelt styres av egne knapper
    if (saved) { delete doc.status; delete doc.deliveredFrom; delete doc.deliveredAt; Object.assign(doc, extra); }
    S.write([{ t: saved ? 'upd' : 'set', c: 'orders', id: o.id, d: doc }]);
    if (!saved) history.replaceState(null, '', '#/bestillinger/' + o.id);
    setSaved(true);
    toast('Bestilling lagret');
    return true;
  }
  async function cancel() {
    if (!confirm('Kansellere bestillingen?')) return;
    if (save({ status: 'kansellert' })) setO(x => ({ ...x, status: 'kansellert' }));
  }
  async function reopen() {
    if (live.status === 'levert') {
      if (!confirm('Angre leveringen? Varene legges tilbake på lageret de ble tatt fra.')) return;
      await undoDelivery(live);
    } else S.write([{ t: 'upd', c: 'orders', id: o.id, d: { status: 'ny' } }]);
    setO(x => ({ ...x, status: 'ny' }));
    toast('Bestillingen er åpnet igjen');
  }
  function remove() {
    if (live.status === 'levert') return toast('Angre leveringen før bestillingen slettes', 'err');
    if (!confirm(`Slette bestilling #${o.no}? Dette kan ikke angres.`)) return;
    S.write([{ t: 'del', c: 'orders', id: o.id }]);
    go('bestillinger');
  }
  const tel = String(o.phone || '').replace(/[^\d+]/g, '');

  return html`
    <${PageHead} title=${`Bestilling #${o.no}`} back="bestillinger">${statusBadge(live)} ${payBadge(o)}<//>
    ${locked && html`<div class="notice info">Levert ${live.deliveredAt ? new Date(live.deliveredAt).toLocaleDateString('nb-NO') : ''}
      fra ${live.deliveredFrom === 'hus' ? 'husets lager' : S.get('events', live.deliveredFrom)?.name || 'messe'}. Varelinjene er låst – angre leveringen for å endre dem.</div>`}
    <div class="editor">
      <div>
        <div class="panel"><h2>Kunde</h2>
          <div class="form-grid">
            <label class="field wide"><span>Navn *</span><input value=${o.customer} onInput=${e => set('customer', e.target.value)}/></label>
            <label class="field"><span>Telefon</span><div class="input-group"><input type="tel" value=${o.phone} onInput=${e => set('phone', e.target.value)}/>
              ${tel && html`<a class="btn small" href=${'tel:' + tel} title="Ring">📞</a><a class="btn small" href=${'sms:' + tel} title="Send SMS">💬</a>`}</div></label>
            <label class="field"><span>E-post</span><input type="email" value=${o.email} onInput=${e => set('email', e.target.value)}/></label>
            <label class="field"><span>Levering</span><${Seg} value=${o.delivery} onChange=${v => set('delivery', v)} options=${[['henting', '🏠 Henting'], ['levering', '🚚 Levering']]}/></label>
            <label class="field"><span>Avtalt dato</span><input type="date" value=${o.dueDate} onInput=${e => set('dueDate', e.target.value)}/></label>
            ${o.delivery === 'levering' && html`<label class="field wide"><span>Leveringsadresse</span><textarea value=${o.address} onInput=${e => set('address', e.target.value)} style="min-height:60px"/></label>`}
            ${o.delivery === 'henting' && html`<label class="field wide"><span>Hentested / avtale</span><input value=${o.address} onInput=${e => set('address', e.target.value)} placeholder="F.eks. hjemme, eller på messen søndag"/></label>`}
            <label class="field wide"><span>Bestilt på messe (valgfritt)</span><select value=${o.eventId} onChange=${e => set('eventId', e.target.value)}>
              <option value="">– ingen –</option>${S.list('events').sort((a, b) => String(b.startDate).localeCompare(String(a.startDate))).map(ev => html`<option value=${ev.id}>${ev.name}</option>`)}</select></label>
            <label class="field wide"><span>Notater</span><textarea value=${o.notes} onInput=${e => set('notes', e.target.value)}/></label>
          </div>
        </div>
        <div class="panel"><h2>Varer</h2><${LinesEditor} lines=${o.lines} locked=${locked} onChange=${lines => set('lines', lines)}/></div>
        <div class="savebar">
          <button class="btn primary" onClick=${() => save()}>💾 Lagre</button>
          ${saved && live.status === 'ny' && html`<button class="btn" onClick=${() => { if (save()) setDeliver(true); }}>✔ Marker levert</button>`}
          ${saved && live.status !== 'ny' && html`<button class="btn" onClick=${reopen}>${live.status === 'levert' ? '↶ Angre levering' : 'Åpne igjen'}</button>`}
          <span class="grow"></span>
          ${saved && live.status === 'ny' && html`<button class="btn" onClick=${cancel}>Kanseller</button>`}
          ${saved && html`<button class="btn danger" onClick=${remove}>Slett</button>`}
        </div>
      </div>
      <div class="aside">
        <div class="panel"><h2>Betaling</h2>
          <table class="calc"><tbody>
            ${o.lines.map(l => html`<tr class="sub"><td>${fmt(l.qty)} × ${l.name}${l.variant ? ` (${l.variant})` : ''}</td><td class="num">${money(num(l.qty) * num(l.unitPrice))}</td></tr>`)}
            <tr class="hl"><td>Totalt</td><td class="num">${money(total)}</td></tr>
            <tr><td>Forskudd betalt</td><td class="num" style="width:110px"><${NumInput} value=${o.deposit} onChange=${v => set('deposit', v)}/></td></tr>
            <tr class="sum"><td>Gjenstår</td><td class="num">${money(o.paid ? 0 : Math.max(0, total - num(o.deposit)))}</td></tr>
            <tr class="sub"><td>Selvkost / fortjeneste</td><td class="num">${money(cost)} / ${money(total - cost)}</td></tr>
          </tbody></table>
          <label class="row" style="margin-top:10px"><input type="checkbox" checked=${!!o.paid} onChange=${e => set('paid', e.target.checked)}/> Fullt betalt</label>
          <p class="muted small" style="margin-bottom:0">Husk å lagre etter endringer.</p>
        </div>
      </div>
    </div>
    ${deliver && html`<${DeliverDialog} o=${{ ...live, ...o }} onClose=${() => setDeliver(false)}/>`}`;
}

function LinesEditor({ lines, onChange, locked }) {
  const [type, setType] = useState('products');
  const [sel, setSel] = useState('');
  const [d, setD] = useState({ name: '', variant: '', qty: 1, unitPrice: 0, unitCost: 0 });
  const opts = type === 'custom' ? [] : S.list(type).sort(byName);
  function add() {
    if (type === 'custom') {
      if (!d.name.trim()) return toast('Beskriv varen', 'err');
      onChange([...lines, { type, itemId: '', name: d.name.trim(), variant: d.variant, qty: num(d.qty) || 1, unitPrice: num(d.unitPrice), unitCost: num(d.unitCost) }]);
    } else {
      const item = S.get(type, sel);
      if (!item) return toast('Velg en vare', 'err');
      onChange([...lines, {
        type, itemId: item.id, name: item.name, variant: d.variant, qty: num(d.qty) || 1,
        unitPrice: num(d.unitPrice) || listPriceOf(type, item), unitCost: Math.round(unitCostOf(type, item) * 100) / 100,
      }]);
    }
    setSel('');
    setD({ name: '', variant: '', qty: 1, unitPrice: 0, unitCost: 0 });
  }
  const upd = (i, k, v) => onChange(lines.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  return html`<div>
    ${lines.length > 0 && html`<div class="table-wrap"><table>
      <thead><tr><th>Vare</th><th>Farge / variant</th><th class="num">Antall</th><th class="num">Pris</th><th class="num">Sum</th><th></th></tr></thead>
      <tbody>${lines.map((l, i) => html`<tr key=${i}>
        <td>${l.name}<div class="muted small">${TYPE_LABEL[l.type] || 'Fritekst'}${l.itemId ? ` · på huset: ${fmt(stockOf(l.type, S.get(l.type, l.itemId)))}` : ''}</div></td>
        <td style="min-width:120px"><input value=${l.variant || ''} disabled=${locked} onInput=${e => upd(i, 'variant', e.target.value)} placeholder="F.eks. rød"/></td>
        <td class="num" style="width:80px"><${NumInput} value=${l.qty} disabled=${locked} onChange=${v => upd(i, 'qty', v)}/></td>
        <td class="num" style="width:100px"><${NumInput} value=${l.unitPrice} disabled=${locked} onChange=${v => upd(i, 'unitPrice', v)}/></td>
        <td class="num">${money(num(l.qty) * num(l.unitPrice))}</td>
        <td>${!locked && html`<button class="icon-btn" aria-label="Fjern linje" onClick=${() => onChange(lines.filter((_, j) => j !== i))}>✕</button>`}</td>
      </tr>`)}</tbody></table></div>`}
    ${!locked && html`<div class="form-grid" style="margin-top:12px; align-items:end">
      <label class="field"><span>Type</span><select value=${type} onChange=${e => { setType(e.target.value); setSel(''); }}>
        ${LINE_TYPES.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></label>
      ${type === 'custom'
        ? html`<label class="field"><span>Beskrivelse *</span><input value=${d.name} onInput=${e => setD(x => ({ ...x, name: e.target.value }))} placeholder="F.eks. navneskilt med logo"/></label>`
        : html`<label class="field"><span>Vare</span><select value=${sel} onChange=${e => { setSel(e.target.value); const it = S.get(type, e.target.value); setD(x => ({ ...x, unitPrice: it ? listPriceOf(type, it) : 0 })); }}>
            <option value="">– velg –</option>${opts.map(it => html`<option value=${it.id}>${it.name}</option>`)}</select></label>`}
      <label class="field"><span>Farge / variant</span><input value=${d.variant} onInput=${e => setD(x => ({ ...x, variant: e.target.value }))} placeholder="F.eks. mørkeblå"/></label>
      <label class="field"><span>Antall</span><${NumInput} value=${d.qty} onChange=${v => setD(x => ({ ...x, qty: v }))}/></label>
      <label class="field"><span>Pris per stk</span><${NumInput} value=${d.unitPrice} onChange=${v => setD(x => ({ ...x, unitPrice: v }))}/></label>
      ${type === 'custom' && html`<label class="field"><span>Selvkost per stk</span><${NumInput} value=${d.unitCost} onChange=${v => setD(x => ({ ...x, unitCost: v }))}/></label>`}
      <div><button class="btn primary" onClick=${add}>+ Legg til</button></div>
    </div>`}
  </div>`;
}

function DeliverDialog({ o, onClose }) {
  const evs = activeEvents();
  const [source, setSource] = useState('hus');
  const stockLines = (o.lines || []).filter(l => l.itemId && (l.type === 'products' || l.type === 'packages'));
  const have = l => (source === 'hus' ? stockOf(l.type, S.get(l.type, l.itemId)) : eventStockOf(source, l.type, l.itemId));
  async function confirmDeliver() {
    const short = stockLines.filter(l => have(l) < num(l.qty));
    if (short.length && !confirm(`For lite på lager av: ${short.map(l => l.name).join(', ')}. Lageret blir negativt. Fortsette?`)) return;
    await deliverOrder(o, source);
    toast(`Bestilling #${o.no} er levert`);
    onClose();
  }
  return html`<${Modal} title=${`Lever bestilling #${o.no}`} onClose=${onClose}>
    ${stockLines.length === 0 ? html`<p>Bestillingen har bare fritekst-linjer, så lageret påvirkes ikke.</p>` : html`
      <label class="field"><span>Ta varene fra</span><select value=${source} onChange=${e => setSource(e.target.value)}>
        <option value="hus">Husets lager</option>${evs.map(ev => html`<option value=${ev.id}>Messe: ${ev.name}</option>`)}</select></label>
      <table style="margin-top:10px"><tbody>${stockLines.map(l => html`<tr><td>${l.name}${l.variant ? ` (${l.variant})` : ''}</td>
        <td class="num">${fmt(l.qty)} stk</td><td class=${'num ' + (have(l) < num(l.qty) ? 'neg' : 'muted')}>har ${fmt(have(l))}</td></tr>`)}</tbody></table>
      <p class="muted small">Fritekst-linjer påvirker ikke lageret.</p>`}
    ${!o.paid && html`<div class="notice warn small">Bestillingen er ikke markert som betalt (gjenstår ${money(orderRemaining(o))}).</div>`}
    <div class="modal-foot"><button class="btn" onClick=${onClose}>Avbryt</button><button class="btn primary" onClick=${confirmDeliver}>Bekreft levering</button></div>
  <//>`;
}
