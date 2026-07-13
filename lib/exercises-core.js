// ══════════════════════════════════════════════════════
// lib/exercises-core.js — cœur PUR des exercices (aucune dépendance
// DOM/réseau → testable en node). Importé par lib/exercises.js.
// ══════════════════════════════════════════════════════

// Clonage CANONIQUE d'une position clé (kp) d'un exercice.
// Source unique du clonage : préserve TOUS les champs d'un kp — y compris
// `line` (séquence multi-coups « mat en N » / combinaison forcée). Utilisé à
// la fois à l'ouverture d'un paquet en édition ET à l'enregistrement, pour
// qu'aucun champ ne soit perdu au passage (bug historique : `line` droppée à
// l'édition → mats en N écrasés en exercices 1 coup au ré-enregistrement).
// Copie profonde de `altSans` et `line` (tableaux) pour éviter le partage de
// référence entre le brouillon d'édition et le module persisté.
export function _exCloneKp(k) {
  const kp = {
    fen: k.fen,
    san: k.san,
    altSans: [...(k.altSans || [])],
    comment: k.comment || '',
    isCapture: !!k.isCapture,
    isCastle: !!k.isCastle,
    isCheck: !!k.isCheck,
  };
  if (Array.isArray(k.line) && k.line.length) kp.line = [...k.line];
  return kp;
}
