import { describe, it, expect } from 'vitest';
import { planMembers, plansForStudent, planNextStep } from '../lib/plans-core.js';

const anchor = (id, plans) => ({ id, name: 'Ouverture ' + id, varmode: 'tree', plans });
const packet = id => ({ id, name: 'Paquet ' + id, isExercise: true });

describe('planMembers', () => {
  it('concatène puzzles puis erreurs, en String, dédupliqués', () => {
    expect(planMembers({ puzzles: [1, '2'], errors: [3, 1] })).toEqual(['1', '2', '3']);
  });
  it('plan à 2 pattes (sans erreurs) et plan vide', () => {
    expect(planMembers({ puzzles: [7] })).toEqual(['7']);
    expect(planMembers({})).toEqual([]);
    expect(planMembers(null)).toEqual([]);
  });
});

describe('plansForStudent', () => {
  it('affiche un plan dont tous les membres sont assignés, et masque ancre + membres', () => {
    const plan = { id: 'p1', name: 'Plan', puzzles: [10], errors: [11] };
    const { entries, hidden } = plansForStudent([anchor(1, [plan]), packet(10), packet(11)]);
    expect(entries).toHaveLength(1);
    expect(entries[0].anchor.id).toBe(1);
    expect([...hidden].sort()).toEqual(['1', '10', '11']);
  });
  it('un membre manquant → plan non applicable, rien de masqué', () => {
    const plan = { id: 'p1', name: 'Plan', puzzles: [10], errors: [99] };
    const { entries, hidden } = plansForStudent([anchor(1, [plan]), packet(10)]);
    expect(entries).toHaveLength(0);
    expect(hidden.size).toBe(0);
  });
  it('un plan sans aucun membre ne s\'affiche pas (l\'ancre reste une carte normale)', () => {
    const { entries, hidden } = plansForStudent([anchor(1, [{ id: 'p1', name: 'Vide' }])]);
    expect(entries).toHaveLength(0);
    expect(hidden.size).toBe(0);
  });
  it('deux variantes applicables du même module → deux cartes', () => {
    const p1 = { id: 'a', name: '1400', puzzles: [10] };
    const p2 = { id: 'b', name: '1800', puzzles: [11] };
    const { entries } = plansForStudent([anchor(1, [p1, p2]), packet(10), packet(11)]);
    expect(entries.map(e => e.plan.id)).toEqual(['a', 'b']);
  });
  it('un paquet d\'exercices ne porte jamais de plan (ancre = ouverture)', () => {
    const ex = { ...packet(5), plans: [{ id: 'p', puzzles: [10] }] };
    const { entries } = plansForStudent([ex, packet(10)]);
    expect(entries).toHaveLength(0);
  });
});

describe('planNextStep', () => {
  it('première rangée non terminée', () => {
    expect(planNextStep([{ done: true }, { done: false }, { done: false }])).toBe(1);
  });
  it('rien de fait → la première ; tout fait → la dernière ; vide → -1', () => {
    expect(planNextStep([{ done: false }, { done: false }])).toBe(0);
    expect(planNextStep([{ done: true }, { done: true }])).toBe(1);
    expect(planNextStep([])).toBe(-1);
  });
});
