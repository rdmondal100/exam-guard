# ADR-009: Reference-driven hybrid grading with confidence routing

**Status:** Accepted · **Date:** 2026-10-07

## Context
Teachers provide a reference solution per multi-part question; students should get credit when their answer **serves the same purpose**, not when it matches text, with partial marks per part. Grading must resist hard-coding and prompt injection, and AI must not be an unquestionable authority.

## Options
1. AI compares student code to the reference directly — not reproducible, easily fooled, hard to defend.
2. Classic test-case judge only — exact, but zero credit for nearly-right work; teacher must hand-write expected outputs.
3. **Hybrid:** execute the reference to derive expected outputs (visible, hidden, randomized tests per part) → deterministic per-part test score; AI evaluates marking points, partial work and special-casing; confidence-based routing to teacher review.

## Decision
Option 3, with rules in SRS EVL-04…EVL-09:
- `suggested = max(testScore, min(aiScore, aiCap))` for programming parts.
- Theory/method marks: AI per marking point with verbatim quotes and confidence; JSON-schema-validated; scores clamped.
- Auto-accept only when evidence agrees and nothing is suspicious; everything else goes to the teacher with all evidence.
- Every grade stores provenance (tests, AI template version + model, teacher override with reason).

## Consequences
+ Behaviour-based correctness ("purpose served") is measurable and reproducible.
+ Partial credit is principled; teacher time focused on genuinely uncertain cases.
− Teachers must write runnable reference solutions and, for randomized tests, a small generator (templates provided).
− AI quality depends on the local model; mitigated by routing and review.
