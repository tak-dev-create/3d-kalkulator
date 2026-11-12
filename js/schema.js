import { uid } from './util.js';

// Felles feltdefinisjoner: brukes både av skjemaene i appen og av Excel-backup/gjenoppretting.
// t: id | text | textarea | num | int | ref | barcode | date | hm (t:mm) | ts (tidsstempel)
export const SETTINGS_FIELDS = [
  { k: 'companyName', l: 'Firmanavn', t: 'text' },
  { k: 'energyCost', l: 'Strømpris', t: 'num', u: 'kr/kWh' },
  { k: 'laborCost', l: 'Timepris arbeid', t: 'num', u: 'kr/t', help: 'Brukes for forberedelser, etterarbeid og pakking. 0 = arbeid tas ikke med.' },
  { k: 'failureRate', l: 'Kvalitetstap / feilprint', t: 'num', u: '%' },
  { k: 'defaultMarkup', l: 'Standard påslag (faktor)', t: 'num', u: '×', help: '1,6 = selvkost + 60 %' },
  { k: 'vatRate', l: 'MVA-sats', t: 'num', u: '%', help: '0 = ikke MVA-registrert. Salgspris tolkes som inkl. MVA.' },
  { k: 'currency', l: 'Valuta', t: 'text', help: 'ISO-kode, f.eks. NOK' },
  { k: 'backupReminderDays', l: 'Påminnelse om backup etter', t: 'int', u: 'dager' },
];

const ID = { k: 'id', l: 'ID', t: 'id' };
const NAME = { k: 'name', l: 'Navn', t: 'text', req: true, wide: true };
const BARCODE = { k: 'barcode', l: 'Strekkode (EAN)', t: 'barcode', wide: true };
const LOCATION = { k: 'location', l: 'Lagerplass', t: 'text' };
const NOTES = { k: 'notes', l: 'Notater', t: 'textarea', wide: true };

export const SCHEMAS = {
  printers: {
    sheet: 'Printere', title: 'Printer', fields: [
      ID, NAME,
      { k: 'diameter', l: 'Filamentdiameter', t: 'num', u: 'mm', def: 1.75 },
      { k: 'price', l: 'Innkjøpspris', t: 'num', u: 'kr', def: 0 },
      { k: 'deprecTime', l: 'Forventet levetid', t: 'num', u: 'timer', def: 2000 },
      { k: 'serviceCost', l: 'Servicekost over levetid', t: 'num', u: 'kr', def: 0 },
      { k: 'energy', l: 'Strømforbruk', t: 'num', u: 'kWh/t', def: 0.2 },
      NOTES,
    ],
  },
  materials: {
    sheet: 'Filament', title: 'Filament', images: true, fields: [
      ID, NAME,
      { k: 'material', l: 'Materiale', t: 'text', ph: 'PLA, PETG, TPU …' },
      { k: 'color', l: 'Farge', t: 'text' },
      BARCODE,
      { k: 'diameter', l: 'Diameter', t: 'num', u: 'mm', def: 1.75 },
      { k: 'spoolPrice', l: 'Spolepris', t: 'num', u: 'kr', def: 0 },
      { k: 'spoolKg', l: 'Spolestørrelse', t: 'num', u: 'kg', def: 1 },
      { k: 'density', l: 'Tetthet', t: 'num', u: 'g/cm³', def: 1.24 },
      { k: 'nozzleTemp', l: 'Dysetemperatur', t: 'num', u: '°C' },
      { k: 'bedTemp', l: 'Platetemperatur', t: 'num', u: '°C' },
      { k: 'stockGrams', l: 'Lager', t: 'num', u: 'g', def: 0, stock: true },
      { k: 'lowStock', l: 'Varsle under', t: 'num', u: 'g', def: 200 },
      { k: 'source', l: 'Leverandør / kilde', t: 'text' },
      LOCATION, NOTES,
    ],
  },
  supplies: {
    sheet: 'Rekvisita', title: 'Rekvisita', images: true, fields: [
      ID, NAME,
      { k: 'category', l: 'Kategori', t: 'text', ph: 'Emballasje, beskyttelse …' },
      BARCODE,
      { k: 'unit', l: 'Enhet', t: 'text', def: 'stk' },
      { k: 'unitCost', l: 'Kostpris per enhet', t: 'num', u: 'kr', def: 0, help: 'Tips: pakkepris ÷ antall i pakken' },
      { k: 'stock', l: 'Lager', t: 'num', def: 0, stock: true },
      { k: 'lowStock', l: 'Varsle under', t: 'num', def: 0 },
      { k: 'supplier', l: 'Leverandør', t: 'text' },
      LOCATION, NOTES,
    ],
  },
  products: {
    sheet: 'Produkter', title: 'Produkt', images: true, fields: [
      ID, NAME, BARCODE,
      { k: 'category', l: 'Kategori', t: 'text' },
      { k: 'customer', l: 'Kunde', t: 'text' },
      { k: 'date', l: 'Dato', t: 'date' },
      { k: 'description', l: 'Beskrivelse', t: 'textarea', wide: true },
      { k: 'printerId', l: 'Printer', t: 'ref', ref: 'printers' },
      { k: 'materialId', l: 'Filament', t: 'ref', ref: 'materials' },
      { k: 'grams', l: 'Filamentvekt per print', t: 'num', u: 'g', def: 0 },
      { k: 'printTime', l: 'Printtid', t: 'hm', u: 't:mm', def: '0:00' },
      { k: 'unitsPerPrint', l: 'Antall stk per print', t: 'int', def: 1, help: 'Antall like objekter på samme plate' },
      { k: 'cadMin', l: 'Tilpasning, CAD, konsulenttid', t: 'num', u: 'min', def: 0 },
      { k: 'fileMin', l: 'Klargjøre fil til print', t: 'num', u: 'min', def: 5 },
      { k: 'matChangeMin', l: 'Materialbytte', t: 'num', u: 'min', def: 5 },
      { k: 'transferMin', l: 'Overføring og oppstart', t: 'num', u: 'min', def: 2 },
      { k: 'removeMin', l: 'Fjerne print fra plate', t: 'num', u: 'min', def: 3 },
      { k: 'supportMin', l: 'Fjerne support og rens', t: 'num', u: 'min', def: 2 },
      { k: 'packMin', l: 'Annet, pakking, emballasje', t: 'num', u: 'min', def: 2 },
      { k: 'consumables', l: 'Forbruksartikler', t: 'num', u: 'kr', def: 10 },
      { k: 'designCost', l: 'Design (ekstern bistand)', t: 'num', u: 'kr', def: 0 },
      { k: 'markup', l: 'Påslag (faktor)', t: 'num', u: '×', def: 1.6 },
      { k: 'quotedPrice', l: 'Salgspris per stk', t: 'num', u: 'kr', def: 0 },
      { k: 'stock', l: 'Lager', t: 'num', u: 'stk', def: 0, stock: true },
      { k: 'lowStock', l: 'Varsle under', t: 'num', u: 'stk', def: 0 },
      LOCATION, NOTES,
    ],
  },
  packages: {
    sheet: 'Pakker', title: 'Pakke', images: true, fields: [
      ID, NAME, BARCODE,
      { k: 'category', l: 'Kategori', t: 'text' },
      { k: 'description', l: 'Beskrivelse', t: 'textarea', wide: true },
      { k: 'packMin', l: 'Pakketid', t: 'num', u: 'min', def: 2 },
      { k: 'extraCost', l: 'Ekstra kostnad', t: 'num', u: 'kr', def: 0, help: 'F.eks. frakt eller annet som ikke er på lager' },
      { k: 'markup', l: 'Påslag (faktor)', t: 'num', u: '×', def: 1.6 },
      { k: 'quotedPrice', l: 'Salgspris', t: 'num', u: 'kr', def: 0 },
      { k: 'stock', l: 'Ferdigpakket på lager', t: 'num', u: 'stk', def: 0, stock: true },
      { k: 'lowStock', l: 'Varsle under', t: 'num', u: 'stk', def: 0 },
      LOCATION, NOTES,
    ],
  },
  movements: {
    sheet: 'Lagerlogg', title: 'Bevegelse', fields: [
      ID,
      { k: 'ts', l: 'Tidspunkt', t: 'ts' },
      { k: 'user', l: 'Bruker', t: 'text' },
      { k: 'c', l: 'Type', t: 'text' },
      { k: 'itemId', l: 'Vare-ID', t: 'text' },
      { k: 'name', l: 'Vare', t: 'text' },
      { k: 'delta', l: 'Endring', t: 'num' },
      { k: 'unit', l: 'Enhet', t: 'text' },
      { k: 'reason', l: 'Årsak', t: 'text' },
      { k: 'note', l: 'Notat', t: 'text' },
      { k: 'ref', l: 'Referanse', t: 'text' },
    ],
  },
};

export const fieldOf = (c, k) => SCHEMAS[c].fields.find(f => f.k === k);
export const stockFieldDef = c => SCHEMAS[c].fields.find(f => f.stock);

export function defaults(c, overrides = {}) {
  const d = { id: uid() };
  for (const f of SCHEMAS[c].fields) if (f.def !== undefined) d[f.k] = f.def;
  return { ...d, ...overrides };
}
