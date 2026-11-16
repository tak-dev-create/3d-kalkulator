// Backup til Excel / ZIP (Excel + bilder) og gjenoppretting.
import * as S from './store.js';
import { SCHEMAS, SETTINGS_FIELDS, LINE_SHEETS } from './schema.js';
import { productCostOf, packageCostOf, TYPE_LABEL } from './model.js';
import { printerDepreciation, materialPricePerKg } from './calc.js';
import { downloadBlob, loadScript, JSZIP_URL, safeName, dataUrlBase64, makeThumb, num, uid, round, stamp, hoursToHM } from './util.js';

const XLSX_URL = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs';
let xp;
const xlsx = () => (xp ||= import(XLSX_URL));
const zipLib = async () => { await loadScript(JSZIP_URL); return window.JSZip; };

export const DATA_COLLS = ['printers', 'materials', 'products', 'supplies', 'packages', 'movements',
  'events', 'eventStock', 'eventCosts', 'sales', 'orders'];
const IMG_SHEET = 'Bilder', SET_SHEET = 'Innstillinger';
const TYPE_LABEL_ALL = { ...TYPE_LABEL, custom: 'Fritekst' };
const TYPE_FROM_LABEL = Object.fromEntries(Object.entries(TYPE_LABEL_ALL).flatMap(([k, v]) => [[v, k], [k, k]]));

async function gather() {
  const data = {};
  for (const c of DATA_COLLS) data[c] = await S.fetchAll(c);
  data.settings = S.settings();
  return data;
}

function computed(c, d) {
  if (c === 'products') {
    const k = productCostOf(d);
    return {
      'Printer (navn)': S.get('printers', d.printerId)?.name || '',
      'Filament (navn)': S.get('materials', d.materialId)?.name || '',
      'Selvkost per stk (beregnet)': round(k.unitCost),
      'Foreslått pris (beregnet)': round(k.suggested),
      'Fortjeneste per stk (beregnet)': k.profit == null ? '' : round(k.profit),
    };
  }
  if (c === 'packages') {
    const k = packageCostOf(d);
    return { 'Selvkost (beregnet)': round(k.cost), 'Foreslått pris (beregnet)': round(k.suggested), 'Fortjeneste (beregnet)': k.profit == null ? '' : round(k.profit) };
  }
  if (c === 'materials') return { 'Pris per kg (beregnet)': round(materialPricePerKg(d)) };
  if (c === 'printers') return { 'Avskrivning per time (beregnet)': round(printerDepreciation(d)) };
  return {};
}

function sheetFrom(X, headers, rows) {
  const aoa = [headers, ...rows.map(r => headers.map(h => r[h] ?? ''))];
  const ws = X.utils.aoa_to_sheet(aoa, { cellDates: true });
  ws['!cols'] = headers.map(h => ({ wch: Math.min(40, Math.max(10, h.length + 2)) }));
  return ws;
}

async function buildWorkbook(data, imageRows) {
  const X = await xlsx();
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([
    ['3D Print Kalkulator – backup'],
    ['Laget', new Date()],
    ['Av', S.userEmail()],
    ['Formatversjon', 1],
    [],
    ['Slik bruker du filen'],
    ['• Filen kan åpnes og redigeres i Excel, og leses inn igjen under Backup → Gjenopprett.'],
    ['• Ikke endre ID-kolonnene – de kobler sammen produkter, pakker og bilder.'],
    ['• Kolonner merket «(beregnet)» eller «(navn)» er kun til informasjon og ignoreres ved gjenoppretting.'],
    ['• Nye rader uten ID får automatisk ny ID ved gjenoppretting.'],
  ], { cellDates: true }), 'Info');

  X.utils.book_append_sheet(wb, sheetFrom(X, ['Nøkkel', 'Innstilling', 'Verdi'],
    SETTINGS_FIELDS.map(f => ({ 'Nøkkel': f.k, 'Innstilling': f.l + (f.u ? ` (${f.u})` : ''), 'Verdi': data.settings[f.k] ?? '' }))), SET_SHEET);

  for (const c of DATA_COLLS) {
    const fields = SCHEMAS[c].fields;
    let headers = fields.map(f => f.l);
    const rows = data[c].map(d => {
      const r = {};
      for (const f of fields) {
        let v = d[f.k];
        if (f.t === 'ts') v = v ? new Date(v) : '';
        r[f.l] = v ?? '';
      }
      const extra = computed(c, d);
      for (const h of Object.keys(extra)) if (!headers.includes(h)) headers = [...headers, h];
      return Object.assign(r, extra);
    });
    if (c === 'products' || c === 'packages' || c === 'materials' || c === 'printers') {
      const extra = Object.keys(computed(c, {}));
      for (const h of extra) if (!headers.includes(h)) headers.push(h);
    }
    X.utils.book_append_sheet(wb, sheetFrom(X, headers, rows), SCHEMAS[c].sheet);
  }

  // Undertabeller: pakkeinnhold, salgslinjer, bestillingslinjer
  for (const ls of LINE_SHEETS) {
    const headers = [ls.parent, ...(ls.parentName ? [ls.parentName] : []), ...ls.cols.map(c => c.l)];
    const rows = [];
    for (const p of data[ls.coll] || []) for (const it of p[ls.field] || []) {
      const r = { [ls.parent]: p.id };
      if (ls.parentName) r[ls.parentName] = p.name;
      for (const col of ls.cols) {
        if (col.t === 'type') r[col.l] = TYPE_LABEL_ALL[it[col.k]] || it[col.k] || '';
        else if (col.t === 'name') r[col.l] = S.get(it.type, it.id)?.name || '';
        else r[col.l] = it[col.k] ?? '';
      }
      rows.push(r);
    }
    X.utils.book_append_sheet(wb, sheetFrom(X, headers, rows), ls.sheet);
  }

  if (imageRows) {
    X.utils.book_append_sheet(wb, sheetFrom(X, ['ID', 'Type', 'Vare-ID', 'Vare', 'Fil', 'Bredde', 'Høyde', 'Lagt til', 'Lagt til av'], imageRows), IMG_SHEET);
  }
  return X.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
}

async function markBackup() {
  await S.write([{ t: 'upd', c: 'settings', id: 'general', d: { lastBackupAt: Date.now(), lastBackupBy: S.userEmail() } }]);
}

export async function exportExcel() {
  const data = await gather();
  const arr = await buildWorkbook(data, null);
  downloadBlob(new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `3D-kalkulator_backup_${stamp()}.xlsx`);
  await markBackup();
}

function imageFileName(img, used) {
  const item = S.get(img.c, img.itemId);
  const base = `${safeName(item?.name || img.itemName)}`;
  let n = 1, name;
  do { name = `${base}_${n++}.jpg`; } while (used.has(img.c + '/' + name));
  used.add(img.c + '/' + name);
  return name;
}
const FOLDER = { products: 'produkter', supplies: 'rekvisita', packages: 'pakker', materials: 'filament' };

export async function fullBackup(progress = () => {}) {
  progress('Henter data …');
  const data = await gather();
  progress('Henter bilder …');
  const imgs = await S.images.all();
  const JSZip = await zipLib();
  const zip = new JSZip();
  const used = new Set();
  const rows = [];
  for (const img of imgs) {
    const path = `bilder/${FOLDER[img.c] || 'annet'}/${imageFileName(img, used)}`;
    zip.file(path, dataUrlBase64(img.dataUrl), { base64: true });
    rows.push({ 'ID': img.id, 'Type': TYPE_LABEL[img.c] || img.c, 'Vare-ID': img.itemId, 'Vare': S.get(img.c, img.itemId)?.name || img.itemName || '', 'Fil': path, 'Bredde': img.w, 'Høyde': img.h, 'Lagt til': img.createdAt ? new Date(img.createdAt) : '', 'Lagt til av': img.createdBy || '' });
  }
  progress('Lager Excel …');
  zip.file('data.xlsx', await buildWorkbook(data, rows));
  zip.file('LES-MEG.txt', 'Full backup fra 3D Print Kalkulator.\r\n\r\ndata.xlsx  – alle data (kan åpnes i Excel)\r\nbilder/    – alle produktbilder\r\n\r\nGjenopprett: åpne appen → Backup → Gjenopprett, og velg denne ZIP-filen.\r\n');
  progress('Pakker ZIP …');
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => progress(`Pakker ZIP … ${Math.round(m.percent)} %`));
  downloadBlob(blob, `3D-kalkulator_full-backup_${stamp()}.zip`);
  await markBackup();
  return { images: imgs.length };
}

export async function exportImages(filter, progress = () => {}) {
  progress('Henter bilder …');
  const imgs = (await S.images.all()).filter(img => filter(img));
  if (!imgs.length) throw new Error('Fant ingen bilder for valget');
  const JSZip = await zipLib();
  const zip = new JSZip();
  const used = new Set();
  for (const img of imgs) zip.file(`${FOLDER[img.c] || 'annet'}/${imageFileName(img, used)}`, dataUrlBase64(img.dataUrl), { base64: true });
  const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' }, m => progress(`Pakker … ${Math.round(m.percent)} %`));
  downloadBlob(blob, `3D-kalkulator_bilder_${stamp()}.zip`);
  return imgs.length;
}

/* ---------------- Gjenoppretting ---------------- */
function convert(f, v) {
  if (v === '' || v == null) return undefined;
  switch (f.t) {
    case 'num': return num(v);
    case 'int': return Math.round(num(v));
    case 'bool': return typeof v === 'boolean' ? v : /^(ja|true|1|x|sann)$/i.test(String(v).trim());
    case 'ts': return v instanceof Date ? v.getTime() : (typeof v === 'number' ? v : (Date.parse(v) || undefined));
    case 'date': return v instanceof Date ? new Date(v.getTime() - v.getTimezoneOffset() * 60000).toISOString().slice(0, 10) : String(v);
    case 'hm':
      if (v instanceof Date) return `${v.getHours()}:${String(v.getMinutes()).padStart(2, '0')}`;
      if (typeof v === 'number') return hoursToHM(v < 1 ? v * 24 : v);
      return String(v);
    default: return String(v).trim();
  }
}
function rowToDoc(c, r) {
  const d = {};
  for (const f of SCHEMAS[c].fields) {
    const label = f.l;
    const v = r[label] !== undefined ? r[label] : r[f.k];
    const cv = convert(f, v);
    if (cv !== undefined) d[f.k] = cv;
  }
  if (!d.id) d.id = uid();
  return d;
}

export async function parseBackup(file) {
  const X = await xlsx();
  let buf, zip = null;
  if (/\.zip$/i.test(file.name)) {
    const JSZip = await zipLib();
    zip = await JSZip.loadAsync(file);
    const x = zip.file('data.xlsx');
    if (!x) throw new Error('Fant ikke data.xlsx i ZIP-filen – er dette en full backup fra appen?');
    buf = await x.async('arraybuffer');
  } else buf = await file.arrayBuffer();
  const wb = X.read(buf, { cellDates: true });
  const rowsOf = name => (wb.Sheets[name] ? X.utils.sheet_to_json(wb.Sheets[name], { defval: '' }) : null);
  const out = { settings: null, colls: {}, images: null, counts: {} };

  const sr = rowsOf(SET_SHEET);
  if (sr) {
    out.settings = {};
    for (const r of sr) {
      const f = SETTINGS_FIELDS.find(x => x.k === r['Nøkkel']);
      if (f) { const v = convert(f, r['Verdi']); if (v !== undefined) out.settings[f.k] = v; }
    }
  }
  for (const c of DATA_COLLS) {
    const rows = rowsOf(SCHEMAS[c].sheet);
    if (!rows) continue;
    out.colls[c] = rows.map(r => rowToDoc(c, r)).filter(d => !SCHEMAS[c].fields.some(f => f.k === 'name' && f.req) || d.name);
    out.counts[c] = out.colls[c].length;
  }
  for (const ls of LINE_SHEETS) {
    const lr = rowsOf(ls.sheet);
    if (!lr || !out.colls[ls.coll]) continue;
    const by = new Map(out.colls[ls.coll].map(p => [p.id, p]));
    out.colls[ls.coll].forEach(p => { p[ls.field] = []; });
    for (const r of lr) {
      const p = by.get(String(r[ls.parent]));
      if (!p) continue;
      const it = {};
      for (const col of ls.cols) {
        const v = r[col.l];
        if (col.t === 'name') continue;
        if (col.t === 'type') { const t = TYPE_FROM_LABEL[v]; if (t) it[col.k] = t; }
        else { const cv = convert(col, v); if (cv !== undefined) it[col.k] = cv; }
      }
      if (ls.coll === 'packages' && (!it.type || !it.id)) continue;
      p[ls.field].push(it);
    }
  }
  if (zip) {
    const ir = rowsOf(IMG_SHEET) || [];
    out.images = [];
    for (const r of ir) {
      const f = zip.file(String(r['Fil']));
      if (!f) continue;
      out.images.push({
        id: String(r['ID'] || uid()), c: TYPE_FROM_LABEL[r['Type']] || 'products', itemId: String(r['Vare-ID']), itemName: String(r['Vare'] || ''),
        w: num(r['Bredde']), h: num(r['Høyde']), createdAt: r['Lagt til'] instanceof Date ? r['Lagt til'].getTime() : Date.now(), createdBy: String(r['Lagt til av'] || ''),
        dataUrl: 'data:image/jpeg;base64,' + (await f.async('base64')),
      });
    }
    out.counts.images = out.images.length;
  }
  return out;
}

// mode: 'merge' (oppdater/legg til) eller 'replace' (erstatt alt i de tabellene som finnes i filen)
export async function restore(p, mode, progress = () => {}) {
  progress('Leser eksisterende data …');
  const existing = {};
  for (const c of DATA_COLLS) existing[c] = new Map((await S.fetchAll(c)).map(d => [d.id, d]));
  const ops = [];
  if (mode === 'replace') {
    for (const c of Object.keys(p.colls)) {
      const keep = new Set(p.colls[c].map(d => d.id));
      for (const id of existing[c].keys()) if (!keep.has(id)) ops.push({ t: 'del', c, id });
    }
  }
  // Miniatyrbilder fra bildene i backupen
  const thumbs = new Map();
  if (p.images) {
    progress('Lager miniatyrbilder …');
    for (const img of [...p.images].sort((a, b) => a.createdAt - b.createdAt)) {
      if (!thumbs.has(img.itemId)) { try { thumbs.set(img.itemId, await makeThumb(img.dataUrl)); } catch { /* ignore */ } }
    }
  }
  for (const [c, docs] of Object.entries(p.colls)) {
    for (const d of docs) {
      const old = existing[c].get(d.id);
      const doc = { ...d };
      const t = thumbs.get(d.id) || old?.thumb;
      if (t) doc.thumb = t;
      ops.push({ t: 'set', c, id: d.id, d: doc });
    }
  }
  if (p.settings) ops.push({ t: 'upd', c: 'settings', id: 'general', d: p.settings });
  progress(`Skriver ${ops.length} endringer …`);
  await S.write(ops, { wait: true });
  if (p.images) {
    if (mode === 'replace') { progress('Sletter gamle bilder …'); await S.images.delAll(); }
    let i = 0;
    for (const img of p.images) {
      progress(`Laster opp bilder … ${++i}/${p.images.length}`);
      await S.images.put(img);
    }
  }
  progress('Ferdig');
}
