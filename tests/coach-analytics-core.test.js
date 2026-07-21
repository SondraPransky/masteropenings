// Tests du socle pur de la section coach « Analyse d'ouvertures » (OA/D18).
import { describe, it, expect } from 'vitest';
import {
  bucketShort, bucketLabel, fmtLoss, fmtPct, fmtCrit, fmtDwr,
  filterErrors, errorToKp, errorComment,
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
    expect(errorToKp({ ...ERR, fen: 'pas-un-fen' })).toBeNull();
  });
  it('le commentaire pédagogique porte la ligne, la fréquence et le coût', () => {
    const c = errorComment(ERR);
    expect(c).toContain('1.e4 e5 2.d4 exd4');
    expect(c).toContain('57 % jouent Bxc3');
    expect(c).toContain('perd 0,52 pion');
    expect(c).toContain('1600+');
  });
});
