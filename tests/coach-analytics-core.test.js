// Tests du socle pur de la section coach « Analyse d'ouvertures » (OA/D18).
import { describe, it, expect } from 'vitest';
import {
  bucketShort, bucketLabel, fmtLoss, fmtPct, fmtCrit, fmtDwr,
  fmtLossShort, fmtDwrShort,
  filterErrors, filterErrorsIndexed, capTopCrit, sortErrors, oaaFenIndex, errorToKp, errorComment,
} from '../lib/coach-analytics-core.js';

const ERR = {
  fen: 'r1bqr1k1/pppp1ppp/2n2n2/8/1bB1P3/2N1Q3/PPPB1PPP/2KR2NR b - - 0 1',
  stm: 'b', line: '1.e4 e5 2.d4 exd4', san: 'Bxc3', uci: 'b4c3',
  bestSan: 'd6', bestUci: 'd7d6', freq: 0.5682, games: 1200,
  lossCp: 52, dwr: -0.29, crit: 0.73473, bucket: 1600, type: 'flashcard',
};

describe('libellés de tranche (dialecte Lichess/FIDE)', () => {
  it('affiche Lichess ET l’équivalent FIDE quand il existe', () => {
    expect(bucketLabel(1600, { 1600: 1400 })).toBe('1600+ Lichess · ≈1400 FIDE');
    expect(bucketLabel(1000, { 1600: 1400 })).toBe('1000+ Lichess');
    expect(bucketLabel('all', {})).toBe('Toutes les tranches');
    expect(bucketShort(2200)).toBe('2200+');
    expect(bucketShort('all')).toBe('Toutes');
  });
});

describe('formats FR', () => {
  it('fmtLoss : virgule FR + accord pion/pions', () => {
    expect(fmtLoss(52)).toBe('perd 0,52 pion');
    expect(fmtLoss(120)).toBe('perd 1,20 pion');
    expect(fmtLoss(310)).toBe('perd 3,10 pions');
    expect(fmtLoss(null)).toBe('');
  });
  it('fmtPct / fmtCrit / fmtDwr', () => {
    expect(fmtPct(0.5682)).toBe('57 %');
    expect(fmtCrit(0.73473)).toBe('0,73');
    expect(fmtDwr(-0.29)).toBe('−29 pts de victoire');
    expect(fmtDwr(null)).toBe('');
  });
});

describe('filtre par tranche', () => {
  const errors = [{ ...ERR, bucket: 1600 }, { ...ERR, bucket: 2000 }];
  it('all = tout, sinon la tranche exacte', () => {
    expect(filterErrors(errors, 'all')).toHaveLength(2);
    expect(filterErrors(errors, 2000)).toHaveLength(1);
    expect(filterErrors(errors, 1800)).toHaveLength(0);
    expect(filterErrors(null, 'all')).toEqual([]);
  });
});

describe('filtre du panneau de paramètres (camp / coût plancher)', () => {
  const errors = [
    { ...ERR, bucket: 1600, stm: 'w', lossCp: 30 },
    { ...ERR, bucket: 1600, stm: 'b', lossCp: 120 },
    { ...ERR, bucket: 2000, stm: 'w', lossCp: 250 },
  ];
  it('camp fautif : all / w / b', () => {
    expect(filterErrors(errors, 'all', { side: 'all' })).toHaveLength(3);
    expect(filterErrors(errors, 'all', { side: 'w' })).toHaveLength(2);
    expect(filterErrors(errors, 'all', { side: 'b' })).toHaveLength(1);
  });
  it('coût plancher en centipions', () => {
    expect(filterErrors(errors, 'all', { minLossCp: 100 })).toHaveLength(2);
    expect(filterErrors(errors, 'all', { minLossCp: 0 })).toHaveLength(3);
  });
  it('les axes se composent (tranche × camp × coût)', () => {
    expect(filterErrors(errors, 1600, { side: 'b', minLossCp: 100 })).toHaveLength(1);
    expect(filterErrors(errors, 1600, { side: 'w', minLossCp: 100 })).toHaveLength(0);
  });
  it('opts absent = comportement historique', () => {
    expect(filterErrors(errors, 1600)).toHaveLength(2);
  });
});

describe('capTopCrit (les N plus critiques, ordre d\'affichage conservé)', () => {
  const idx = filterErrorsIndexed([
    { ...ERR, crit: .2 }, { ...ERR, crit: .9 }, { ...ERR, crit: .5 }, { ...ERR, crit: .7 },
  ], 'all');
  it('0 ou n >= longueur = inchangé (même référence)', () => {
    expect(capTopCrit(idx, 0)).toBe(idx);
    expect(capTopCrit(idx, 10)).toBe(idx);
  });
  it('sélectionne par rang de criticité mais restitue dans l\'ordre reçu', () => {
    const top2 = capTopCrit(idx, 2);
    expect(top2.map(x => x.e.crit)).toEqual([.9, .7]);       // ordre du doc, pas le rang
    expect(top2.map(x => x.i)).toEqual([1, 3]);              // les index d'origine suivent
  });
});

describe('sortErrors (tri de la table)', () => {
  const idx = filterErrorsIndexed([
    { ...ERR, freq: .3, lossCp: 90, crit: .5 },
    { ...ERR, freq: .7, lossCp: 20, crit: .9 },
    { ...ERR, freq: .5, lossCp: 20, crit: .7 },
  ], 'all');
  it('trie sur les 3 clés dans les 2 sens', () => {
    expect(sortErrors(idx, 'freq', -1).map(x => x.e.freq)).toEqual([.7, .5, .3]);
    expect(sortErrors(idx, 'lossCp', 1).map(x => x.e.lossCp)).toEqual([20, 20, 90]);
    expect(sortErrors(idx, 'crit', -1).map(x => x.e.crit)).toEqual([.9, .7, .5]);
  });
  it('stable : à valeur égale, l\'ordre du doc est conservé et l\'index d\'origine suit', () => {
    const byLoss = sortErrors(idx, 'lossCp', 1);
    expect(byLoss[0].i).toBe(1);   // les deux 20 cp gardent l'ordre du doc (i=1 avant i=2)
    expect(byLoss[1].i).toBe(2);
  });
});

describe('oaaFenIndex (jointure par position)', () => {
  const norm = f => f.split(/\s+/).slice(0, 4).join(' ');   // normFen injecté (test)
  it('groupe les erreurs par position normalisée (les compteurs ne comptent pas)', () => {
    const doc = { errors: [
      { ...ERR, fen: ERR.fen },
      { ...ERR, fen: ERR.fen.replace('0 1', '4 9'), bucket: 2000 },   // même position, compteurs ≠
      { ...ERR, fen: '8/8/8/8/8/8/8/K6k w - - 0 1' },
    ] };
    const map = oaaFenIndex(doc, norm);
    expect(map.size).toBe(2);
    expect(map.get(norm(ERR.fen))).toEqual([0, 1]);
    expect(map.get(norm('8/8/8/8/8/8/8/K6k w - - 0 1'))).toEqual([2]);
  });
  it('doc vide / fen manquant → index vide sans crash', () => {
    expect(oaaFenIndex(null, norm).size).toBe(0);
    expect(oaaFenIndex({ errors: [{ san: 'e4' }] }, norm).size).toBe(0);
  });
});

describe('errorToKp (« Créer un paquet »)', () => {
  it('produit un kp jouable : fen de l’erreur, meilleur coup, ligne implicite d’UN coup (impaire)', () => {
    const kp = errorToKp(ERR);
    expect(kp).not.toBeNull();
    expect(kp.fen).toBe(ERR.fen);
    expect(kp.san).toBe('d6');
    expect(kp.line).toBeUndefined();          // 1 coup → pas de séquence (longueur 1, impaire)
    expect(kp.fen.split(/\s+/)[1]).toBe(ERR.stm);   // le camp fautif est au trait
  });
  it('rejette une erreur incomplète', () => {
    expect(errorToKp(null)).toBeNull();
    expect(errorToKp({ ...ERR, bestSan: '' })).toBeNull();
    expect(errorToKp({ ...ERR, bestSan: null })).toBeNull();
    expect(errorToKp({ ...ERR, fen: 'pas-un-fen' })).toBeNull();
  });
  it('rejette un bestSan qui est de l’UCI (exercice insoluble) mais accepte les SAN valides', () => {
    expect(errorToKp({ ...ERR, bestSan: 'd7d6' })).toBeNull();     // UCI ≠ SAN
    expect(errorToKp({ ...ERR, bestSan: 'e1g1' })).toBeNull();
    for (const san of ['d6', 'Nf3', 'exd5', 'O-O', 'O-O-O+', 'e8=Q#', 'Qxh7#', 'Rad1'])
      expect(errorToKp({ ...ERR, bestSan: san })).not.toBeNull();
  });
  it('le commentaire pédagogique porte la ligne, la fréquence et le coût', () => {
    const c = errorComment(ERR);
    expect(c).toContain('1.e4 e5 2.d4 exd4');
    expect(c).toContain('57 % jouent Bxc3');
    expect(c).toContain('perd 0,52 pion');
    expect(c).toContain('1600+');
  });
});

// Formats COMPACTS : la forme longue de fmtLoss est une phrase, illisible dans une
// colonne de table (mesure : 6 lignes par cellule, rangee a 122px, criticite et
// bouton loupe rejetes hors ecran des 1366px). Le libelle long reste en legende.
describe('fmtLossShort / fmtDwrShort — cellules de table', () => {
  it('rend le cout en pions, sans phrase, avec la virgule FR', () => {
    expect(fmtLossShort(45)).toBe('−0,45');
    expect(fmtLossShort(210)).toBe('−2,10');
  });
  it('est toujours plus court que la forme longue', () => {
    expect(fmtLossShort(45).length).toBeLessThan(fmtLoss(45).length);
    expect(fmtDwrShort(0.29).length).toBeLessThan(fmtDwr(0.29).length);
  });
  it('rend le signe quel que soit celui de l entree (une faute coute toujours)', () => {
    expect(fmtLossShort(-45)).toBe('−0,45');
    expect(fmtDwrShort(-0.29)).toBe('−29 pts');
  });
  it('ne rend rien sans donnee (la cellule reste vide, pas « NaN »)', () => {
    expect(fmtLossShort(null)).toBe('');
    expect(fmtDwrShort(null)).toBe('');
  });
});

describe('sortErrors — tri par tranche Elo', () => {
  const idx = filterErrorsIndexed([
    { ...ERR, bucket: 2000, crit: .5 },
    { ...ERR, bucket: 1600, crit: .9 },
    { ...ERR, bucket: 2000, crit: .7 },
    { ...ERR, bucket: 1800, crit: .3 },
  ], 'all');
  it('regroupe les tranches, dans les 2 sens', () => {
    expect(sortErrors(idx, 'bucket', 1).map(x => x.e.bucket)).toEqual([1600, 1800, 2000, 2000]);
    expect(sortErrors(idx, 'bucket', -1).map(x => x.e.bucket)).toEqual([2000, 2000, 1800, 1600]);
  });
  it('stable : a l interieur d une tranche, l ordre du doc (criticite) est conserve', () => {
    const asc = sortErrors(idx, 'bucket', 1);
    const deux = asc.filter(x => x.e.bucket === 2000);
    expect(deux.map(x => x.i)).toEqual([0, 2]);   // i=0 (.5) avant i=2 (.7) : ordre du doc
  });
});
