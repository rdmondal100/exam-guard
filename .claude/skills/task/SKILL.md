---
name: task
description: Start an ExamGuard implementation slice from the roadmap — scope it by requirement IDs, plan, build with tests, commit. Use when the user says /task, "next task", or "start phase N".
---

# ExamGuard task workflow

Argument: a phase number, requirement IDs, or a short task description (e.g. `/task 2 AUTH-01..05`).

1. **Scope (cheap lookups only)**
   - Phase: `grep -n -A 14 "## Phase <N>" docs/ROADMAP.md`
   - Each requirement: `grep -n "<ID>" docs/SRS.md`
   - Only if needed, read the single relevant ADR.
   - Check current state: `git log --oneline -5`, and list only the directories you will touch.
2. **Plan** — reply with: requirement IDs covered, files to create/change, tests to write, anything unclear. Keep it under ~15 lines. If the slice is bigger than ~1 session of work, propose splitting it and do only the first part. Wait for approval unless the owner said to proceed.
3. **Build** — smallest vertical slice that satisfies the IDs. Shared types/schemas in `packages/shared`; pure logic in `packages/policy` / `packages/grading-core`.
4. **Verify** — targeted tests (`pnpm --filter <pkg> test -- <pattern>`), typecheck. Report only failures.
5. **Commit** — `feat(<area>): <summary> (<IDs>)`. If a doc line is now wrong, fix that line in the same commit.
6. **Report** — 3–5 lines: what works, IDs done, what's next. Suggest `/clear` before the next slice.
