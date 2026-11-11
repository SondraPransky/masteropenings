// ══════════════════════════════════════════════════════
// MASCOTTE « chaton-pion » (budget délice) — SVG vectoriel inline, 0 requête réseau.
//
// Mi-chaton, mi-pièce d'échecs (demande utilisatrice, oct. 2026) : la silhouette
// est celle d'un PION — tête ronde, collerette, corps évasé, socle — et la tête
// ronde est un chaton (oreilles, moustaches). La collerette devient un collier
// indigo à médaille dorée, une queue sort de derrière le socle.
//
// Ne paraît qu'aux moments RARES (premier lancement, fin sans-faute, états vides).
// Jamais sur l'échiquier ni les dashboards — personnalité « jamais sur-gamifié ».
// Animée par les classes CSS `.msc-*` (style.css), gardées par
// `prefers-reduced-motion` : `.msc-anim` (corps), `.msc-tail`, `.msc-paw`,
// `.msc-z1/.msc-z2` (sieste).
// ══════════════════════════════════════════════════════
const W = 100, H = 112;

const C = {
  ink:   '#3f3f46',   // contour
  body:  '#f6efe3',   // pion « blanc » ivoire
  shade: '#e3d6c1',   // ombre propre (côté droit, dessous du socle)
  light: '#fffaf2',   // reflet
  ear:   '#f4a7bb',   // intérieur des oreilles, nez, joues
  eye:   '#27272a',
  collar:'#4f46e5',   // indigo de la marque
  medal: '#d4a52a',
  zz:    '#6366f1',
};

const STROKE = `stroke="${C.ink}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"`;

function tail() {
  // Queue en S qui sort de derrière le socle (contour = trait large sous le trait clair).
  const d = 'M70 98 C 90 100, 97 84, 90 72 C 86 65, 79 67, 82 73';
  return `<g class="msc-tail">
    <path d="${d}" fill="none" stroke="${C.ink}" stroke-width="10" stroke-linecap="round"/>
    <path d="${d}" fill="none" stroke="${C.body}" stroke-width="5.2" stroke-linecap="round"/>
    <path d="M86.5 69.5 C 84 67.5, 80.5 68.5, 82 73" fill="none" stroke="${C.shade}" stroke-width="5.2" stroke-linecap="round"/>
  </g>`;
}

function pawn() {
  return `
    <!-- socle -->
    <rect x="17" y="91" width="66" height="14" rx="7" fill="${C.body}" ${STROKE}/>
    <path d="M21 99 H79" stroke="${C.shade}" stroke-width="4" stroke-linecap="round"/>
    <!-- corps évasé du pion -->
    <path d="M39 62 C 39 75, 27 81, 25 92 H75 C 73 81, 61 75, 61 62 Z" fill="${C.body}" ${STROKE}/>
    <path d="M55 66 C 57 76, 66 82, 69 90 H60 C 58 82, 54 74, 55 66 Z" fill="${C.shade}"/>
    <path d="M36 88 C 37 82, 41 78, 43 74" fill="none" stroke="${C.light}" stroke-width="2.4" stroke-linecap="round"/>
    <!-- collier (la collerette du pion) + médaille -->
    <ellipse cx="50" cy="63" rx="16" ry="5" fill="${C.collar}" ${STROKE}/>
    <circle cx="50" cy="69.5" r="3.8" fill="${C.medal}" stroke="${C.ink}" stroke-width="1.8"/>`;
}

function head(pose) {
  const eyes = pose === 'oops'
    ? `<circle cx="41" cy="43" r="3.4" fill="${C.eye}"/><circle cx="59" cy="43" r="3.4" fill="${C.eye}"/>
       <circle cx="42" cy="41.8" r="1.1" fill="#fff"/><circle cx="60" cy="41.8" r="1.1" fill="#fff"/>
       <path d="M36 35.5 L 45 33.5" stroke="${C.ink}" stroke-width="2" stroke-linecap="round"/>
       <path d="M64 35.5 L 55 33.5" stroke="${C.ink}" stroke-width="2" stroke-linecap="round"/>`
    : pose === 'sleep'
    ? `<path d="M37 43 Q 41 46.5 45 43" fill="none" stroke="${C.eye}" stroke-width="2.4" stroke-linecap="round"/>
       <path d="M55 43 Q 59 46.5 63 43" fill="none" stroke="${C.eye}" stroke-width="2.4" stroke-linecap="round"/>`
    : pose === 'cheer'
    ? `<path d="M37 44 Q 41 38.5 45 44" fill="none" stroke="${C.eye}" stroke-width="2.6" stroke-linecap="round"/>
       <path d="M55 44 Q 59 38.5 63 44" fill="none" stroke="${C.eye}" stroke-width="2.6" stroke-linecap="round"/>`
    : `<ellipse cx="41" cy="42" rx="3.9" ry="5" fill="${C.eye}"/><ellipse cx="59" cy="42" rx="3.9" ry="5" fill="${C.eye}"/>
       <circle cx="42.4" cy="40" r="1.4" fill="#fff"/><circle cx="60.4" cy="40" r="1.4" fill="#fff"/>`;
  const mouth = pose === 'oops'
    ? `<ellipse cx="50" cy="53.4" rx="2.4" ry="2" fill="${C.ink}"/>`
    : pose === 'cheer'
    ? `<path d="M45.5 51.5 Q 50 57.5 54.5 51.5 Z" fill="${C.ear}" stroke="${C.ink}" stroke-width="1.8" stroke-linejoin="round"/>`
    : `<path d="M46 51.5 Q 48 54 50 51.5 Q 52 54 54 51.5" fill="none" stroke="${C.ink}" stroke-width="1.8" stroke-linecap="round"/>`;
  return `
    <!-- oreilles -->
    <path d="M29 30 L 30 8 L 46 19 Z" fill="${C.body}" ${STROKE}/>
    <path d="M71 30 L 70 8 L 54 19 Z" fill="${C.body}" ${STROKE}/>
    <path d="M32.5 24 L 33 14 L 41 19.5 Z" fill="${C.ear}"/>
    <path d="M67.5 24 L 67 14 L 59 19.5 Z" fill="${C.ear}"/>
    <!-- tête = la boule du pion -->
    <circle cx="50" cy="39" r="24" fill="${C.body}" ${STROKE}/>
    <path d="M66 26 A 21 21 0 0 1 69 51" fill="none" stroke="${C.shade}" stroke-width="5" stroke-linecap="round"/>
    <path d="M35 25 A 19 19 0 0 1 44 19" fill="none" stroke="${C.light}" stroke-width="3" stroke-linecap="round"/>
    <!-- joues, yeux, nez, bouche, moustaches -->
    <ellipse cx="35" cy="50" rx="4.2" ry="2.6" fill="${C.ear}" opacity=".7"/>
    <ellipse cx="65" cy="50" rx="4.2" ry="2.6" fill="${C.ear}" opacity=".7"/>
    ${eyes}
    <path d="M47.6 47.3 H52.4 L50 50 Z" fill="${C.ear}" stroke="${C.ink}" stroke-width="1.4" stroke-linejoin="round"/>
    ${mouth}
    <g stroke="${C.ink}" stroke-width="1.4" stroke-linecap="round" opacity=".75">
      <path d="M31 47 L 19 45"/><path d="M31 51 L 19 53"/>
      <path d="M69 47 L 81 45"/><path d="M69 51 L 81 53"/>
    </g>`;
}

// Goutte de sueur (pose « oups ») — l'émotion se lit sans un mot.
function drop() {
  return `<path d="M73 22 C 70 27, 69.5 30, 72 31.6 C 74.6 33, 77 30.6, 75.6 27.4 Z" fill="#93c5fd" stroke="${C.ink}" stroke-width="1.6" stroke-linejoin="round"/>`;
}

function paw(pose) {
  if (pose === 'sleep' || pose === 'oops') return '';
  // Patte levée (salut / fête) côté gauche, coussinets roses.
  return `<g class="msc-paw">
    <path d="M30 74 C 24 70, 17 64, 14 57" fill="none" stroke="${C.ink}" stroke-width="10.5" stroke-linecap="round"/>
    <path d="M30 74 C 24 70, 17 64, 14 57" fill="none" stroke="${C.body}" stroke-width="5.6" stroke-linecap="round"/>
    <circle cx="13" cy="54" r="7" fill="${C.body}" ${STROKE}/>
    <circle cx="13" cy="55.5" r="2.4" fill="${C.ear}"/>
    <circle cx="9.6" cy="51.4" r="1.3" fill="${C.ear}"/><circle cx="13" cy="50" r="1.3" fill="${C.ear}"/><circle cx="16.4" cy="51.4" r="1.3" fill="${C.ear}"/>
  </g>`;
}

function zz() {
  const z = (x, y, s) => `<path d="M${x} ${y} h${s} l-${s} ${s} h${s}" fill="none" stroke="${C.zz}" stroke-width="${s / 3.2}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<g class="msc-z1">${z(74, 18, 7)}</g><g class="msc-z2">${z(85, 5, 9)}</g>`;
}

/** SVG de la mascotte. `size` = largeur px (hauteur dérivée) ;
 *  `pose` = 'wave' (salut, défaut) · 'cheer' (fête, réussite) · 'sleep'
 *  (sieste, états vides) · 'oops' (consolation : séance difficile, erreur).
 *  `decorative` : la mascotte accompagne un texte qui dit déjà tout → masquée
 *  aux lecteurs d'écran (sinon « mascotte qui dort » avant chaque état vide). */
export function mascotSvg(size = 80, pose = 'wave', decorative = false) {
  const label = pose === 'sleep' ? 'Mascotte chaton-pion qui dort'
              : pose === 'cheer' ? 'Mascotte chaton-pion qui fait la fête'
              : pose === 'oops'  ? 'Mascotte chaton-pion un peu embêtée'
              : 'Mascotte chaton-pion qui salue';
  const a11y = decorative ? 'aria-hidden="true" focusable="false"' : `role="img" aria-label="${label}"`;
  return `<svg class="msc msc-${pose}" width="${size}" height="${Math.round(size * H / W)}" viewBox="0 0 ${W} ${H}" ${a11y}>`
    + `<g class="msc-anim">${tail()}${pawn()}${head(pose)}${paw(pose)}${pose === 'sleep' ? zz() : ''}${pose === 'oops' ? drop() : ''}</g></svg>`;
}

/** Emblème « tête seule » (logo, favicon) : statique, sans corps ni animation. */
export function mascotMark(size = 24) {
  return `<svg class="msc-mark" width="${size}" height="${size}" viewBox="17 4 66 62" aria-hidden="true" focusable="false">${head('wave')}</svg>`;
}

// ── Marque : logo de la barre + page de connexion (montés au chargement) ──
// Le HTML statique garde un repli (glyphe) ; la mascotte le remplace dès que
// le module est chargé — une seule source de dessin, aucun SVG dupliqué.
export function mountBrandMarks() {
  const logo = document.querySelector('.logo > i.ti-chess-knight');
  if (logo) logo.outerHTML = mascotMark(24);
  const login = document.querySelector('.login-logo-icon');
  if (login && !login.querySelector('svg')) login.innerHTML = mascotSvg(76, 'wave', true);
}
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountBrandMarks);
  else mountBrandMarks();
}
