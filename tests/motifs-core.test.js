import { describe, it, expect } from 'vitest';
import { explainFault, whyBest, whyPlayed } from '../lib/motifs-core.js';

const after = (...sans) => { const g = new Chess(); sans.forEach(s => g.move(s)); return g.fen(); };

describe('motifs — pourquoi un coup est une faute', () => {
  it('voit le mat en un offert (le coup du berger)', () => {
    const fen = after('e4', 'e5', 'Bc4', 'Nc6', 'Qh5');
    expect(whyPlayed(fen, 'Nf6')).toBe('il permettait ♕xf7#, mat');
    expect(whyPlayed(fen, 'g6')).toBe(null);
  });
  it('voit la pièce laissée en prise', () => {
    expect(whyPlayed('4k3/8/4n3/8/8/8/8/2B1K3 w - - 0 1', 'Bf4')).toBe('le fou en f4 restait en prise');
  });
  it('une pièce défendue prise par une pièce égale n\'est pas en prise', () => {
    expect(whyPlayed('4k3/8/4n3/8/8/6P1/8/2B1K3 w - - 0 1', 'Bf4')).toBe(null);
  });
  it('explique la fourchette ratée', () => {
    expect(whyBest('q3k3/8/8/1N6/8/8/8/4K3 w - - 0 1', 'Nc7+'))
      .toBe('♘c7+ faisait une fourchette sur le roi et la dame');
  });
  it('explique le gain de matériel raté et le mat raté', () => {
    expect(whyBest('4k3/8/8/3n4/8/8/8/3RK3 w - - 0 1', 'Rxd5')).toBe('♖xd5 gagnait le cavalier');
    expect(whyBest(after('e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'), 'Qxf7#')).toBe('♕xf7# donnait mat');
  });
  it('ne dit rien plutôt que d\'inventer', () => {
    expect(explainFault(new Chess().fen(), 'e4', 'd4')).toEqual([]);
    expect(explainFault('fen invalide', 'e4', 'd4')).toEqual([]);
  });
});
