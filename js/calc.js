// Prisberegning – samme logikk som Excel-arket "3D pris kalkulator".
import { num, parseHours, sum } from './util.js';

export const DEFAULT_SETTINGS = {
  companyName: '',
  energyCost: 0.27,
  laborCost: 0,
  failureRate: 10,
  defaultMarkup: 1.6,
  vatRate: 0,
  currency: 'NOK',
  backupReminderDays: 7,
  lastBackupAt: null,
};

// Printere!G = (Pris + Servicekost) / Levetid
export function printerDepreciation(p) {
  const t = num(p?.deprecTime);
  return t > 0 ? (num(p.price) + num(p.serviceCost)) / t : 0;
}
// Materials!I = Spolepris / Spolestørrelse
export function materialPricePerKg(m) {
  const k = num(m?.spoolKg);
  return k > 0 ? num(m.spoolPrice) / k : 0;
}
// Lengde filament i meter for gitt vekt
export function filamentLength(grams, m) {
  const dens = num(m?.density), d = num(m?.diameter);
  if (!dens || !d) return 0;
  const volMm3 = (grams / dens) * 1000;
  return volMm3 / (Math.PI * d * d / 4) / 1000;
}
export const lengthPerRoll = m => filamentLength(num(m?.spoolKg) * 1000, m);

export function productCost(p, printer, mat, s) {
  const hours = parseHours(p.printTime);
  const grams = num(p.grams);
  const units = Math.max(1, Math.round(num(p.unitsPerPrint)) || 1);
  const prepMin = num(p.cadMin) + num(p.fileMin) + num(p.matChangeMin) + num(p.transferMin);
  const postMin = num(p.removeMin) + num(p.supportMin) + num(p.packMin);
  const labor = num(s.laborCost);
  const lines = {
    design: num(p.designCost),
    filament: grams / 1000 * materialPricePerKg(mat),
    energy: hours * num(printer?.energy) * num(s.energyCost),
    wear: hours * printerDepreciation(printer),
    prep: prepMin / 60 * labor,
    post: postMin / 60 * labor,
    consumables: num(p.consumables),
  };
  const subtotal = sum(Object.values(lines));
  const withLoss = subtotal * (1 + num(s.failureRate) / 100);
  const unitCost = withLoss / units;
  const markup = num(p.markup);
  const suggested = unitCost * markup;
  return {
    hours, grams, units, prepMin, postMin, lines, subtotal, withLoss, unitCost, markup, suggested,
    lengthM: filamentLength(grams, mat),
    gramsPerUnit: grams / units,
    ...profitOf(num(p.quotedPrice), unitCost, s),
    missing: { printer: !printer, material: !mat },
  };
}

export function profitOf(quoted, cost, s) {
  const net = quoted / (1 + num(s.vatRate) / 100);
  const profit = quoted > 0 ? net - cost : null;
  const margin = quoted > 0 && net > 0 ? profit / net : null;
  return { quoted, net, profit, margin };
}

// resolve(item) -> { name, unitCost, listPrice } | null
export function packageCost(pkg, resolve, s) {
  const lines = (pkg.items || []).map(it => {
    const r = resolve(it);
    const qty = num(it.qty);
    return {
      ...it, qty, name: r?.name || '(slettet vare)', missing: !r,
      unitCost: r?.unitCost || 0, total: (r?.unitCost || 0) * qty,
      listTotal: (r?.listPrice ?? r?.unitCost ?? 0) * qty,
    };
  });
  const componentCost = sum(lines.map(l => l.total));
  const labor = num(pkg.packMin) / 60 * num(s.laborCost);
  const extra = num(pkg.extraCost);
  const cost = componentCost + labor + extra;
  const markup = num(pkg.markup);
  return {
    lines, componentCost, labor, extra, cost, markup,
    suggested: cost * markup,
    listValue: sum(lines.map(l => l.listTotal)) + extra,
    ...profitOf(num(pkg.quotedPrice), cost, s),
  };
}
