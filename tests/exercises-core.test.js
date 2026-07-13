import { describe, it, expect } from 'vitest';
import { _exCloneKp } from '../lib/exercises-core.js';

describe('exercises-core : _exCloneKp (clonage canonique de kp)', () => {
  const multiKp = {
    fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1',
    san: 'Qxf7#', altSans: ['Bxf7#'], comment: 'Mat du berger',
    isCapture: true, isCastle: false, isCheck: true,
    line: ['Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#'],
  };
  const singleKp = {
    fen: '6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1',
    san: 'Rd8+', altSans: [], comment: '',
    isCapture: false, isCastle: false, isCheck: true,
  };

  it('préserve la séquence multi-coups `line`', () => {
    const c = _exCloneKp(multiKp);
    expect(c.line).toEqual(multiKp.line);
    expect(c.san).toBe('Qxf7#');
    expect(c.altSans).toEqual(['Bxf7#']);
    expect(c.comment).toBe('Mat du berger');
  });

  it('exercice 1 coup : pas de champ `line` parasite', () => {
    const c = _exCloneKp(singleKp);
    expect('line' in c).toBe(false);
  });

  it('copie profonde de `line` et `altSans` (pas de partage de référence)', () => {
    const c = _exCloneKp(multiKp);
    c.line.push('X');
    c.altSans.push('Y');
    expect(multiKp.line).toEqual(['Qh5', 'Nc6', 'Bc4', 'Nf6', 'Qxf7#']); // original intact
    expect(multiKp.altSans).toEqual(['Bxf7#']);
  });

  it('round-trip édition : open-clone → save-clone préserve `line` (bug historique)', () => {
    // Reproduit le flux : module persisté → openExercisePacket (clone) →
    // saveExercisePacket (re-clone). La `line` doit survivre aux deux passages.
    const opened = _exCloneKp(multiKp);   // openExercisePacket : kps.map(_exCloneKp)
    const saved  = _exCloneKp(opened);    // saveExercisePacket : _EX.exercises.map(_exCloneKp)
    expect(saved.line).toEqual(multiKp.line);
    expect(saved.line.length).toBe(5);    // mat en 3 (5 demi-coups), pas écrasé en 1 coup
  });

  it('normalise les champs manquants sans casser', () => {
    const c = _exCloneKp({ fen: 'x', san: 'e4' });
    expect(c.altSans).toEqual([]);
    expect(c.comment).toBe('');
    expect(c.isCapture).toBe(false);
    expect('line' in c).toBe(false);
  });

  it('ignore une `line` vide (ne l\'ajoute pas)', () => {
    expect('line' in _exCloneKp({ fen: 'x', san: 'e4', line: [] })).toBe(false);
  });
});
