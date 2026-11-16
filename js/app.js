import { html, render, useState, useEffect } from './lib.js';
import * as S from './store.js';
import { setCurrency } from './util.js';
import { Toasts, toast, go } from './components.js';
import { Products } from './pages/products.js';
import { Packages } from './pages/packages.js';
import { Supplies, Equipment } from './pages/inventory.js';
import { Scan } from './pages/scan.js';
import { Labels } from './pages/labels.js';
import { Dashboard, Log, Backup, Settings } from './pages/misc.js';
import { Events } from './pages/events.js';
import { Orders } from './pages/orders.js';

const ROUTES = [
  { path: '', label: 'Oversikt', icon: '🏠', comp: Dashboard },
  { path: 'produkter', label: 'Produkter & kalkyle', icon: '🧮', comp: Products },
  { path: 'pakker', label: 'Pakker', icon: '🎁', comp: Packages },
  { path: 'messer', label: 'Messer', icon: '🎪', comp: Events },
  { path: 'bestillinger', label: 'Bestillinger', icon: '📝', comp: Orders },
  { path: 'rekvisita', label: 'Rekvisita', icon: '📦', comp: Supplies },
  { path: 'utstyr', label: 'Filament & printere', icon: '🧵', comp: Equipment },
  { path: 'skann', label: 'Skann', icon: '📷', comp: Scan },
  { path: 'etiketter', label: 'Etiketter', icon: '🏷️', comp: Labels },
  { path: 'logg', label: 'Lagerlogg', icon: '📜', comp: Log },
  { path: 'backup', label: 'Backup', icon: '💾', comp: Backup },
  { path: 'innstillinger', label: 'Innstillinger', icon: '⚙️', comp: Settings },
];

function useRoute() {
  const [h, setH] = useState(location.hash);
  useEffect(() => {
    const f = () => { setH(location.hash); window.scrollTo(0, 0); };
    addEventListener('hashchange', f);
    return () => removeEventListener('hashchange', f);
  }, []);
  return h.replace(/^#\/?/, '').split('?')[0].split('/').map(decodeURIComponent);
}

function App() {
  const [, force] = useState(0);
  useEffect(() => {
    const un = S.subscribe(() => force(x => x + 1));
    force(x => x + 1); // fang opp endringer som skjedde før abonnementet
    return un;
  }, []);
  useEffect(() => {
    const f = e => toast('Lagring feilet: ' + e.detail, 'err');
    addEventListener('store-error', f);
    return () => removeEventListener('store-error', f);
  }, []);
  const parts = useRoute();
  const st = S.state;
  if (!st.authReady) return html`<div class="boot">Laster …</div>`;
  if (st.error && st.error !== 'noaccess' && !st.ready) return html`<div class="login"><div class="panel"><div class="notice danger">${st.error}</div>
    <button class="btn" onClick=${() => location.reload()}>Prøv igjen</button></div></div>`;
  if (st.mode === 'cloud' && !st.user) return html`<${Login}/>`;
  if (st.needsVerify) return html`<${Verify}/>`;
  if (st.error === 'noaccess') return html`<${NoAccess}/>`;
  if (!st.ready) return html`<div class="boot">Henter data …</div>`;
  setCurrency(S.settings().currency);
  const route = ROUTES.find(r => r.path === parts[0]) || ROUTES[0];
  return html`<${Shell} route=${route} parts=${parts}/>`;
}

function Shell({ route, parts }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [parts.join('/')]);
  const Comp = route.comp;
  return html`<div class=${'shell' + (open ? ' open' : '')}>
    <aside class="sidebar">
      <div class="brand"><img src="icons/icon-192.png" alt=""/> 3D Print Kalkulator</div>
      <nav class="nav">${ROUTES.map(r => html`<a href=${'#/' + r.path} class=${r === route ? 'active' : ''}><span class="ico">${r.icon}</span>${r.label}</a>`)}</nav>
      <div class="foot">
        ${S.state.mode === 'cloud' ? html`<div>${S.state.user?.email}</div>` : html`<div>${S.TEST_MODE ? "🧪 Testmodus (testdata)" : "Lokal modus"}</div>`}
        ${S.state.error && html`<div class="neg">${S.state.error}</div>`}
        <div>${navigator.onLine ? '' : '⚠ Frakoblet – endringer synkes senere'}</div>
      </div>
    </aside>
    <div class="drawer-bg" onClick=${() => setOpen(false)}></div>
    <div class="grow" style="min-width:0">
      <div class="topbar"><button class="icon-btn" aria-label="Meny" onClick=${() => setOpen(true)}>☰</button>
        <div class="title">${route.icon} ${route.label}</div></div>
      <main class="main"><${Comp} parts=${parts}/></main>
    </div>
    ${route.path !== 'skann' && html`<button class="fab" title="Skann strekkode" aria-label="Skann" onClick=${() => go('skann')}>📷</button>`}
  </div>`;
}

const AUTH_ERR = {
  'auth/invalid-credential': 'Feil e-post eller passord.',
  'auth/wrong-password': 'Feil passord.',
  'auth/user-not-found': 'Fant ingen bruker med denne e-posten.',
  'auth/email-already-in-use': 'E-posten er allerede registrert – logg inn i stedet.',
  'auth/weak-password': 'Passordet må ha minst 6 tegn.',
  'auth/invalid-email': 'Ugyldig e-postadresse.',
  'auth/popup-closed-by-user': 'Innloggingsvinduet ble lukket.',
  'auth/too-many-requests': 'For mange forsøk. Vent litt og prøv igjen.',
  'auth/network-request-failed': 'Ingen nettverkstilkobling.',
  'auth/unauthorized-domain': 'Dette domenet er ikke godkjent i Firebase (Authentication → Settings → Authorized domains).',
};
const authMsg = e => AUTH_ERR[e?.code] || e?.message || String(e);

function Login() {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function run(fn) {
    setErr(''); setBusy(true);
    try { await fn(); } catch (e) { setErr(authMsg(e)); }
    setBusy(false);
  }
  return html`<div class="login"><div class="panel">
    <div class="brand"><img src="icons/icon-192.png" alt=""/> 3D Print Kalkulator</div>
    <button class="btn primary" style="width:100%" disabled=${busy} onClick=${() => run(() => S.auth.google())}>Logg inn med Google</button>
    <div class="divider">eller med e-post</div>
    <form onSubmit=${e => { e.preventDefault(); run(() => (mode === 'login' ? S.auth.email(email, pw) : S.auth.signup(email, pw))); }} class="stack">
      <label class="field"><span>E-post</span><input type="email" autocomplete="email" value=${email} onInput=${e => setEmail(e.target.value)} required/></label>
      <label class="field"><span>Passord</span><input type="password" autocomplete=${mode === 'login' ? 'current-password' : 'new-password'} value=${pw} onInput=${e => setPw(e.target.value)} required minlength="6"/></label>
      ${err && html`<div class="notice danger small">${err}</div>`}
      <button class="btn" style="width:100%" disabled=${busy} type="submit">${mode === 'login' ? 'Logg inn' : 'Opprett konto'}</button>
    </form>
    <div class="row" style="justify-content:space-between; margin-top:12px">
      <a href="javascript:void 0" class="small" onClick=${() => setMode(mode === 'login' ? 'signup' : 'login')}>${mode === 'login' ? 'Ny bruker? Opprett konto' : 'Har konto? Logg inn'}</a>
      <a href="javascript:void 0" class="small" onClick=${() => { if (!email) return setErr('Skriv inn e-posten din først.'); run(async () => { await S.auth.reset(email); toast('E-post for nytt passord er sendt'); }); }}>Glemt passord?</a>
    </div>
  </div></div>`;
}

function Verify() {
  return html`<div class="login"><div class="panel stack">
    <h2>Bekreft e-posten din</h2>
    <p>Vi har sendt en bekreftelseslenke til <b>${S.state.user?.email}</b>. Klikk på lenken, og trykk deretter «Jeg har bekreftet».</p>
    <button class="btn primary" onClick=${() => S.auth.reload()}>Jeg har bekreftet</button>
    <button class="btn" onClick=${async () => { await S.auth.resendVerify(); toast('Ny e-post sendt'); }}>Send på nytt</button>
    <button class="btn" onClick=${() => S.auth.logout()}>Logg ut</button>
  </div></div>`;
}

function NoAccess() {
  const [owner, setOwner] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => { S.auth.ownerExists().then(setOwner); }, []);
  return html`<div class="login"><div class="panel stack">
    <h2>Ingen tilgang ennå</h2>
    <p>Du er logget inn som <b>${S.state.user?.email}</b>, men denne adressen har ikke tilgang til arbeidsområdet.</p>
    ${owner
      ? html`<p>Be en administrator legge til e-posten din under <i>Innstillinger → Brukere med tilgang</i>.</p>`
      : html`<div class="notice info">Arbeidsområdet er ikke satt opp. Du kan bli eier og første administrator.</div>
        <button class="btn primary" disabled=${busy} onClick=${async () => { setBusy(true); try { await S.auth.bootstrap(); } catch (e) { toast(e.message, 'err'); } setBusy(false); }}>Opprett arbeidsområde (jeg er eier)</button>`}
    <button class="btn" onClick=${() => S.auth.reload()}>Sjekk igjen</button>
    <button class="btn" onClick=${() => S.auth.logout()}>Logg ut / bytt konto</button>
  </div></div>`;
}

render(html`<${App}/><${Toasts}/>`, document.getElementById('app'));
S.init();
addEventListener('online', () => S.emit());
addEventListener('offline', () => S.emit());
