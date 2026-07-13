---
target: page-student-home
total_score: 34
p0_count: 0
p1_count: 0
timestamp: 2026-07-13T10-08-49Z
slug: page-student-home
---
# Critique — page-student-home (re-run after fixes)

Method: DEGRADED single-context (harness policy: no unasked sub-agents).

## Design Health Score: 34/40 (Good, upper band) — up from 29

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Progress + X/N résolus + badges + streak. |
| 2 | Match System / Real World | 4 | ISO date leak fixed -> 20 juil.; chess/French fluent. |
| 3 | User Control & Freedom | 3 | Navigational. |
| 4 | Consistency & Standards | 4 | Exercise cards now share module grid (2-up 317px). |
| 5 | Error Prevention | 3 | Low-risk. |
| 6 | Recognition > Recall | 4 | Everything visible; icon+text. |
| 7 | Flexibility & Efficiency | 3 | Keyboard launch path exists (play button). |
| 8 | Aesthetic & Minimalist | 4 | Grid killed dead space; flawless-completion check refines w/o noise. |
| 9 | Error Recovery | 3 | Empty states teach. |
| 10 | Help & Documentation | 3 | Hero + empty states. |

## Anti-Patterns Verdict
Not slop; now clearly intentional. Delight moment sober (drawn indigo check, no confetti, gated to flawless). Detector: same 2 findings, both confirmed false positives (progress-bar width transition = intentional pill fill; 23 em-dashes = app French cadence). New motion (stroke-dashoffset, transform) layout-safe, no flags.

## What's Working (verified)
1. Consistency restored: exercise cards 317px, match modules. H4 closed.
2. Keyboard path: play button onclick + aria-label, focusable, launches drill. a11y blocker resolved.
3. Contrast holds: badge 5.18:1; localized 20 juil.

## Priority Issues (no P0/P1 remain)
- [P3] Card body under-fills; surface tactic type/count ("2 exercices · fourchette") so student picks by need. -> layout light.
- [P3] Card mouse-clickable via div onclick; only play button is AT control. No info lost; role=button reintroduces nested-button trade-off. Defensible as-is.

## Persona Red Flags
- Sam (a11y): primary flow now passes (Tab->play->Enter launches, AA contrast, icon+text states). Prior blocker gone.
- Jordan (child): "20 juil." natural; "Sans faute !" warm not childish.
- Casey (mobile): grid collapses to 1 col at 375px, 0 overflow.

## Questions
- Show tactic type on card so students pick by weak spot, or does packet name suffice?
