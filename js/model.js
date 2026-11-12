// Forretningslogikk: kostnader, lagerbevegelser, strekkoder, startdata.
import * as S from './store.js';
import { productCost, packageCost } from './calc.js';
import { num, uid, round } from './util.js';
import { defaults } from './schema.js';

export const TYPE_LABEL = { products: 'Produkt', supplies: 'Rekvisita', packages: 'Pakke', materials: 'Filament', printers: 'Printer' };
export const TYPE_ROUTE = { products: 'produkter', supplies: 'rekvisita', packages: 'pakker', materials: 'utstyr/filament', printers: 'utstyr/printere' };
export const TYPE_ICON = { products: '🧩', supplies: '📦', packages: '🎁', materials: '🧵', printers: '🖨️' };
export const STOCK_COLLS = ['products', 'supplies', 'packages', 'materials'];

export const stockField = c => (c === 'materials' ? 'stockGrams' : 'stock');
export const unitOf = (c, item) => (c === 'materials' ? 'g' : (c === 'supplies' ? (item?.unit || 'stk') : 'stk'));
export const stockOf = (c, item) => num(item?.[stockField(c)]);
export const isLow = (c, item) => num(item?.lowStock) > 0 && stockOf(c, item) < num(item.lowStock);
export const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'nb');

export function productCostOf(p) {
  return productCost(p, S.get('printers', p.printerId), S.get('materials', p.materialId), S.settings());
}
export function resolveComponent(it) {
  if (it.type === 'products') {
    const p = S.get('products', it.id);
    return p && { name: p.name, unitCost: productCostOf(p).unitCost, listPrice: num(p.quotedPrice) || productCostOf(p).suggested, item: p };
  }
  const s = S.get('supplies', it.id);
  return s && { name: s.name, unitCost: num(s.unitCost), item: s };
}
export const packageCostOf = pkg => packageCost(pkg, resolveComponent, S.settings());

// Hvor mange pakker kan lages av nåværende komponentlager
export function packagesPossible(pkg) {
  let n = Infinity;
  for (const it of pkg.items || []) {
    const q = num(it.qty);
    if (q <= 0) continue;
    const item = S.get(it.type, it.id);
    n = Math.min(n, Math.floor(stockOf(it.type, item) / q));
  }
  return n === Infinity ? 0 : Math.max(0, n);
}

export function moveStock(entries, reason, note = '', extra = {}) {
  const ops = [];
  const ts = Date.now();
  const user = S.userEmail();
  for (const e of entries) {
    const delta = round(e.delta, 3);
    if (!delta) continue;
    const item = S.get(e.c, e.id);
    ops.push({ t: 'inc', c: e.c, id: e.id, f: stockField(e.c), v: delta });
    ops.push({
      t: 'set', c: 'movements', id: uid(),
      d: { ts, user, c: e.c, itemId: e.id, name: item?.name || '', delta, unit: unitOf(e.c, item), reason, note, ...extra },
    });
  }
  return ops.length ? S.write(ops) : Promise.resolve();
}
export function setCount(c, id, newValue, note = '') {
  const cur = stockOf(c, S.get(c, id));
  return moveStock([{ c, id, delta: num(newValue) - cur }], 'Telling', note);
}
export function printNeeds(p, units) {
  const per = num(p.grams) / Math.max(1, num(p.unitsPerPrint) || 1);
  return { materialId: p.materialId, grams: per * units };
}
export function registerPrint(p, units, note = '') {
  const need = printNeeds(p, units);
  const entries = [{ c: 'products', id: p.id, delta: units }];
  if (need.materialId && S.get('materials', need.materialId)) entries.push({ c: 'materials', id: need.materialId, delta: -need.grams });
  return moveStock(entries, 'Produsert (print)', note, { ref: p.name });
}
export const componentEntries = (pkg, n) => (pkg.items || []).map(it => ({ c: it.type, id: it.id, delta: -num(it.qty) * n }));
export function packPackage(pkg, n, note = '') {
  return moveStock([...componentEntries(pkg, n), { c: 'packages', id: pkg.id, delta: n }], 'Pakket', note, { ref: pkg.name });
}
export function sellPackageDirect(pkg, n, note = '') {
  return moveStock(componentEntries(pkg, n), 'Salg (pakke)', note, { ref: pkg.name });
}

export function allBarcodes() {
  const s = new Set();
  for (const c of STOCK_COLLS) for (const it of S.list(c)) if (it.barcode) s.add(String(it.barcode));
  return s;
}
export function findByBarcode(code) {
  code = String(code || '').trim();
  if (!code) return null;
  for (const c of STOCK_COLLS) {
    const item = S.list(c).find(it => String(it.barcode || '').trim() === code);
    if (item) return { c, item };
  }
  return null;
}
export function usedInPackages(c, id) {
  return S.list('packages').filter(p => (p.items || []).some(it => it.type === c && it.id === id));
}

// Startdata hentet fra Excel-arket "3D pris kalkulator.xlsx"
export function seedOps() {
  const ops = [];
  const pr = {};
  const printers = [
    ['Ender 3', 4000, 2000, 1000, 0.2],
    ['Seremoon D1', 6000, 2000, 1000, 0.2],
    ['Flashforge Adventurer 3', 4000, 2000, 1000, 0.2],
    ['Bambu X1 Carbon', 20000, 3000, 2000, 0.4],
  ];
  for (const [name, price, deprecTime, serviceCost, energy] of printers) {
    const d = defaults('printers', { name, price, deprecTime, serviceCost, energy, diameter: 1.75 });
    pr[name] = d.id;
    ops.push({ t: 'set', c: 'printers', id: d.id, d });
  }
  const mt = {};
  const mats = [
    ['Esun PLA+', 'PLA', 240, 1, 1.24, 220, 60],
    ['Clas Ohlsson', 'PLA', 200, 1, 1.24, 215, 60],
    ['Prima PLA glossy', 'PLA', 320, 0.75, 1.24, 225, 60],
    ['Prima silk Magic', 'PLA', 370, 0.75, 1.24, 220, 35],
    ['Esun TPU', 'TPU', 320, 1, 1.34, 220, 55],
  ];
  for (const [name, material, spoolPrice, spoolKg, density, nozzleTemp, bedTemp] of mats) {
    const d = defaults('materials', { name, material, spoolPrice, spoolKg, density, nozzleTemp, bedTemp, diameter: 1.75 });
    mt[name] = d.id;
    ops.push({ t: 'set', c: 'materials', id: d.id, d });
  }
  ops.push({ t: 'upd', c: 'settings', id: 'general', d: { energyCost: 0.27, laborCost: 0, failureRate: 10, currency: 'NOK', defaultMarkup: 1.6, vatRate: 0 } });
  const coaster = defaults('products', {
    name: 'Coasters', customer: 'Clas Ohlsson', description: 'coasters', printerId: pr['Bambu X1 Carbon'], materialId: mt['Clas Ohlsson'],
    grams: 80, printTime: '3:11', cadMin: 0, fileMin: 5, matChangeMin: 5, transferMin: 2, removeMin: 3, supportMin: 2, packMin: 2,
    consumables: 10, designCost: 0, markup: 1.6, quotedPrice: 135, date: '2022-01-05',
  });
  ops.push({ t: 'set', c: 'products', id: coaster.id, d: coaster });
  const cork = defaults('supplies', { name: 'Korkplate (eksempel)', category: 'Beskyttelse', unitCost: 0, notes: 'Eksempel – sett riktig kostpris' });
  const bag = defaults('supplies', { name: 'Plastpose (eksempel)', category: 'Emballasje', unitCost: 0, notes: 'Eksempel – sett riktig kostpris' });
  ops.push({ t: 'set', c: 'supplies', id: cork.id, d: cork }, { t: 'set', c: 'supplies', id: bag.id, d: bag });
  const pkg = defaults('packages', {
    name: 'Coaster-sett 3 stk (eksempel)',
    items: [{ type: 'products', id: coaster.id, qty: 3 }, { type: 'supplies', id: cork.id, qty: 3 }, { type: 'supplies', id: bag.id, qty: 1 }],
  });
  ops.push({ t: 'set', c: 'packages', id: pkg.id, d: pkg });
  return ops;
}
