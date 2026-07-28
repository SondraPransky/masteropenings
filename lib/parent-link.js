// ══════════════════════════════════════════════════════
// LIEN PARENTS (arbitrage 28/07) — une URL secrète par élève, sans compte,
// révocable, qui montre aux parents : régularité, réussite, travail en cours.
// JAMAIS les parties ni les annotations (l'élève garde son espace à lui).
//
// Deux moitiés dans ce module :
//  1. CÔTÉ COACH — bouton « Lien parents » sur la page profil d'un élève →
//     génère/retrouve le jeton, stocké dans le profil DU COACH
//     (profiles.extra.parentLinks, fusion lecture-modification-écriture :
//     ⚠ un update naïf de `extra` écraserait les autres clés).
//  2. CÔTÉ PARENT — `?parent=<token>` dans l'URL → l'app est recouverte par
//     une page lecture seule qui appelle la RPC `parent_report` (SECURITY
//     DEFINER, migration-008 — À LANCER côté Supabase avant tout usage réel).
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { sb } from './supabase-client.js';

const toast      = (...a) => window.toast?.(...a);
const closeModal = (...a) => window.closeModal?.(...a);
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);

// ── Côté coach ──────────────────────────────────────────────────────────────
function _plToken() {
  const a = new Uint8Array(16);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(36)).join('').replace(/[^a-z0-9]/g, '').slice(0, 22);
}

async function _plReadLinks() {
  const { data } = await sb.from('profiles').select('extra').eq('id', G.currentUser.uid).maybeSingle();
  return { extra: data?.extra || {}, links: data?.extra?.parentLinks || {} };
}

async function _plWriteLinks(extra, links) {
  // Fusion : on repart de l'extra RELU, jamais d'un objet neuf (les autres clés survivent).
  const { error } = await sb.from('profiles').update({ extra: { ...extra, parentLinks: links } })
    .eq('id', G.currentUser.uid);
  if (error) throw error;
}

function _plUrl(token) {
  const base = location.origin + location.pathname.replace(/[^/]*$/, '');
  return `${base}?parent=${token}`;
}

// Ouvre la modale du lien parents pour un élève (depuis la page profil coach).
async function openParentLink(idLower, name, display) {
  if (!sb || !G.currentUser) { toast('⚠ Connecte-toi pour générer un lien parents', 'ko'); return; }
  let m = document.getElementById('modal-parent-link');
  if (!m) {
    m = document.createElement('div');
    m.id = 'modal-parent-link';
    m.className = 'overlay';
    document.body.appendChild(m);
  }
  m.innerHTML = `<div class="modal" style="max-width:520px;width:96vw;padding:24px">
    <div class="modal-title">Lien parents — ${escapeHtml(display || name)}</div>
    <div class="ct-note" style="margin-top:8px">Chargement…</div></div>`;
  m.classList.add('on');
  try {
    const { extra, links } = await _plReadLinks();
    let token = Object.keys(links).find(t => (links[t].email || '') === idLower || (links[t].name || '') === name);
    if (!token) {
      token = _plToken();
      links[token] = { email: idLower || '', name: name || '', display: display || name || '' };
      await _plWriteLinks(extra, links);
    }
    const url = _plUrl(token);
    m.innerHTML = `<div class="modal" style="max-width:560px;width:96vw;padding:24px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
        <div class="modal-title" style="margin:0">Lien parents — ${escapeHtml(display || name)}</div>
        <button class="btn btn-ghost btn-sm" onclick="closeModal('modal-parent-link')" aria-label="Fermer">✕</button>
      </div>
      <div class="ct-note"><i class="ti ti-shield-lock" aria-hidden="true"></i>
        Une page LECTURE SEULE, sans compte : régularité, réussite, travail en cours.
        Ni les parties, ni tes annotations. Envoie ce lien aux parents ; révoque-le pour le couper.</div>
      <label class="ct-lbl" for="pl-url">Lien privé</label>
      <input id="pl-url" class="ct-sel" type="text" readonly value="${escapeHtml(url)}" onclick="this.select()">
      <div class="ct-acts">
        <button class="btn btn-ghost" onclick="parentLinkRevoke('${escapeHtml(token)}')"><i class="ti ti-link-off" aria-hidden="true"></i> Révoquer</button>
        <button class="btn btn-primary" onclick="parentLinkCopy()"><i class="ti ti-copy" aria-hidden="true"></i> Copier le lien</button>
      </div>
    </div>`;
  } catch (e) {
    m.innerHTML = `<div class="modal" style="max-width:520px;width:96vw;padding:24px">
      <div class="modal-title">Lien parents</div>
      <div class="ct-note" style="margin-top:8px">❌ Impossible de charger/écrire le lien (réseau ?). Réessaie.</div>
      <div class="ct-acts"><button class="btn btn-ghost" onclick="closeModal('modal-parent-link')">Fermer</button></div></div>`;
  }
}

async function parentLinkCopy() {
  const inp = /** @type {HTMLInputElement|null} */ (document.getElementById('pl-url'));
  if (!inp) return;
  try { await navigator.clipboard.writeText(inp.value); toast('✓ Lien copié', 'ok'); }
  catch (e) { inp.select(); toast('Sélectionné — copie avec Ctrl+C', 'ok'); }
}

async function parentLinkRevoke(token) {
  try {
    const { extra, links } = await _plReadLinks();
    delete links[token];
    await _plWriteLinks(extra, links);
    closeModal('modal-parent-link');
    toast('✓ Lien révoqué — l\'ancienne URL ne montre plus rien', 'ok');
  } catch (e) { toast('❌ Révocation impossible (réseau ?)', 'ko'); }
}

// ── Côté parent ─────────────────────────────────────────────────────────────
function _plDayStats(days) {
  // Régularité = jours actifs sur les 28 derniers jours ; réussite = 30 jours.
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const cut28 = new Date(now.getTime() - 27 * 86400000).toISOString().slice(0, 10);
  const cut30 = new Date(now.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const d28 = days.filter(x => x.d >= cut28);
  const d30 = days.filter(x => x.d >= cut30);
  const n30 = d30.reduce((a, x) => a + x.n, 0), ok30 = d30.reduce((a, x) => a + x.ok, 0);
  // Les 28 cases du mini-calendrier (semaine par ligne, aujourd'hui en dernier).
  const cells = [];
  for (let i = 27; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400000).toISOString().slice(0, 10);
    const hit = days.find(x => x.d === d);
    cells.push({ d, n: hit ? hit.n : 0 });
  }
  return { activeDays: d28.length, n30, pct30: n30 ? Math.round(ok30 / n30 * 100) : 0, cells };
}

async function _plRenderParentPage(token) {
  const root = document.createElement('div');
  root.id = 'parent-report-root';
  root.innerHTML = `<div class="prp-card"><div class="prp-loading">Chargement du rapport…</div></div>`;
  document.body.appendChild(root);
  document.title = 'Suivi — EECoach';

  let rep = null;
  try {
    if (!sb) throw new Error('offline');
    const { data, error } = await sb.rpc('parent_report', { p_token: token });
    if (error) throw error;
    rep = data;
  } catch (e) { rep = undefined; }

  if (!rep) {
    root.innerHTML = `<div class="prp-card">
      <div class="prp-title">Lien invalide ou révoqué</div>
      <div class="prp-sub">Demandez un nouveau lien au coach.</div></div>`;
    return;
  }
  const st = _plDayStats(rep.days || []);
  const cal = st.cells.map(c => `<span class="prp-day${c.n ? ' on' : ''}" title="${c.d}${c.n ? ' · ' + c.n + ' positions' : ''}"></span>`).join('');
  const recent = (rep.recent || []).map(r => `<li><b>${escapeHtml(r.name)}</b>
      <span class="prp-r-meta">${r.n} position${r.n > 1 ? 's' : ''} · ${r.n ? Math.round(r.ok / r.n * 100) : 0} % de réussite</span></li>`).join('');
  root.innerHTML = `<div class="prp-card">
    <div class="prp-brand">♞ EECoach — suivi d'entraînement</div>
    <h1 class="prp-title">${escapeHtml(rep.display || 'Élève')}</h1>
    <div class="prp-kpis">
      <div class="prp-kpi"><div class="prp-kpi-v">${st.activeDays}<span>/28</span></div><div class="prp-kpi-l">jours d'entraînement<br>(4 dernières semaines)</div></div>
      <div class="prp-kpi"><div class="prp-kpi-v">${st.pct30}<span>%</span></div><div class="prp-kpi-l">de bonnes réponses<br>(30 derniers jours)</div></div>
      <div class="prp-kpi"><div class="prp-kpi-v">${st.n30}</div><div class="prp-kpi-l">positions travaillées<br>(30 derniers jours)</div></div>
    </div>
    <div class="prp-sec">Régularité — les 4 dernières semaines</div>
    <div class="prp-cal" role="img" aria-label="${st.activeDays} jours actifs sur les 28 derniers">${cal}</div>
    <div class="prp-sec">Ce qui est travaillé en ce moment</div>
    ${recent ? `<ul class="prp-recent">${recent}</ul>` : `<div class="prp-sub">Pas encore d'entraînement enregistré.</div>`}
    <div class="prp-foot">Lien privé fourni par le coach — la régularité compte plus que le score : quelques minutes souvent battent une longue séance rare.</div>
  </div>`;
}

// Routage : `?parent=<token>` recouvre l'app (aucun login requis). Additif —
// l'app s'initialise derrière, la page parent vit par-dessus.
const _plMatch = new URLSearchParams(location.search).get('parent');
if (_plMatch) {
  document.addEventListener('DOMContentLoaded', () => _plRenderParentPage(_plMatch));
}

Object.assign(window, { openParentLink, parentLinkCopy, parentLinkRevoke });

export { openParentLink, parentLinkCopy, parentLinkRevoke, _plDayStats };
