// ══════════════════════════════════════════════════════
// lib/coach-export.js — EXPORTS de la vue coach (section « Export »).
// results.csv · sessions.csv · parties.pgn · backup.json.
// Ne dépend que du socle (toast) : aucun appel vers les autres modules coach.
// ══════════════════════════════════════════════════════
import { G } from '../state.js';
import { toast } from './coach-core.js';

function _download(filename, content, mime='text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content],{type:mime}));
  a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function exportCSV() {
  const header = 'étudiant,drill,position,coup,correct,horodatage\n';
  const rows   = G.results.map(r=>
    [r.student,r.drillName,r.posIdx+1,r.san||'',r.correct?'1':'0',new Date(r.ts).toISOString()].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')
  ).join('\n');
  _download('results.csv', header+rows, 'text/csv');
}

function exportPracticeCSV() {
  const header = 'étudiant,drill,session,score%,horodatage\n';
  const rows   = G.practiceLog.map(l=>
    [l.student,l.drillName,l.sessionIdx+1,l.pct,new Date(l.ts).toISOString()].map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')
  ).join('\n');
  _download('sessions.csv', header+rows, 'text/csv');
}

function exportPGN(idx) {
  const sorted = [...G.savedGames].sort((a,b)=>b.ts-a.ts);
  const games  = idx===null ? sorted : [sorted[idx]].filter(Boolean);
  if (!games.length) { toast('Aucune partie à exporter','ko'); return; }
  const out = games.map(g=>`[Event "${g.drillName}"]\n[White "${g.side==='w'?g.student:'Maia'}"]\n[Black "${g.side==='b'?g.student:'Maia'}"]\n[Result "${g.result}"]\n[Date "${new Date(g.ts).toISOString().slice(0,10)}"]\n\n${g.pgn}\n`).join('\n\n');
  _download(idx===null?'parties.pgn':`partie_${idx+1}.pgn`, out);
}

function exportAll() {
  const data = { drills: G.drills, results: G.results, practiceLog: G.practiceLog, savedGames: G.savedGames, masteryData: G.masteryData, exportedAt: new Date().toISOString() };
  _download('backup.json', JSON.stringify(data,null,2), 'application/json');
}

// Pont window : exposé aux onclick="" (index.html).
// _download / exportPGN sont aussi appelés par coach-games.js (via le pont).
Object.assign(window, {
  _download, exportCSV, exportPracticeCSV, exportPGN, exportAll,
});
