---
target: page-student-home
total_score: 29
p0_count: 0
p1_count: 2
timestamp: 2026-07-13T09-41-59Z
slug: page-student-home
---
# Critique — page-student-home (focus: Exercices section)

Method: DEGRADED single-context (harness policy: no unasked sub-agents; full context held from building surface this session).

## Design Health Score: 29/40 (Good, upper band)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Progress bar + X/N résolus + Nouveau/échéance badges + streak. |
| 2 | Match System / Real World | 3 | French + chess vocab excellent; raw ISO date 2026-07-20 leaks. |
| 3 | User Control & Freedom | 3 | Navigational; back-from-drill exists. |
| 4 | Consistency & Standards | 2 | Exercise cards full-width block; module cards 2-up grid. Same component, two layouts. |
| 5 | Error Prevention | 3 | Low-risk surface. |
| 6 | Recognition > Recall | 4 | Everything visible; icon + text labels. |
| 7 | Flexibility & Efficiency | 2 | Cards are div onclick, not keyboard-focusable; play button no handler. |
| 8 | Aesthetic & Minimalist | 3 | Clean, but exercise cards ~120px dead space + lone play button. |
| 9 | Error Recovery | 3 | Empty states good. |
| 10 | Help & Documentation | 3 | Hero + empty states teach. |

## Anti-Patterns Verdict
Not AI slop. On-brand (Chessable x Linear): chess-native, French, indigo accent for actions only, discreet progress. Detector: 2 findings both false-positive in context (progress-bar width transition = intentional pill fill; em-dash = app voice). No new slop.

## What's Working
1. Contrast compliant (sub-label 5.06:1, badge 5.18:1).
2. State by icon+text, never color alone (daltonisme principle).
3. Honest Leitner-derived progress (X/N résolus, new->à revoir on solve).

## Priority Issues
- [P1] Cards not keyboard-operable. div.sh-mod onclick, no tabindex/role; play button no handler. Sam / WCAG-AA target cannot launch via keyboard. Systemic across all .sh-mod. Fix: real button handler or role=button+tabindex+Enter/Space+focus ring. -> harden/audit
- [P1] Sibling card types two layouts. #sh-module-list grid vs #sh-exercise-list block. Fix: same responsive grid (repeat(auto-fit,minmax(280px,1fr))). -> layout
- [P2] Exercise cards sparse (~120px dead space, lone play button). Fix: tighten / fill meta row / drop redundant play button. -> layout, polish
- [P2] Raw ISO deadline 2026-07-20 leaks to child user. Fix: toLocaleDateString fr-FR short. -> clarify

## Persona Red Flags
- Sam (a11y): cannot Tab to cards; no keyboard launch. Blocking. Contrast passes.
- Jordan (first-timer/child): understands vocab; stumbles on raw ISO date.
- Casey (mobile): full-width works on mobile (0 overflow 375px); keep grid fix mobile-friendly (auto-fit).

## Minor Observations
- Puzzle icon top-right repeats section identity; could carry theme/difficulty.
- "Tout résolu" state label nice; verify reachable.

## Questions
- Show tactic type at a glance (mat en 2-3, fourchette) so students pick by need?
- Does the standalone play button earn its place if the whole card is clickable?
