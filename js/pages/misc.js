// Oversikt, Lagerlogg, Backup, Innstillinger
import { html, useState, useRef } from '../lib.js';
import * as S from '../store.js';
import { SETTINGS_FIELDS } from '../schema.js';
import { money, fmt, fmtDate, num } from '../util.js';
import {
  productCostOf, packageCostOf, isLow, stockOf, unitOf, byName, seedOps, STOCK_COLLS, TYPE_LABEL, TYPE_ROUTE, TYPE_ICON,
} from '../model.js';
import { PageHead, Fields, Empty, SearchBox, Seg, Modal, toast, go, textMatch, refLabel } from '../components.js';
import { exportExcel, fullBackup, exportImages, parseBackup, restore, DATA_COLLS } from '../backup.js';

const daysSince = ts => (ts ? (Date.now() - ts) / 86400000 : Infinity);

export function BackupReminder() {
  const s = S.settings();
  const d = daysSince(s.lastBackupAt);
  if (d < (num(s.backupReminderDays) || 7)) return null;
  return html`<div class="notice warn row">
    <span class="grow">💾 ${s.lastBackupAt ? `Det er ${Math.floor(d)} dager siden forrige backup.` : 'Det er ikke tatt backup ennå.'}</span>
    <a class="btn small" href="#/backup">Ta backup nå</a></div>`;
}

/* ---------------- Oversikt ---------------- */
export function Dashboard() {
  const prods = S.list('products'), sup = S.list('supplies'), pk = S.list('packages'), mats = S.list('materials');
  const empty = !S.list('printers').length && !mats.length && !prods.length;
  const low = STOCK_COLLS.flatMap(c => S.list(c).filter(i => isLow(c, i)).map(i => ({ c, i })));
  const stockValue = prods.reduce((a, p) => a + Math.max(0, stockOf('products', p)) * productCostOf(p).unitCost, 0)
    + sup.reduce((a, s) => a + Math.max(0, stockOf('supplies', s)) * num(s.unitCost), 0)
    + mats.reduce((a, m) => a + Math.max(0, stockOf('materials', m)) / 1000 * (num(m.spoolKg) ? num(m.spoolPrice) / num(m.spoolKg) : 0), 0)
    + pk.reduce((a, p) => a + Math.max(0, stockOf('packages', p)) * packageCostOf(p).cost, 0);
  const moves = S.list('movements').sort((a, b) => b.ts - a.ts).slice(0, 8);
  const s = S.settings();
  function seed() {
    S.write(seedOps());
    toast('Startdata lagt inn');
  }
  return html`
    <${PageHead} title=${s.companyName ? `Oversikt – ${s.companyName}` : 'Oversikt'}/>
    ${S.state.mode === 'local' && html`<div class="notice info">Lokal modus: data lagres bare i denne nettleseren. Koble til Firebase for synk mellom enheter og brukere.</div>`}
    <${BackupReminder}/>
    ${empty && html`<div class="panel"><h2>Kom i gang</h2>
      <p>Legg inn printerne, filamentene og innstillingene fra Excel-arket ditt («3D pris kalkulator.xlsx»), pluss et eksempel på produkt og pakke.</p>
      <div class="row"><button class="btn primary" onClick=${seed}>Last inn startdata</button>
      <a class="btn" href="#/backup">…eller gjenopprett fra backup</a></div></div>`}
    <div class="grid-stats">
      <a class="stat" href="#/produkter"><div class="v">${prods.length}</div><div class="l">🧩 Produkter</div></a>
      <a class="stat" href="#/rekvisita"><div class="v">${sup.length}</div><div class="l">📦 Rekvisita</div></a>
      <a class="stat" href="#/pakker"><div class="v">${pk.length}</div><div class="l">🎁 Pakker</div></a>
      <a class="stat" href="#/utstyr/filament"><div class="v">${fmt(mats.reduce((a, m) => a + Math.max(0, stockOf('materials', m)), 0) / 1000, 2)} kg</div><div class="l">🧵 Filament på lager</div></a>
      <div class="stat"><div class="v">${money(stockValue)}</div><div class="l">Lagerverdi (selvkost)</div></div>
    </div>
    <div class="two-col">
      <div class="panel"><h2>Lavt lager ${low.length > 0 && html`<span class="badge warn">${low.length}</span>`}</h2>
        ${low.length === 0 ? html`<p class="muted">Alt over varslingsgrensen 👍</p>` : html`<div class="mini-list">${low.map(({ c, i }) => {
          const label = c === 'materials' ? refLabel('materials', i) : i.name;
          return html`<a class="mini-row" key=${c + i.id} href=${'#/' + TYPE_ROUTE[c] + '/' + i.id}>
            <span class="ico">${TYPE_ICON[c]}</span>
            <div class="mini-main"><div class="mini-name">${label}</div><div class="mini-sub">${TYPE_LABEL[c]}${i.location ? ' · ' + i.location : ''}</div></div>
            <div class="mini-val"><div class=${stockOf(c, i) <= 0 ? 'neg' : ''}>${fmt(stockOf(c, i))} ${unitOf(c, i)}</div>
              <div class="mini-sub">min ${fmt(i.lowStock)}</div></div>
          </a>`;
        })}</div>`}
      </div>
      <div class="panel"><h2>Siste lagerbevegelser</h2>
        ${moves.length === 0 ? html`<p class="muted">Ingen bevegelser ennå.</p>` : html`<div class="mini-list">${moves.map(m => html`
          <div class="mini-row" key=${m.id}>
            <span class="ico">${TYPE_ICON[m.c] || ''}</span>
            <div class="mini-main"><div class="mini-name">${m.name}</div><div class="mini-sub">${fmtDate(m.ts)} · ${m.reason}</div></div>
            <div class="mini-val"><span class=${m.delta < 0 ? 'neg' : 'pos'}>${m.delta > 0 ? '+' : ''}${fmt(m.delta)} ${m.unit}</span></div>
          </div>`)}</div>
          <a href="#/logg" class="small">Se hele loggen →</a>`}
      </div>
    </div>`;
}

/* ---------------- Lagerlogg ---------------- */
export function Log() {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const rows = S.list('movements').filter(m => (!type || m.c === type) && textMatch(q, m.name, m.reason, m.note, m.user, m.ref)).sort((a, b) => b.ts - a.ts);
  return html`
    <${PageHead} title="Lagerlogg"/>
    <div class="row" style="margin-bottom:12px">
      <div class="grow" style="min-width:220px"><${SearchBox} value=${q} onInput=${setQ}/></div>
      <select style="width:auto; margin-bottom:12px" value=${type} onChange=${e => setType(e.target.value)}>
        <option value="">Alle typer</option>${STOCK_COLLS.map(c => html`<option value=${c}>${TYPE_LABEL[c]}</option>`)}</select>
    </div>
    ${rows.length === 0 ? html`<${Empty} icon="📜" title="Ingen bevegelser"><//>` : html`
    <div class="panel table-wrap"><table>
      <thead><tr><th>Tid</th><th>Vare</th><th class="num">Endring</th><th>Årsak</th><th>Notat</th><th>Bruker</th></tr></thead>
      <tbody>${rows.slice(0, 1000).map(m => html`<tr key=${m.id}>
        <td class="small muted" style="white-space:nowrap">${fmtDate(m.ts)}</td>
        <td>${TYPE_ICON[m.c] || ''} ${S.get(m.c, m.itemId) ? html`<a href=${'#/' + TYPE_ROUTE[m.c] + '/' + m.itemId}>${m.name}</a>` : m.name}</td>
        <td class=${'num ' + (m.delta < 0 ? 'neg' : 'pos')}>${m.delta > 0 ? '+' : ''}${fmt(m.delta)} ${m.unit}</td>
        <td>${m.reason}${m.ref && m.ref !== m.name ? html`<div class="small muted">${m.ref}</div>` : ''}</td>
        <td class="small">${m.note}</td><td class="small muted">${m.user}</td></tr>`)}</tbody>
    </table></div>
    ${S.state.mode === 'cloud' && html`<p class="muted small">Viser de siste 500 bevegelsene. Hele loggen er med i Excel-backupen.</p>`}`}`;
}

/* ---------------- Backup ---------------- */
export function Backup() {
  const [busy, setBusy] = useState('');
  const [parsed, setParsed] = useState(null);
  const [mode, setMode] = useState('merge');
  const [imgScope, setImgScope] = useState('all');
  const fileRef = useRef();
  const s = S.settings();
  async function run(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); } catch (e) { console.error(e); toast(e.message || String(e), 'err'); }
    setBusy('');
  }
  async function pick(file) {
    if (!file) return;
    setBusy('Leser fil …');
    await run(async () => setParsed({ file: file.name, data: await parseBackup(file) }));
  }
  async function doRestore() {
    const msg = mode === 'replace'
      ? 'ERSTATT: Alt som ikke finnes i backupen slettes fra tabellene i filen. Er du sikker?\n\nTips: ta en ny backup først.'
      : 'Data i backupen legges til, og elementer med samme ID overskrives. Fortsette?';
    if (!confirm(msg)) return;
    await run(async () => { await restore(parsed.data, mode, setBusy); setParsed(null); }, 'Gjenoppretting fullført');
  }
  const LABELS = { printers: 'Printere', materials: 'Filament', products: 'Produkter', supplies: 'Rekvisita', packages: 'Pakker', movements: 'Lagerbevegelser', images: 'Bilder' };
  return html`
    <${PageHead} title="Backup og gjenoppretting"/>
    <p class="muted">Siste backup: <b>${s.lastBackupAt ? fmtDate(s.lastBackupAt) : 'aldri'}</b>${s.lastBackupBy ? ` av ${s.lastBackupBy}` : ''}</p>
    ${busy && html`<div class="notice info">⏳ ${busy}</div>`}
    <div class="two-col" style="margin-bottom:14px">
      <div class="panel">
        <h2>📊 Excel-backup</h2>
        <p>Alle data (produkter, rekvisita, pakker, filament, printere, innstillinger og lagerlogg) i én Excel-fil. Kan åpnes og redigeres i Excel. Bilder er ikke med.</p>
        <button class="btn primary" disabled=${!!busy} onClick=${() => { setBusy('Lager Excel …'); run(exportExcel, 'Excel-backup lastet ned'); }}>⬇ Last ned Excel</button>
      </div>
      <div class="panel">
        <h2>🗜️ Full backup (anbefalt)</h2>
        <p>ZIP-fil med Excel-filen <i>og</i> alle bildene. Brukes for full gjenoppretting.</p>
        <button class="btn primary" disabled=${!!busy} onClick=${() => run(async () => { const r = await fullBackup(setBusy); toast(`Full backup lastet ned (${r.images} bilder)`); })}>⬇ Last ned full backup</button>
      </div>
    </div>
    <div class="panel">
      <h2>🖼️ Eksporter bilder</h2>
      <p>Last ned produktbilder som ZIP, sortert i mapper og navngitt etter varen.</p>
      <div class="row">
        <select style="width:auto" value=${imgScope} onChange=${e => setImgScope(e.target.value)}>
          <option value="all">Alle bilder</option>${STOCK_COLLS.map(c => html`<option value=${c}>Kun ${TYPE_LABEL[c].toLowerCase()}</option>`)}</select>
        <button class="btn" disabled=${!!busy} onClick=${() => run(async () => { const n = await exportImages(img => imgScope === 'all' || img.c === imgScope, setBusy); toast(`${n} bilder lastet ned`); })}>⬇ Last ned bilder</button>
      </div>
      <p class="muted small">Bilder for én enkelt vare kan også lastes ned fra varens side.</p>
    </div>
    <div class="panel">
      <h2>♻️ Gjenopprett</h2>
      <p>Velg en Excel-fil (.xlsx) eller full backup (.zip) laget av appen.</p>
      <button class="btn" disabled=${!!busy} onClick=${() => fileRef.current.click()}>📂 Velg fil …</button>
      <input ref=${fileRef} type="file" accept=".xlsx,.zip" hidden onChange=${e => { pick(e.target.files[0]); e.target.value = ''; }}/>
      ${!S.isAdmin() && html`<p class="muted small">Merk: bare administratorer bør gjenopprette.</p>`}
    </div>
    ${parsed && html`<${Modal} title="Gjenopprett fra backup" onClose=${() => setParsed(null)}>
      <p>Fil: <b>${parsed.file}</b></p>
      <table><tbody>
        ${Object.entries(parsed.data.counts).map(([k, n]) => html`<tr><td>${LABELS[k] || k}</td><td class="num">${n}</td>
          <td class="num muted small">${k !== 'images' && DATA_COLLS.includes(k) ? `nå: ${k === 'movements' && S.state.mode === 'cloud' ? '–' : S.list(k).length}` : ''}</td></tr>`)}
        ${parsed.data.settings && html`<tr><td>Innstillinger</td><td class="num">✓</td><td></td></tr>`}
      </tbody></table>
      <div style="margin:14px 0"><${Seg} value=${mode} onChange=${setMode} options=${[['merge', 'Slå sammen'], ['replace', 'Erstatt alt']]}/></div>
      <p class="small muted">${mode === 'merge'
        ? 'Slå sammen: elementer i filen legges til eller oppdateres. Ingenting slettes.'
        : 'Erstatt: tabellene i filen blir nøyaktig som i backupen. Elementer som ikke finnes i filen slettes.' + (parsed.data.images ? ' Alle bilder erstattes.' : '')}</p>
      ${!parsed.data.images && html`<p class="small muted">Filen inneholder ikke bilder – eksisterende bilder beholdes.</p>`}
      <div class="modal-foot"><button class="btn" onClick=${() => setParsed(null)}>Avbryt</button>
        <button class=${'btn ' + (mode === 'replace' ? 'danger' : 'primary')} disabled=${!!busy} onClick=${doRestore}>Gjenopprett</button></div>
    <//>`}`;
}

/* ---------------- Innstillinger ---------------- */
export function Settings() {
  const [d, setD] = useState(() => S.settings());
  const s = S.settings();
  function save() {
    const patch = {};
    for (const f of SETTINGS_FIELDS) patch[f.k] = d[f.k];
    patch.currency = String(patch.currency || 'NOK').toUpperCase();
    S.write([{ t: 'upd', c: 'settings', id: 'general', d: patch }]);
    toast('Innstillinger lagret');
  }
  return html`
    <${PageHead} title="Innstillinger"/>
    <div class="panel"><h2>Kalkyle</h2>
      <${Fields} fields=${SETTINGS_FIELDS} value=${d} set=${setD}/>
      <div class="row" style="margin-top:14px"><button class="btn primary" onClick=${save}>💾 Lagre</button></div>
    </div>
    ${S.state.mode === 'cloud' && html`<${Members}/>`}
    <div class="panel"><h2>Konto og app</h2>
      <p>Modus: <b>${S.state.mode === 'cloud' ? 'Sky (Firebase) – synkes mellom enheter' : 'Lokal – kun denne nettleseren'}</b></p>
      ${S.state.mode === 'cloud' && html`<p>Innlogget som <b>${S.state.user?.email}</b> (${S.state.member?.role === 'admin' ? 'administrator' : 'medlem'})</p>
        <button class="btn" onClick=${() => S.auth.logout()}>Logg ut</button>`}
      <h3 style="margin-top:16px">Installer som app</h3>
      <ul class="small">
        <li><b>iPhone/iPad:</b> åpne i Safari → Del-knappen → «Legg til på Hjem-skjerm».</li>
        <li><b>Mac:</b> Safari → Arkiv → «Legg til i Dock», eller Chrome → installer-ikonet i adressefeltet.</li>
        <li><b>Windows:</b> Edge/Chrome → «Installer app»-ikonet i adressefeltet.</li>
      </ul>
      ${!S.list('printers').length && html`<button class="btn" onClick=${() => { S.write(seedOps()); toast('Startdata lagt inn'); }}>Last inn startdata fra Excel-arket</button>`}
    </div>`;
}

function Members() {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const admin = S.isAdmin();
  const members = S.list('members').sort((a, b) => a.id.localeCompare(b.id));
  function add() {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return toast('Ugyldig e-postadresse', 'err');
    S.write([{ t: 'set', c: 'members', id: e, d: { role, addedAt: Date.now(), addedBy: S.userEmail() } }]);
    setEmail('');
    toast(`${e} har fått tilgang`);
  }
  function remove(m) {
    if (m.id === S.userEmail()) return toast('Du kan ikke fjerne deg selv', 'err');
    if (!confirm(`Fjerne tilgangen til ${m.id}?`)) return;
    S.write([{ t: 'del', c: 'members', id: m.id }]);
  }
  return html`<div class="panel"><h2>Brukere med tilgang</h2>
    <table><tbody>${members.map(m => html`<tr><td>${m.id}</td><td>${m.role === 'admin' ? html`<span class="badge accent">admin</span>` : html`<span class="badge">medlem</span>`}</td>
      <td class="num">${admin && m.id !== S.userEmail() && html`
        <button class="btn small" onClick=${() => S.write([{ t: 'upd', c: 'members', id: m.id, d: { role: m.role === 'admin' ? 'member' : 'admin' } }])}>${m.role === 'admin' ? 'Gjør til medlem' : 'Gjør til admin'}</button>
        <button class="btn small danger" onClick=${() => remove(m)}>Fjern</button>`}</td></tr>`)}</tbody></table>
    ${admin ? html`<div class="form-grid" style="margin-top:12px; align-items:end">
      <label class="field"><span>E-post</span><input type="email" value=${email} onInput=${e => setEmail(e.target.value)} placeholder="navn@firma.no"/></label>
      <label class="field"><span>Rolle</span><select value=${role} onChange=${e => setRole(e.target.value)}><option value="member">Medlem</option><option value="admin">Administrator</option></select></label>
      <div><button class="btn primary" onClick=${add}>Gi tilgang</button></div></div>
      <p class="muted small">Personen logger inn med Google eller e-post/passord med denne adressen.</p>`
    : html`<p class="muted small">Kun administratorer kan endre tilganger.</p>`}
  </div>`;
}
