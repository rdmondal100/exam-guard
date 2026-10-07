# ExamGuard — Roadmap and Delivery Plan

| | |
|---|---|
| **Version** | 2.0 |
| **Start** | 2026-10-07 (W1) |
| **Planned finish** | ~W25 (end of March 2027), with ~2–4 weeks buffer before final submission |
| **Team** | Solo developer (Riday Mondal), with Claude as engineering pair |

## Delivery rules
1. **Every phase ends with a working, demonstrable build** — never a half-built layer. If time runs short, later phases shrink; earlier ones stay complete.
2. Each phase: implementation → tests → docs update → commit(s) on `riday` → tag `phase-N` → short demo note in `docs/phase-notes/`.
3. Conventional commits (`feat(server): ...`, `fix(agent): ...`, `docs: ...`).
4. Owner review at the end of each phase before starting the next; design decisions raised as they arise (ADR added when significant).
5. CI must be green before a phase is tagged.

## Cross-cutting requirements (verified in every phase)
SECN-01 (TLS), SECN-02 (shared validation), SECN-04 (no secret exam data to clients), SECN-07 (secrets handling), UX-01…03 (design system, plain-language messages, authoring speed), QA-05 (docs + tagged commit per phase).

## Phase overview

| # | Phase | Weeks | Cumulative |
|---|---|---|---|
| 0 | Requirements & design | 1 | W1 |
| 1 | Foundation & scaffold | 1 | W2 |
| 2 | Identity, admin, desktop shell, discovery | 2 | W4 |
| 3 | Exam authoring | 2.5 | W6.5 |
| 4 | Student exam flow & live controls | 2.5 | W9 |
| 5 | Rust agent v1 & policy engine | 3 | W12 |
| 6 | External IDE mode & network lock | 2 | W14 |
| 7 | Live screen view & evidence | 1.5 | W15.5 |
| 8 | Sandbox & deterministic grading | 2.5 | W18 |
| 9 | AI gateway & AI-assisted grading | 2 | W20 |
| 10 | Similarity, review queue, results | 1.5 | W21.5 |
| 11 | Analytics, reports, audit viewer | 1 | W22.5 |
| 12 | Hardening, packaging, demo | 2.5 | W25 |

---

## Phase 0 — Requirements & design (W1) ✅ in progress
**Deliverables:** DISCOVERY_NOTES, PRD v2, SRS v2, ARCHITECTURE v2, ADR-001…013, THREAT_MODEL v2, RISK_REGISTER v2, this ROADMAP.
**Exit:** owner signs off PRD §11.

## Phase 1 — Foundation & scaffold (W2)
- pnpm monorepo, TS project refs, ESLint/Prettier, Vitest; Cargo workspace skeleton.
- `apps/server`: Fastify bootstrap, Zod env config, pino logging, problem+json errors, health endpoint.
- Prisma schema v1 (users, courses, sections, devices, audit) + migrations + seed.
- `infra/docker-compose.yml` (postgres, redis, api, worker).
- `apps/desktop`: Electron + Vite + React skeleton with hardened window config and typed preload.
- `packages/shared`, `packages/ui` (tokens, base components).
- GitHub Actions CI (TS on ubuntu, Rust on windows).
**SRS:** QA-01, QA-03, QA-04, DEP-01 (partial), SECN-03.
**Demo:** `docker compose up` → health OK; desktop app opens and shows server health.

## Phase 2 — Identity, admin, desktop shell, discovery (W3–W4)
- Auth (Argon2id, access/refresh rotation, lockout, forced password change), RBAC + ownership guards, route×role test matrix.
- Admin: teachers, courses/sections, **CSV import with dry-run**, password reset, global settings skeleton.
- Hash-chained audit log + verifier.
- Desktop: login, role-based shells (Admin/Teacher/Student), token vault, design system.
- Server host launcher: TLS CA/cert generation, mDNS advertisement, firewall rule; client discovery + fingerprint pinning; device registration.
**SRS:** AUTH-01…08, ADM-01…04, DEV-01…04, AUD-01…03.
**Demo:** admin imports 60 students from CSV; student logs in from a second PC that found the server automatically.

## Phase 3 — Exam authoring (W5–W6.5)
- Exam CRUD + state machine; settings (device policy, network lock, IDEs, visibility, thresholds).
- Question editor: MCQ, numerical, theory, programming; parts & marks; marking points; image attachments.
- Programming: reference solution, test cases (visible/hidden/randomized generator), comparison modes.
- Assignment modes: same paper (shuffle), pools, manual sets; seeded paper generation.
- Paper validation stub (full sandbox validation lands in Phase 8; until then syntax/structure validation).
**SRS:** EXM-01…14.
**Demo:** teacher builds a DSP + C programming exam with pools and publishes it.

## Phase 4 — Student exam flow & live controls (W7–W9)
- Session state machine, server-authoritative timer, consent, pre-check (server side; agent checks stubbed), join/ready/start.
- Answering UI for MCQ/numerical/theory; autosave; offline queue + resync; submit + receipt; auto-submit.
- Teacher live dashboard (status, progress, connection), start/end exam, **extend time, lock/resume/terminate**.
- WebSocket gateway (`/ws/client`, `/ws/teacher`), presence in Redis.
**SRS:** DLV-01…05, DLV-08…11, LIV-01, LIV-02, LIV-04, LIV-05, REL-01, REL-02.
**Demo:** full non-coding exam with 10 students; pull a network cable and recover; teacher extends time and locks a student.

## Phase 5 — Rust agent v1 & policy engine (W10–W12)
- `agent/core` protocol; **Service** (process monitor + kill, file/USB watch, VM/RDP detection, Helper supervision, server WSS with ticket → token, sequence, heartbeat); **Helper** (foreground window, clipboard, displays, screenshots); Desktop ↔ Helper pipe.
- `packages/policy` engine + STANDARD/STRICT/LENIENT profiles; server monitoring module (ingest, verify seq, evaluate, actions, evidence); agent fast-path BLOCK.
- Real pre-check results from agent; security timeline and alert feed in teacher UI.
- Installer v0 for service.
**SRS:** SEC-01…09, SEC-11, SEC-12, SEC-14…16, DEV-05, PRIV-01, DLV-03, DLV-14, LIV-03, LIV-08, §6 catalogue (non-IDE events).
**Demo:** student launches Chrome → killed in < 1 s → alert with screenshot on teacher dashboard; kill Helper → restarted + flagged.

## Phase 6 — External IDE mode & network lock (W13–W14)
- Workspace folders, "Open in IDE" via Helper; VS Code exam profile provisioning (allowlisted extensions), Code::Blocks, Dev-C++.
- Workspace snapshots + upload + code-insertion burst detection; final submission from snapshot.
- AI extension scan + local AI server detection; `IDE_LAUNCHED_OUTSIDE_PROFILE`.
- Network lock (firewall group, verification watchdog, stale-rule cleanup).
- Local "Run visible tests" with installed toolchain.
**SRS:** DLV-06, DLV-07, DLV-12, DLV-13, SEC-10, SEC-13, REL-03.
**Demo:** student codes in VS Code; Copilot absent; Google unreachable, server reachable; pasting 50 lines raises a flag.

## Phase 7 — Live screen view & evidence (W15–W15.5)
- Helper capture (Windows.Graphics.Capture + DXGI fallback), JPEG pipeline, adaptive fps/quality.
- Server live module: authorization, ≤ 4 streams/teacher, relay with backpressure, audit of viewing.
- Teacher live panel (from dashboard and from alerts); student "being viewed" indicator.
**SRS:** LIV-06, LIV-07, PERF-04, PRIV-02.
**Demo:** alert → *Watch live* → 10 fps view of the student's screen within 3 s.

## Phase 8 — Sandbox & deterministic grading (W16–W18)
- `sandbox/images` (c, cpp, python, java, node); `sandbox/runner` with limits and verdicts; abuse test suite.
- Paper validation with real runs; expected-output generation from reference; randomized test materialization.
- Grading pipeline (BullMQ): MCQ, numerical, programming test scores per part; hard-code heuristics; evaluation records & test runs.
**SRS:** SBX-01…04, EXM-12, EXM-13, EVL-01…04, EVL-06 (heuristics), EVL-14, PERF-06.
**Demo:** 30 submissions graded with per-part partial credit; seeded hard-coded solution flagged.

## Phase 9 — AI gateway & AI-assisted grading (W19–W20)
- AI gateway (Ollama, Gemini, OpenAI, Mock), redaction, call logging, kill switch, versioned prompt templates.
- Theory marking-point evaluation with quotes/confidence; code partial-credit & special-casing review; injection detector + red-team corpus.
- Confidence routing; benchmark local models on the target hardware; pick defaults.
**SRS:** AI-01…07, EVL-05, EVL-07…09, PRIV-04.
**Demo:** theory answers graded with per-point evidence; injection attempt routed to review; same exam graded with Mock/Ollama/Gemini toggle.

## Phase 10 — Similarity, review queue, results (W21–W21.5)
- `grading-core` tokenizers (5 languages), normalization, winnowing; text shingles; boilerplate exclusion; similarity job.
- Teacher review queue with all evidence; override with reason; grade history.
- Result publication with visibility modes; student results view.
**SRS:** EVL-10…13.
**Demo:** renamed-variable copy detected and shown side by side; teacher overrides and publishes; student sees marks + feedback.

## Phase 11 — Analytics, reports, audit viewer (W22)
- Results analytics, security summary, CSV + PDF reports, audit viewer/export, admin system health.
**SRS:** RPT-01…03, AUD-04, ADM-05, ADM-06.

## Phase 12 — Hardening, packaging, demo (W23–W25)
- Security test plan execution (THREAT_MODEL §7) with report; fix findings.
- Load test 60 simulated students (k6 + simulated agents); performance tuning.
- Installers (Desktop, Agent), offline image bundles, admin/teacher/student user guides, deployment guide, backup/restore.
- Retention jobs (PRIV-03); final docs; demo script and rehearsal; recorded backup demo video.
**SRS:** PERF-01…05, REL-04, REL-05, SECN-05, SECN-06, DEP-02, DEP-03, PRIV-03, QA-02.

---

## Cut-line if time runs short (in order)
1. WFP network filter (already stretch) · 2. Exam cloning (EXM-15) · 3. PDF report (keep CSV) · 4. Theory text similarity (keep code similarity) · 5. Gemini/OpenAI providers (keep Ollama + Mock).
Core security, IDE mode, live view, sandbox grading, AI marking and code similarity are **never cut**.
