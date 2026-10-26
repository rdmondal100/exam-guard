# Phase 2 review (archived)

History only: both reported bugs were fixed and Phase 2 was accepted on 2026-10-21. Not needed in a session.

## Phase 2 review (2026-10-20)
Checked against requirements.md §10 and the M06–M12 Accept lines. Nothing was fixed in this session and the suite was not re-run (285 tests were green at M12).

**"Done when": a student on another PC joins an exam and waits in the lobby — NOT yet demonstrated (when written; since met, see the update above).** The whole path is built (discover or manual IP → cert pin → PIN + ID → name → notice → WS lobby → teacher roster), but it has never been run on a second machine. Every milestone from M02 on is still "manual check pending".

| M | Accept line | Verdict |
|---|---|---|
| M06 | BOM, quotes, duplicate and blank IDs reported; list in use can't be deleted | Met by tests; page unverified by hand |
| M07 | Duplicate copies settings and questions; bad transitions rejected | Met by tests (`assertTransition` is used by hosting) |
| M08 | Marks = sum of criteria; Ready fails with reasons; reorder persists | Met by tests; Monaco never run in the app |
| M09 | `/info` works while hosting and is refused after; sleep blocked | Met by tests; `powercfg /requests` check pending |
| M10 | LAN discovery, manual IP, mismatched cert refused | Met by tests and a bonjour smoke run; the mismatch can't be triggered by hand (nothing regenerates the cert) |
| M11 | Wrong PIN or unlisted ID rejected; other device rejected + event; same device resumes | Met by tests; two-profile run pending |
| M12 | Roster within 1 s; disconnect shown; 200-sim stable | Met by the scripted 200-student run; Electron screens and laptop run pending |

**Reported bugs (confirmed in code, to fix before the Phase 2 manual run)**
1. Student retry timer is static. `JoinForm.tsx` bakes `(try again in N s)` into the error text once. The teacher `LoginScreen.tsx` already has a ticking `waitSec` and a disabled button; the student form has neither. Fix: tick `waitSec` down, show "Try again in N s", disable Join until 0, clear the message at 0.
2. Hosted exam is not obvious in the Exams list and can't be stopped there. `ExamsPage.tsx` shows the state as plain text, with no badge. Stop hosting exists only in the detail page. The row button "Questions" opens the exam detail page (Ready, Host, Stop, live roster), so the label is wrong. Fix: a "Hosting" badge on the row, a **Stop hosting** button on that row (with confirm, reuse `examApi.stopHosting`), and rename "Questions" to "Open".

**Other gaps found** (also listed under Known issues): no way to regenerate the cert from Settings; no teacher "reset session"; students are not told when hosting stops; a failed `resume()` leaves the panel on "Loading hosting details…".
