// Felles redigeringsside for elementer (rekvisita, filament, printere, produkter, pakker).
import { html, useState } from './lib.js';
import * as S from './store.js';
import { SCHEMAS, defaults } from './schema.js';
import { num, uid } from './util.js';
import { stockField, usedInPackages, TYPE_LABEL } from './model.js';
import { Fields, PageHead, ImageGallery, StockDialog, StockBadge, toast, go, takeDraft, Empty } from './components.js';

export function useEditor(c, id, back, makeDefaults) {
  const isNew = id === 'ny';
  const existing = isNew ? null : S.get(c, id);
  const [d, setD] = useState(() => (existing ? { ...existing } : { ...(makeDefaults ? makeDefaults() : defaults(c)), ...takeDraft() }));
  const [saved, setSaved] = useState(!isNew);
  const [stockDlg, setStockDlg] = useState(null);
  const live = S.get(c, d.id);
  const sf = stockField(c);
  const hasStock = SCHEMAS[c].fields.some(f => f.stock);

  function save(extra = {}) {
    if (!String(d.name || '').trim()) { toast('Navn må fylles ut', 'err'); return false; }
    const doc = { ...d, ...extra, name: d.name.trim(), updatedAt: Date.now(), updatedBy: S.userEmail() };
    delete doc.thumb;
    const ops = [];
    if (!saved) {
      doc.createdAt = Date.now();
      if (hasStock) {
        const start = num(doc[sf]);
        doc[sf] = 0;
        ops.push({ t: 'set', c, id: d.id, d: doc });
        if (start) {
          ops.push({ t: 'inc', c, id: d.id, f: sf, v: start });
          ops.push({ t: 'set', c: 'movements', id: uid(), d: { ts: Date.now(), user: S.userEmail(), c, itemId: d.id, name: doc.name, delta: start, unit: c === 'materials' ? 'g' : (doc.unit || 'stk'), reason: 'Startbeholdning', note: '' } });
        }
      } else ops.push({ t: 'set', c, id: d.id, d: doc });
    } else {
      delete doc[sf]; // lager endres kun via lagerjustering (logges)
      ops.push({ t: 'upd', c, id: d.id, d: doc });
    }
    S.write(ops);
    setSaved(true);
    if (!saved) history.replaceState(null, '', `#/${back}/${d.id}`);
    toast('Lagret');
    return true;
  }
  async function remove() {
    const used = usedInPackages(c, d.id);
    const msg = used.length
      ? `«${d.name}» brukes i ${used.length} pakke(r): ${used.map(p => p.name).join(', ')}.\nSlette likevel?`
      : `Slette «${d.name}»? Dette kan ikke angres (men finnes i tidligere backup).`;
    if (!confirm(msg)) return;
    S.write([{ t: 'del', c, id: d.id }]);
    try { for (const img of await S.images.byItem(d.id)) await S.images.del(img.id); } catch (e) { console.warn(e); }
    toast('Slettet');
    go(back);
  }
  function duplicate() {
    const copy = { ...d, id: uid(), name: d.name + ' (kopi)', barcode: '', thumb: '' };
    if (hasStock) copy[sf] = 0;
    S.write([{ t: 'set', c, id: copy.id, d: { ...copy, createdAt: Date.now() } }]);
    toast('Kopi laget');
    go(`${back}/${copy.id}`);
  }
  return { isNew, existing, d, setD, saved, save, remove, duplicate, live, stockDlg, setStockDlg, sf, hasStock };
}

export function NotFound({ back }) {
  return html`<${Empty} icon="🔍" title="Fant ikke elementet">Det kan være slettet. <a href=${'#/' + back}>Tilbake</a><//>`;
}

export function StockPanel({ c, ed }) {
  if (!ed.hasStock) return null;
  if (!ed.saved) return null;
  const item = ed.live || ed.d;
  return html`<div class="panel">
    <h2>Lager</h2>
    <div class="row"><span style="font-size:1.3rem"><${StockBadge} c=${c} item=${item}/></span>
      <span class="grow"></span>
      <button class="btn primary small" onClick=${() => ed.setStockDlg(true)}>Juster lager</button></div>
    <p class="muted small" style="margin-bottom:0">Lagerendringer logges i lagerloggen.</p>
    ${ed.stockDlg && html`<${StockDialog} c=${c} item=${item} onClose=${() => ed.setStockDlg(null)}/>`}
  </div>`;
}

export function SaveBar({ ed, children }) {
  return html`<div class="savebar">
    <button class="btn primary" onClick=${() => ed.save()}>💾 Lagre</button>
    ${children}
    <span class="grow"></span>
    ${ed.saved && html`<button class="btn" onClick=${ed.duplicate}>Dupliser</button>`}
    ${ed.saved && html`<button class="btn danger" onClick=${ed.remove}>Slett</button>`}
  </div>`;
}

// Enkel editor drevet av skjema (rekvisita, filament, printere)
export function CrudEditor({ c, id, back, aside }) {
  const ed = useEditor(c, id, back);
  if (!ed.isNew && !ed.existing) return html`<${NotFound} back=${back}/>`;
  const schema = SCHEMAS[c];
  const fields = schema.fields.filter(f => !(f.stock && ed.saved));
  return html`
    <${PageHead} title=${ed.isNew && !ed.saved ? `Ny ${schema.title.toLowerCase()}` : ed.d.name || schema.title} back=${back}/>
    <div class="editor">
      <div>
        <div class="panel"><${Fields} fields=${fields} value=${ed.d} set=${ed.setD}/></div>
        ${schema.images && html`<div class="panel"><h2>Bilder</h2><${ImageGallery} c=${c} item=${ed.d} saved=${ed.saved}/></div>`}
        <${SaveBar} ed=${ed}/>
      </div>
      <div class="aside">
        <${StockPanel} c=${c} ed=${ed}/>
        ${aside && aside(ed.d)}
      </div>
    </div>`;
}

export { TYPE_LABEL };
