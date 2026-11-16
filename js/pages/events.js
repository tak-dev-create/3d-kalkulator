// Messer og tilstelninger: pakking, kasse, salg, regnskap, statistikk og retur.
import { html, render, useState, useEffect, useRef } from '../lib.js';
import * as S from '../store.js';
import { money, fmt, num, pct, uid, todayISO, lsGet, lsSet } from "../util.js";
import { byName, findByBarcode, stockOf, TYPE_ICON, TYPE_LABEL } from '../model.js';
import {
  EVENT_STATUS, PAYMENTS, PAY_LABEL, COST_CATS, EVENT_COLLS, dayLabel, todayKey, eventStockRows, eventSales,
  listPriceOf, moveToEvent, returnFromEvent, registerSale, undoSale, eventAccounts, evKey,
} from '../events.js';
import { PageHead, Modal, Seg, NumInput, ScannerModal, Thumb, SearchBox, Empty, toast, go, textMatch } from '../components.js';

const TABS = [
  ['pakking', '📦 Pakking'], ['kasse', '🛒 Kasse'], ['salg', '🧾 Salg'],
  ['regnskap', '📊 Regnskap'], ['statistikk', '📈 Statistikk'], ['retur', '↩️ Retur'],
];
const neg = v => (v ? -v : 0);
const statusBadge = s => html`<span class=${'badge ' + (s === 'pågår' ? 'ok' : s === 'avsluttet' ? '' : 'accent')}>${EVENT_STATUS[s] || s}</span>`;
const dateRange = ev => [ev.startDate && dayLabel(ev.startDate), ev.endDate && ev.endDate !== ev.startDate && dayLabel(ev.endDate)].filter(Boolean).join(' – ');

export function Events({ parts }) {
  if (!parts[1]) return html`<${EventList}/>`;
  return html`<${EventPage} key=${parts[1]} id=${parts[1]} tab=${parts[2]}/>`;
}

/* ---------------- Liste ---------------- */
function EventList() {
  const [edit, setEdit] = useState(null);
  const all = S.list('events').sort((a, b) => String(b.startDate || '').localeCompare(String(a.startDate || '')));
  const active = all.filter(e => e.status !== 'avsluttet'), done = all.filter(e => e.status === 'avsluttet');
  const card = ev => {
    const sales = eventSales(ev.id);
    const total = sales.reduce((a, s) => a + num(s.total), 0);
    const onHand = eventStockRows(ev.id).reduce((a, r) => a + Math.max(0, num(r.qty)), 0);
    return html`<a class="item" key=${ev.id} href=${'#/messer/' + ev.id}>
      <div class="thumb">🎪</div>
      <div class="grow"><div class="title">${ev.name} ${statusBadge(ev.status)}</div>
        <div class="muted small">${[dateRange(ev), ev.location].filter(Boolean).join(' · ')}</div></div>
      <div class="metric"><div>${money(total)}</div><div class="muted">${sales.length} salg</div></div>
      <div class="metric hide-sm"><div>${fmt(onHand, 0)} stk</div><div class="muted">på messen</div></div>
    </a>`;
  };
  return html`
    <${PageHead} title="Messer og tilstelninger"><button class="btn primary" onClick=${() => setEdit({})}>+ Ny messe</button><//>
    ${all.length === 0 && html`<${Empty} icon="🎪" title="Ingen messer ennå">Opprett en messe, pakk varer fra huset, selg i kassen og følg regnskapet underveis.<//>`}
    ${active.length > 0 && html`<h2>Aktive</h2><div class="cards" style="margin-bottom:18px">${active.map(card)}</div>`}
    ${done.length > 0 && html`<h2>Avsluttet</h2><div class="cards">${done.map(card)}</div>`}
    ${edit && html`<${EventForm} ev=${edit} onClose=${() => setEdit(null)}/>`}`;
}

function EventForm({ ev, onClose, onDelete }) {
  const isNew = !ev.id;
  const [d, setD] = useState(() => ({ name: '', location: '', startDate: todayISO(), endDate: todayISO(), notes: '', status: 'planlagt', ...ev }));
  const set = (k, v) => setD(o => ({ ...o, [k]: v }));
  function save() {
    if (!d.name.trim()) return toast('Gi messen et navn', 'err');
    if (d.endDate && d.startDate && d.endDate < d.startDate) return toast('Sluttdato er før startdato', 'err');
    const id = d.id || uid();
    const doc = { name: d.name.trim(), location: d.location, startDate: d.startDate, endDate: d.endDate || d.startDate, notes: d.notes, status: d.status };
    if (isNew) doc.createdAt = Date.now();
    S.write([{ t: isNew ? 'set' : 'upd', c: 'events', id, d: doc }]);
    toast(isNew ? 'Messe opprettet' : 'Lagret');
    onClose();
    if (isNew) go(`messer/${id}/pakking`);
  }
  return html`<${Modal} title=${isNew ? 'Ny messe' : 'Rediger messe'} onClose=${onClose}>
    <div class="form-grid">
      <label class="field wide"><span>Navn *</span><input value=${d.name} onInput=${e => set('name', e.target.value)} placeholder="F.eks. Julemesse Sandvika 2026"/></label>
      <label class="field wide"><span>Sted</span><input value=${d.location} onInput=${e => set('location', e.target.value)}/></label>
      <label class="field"><span>Første dag</span><input type="date" value=${d.startDate} onInput=${e => set('startDate', e.target.value)}/></label>
      <label class="field"><span>Siste dag</span><input type="date" value=${d.endDate} onInput=${e => set('endDate', e.target.value)}/></label>
      <label class="field wide"><span>Notater</span><textarea value=${d.notes} onInput=${e => set('notes', e.target.value)}/></label>
    </div>
    <div class="modal-foot">${onDelete && html`<button class="btn danger" onClick=${() => { onClose(); onDelete(); }}>Slett messe</button><span class="grow"></span>`}<button class="btn" onClick=${onClose}>Avbryt</button><button class="btn primary" onClick=${save}>Lagre</button></div>
  <//>`;
}

/* ---------------- Én messe ---------------- */
function EventPage({ id, tab }) {
  const ev = S.get('events', id);
  const [edit, setEdit] = useState(false);
  if (!ev) return html`<${Empty} icon="🔍" title="Fant ikke messen"><a href="#/messer">Tilbake til messer</a><//>`;
  const current = TABS.some(t => t[0] === tab) ? tab : (ev.status === 'pågår' ? 'kasse' : ev.status === 'avsluttet' ? 'regnskap' : 'pakking');
  const setStatus = status => S.write([{ t: 'upd', c: 'events', id, d: { status, ...(status === 'avsluttet' ? { closedAt: Date.now() } : {}) } }]);
  function remove() {
    const hasStock = eventStockRows(id).some(r => num(r.qty) !== 0);
    if (eventSales(id).length || hasStock) return toast('Messen har salg eller varer. Returner varene først – messer med salg beholdes for regnskapet.', 'err');
    if (!confirm(`Slette «${ev.name}»?`)) return;
    const ops = [{ t: 'del', c: 'events', id }];
    for (const r of eventStockRows(id)) ops.push({ t: 'del', c: 'eventStock', id: r.id });
    for (const c of S.list('eventCosts').filter(x => x.eventId === id)) ops.push({ t: 'del', c: 'eventCosts', id: c.id });
    S.write(ops);
    go('messer');
  }
  const Tab = { pakking: Packing, kasse: Till, salg: SalesList, regnskap: Accounts, statistikk: Stats, retur: Return }[current];
  return html`
    <div class="page-head">
      <a class="btn small" href="#/messer">← Messer</a>
      <h1>${ev.name}</h1>
      ${statusBadge(ev.status)}
    </div>
    <div class="row" style="margin:-8px 0 12px">
      <span class="muted">${[dateRange(ev), ev.location].filter(Boolean).join(' · ')}</span>
      <span class="grow"></span>
      ${ev.status === 'planlagt' && html`<button class="btn small primary" onClick=${() => { setStatus('pågår'); go(`messer/${id}/kasse`); }}>▶ Start messen</button>`}
      ${ev.status === 'pågår' && html`<button class="btn small" onClick=${() => go(`messer/${id}/retur`)}>Avslutt …</button>`}
      ${ev.status === 'avsluttet' && html`<button class="btn small" onClick=${() => setStatus('pågår')}>Gjenåpne</button>`}
      <button class="btn small" onClick=${() => setEdit(true)}>Rediger</button>
    </div>
    <div class="tabs"><${Seg} value=${current} options=${TABS} onChange=${t => go(`messer/${id}/${t}`)}/></div>
    <${Tab} ev=${ev}/>
    ${edit && html`<${EventForm} ev=${ev} onDelete=${remove} onClose=${() => setEdit(false)}/>`}`;
}

/* ---------------- Pakking ---------------- */
function Packing({ ev }) {
  const [type, setType] = useState('products');
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState({});
  const [scan, setScan] = useState(false);
  const items = S.list(type).filter(i => textMatch(q, i.name, i.barcode, i.category)).sort(byName);
  const onFair = eventStockRows(ev.id).filter(r => num(r.qty) !== 0).sort((a, b) => String(a.name).localeCompare(String(b.name), 'nb'));
  const setQty = (k, v) => setDraft(d => ({ ...d, [k]: Math.max(0, num(v)) }));
  const add = (k, n) => setDraft(d => ({ ...d, [k]: Math.max(0, num(d[k]) + n) }));
  const entries = Object.entries(draft).filter(([, n]) => n > 0).map(([k, qty]) => { const [c, id] = k.split('|'); return { c, id, qty }; });
  const units = entries.reduce((a, e) => a + e.qty, 0);

  function onScan(code) {
    const f = findByBarcode(code);
    if (!f || !EVENT_COLLS.includes(f.c)) return toast(`Fant ikke produkt/pakke med kode ${code}`, 'err');
    add(f.c + '|' + f.item.id, 1);
    toast(`+1 ${f.item.name}`);
  }
  async function move() {
    const short = entries.filter(e => stockOf(e.c, S.get(e.c, e.id)) < e.qty);
    if (short.length && !confirm(`Det er for lite på husets lager av: ${short.map(e => S.get(e.c, e.id)?.name).join(', ')}.\nHuslageret blir negativt. Fortsette?`)) return;
    await moveToEvent(ev, entries);
    toast(`${fmt(units, 0)} stk flyttet til ${ev.name}`);
    setDraft({});
  }
  function printList() {
    const rows = eventStockRows(ev.id).filter(r => num(r.qty) > 0).sort((a, b) => String(a.name).localeCompare(String(b.name), 'nb'));
    render(html`<div class="report">
      <h1>Pakkeliste – ${ev.name}</h1>
      <p>${[dateRange(ev), ev.location].filter(Boolean).join(' · ')} · skrevet ut ${new Date().toLocaleString('nb-NO')}</p>
      <table><thead><tr><th style="width:12mm">✓</th><th>Vare</th><th>Type</th><th class="num">Antall</th></tr></thead>
      <tbody>${rows.map(r => html`<tr><td>☐</td><td>${S.get(r.c, r.itemId)?.name || r.name}</td><td>${TYPE_LABEL[r.c]}</td><td class="num">${fmt(r.qty)}</td></tr>`)}</tbody>
      <tfoot><tr><td></td><td><b>Totalt</b></td><td></td><td class="num"><b>${fmt(rows.reduce((a, r) => a + num(r.qty), 0))}</b></td></tr></tfoot></table>
    </div>`, document.getElementById('print-root'));
    setTimeout(() => window.print(), 100);
  }

  return html`<div class="editor">
    <div>
      <div class="panel">
        <h2>Velg varer fra huset</h2>
        <div class="row" style="margin-bottom:10px">
          <${Seg} value=${type} onChange=${setType} options=${[['products', '🧩 Produkter'], ['packages', '🎁 Pakker']]}/>
          <button class="btn" onClick=${() => setScan(true)}>📷 Skann</button>
        </div>
        <${SearchBox} value=${q} onInput=${setQ}/>
        ${items.length === 0 ? html`<p class="muted">Ingen ${type === 'products' ? 'produkter' : 'pakker'}.</p>` : html`<div class="pick-list">${items.map(i => {
          const k = type + '|' + i.id, n = num(draft[k]), house = stockOf(type, i), fair = num(S.get('eventStock', evKey(ev.id, type, i.id))?.qty);
          return html`<div class=${'pick-row' + (n > 0 ? ' on' : '')} key=${k}>
            <${Thumb} src=${i.thumb} icon=${TYPE_ICON[type]}/>
            <div class="grow" onClick=${() => add(k, 1)}>
              <div class="title">${i.name}</div>
              <div class="muted small">Hus: <b class=${house <= 0 ? 'neg' : ''}>${fmt(house)}</b>${fair ? ` · På messen: ${fmt(fair)}` : ''}</div>
            </div>
            <div class="stepper">
              <button class="btn small" onClick=${() => add(k, -1)} aria-label="Én færre">−</button>
              <${NumInput} int value=${n || ''} onChange=${v => setQty(k, v)} placeholder="0"/>
              <button class="btn small" onClick=${() => add(k, 1)} aria-label="Én til">+</button>
            </div>
          </div>`;
        })}</div>`}
      </div>
      ${units > 0 && html`<div class="savebar">
        <button class="btn primary" onClick=${move}>➜ Flytt ${fmt(units, 0)} stk (${entries.length} varer) til messen</button>
        <button class="btn" onClick=${() => setDraft({})}>Nullstill</button>
      </div>`}
    </div>
    <div class="aside">
      <div class="panel">
        <h2>På messen nå</h2>
        ${onFair.length === 0 ? html`<p class="muted">Ingen varer pakket ennå.</p>` : html`<div class="mini-list">${onFair.map(r => html`
          <div class="mini-row" key=${r.id}><span class="ico">${TYPE_ICON[r.c]}</span>
            <div class="mini-main"><div class="mini-name">${S.get(r.c, r.itemId)?.name || r.name}</div></div>
            <div class="mini-val">${fmt(r.qty)} stk</div></div>`)}</div>
          <p class="small muted">Totalt ${fmt(onFair.reduce((a, r) => a + num(r.qty), 0))} stk</p>
          <button class="btn small" onClick=${printList}>🖨️ Skriv ut pakkeliste</button>`}
      </div>
    </div>
    ${scan && html`<${ScannerModal} continuous title="Skann varer til messen" onCode=${onScan} onClose=${() => setScan(false)}/>`}
  </div>`;
}

/* ---------------- Kasse ---------------- */
const carts = lsGet("tillCarts", {}); // beholdes ved bytte av fane og omlasting (kun på denne enheten)
function Till({ ev }) {
  const [cart, setCartRaw] = useState(() => carts[ev.id] || []);
  const setCart = f => setCartRaw(c => { const n = typeof f === "function" ? f(c) : f; carts[ev.id] = n; lsSet("tillCarts", carts); return n; });
  const [payment, setPayment] = useState('vipps');
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [scan, setScan] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const cartRef = useRef();

  const rows = eventStockRows(ev.id).filter(r => num(r.sent) > 0 || num(r.qty) !== 0)
    .map(r => ({ ...r, item: S.get(r.c, r.itemId) }))
    .filter(r => textMatch(q, r.item?.name || r.name, r.item?.barcode))
    .sort((a, b) => (num(b.qty) > 0) - (num(a.qty) > 0) || String(a.item?.name || a.name).localeCompare(String(b.item?.name || b.name), 'nb'));

  function addToCart(c, itemId, n = 1) {
    setCart(cs => {
      const i = cs.findIndex(l => l.c === c && l.itemId === itemId);
      if (i >= 0) return cs.map((l, j) => (j === i ? { ...l, qty: Math.max(0, l.qty + n) } : l)).filter(l => l.qty > 0);
      if (n <= 0) return cs;
      return [...cs, { c, itemId, qty: n, unitPrice: listPriceOf(c, S.get(c, itemId)) }];
    });
  }
  function onCode(raw) {
    const f = findByBarcode(raw);
    if (!f || !EVENT_COLLS.includes(f.c)) return toast(`Ukjent kode ${raw}`, 'err');
    addToCart(f.c, f.item.id, 1);
    toast(`+1 ${f.item.name}`);
  }
  const subtotal = cart.reduce((a, l) => a + l.qty * num(l.unitPrice), 0);
  const disc = Math.min(Math.max(0, num(discount)), subtotal);
  const total = subtotal - disc;
  const count = cart.reduce((a, l) => a + l.qty, 0);

  async function submit() {
    if (!cart.length) return toast('Handlekurven er tom', 'err');
    const over = cart.filter(l => l.qty > num(S.get('eventStock', evKey(ev.id, l.c, l.itemId))?.qty));
    if (over.length && !confirm(`Mer enn det som er på messelageret: ${over.map(l => S.get(l.c, l.itemId)?.name).join(', ')}.\nRegistrere likevel?`)) return;
    setBusy(true);
    try {
      const s = await registerSale(ev, cart, { payment, discount: disc, note });
      toast(`Salg registrert: ${money(s.total)} (${PAY_LABEL[payment]})`);
      setCart([]); setDiscount(0); setNote('');
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  }

  return html`<div class="editor till">
    <div>
      ${ev.status === 'planlagt' && html`<div class="notice info row"><span class="grow">Messen er ikke startet ennå. Salg kan likevel registreres.</span>
        <button class="btn small" onClick=${() => S.write([{ t: 'upd', c: 'events', id: ev.id, d: { status: 'pågår' } }])}>▶ Start messen</button></div>`}
      ${ev.status === 'avsluttet' && html`<div class="notice warn">Messen er avsluttet. Gjenåpne den for å registrere salg.</div>`}
      <div class="row" style="margin-bottom:10px">
        <button class="btn primary" onClick=${() => setScan(true)}>📷 Skann</button>
        <form class="grow row nowrap" style="min-width:200px" onSubmit=${e => { e.preventDefault(); if (code.trim()) onCode(code.trim()); setCode(''); }}>
          <input value=${code} onInput=${e => setCode(e.target.value)} placeholder="Strekkode / håndskanner + Enter" inputmode="numeric"/>
        </form>
      </div>
      <${SearchBox} value=${q} onInput=${setQ} placeholder="Søk i messelageret …"/>
      ${rows.length === 0 ? html`<${Empty} icon="📦" title="Ingen varer på messen">Pakk varer under fanen «Pakking» først.<//>` : html`
      <div class="tiles">${rows.map(r => {
        const inCart = cart.find(l => l.c === r.c && l.itemId === r.itemId)?.qty || 0;
        const left = num(r.qty) - inCart;
        return html`<button class=${'tile' + (left <= 0 ? ' empty' : '') + (inCart ? ' on' : '')} key=${r.id} onClick=${() => addToCart(r.c, r.itemId)} disabled=${ev.status === 'avsluttet'}>
          <div class="tile-img">${r.item?.thumb ? html`<img src=${r.item.thumb} alt=""/>` : TYPE_ICON[r.c]}</div>
          <div class="tile-name">${r.item?.name || r.name}</div>
          <div class="tile-meta"><span>${money(listPriceOf(r.c, r.item))}</span><span class=${left <= 0 ? 'neg' : 'muted'}>${fmt(left)} igjen</span></div>
          ${inCart > 0 && html`<span class="tile-count">${inCart}</span>`}
        </button>`;
      })}</div>`}
    </div>
    <div class="aside" ref=${cartRef}>
      <div class="panel cart">
        <h2>Handlekurv ${count > 0 && html`<span class="badge accent">${fmt(count, 0)}</span>`}</h2>
        ${cart.length === 0 ? html`<p class="muted">Trykk på en vare eller skann for å legge den i kurven.</p>` : html`
        <div class="mini-list">${cart.map((l, i) => html`<div class="cart-row" key=${l.c + l.itemId}>
          <div class="mini-name">${S.get(l.c, l.itemId)?.name || '?'}</div>
          <div class="row nowrap">
            <div class="stepper">
              <button class="btn small" onClick=${() => addToCart(l.c, l.itemId, -1)}>−</button>
              <span class="qty">${l.qty}</span>
              <button class="btn small" onClick=${() => addToCart(l.c, l.itemId, 1)}>+</button>
            </div>
            <span class="muted small">à</span>
            <div style="width:90px"><${NumInput} value=${l.unitPrice} onChange=${v => setCart(cs => cs.map((x, j) => (j === i ? { ...x, unitPrice: v } : x)))}/></div>
            <span class="grow num right">${money(l.qty * num(l.unitPrice))}</span>
          </div>
        </div>`)}</div>
        <table class="calc" style="margin-top:8px"><tbody>
          <tr><td>Sum</td><td class="num">${money(subtotal)}</td></tr>
          <tr><td>Rabatt (kr)</td><td class="num" style="width:110px"><${NumInput} value=${discount} onChange=${setDiscount}/></td></tr>
          <tr class="hl"><td>Å betale</td><td class="num">${money(total)}</td></tr>
        </tbody></table>
        <div class="row" style="margin:6px 0 10px">${[10, 20, 50].map(p => html`<button class="btn small" onClick=${() => setDiscount(Math.round(subtotal * p) / 100)}>−${p} %</button>`)}
          <button class="btn small" onClick=${() => setDiscount(0)}>Ingen rabatt</button></div>
        <div style="margin-bottom:10px"><${Seg} value=${payment} onChange=${setPayment} options=${PAYMENTS}/></div>
        <input value=${note} onInput=${e => setNote(e.target.value)} placeholder="Notat (valgfritt)" style="margin-bottom:10px"/>
        <div class="row">
          <button class="btn primary grow" style="min-height:52px; font-size:1.05rem" disabled=${busy || ev.status === 'avsluttet'} onClick=${submit}>✔ Registrer salg ${money(total)}</button>
          <button class="btn" onClick=${() => { if (confirm('Tømme handlekurven?')) setCart([]); }}>Tøm</button>
        </div>`}
      </div>
    </div>
    ${count > 0 && html`<button class="cart-bar" onClick=${() => cartRef.current?.scrollIntoView({ behavior: 'smooth' })}>
      🛒 ${fmt(count, 0)} varer · ${money(total)} → Til betaling</button>`}
    ${scan && html`<${ScannerModal} continuous title="Skann varer til handlekurven" onCode=${onCode} onClose=${() => setScan(false)}/>`}
  </div>`;
}

/* ---------------- Salg ---------------- */
function SalesList({ ev }) {
  const sales = eventSales(ev.id);
  if (!sales.length) return html`<${Empty} icon="🧾" title="Ingen salg ennå">Salg registreres i kassen.<//>`;
  const days = [...new Set(sales.map(s => s.day))];
  async function undo(s) {
    if (!confirm(`Angre salget kl. ${new Date(s.ts).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })} på ${money(s.total)}?\nVarene legges tilbake på messelageret.`)) return;
    await undoSale(ev, s);
    toast('Salget er angret');
  }
  return html`${days.map(day => {
    const list = sales.filter(s => s.day === day);
    return html`<div class="panel" key=${day}>
      <h2>${dayLabel(day, true)} <span class="muted small">· ${list.length} salg · ${money(list.reduce((a, s) => a + num(s.total), 0))}</span></h2>
      <div class="mini-list">${list.map(s => html`<div class="mini-row" key=${s.id}>
        <span class="ico small muted">${new Date(s.ts).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}</span>
        <div class="mini-main">
          <div class="mini-name">${(s.lines || []).map(l => `${l.qty} × ${l.name}`).join(', ')}</div>
          <div class="mini-sub">${[PAY_LABEL[s.payment], s.discount > 0 ? `rabatt ${money(s.discount)}` : '', s.note, s.user].filter(Boolean).join(' · ')}</div>
        </div>
        <div class="mini-val"><b>${money(s.total)}</b></div>
        <button class="icon-btn" title="Angre salg" aria-label="Angre salg" onClick=${() => undo(s)} disabled=${ev.status === 'avsluttet'}>↶</button>
      </div>`)}</div>
    </div>`;
  })}`;
}

/* ---------------- Regnskap ---------------- */
function Accounts({ ev }) {
  const acc = eventAccounts(ev);
  function print() {
    render(html`<div class="report"><h1>${acc.final ? 'Sluttregnskap' : 'Foreløpig regnskap'} – ${ev.name}</h1>
      <p>${[dateRange(ev), ev.location].filter(Boolean).join(' · ')} · skrevet ut ${new Date().toLocaleString('nb-NO')}</p>
      <${AccountsBody} ev=${ev} acc=${acc} print/></div>`, document.getElementById('print-root'));
    setTimeout(() => window.print(), 100);
  }
  return html`
    <div class="row" style="margin-bottom:12px">
      ${acc.final ? html`<span class="badge ok">Sluttregnskap</span>` : html`<span class="badge warn">Foreløpig – oppdateres løpende</span>`}
      <span class="grow"></span>
      <button class="btn small" onClick=${print}>🖨️ Skriv ut / PDF</button>
    </div>
    <${AccountsBody} ev=${ev} acc=${acc}/>
    <${CostsPanel} ev=${ev} days=${acc.days}/>`;
}

function AccountsBody({ ev, acc, print }) {
  const T = acc.total, days = acc.days, today = todayKey();
  const payKeys = PAYMENTS.map(p => p[0]).filter(k => days.some(d => acc.byDay[d].pay[k]) || T.pay[k]);
  const cell = (v, cls = '') => html`<td class=${'num ' + cls}>${v}</td>`;
  const signed = v => (v < 0 ? 'neg' : v > 0 ? 'pos' : '');
  return html`
    <div class="grid-stats">
      <div class="stat"><div class="v">${money(T.revenue)}</div><div class="l">Salg totalt</div></div>
      <div class="stat"><div class="v">${money(T.gross)}</div><div class="l">Bruttofortjeneste ${T.margin != null ? `(${pct(T.margin)})` : ''}</div></div>
      <div class="stat"><div class="v">${money(T.costs)}</div><div class="l">Kostnader</div></div>
      <div class="stat"><div class=${'v ' + signed(T.net)}>${money(T.net)}</div><div class="l">Netto resultat</div></div>
    </div>
    <div class="panel">
      <h2>Per dag og totalt</h2>
      <div class="table-wrap"><table class="acc-table">
        <thead><tr><th></th>${days.map(d => html`<th class=${'num' + (d === today && !print ? ' today' : '')}>${dayLabel(d)}${d === today && !print ? ' (i dag)' : ''}</th>`)}<th class="num">Totalt</th></tr></thead>
        <tbody>
          <tr class="strong"><td>Salg</td>${days.map(d => cell(money(acc.byDay[d].revenue)))}${cell(money(T.revenue))}</tr>
          ${payKeys.map(k => html`<tr class="sub"><td>· ${PAY_LABEL[k]}</td>${days.map(d => cell(money(acc.byDay[d].pay[k] || 0)))}${cell(money(T.pay[k] || 0))}</tr>`)}
          <tr class="sub"><td>Antall kunder / varer</td>${days.map(d => cell(`${acc.byDay[d].customers} / ${fmt(acc.byDay[d].items)}`))}${cell(`${T.customers} / ${fmt(T.items)}`)}</tr>
          <tr><td>Varekost (selvkost)</td>${days.map(d => cell(money(neg(acc.byDay[d].cogs))))}${cell(money(neg(T.cogs)))}</tr>
          <tr class="strong"><td>Bruttofortjeneste</td>${days.map(d => cell(money(acc.byDay[d].gross), signed(acc.byDay[d].gross)))}${cell(money(T.gross), signed(T.gross))}</tr>
          <tr class="sub"><td>Margin</td>${days.map(d => cell(pct(acc.byDay[d].margin)))}${cell(pct(T.margin))}</tr>
          <tr><td>Kostnader</td>${days.map(d => cell(money(neg(acc.byDay[d].costs))))}${cell(money(neg(T.costs)))}</tr>
          <tr class="strong total"><td>Netto</td>${days.map(d => cell(money(acc.byDay[d].net), signed(acc.byDay[d].net)))}${cell(money(T.net), signed(T.net))}</tr>
        </tbody>
      </table></div>
      <p class="muted small" style="margin-bottom:0">Kostnader for «hele messen» (f.eks. standleie) er bare med i totalen. Dagene viser kun kostnader knyttet til den dagen.</p>
    </div>
    <div class="two-col">
      <div class="panel">
        <h2>Varer</h2>
        <table class="calc"><tbody>
          <tr><td>Sendt med fra huset</td><td class="num">${fmt(acc.stock.sent)} stk</td></tr>
          <tr><td>Solgt i kassen</td><td class="num">${fmt(T.items)} stk</td></tr>
          ${acc.stock.ordered !== 0 && html`<tr><td>Levert til bestillinger</td><td class="num">${fmt(acc.stock.ordered)} stk</td></tr>`}
          <tr><td>Returnert til huset</td><td class="num">${fmt(acc.stock.returned)} stk</td></tr>
          ${acc.stock.lost !== 0 && html`<tr><td>Svinn / avvik</td><td class="num neg">${fmt(acc.stock.lost)} stk</td></tr>`}
          <tr class="sum"><td>På messen nå</td><td class="num">${fmt(acc.stock.units)} stk</td></tr>
          <tr class="sub"><td>· selvkost</td><td class="num">${money(acc.stock.cost)}</td></tr>
          <tr class="sub"><td>· salgsverdi</td><td class="num">${money(acc.stock.value)}</td></tr>
        </tbody></table>
      </div>
      <div class="panel">
        <h2>Bestillinger tatt på messen</h2>
        ${acc.orders.count === 0 ? html`<p class="muted">Ingen bestillinger er knyttet til messen.</p>` : html`
          <p><b>${acc.orders.count}</b> bestillinger, til sammen <b>${money(acc.orders.sum)}</b>.</p>
          <p class="muted small">Holdes utenfor salgstallene over, siden de leveres og betales senere.</p>
          ${!print && html`<a class="small" href=${'#/bestillinger?messe=' + ev.id}>Se bestillingene →</a>`}`}
        ${print && acc.costs.length > 0 && html`<h2 style="margin-top:14px">Kostnader</h2><table class="calc"><tbody>
          ${acc.costs.map(c => html`<tr><td>${dayLabel(c.day)} · ${c.category}${c.description ? ' – ' + c.description : ''}</td><td class="num">${money(c.amount)}</td></tr>`)}
        </tbody></table>`}
      </div>
    </div>`;
}

function CostsPanel({ ev, days }) {
  const [d, setD] = useState({ day: '', category: COST_CATS[0], description: '', amount: 0 });
  const costs = S.list('eventCosts').filter(c => c.eventId === ev.id).sort((a, b) => String(a.day).localeCompare(String(b.day)) || a.ts - b.ts);
  function add() {
    if (num(d.amount) <= 0) return toast('Skriv inn et beløp', 'err');
    S.write([{ t: 'set', c: 'eventCosts', id: uid(), d: { eventId: ev.id, ...d, amount: num(d.amount), ts: Date.now(), user: S.userEmail() } }]);
    setD(o => ({ ...o, description: '', amount: 0 }));
    toast('Kostnad lagt til');
  }
  function del(c) { if (confirm(`Slette kostnaden «${c.category}» på ${money(c.amount)}?`)) S.write([{ t: 'del', c: 'eventCosts', id: c.id }]); }
  return html`<div class="panel">
    <h2>Kostnader</h2>
    ${costs.length > 0 && html`<div class="mini-list" style="margin-bottom:12px">${costs.map(c => html`<div class="mini-row" key=${c.id}>
      <div class="mini-main"><div class="mini-name">${c.category}${c.description ? ' – ' + c.description : ''}</div><div class="mini-sub">${[dayLabel(c.day), c.user].filter(Boolean).join(' · ')}</div></div>
      <div class="mini-val">${money(c.amount)}</div>
      <button class="icon-btn" title="Slett" aria-label="Slett kostnad" onClick=${() => del(c)}>✕</button></div>`)}</div>`}
    <div class="form-grid" style="align-items:end">
      <label class="field"><span>Gjelder</span><select value=${d.day} onChange=${e => setD(o => ({ ...o, day: e.target.value }))}>
        <option value="">Hele messen</option>${days.map(k => html`<option value=${k}>${dayLabel(k)}</option>`)}</select></label>
      <label class="field"><span>Kategori</span><select value=${d.category} onChange=${e => setD(o => ({ ...o, category: e.target.value }))}>${COST_CATS.map(c => html`<option value=${c} selected=${c === d.category}>${c}</option>`)}</select></label>
      <label class="field"><span>Beskrivelse</span><input value=${d.description} onInput=${e => setD(o => ({ ...o, description: e.target.value }))} placeholder="F.eks. 2 × 45 km"/></label>
      <label class="field"><span>Beløp (kr)</span><${NumInput} value=${d.amount} onChange=${v => setD(o => ({ ...o, amount: v }))}/></label>
      <div><button class="btn primary" onClick=${add}>+ Legg til</button></div>
    </div>
  </div>`;
}

/* ---------------- Statistikk ---------------- */
const SORTS = [['qty', 'Antall'], ['revenue', 'Omsetning'], ['profit', 'Fortjeneste'], ['sellThrough', 'Salgsandel']];
function Stats({ ev }) {
  const acc = eventAccounts(ev);
  const [sort, setSort] = useState('qty');
  const stats = [...acc.stats].sort((a, b) => num(b[sort]) - num(a[sort]) || a.name.localeCompare(b.name, 'nb'));
  const sold = stats.filter(s => s.qty > 0), unsold = stats.filter(s => s.qty <= 0 && s.sent > 0);
  if (!acc.sales.length && !acc.stats.length) return html`<${Empty} icon="📈" title="Ingen data ennå">Statistikken bygges opp av salgene i kassen.<//>`;
  const days = acc.days;
  const maxCell = Math.max(1, ...stats.flatMap(s => days.map(d => s.perDay[d] || 0)));
  const dayRev = days.map(d => ({ d, v: acc.byDay[d].revenue, n: acc.byDay[d].items }));
  const maxDay = Math.max(1, ...dayRev.map(x => x.v));
  const bestDay = [...dayRev].sort((a, b) => b.v - a.v)[0], worstDay = [...dayRev].sort((a, b) => a.v - b.v)[0];
  const hourIdx = acc.hours.map((h, i) => ({ ...h, i })).filter(h => h.count > 0);
  const hFrom = hourIdx.length ? Math.min(...hourIdx.map(h => h.i)) : 9, hTo = hourIdx.length ? Math.max(...hourIdx.map(h => h.i)) : 17;
  const hours = acc.hours.slice(hFrom, hTo + 1).map((h, j) => ({ ...h, i: hFrom + j }));
  const maxHour = Math.max(1, ...hours.map(h => h.revenue));
  const rank = s => (sold.indexOf(s) < 3 && s.qty > 0 ? 'top' : '');

  return html`
    <div class="grid-stats">
      <div class="stat"><div class="v">${sold[0] ? sold[0].name : '–'}</div><div class="l">Bestselger${sold[0] ? ` (${fmt(sold[0].qty)} stk)` : ''}</div></div>
      ${days.length > 1 && html`<div class="stat"><div class="v">${bestDay ? dayLabel(bestDay.d) : '–'}</div><div class="l">Beste dag (${money(bestDay?.v || 0)})</div></div>
      <div class="stat"><div class="v">${worstDay ? dayLabel(worstDay.d) : '–'}</div><div class="l">Svakeste dag (${money(worstDay?.v || 0)})</div></div>`}
      <div class="stat"><div class="v">${fmt(unsold.length, 0)}</div><div class="l">Varer uten salg</div></div>
    </div>

    <div class="panel">
      <div class="row" style="margin-bottom:10px"><h2 style="margin:0" class="grow">Produkter – bestselgere og dårligst</h2>
        <${Seg} value=${sort} onChange=${setSort} options=${SORTS}/></div>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>Vare</th><th class="num">Med</th><th class="num">Solgt</th><th class="num">Salgsandel</th><th class="num">Omsetning</th><th class="num">Fortjeneste</th></tr></thead>
        <tbody>${stats.map((s, i) => html`<tr key=${s.c + s.itemId} class=${s.qty <= 0 ? 'muted' : ''}>
          <td class="muted">${i + 1}</td>
          <td>${rank(s) && html`<span title="Topp 3">⭐ </span>`}${s.name} <span class="muted small">${TYPE_LABEL[s.c]}</span></td>
          <td class="num">${fmt(s.sent)}</td><td class="num"><b>${fmt(s.qty)}</b></td>
          <td class="num">${s.sellThrough == null ? '–' : pct(s.sellThrough)}</td>
          <td class="num">${money(s.revenue)}</td><td class=${'num ' + (s.profit < 0 ? 'neg' : '')}>${money(s.profit)}</td></tr>`)}</tbody>
      </table></div>
      ${unsold.length > 0 && html`<p class="small" style="margin-bottom:0"><b>Uten salg:</b> ${unsold.map(s => s.name).join(', ')}</p>`}
    </div>

    ${days.length > 0 && html`<div class="panel">
      <h2>Salg per dag</h2>
      <div class="bars">${dayRev.map(x => html`<div class="bar-row" title=${`${dayLabel(x.d, true)}: ${money(x.v)} · ${fmt(x.n)} varer`}>
        <span class="bar-label">${dayLabel(x.d)}</span>
        <span class="bar-track"><span class="bar" style=${`width:${(x.v / maxDay) * 100}%`}></span></span>
        <span class="bar-val">${money(x.v)}</span></div>`)}</div>
    </div>`}

    ${days.length > 0 && stats.length > 0 && html`<div class="panel">
      <h2>Antall solgt per produkt og dag</h2>
      <div class="table-wrap"><table class="heat">
        <thead><tr><th>Vare</th>${days.map(d => html`<th class="num">${dayLabel(d)}</th>`)}<th class="num">Sum</th></tr></thead>
        <tbody>${stats.map(s => html`<tr key=${s.c + s.itemId}><td>${s.name}</td>
          ${days.map(d => { const v = s.perDay[d] || 0; return html`<td class=${"num heat-cell" + (v / maxCell > 0.55 ? " dark" : "")} title=${`${s.name}, ${dayLabel(d, true)}: ${fmt(v)} stk`}
            style=${v ? `--a:${(0.12 + 0.78 * v / maxCell).toFixed(2)}` : ''}><span>${v || ''}</span></td>`; })}
          <td class="num"><b>${fmt(s.qty)}</b></td></tr>`)}</tbody>
      </table></div>
      <p class="muted small" style="margin-bottom:0">Mørkere felt = flere solgt.</p>
    </div>`}

    ${hourIdx.length > 0 && html`<div class="panel">
      <h2>Salg per time (alle dager)</h2>
      <div class="hbars">${hours.map(h => html`<div class="hbar-col" title=${`kl. ${h.i}–${h.i + 1}: ${money(h.revenue)} · ${h.count} salg`}>
        <span class="hbar-val">${h.revenue ? fmt(h.revenue, 0) : ''}</span>
        <span class="hbar-track"><span class="hbar" style=${h.revenue ? `height:${(h.revenue / maxHour) * 100}%` : "height:0;min-height:0"}></span></span>
        <span class="hbar-label">${h.i}</span></div>`)}</div>
      <p class="muted small" style="margin-bottom:0">Kroner per klokketime.</p>
    </div>`}`;
}

/* ---------------- Retur ---------------- */
function Return({ ev }) {
  const rows = eventStockRows(ev.id).filter(r => num(r.qty) !== 0).sort((a, b) => String(a.name).localeCompare(String(b.name), 'nb'));
  const [counted, setCounted] = useState({});
  const val = r => (counted[r.id] ?? num(r.qty));
  const diff = rows.reduce((a, r) => a + (num(r.qty) - val(r)), 0);
  const units = rows.reduce((a, r) => a + Math.max(0, val(r)), 0);
  async function doReturn() {
    const msg = `Legge ${fmt(units)} stk tilbake på husets lager?` + (diff ? `\n${fmt(diff)} stk føres som svinn/avvik.` : '');
    if (!confirm(msg)) return;
    await returnFromEvent(ev, rows.map(r => ({ c: r.c, itemId: r.itemId, name: r.name, qty: num(r.qty), counted: val(r) })));
    setCounted({});
    toast('Varene er lagt tilbake på huset');
  }
  function close() {
    if (!confirm('Avslutte messen? Regnskapet blir sluttregnskap.')) return;
    S.write([{ t: 'upd', c: 'events', id: ev.id, d: { status: 'avsluttet', closedAt: Date.now() } }]);
    toast('Messen er avsluttet');
    go(`messer/${ev.id}/regnskap`);
  }
  if (!rows.length) return html`<div class="panel">
    <h2>Messelageret er tomt ✔</h2>
    ${ev.status !== 'avsluttet'
      ? html`<p>Alle varer er solgt eller lagt tilbake på huset.</p><button class="btn primary" onClick=${close}>Avslutt messen</button>`
      : html`<p class="muted">Messen er avsluttet.</p>`}
  </div>`;
  return html`<div class="panel">
    <h2>Tilbake til huset</h2>
    <p class="muted">Tell det som ligger i eskene. Er tallet lavere enn det appen forventer, føres differansen som svinn.</p>
    <div class="table-wrap"><table>
      <thead><tr><th>Vare</th><th class="num">Forventet</th><th class="num">Talt</th><th class="num">Avvik</th></tr></thead>
      <tbody>${rows.map(r => {
        const d = num(r.qty) - val(r);
        return html`<tr key=${r.id}><td>${TYPE_ICON[r.c]} ${S.get(r.c, r.itemId)?.name || r.name}</td><td class="num">${fmt(r.qty)}</td>
          <td class="num" style="width:100px"><${NumInput} value=${val(r)} onChange=${v => setCounted(o => ({ ...o, [r.id]: v }))}/></td>
          <td class=${'num ' + (d > 0 ? 'neg' : d < 0 ? 'pos' : 'muted')}>${d ? (d > 0 ? '−' : '+') + fmt(Math.abs(d)) : '–'}</td></tr>`;
      })}</tbody>
    </table></div>
    <div class="row" style="margin-top:12px">
      <button class="btn primary" onClick=${doReturn}>↩️ Legg ${fmt(units)} stk tilbake på huset</button>
      ${diff !== 0 && html`<span class="neg small">Avvik: ${fmt(diff)} stk</span>`}
    </div>
  </div>`;
}
