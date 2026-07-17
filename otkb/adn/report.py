"""Rendu de la fiche ADN : texte (CLI), dict (pivot --json) et HTML autonome.

La page HTML est une « planche-spécimen » autonome (offline, CSS + JS inline) :
un échiquier thermique (les cases critiques / de sacrifice rallumées sur les 64
cases) sert de thèse visuelle, entouré d'une lecture analytique en notation
monospace. Tout le contenu textuel est rendu côté serveur (fonctionne sans JS) ;
le JS n'anime que la carte thermique et son bascule critiques ⇄ sacrifices.
"""

from __future__ import annotations

import json
from html import escape

from .queries import OpeningDNA

# glyphes figurine (police système), pour les pièces sacrifiées
_PIECE_GLYPH = {"Pion": "♟", "Cavalier": "♞", "Fou": "♝", "Tour": "♜", "Dame": "♛", "Roi": "♚"}


def _human(tag: str) -> str:
    return tag.replace("_", " ")


def render_text(dna: OpeningDNA) -> str:
    """Fiche ADN en texte (terminal)."""
    lines: list[str] = []
    title = _human(dna.query)
    lines.append(f"═══ ADN tactique — {title} ═══")

    if not dna.puzzle_count:
        lines.append("Aucun puzzle pour cette ouverture.")
        return "\n".join(lines)

    lines.append(f"Nombre de puzzles : {dna.puzzle_count}")
    if dna.avg_rating is not None:
        extra = ""
        if dna.rating_min is not None and dna.rating_max is not None:
            extra = f" (de {dna.rating_min} à {dna.rating_max})"
        lines.append(f"Rating puzzle moyen : {dna.avg_rating:.0f}{extra}")
    if dna.avg_fullmove is not None:
        lines.append(f"Coup moyen d'apparition : {dna.avg_fullmove:.1f}ᵉ")

    if dna.rating_bands and dna.puzzle_count:
        lines.append("")
        lines.append("Niveau des puzzles :")
        for r in dna.rating_bands:
            pct = 100.0 * r.count / dna.puzzle_count
            lines.append(f"  {pct:5.1f}%  {r.label}  ({r.count})")

    if dna.top_motifs:
        lines.append("")
        lines.append("Motifs tactiques dominants :")
        for m in dna.top_motifs:
            lines.append(f"  {m.pct:5.1f}%  {m.label}  ({m.count})")

    if dna.sacrificed_pieces:
        lines.append("")
        lines.append("Pièces les plus sacrifiées :")
        for r in dna.sacrificed_pieces:
            lines.append(f"  {r.count:6d}  {r.label}")

    if dna.sacrifice_squares:
        lines.append("")
        lines.append("Cases de sacrifice les plus fréquentes :")
        lines.append("  " + " · ".join(f"{r.label} ({r.count})" for r in dna.sacrifice_squares))

    if dna.critical_squares:
        lines.append("")
        lines.append("Cases critiques :")
        lines.append("  " + " · ".join(f"{r.label} ({r.count})" for r in dna.critical_squares))

    if dna.top_variations:
        lines.append("")
        lines.append("Variantes les plus tactiques :")
        for v in dna.top_variations:
            label = v.variation or _human(v.tag)
            lines.append(f"  {v.count:6d}  {label}")

    return "\n".join(lines)


def dna_to_dict(dna: OpeningDNA) -> dict:
    """Fiche ADN en dict sérialisable (format pivot pour HTML/web)."""
    return {
        "query": dna.query,
        "puzzle_count": dna.puzzle_count,
        "avg_rating": dna.avg_rating,
        "rating_min": dna.rating_min,
        "rating_max": dna.rating_max,
        "rating_bands": [{"label": r.label, "count": r.count} for r in dna.rating_bands],
        "avg_fullmove": dna.avg_fullmove,
        "top_motifs": [
            {"label": m.label, "slug": m.slug, "count": m.count, "pct": round(m.pct, 1)}
            for m in dna.top_motifs
        ],
        "top_variations": [
            {"tag": v.tag, "name": v.name, "variation": v.variation, "count": v.count}
            for v in dna.top_variations
        ],
        "sacrificed_pieces": [{"label": r.label, "count": r.count} for r in dna.sacrificed_pieces],
        "sacrifice_squares": [{"label": r.label, "count": r.count} for r in dna.sacrifice_squares],
        "critical_squares": [{"label": r.label, "count": r.count} for r in dna.critical_squares],
    }


# ───────────────────────────────────────────────────────────── HTML ──

_HTML_CSS = """
:root{
  color-scheme: light dark;
  --paper:#E6E9ED; --sheet:#F3F5F7; --panel:#FAFBFC;
  --ink:#171C23; --ink-soft:#2A313B; --muted:#616B78; --faint:#8A94A0;
  --rule:#CDD3DA; --rule-soft:#DBE0E6;
  --sq-light:#E3E7EB; --sq-dark:#C7CED5; --cold:#E1E6EA;
  --h1:#F4CE5E; --h2:#E8813C; --h3:#CE3B2E;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
  --mono:ui-monospace,"SF Mono","Cascadia Code","Segoe UI Mono",Menlo,Consolas,monospace;
}
*{ box-sizing:border-box; }
html{ -webkit-text-size-adjust:100%; }
body{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:var(--serif); font-size:17px; line-height:1.55;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  background-image:linear-gradient(var(--rule-soft) 1px, transparent 1px),
    linear-gradient(90deg, var(--rule-soft) 1px, transparent 1px);
  background-size:26px 26px; background-position:-1px -1px;
}
.plate{ max-width:1000px; margin:0 auto; padding:clamp(1rem,3vw,2.4rem); }
.sheet{ background:var(--sheet); border:1px solid var(--rule);
  box-shadow:0 1px 0 #fff inset, 0 18px 48px -30px rgba(20,28,38,.5); }
.mast{ display:grid; grid-template-columns:1.1fr .9fr; border-bottom:1px solid var(--rule); }
.mast.solo{ grid-template-columns:1fr; }
.mast .id{ padding:clamp(1.4rem,3vw,2.4rem); border-right:1px solid var(--rule); }
.mast.solo .id{ border-right:0; }
.mast .board-wrap{ padding:clamp(1.2rem,3vw,2rem); display:flex; flex-direction:column; justify-content:center; }
.eyebrow{ font-family:var(--mono); font-size:.68rem; letter-spacing:.34em; text-transform:uppercase;
  color:var(--muted); margin:0 0 1.1rem; display:flex; align-items:center; gap:.7rem; }
.eyebrow .spec{ color:var(--h3); }
.eyebrow::before{ content:""; width:20px; height:1px; background:var(--muted); }
h1{ font-family:var(--serif); font-weight:600; letter-spacing:-.015em;
  font-size:clamp(2rem,5vw,3.3rem); line-height:1.02; margin:0; }
.thesis{ margin:1.3rem 0 0; font-size:1.06rem; color:var(--ink-soft); max-width:36ch; }
.thesis b{ font-weight:600; }
.thesis .sq{ font-family:var(--mono); font-size:.9em; font-weight:600; background:var(--paper);
  border:1px solid var(--rule); border-radius:3px; padding:.02em .34em; color:var(--h3); }
.keyrow{ margin-top:1.7rem; display:flex; flex-wrap:wrap; gap:1.6rem 2.2rem; }
.kv .k{ display:block; font-family:var(--mono); font-size:.64rem; letter-spacing:.18em;
  text-transform:uppercase; color:var(--muted); margin-bottom:.15rem; }
.kv .v{ font-family:var(--mono); font-size:1.5rem; font-weight:600; letter-spacing:-.02em;
  font-variant-numeric:tabular-nums; line-height:1; }
.kv .v .unit{ font-size:.62em; color:var(--muted); font-weight:500; }
.board-head{ display:flex; align-items:baseline; justify-content:space-between; gap:1rem; margin-bottom:.8rem; }
.board-head .lab{ font-family:var(--mono); font-size:.66rem; letter-spacing:.2em;
  text-transform:uppercase; color:var(--muted); }
.toggle{ display:inline-flex; border:1px solid var(--rule); border-radius:999px; background:var(--panel); padding:2px; }
.toggle button{ font-family:var(--mono); font-size:.66rem; letter-spacing:.06em; text-transform:uppercase;
  border:0; background:transparent; color:var(--muted); padding:.3rem .7rem; border-radius:999px;
  cursor:pointer; transition:background .18s, color .18s; }
.toggle button[aria-pressed="true"]{ background:var(--ink); color:var(--sheet); }
.board{ position:relative; width:100%; max-width:420px; margin:0 auto; aspect-ratio:1/1;
  display:grid; grid-template-columns:repeat(8,1fr); grid-template-rows:repeat(8,1fr);
  border:1px solid var(--ink); border-radius:2px; overflow:hidden;
  box-shadow:0 10px 30px -18px rgba(20,28,38,.6); }
.cell{ position:relative; }
.cell .heat{ position:absolute; inset:0; opacity:0; transition:opacity .55s ease var(--d,0ms); }
.cell .cc{ position:absolute; left:3px; top:2px; font-family:var(--mono);
  font-size:clamp(.34rem,1.3vw,.56rem); color:var(--faint); opacity:.55; }
.cell .cf{ left:auto; right:3px; top:auto; bottom:1px; }
.cell .val{ position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
  font-family:var(--mono); font-size:clamp(.5rem,1.7vw,.8rem); font-weight:600; color:#fff;
  opacity:0; transition:opacity .4s; text-shadow:0 1px 2px rgba(0,0,0,.35); }
.cell.hot .val{ opacity:1; }
.legend{ display:flex; align-items:center; gap:.6rem; margin-top:.9rem; font-family:var(--mono);
  font-size:.62rem; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); }
.legend .ramp{ flex:1; height:7px; border-radius:999px;
  background:linear-gradient(90deg,var(--cold),var(--h1),var(--h2),var(--h3)); border:1px solid var(--rule); }
section{ padding:clamp(1.4rem,3.4vw,2.4rem); border-bottom:1px solid var(--rule); }
section.last{ border-bottom:0; }
.sec-head{ display:flex; align-items:baseline; gap:.9rem; margin:0 0 1.3rem; }
.sec-head .no{ font-family:var(--mono); font-size:.7rem; color:var(--h3); letter-spacing:.1em; }
.sec-head h2{ font-family:var(--serif); font-weight:600; font-size:1.2rem; letter-spacing:-.01em; margin:0; }
.sec-head .note{ margin-left:auto; font-family:var(--mono); font-size:.64rem; letter-spacing:.08em;
  text-transform:uppercase; color:var(--faint); }
.bars{ display:grid; gap:.5rem; }
.bar{ display:grid; grid-template-columns:minmax(9ch,15ch) 1fr auto; align-items:center; gap:.9rem; }
.bar .lab{ font-size:.98rem; color:var(--ink-soft); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.bar .track{ position:relative; height:11px; background:var(--paper);
  border:1px solid var(--rule-soft); border-radius:2px; overflow:hidden; }
.bar .fill{ position:absolute; inset:0 auto 0 0; background:var(--ink-soft); }
.bar.hot .fill{ background:linear-gradient(90deg,var(--h2),var(--h3)); }
.bar .num{ font-family:var(--mono); font-size:.9rem; font-variant-numeric:tabular-nums; color:var(--muted);
  white-space:nowrap; min-width:8ch; text-align:right; }
.bar .num b{ color:var(--ink); font-weight:600; }
.grid2{ display:grid; grid-template-columns:1fr 1fr; }
.grid2 > div{ padding:clamp(1.4rem,3.4vw,2.4rem); border-bottom:1px solid var(--rule); }
.grid2 > div.l{ border-right:1px solid var(--rule); }
.pieces{ display:grid; gap:.55rem; }
.piece{ display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:.8rem; }
.piece .gly{ font-size:1.5rem; line-height:1; width:1.4em; text-align:center; color:var(--ink); }
.piece .pl{ font-size:.98rem; color:var(--ink-soft); }
.piece .track{ grid-column:1/-1; height:6px; background:var(--paper); border:1px solid var(--rule-soft);
  border-radius:2px; overflow:hidden; margin-top:-.15rem; }
.piece .track i{ display:block; height:100%; background:var(--muted); }
.piece .pn{ font-family:var(--mono); font-size:.86rem; color:var(--muted); font-variant-numeric:tabular-nums; }
.vars{ list-style:none; margin:0; padding:0; }
.vars li{ display:flex; align-items:baseline; gap:.7rem; padding:.5rem 0; border-bottom:1px solid var(--rule-soft); }
.vars li:last-child{ border-bottom:0; }
.vars .rank{ font-family:var(--mono); font-size:.72rem; color:var(--faint); width:2.2ch; }
.vars .vn{ font-size:1rem; color:var(--ink-soft); }
.vars .vc{ margin-left:auto; font-family:var(--mono); font-size:.84rem; color:var(--muted); font-variant-numeric:tabular-nums; }
.spectrum{ display:flex; height:52px; border:1px solid var(--rule); border-radius:3px; overflow:hidden; }
.spectrum .seg{ position:relative; display:flex; align-items:flex-end; min-width:0; }
.spectrum .seg .cap{ position:absolute; inset:auto 0 0 0; padding:.3rem .5rem; }
.spectrum .seg .cap .p{ font-family:var(--mono); font-size:.8rem; font-weight:600; color:#fff;
  font-variant-numeric:tabular-nums; text-shadow:0 1px 2px rgba(0,0,0,.4); line-height:1; }
.band-labs{ display:flex; margin-top:.6rem; }
.band-labs span{ font-family:var(--mono); font-size:.6rem; letter-spacing:.04em; text-transform:uppercase;
  color:var(--muted); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; padding-right:.4rem; }
.colophon{ padding:clamp(1.1rem,3vw,1.6rem) clamp(1.4rem,3.4vw,2.4rem);
  display:flex; flex-wrap:wrap; gap:.4rem 1.2rem; align-items:center;
  font-family:var(--mono); font-size:.64rem; letter-spacing:.08em; text-transform:uppercase; color:var(--faint); }
.colophon .dot{ width:5px; height:5px; border-radius:50%; background:var(--h3); }
.colophon .r{ margin-left:auto; }
.empty{ padding:clamp(1.6rem,4vw,2.6rem); }
.empty p{ color:var(--muted); font-style:italic; margin:.4rem 0 0; }
@media (max-width:760px){
  .mast{ grid-template-columns:1fr; }
  .mast .id{ border-right:0; border-bottom:1px solid var(--rule); }
  .grid2{ grid-template-columns:1fr; }
  .grid2 > div.l{ border-right:0; }
  .bar{ grid-template-columns:1fr auto; }
  .bar .track{ grid-column:1/-1; order:3; margin-top:.2rem; }
}
@media (prefers-color-scheme:dark){
  :root{
    --paper:#12161B; --sheet:#181D24; --panel:#1E242C;
    --ink:#EAEEF2; --ink-soft:#C4CCD5; --muted:#8A94A0; --faint:#5C6771;
    --rule:#2C333C; --rule-soft:#242A32;
    --sq-light:#252C34; --sq-dark:#1B2128; --cold:#242B33;
  }
  .sheet{ box-shadow:0 20px 60px -34px #000; }
  .toggle button[aria-pressed="true"]{ color:#12161B; background:var(--ink); }
}
@media (prefers-reduced-motion:reduce){ *{ transition:none !important; } }
"""

_BOARD_JS = """
(function(){
  var node=document.getElementById('otkb-board-data'); if(!node) return;
  var D=JSON.parse(node.textContent);
  var board=document.getElementById('board'); if(!board) return;
  var cells={};
  board.querySelectorAll('.cell').forEach(function(c){ cells[c.dataset.sq]=c; });
  function heat(t){
    var stops=[[0,[225,230,234]],[.28,[244,206,94]],[.62,[232,129,60]],[1,[206,59,46]]];
    for(var i=1;i<stops.length;i++){ if(t<=stops[i][0]){
      var a=stops[i-1][0],ca=stops[i-1][1],b=stops[i][0],cb=stops[i][1],k=(t-a)/(b-a);
      return 'rgb('+ca.map(function(c,j){return Math.round(c+(cb[j]-c)*k);}).join(',')+')'; }}
    return 'rgb(206,59,46)';
  }
  function fmt(v){ return v>=1000?(v/1000).toFixed(1)+'k':String(v); }
  var reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  function paint(kind){
    var set=D[kind]||{}, vals=Object.keys(set).map(function(k){return set[k];});
    var max=vals.length?Math.max.apply(null,vals):1;
    Object.keys(cells).forEach(function(sq){ var c=cells[sq];
      c.classList.remove('hot'); var h=c.querySelector('.heat');
      h.style.setProperty('--d','0ms'); h.style.opacity=0; c.querySelector('.val').textContent=''; });
    Object.keys(set).sort(function(a,b){return set[a]-set[b];}).forEach(function(sq,i){
      var el=cells[sq]; if(!el) return; var t=set[sq]/max, h=el.querySelector('.heat'), col=heat(t);
      h.style.setProperty('--d', reduce?'0ms':(80*i)+'ms');
      h.style.background='radial-gradient(circle at 50% 45%, '+col+' 0%, '+col+' 55%, transparent 100%)';
      h.style.opacity=(0.35+0.65*t).toFixed(2);
      el.classList.add('hot'); el.querySelector('.val').textContent=fmt(set[sq]);
    });
  }
  var buttons=document.querySelectorAll('.toggle button[data-mode]');
  buttons.forEach(function(btn){ btn.addEventListener('click', function(){
    buttons.forEach(function(b){ b.setAttribute('aria-pressed', b===btn); });
    paint(btn.dataset.mode);
  }); });
  requestAnimationFrame(function(){ requestAnimationFrame(function(){ paint(D.default); }); });
  // filet de sécurité si le rAF est étranglé (onglet en arrière-plan) :
  setTimeout(function(){ if(!board.querySelector('.cell.hot')) paint(D.default); }, 400);
})();
"""


def _fr(n: int) -> str:
    """Entier avec espaces fines comme séparateur de milliers (fr)."""
    return f"{n:,}".replace(",", " ")


def _spec_code(query: str) -> str:
    """Code spécimen court à partir des initiales du tag (ex. Sicilian_Defense → SD)."""
    inits = [w[0] for w in query.replace("_", " ").split() if w[:1].isalpha()]
    return ("".join(inits[:4]) or query[:3]).upper()


def _thesis(dna: OpeningDNA) -> str:
    """Phrase-thèse dérivée des données (coup d'apparition + zone chaude / motif)."""
    move = f"{round(dna.avg_fullmove)}ᵉ coup" if dna.avg_fullmove else None
    hot = dna.critical_squares or dna.sacrifice_squares
    if hot:
        chips = " ".join(f'<span class="sq">{escape(r.label)}</span>' for r in hot[:3])
        if move:
            return f"La bataille s'allume vers le <b>{move}</b> et se concentre autour de {chips}."
        return f"Les tensions se concentrent autour de {chips}."
    if move and dna.top_motifs:
        return (f"Les tactiques apparaissent vers le <b>{move}</b>, portées surtout par "
                f"<b>{escape(dna.top_motifs[0].label)}</b>.")
    if dna.top_motifs:
        m = dna.top_motifs[0]
        return f"Motif dominant : <b>{escape(m.label)}</b> ({m.pct:.0f} %)."
    return "Ouverture indexée dans l'Opening Tactical Knowledge Base."


def _board_grid() -> str:
    """Les 64 cases (rangs 8→1, colonnes a→h) avec repères de coordonnées."""
    files = "abcdefgh"
    out: list[str] = []
    for rank in range(8, 0, -1):
        for f, file in enumerate(files):
            dark = (f + rank) % 2 == 0
            bg = "var(--sq-dark)" if dark else "var(--sq-light)"
            coords = '<span class="heat"></span>'
            if f == 0:
                coords += f'<span class="cc">{rank}</span>'
            if rank == 1:
                coords += f'<span class="cc cf">{file}</span>'
            coords += '<span class="val"></span>'
            out.append(f'<div class="cell" data-sq="{file}{rank}" style="background:{bg}">{coords}</div>')
    return f'<div class="board" id="board" aria-label="Cases les plus disputées">{"".join(out)}</div>'


def _board_section(dna: OpeningDNA) -> str:
    """Masthead droit : carte thermique + bascule (si les deux jeux existent)."""
    crit = {r.label: r.count for r in dna.critical_squares}
    sac = {r.label: r.count for r in dna.sacrifice_squares}
    if not crit and not sac:
        return ""
    default = "critical" if crit else "sacrifice"
    payload = json.dumps({"critical": crit, "sacrifice": sac, "default": default})
    payload = payload.replace("</", "<\\/")  # jamais fermer un <script> par erreur

    toggle = ""
    if crit and sac:
        toggle = (
            '<div class="toggle" role="group" aria-label="Type de cases">'
            '<button data-mode="critical" aria-pressed="true">Critiques</button>'
            '<button data-mode="sacrifice" aria-pressed="false">Sacrifices</button></div>'
        )
    lab = "la zone de feu" if default == "critical" else "les cases sacrifiées"
    return (
        '<div class="board-wrap">'
        f'<div class="board-head"><span class="lab">Carte thermique — {lab}</span>{toggle}</div>'
        f"{_board_grid()}"
        '<div class="legend"><span>Froid</span><span class="ramp"></span><span>Brûlant</span></div>'
        f'<script type="application/json" id="otkb-board-data">{payload}</script>'
        "</div>"
    )


def _motifs_section(dna: OpeningDNA) -> str:
    if not dna.top_motifs:
        return ""
    top = max((m.pct for m in dna.top_motifs), default=1) or 1
    rows: list[str] = []
    for i, m in enumerate(dna.top_motifs):
        w = 100.0 * m.pct / top
        hot = " hot" if i < 3 else ""
        rows.append(
            f'<div class="bar{hot}"><span class="lab">{escape(m.label)}</span>'
            f'<span class="track"><span class="fill" style="width:{w:.1f}%"></span></span>'
            f'<span class="num"><b>{m.pct:.1f} %</b> {_fr(m.count)}</span></div>'
        )
    return (
        '<section><div class="sec-head"><span class="no">A</span>'
        '<h2>Motifs tactiques dominants</h2>'
        f'<span class="note">part des {_fr(dna.puzzle_count)} puzzles</span></div>'
        f'<div class="bars">{"".join(rows)}</div></section>'
    )


def _pieces_block(dna: OpeningDNA) -> str:
    if not dna.sacrificed_pieces:
        return ""
    top = max((r.count for r in dna.sacrificed_pieces), default=1) or 1
    rows: list[str] = []
    for r in dna.sacrificed_pieces:
        gly = _PIECE_GLYPH.get(r.label, "•")
        w = 100.0 * r.count / top
        rows.append(
            f'<div class="piece"><span class="gly">{gly}</span>'
            f'<span class="pl">{escape(r.label)}</span><span class="pn">{_fr(r.count)}</span>'
            f'<span class="track"><i style="width:{w:.0f}%"></i></span></div>'
        )
    return (
        '<div class="sec-head"><span class="no">B</span><h2>Pièces sacrifiées</h2></div>'
        f'<div class="pieces">{"".join(rows)}</div>'
    )


def _vars_block(dna: OpeningDNA) -> str:
    if not dna.top_variations:
        return ""
    rows: list[str] = []
    for i, v in enumerate(dna.top_variations):
        name = v.variation or _human(v.tag)
        rows.append(
            f'<li><span class="rank">{i + 1:02d}</span>'
            f'<span class="vn">{escape(name)}</span>'
            f'<span class="vc">{_fr(v.count)}</span></li>'
        )
    return (
        '<div class="sec-head"><span class="no">C</span><h2>Variantes les plus tactiques</h2></div>'
        f'<ol class="vars">{"".join(rows)}</ol>'
    )


def _grid2_section(dna: OpeningDNA) -> str:
    left, right = _pieces_block(dna), _vars_block(dna)
    if not left and not right:
        return ""
    cells = []
    if left:
        klass = "l" if right else ""
        cells.append(f'<div class="{klass}">{left}</div>')
    if right:
        cells.append(f"<div>{right}</div>")
    return f'<div class="grid2">{"".join(cells)}</div>'


_BAND_COLORS = ["#5B6470", "#7C8794", "#E8813C", "#D65A34", "#CE3B2E"]


def _bands_section(dna: OpeningDNA) -> str:
    if not dna.rating_bands:
        return ""
    total = sum(r.count for r in dna.rating_bands) or 1
    segs, labs = [], []
    for i, r in enumerate(dna.rating_bands):
        pct = 100.0 * r.count / total
        color = _BAND_COLORS[i % len(_BAND_COLORS)]
        cap = f'<span class="cap"><span class="p">{pct:.0f} %</span></span>' if pct > 6 else ""
        segs.append(f'<div class="seg" style="flex:{r.count};background:{color}">{cap}</div>')
        # étiquette courte = borne basse de la tranche (avant la parenthèse)
        short = escape(r.label.split(" (")[0])
        labs.append(f'<span style="flex:{r.count}">{short}</span>')
    note = ""
    if dna.rating_min is not None and dna.rating_max is not None:
        note = f'<span class="note">de {dna.rating_min} à {dna.rating_max}</span>'
    return (
        '<section class="last"><div class="sec-head"><span class="no">D</span>'
        f'<h2>Niveau des puzzles</h2>{note}</div>'
        f'<div class="spectrum">{"".join(segs)}</div>'
        f'<div class="band-labs">{"".join(labs)}</div></section>'
    )


def render_html(dna: OpeningDNA) -> str:
    """Fiche ADN en page HTML autonome (planche-spécimen, CSS + JS inline, offline)."""
    title = _human(dna.query)

    if not dna.puzzle_count:
        body = (
            '<div class="sheet"><div class="empty">'
            f'<p class="eyebrow">ADN tactique</p><h1>{escape(title)}</h1>'
            '<p>Aucun puzzle pour cette ouverture.</p></div></div>'
        )
        return _html_page(title, body)

    # masthead
    solo = "" if (dna.critical_squares or dna.sacrifice_squares) else " solo"
    cards = [f'<div class="kv"><span class="k">Puzzles</span><span class="v">{_fr(dna.puzzle_count)}</span></div>']
    if dna.avg_rating is not None:
        cards.append(
            '<div class="kv"><span class="k">Rating moyen</span>'
            f'<span class="v">{dna.avg_rating:.0f}</span></div>'
        )
    if dna.avg_fullmove is not None:
        cards.append(
            '<div class="kv"><span class="k">Coup d\'apparition</span>'
            f'<span class="v">{dna.avg_fullmove:.1f}<span class="unit">ᵉ</span></span></div>'
        )
    ident = (
        '<div class="id">'
        f'<p class="eyebrow">ADN tactique <span class="spec">· spécimen {escape(_spec_code(dna.query))}</span></p>'
        f'<h1>{escape(title)}</h1>'
        f'<p class="thesis">{_thesis(dna)}</p>'
        f'<div class="keyrow">{"".join(cards)}</div></div>'
    )
    mast = f'<div class="mast{solo}">{ident}{_board_section(dna)}</div>'

    footer = (
        '<div class="colophon"><span class="dot"></span>'
        '<span>Opening Tactical Knowledge Base</span>'
        f'<span>{_fr(dna.puzzle_count)} puzzles agrégés</span>'
        '<span class="r">Fiche générée hors-ligne · Lichess puzzle DB</span></div>'
    )

    body = (
        '<div class="sheet">'
        + mast
        + _motifs_section(dna)
        + _grid2_section(dna)
        + _bands_section(dna)
        + footer
        + "</div>"
    )
    return _html_page(title, body, script=_BOARD_JS)


def _html_page(title: str, body: str, script: str = "") -> str:
    """Enveloppe la page HTML autonome (titre déjà humanisé, échappé ici)."""
    tag = f"<script>{script}</script>\n" if script else ""
    return (
        '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>ADN tactique — {escape(title)}</title>\n<style>{_HTML_CSS}</style>\n"
        '</head>\n<body>\n<div class="plate">\n' + body + "\n</div>\n" + tag + "</body>\n</html>\n"
    )
