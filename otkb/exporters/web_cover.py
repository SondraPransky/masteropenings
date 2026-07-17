"""Page de garde de l'artefact web (`index.html`, autonome, offline).

Front door du dataset : dérive de la base (source) les chiffres du corpus et les
N ouvertures les plus jouées, et rend une page HTML autonome (CSS + JS inline,
aucune ressource externe) dans la même identité que la fiche ADN — un
« contact-sheet » d'empreintes tactiques (mini-échiquiers thermiques des cases
critiques). Écrite à côté de `otkb-web.sqlite` par `export-web`.

Pur SQL (via `compute_dna`) + stdlib ; aucun réseau, aucun python-chess.
"""

from __future__ import annotations

import json
from html import escape

from ..adn.queries import compute_dna
from ..adn.report import _spec_code  # code court (initiales du tag)
from ..db import Database

_TOP_DEFAULT = 6


def _fr(n: int) -> str:
    return f"{n:,}".replace(",", " ")


def _corpus_totals(db: Database) -> dict[str, int]:
    con = db.conn
    return {
        "puzzles": con.execute("SELECT COUNT(*) FROM puzzles").fetchone()[0],
        "openings": con.execute("SELECT COUNT(*) FROM openings").fetchone()[0],
        "families": con.execute(
            "SELECT COUNT(DISTINCT family) FROM openings WHERE family IS NOT NULL"
        ).fetchone()[0],
        "motifs": con.execute("SELECT COUNT(*) FROM themes WHERE is_motif = 1").fetchone()[0],
    }


def _top_families(db: Database, top_n: int) -> list[dict]:
    rows = db.conn.execute(
        """
        SELECT o.family AS fam, COUNT(DISTINCT po.puzzle_id) AS c
        FROM openings o JOIN puzzle_openings po ON po.opening_id = o.opening_id
        WHERE o.family IS NOT NULL
        GROUP BY o.family ORDER BY c DESC LIMIT ?
        """,
        (top_n,),
    ).fetchall()
    out: list[dict] = []
    for r in rows:
        d = compute_dna(db, r["fam"])
        motif = d.top_motifs[0] if d.top_motifs else None
        out.append(
            {
                "name": r["fam"].replace("_", " "),
                "code": _spec_code(r["fam"]),
                "n": d.puzzle_count,
                "fm": round(d.avg_fullmove, 1) if d.avg_fullmove else None,
                "rating": round(d.avg_rating) if d.avg_rating else None,
                "motif": motif.label if motif else None,
                "motif_pct": round(motif.pct) if motif else None,
                "crit": {x.label: x.count for x in d.critical_squares},
            }
        )
    return out


def _insight(families: list[dict]) -> str:
    """Narratif dérivé des données : motif partagé ou signatures distinctes."""
    motifs = {f["motif"] for f in families if f["motif"]}
    n = len(families)
    if len(motifs) == 1 and families:
        shared = escape(next(iter(motifs)))
        return (
            f'<span class="mk">Le fil rouge</span><p>Dans les {n} ouvertures les plus '
            f"jouées, un même motif domine : <b>{shared}</b>. Ce qui change d'une ouverture "
            "à l'autre, c'est <b>l'endroit où le feu se déclare</b> — lisible d'un coup d'œil "
            "sur chaque échiquier ci-dessous.</p>"
        )
    return (
        '<span class="mk">À lire</span><p>Chaque ouverture porte sa <b>signature</b> : '
        "un motif dominant et une zone de feu qui lui sont propres. Les mini-échiquiers "
        "ci-dessous en donnent l'empreinte — plus une case est chaude, plus la tactique "
        "s'y concentre.</p>"
    )


def render_cover(db: Database, *, sqlite_name: str = "otkb-web.sqlite", top_n: int = _TOP_DEFAULT) -> str:
    """Rend la page de garde HTML autonome de l'artefact web."""
    totals = _corpus_totals(db)
    families = _top_families(db, top_n)
    payload = json.dumps(families, ensure_ascii=False).replace("</", "<\\/")

    stats = [
        ("Puzzles", _fr(totals["puzzles"])),
        ("Ouvertures", _fr(totals["openings"])),
        ("Familles", _fr(totals["families"])),
        ("Motifs", _fr(totals["motifs"])),
    ]
    stats_html = "".join(
        f'<div class="stat"><span class="v">{v}</span><span class="k">{k}</span></div>'
        for k, v in stats
    )

    body = (
        '<div class="cover">'
        '<header class="hero">'
        '<p class="eyebrow">Opening Tactical Knowledge Base <span class="spec">· artefact web</span></p>'
        '<h1>L\'<span class="em">ADN tactique</span><br>de chaque ouverture.</h1>'
        '<p class="lede">Chaque ouverture laisse une empreinte : l\'endroit où le jeu prend '
        "feu, le moment où la tactique surgit, les pièces qui tombent. OTKB lit le corpus de "
        "puzzles Lichess et en extrait la signature — case par case, hors ligne.</p>"
        f'<div class="stats">{stats_html}</div></header>'
        f'<div class="insight">{_insight(families)}</div>'
        '<section class="gallery">'
        '<div class="sec-head"><h2>Empreintes tactiques</h2>'
        f'<span class="note">les {len(families)} ouvertures les plus jouées · cases critiques</span></div>'
        '<div class="cards" id="cards"></div></section>'
        '<div class="foot"><span class="legend">Froid <span class="ramp"></span> Brûlant</span>'
        f'<span class="cite">Généré hors-ligne · {escape(sqlite_name)} · sql.js</span></div>'
        "</div>"
        f'<script type="application/json" id="cover-data">{payload}</script>'
        f"<script>{_COVER_JS}</script>"
    )
    return (
        '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        "<title>Opening Tactical Knowledge Base — l'ADN tactique des ouvertures</title>\n"
        f"<style>{_COVER_CSS}</style>\n</head>\n<body>\n{body}\n</body>\n</html>\n"
    )


_COVER_CSS = """
:root{
  color-scheme: light dark;
  --paper:#E6E9ED; --sheet:#F3F5F7; --panel:#FAFBFC;
  --ink:#171C23; --ink-soft:#2A313B; --muted:#616B78; --faint:#8A94A0;
  --rule:#CDD3DA; --rule-soft:#DBE0E6; --sq-light:#E3E7EB; --sq-dark:#C7CED5;
  --h1:#F4CE5E; --h2:#E8813C; --h3:#CE3B2E;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,"Book Antiqua",Georgia,serif;
  --mono:ui-monospace,"SF Mono","Cascadia Code","Segoe UI Mono",Menlo,Consolas,monospace;
}
@media (prefers-color-scheme:dark){
  :root{
    --paper:#12161B; --sheet:#181D24; --panel:#1E242C;
    --ink:#EAEEF2; --ink-soft:#C4CCD5; --muted:#8A94A0; --faint:#5C6771;
    --rule:#2C333C; --rule-soft:#242A32; --sq-light:#252C34; --sq-dark:#1B2128;
  }
}
*{ box-sizing:border-box; }
body{
  margin:0; background:var(--paper); color:var(--ink);
  font-family:var(--serif); font-size:17px; line-height:1.55;
  -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility;
  background-image:linear-gradient(var(--rule-soft) 1px, transparent 1px),
    linear-gradient(90deg, var(--rule-soft) 1px, transparent 1px);
  background-size:26px 26px; background-position:-1px -1px;
}
.cover{ max-width:1060px; margin:0 auto; padding:clamp(1rem,3vw,2.4rem); }
.eyebrow{ font-family:var(--mono); font-size:.7rem; letter-spacing:.34em; text-transform:uppercase;
  color:var(--muted); margin:0 0 1.4rem; display:flex; align-items:center; gap:.7rem; }
.eyebrow .spec{ color:var(--h3); }
.eyebrow::before{ content:""; width:26px; height:1px; background:var(--muted); }
.hero{ background:var(--sheet); border:1px solid var(--rule);
  box-shadow:0 1px 0 #fff inset, 0 20px 52px -34px rgba(20,28,38,.5);
  padding:clamp(1.8rem,4vw,3.4rem); }
h1{ font-family:var(--serif); font-weight:600; letter-spacing:-.02em; text-wrap:balance;
  font-size:clamp(2.4rem,6.4vw,4.6rem); line-height:.98; margin:0; }
h1 .em{ font-style:italic; color:var(--h3); }
.lede{ margin:1.6rem 0 0; font-size:clamp(1.05rem,2.1vw,1.28rem); color:var(--ink-soft);
  max-width:56ch; text-wrap:pretty; }
.stats{ margin-top:2.3rem; padding-top:1.7rem; border-top:1px solid var(--rule);
  display:grid; grid-template-columns:repeat(4,auto); gap:1rem 2.6rem; justify-content:start; }
.stat .v{ font-family:var(--mono); font-size:clamp(1.2rem,2.6vw,1.7rem); font-weight:600;
  letter-spacing:-.02em; font-variant-numeric:tabular-nums; line-height:1; }
.stat .k{ display:block; font-family:var(--mono); font-size:.62rem; letter-spacing:.16em;
  text-transform:uppercase; color:var(--muted); margin-top:.35rem; }
.insight{ margin:1.6rem 0 0; display:flex; gap:1rem; align-items:flex-start;
  background:var(--panel); border:1px solid var(--rule); border-left:3px solid var(--h3);
  padding:1.1rem 1.4rem; }
.insight .mk{ font-family:var(--mono); font-size:.66rem; letter-spacing:.14em; text-transform:uppercase;
  color:var(--h3); white-space:nowrap; padding-top:.2rem; }
.insight p{ margin:0; font-size:1.02rem; color:var(--ink-soft); max-width:64ch; }
.insight b{ font-weight:600; color:var(--ink); }
.gallery{ margin-top:2.2rem; }
.sec-head{ display:flex; align-items:baseline; gap:.9rem; margin:0 0 1.2rem; }
.sec-head h2{ font-family:var(--serif); font-weight:600; font-size:1.25rem; letter-spacing:-.01em; margin:0; }
.sec-head .note{ margin-left:auto; font-family:var(--mono); font-size:.64rem; letter-spacing:.08em;
  text-transform:uppercase; color:var(--faint); }
.cards{ display:grid; grid-template-columns:repeat(3,1fr); gap:1px; background:var(--rule);
  border:1px solid var(--rule); }
.card{ background:var(--sheet); padding:1.3rem 1.3rem 1.4rem; display:flex; flex-direction:column;
  gap:.9rem; transition:background .2s; }
.card:hover{ background:var(--panel); }
.card .top{ display:flex; align-items:baseline; justify-content:space-between; gap:.6rem; }
.card .cname{ font-family:var(--serif); font-weight:600; font-size:1.16rem; letter-spacing:-.01em; margin:0; }
.card .code{ font-family:var(--mono); font-size:.62rem; letter-spacing:.14em; color:var(--faint); }
.mini{ position:relative; width:100%; max-width:190px; aspect-ratio:1/1; display:grid;
  grid-template-columns:repeat(8,1fr); grid-template-rows:repeat(8,1fr);
  border:1px solid var(--ink); border-radius:2px; overflow:hidden;
  box-shadow:0 8px 22px -16px rgba(20,28,38,.6); align-self:center; }
.mc{ position:relative; }
.mc .heat{ position:absolute; inset:0; opacity:0; transition:opacity .5s ease var(--d,0ms); }
.metrics{ display:flex; gap:1.3rem; }
.metrics .m .mv{ font-family:var(--mono); font-size:1.05rem; font-weight:600;
  font-variant-numeric:tabular-nums; line-height:1; }
.metrics .m .mk{ display:block; font-family:var(--mono); font-size:.56rem; letter-spacing:.12em;
  text-transform:uppercase; color:var(--muted); margin-top:.3rem; }
.hotsq{ display:flex; flex-wrap:wrap; gap:.35rem; align-items:center; }
.hotsq .hl{ font-family:var(--mono); font-size:.56rem; letter-spacing:.12em; text-transform:uppercase;
  color:var(--muted); margin-right:.2rem; }
.hotsq .sq{ font-family:var(--mono); font-size:.78rem; font-weight:600; color:#fff;
  border-radius:3px; padding:.05em .4em; font-variant-numeric:tabular-nums; }
.card .motif{ font-size:.92rem; color:var(--muted); margin:0; padding-top:.7rem;
  border-top:1px solid var(--rule-soft); }
.card .motif b{ color:var(--ink-soft); font-weight:600; }
.foot{ margin-top:1.8rem; display:flex; flex-wrap:wrap; gap:1rem 2rem; align-items:center;
  padding:1.2rem 1.4rem; background:var(--sheet); border:1px solid var(--rule); }
.foot .legend{ display:flex; align-items:center; gap:.6rem; font-family:var(--mono); font-size:.62rem;
  letter-spacing:.1em; text-transform:uppercase; color:var(--muted); }
.foot .legend .ramp{ width:120px; height:7px; border-radius:999px;
  background:linear-gradient(90deg,var(--sq-light),var(--h1),var(--h2),var(--h3)); border:1px solid var(--rule); }
.foot .cite{ margin-left:auto; font-family:var(--mono); font-size:.62rem; letter-spacing:.08em;
  text-transform:uppercase; color:var(--faint); }
@media (max-width:820px){ .cards{ grid-template-columns:repeat(2,1fr); } .stats{ grid-template-columns:repeat(2,auto); } }
@media (max-width:520px){ .cards{ grid-template-columns:1fr; } }
@media (prefers-reduced-motion:reduce){ *{ transition:none !important; } }
"""

_COVER_JS = """
(function(){
  var DATA=JSON.parse(document.getElementById('cover-data').textContent);
  var files="abcdefgh";
  function heat(t){
    var s=[[0,[225,230,234]],[.28,[244,206,94]],[.62,[232,129,60]],[1,[206,59,46]]];
    for(var i=1;i<s.length;i++){ if(t<=s[i][0]){ var a=s[i-1][0],ca=s[i-1][1],b=s[i][0],cb=s[i][1],k=(t-a)/(b-a);
      return 'rgb('+ca.map(function(c,j){return Math.round(c+(cb[j]-c)*k);}).join(',')+')'; }}
    return 'rgb(206,59,46)';
  }
  function fr(n){ return n.toLocaleString('fr-FR'); }
  var reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
  var wrap=document.getElementById('cards'); var boards=[];
  DATA.forEach(function(d){
    var card=document.createElement('div'); card.className='card';
    var mini='<div class="mini">';
    for(var r=8;r>=1;r--) for(var f=0;f<8;f++){
      var dark=(f+r)%2===0, sq=files[f]+r;
      mini+='<div class="mc" data-sq="'+sq+'" style="background:'+(dark?'var(--sq-dark)':'var(--sq-light)')+'"><span class="heat"></span></div>';
    }
    mini+='</div>';
    var vals=Object.keys(d.crit).map(function(k){return d.crit[k];});
    var max=vals.length?Math.max.apply(null,vals):1;
    var hot=Object.keys(d.crit).sort(function(a,b){return d.crit[b]-d.crit[a];}).slice(0,3);
    var chips=hot.map(function(sq){ return '<span class="sq" style="background:'+heat(d.crit[sq]/max)+'">'+sq+'</span>'; }).join('');
    var metrics='<div class="metrics">'
      +'<div class="m"><span class="mv">'+fr(d.n)+'</span><span class="mk">Puzzles</span></div>'
      +(d.fm!=null?'<div class="m"><span class="mv">'+d.fm.toFixed(1)+'\\u1D49</span><span class="mk">Apparition</span></div>':'')
      +(d.rating!=null?'<div class="m"><span class="mv">'+d.rating+'</span><span class="mk">Rating \\u2300</span></div>':'')
      +'</div>';
    var motif=d.motif?'<p class="motif"><b>'+d.motif_pct+' %</b> \\u2014 '+d.motif+'</p>':'';
    card.innerHTML='<div class="top"><h3 class="cname">'+d.name+'</h3><span class="code">'+d.code+'</span></div>'
      +mini+metrics+'<div class="hotsq"><span class="hl">Feu</span>'+chips+'</div>'+motif;
    wrap.appendChild(card);
    var cells={}; card.querySelectorAll('.mc').forEach(function(c){ cells[c.dataset.sq]=c; });
    boards.push({crit:d.crit,max:max,cells:cells});
  });
  function ignite(){ var gi=0;
    boards.forEach(function(b){
      Object.keys(b.crit).sort(function(a,c){return b.crit[a]-b.crit[c];}).forEach(function(sq){
        var el=b.cells[sq]; if(!el) return; var t=b.crit[sq]/b.max, col=heat(t), h=el.querySelector('.heat');
        h.style.setProperty('--d', reduce?'0ms':(30*gi)+'ms');
        h.style.background='radial-gradient(circle at 50% 45%, '+col+' 0%, '+col+' 55%, transparent 100%)';
        h.style.opacity=(0.32+0.68*t).toFixed(2); gi++;
      });
    });
  }
  requestAnimationFrame(function(){ requestAnimationFrame(ignite); });
  setTimeout(function(){ if(!document.querySelector('.mini .heat[style*="opacity"]')) ignite(); }, 500);
})();
"""
