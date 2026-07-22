// ══════════════════════════════════════════════════════
// PLANS DE TRAVAIL — cœur pur (testé).
//
// Un « Plan de travail » = un module d'ouverture (l'ANCRE) + des paquets
// d'exercices membres : `puzzles` (tactiques du prof ou OTKB) et `errors`
// (erreurs types issues de l'analyse d'ouvertures). Le plan vit sur l'ancre
// (`d.plans`, persisté dans modules.extra.plans) : les modules assignés
// arrivent chez l'élève avec leur `extra`, la composition voyage donc
// gratuitement — aucun canal de données nouveau.
//
// Le plan est une VUE : la répétition espacée, la maîtrise et le drill
// continuent de tourner sur les modules membres, sous leurs propres ids.
// ══════════════════════════════════════════════════════

// Ids membres d'un plan (puzzles puis erreurs), dédupliqués, en String.
export function planMembers(plan) {
  const seen = new Set();
  return [...(plan?.puzzles || []), ...(plan?.errors || [])]
    .map(String)
    .filter(id => !seen.has(id) && seen.add(id));
}

// Plans applicables à un élève, depuis ses modules ASSIGNÉS.
// Un plan s'affiche si TOUS ses membres sont assignés (l'ancre l'est par
// construction : c'est elle qui porte le plan) et s'il a au moins un membre.
// Retour : { entries: [{ plan, anchor }], hidden: Set<idString> } — `hidden`
// contient ancres + membres des plans affichés, pour les retirer des
// sections génériques (un module ne se présente jamais deux fois).
export function plansForStudent(assigned) {
  const ids = new Set((assigned || []).map(m => String(m.id)));
  const entries = [], hidden = new Set();
  (assigned || []).forEach(anchor => {
    if (anchor.isExercise) return;
    (anchor.plans || []).forEach(plan => {
      const members = planMembers(plan);
      if (!members.length || !members.every(id => ids.has(id))) return;
      entries.push({ plan, anchor });
      hidden.add(String(anchor.id));
      members.forEach(id => hidden.add(id));
    });
  });
  return { entries, hidden };
}

// « Prochain geste » : index de la première rangée non terminée.
// Tout est terminé → la dernière rangée (on ne pointe pas dans le vide).
export function planNextStep(rows) {
  if (!rows?.length) return -1;
  const i = rows.findIndex(r => !r.done);
  return i === -1 ? rows.length - 1 : i;
}
