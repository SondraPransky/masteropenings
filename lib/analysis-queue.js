// ══════════════════════════════════════════════════════
// lib/analysis-queue.js — ASSISTANT FAIBLESSES : la file d'analyse auto.
//
// « Au fur et à mesure » (arbitrage 04/08) : quand le coach ouvre son tableau
// de bord, les parties PARTAGÉES pas encore analysées passent au moteur une par
// une, en arrière-plan, et le résultat se range UNE fois pour toutes dans
// games.extra.analysis (migration-free) via _sbUpdateGame — le chemin RLS de
// l'annotation (games_update autorise le prof sur les parties partagées).
//
// Déclencheurs : _coachLoad (connecté) + renderPartiesTab (couvre le dev local).
// Ré-entrant : _running garde ; une partie illisible entre dans _failed (session
// seulement, jamais persisté) pour ne pas boucler dessus.
//
// ⚠ On ne re-rend JAMAIS l'UI d'ici (renderPartiesTab RESET la section : il
// fermerait l'écran de lecture sous le coach). On ne touche que l'indicateur
// #wq-status ; les données sont visibles au prochain rendu naturel.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { sfAnalyzeGame, sfAvailable, sfRelease, SF_DEPTH } from './engine.js';

let _running = false;
const _failed = new Set();

function _todo() {
  return (G.savedGames || []).filter(g =>
    g.baseId && g.shared && g.pgn && !g.analysis && !_failed.has(String(g.id)));
}

function _status(txt) {
  const el = document.getElementById('wq-status');
  if (!el) return;
  el.style.display = txt ? '' : 'none';
  el.innerHTML = txt ? `<i class="ti ti-loader-2 wq-spin" aria-hidden="true"></i> ${txt}` : '';
}

async function startWeaknessQueue() {
  if (_running || !sfAvailable()) return;
  if (!_todo().length) return;
  _running = true;
  try {
    let done = 0, todo;
    // On recalcule la liste à chaque tour (et une seule fois) : des parties
    // peuvent arriver pendant le lot, et celle qu'on vient de traiter en sort.
    while ((todo = _todo()).length) {
      const g = todo[0];
      _status(`Analyse des parties… ${done + 1}/${done + todo.length}`);
      try {
        const rec = await sfAnalyzeGame(g.pgn, { depth: SF_DEPTH });
        g.analysis = rec;
        window.save?.();
        window._sbUpdateGame?.(g);   // UPDATE : la partie existe déjà côté serveur
      } catch (e) {
        // Moteur indisponible → on abandonne toute la file ; partie illisible →
        // on la saute pour cette session et on continue.
        if (/uciok|worker/i.test(String(e && e.message))) { _status(''); return; }
        _failed.add(String(g.id));
      }
      done++;
    }
    _status('');
    // Le badge « à annoter » et les listes se rafraîchissent à leur prochain
    // rendu ; on signale juste la fin si la section Parties montre sa LISTE
    // (jamais pendant une lecture ancrée — le re-rendu la fermerait).
    const sec = document.getElementById('csec-parties');
    const lecture = !!window._E?.docked;   // l'éditeur ancré = une lecture est ouverte
    if (sec && sec.style.display !== 'none' && !lecture) window.renderPartiesTab?.();
  } finally {
    _running = false;
    _status('');
    sfRelease();   // lot terminé : on rend les 7 Mo du moteur (reboot lazy au suivant)
  }
}

Object.assign(window, { startWeaknessQueue });
export { startWeaknessQueue };
