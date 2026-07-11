// ══════════════════════════════════════════════════════
// ÉCHIQUIER — rendu canvas, drag & drop, dispatch des coups — extrait d'app.js (§5.3)
// Rendu du plateau (drawBoard/drawCoords), pièces SVG (cburnett/Lichess),
// interaction pointeur (mouse/touch/click → tryMove), sélecteur de promotion,
// navigation clavier (← →) en phase apprentissage/étude.
// État module : BSIZE/SQ, DR (drag), _lastMoveXY (exposé window pour lib/maia.js).
// Données : `S` (session.js). `_SHAPE_COL` importé (editor-core.js).
// `currentGame`/`isLineMode` (app.js) + drill/maia/editor résolus via window.
// ⚠️ Les listeners #board sont attachés au CHARGEMENT du module (import ES) :
//    #board / #ghost-canvas doivent exister (statiques dans index.html — OK).
// ══════════════════════════════════════════════════════
import { S } from './session.js';
import { _SHAPE_COL } from './editor-core.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const currentGame = (...a) => window.currentGame?.(...a);
const isLineMode  = (...a) => window.isLineMode?.(...a);

let BSIZE=480, SQ=60;
const FILES=['a','b','c','d','e','f','g','h'];
const PIECES={w:{k:'♔',q:'♕',r:'♖',b:'♗',n:'♘',p:'♙'},b:{k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'}};

// ── Pièces SVG (cburnett — Lichess) ──────────────────
const PIECE_CDN='https://cdn.jsdelivr.net/gh/lichess-org/lila@master/public/piece/cburnett/';
const pieceImgs={}; window.pieceImgs=pieceImgs; window.PIECE_CDN=PIECE_CDN;
['wK','wQ','wR','wB','wN','wP','bK','bQ','bR','bB','bN','bP'].forEach(k=>{
  const img=new Image(); img.crossOrigin='anonymous';
  img.onload=()=>{ if(document.getElementById('board')) drawBoard(); };
  img.src=PIECE_CDN+k+'.svg'; pieceImgs[k]=img;
});
function getPieceImg(color,type){
  const img=pieceImgs[color+type.toUpperCase()];
  return img&&img.complete&&img.naturalWidth>0?img:null;
}

function resizeBoard() {
  const wrap = document.getElementById('board-wrap');
  if (!wrap) return;
  if (!wrap.clientWidth) return;   // page masquée → ne pas rétrécir le plateau à son minimum
  const avail = Math.min(
    wrap.clientWidth - 30,
    window.innerHeight * 0.78,
    560
  );
  const newSize = Math.max(320, Math.floor(avail/8)*8);
  if (newSize===BSIZE) return;
  BSIZE=newSize; SQ=BSIZE/8;
  const cvs=document.getElementById('board');
  cvs.width=BSIZE; cvs.height=BSIZE;
  const ghost=document.getElementById('ghost-canvas');
  ghost.width=SQ; ghost.height=SQ;
  drawCoords(); drawBoard();
}

let _resizeTimer;
window.addEventListener('resize', ()=>{
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(resizeBoard, 120);
});

// Touches ← → pour naviguer en phase apprentissage (ligne) ET étude (arbre PGN)
document.addEventListener('keydown', e => {
  if (S.phase !== 'learn' && S.phase !== 'study') return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'ArrowRight') { e.preventDefault(); window.learnNext?.(); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); window.learnPrev?.(); }
});

function drawCoords() {
  const ranks = S.flipped?['1','2','3','4','5','6','7','8']:['8','7','6','5','4','3','2','1'];
  const files = S.flipped?[...FILES].reverse():FILES;
  document.getElementById('ranks-col').innerHTML=ranks.map(r=>`<div class="rank-lbl" style="height:${SQ}px;width:18px">${r}</div>`).join('');
  const fr=document.getElementById('files-row');
  fr.style.marginLeft='22px';
  fr.innerHTML=files.map(f=>`<div class="file-lbl" style="width:${SQ}px">${f}</div>`).join('');
}

function drawBoard() {
  const cvs=document.getElementById('board');
  const ctx=cvs.getContext('2d');
  ctx.clearRect(0,0,BSIZE,BSIZE);
  const g=currentGame();
  if(!g) return;
  const board=g.board();
  const hist=g.history({verbose:true});
  const last=hist.length?hist[hist.length-1]:null;
  const legal=new Set();
  if(S.sel) g.moves({square:S.sel,verbose:true}).forEach(m=>legal.add(m.to));

  for(let row=0;row<8;row++){
    for(let col=0;col<8;col++){
      const rr=S.flipped?7-row:row, rc=S.flipped?7-col:col;
      const sq=FILES[rc]+(8-rr);
      const light=(row+col)%2===0;
      const bg=light?'#f0d9b5':'#b58863';
      ctx.fillStyle=bg; ctx.fillRect(col*SQ,row*SQ,SQ,SQ);
      if(last&&(sq===last.from||sq===last.to)){
        ctx.fillStyle=light?'rgba(205,210,106,.76)':'rgba(170,162,58,.82)';
        ctx.fillRect(col*SQ,row*SQ,SQ,SQ);
      }
      if(sq===S.sel){
        ctx.fillStyle='rgba(20,100,0,.48)';
        ctx.fillRect(col*SQ,row*SQ,SQ,SQ);
      }
      if(sq===S.hintSquare){
        ctx.fillStyle='rgba(251,191,36,.55)';
        ctx.fillRect(col*SQ,row*SQ,SQ,SQ);
      }

      if(legal.has(sq)){
        const p=g.get(sq);
        if(p){ctx.strokeStyle='rgba(0,0,0,.35)';ctx.lineWidth=3;ctx.beginPath();ctx.arc(col*SQ+SQ/2,row*SQ+SQ/2,SQ/2-3,0,Math.PI*2);ctx.stroke();}
        else{ctx.fillStyle='rgba(0,0,0,.2)';ctx.beginPath();ctx.arc(col*SQ+SQ/2,row*SQ+SQ/2,SQ*.15,0,Math.PI*2);ctx.fill();}
      }
      const piece=board[rr][rc];
      if(piece){
        const img=getPieceImg(piece.color,piece.type);
        if(img){ ctx.drawImage(img,col*SQ,row*SQ,SQ,SQ); }
        else{
          const sym=PIECES[piece.color][piece.type];
          ctx.font=`${SQ*.76}px 'Segoe UI Symbol','Apple Symbols',serif`;
          ctx.textAlign='center';ctx.textBaseline='middle';
          const cx=col*SQ+SQ/2, cy=row*SQ+SQ/2+SQ*.02;
          ctx.fillStyle=piece.color==='w'?'rgba(0,0,0,.4)':'rgba(0,0,0,.5)';
          ctx.fillText(sym,cx+SQ*.027,cy+SQ*.034);
          ctx.fillStyle=piece.color==='w'?'#fefefe':'#131313';
          ctx.fillText(sym,cx,cy);
        }
      }
    }
  }
  // Flèches / cercles du PGN (phase apprentissage) — dual coding
  if (S.phase === 'study' && S.studyNode && S.studyNode.shapes && S.studyNode.shapes.length)
    _drawBoardShapes(ctx, S.studyNode.shapes);
}

// Centre pixel d'une case sur l'échiquier principal (gère le retournement)
function _sqCenter(sq) {
  const fileIdx = FILES.indexOf(sq[0]);
  const rankNum = parseInt(sq[1], 10);
  if (fileIdx < 0 || !rankNum) return null;
  const rr = 8 - rankNum, rc = fileIdx;
  const row = S.flipped ? 7 - rr : rr;
  const col = S.flipped ? 7 - rc : rc;
  return { x: col*SQ + SQ/2, y: row*SQ + SQ/2 };
}

// Dessine les flèches/cercles ([%cal]/[%csl]) sur le canvas principal
function _drawBoardShapes(ctx, shapes) {
  ctx.save();
  shapes.forEach(sh => {
    const col = _SHAPE_COL[sh.color] || _SHAPE_COL.green;
    if (sh.type === 'circle') {
      const p = _sqCenter(sh.square); if (!p) return;
      ctx.globalAlpha = 0.85; ctx.strokeStyle = col; ctx.lineWidth = SQ*0.07;
      ctx.beginPath(); ctx.arc(p.x, p.y, SQ*0.42, 0, Math.PI*2); ctx.stroke();
    } else {
      const a = _sqCenter(sh.from), b = _sqCenter(sh.to); if (!a || !b) return;
      const dx = b.x-a.x, dy = b.y-a.y, len = Math.hypot(dx,dy)||1, ux = dx/len, uy = dy/len, ang = Math.atan2(dy,dx);
      const head = SQ*0.34;
      const tip = { x: b.x-ux*SQ*0.10, y: b.y-uy*SQ*0.10 };
      const lineEnd = { x: tip.x-ux*head*0.85, y: tip.y-uy*head*0.85 };
      const sx = a.x+ux*SQ*0.28, sy = a.y+uy*SQ*0.28;
      ctx.globalAlpha = 0.8; ctx.strokeStyle = col; ctx.fillStyle = col;
      ctx.lineWidth = SQ*0.15; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(lineEnd.x, lineEnd.y); ctx.stroke();
      const lx = tip.x-head*Math.cos(ang-0.5), ly = tip.y-head*Math.sin(ang-0.5);
      const rx = tip.x-head*Math.cos(ang+0.5), ry = tip.y-head*Math.sin(ang+0.5);
      ctx.beginPath(); ctx.moveTo(tip.x,tip.y); ctx.lineTo(lx,ly); ctx.lineTo(rx,ry); ctx.closePath(); ctx.fill();
    }
  });
  ctx.restore();
}

function sqFromXY(x,y){
  let c=Math.floor(x/SQ),r=Math.floor(y/SQ);
  if(S.flipped){c=7-c;r=7-r;}
  if(c<0||c>7||r<0||r>7) return null;
  return FILES[c]+(8-r);
}
function evXY(e){
  const t=(e.touches&&e.touches.length)?e.touches[0]:e.changedTouches?e.changedTouches[0]:e;
  const rect=document.getElementById('board').getBoundingClientRect();
  return{x:(t.clientX-rect.left)*(BSIZE/rect.width),y:(t.clientY-rect.top)*(BSIZE/rect.height)};
}

// Drag
const DR={active:false,from:null};
let _suppressNextClick=false;
let _reselect=false; // pièce déjà sélectionnée au moment du mousedown
const _lastMoveXY={x:0,y:0}; window._lastMoveXY=_lastMoveXY;   // objet stable (muté en place) — lu par lib/maia.js pour positionner le sélecteur de promo
const ghost=document.getElementById('ghost-canvas');

function drawGhost(piece){
  ghost.width=SQ; ghost.height=SQ;
  const ctx=ghost.getContext('2d');
  ctx.clearRect(0,0,SQ,SQ);
  const img=getPieceImg(piece.color,piece.type);
  if(img){ ctx.globalAlpha=.85; ctx.drawImage(img,0,0,SQ,SQ); ctx.globalAlpha=1; }
  else{
    const sym=PIECES[piece.color][piece.type];
    ctx.font=`${SQ*.82}px 'Segoe UI Symbol','Apple Symbols',serif`;ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillStyle=piece.color==='w'?'rgba(0,0,0,.4)':'rgba(0,0,0,.5)';ctx.fillText(sym,SQ/2+SQ*.027,SQ/2+SQ*.038);
    ctx.fillStyle=piece.color==='w'?'#fefefe':'#131313';ctx.fillText(sym,SQ/2,SQ/2+SQ*.02);
  }
}
function posGhost(cx,cy){ghost.style.left=(cx-SQ/2)+'px';ghost.style.top=(cy-SQ/2)+'px';}

function canInteract() {
  if (S.phase === 'study') return window._studyGuessReady?.();   // interactif seulement en mode « devine le coup »
  if (S.phase === 'learn') return false;
  const g=currentGame();
  if(!g) return false;
  if(S.postTheory) return S.lineGame && !S.lineGame.game_over() && S.lineGame.turn()===S.drill.side;
  if(S.drill?.varmode === 'tree') return S.waitingForPlayer;
  if(isLineMode()) return S.waitingForPlayer;
  return S.posIdx < S.kps.length;
}

const cvs=document.getElementById('board');
cvs.addEventListener('mousedown',e=>{
  if(!canInteract()) return;
  const{x,y}=evXY(e); const sq=sqFromXY(x,y); if(!sq) return;
  const g=currentGame();
  const p=g.get(sq); if(!p||p.color!==g.turn()) return;
  _reselect=(S.sel===sq);
  DR.active=true; DR.from=sq; S.sel=sq;
  drawGhost(p); ghost.style.display='block'; posGhost(e.clientX,e.clientY); drawBoard();
});
cvs.addEventListener('touchstart',e=>{
  e.preventDefault();
  if(!canInteract()) return;
  const{x,y}=evXY(e); const sq=sqFromXY(x,y); if(!sq) return;
  const g=currentGame();
  const p=g.get(sq); if(!p||p.color!==g.turn()) return;
  _reselect=(S.sel===sq);
  DR.active=true; DR.from=sq; S.sel=sq;
  drawGhost(p); ghost.style.display='block'; posGhost(e.touches[0].clientX,e.touches[0].clientY); drawBoard();
},{passive:false});

document.addEventListener('mousemove',e=>{if(DR.active)posGhost(e.clientX,e.clientY);});
document.addEventListener('touchmove',e=>{if(DR.active){e.preventDefault();posGhost(e.touches[0].clientX,e.touches[0].clientY);}},{passive:false});

document.addEventListener('mouseup',e=>{
  if(!DR.active) return;
  ghost.style.display='none'; DR.active=false;
  const{x,y}=evXY(e); const sq=sqFromXY(x,y);
  const from=DR.from; S.sel=null;
  if(!sq||sq===from){S.sel=_reselect?null:from;_reselect=false;_suppressNextClick=true;drawBoard();return;}
  _reselect=false; _lastMoveXY.x=e.clientX; _lastMoveXY.y=e.clientY; tryMove(from,sq);
});
document.addEventListener('touchend',e=>{
  if(DR.active){
    ghost.style.display='none'; DR.active=false;
    const{x,y}=evXY(e); const sq=sqFromXY(x,y);
    const from=DR.from; S.sel=null;
    if(!sq||sq===from){S.sel=_reselect?null:from;_reselect=false;drawBoard();return;}
    _reselect=false; _lastMoveXY.x=e.changedTouches[0]?.clientX||0; _lastMoveXY.y=e.changedTouches[0]?.clientY||0; tryMove(from,sq);
    return;
  }
  // Tap-tap : second tap sur destination
  if(S.sel){
    const{x,y}=evXY(e); const sq=sqFromXY(x,y);
    if(!sq||sq===S.sel) return;
    const g=currentGame();
    const p2=g.get(sq);
    if(p2&&p2.color===g.turn()){S.sel=sq;drawBoard();return;}
    const from=S.sel; S.sel=null;
    _lastMoveXY.x=e.changedTouches[0]?.clientX||0; _lastMoveXY.y=e.changedTouches[0]?.clientY||0;
    tryMove(from,sq);
  }
});

cvs.addEventListener('click',e=>{
  if(_suppressNextClick){_suppressNextClick=false;return;}
  if(!canInteract()) return;
  const{x,y}=evXY(e); const sq=sqFromXY(x,y); if(!sq) return;
  const g=currentGame();
  if(!S.sel){
    const p=g.get(sq);
    if(p&&p.color===g.turn()){S.sel=sq;drawBoard();}
    return;
  }
  if(sq===S.sel){S.sel=null;drawBoard();return;}
  const p2=g.get(sq);
  if(p2&&p2.color===g.turn()){S.sel=sq;drawBoard();return;}
  const from=S.sel; S.sel=null;
  _lastMoveXY.x=e.clientX; _lastMoveXY.y=e.clientY;
  tryMove(from,sq);
});

function tryMove(from, to) {
  if(S.phase==='study') { window.tryStudyGuess?.(from,to); return; }
  if(S.sr && S.sr.active) { window.tryMoveInPositions?.(from,to); return; }   // session SR : toujours le flux « positions » (quel que soit le varmode)
  if(S.postTheory) window.tryMovePostTheory?.(from,to);
  else if(S.drill?.varmode==='tree') window.tryMoveInTree?.(from,to);
  else if(isLineMode()) window.tryMoveInLine?.(from,to);
  else window.tryMoveInPositions?.(from,to);
}

function flipBoard(){S.flipped=!S.flipped;drawCoords();drawBoard();}

// ── Promotion picker ──────────────────────────────────────
let _promoCallback = null;
function showPromoPicker(color, cx, cy, cb) {
  _promoCallback = cb;
  const pick = document.getElementById('promo-pick');
  const bd   = document.getElementById('promo-backdrop');
  pick.innerHTML = ['q','r','b','n'].map(p => {
    const k=color+p.toUpperCase(), img=pieceImgs[k], sz=54;
    return `<div onclick="pickPromo('${p}')" style="cursor:pointer;width:${sz}px;height:${sz}px;border-radius:6px;border:2px solid var(--border);display:flex;align-items:center;justify-content:center;background:var(--surf2);box-sizing:border-box">`
      +(img?.complete?`<img src="${img.src}" width="${Math.round(sz*.88)}" height="${Math.round(sz*.88)}" draggable="false">`:p.toUpperCase())
      +`</div>`;
  }).join('');
  pick.style.display='flex';
  if(bd) bd.style.display='block';
  const pw=54*4+48, ph=54+20;
  pick.style.left=Math.max(8,Math.min(cx-pw/2,window.innerWidth-pw-8))+'px';
  pick.style.top =Math.max(8,Math.min(cy-ph/2,window.innerHeight-ph-8))+'px';
}
function pickPromo(p) {
  document.getElementById('promo-pick').style.display='none';
  const bd=document.getElementById('promo-backdrop'); if(bd) bd.style.display='none';
  if(_promoCallback){const cb=_promoCallback;_promoCallback=null;cb(p);}
}
function cancelPromo() {
  document.getElementById('promo-pick').style.display='none';
  const bd=document.getElementById('promo-backdrop'); if(bd) bd.style.display='none';
  _promoCallback=null; if(window._E) window._E.sel=null; S.sel=null;
  if(document.getElementById('board')) drawBoard();
  window.renderEditorBoard?.();
}

// Pont window : exposé aux onclick="" (index.html) et aux appels app.js/lib.
Object.assign(window, {
  getPieceImg, resizeBoard, drawCoords, drawBoard, _sqCenter, _drawBoardShapes,
  sqFromXY, evXY, drawGhost, posGhost, canInteract, tryMove, flipBoard,
  showPromoPicker, pickPromo, cancelPromo,
});
