// Messer: messelager, flytting hus ↔ messe, kassesalg, kostnader, regnskap og statistikk. Bestillinger.
import * as S from './store.js';
import { num, uid, round, sum } from './util.js';
import { productCostOf, packageCostOf, stockOf, unitOf } from './model.js';

export const EVENT_STATUS = { planlagt: 'Planlegges', pågår: 'Pågår', avsluttet: 'Avsluttet' };
export const PAYMENTS = [['vipps', 'Vipps'], ['kort', 'Kort'], ['kontant', 'Kontant'], ['annet', 'Annet']];
export const PAY_LABEL = Object.fromEntries(PAYMENTS);
export const COST_CATS = ['Standleie', 'Kjøring', 'Parkering', 'Mat', 'Overnatting', 'Materiell', 'Annet'];
export const EVENT_COLLS = ['products', 'packages'];

/* ---------- Datoer ---------- */
const p2 = n => String(n).padStart(2, '0');
export const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const todayKey = () => dayKey(Date.now());
export function dayLabel(key, long = false) {
  if (!key) return 'Hele messen';
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('nb-NO', long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'numeric' });
}
export function daysBetween(start, end) {
  if (!start) return [];
  const [y, m, d] = start.split('-').map(Number);
  const out = [];
  const dt = new Date(y, m - 1, d);
  const last = end && end >= start ? end : start;
  for (let i = 0; i < 60; i++) {
    const k = dayKey(dt.getTime());
    out.push(k);
    if (k >= last) break;
    dt.setDate(dt.getDate() + 1);
  }
  return out;
}

/* ---------- Oppslag ---------- */
export const evKey = (eventId, c, itemId) => `${eventId}~${c}~${itemId}`;
export const eventStockRows = eventId => S.list('eventStock').filter(r => r.eventId === eventId);
export const eventStockOf = (eventId, c, itemId) => num(S.get('eventStock', evKey(eventId, c, itemId))?.qty);
export const eventSales = eventId => S.list('sales').filter(s => s.eventId === eventId).sort((a, b) => b.ts - a.ts);
export const eventCosts = eventId => S.list('eventCosts').filter(c => c.eventId === eventId);
export const eventOrders = eventId => S.list('orders').filter(o => o.eventId === eventId && o.status !== 'kansellert');
export const activeEvents = () => S.list('events').filter(e => e.status !== 'avsluttet');

export function itemOf(c, id) { return S.get(c, id); }
export function unitCostOf(c, item) {
  if (!item) return 0;
  return c === 'packages' ? packageCostOf(item).cost : productCostOf(item).unitCost;
}
export function listPriceOf(c, item) {
  if (!item) return 0;
  const q = num(item.quotedPrice);
  if (q > 0) return q;
  return Math.ceil(c === 'packages' ? packageCostOf(item).suggested : productCostOf(item).suggested);
}

function movement(c, itemId, name, delta, reason, loc, extra = {}) {
  return {
    t: 'set', c: 'movements', id: uid(),
    d: { ts: Date.now(), user: S.userEmail(), c, itemId, name, delta: round(delta, 3), unit: unitOf(c, S.get(c, itemId)), reason, loc, ...extra },
  };
}
function evStockOps(ev, c, itemId, name, fields) {
  const id = evKey(ev.id, c, itemId);
  const ops = [{ t: 'upd', c: 'eventStock', id, d: { eventId: ev.id, c, itemId, name } }];
  for (const [f, v] of Object.entries(fields)) if (v) ops.push({ t: 'inc', c: 'eventStock', id, f, v: round(v, 3) });
  return ops;
}

/* ---------- Pakking: hus → messe ---------- */
// entries: [{ c, id, qty }]
export function moveToEvent(ev, entries) {
  const ops = [];
  for (const e of entries) {
    const q = num(e.qty);
    if (!q) continue;
    const item = S.get(e.c, e.id);
    const name = item?.name || '';
    ops.push({ t: 'inc', c: e.c, id: e.id, f: 'stock', v: -q });
    ops.push(movement(e.c, e.id, name, -q, 'Pakket til messe', 'Hus', { ref: ev.name, eventId: ev.id }));
    ops.push(...evStockOps(ev, e.c, e.id, name, { qty: q, sent: q }));
    ops.push(movement(e.c, e.id, name, q, 'Mottatt fra hus', ev.name, { ref: ev.name, eventId: ev.id }));
  }
  return S.write(ops);
}

/* ---------- Retur: messe → hus ---------- */
// lines: [{ c, itemId, qty (på messen), counted (faktisk talt) }]
export function returnFromEvent(ev, lines) {
  const ops = [];
  for (const l of lines) {
    const have = num(l.qty), counted = Math.max(0, num(l.counted));
    if (!have && !counted) continue;
    const name = S.get(l.c, l.itemId)?.name || l.name || '';
    const lost = have - counted;
    ops.push(...evStockOps(ev, l.c, l.itemId, name, { qty: -have, returned: counted, lost }));
    if (counted) {
      ops.push({ t: 'inc', c: l.c, id: l.itemId, f: 'stock', v: counted });
      ops.push(movement(l.c, l.itemId, name, -counted, 'Returnert til hus', ev.name, { ref: ev.name, eventId: ev.id }));
      ops.push(movement(l.c, l.itemId, name, counted, 'Retur fra messe', 'Hus', { ref: ev.name, eventId: ev.id }));
    }
    if (lost > 0) ops.push(movement(l.c, l.itemId, name, -lost, 'Svinn på messe', ev.name, { ref: ev.name, eventId: ev.id }));
    if (lost < 0) ops.push(movement(l.c, l.itemId, name, -lost, 'Overskudd ved telling', ev.name, { ref: ev.name, eventId: ev.id }));
  }
  return S.write(ops);
}

/* ---------- Kasse ---------- */
// cart: [{ c, itemId, qty, unitPrice }]
export function registerSale(ev, cart, { payment, discount = 0, note = '' }) {
  const lines = cart.filter(l => num(l.qty) > 0).map(l => {
    const item = S.get(l.c, l.itemId);
    return {
      c: l.c, itemId: l.itemId, name: item?.name || l.name || '', qty: num(l.qty),
      unitPrice: round(num(l.unitPrice)), listPrice: round(listPriceOf(l.c, item)), unitCost: round(unitCostOf(l.c, item), 4),
    };
  });
  if (!lines.length) return Promise.reject(new Error('Handlekurven er tom'));
  const subtotal = round(sum(lines.map(l => l.qty * l.unitPrice)));
  const disc = Math.min(Math.max(0, num(discount)), subtotal);
  const ts = Date.now();
  const sale = {
    eventId: ev.id, ts, day: dayKey(ts), user: S.userEmail(), payment, lines, subtotal, discount: round(disc), total: round(subtotal - disc),
    cost: round(sum(lines.map(l => l.qty * l.unitCost))), note,
  };
  const id = uid();
  const ops = [{ t: 'set', c: 'sales', id, d: sale }];
  for (const l of lines) {
    ops.push(...evStockOps(ev, l.c, l.itemId, l.name, { qty: -l.qty, sold: l.qty }));
    ops.push(movement(l.c, l.itemId, l.name, -l.qty, 'Salg', ev.name, { ref: ev.name, eventId: ev.id, saleId: id }));
  }
  return S.write(ops).then(() => ({ id, ...sale }));
}
export function undoSale(ev, sale) {
  const ops = [{ t: 'del', c: 'sales', id: sale.id }];
  for (const l of sale.lines || []) {
    ops.push(...evStockOps(ev, l.c, l.itemId, l.name, { qty: l.qty, sold: -l.qty }));
    ops.push(movement(l.c, l.itemId, l.name, l.qty, 'Salg angret', ev.name, { ref: ev.name, eventId: ev.id, saleId: sale.id }));
  }
  return S.write(ops);
}

/* ---------- Regnskap og statistikk ---------- */
const emptyAcc = () => ({ revenue: 0, pay: {}, items: 0, customers: 0, cogs: 0, gross: 0, costs: 0, net: 0, margin: null });
function finish(a) {
  a.gross = a.revenue - a.cogs;
  a.net = a.gross - a.costs;
  a.margin = a.revenue > 0 ? a.gross / a.revenue : null;
  return a;
}

export function eventAccounts(ev) {
  const sales = eventSales(ev.id);
  const costs = eventCosts(ev.id);
  const stock = eventStockRows(ev.id);
  const days = daysBetween(ev.startDate, ev.endDate);
  for (const s of sales) if (!days.includes(s.day)) days.push(s.day);
  for (const c of costs) if (c.day && !days.includes(c.day)) days.push(c.day);
  days.sort();

  const byDay = Object.fromEntries(days.map(d => [d, emptyAcc()]));
  const total = emptyAcc();
  const items = new Map(); // c|id -> stats
  const hours = Array.from({ length: 24 }, () => ({ revenue: 0, count: 0 }));
  const statOf = (c, id, name) => {
    const k = c + '|' + id;
    if (!items.has(k)) items.set(k, { c, itemId: id, name, qty: 0, revenue: 0, cogs: 0, profit: 0, sent: 0, onHand: 0, returned: 0, lost: 0, perDay: {} });
    return items.get(k);
  };

  for (const s of sales) {
    const d = byDay[s.day];
    const factor = s.subtotal > 0 ? s.total / s.subtotal : 0;
    for (const acc of [d, total]) {
      acc.revenue += num(s.total);
      acc.pay[s.payment] = (acc.pay[s.payment] || 0) + num(s.total);
      acc.customers += 1;
      acc.cogs += num(s.cost);
    }
    hours[new Date(s.ts).getHours()].revenue += num(s.total);
    hours[new Date(s.ts).getHours()].count += 1;
    for (const l of s.lines || []) {
      d.items += l.qty;
      total.items += l.qty;
      const st = statOf(l.c, l.itemId, l.name);
      const rev = l.qty * l.unitPrice * factor;
      st.qty += l.qty;
      st.revenue += rev;
      st.cogs += l.qty * l.unitCost;
      st.profit += rev - l.qty * l.unitCost;
      st.perDay[s.day] = (st.perDay[s.day] || 0) + l.qty;
    }
  }
  let costsAll = 0;
  for (const c of costs) {
    const a = num(c.amount);
    if (c.day && byDay[c.day]) byDay[c.day].costs += a;
    costsAll += a;
  }
  total.costs = costsAll;
  days.forEach(d => finish(byDay[d]));
  finish(total);

  let stockUnits = 0, stockCost = 0, stockValue = 0, sent = 0, returned = 0, lost = 0, ordered = 0;
  for (const r of stock) {
    const item = S.get(r.c, r.itemId);
    const st = statOf(r.c, r.itemId, item?.name || r.name);
    st.sent = num(r.sent); st.onHand = num(r.qty); st.returned = num(r.returned); st.lost = num(r.lost);
    if (item) st.name = item.name;
    sent += num(r.sent); returned += num(r.returned); lost += num(r.lost); ordered += num(r.ordered);
    const q = Math.max(0, num(r.qty));
    stockUnits += q;
    stockCost += q * unitCostOf(r.c, item);
    stockValue += q * listPriceOf(r.c, item);
  }
  const stats = [...items.values()].map(s => ({ ...s, sellThrough: s.sent > 0 ? s.qty / s.sent : null, thumb: S.get(s.c, s.itemId)?.thumb }));
  const orders = eventOrders(ev.id);
  return {
    days, byDay, total, stats, hours,
    stock: { units: stockUnits, cost: stockCost, value: stockValue, sent, returned, lost, ordered },
    orders: { count: orders.length, sum: sum(orders.map(orderTotal)) },
    costs, sales,
    final: ev.status === 'avsluttet',
  };
}

/* ---------- Bestillinger ---------- */
export const ORDER_STATUS = { ny: 'Ny', levert: 'Levert', kansellert: 'Kansellert' };
export const orderTotal = o => round(sum((o.lines || []).map(l => num(l.qty) * num(l.unitPrice))));
export const orderCost = o => round(sum((o.lines || []).map(l => num(l.qty) * num(l.unitCost))));
export const orderRemaining = o => (o.paid ? 0 : Math.max(0, orderTotal(o) - num(o.deposit)));
export const nextOrderNo = () => Math.max(0, ...S.list('orders').map(o => num(o.no))) + 1;
export const openOrders = () => S.list('orders').filter(o => o.status === 'ny')
  .sort((a, b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));

// Lagerlinjer i en bestilling (fritekst påvirker ikke lager)
const stockLines = o => (o.lines || []).filter(l => (l.type === 'products' || l.type === 'packages') && l.itemId && num(l.qty) > 0);

// source: 'hus' eller en messe-ID
export function deliverOrder(o, source) {
  const ops = [{ t: 'upd', c: 'orders', id: o.id, d: { status: 'levert', deliveredFrom: source, deliveredAt: Date.now() } }];
  const ref = `Bestilling #${o.no} ${o.customer || ''}`.trim();
  const ev = source !== 'hus' ? S.get('events', source) : null;
  for (const l of stockLines(o)) {
    const q = num(l.qty);
    const name = S.get(l.type, l.itemId)?.name || l.name;
    if (ev) {
      ops.push(...evStockOps(ev, l.type, l.itemId, name, { qty: -q, ordered: q }));
      ops.push(movement(l.type, l.itemId, name, -q, 'Bestilling levert', ev.name, { ref, orderId: o.id, eventId: ev.id }));
    } else {
      ops.push({ t: 'inc', c: l.type, id: l.itemId, f: 'stock', v: -q });
      ops.push(movement(l.type, l.itemId, name, -q, 'Bestilling levert', 'Hus', { ref, orderId: o.id }));
    }
  }
  return S.write(ops);
}
export function undoDelivery(o) {
  const ops = [{ t: 'upd', c: 'orders', id: o.id, d: { status: 'ny', deliveredFrom: '', deliveredAt: null } }];
  const ref = `Bestilling #${o.no} ${o.customer || ''}`.trim();
  const ev = o.deliveredFrom && o.deliveredFrom !== 'hus' ? S.get('events', o.deliveredFrom) : null;
  for (const l of stockLines(o)) {
    const q = num(l.qty);
    const name = S.get(l.type, l.itemId)?.name || l.name;
    if (ev) {
      ops.push(...evStockOps(ev, l.type, l.itemId, name, { qty: q, ordered: -q }));
      ops.push(movement(l.type, l.itemId, name, q, 'Levering angret', ev.name, { ref, orderId: o.id, eventId: ev.id }));
    } else {
      ops.push({ t: 'inc', c: l.type, id: l.itemId, f: 'stock', v: q });
      ops.push(movement(l.type, l.itemId, name, q, 'Levering angret', 'Hus', { ref, orderId: o.id }));
    }
  }
  return S.write(ops);
}
export { stockOf };
