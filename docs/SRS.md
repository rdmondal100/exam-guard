# ExamGuard — Software Requirements Specification

| | |
|---|---|
| **Version** | 2.0 |
| **Date** | 2026-10-07 |
| **Status** | Baseline (Phase 0) |
| **Related** | [PRD](PRD.md) · [Architecture](ARCHITECTURE.md) · [Threat Model](THREAT_MODEL.md) · [Discovery Notes](DISCOVERY_NOTES.md) |

Structure loosely follows IEEE 29148 / 830. Requirement IDs are stable and are referenced from code, tests and the traceability matrix (§9).
Keywords: **shall** = mandatory, **should** = recommended, **may** = optional.

---

## 1. Introduction

### 1.1 Purpose
Specifies the functional and non-functional requirements of ExamGuard, a Windows desktop platform for secure, invigilated lab examinations with hybrid (deterministic + AI + teacher) grading.

### 1.2 Scope
In scope: desktop application (Admin/Teacher/Student modes), backend API and workers, Rust security agent, code-execution sandbox, AI gateway, PostgreSQL data store, LAN deployment.
Out of scope: see PRD §3 non-goals.

### 1.3 Definitions
| Term | Meaning |
|---|---|
| **Exam** | A timed assessment for one course section, containing questions. |
| **Question / Part** | A question has 1..n parts (a, b, c…); marks are defined per part. |
| **Paper** | The concrete set of questions assigned to one student. |
| **Session** | One student's attempt at one exam on one device. |
| **Agent** | Native Rust component on the student machine: **Service** (Session 0, SYSTEM) + **Helper** (user session). |
| **Managed device** | Lab PC with agent installed as service by IT and no student admin rights. |
| **Unmanaged device** | Student-owned laptop. |
| **Security event** | A typed observation reported by agent or app (e.g. `PROCESS_STARTED`). |
| **Decision** | Policy engine output: `ALLOW`, `WARN`, `FLAG`, `BLOCK`, `REVIEW`. |
| **Reference solution** | Teacher's correct solution/model answer, used to derive expected outputs and marking points. |
| **Marking point** | An atomic criterion inside a part's model answer, worth some marks. |
| **Network lock** | Per-exam mode in which the client can reach only the exam server. |
| **Exam profile (VS Code)** | VS Code launched with ExamGuard-controlled `--user-data-dir` and `--extensions-dir`. |

## 2. Overall description

### 2.1 Product perspective
Four deployable parts communicating over the LAN:
1. **ExamGuard Desktop** (Electron + React + TypeScript) — one app, mode chosen after login.
2. **ExamGuard Server** (Node.js + Fastify + TypeScript) — REST + WebSocket API, policy engine, schedulers.
3. **Workers** — grading queue (BullMQ), code sandbox runner (Docker), AI gateway calls, similarity analysis.
4. **ExamGuard Agent** (Rust) — Windows Service + user-session Helper on student machines.

### 2.2 User classes
Admin, Teacher, Student (PRD §4). A user has exactly one role.

### 2.3 Operating environment
- Clients: Windows 10 22H2+ / Windows 11, x64, 4 GB RAM minimum.
- Server host: Windows 10/11 with Docker Desktop (WSL2) or Linux with Docker Engine; 8 GB RAM minimum (16 GB with local AI); optional NVIDIA GPU for Ollama.
- Network: same LAN / Wi-Fi; no internet required.

### 2.4 Design and implementation constraints
- C-1 Desktop: Electron + TypeScript + React. Server: Node.js 20 LTS + TypeScript. DB: PostgreSQL 16 via Prisma. Queue/cache: Redis 7 + BullMQ. Agent: Rust (stable, `windows` crate).
- C-2 All authorization decisions shall be made by the server.
- C-3 Student code shall be executed for grading only inside the server sandbox.
- C-4 External AI providers shall be disabled unless enabled by Admin globally and by Teacher per exam.
- C-5 The system shall not claim capabilities Windows cannot provide (see THREAT_MODEL §6).

### 2.5 Assumptions and dependencies
See PRD §9.

---

## 3. System states

### 3.1 Exam lifecycle
```
DRAFT ──publish──▶ PUBLISHED ──start──▶ LIVE ──end/timeout──▶ ENDED
  ▲                   │                                         │
  └──unpublish────────┘                                  (auto) ▼
                                         GRADING ──all parts evaluated──▶ IN_REVIEW
                                                                             │ publish results
                                                                             ▼
                                                    RESULTS_PUBLISHED ──archive──▶ ARCHIVED
```
- Questions are editable only in `DRAFT`. `PUBLISHED` exams can be unpublished only if no session has started.
- `start` is manual by the teacher (optionally allowed only within the scheduled window).

### 3.2 Session lifecycle
```
ASSIGNED ─▶ PRECHECK ─(pass)─▶ READY ─exam LIVE─▶ IN_PROGRESS ─submit──────▶ SUBMITTED
               │ (fail)                              │  ▲   │ time over ──▶ AUTO_SUBMITTED
               ▼                                     │  │   │ teacher ────▶ TERMINATED
           BLOCKED_PRECHECK                    lock  ▼  │ resume
         (retry after fixing)                       LOCKED
                               connection lost ─▶ DISCONNECTED ─reconnect─▶ IN_PROGRESS
```
- `DISCONNECTED` does not stop the server timer. If the deadline passes while disconnected, the session becomes `AUTO_SUBMITTED` using the last autosave.

### 3.3 Part-evaluation lifecycle
`PENDING → RUNNING → AUTO_ACCEPTED | NEEDS_REVIEW → FINAL` (teacher accepts/overrides). Errors move to `NEEDS_REVIEW` with reason.

---

## 4. Functional requirements

Each requirement has an acceptance criterion (**AC**).

### 4.1 Authentication and accounts (AUTH)
| ID | Requirement | AC |
|---|---|---|
| AUTH-01 | The system shall authenticate users by username (student ID / staff email) and password. | Valid credentials return tokens; invalid return 401 with a generic message. |
| AUTH-02 | Passwords shall be hashed with Argon2id (m ≥ 64 MiB, t ≥ 3, p = 1). | DB contains no plaintext; hash parameters verified by unit test. |
| AUTH-03 | Access tokens shall expire in ≤ 15 min; refresh tokens shall be rotated on use, stored hashed server-side, and revocable. | Reused refresh token is rejected and revokes the token family. |
| AUTH-04 | The desktop shall keep the access token in main-process memory only and persist the refresh token encrypted via Electron `safeStorage`. | Renderer cannot read tokens; no tokens in localStorage/IndexedDB. |
| AUTH-05 | After 5 failed logins in 10 min an account shall be temporarily locked for 5 min; events audited. | Integration test. |
| AUTH-06 | Users created by Admin/CSV shall be forced to change password at first login. | Login returns `mustChangePassword`; other endpoints return 403 until changed. |
| AUTH-07 | Every API route shall declare required roles; the server shall reject requests whose token role/ownership does not match. | Automated RBAC test matrix: every route × every role. |
| AUTH-08 | A student shall have at most one `IN_PROGRESS` session per exam; a second login during an exam shall be refused and flagged. | Integration test. |

### 4.2 Administration (ADM)
| ID | Requirement | AC |
|---|---|---|
| ADM-01 | Admin shall create, edit, deactivate Teacher accounts. | CRUD tests; deactivated user cannot log in. |
| ADM-02 | Admin shall create courses and sections and assign teachers. | — |
| ADM-03 | Admin shall import students from CSV (`student_id,name,email,section`) with dry-run validation report (duplicates, bad rows) before commit. | 1,000-row file imports in < 10 s; errors listed by row. |
| ADM-04 | Admin shall reset a user's password (temporary password, forced change). | — |
| ADM-05 | Admin shall configure global AI policy: allowed providers, external AI kill switch, default model. | Kill switch blocks external calls even if an exam enables them. |
| ADM-06 | Admin shall view system health: DB, Redis, sandbox images, AI provider reachability, connected agents. | Health page reflects a stopped service within 10 s. |

### 4.3 Server discovery and device registration (DEV)
| ID | Requirement | AC |
|---|---|---|
| DEV-01 | The server shall advertise itself via mDNS (`_examguard._tcp`). Clients shall list discovered servers. | Client on same subnet finds server ≤ 5 s. |
| DEV-02 | Clients shall accept a manual address or short connection code as fallback. | — |
| DEV-03 | The client shall pin the server's TLS certificate fingerprint on first connection (TOFU) and warn on change; Admin may pre-provision the fingerprint. | Changed cert → client refuses until confirmed by admin action. |
| DEV-04 | Each client installation shall register a device record (machine ID, hostname, OS version, agent version, trust level `MANAGED`/`UNMANAGED`). | Device appears in admin list. |
| DEV-05 | Trust level `MANAGED` shall only be granted to devices whose agent runs as a service and that are enrolled by Admin. | Laptop with student-installed agent shows `UNMANAGED`. |

### 4.4 Exam authoring (EXM)
| ID | Requirement | AC |
|---|---|---|
| EXM-01 | Teacher shall create/edit/delete exams in `DRAFT` for courses they teach. | Teacher of another course gets 403. |
| EXM-02 | Exam settings shall include: title, instructions, scheduled window, duration, device policy (`LAB_ONLY`, `LAPTOP_STRICT`, `LAPTOP_FLAG_ONLY`), network lock (on/off), allowed IDEs, security policy profile, results visibility (`HIDDEN`, `MARKS_ONLY`, `MARKS_AND_FEEDBACK`), auto-accept confidence threshold, external AI allowed (y/n). | Settings persisted and enforced (see SEC, EVL). |
| EXM-03 | Supported question types: `MCQ`, `NUMERICAL`, `THEORY`, `PROGRAMMING`. | — |
| EXM-04 | Every question shall have 1..n parts; each part has label, prompt, marks (> 0). Question marks = sum of part marks. | Validation rejects 0 parts or non-positive marks. |
| EXM-05 | Questions may include image attachments (PNG/JPG/SVG ≤ 5 MB each). | Images displayed to students; stored with content hash. |
| EXM-06 | MCQ parts: ≥ 2 options, single or multiple correct; optional per-student option shuffle. | — |
| EXM-07 | Numerical parts: expected value, absolute or relative tolerance, optional unit; optional marking points for method. | — |
| EXM-08 | Theory parts: model answer and ≥ 1 marking point (description + marks); sum of marking-point marks = part marks. | Validation enforces sum. |
| EXM-09 | Programming questions: allowed language(s) (C, C++, Python, Java, JavaScript), reference solution, I/O mode (stdin/stdout; optional function harness), time limit, memory limit, allowed IDEs (derived default: Python/Java/JS → VS Code; C/C++ → VS Code, Code::Blocks, Dev-C++). | — |
| EXM-10 | Programming parts shall have test cases of three kinds: **visible** (shown to student), **hidden**, **randomized** (generator script + count). Test cases carry weights. Expected outputs are produced by running the reference solution. | Teacher never types expected output; editing reference solution regenerates outputs. |
| EXM-11 | Programming parts may have AI marking points (e.g. "uses recursion", "handles empty input") and a configurable cap on AI partial credit (default 50 % of part marks). | — |
| EXM-12 | Output comparison modes: exact, whitespace-insensitive (default), case-insensitive, numeric tolerance per token, custom checker script. | Unit tests per mode. |
| EXM-13 | **Paper validation**: before publishing, every reference solution shall compile and run within limits in the sandbox and every randomized generator shall run. | Publish blocked with a list of failures. |
| EXM-14 | Assignment modes: `SAME_PAPER` (optional shuffle of question order), `POOLS` (teacher defines pools with "pick k of n"; every pool question in a pool must have equal marks), `MANUAL_SETS` (teacher defines sets and assigns students). | Each student's paper is generated at publish/start, stored, and reproducible (seeded). |
| EXM-15 | Teacher shall clone an exam (with questions) into a new draft. | S priority. |

### 4.5 Exam delivery — student (DLV)
| ID | Requirement | AC |
|---|---|---|
| DLV-01 | Student shall see only exams assigned to their section with status and schedule. | — |
| DLV-02 | Before starting, student shall accept a consent notice listing monitored data, screen viewing and AI usage; acceptance is stored with timestamp and version. | No session without consent record. |
| DLV-03 | **Pre-exam check** shall verify: agent service + helper alive and authenticated; device trust vs exam device policy; VM indicators; remote-session indicators (RDP session, remote-control tools); multiple displays; blocked processes running; AI extensions installed in VS Code (default and exam profile); local AI servers (process names, listening ports 11434, 1234, 8080 with LLM signatures); required toolchain for allowed languages. | Each check returns PASS/WARN/FAIL with a human-readable reason; FAIL blocks start under `LAB_ONLY`/`LAPTOP_STRICT`, becomes FLAG under `LAPTOP_FLAG_ONLY`. |
| DLV-04 | The exam timer shall be server-authoritative; the client shall display remaining time computed from server time offset. | Client clock change does not change remaining time. |
| DLV-05 | Student shall answer MCQ, numerical and theory parts inside the app (rich text with basic math notation for theory). | — |
| DLV-06 | For a programming part, "Open in IDE" shall create `%ProgramData%\ExamGuard\ws\<session>\<question>\<part>\` with a starter file, and launch the selected allowed IDE on it; VS Code shall be launched with ExamGuard exam profile (`--user-data-dir`, `--extensions-dir`, only allowlisted extensions). | Launched VS Code has no non-allowlisted extensions. |
| DLV-07 | The agent shall snapshot workspace files on change (debounced 2 s) and upload deltas to the server; each snapshot is stored with timestamp and hash. | After killing the client, server holds a snapshot ≤ 10 s old. |
| DLV-08 | Answers entered in-app shall autosave on change (debounced 1 s) and at least every 10 s. | — |
| DLV-09 | On network loss the client shall keep working, queue changes locally (encrypted), show a banner, and resync on reconnect, without losing changes. | Disconnect 3 min → reconnect → all edits present on server. |
| DLV-10 | Student shall submit explicitly (with confirmation listing unanswered parts) or be auto-submitted when time ends. Submission content = last in-app answers + final workspace snapshot. | — |
| DLV-11 | After submission the student shall receive a receipt: submission ID, timestamp, SHA-256 of the canonical submission. | Hash recomputed server-side matches. |
| DLV-12 | After submission or end, the session shall be read-only; network lock and IDE restrictions removed; workspace folder sealed (copied to server, local copy deleted per exam setting). | — |
| DLV-13 | Visible test cases may be run locally by the student via the installed toolchain ("Run tests" button) — informational only. | Local run results never affect grades. |
| DLV-14 | If the Desktop app is closed or crashes during an exam, the agent shall keep monitoring and the event `EXAM_APP_CLOSED` shall be raised; reopening resumes the session. | — |

### 4.6 Live exam — teacher (LIV)
| ID | Requirement | AC |
|---|---|---|
| LIV-01 | Teacher shall start and end an exam; ending auto-submits all in-progress sessions. | — |
| LIV-02 | Live dashboard shall show each student: session state, device + trust, connection, last heartbeat, progress (parts answered), time remaining, alert counts by severity. | Updates within 2 s of change. |
| LIV-03 | Alerts (FLAG/BLOCK/REVIEW) shall appear in a live feed with student, rule, decision, action taken, screenshot thumbnail, and actions: *Watch live*, *Acknowledge*, *Lock*, *Terminate*. | — |
| LIV-04 | Teacher shall extend time for an individual student (reason required). | Student timer updates ≤ 2 s; audited. |
| LIV-05 | Teacher shall lock a session (student UI shows "Paused by invigilator"; input disabled; IDE windows minimized), resume it, or terminate it (reason required). | Audited; terminated session is auto-submitted. |
| LIV-06 | **On-demand live view**: teacher shall open a student's live screen from the dashboard or an alert. The agent Helper shall stream JPEG frames at target 8–12 fps, ≤ 1280×720, adaptive to bandwidth, relayed by the server to the requesting teacher only. | Start ≤ 3 s; stream stops ≤ 2 s after the viewer closes; ≤ 4 concurrent views per teacher. |
| LIV-07 | Live view frames shall not be persisted. The student UI shall show an indicator while being viewed. | No frame data in DB/disk after viewing. |
| LIV-08 | Teacher shall view the security timeline of any student (filter by severity/type). | — |

### 4.7 Security monitoring and policy (SEC)
| ID | Requirement | AC |
|---|---|---|
| SEC-01 | The agent shall consist of a **Service** (LocalSystem, Session 0) and a **Helper** (runs in the interactive user session, launched by the service via `WTSQueryUserToken`/`CreateProcessAsUser`). | Killing Helper → restarted by Service ≤ 3 s and `HELPER_RESTARTED` raised. |
| SEC-02 | The agent shall maintain its own mutually authenticated WebSocket (TLS) to the server, independent of the Desktop app, using a per-session agent token issued at session start. | Server receives agent events while Desktop is closed. |
| SEC-03 | Every agent message shall carry a monotonically increasing sequence number; the server shall detect gaps and duplicates. | Dropped messages → `AGENT_SEQUENCE_GAP`. |
| SEC-04 | Agent heartbeat every 5 s; server shall raise `AGENT_HEARTBEAT_MISSED` after 15 s silence; Desktop heartbeat independently. | — |
| SEC-05 | Monitors (event types in §6) shall cover: process start/stop (allow/block lists by image name + path + publisher signature where available), foreground window changes, clipboard changes, file activity in user folders/removable drives outside workspace, removable storage insertion, display count, VM indicators, remote sessions/tools, IDE AI extensions, local AI servers, network adapter changes, code-insertion bursts in workspace. | Each monitor has an automated or scripted test in the security test plan. |
| SEC-06 | The **policy engine** (server) shall evaluate each event against the exam's rule set and return a decision `ALLOW/WARN/FLAG/BLOCK/REVIEW` plus actions (`NOTIFY_STUDENT`, `ALERT_TEACHER`, `SCREENSHOT`, `KILL_PROCESS`, `LOCK_SESSION`, `TERMINATE_SESSION`). | Rule evaluation is pure, deterministic and unit-tested. |
| SEC-07 | Rules shall support: event-type match, attribute predicates (e.g. process name in list), thresholds over sliding windows (e.g. 3 focus losses in 60 s → FLAG), severity escalation, and per-device-trust variants. | — |
| SEC-08 | The agent shall apply **local fast-path enforcement** for `BLOCK` rules pushed to it at session start (e.g. kill blocked process immediately) and report the action; the server remains source of truth. | Blocked browser killed ≤ 1 s after start. |
| SEC-09 | Built-in policy profiles: `STANDARD`, `STRICT`, `LENIENT`; teacher may customise per exam. | — |
| SEC-10 | **Network lock**: when enabled, the agent Service shall install Windows Firewall rules in a dedicated group that block all outbound/inbound traffic except to the exam server address/port (+ DHCP/DNS to LAN as needed), and remove them on session end. On service start, stale ExamGuard rules shall be removed. | During lock, `https://www.google.com` unreachable; server reachable; rules gone after end or reboot. |
| SEC-11 | **Screenshot evidence**: for decisions with `SCREENSHOT` action, the Helper shall capture the screen (≤ 1600 px wide JPEG) and upload it linked to the event. | Screenshot appears in alert ≤ 3 s. |
| SEC-12 | Every security event and decision shall be stored with: student, session, device, timestamp (agent + server), type, attributes, severity, rule ID, decision, actions taken, evidence refs. | — |
| SEC-13 | **Code-insertion burst**: the agent shall compare consecutive workspace snapshots; insertion of > N characters (default 300) within ≤ 2 s without matching keyboard activity count shall raise `CODE_INSERTION_BURST`. | Pasting 50 lines triggers; normal typing does not. |
| SEC-14 | Agent configuration and binaries shall be integrity-checked (code signature/hash reported at session start); mismatches raise `AGENT_INTEGRITY_FAILED`. | — |
| SEC-15 | The agent shall only capture screen, clipboard metadata and file events while a session is `PRECHECK`, `READY`, `IN_PROGRESS` or `LOCKED`. | Outside sessions, agent is idle (verified by log). |
| SEC-16 | Clipboard content shall not be stored; only metadata (size, format, source process, SHA-256 prefix) unless the policy marks the content as evidence for a paste into the workspace. | — |

### 4.8 Evaluation (EVL)
| ID | Requirement | AC |
|---|---|---|
| EVL-01 | On submission, a grading job shall be enqueued per session; parts are evaluated independently and idempotently. | Re-running a job yields identical deterministic results. |
| EVL-02 | MCQ: exact match on option set; partial credit for multi-select optional (configurable). | — |
| EVL-03 | Numerical: parse value (+unit), compare within tolerance; method marking points (if any) evaluated by AI. | — |
| EVL-04 | Programming: for each allowed submission, compile and run in the sandbox (see SBX) against all test cases of each part; test-score = part marks × Σ(weights of passed)/Σ(weights). | Unit test with known pass/fail matrix. |
| EVL-05 | If compilation fails or test-score < part marks, AI may award partial credit from marking points and reference-solution comparison, capped by EXM-11; suggested score = max(test-score, min(AI score, cap)). | — |
| EVL-06 | **Hard-coding detection**: a part shall be marked `SUSPECT_HARDCODE` if visible tests pass but randomized tests fail significantly, or if static heuristics (literal outputs matching visible expected outputs, input-equality branches) or AI review indicate special-casing. Suspect parts go to review. | Seeded hard-coded solution is detected. |
| EVL-07 | Theory: AI evaluates each marking point → awarded marks, verbatim evidence quote(s) from the answer, rationale, confidence (0–1). | Output validated against JSON schema; invalid output retried once then → `NEEDS_REVIEW`. |
| EVL-08 | **Prompt-injection defence**: student content shall be passed as delimited, escaped data; a detector shall scan answers for instruction-like patterns; AI-awarded marks shall be clamped to [0, marking-point marks]; detected injection → `NEEDS_REVIEW` + security event `AI_INJECTION_SUSPECTED`. | Red-team set of ≥ 20 injection strings all routed to review; none changes a score above the clamp. |
| EVL-09 | **Confidence routing**: a part is `AUTO_ACCEPTED` iff: deterministic-only type; or (AI confidence ≥ exam threshold (default 0.80) AND, where both deterministic and AI scores exist, they differ by ≤ 10 % of part marks) AND not `SUSPECT_HARDCODE` AND no injection AND no similarity hit above threshold AND session has no unresolved `REVIEW` decision. Otherwise `NEEDS_REVIEW`. | Unit-tested truth table. |
| EVL-10 | **Similarity**: after the exam ends, for each programming part compare all pairs of students who received that question: tokenize with language lexer, normalize identifiers/literals, strip comments/whitespace, k-gram winnowing fingerprints → Jaccard-style similarity; theory: normalized text shingles. Pairs ≥ threshold (default 0.80 code, 0.70 text) are flagged with matched regions. | Renamed-variable copy ≥ 0.8; independent solutions to same problem typically < 0.5 on test set. |
| EVL-11 | Teacher review queue shall show per part: answer/code, test results (input, expected, actual, time, memory — hidden test inputs visible to teacher only), AI breakdown with quotes, similarity matches side-by-side, related security events. | — |
| EVL-12 | Teacher shall accept or override any part score; override requires a reason; all versions retained (immutable history). | — |
| EVL-13 | Teacher shall publish results; visibility follows EXM-02. Students see marks/feedback only after publication. | Before publication, student API returns no scores. |
| EVL-14 | Evaluation failures (sandbox error, AI timeout) shall retry with backoff (max 3) then route to `NEEDS_REVIEW` with reason. | — |

### 4.9 Code sandbox (SBX)
| ID | Requirement | AC |
|---|---|---|
| SBX-01 | Each run shall execute in a fresh container from a per-language image (gcc/g++, Python 3, OpenJDK 17, Node 20). | — |
| SBX-02 | Containers shall run with: no network, non-root user, read-only root FS + small tmpfs workdir, dropped capabilities, `no-new-privileges`, pids limit (64), memory limit (per question, default 256 MB), CPU limit (1 core), wall-clock timeout (per question, default 2 s/test, compile 10 s), output size cap (1 MB). | Fork bomb, infinite loop, memory hog, network attempt, large output — each contained and reported with the right verdict. |
| SBX-03 | Verdicts: `OK`, `WRONG_ANSWER`, `COMPILE_ERROR`, `RUNTIME_ERROR`, `TIME_LIMIT`, `MEMORY_LIMIT`, `OUTPUT_LIMIT`, `SANDBOX_ERROR`. | — |
| SBX-04 | The runner shall compile once per submission-part and run all tests in the same container sequentially, or in parallel across submissions up to a configurable concurrency (default = CPU cores − 1). | 60 submissions × 3 parts × 10 tests graded in ≤ 10 min on a 4-core laptop. |

### 4.10 AI gateway (AI)
| ID | Requirement | AC |
|---|---|---|
| AI-01 | A provider interface shall abstract `evaluate(request) → structured result` with implementations: Ollama, Gemini, OpenAI, Mock. | Mock enables deterministic tests and demo fallback. |
| AI-02 | Ollama shall be the default provider; model configurable. | — |
| AI-03 | External providers require: Admin global allow, kill switch off, exam-level opt-in. Otherwise calls are refused before network I/O. | Test: misconfiguration cannot leak data. |
| AI-04 | Before external calls, redaction shall remove student names, IDs, emails and file paths; a pseudonymous ID is used. | Redaction unit tests. |
| AI-05 | Every AI call shall be logged: provider, model, prompt template version, token counts, latency, outcome (no student identity for external calls). | — |
| AI-06 | Calls time out after 60 s (local) / 30 s (external); retried once; then fall back to `NEEDS_REVIEW`. | — |
| AI-07 | Prompts shall be versioned templates stored in the repo; each evaluation stores the template version used. | — |

### 4.11 Analytics, reporting and audit (RPT / AUD)
| ID | Requirement | AC |
|---|---|---|
| RPT-01 | Exam results view: distribution histogram, mean/median/SD, pass rate, per-question and per-part average and difficulty index. | — |
| RPT-02 | Security summary: counts by decision/type, students with FLAG/BLOCK/REVIEW, similarity clusters. | — |
| RPT-03 | Export results CSV (student ID, name, per-question and total marks, flags) and a PDF exam report. | Opens in Excel; PDF renders charts. |
| AUD-01 | Audit log shall record: logins (success/fail), user/course changes, CSV imports, exam changes and state transitions, session state transitions, teacher live actions, grade changes, result publication, AI external calls, settings changes. | — |
| AUD-02 | Audit entries: actor, role, action, entity type/ID, before/after (where applicable), reason, timestamp, request ID, source IP/device. | — |
| AUD-03 | Audit log shall be append-only at the application level; each entry stores the SHA-256 hash of the previous entry (hash chain); a verifier shall detect tampering. | Modifying a row in DB is detected by verifier. |
| AUD-04 | Admin and teachers (own exams) shall filter and export audit logs. | — |

---

## 5. Non-functional requirements

### 5.1 Performance (PERF)
| ID | Requirement |
|---|---|
| PERF-01 | 80 concurrent student sessions per server on a 4-core / 16 GB host; load test at 60 with simulated agents. |
| PERF-02 | Security event → teacher dashboard ≤ 2 s (p95) on LAN. |
| PERF-03 | Autosave request ≤ 300 ms (p95) on LAN. |
| PERF-04 | Live view start ≤ 3 s; frame latency ≤ 500 ms; per-stream bandwidth ≤ 8 Mbps. |
| PERF-05 | Agent CPU ≤ 3 % average and RAM ≤ 80 MB on a 4-core client when not streaming. |
| PERF-06 | Deterministic grading of a 60-student exam ≤ 10 min; AI grading proceeds in background without blocking review of finished parts. |

### 5.2 Reliability (REL)
| ID | Requirement |
|---|---|
| REL-01 | No loss of student work older than 10 s on client crash, network loss ≤ 30 min, or server restart. |
| REL-02 | Server restart during an exam shall not change deadlines; sessions resume on reconnect. |
| REL-03 | Network lock rules shall always be removed after session end, agent restart, or reboot (fail-open after exam, never leaving a PC offline). |
| REL-04 | Grading jobs are idempotent and resumable. |
| REL-05 | Daily DB backup script + one-command restore documented. |

### 5.3 Security (SECN)
| ID | Requirement |
|---|---|
| SECN-01 | All client–server traffic over TLS 1.2+ (self-signed CA generated at server setup; fingerprint pinning, DEV-03). |
| SECN-02 | Input validated with shared Zod schemas on both client and server; server is authoritative. |
| SECN-03 | Electron hardening: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP, no remote content, narrow preload API, devtools disabled in production. |
| SECN-04 | Hidden test cases, reference solutions and other students' data never sent to student clients. |
| SECN-05 | Rate limiting on auth and write endpoints. |
| SECN-06 | Dependency audit (`pnpm audit`, `cargo audit`) in CI; no known critical vulnerabilities at release. |
| SECN-07 | Secrets (JWT keys, DB password, API keys) only in server environment, never in client builds or repo. |

### 5.4 Privacy (PRIV)
| ID | Requirement |
|---|---|
| PRIV-01 | Monitoring only during active sessions (SEC-15); consent recorded (DLV-02). |
| PRIV-02 | Live view not recorded; screenshots only on policy decisions. |
| PRIV-03 | Retention: screenshots and snapshots deleted N days (default 180) after results publication; configurable by Admin. |
| PRIV-04 | External AI off by default with redaction (AI-03/04). |

### 5.5 Usability (UX)
| ID | Requirement |
|---|---|
| UX-01 | Consistent design system; light/dark themes; keyboard navigable; minimum 4.5:1 contrast. |
| UX-02 | Every pre-check failure and security warning shown to students in plain language with what to do. |
| UX-03 | Teacher authors a 3-question, 2-part-each exam in ≤ 15 min (usability test with one teacher). |

### 5.6 Maintainability and quality (QA)
| ID | Requirement |
|---|---|
| QA-01 | Monorepo with typed shared contracts (`packages/shared`). |
| QA-02 | Unit coverage ≥ 70 % for domain modules (policy engine, grading, similarity, auth); integration tests for every API module; E2E scripted demo flows. |
| QA-03 | CI on every push: lint, typecheck, test, build (TS) and `cargo clippy`/`test` (Rust). |
| QA-04 | Structured JSON logs with request/session correlation IDs. |
| QA-05 | Each phase ends with updated docs and a tagged commit. |

### 5.7 Portability / deployment (DEP)
| ID | Requirement |
|---|---|
| DEP-01 | Server starts with `docker compose up -d` plus a first-run setup that creates the admin account and TLS CA. |
| DEP-02 | Desktop app and agent distributed as signed (self-signed acceptable for project) Windows installers; agent installer registers service. |
| DEP-03 | Sandbox images pre-built and loadable offline (`docker load`). |

---

## 6. Security event catalogue (default `STANDARD` profile)

| Event type | Source | Default decision / actions |
|---|---|---|
| `SESSION_STARTED/ENDED/SUBMITTED` | Server | ALLOW (audit) |
| `PRECHECK_FAILED` | Agent | BLOCK start (or FLAG under `LAPTOP_FLAG_ONLY`) |
| `PROCESS_BLOCKED_STARTED` (browsers, chat apps, AI desktop apps, remote tools) | Agent | BLOCK: kill + screenshot + alert |
| `PROCESS_UNKNOWN_STARTED` (not on allowlist) | Agent | WARN; 3 in 5 min → FLAG |
| `FOREGROUND_NON_ALLOWED` | Helper | WARN; ≥ 30 s cumulative in 5 min → FLAG + screenshot |
| `CLIPBOARD_CHANGED_EXTERNAL` (source process not allowed) | Helper | FLAG |
| `CODE_INSERTION_BURST` | Agent | FLAG + screenshot; review in grading |
| `FILE_ACTIVITY_OUTSIDE_WORKSPACE` (user folders, removable) | Agent | WARN; on removable drive → FLAG |
| `REMOVABLE_STORAGE_CONNECTED` | Agent | FLAG |
| `DISPLAY_COUNT_CHANGED` (> 1) | Helper | FLAG + screenshot |
| `VM_DETECTED` | Agent | BLOCK start (STRICT/LAB) / FLAG |
| `REMOTE_SESSION_DETECTED` | Agent | BLOCK: lock session + alert |
| `AI_EXTENSION_DETECTED` | Agent | BLOCK start; during exam → FLAG + screenshot |
| `LOCAL_AI_SERVER_DETECTED` | Agent | BLOCK: kill + alert |
| `NETWORK_ADAPTER_CHANGED` (new adapter/hotspot during lock) | Agent | FLAG |
| `NETWORK_LOCK_FAILED` | Agent | REVIEW + alert |
| `IDE_LAUNCHED_OUTSIDE_PROFILE` | Agent | FLAG |
| `AGENT_HEARTBEAT_MISSED` | Server | FLAG; > 60 s → REVIEW |
| `AGENT_SEQUENCE_GAP` | Server | FLAG |
| `AGENT_INTEGRITY_FAILED` | Server | REVIEW + lock |
| `HELPER_RESTARTED` | Agent | WARN; 3 times → FLAG |
| `EXAM_APP_CLOSED` | Agent | FLAG |
| `CLIENT_DISCONNECTED/RECONNECTED` | Server | ALLOW (record); > 2 min → WARN |
| `DUPLICATE_LOGIN_ATTEMPT` | Server | FLAG |
| `SCREEN_CAPTURE_FAILED` | Helper | FLAG |
| `AI_INJECTION_SUSPECTED` | Grader | REVIEW |
| `SIMILARITY_HIGH` | Grader | REVIEW |

Decision semantics: **ALLOW** record only · **WARN** record + student notice · **FLAG** record + teacher alert (+ screenshot) · **BLOCK** enforce action + teacher alert + screenshot · **REVIEW** teacher must resolve; may lock session pending decision.

---

## 7. Data requirements (logical model)

| Entity | Key attributes |
|---|---|
| User | id, role, username, name, email, passwordHash, mustChangePassword, active |
| Course / Section | id, code, title, term; section ↔ teachers, section ↔ students |
| Device | id, machineId, hostname, os, agentVersion, trust |
| Exam | id, sectionId, state, settings (JSON validated), schedule, duration, createdBy |
| Question | id, examId, type, order, prompt, attachments, poolId? |
| Part | id, questionId, label, prompt, marks, config (type-specific JSON) |
| TestCase | id, partId, kind (visible/hidden/random), input, expectedOutput, weight, generator? |
| MarkingPoint | id, partId, description, marks |
| Pool / AssignmentSet | id, examId, pick k, members |
| Paper | id, sessionId, questionOrder, seed |
| Session | id, examId, studentId, deviceId, state, startedAt, deadline, extensions[], consentVersion |
| Answer | sessionId, partId, content, updatedAt, version |
| WorkspaceSnapshot | id, sessionId, partId, files (blob refs), hash, createdAt |
| Submission | id, sessionId, submittedAt, kind (manual/auto/terminated), contentHash |
| SecurityEvent | id, sessionId, type, agentTs, serverTs, seq, attributes, severity, ruleId, decision, actions, evidenceIds |
| Evidence | id, eventId, kind (screenshot), blobRef, hash |
| Evaluation | id, submissionId, partId, state, testScore, aiScore, suggestedScore, finalScore, confidence, flags, details JSON, version |
| TestRun | evaluationId, testCaseId, verdict, timeMs, memKb, outputExcerpt |
| SimilarityPair | examId, partId, sessionA, sessionB, score, matches JSON |
| GradeChange | evaluationId, oldScore, newScore, actor, reason, at |
| AiCall | id, provider, model, templateVersion, latencyMs, tokens, outcome, external |
| AuditLog | id, actor, action, entity, before, after, reason, at, prevHash, hash |

Blobs (images, snapshots, screenshots) stored on server filesystem volume under content-addressed paths; DB stores references and hashes.

---

## 8. External interfaces

### 8.1 User interfaces
- **Admin:** Users, Courses & Sections, CSV Import, Devices, AI & Privacy settings, System Health, Audit Log.
- **Teacher:** Courses → Exams (list), Exam Editor (settings, questions, parts, tests, validation), Live Dashboard (students grid, alert feed, live view panel), Review Queue, Results & Analytics, Audit (own exams).
- **Student:** Server select & login, My Exams, Consent, Pre-check, Exam Workspace (question navigator, part panels, Open in IDE, Run visible tests, timer, connection/agent status, "being viewed" indicator), Submission receipt, Results (if published).

### 8.2 Software interfaces
- **REST API** `/api/v1/...` (JSON, OpenAPI document generated from Zod schemas). Main groups: `auth`, `admin`, `courses`, `exams`, `questions`, `sessions`, `answers`, `workspace`, `submissions`, `evaluations`, `reviews`, `results`, `security-events`, `audit`, `health`.
- **WebSocket channels:** `/ws/client` (desktop app: session state, timer sync, commands like lock), `/ws/agent` (agent: events, heartbeats, snapshots, screenshot/live frames, commands), `/ws/teacher` (dashboard updates, alerts, live view frames).
- **Agent ↔ Desktop (local):** named pipe `\\.\pipe\examguard-agent` with per-boot ACL (current user only) for UI status and commands (launch IDE, pre-check results). Not trusted for security decisions.
- **Docker Engine API** (sandbox runner), **Ollama HTTP API**, **Gemini/OpenAI HTTPS APIs** (optional).

### 8.3 Communication
TLS everywhere; WebSocket messages JSON with `{type, seq, ts, payload}`; binary frames for images (JPEG) with small JSON header.

---

## 9. Traceability (PRD feature → SRS)

| PRD area | SRS requirements |
|---|---|
| 7.1 Identity & admin | AUTH-01…08, ADM-01…06, DEV-01…05 |
| 7.2 Authoring | EXM-01…15 |
| 7.3 Delivery | DLV-01…14 |
| 7.4 Security & monitoring | SEC-01…16, LIV-01…08, §6 |
| 7.5 Evaluation | EVL-01…14, SBX-01…04 |
| 7.6 AI | AI-01…07, EVL-07…09 |
| 7.7 Reporting | RPT-01…03, AUD-01…04 |
| NFR | PERF, REL, SECN, PRIV, UX, QA, DEP |

Requirement-to-phase mapping is in [ROADMAP.md](ROADMAP.md); requirement-to-test mapping will be maintained in `docs/TEST_PLAN.md` from Phase 1.
