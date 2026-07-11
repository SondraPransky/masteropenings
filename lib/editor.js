// ══════════════════════════════════════════════════════
// ÉDITEUR DE VARIANTES — plateau, drag, annotations, sauvegarde (DOM)
// Extrait d'app.js (étape 1b, cf. CLAUDE.md §5.1). Cœur pur : lib/editor-core.js.
// État éditeur (_E) local à ce module ; fonctions app-level via le pont window.
// ══════════════════════════════════════════════════════
import { pgnToEditorTree, editorTreeToPGN, _findNodeByFen, nagGlyphs, _nagGroup, NAG_GLYPH, _SHAPE_COL } from './editor-core.js';
import { extractAllLines } from './core.js';
import { _buildDrillTree } from './tree.js';
import { G } from '../state.js';

// ── Ponts vers app.js (résolus au runtime via le pont window) ──
const toast = (...a) => window.toast?.(...a);
const save = (...a) => window.save?.(...a);
const fig = (x) => window.fig ? window.fig(x) : x;
const escapeHtml = (x) => window.escapeHtml ? window.escapeHtml(x) : String(x);
const showPromoPicker = (...a) => window.showPromoPicker?.(...a);
const renderDrillList = (...a) => window.renderDrillList?.(...a);
const renderClassModuleSelect = (...a) => window.renderClassModuleSelect?.(...a);
const loadStudentModules = (...a) => window.loadStudentModules?.(...a);
const syncModuleToFirestore = (...a) => window.syncModuleToFirestore?.(...a);
const _sbSaveStudentModule = (...a) => window._sbSaveStudentModule?.(...a);

// ══════════════════════════════════════════════════════
// ÉDITEUR DE VARIANTES
// ══════════════════════════════════════════════════════
const EP = { wK:'♔',wQ:'♕',wR:'♖',wB:'♗',wN:'♘',wP:'♙', bK:'♚',bQ:'♛',bR:'♜',bB:'♝',bN:'♞',bP:'♟' };
const _E = { drillIdx:-1, target:'drill', root:null, path:[], node:null, startFen:'', flipped:false, sel:null, lastFrom:null, lastTo:null };
let _eSQ = 48;

// _findNodeByFen + pgnToEditorTree → lib/editor-core.js

function openPgnEditor(i) {
  const d = G.drills[i];
  _E.target = 'drill';
  _E.drillIdx = i;
  _E.startFen = d.sessions?.[0]?.startFen || new Chess().fen();
  _E.flipped  = (d.side === 'b');
  _E.sel = _E.lastFrom = _E.lastTo = null;
  // Préférer d.pgn (contient toutes les variantes) aux sessions filtrées par varmode
  if (d.pgn) {
    try { _E.root = pgnToEditorTree(d.pgn, _E.startFen); }
    catch(e) { _E.root = null; }
  }
  if (!_E.root) {
    // Fallback : reconstruire depuis les sessions
    _E.root = { san:null, fenBefore:null, fenAfter:_E.startFen, comment:'', children:[] };
    (d.sessions||[]).forEach(sess => {
      let node = _E.root;
      if (sess.startFen && sess.startFen !== _E.startFen) {
        const par = _findNodeByFen(_E.root, sess.startFen);
        if (par) node = par;
      }
      (sess.moves||[]).forEach(mv => {
        let ch = node.children.find(c => c.san===mv.san && c.fenBefore===mv.fenBefore);
        if (!ch) {
          const g2 = new Chess(mv.fenBefore); const r = g2.move(mv.san);
          ch = { san:mv.san, fenBefore:mv.fenBefore, fenAfter:r?g2.fen():mv.fenBefore, comment:mv.comment||'', children:[] };
          node.children.push(ch);
        }
        node = ch;
      });
    });
  }
  _E.path = []; _E.node = _E.root;
  _E.createRole = null;
  document.getElementById('editor-drill-name').value = d.name;
  document.getElementById('editor-side').value = d.side || 'w';
  document.getElementById('editor-side').style.display = 'none';   // côté déjà défini → inutile en édition
  document.getElementById('editor-level').value = d.level || 'Intermédiaire';
  document.getElementById('editor-comment').value = '';
  document.getElementById('modal-pgn-editor').classList.add('on');
  _eResize(); renderEditorBoard(); renderEditorNotation(); renderEditorNagBar(); _ensureEditorArrowHandlers();
}

// Créer un module à partir d'un échiquier vide (role: 'teacher' | 'student')
function openPgnEditorNew(role) {
  _E.target     = 'drill';
  _E.drillIdx   = -1;
  _E.createRole = role;
  _E.startFen   = new Chess().fen();
  _E.flipped    = false;
  _E.sel = _E.lastFrom = _E.lastTo = null;
  _E.root = { san:null, fenBefore:null, fenAfter:_E.startFen, comment:'', children:[] };
  _E.path = []; _E.node = _E.root;
  document.getElementById('editor-drill-name').value = '';
  document.getElementById('editor-side').value = 'w';
  document.getElementById('editor-side').style.display = '';        // création : on choisit le camp
  document.getElementById('editor-level').value = 'Intermédiaire';
  document.getElementById('editor-comment').value = '';
  document.getElementById('modal-pgn-editor').classList.add('on');
  _eResize(); renderEditorBoard(); renderEditorNotation(); renderEditorNagBar(); _ensureEditorArrowHandlers();
}

function closeEditorModal() {
  document.getElementById('modal-pgn-editor').classList.remove('on');
  // Restaurer l'éditeur en mode module par défaut (après une saisie de partie).
  _E.target = 'drill';
  const mf = document.getElementById('editor-meta-fields'); if (mf) mf.style.display = '';
  const t  = document.getElementById('editor-title');       if (t)  t.textContent = '🎹 Éditeur de variantes';
}

// ── Mode « saisie de partie » (Pilier 1, P1.1b) : l'éditeur produit un PGN ──
// rendu au modal « Nouvelle partie » (métadonnées gérées là-bas). Pas de module créé.
function openGameEditor(existingPgn) {
  _E.target   = 'game';
  _E.drillIdx = -1;
  _E.createRole = null;
  _E.startFen = new Chess().fen();
  _E.flipped  = false;
  _E.sel = _E.lastFrom = _E.lastTo = null;
  let root = null;
  if (existingPgn && existingPgn.trim()) {
    try { root = pgnToEditorTree(existingPgn, _E.startFen); } catch (e) { root = null; }
  }
  _E.root = root || { san:null, fenBefore:null, fenAfter:_E.startFen, comment:'', children:[] };
  _E.path = []; _E.node = _E.root;
  // UI : masquer les champs module, adapter le titre.
  const mf = document.getElementById('editor-meta-fields'); if (mf) mf.style.display = 'none';
  const t  = document.getElementById('editor-title');       if (t)  t.textContent = '♟️ Saisie de partie — joue les coups, puis « Terminer »';
  document.getElementById('modal-pgn-editor').classList.add('on');
  _eResize(); renderEditorBoard(); renderEditorNotation(); renderEditorNagBar(); _ensureEditorArrowHandlers();
}

// Fin de saisie : sérialise l'arbre en PGN et le rend au modal « Nouvelle partie ».
function _saveEditorGame() {
  const pgn = editorTreeToPGN(_E.root);
  let allLines;
  try { allLines = extractAllLines(pgn); } catch (e) { toast('❌ PGN invalide : ' + e.message, 'ko'); return; }
  if (!allLines.some(l => l.moves.length)) { toast('⚠ Joue au moins un coup sur l\'échiquier', 'ko'); return; }
  closeEditorModal();               // remet aussi _E.target='drill' + restaure l'UI module
  window._boardEntryDone?.(pgn);    // le modal (toujours ouvert dessous) récupère le PGN
}

function _eResize() {
  const vw = window.innerWidth;
  _eSQ = vw < 500 ? 34 : vw < 750 ? 42 : 48;
  const g = document.getElementById('editor-board-grid');
  if (g) g.style.gridTemplateColumns = `repeat(8,${_eSQ}px)`;
}

let _eDragSq = null;


// ── Logique click éditeur (partagée click souris + tap tactile) ──
function editorClickSqLogic(sq, ex, ey) {
  const g=new Chess(_E.node.fenAfter);
  if(_E.sel){
    if(_E.sel===sq){_E.sel=null;renderEditorBoard();return;}
    const from=_E.sel, mp=g.get(from);
    if(mp?.type==='p'&&g.moves({square:from,verbose:true}).some(m=>m.to===sq&&m.flags.includes('p'))){
      const fen=_E.node.fenAfter;
      showPromoPicker(mp.color,ex,ey,pr=>{
        const g2=new Chess(fen),mv2=g2.move({from,to:sq,promotion:pr});
        if(mv2){_E.lastFrom=from;_E.lastTo=sq;_E.sel=null;editorApplyMove(mv2,g2.fen());}
        else{_E.sel=null;renderEditorBoard();}
      });
      return;
    }
    const mv=g.move({from,to:sq,promotion:'q'});
    if(mv){_E.lastFrom=from;_E.lastTo=sq;_E.sel=null;editorApplyMove(mv,g.fen());return;}
    const p=g.get(sq);
    _E.sel=(p&&p.color===g.turn())?sq:null;
    renderEditorBoard(); return;
  }
  const p=g.get(sq);
  if(p&&p.color===g.turn()){_E.sel=sq;renderEditorBoard();}
}

// ── Flèches & cases colorées (annotations PGN [%cal]/[%csl]) ──
let _eArrowFrom = null, _eArrowColor = null, _eArrowHandlers = false;
// _SHAPE_COL importé depuis editor-core.js (palette partagée avec le board principal)

// _parseShapes → lib/editor-core.js

function _editorShapesSVG(files, ranks) {
  const shapes = (_E.node && _E.node.shapes) || [];
  if (!shapes.length) return '';
  const S = _eSQ, N = 8*S;
  const ctr = sq => { const c = files.indexOf(sq[0]), r = ranks.indexOf(sq[1]); return (c<0||r<0) ? null : { x:(c+0.5)*S, y:(r+0.5)*S }; };
  let body = '';
  shapes.forEach(sh => {
    const col = _SHAPE_COL[sh.color] || _SHAPE_COL.green;
    if (sh.type === 'circle') {
      const p = ctr(sh.square); if (!p) return;
      body += `<circle cx="${p.x}" cy="${p.y}" r="${S*0.42}" fill="none" stroke="${col}" stroke-width="${S*0.07}" opacity="0.85"/>`;
    } else {
      const a = ctr(sh.from), b = ctr(sh.to); if (!a || !b) return;
      const dx = b.x-a.x, dy = b.y-a.y, len = Math.hypot(dx,dy)||1, ux = dx/len, uy = dy/len, ang = Math.atan2(dy,dx);
      const head = S*0.34;
      const tip = { x:b.x-ux*S*0.10, y:b.y-uy*S*0.10 };
      const lineEnd = { x:tip.x-ux*head*0.85, y:tip.y-uy*head*0.85 };
      const sx = a.x+ux*S*0.28, sy = a.y+uy*S*0.28;
      const lx = tip.x-head*Math.cos(ang-0.5), ly = tip.y-head*Math.sin(ang-0.5);
      const rx = tip.x-head*Math.cos(ang+0.5), ry = tip.y-head*Math.sin(ang+0.5);
      body += `<line x1="${sx}" y1="${sy}" x2="${lineEnd.x}" y2="${lineEnd.y}" stroke="${col}" stroke-width="${S*0.15}" stroke-linecap="round" opacity="0.8"/>`;
      body += `<polygon points="${tip.x},${tip.y} ${lx},${ly} ${rx},${ry}" fill="${col}" opacity="0.8"/>`;
    }
  });
  return `<svg width="${N}" height="${N}" viewBox="0 0 ${N} ${N}" style="position:absolute;left:0;top:0;pointer-events:none;z-index:5">${body}</svg>`;
}

function _ensureEditorArrowHandlers() {
  if (_eArrowHandlers) return;
  const grid = document.getElementById('editor-board-grid'); if (!grid) return;
  grid.addEventListener('mousedown', e => {
    if (e.button !== 0) return;                            // bouton gauche uniquement
    if (!(e.ctrlKey || e.shiftKey || e.altKey)) return;    // sans touche = jouer un coup
    const c = e.target.closest('[data-sq]'); if (!c) return;
    _eArrowFrom  = c.dataset.sq;
    _eArrowColor = e.ctrlKey ? 'green' : e.shiftKey ? 'red' : 'yellow';
    e.preventDefault();                                    // empêche sélection / glisser de pièce
  });
  grid.addEventListener('mouseup', e => {
    if (!_eArrowFrom) return;
    const c = e.target.closest('[data-sq]');
    if (c) editorToggleShape(_eArrowFrom, c.dataset.sq, _eArrowColor);
    _eArrowFrom = null; _eArrowColor = null;
  });
  window.addEventListener('mouseup', () => { _eArrowFrom = null; _eArrowColor = null; });
  _eArrowHandlers = true;
}

function editorToggleShape(from, to, color) {
  if (!_E.node || !_E.node.san) { toast('Place-toi sur un coup pour annoter', 'ko'); return; }
  color = color || 'green';
  const arr = _E.node.shapes = _E.node.shapes || [];
  if (from === to) {
    const i = arr.findIndex(s => s.type==='circle' && s.square===from);
    if (i>=0) { if (arr[i].color===color) arr.splice(i,1); else arr[i].color=color; } else arr.push({type:'circle', square:from, color});
  } else {
    const i = arr.findIndex(s => s.type==='arrow' && s.from===from && s.to===to);
    if (i>=0) { if (arr[i].color===color) arr.splice(i,1); else arr[i].color=color; } else arr.push({type:'arrow', from, to, color});
  }
  renderEditorBoard();
}
function editorClearShapes() { if (_E.node) { _E.node.shapes = []; renderEditorBoard(); } }

// _shapesToPGN + _commentWithShapes → lib/editor-core.js

function renderEditorBoard() {
  const grid = document.getElementById('editor-board-grid'); if (!grid) return;
  if (!_E?.node) return;   // éditeur jamais ouvert (ex : annulation d'une promo sur le board principal) → rien à redessiner
  const g = new Chess(_E.node.fenAfter);
  const files = _E.flipped ? ['h','g','f','e','d','c','b','a'] : ['a','b','c','d','e','f','g','h'];
  const ranks = _E.flipped ? ['1','2','3','4','5','6','7','8'] : ['8','7','6','5','4','3','2','1'];
  const turn = g.turn();
  const legal = new Set();
  if (_E.sel) g.moves({square:_E.sel,verbose:true}).forEach(m=>legal.add(m.to));
  let html = '';
  ranks.forEach((rank, ri) => {
    files.forEach((file, fi) => {
      const sq = file+rank, isLight = (fi+ri)%2===0, piece = g.get(sq);
      let bg = isLight ? '#f0d9b5' : '#b58863';
      if (sq===_E.sel) bg='#f6f669';
      else if (sq===_E.lastFrom||sq===_E.lastTo) bg=isLight?'#cdd26e':'#aaa23a';
      const pk = piece ? (piece.color+piece.type.toUpperCase()) : null;
      const canDrag = pk && piece.color===turn;
      const pcHtml = pk ? `<img src="${window.PIECE_CDN}${pk}.svg" width="${Math.round(_eSQ*.9)}" height="${Math.round(_eSQ*.9)}" draggable="false" style="pointer-events:none;display:block">` : '';
      const drag = canDrag ? `draggable="true" ondragstart="editorDragStart(event,'${sq}')"` : '';
      let dotHtml='';
      if(legal.has(sq)){
        dotHtml=piece
          ?`<div style="position:absolute;inset:0;border-radius:50%;border:3px solid rgba(0,0,0,.28);pointer-events:none"></div>`
          :`<div style="position:absolute;width:${Math.round(_eSQ*.32)}px;height:${Math.round(_eSQ*.32)}px;border-radius:50%;background:rgba(0,0,0,.19);top:50%;left:50%;transform:translate(-50%,-50%);pointer-events:none"></div>`;
      }
      html += `<div data-sq="${sq}" ${drag} onclick="editorClickSq(event,'${sq}')" ontouchstart="editorTouchStart(event,'${sq}')" ondragover="event.preventDefault()" ondrop="editorDrop(event,'${sq}')" ondragend="editorDragEnd()" style="position:relative;width:${_eSQ}px;height:${_eSQ}px;background:${bg};display:flex;align-items:center;justify-content:center;cursor:${canDrag?'grab':'default'};user-select:none;box-sizing:border-box">${pcHtml}${dotHtml}</div>`;
    });
  });
  grid.style.position = 'relative';
  grid.innerHTML = html + _editorShapesSVG(files, ranks);
  const re=document.getElementById('editor-ranks');
  if(re) re.innerHTML=ranks.map(r=>`<div style="height:${_eSQ}px;width:16px;font-size:.58rem;color:var(--dim);display:flex;align-items:center;justify-content:flex-end;padding-right:2px">${r}</div>`).join('');
  const fe=document.getElementById('editor-files');
  if(fe) fe.innerHTML=files.map(f=>`<div style="width:${_eSQ}px;font-size:.58rem;color:var(--dim);text-align:center;margin-top:2px">${f}</div>`).join('');
}

function editorDragStart(e, sq) {
  if (e.ctrlKey || e.shiftKey || e.altKey) { e.preventDefault(); return; }   // touche tenue = flèche, pas déplacement
  _eDragSq = sq; _E.sel = sq;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', sq);
  // Ghost = juste la pièce (pas toute la case)
  const p = new Chess(_E.node.fenAfter).get(sq);
  if (p) {
    const gc = document.getElementById('ghost-canvas');
    gc.width = _eSQ; gc.height = _eSQ;
    const ctx = gc.getContext('2d');
    ctx.clearRect(0, 0, _eSQ, _eSQ);
    const img = window.pieceImgs[p.color + p.type.toUpperCase()];
    if (img?.complete) ctx.drawImage(img, 0, 0, _eSQ, _eSQ);
    gc.style.cssText = 'position:fixed;top:-9999px;left:-9999px;pointer-events:none;display:block;z-index:9999';
    e.dataTransfer.setDragImage(gc, _eSQ / 2, _eSQ / 2);
    requestAnimationFrame(() => { gc.style.display = 'none'; });
  }
}
function editorDrop(e, sq) {
  e.preventDefault();
  const from = _eDragSq; _eDragSq = null;
  if (!from || from===sq) { _E.sel=null; renderEditorBoard(); return; }
  const g = new Chess(_E.node.fenAfter);
  const mp=g.get(from);
  if(mp?.type==='p'&&g.moves({square:from,verbose:true}).some(m=>m.to===sq&&m.flags.includes('p'))){
    const fen=_E.node.fenAfter;
    showPromoPicker(mp.color,e.clientX,e.clientY,pr=>{
      const g2=new Chess(fen),mv2=g2.move({from,to:sq,promotion:pr});
      if(mv2){_E.lastFrom=from;_E.lastTo=sq;_E.sel=null;editorApplyMove(mv2,g2.fen());}
      else{_E.sel=null;renderEditorBoard();}
    });
    return;
  }
  const mv = g.move({from, to:sq, promotion:'q'});
  if (mv) { _E.lastFrom=from; _E.lastTo=sq; _E.sel=null; editorApplyMove(mv, g.fen()); }
  else { _E.sel=null; renderEditorBoard(); }
}
function editorDragEnd() { _eDragSq=null; _E.sel=null; renderEditorBoard(); }

let _eTouchFrom=null, _eTouchStartXY={x:0,y:0};
function editorTouchStart(e,sq){
  if(document.getElementById('promo-pick')?.style.display==='flex') return;
  e.preventDefault();
  const t=e.touches[0]; if(!t) return;
  _eTouchFrom=sq; _eTouchStartXY={x:t.clientX,y:t.clientY};
  const g=new Chess(_E.node.fenAfter), p=g.get(sq);
  if(p&&p.color===g.turn()){
    const gc=document.getElementById('ghost-canvas');
    gc.width=_eSQ; gc.height=_eSQ;
    const ctx=gc.getContext('2d');
    ctx.clearRect(0,0,_eSQ,_eSQ);
    const img=window.pieceImgs[p.color+p.type.toUpperCase()];
    if(img?.complete){ctx.globalAlpha=.85;ctx.drawImage(img,0,0,_eSQ,_eSQ);ctx.globalAlpha=1;}
    gc.style.cssText=`position:fixed;left:${t.clientX-_eSQ/2}px;top:${t.clientY-_eSQ/2}px;width:${_eSQ}px;height:${_eSQ}px;pointer-events:none;display:block;z-index:9999`;
  }
}
document.addEventListener('touchmove',e=>{
  if(!_eTouchFrom) return;
  e.preventDefault();
  const t=e.touches[0]; if(!t) return;
  const gc=document.getElementById('ghost-canvas');
  gc.style.left=(t.clientX-_eSQ/2)+'px'; gc.style.top=(t.clientY-_eSQ/2)+'px';
},{passive:false});
document.addEventListener('touchend',e=>{
  if(!_eTouchFrom) return;
  const gc=document.getElementById('ghost-canvas'); gc.style.display='none';
  const t=e.changedTouches[0]; if(!t){_eTouchFrom=null;return;}
  const dx=t.clientX-_eTouchStartXY.x, dy=t.clientY-_eTouchStartXY.y;
  const from=_eTouchFrom; _eTouchFrom=null;
  if(Math.sqrt(dx*dx+dy*dy)<8){
    editorClickSqLogic(from,t.clientX,t.clientY);
    return;
  }
  // Drag : destination par elementFromPoint
  const el=document.elementFromPoint(t.clientX,t.clientY);
  const cell=el?.closest('[data-sq]');
  const toSq=cell?.dataset.sq;
  if(!toSq||toSq===from){_E.sel=null;renderEditorBoard();return;}
  const fen=_E.node.fenAfter, g=new Chess(fen), mp=g.get(from);
  _E.sel=null;
  if(mp?.type==='p'&&g.moves({square:from,verbose:true}).some(m=>m.to===toSq&&m.flags.includes('p'))){
    showPromoPicker(mp.color,t.clientX,t.clientY,pr=>{
      const g2=new Chess(fen),mv2=g2.move({from,to:toSq,promotion:pr});
      if(mv2){_E.lastFrom=from;_E.lastTo=toSq;editorApplyMove(mv2,g2.fen());}
      else renderEditorBoard();
    });
    return;
  }
  const mv=g.move({from,to:toSq,promotion:'q'});
  if(mv){_E.lastFrom=from;_E.lastTo=toSq;editorApplyMove(mv,g.fen());}
  else renderEditorBoard();
});

function editorClickSq(e, sq) {
  if (e && (e.ctrlKey || e.shiftKey || e.altKey)) return;   // touche tenue = annotation, pas un coup
  editorClickSqLogic(sq, e?.clientX||0, e?.clientY||0);
}

function editorApplyMove(mv, fenAfter) {
  const idx = _E.node.children.findIndex(c=>c.san===mv.san);
  if (idx>=0) { editorGoPath([..._E.path, idx]); return; }
  const newNode = { san:mv.san, fenBefore:_E.node.fenAfter, fenAfter, comment:'', children:[] };
  _E.node.children.push(newNode);
  editorGoPath([..._E.path, _E.node.children.length-1]);
}

function editorGoPath(path) {
  let node=_E.root;
  for (const idx of path) { if (!node.children[idx]) break; node=node.children[idx]; }
  _E.path=path; _E.node=node; _E.sel=null;
  renderEditorBoard(); renderEditorNotation(); renderEditorNagBar();
  document.getElementById('editor-comment').value = node.san ? node.comment : '';
}

function editorPrev() { if (_E.path.length) editorGoPath(_E.path.slice(0,-1)); }
function editorNext() { if (_E.node.children.length) editorGoPath([..._E.path, 0]); }
function flipEditorBoard() { _E.flipped=!_E.flipped; renderEditorBoard(); }
function editorSaveComment() { if (_E.node.san) _E.node.comment=document.getElementById('editor-comment').value; }

function editorDeleteNode() {
  if (!_E.path.length) { toast('Impossible de supprimer la position de départ','ko'); return; }
  let parent=_E.root;
  for (const idx of _E.path.slice(0,-1)) parent=parent.children[idx];
  parent.children.splice(_E.path[_E.path.length-1], 1);
  editorGoPath(_E.path.slice(0,-1));
}

function editorPromoteMain() {
  if (_E.path.length<1) return;
  let parent=_E.root;
  for (const idx of _E.path.slice(0,-1)) parent=parent.children[idx];
  const li=_E.path[_E.path.length-1];
  if (li===0) return;
  const node=parent.children.splice(li,1)[0];
  parent.children.unshift(node);
  editorGoPath([..._E.path.slice(0,-1), 0]);
}

// ── Annotations NAG (!, ?, !?, ±, ⩲, …) ───────────────────
const NAG_QUALITY = [3,1,5,6,2,4];          // !! ! !? ?! ? ??
const NAG_EVAL    = [10,13,14,15,16,17,18,19];
// nagGlyphs + _nagGroup → lib/editor-core.js
function editorToggleNag(n) {
  if (!_E.node || !_E.node.san) return;
  const had = (_E.node.nags||[]).includes(n);
  // un seul NAG par groupe (qualité / évaluation) → cliquer remplace
  _E.node.nags = (_E.node.nags||[]).filter(x => _nagGroup(x) !== _nagGroup(n));
  if (!had) _E.node.nags.push(n);
  _E.node.nags.sort((a,b)=>a-b);
  renderEditorNotation(); renderEditorNagBar();
}
function editorClearNags() {
  if (!_E.node || !_E.node.san) return;
  _E.node.nags = [];
  renderEditorNotation(); renderEditorNagBar();
}
function renderEditorNagBar() {
  const el = document.getElementById('editor-nag-bar'); if (!el) return;
  const dis = !(_E.node && _E.node.san);
  const active = (_E.node && _E.node.nags) ? _E.node.nags : [];
  const b = (n) => {
    const on = active.includes(n);
    return `<button type="button" onclick="editorToggleNag(${n})"${dis?' disabled':''} title="$${n}" `
      + `style="min-width:28px;padding:3px 6px;font-size:.82rem;font-weight:700;border-radius:var(--rs);`
      + `cursor:${dis?'default':'pointer'};border:1px solid ${on?'var(--cyan)':'var(--border)'};`
      + `background:${on?'var(--cyan-dim)':'var(--surf)'};color:${on?'var(--cyan)':'var(--text-2)'};opacity:${dis?'.4':'1'}">${NAG_GLYPH[n]}</button>`;
  };
  const sep = '<span style="width:8px;display:inline-block"></span>';
  const clr = `<button type="button" onclick="editorClearNags()"${(dis||!active.length)?' disabled':''} title="Effacer l'annotation" `
    + `style="min-width:28px;padding:3px 6px;font-size:.82rem;border-radius:var(--rs);cursor:${(dis||!active.length)?'default':'pointer'};`
    + `border:1px solid var(--border);background:var(--surf);color:var(--red);opacity:${(dis||!active.length)?'.4':'1'}">✕</button>`;
  el.innerHTML = NAG_QUALITY.map(b).join('') + sep + NAG_EVAL.map(b).join('') + sep + clr;
}

function renderEditorNotation() {
  const el=document.getElementById('editor-notation'); if (!el) return;
  // forceNum: afficher le numéro même pour un coup noir (après une variante)
  function nodeHTML(node, path, forceNum) {
    if (!node.children.length) return '';
    const main=node.children[0], vars=node.children.slice(1);
    const mainPath=[...path,0];
    const isCur=JSON.stringify(mainPath)===JSON.stringify(_E.path);
    const isOnPath=_E.path.length>path.length && _E.path.slice(0,path.length+1).join()===mainPath.join();
    const turn=main.fenBefore.split(' ')[1], num=main.fenBefore.split(' ')[5];
    let h='';
    // 1. Coup principal avec numéro
    if (turn==='w'||forceNum) h+=`<span style="color:var(--dim);font-size:.72rem">${num}${turn==='w'?'.':'…'}</span> `;
    const s=isCur?'background:var(--cyan);color:#111;padding:1px 6px;border-radius:3px;font-weight:700':
      isOnPath?'color:var(--text);font-weight:600':'color:var(--text-2)';
    h+=`<span onclick="editorGoPath(${JSON.stringify(mainPath)})" style="cursor:pointer;${s};padding:1px 4px;border-radius:3px">${fig(main.san)}${nagGlyphs(main)}</span>`;
    if (main.comment) h+=` <span style="color:var(--dim);font-style:italic;font-family:Inter,system-ui,sans-serif;font-size:.8rem">${escapeHtml(main.comment)}</span> `;
    // 2. Variantes immédiatement après le coup principal
    vars.forEach((v,vi) => {
      const vPath=[...path,vi+1];
      const isCurV=JSON.stringify(vPath)===JSON.stringify(_E.path);
      const isOnV=_E.path.length>path.length && _E.path.slice(0,path.length+1).join()===vPath.join();
      const vTurn=v.fenBefore.split(' ')[1], vNum=v.fenBefore.split(' ')[5];
      const vs=isCurV?'background:var(--cyan);color:#111;padding:1px 6px;border-radius:3px;font-weight:700':
        isOnV?'color:var(--text);font-weight:600':'color:var(--dim)';
      h+=` <span style="color:var(--dim)">(</span><span style="color:var(--dim);font-size:.72rem">${vNum}${vTurn==='w'?'.':'…'}</span> `;
      h+=`<span onclick="editorGoPath(${JSON.stringify(vPath)})" style="cursor:pointer;${vs};padding:1px 4px;border-radius:3px">${fig(v.san)}${nagGlyphs(v)}</span>`;
      if (v.comment) h+=` <span style="color:var(--dim);font-style:italic;font-family:Inter,system-ui,sans-serif;font-size:.8rem">${escapeHtml(v.comment)}</span> `;
      h+=nodeHTML(v,vPath,false);
      h+=`<span style="color:var(--dim)">)</span>`;
    });
    // 3. Continuation ligne principale (avec numéro si des variantes ont été affichées)
    h+=' '+nodeHTML(main, mainPath, vars.length>0);
    return h;
  }
  el.innerHTML = nodeHTML(_E.root,[],false) || '<span style="color:var(--dim);font-size:.8rem">Aucun coup — jouez sur l\'échiquier pour commencer</span>';
}

// editorTreeToPGN(root) → lib/editor-core.js

function saveEditorDrill() {
  if (_E.target === 'game') { _saveEditorGame(); return; }   // mode saisie de partie (P1.1b) → PGN rendu au modal
  const pgn  = editorTreeToPGN(_E.root);
  const name = (document.getElementById('editor-drill-name').value || '').trim();
  const side =  document.getElementById('editor-side').value || 'w';
  const level = document.getElementById('editor-level').value || 'Intermédiaire';
  if (!name) { toast('⚠ Donne un nom au module', 'ko'); return; }
  let allLines;
  try { allLines = extractAllLines(pgn); } catch(e) { toast('❌ PGN invalide : ' + e.message, 'ko'); return; }
  if (!allLines.some(l => l.moves.length)) { toast('⚠ Joue au moins un coup sur l\'échiquier', 'ko'); return; }

  const tree = _buildDrillTree(allLines, side);
  if (!Object.keys(tree).length) { toast('⚠ Aucun coup à enregistrer', 'ko'); return; }
  const sessions = [{ label: 'Arbre complet', startFen: new Chess().fen(), moves: [], kps: [] }];

  let d, isNew = false;
  if (_E.drillIdx < 0) {
    // Création
    isNew = true;
    d = {
      id: Date.now(),
      name, level, side, pgn,
      mode: 'line', varmode: 'tree', tree, sessions,
      hideComments: false, deadline: null, personal: false, ownerStudentId: null,
      created: new Date().toLocaleDateString('fr-FR'),
      updatedAt: Date.now()
    };
    if (_E.createRole === 'student') { d.personal = true; d.ownerStudentId = G.currentUser?.uid || null; }
    G.drills.push(d);
  } else {
    // Modification
    d = G.drills[_E.drillIdx];
    d.name = name; d.side = side; d.pgn = pgn; d.level = level;
    d.varmode = 'tree'; d.mode = 'line';
    d.tree = tree; d.sessions = sessions;
    d.updatedAt = Date.now();
  }

  save(); closeEditorModal();

  // Persistance selon la propriété du module
  if (G.currentUser) {
    if (d.personal) _sbSaveStudentModule(d);
    else if (G.currentRole === 'teacher') syncModuleToFirestore(d);
  }

  // Rafraîchir la bonne vue
  if (G.currentRole === 'student') loadStudentModules();
  else { renderDrillList(); renderClassModuleSelect(); }

  toast(isNew ? '✓ Module créé' : '✓ Module mis à jour', 'ok');
}

// Touches ← → dans l'éditeur
document.addEventListener('keydown', e => {
  if (!document.getElementById('modal-pgn-editor')?.classList.contains('on')) return;
  const tag=document.activeElement?.tagName;
  if (tag==='TEXTAREA'||tag==='INPUT') return;
  if (e.key==='ArrowRight') { e.preventDefault(); editorNext(); }
  if (e.key==='ArrowLeft')  { e.preventDefault(); editorPrev(); }
});



// ── Pont window : handlers onclick inline + accès depuis app.js (cancelPromo) ──
Object.assign(window, { _E, openPgnEditor, openPgnEditorNew, closeEditorModal, _eResize, editorClickSqLogic, _editorShapesSVG, _ensureEditorArrowHandlers, editorToggleShape, editorClearShapes, renderEditorBoard, editorDragStart, editorDrop, editorDragEnd, editorTouchStart, editorClickSq, editorApplyMove, editorGoPath, editorPrev, editorNext, flipEditorBoard, editorSaveComment, editorDeleteNode, editorPromoteMain, editorToggleNag, editorClearNags, renderEditorNagBar, renderEditorNotation, saveEditorDrill, openGameEditor });
