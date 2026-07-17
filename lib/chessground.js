// Loader Chessground partagé (le board de Lichess, assets vendus dans otkb/ui/static/).
// Chargé DYNAMIQUEMENT → chunk Vite lazy : le bundle initial ne le porte pas, il
// arrive à la première utilisation (drill, explorateur, éditeur). CSS cburnett en
// data-URIs → 0 requête externe. `otkb-cg-theme.css` (après brown) pilote le
// damier par les variables --board-* (sélecteur de couleur façon Lichess).
//
// Sous VITE (dev/build) l'import de CSS produit des chunks ; sous `npx serve`
// (ESM brut, piège d'outillage connu) l'import CSS échoue → repli en <link>.
// Le JS, lui, est un vrai module ES dans les deux mondes.

let _load = null;

export function loadChessground() {
  if (!_load) {
    _load = (async () => {
      try {
        await Promise.all([
          import('../otkb/ui/static/chessground.base.css'),
          import('../otkb/ui/static/chessground.brown.css'),
          import('../otkb/ui/static/chessground.cburnett.css'),
          import('../otkb/ui/static/otkb-cg-theme.css'),
        ]);
      } catch {
        for (const f of ['chessground.base', 'chessground.brown', 'chessground.cburnett', 'otkb-cg-theme']) {
          const href = `/otkb/ui/static/${f}.css`;
          if (!document.querySelector(`link[href="${href}"]`)) {
            const l = document.createElement('link');
            l.rel = 'stylesheet'; l.href = href;
            document.head.appendChild(l);
          }
        }
      }
      return (await import('../otkb/ui/static/chessground.min.js')).Chessground;
    })();
  }
  return _load;
}
