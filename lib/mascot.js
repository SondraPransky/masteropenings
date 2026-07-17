// ══════════════════════════════════════════════════════
// MASCOTTE « chat-cavalier » (budget délice) — inline SVG pixel, 0 requête réseau.
//
// Ne paraît qu'aux moments RARES (accueil premier lancement pour l'instant ;
// fin sans-faute et états vides = phases suivantes). Jamais sur l'échiquier ni les
// dashboards — personnalité « jamais sur-gamifié ». Voir la mémoire du projet.
//
// Dessinée sur une grille 40×42, contour calculé automatiquement (silhouette
// lissée), ombrage 3 tons. Animée par les classes CSS `.msc-*` (style.css),
// toutes gardées par `prefers-reduced-motion`.
//
// ROBE ACTIVE = Roux. Pour changer : basculer `ACTIVE` (les 3 autres robes sont
// conservées ci-dessous). Seule la palette + les drapeaux tuxedo/stripes/iris
// changent — la forme est identique.
// ══════════════════════════════════════════════════════
const W = 40, H = 42;

// Accents communs à toutes les robes.
const BASE = { o:'#3f3f46', w:'#ffffff', p:'#ef9db4', i:'#6366f1', I:'#4f46e5', v:'#b8b8c0', g:'#c9a227', c:'#c9ccd3' };

const PALETTES = {
  ardoise: { b:'#6b7280', s:'#565b64', h:'#838a94', l:'#e6e6ea', k:'#27272a' },
  smoking: { b:'#40434a', s:'#2d2f34', h:'#565b64', l:'#f2f3f5', k:'#20242a', tuxedo:true },
  tigre:   { b:'#847a6c', s:'#615a4f', h:'#9a9082', l:'#ece5d7', k:'#2a2622', m:'#584f43', n:'#7fa25e', stripes:true, iris:true },
  roux:    { b:'#e6a15c', s:'#cf8640', h:'#f3bd7c', l:'#fbe9cf', k:'#4a3320', m:'#cf8640', stripes:true },
};
const ACTIVE = 'roux';

function pal(th) {
  return Object.assign({}, BASE, { b:th.b, s:th.s, h:th.h, l:th.l, k:th.k, t:th.s, m:th.m||th.s, n:th.n||th.k });
}

function grid() { const a=[]; for (let y=0;y<H;y++){ const r=[]; for (let x=0;x<W;x++) r.push('.'); a.push(r); } return a; }
function ell(x,y,cx,cy,rx,ry){ const dx=(x+.5-cx)/rx, dy=(y+.5-cy)/ry; return dx*dx+dy*dy<=1; }
function set(g,x,y,c){ if (x>=0&&x<W&&y>=0&&y<H) g[y][x]=c; }
function has(g,x,y){ const c=(g[y]||[])[x]; return c==='b'||c==='s'||c==='h'||c==='l'; }
function outline(g){
  const sd=v=>v!=='.'&&v!=='o'; const out=[];
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (g[y][x]==='.'){ if ((x>0&&sd(g[y][x-1]))||(x<W-1&&sd(g[y][x+1]))||(y>0&&sd(g[y-1][x]))||(y<H-1&&sd(g[y+1][x]))) out.push([x,y]); } }
  out.forEach(p=>{ g[p[1]][p[0]]='o'; });
}

// Queue — calque séparé (s'anime), bandée si robe tigrée/rousse.
function tailGrid(stripe){
  const g=grid(); let idx=0;
  for (let a=62;a>=-48;a-=4){ const rad=a*Math.PI/180, tx=29+6.8*Math.cos(rad), ty=31-6.8*Math.sin(rad);
    const col=(stripe&&Math.floor(idx/2)%2===1)?'m':'t';
    for (let oy=-1;oy<=1;oy++) for (let ox=-1;ox<=1;ox++){ if (ox*ox+oy*oy<=1) set(g,Math.round(tx)+ox,Math.round(ty)+oy,col); }
    idx++;
  }
  outline(g); return g;
}

// Patte qui salue — calque séparé, avant-bras court + mitaine à coussinet (salut bas).
function pawGrid(){
  const g=grid();
  for (let t=0;t<=1;t+=0.05){ const ax=12-4*t, ay=30-8*t;
    for (let oy=-1;oy<=1;oy++) for (let ox=-1;ox<=1;ox++){ if (ox*ox+oy*oy<=2) set(g,Math.round(ax)+ox,Math.round(ay)+oy,'b'); } }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (ell(x,y,7,20,3,3)) g[y][x]='b'; }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (g[y][x]==='b'&&ell(x,y,10,26,1.6,5)) g[y][x]='s'; }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (g[y][x]==='b'&&ell(x,y,6.6,20.8,2.1,1.9)) g[y][x]='l'; }
  set(g,6,21,'p'); set(g,7,21,'p'); outline(g); set(g,5,18,'o'); set(g,8,18,'o');
  return g;
}

// Corps + tête + face + accents (crête indigo + collier à médaillon = la piste A).
function build(th){
  const g=grid();
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (ell(x,y,20,17,10.6,10)||ell(x,y,20,30.5,9.8,8.6)) g[y][x]='b'; }
  for (let y=0;y<13;y++){ const hw=y/12*4.3+0.25;
    for (let x=0;x<W;x++){ if (x+.5>=12-hw&&x+.5<=12+hw) set(g,x,y,'b'); if (x+.5>=28-hw&&x+.5<=28+hw) set(g,x,y,'b'); } }
  [[9,21],[9,22],[10,23]].forEach(p=>set(g,p[0],p[1],'b'));
  [[30,21],[30,22],[29,23]].forEach(p=>set(g,p[0],p[1],'b'));
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (ell(x,y,15,38,3.2,3)||ell(x,y,25,38,3.2,3)) g[y][x]='b'; }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (g[y][x]==='b'&&ell(x,y,20,31,5.6,6.8)) g[y][x]='l'; }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (ell(x,y,15,38,2,2)||ell(x,y,25,38,2,2)) g[y][x]='l'; }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (g[y][x]==='b'&&ell(x,y,20,35.5,9,4.5)) g[y][x]='s'; }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (g[y][x]==='b'&&ell(x,y,20,25.5,7,2.6)) g[y][x]='s'; }
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (g[y][x]==='b'&&ell(x,y,15,12,3.6,3.6)) g[y][x]='h'; }
  if (th.tuxedo){ // masque : museau + bavette clairs
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (has(g,x,y)&&ell(x,y,20,24,6.5,4.8)) g[y][x]='l'; }
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (has(g,x,y)&&ell(x,y,20,33,5.2,6)) g[y][x]='l'; }
  }
  outline(g);
  [[12,7],[12,8],[11,9],[13,9]].forEach(p=>set(g,p[0],p[1],'i'));
  [[28,7],[28,8],[27,9],[29,9]].forEach(p=>set(g,p[0],p[1],'i'));
  const eyeAt=(cx,dir)=>{
    for (let y=0;y<H;y++) for (let x=0;x<W;x++){ if (ell(x,y,cx,18,2.5,3.2)) g[y][x]='k'; }
    if (th.iris){ set(g,cx,18,'n'); set(g,cx-1,18,'n'); set(g,cx,19,'n'); set(g,cx-1,19,'k'); }
    set(g,cx+3*dir,17,'k'); set(g,cx-2,16,'w'); set(g,cx-1,16,'w'); set(g,cx-2,17,'w');
  };
  eyeAt(15,-1); eyeAt(25,1);
  set(g,16,24,'l'); set(g,24,24,'l');
  [[19,23],[20,23],[20,24]].forEach(p=>set(g,p[0],p[1],'p'));
  [[17,25],[18,26],[19,25]].forEach(p=>set(g,p[0],p[1],'o'));
  [[21,25],[22,26],[23,25]].forEach(p=>set(g,p[0],p[1],'o'));
  [[4,20],[5,20],[6,20],[4,23],[5,23]].forEach(p=>set(g,p[0],p[1],'v'));
  [[35,20],[34,20],[33,20],[35,23],[34,23]].forEach(p=>set(g,p[0],p[1],'v'));
  if (th.stripes){ [[20,9],[20,10],[20,11],[17,10],[17,11],[23,10],[23,11]].forEach(p=>{ if (has(g,p[0],p[1])) set(g,p[0],p[1],'m'); }); }
  // crête indigo entre les oreilles + collier à médaillon doré
  [[19,1],[20,1],[19,2],[20,2],[20,3]].forEach(p=>set(g,p[0],p[1],'i'));
  for (let x=0;x<W;x++){ const c=g[28][x]; if ((c==='b'||c==='l'||c==='s')&&x>=13&&x<=27) g[28][x]='i'; }
  set(g,20,29,'g');
  return g;
}

function rects(g,P){
  let s='';
  for (let y=0;y<H;y++) for (let x=0;x<W;x++){ const c=g[y][x]; if (c!=='.'&&P[c]) s+=`<rect x="${x}" y="${y}" width="1.03" height="1.03" fill="${P[c]}"/>`; }
  return s;
}

/** SVG de la mascotte (robe active). `size` = largeur en px (hauteur dérivée). */
export function mascotSvg(size = 80) {
  const th = PALETTES[ACTIVE], P = pal(th);
  return `<svg class="msc" width="${size}" height="${Math.round(size * H / W)}" viewBox="0 0 ${W} ${H}" `
    + `shape-rendering="crispEdges" role="img" aria-label="Mascotte chat-cavalier">`
    + `<g class="msc-anim"><g class="msc-tail">${rects(tailGrid(th.stripes), P)}</g>`
    + `${rects(build(th), P)}<g class="msc-paw">${rects(pawGrid(), P)}</g></g></svg>`;
}
