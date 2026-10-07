# ExamGuard — Product Requirements Document

| | |
|---|---|
| **Version** | 2.0 (supersedes the undiscovered v1.0 draft) |
| **Date** | 2026-10-07 |
| **Owner** | Riday Mondal |
| **Status** | Baseline — pending owner sign-off at end of Phase 0 |
| **Source** | [DISCOVERY_NOTES.md](DISCOVERY_NOTES.md) |

---

## 1. Problem

University programming and technical lab exams are run on lab PCs or students' own laptops. Today, invigilators cannot reliably see whether a student has opened a browser, used ChatGPT, enabled an IDE's built-in AI (Copilot, Codeium…), or copied a neighbour's code with the variable names changed. Grading 60+ programming and theory scripts by hand is slow and inconsistent, and pure auto-graders only check exact outputs, giving zero to a student who solved most of a problem.

## 2. Product vision

**ExamGuard is a Windows desktop platform for running secure, invigilated lab exams and grading them fairly.** It combines:

1. **Controlled exam sessions** on lab PCs and student laptops, with a native Rust agent that enforces a per-exam policy (allowed apps, network lock, IDE profile) and reports everything that matters.
2. **Teacher oversight in real time:** a live dashboard of students, security alerts with screenshot evidence, and on-demand live view of any student's screen.
3. **Explainable hybrid grading:** reference-solution-driven test execution, deterministic checks, AI-assisted rubric evaluation, similarity detection, and teacher review — where every mark has evidence.

### Design principles
- **Honest security.** Claim only what Windows lets us guarantee; detect and record what we cannot prevent; label the trust level of each device.
- **Rules first, AI second.** Security decisions are made by a deterministic policy engine. AI assists grading; it never has the final word without confidence and teacher control.
- **Explainability.** Every security decision and every mark can be traced to evidence.
- **Privacy by default.** Local AI by default, external AI opt-in with redaction, screen captured only during an active exam, live view not recorded.
- **Works without internet.** The whole system runs on a LAN.

## 3. Goals and non-goals

### Goals (what success looks like)
| ID | Goal | Measure |
|---|---|---|
| G1 | Run a complete lab exam end-to-end with no manual workarounds | Demo: 30+ simulated/real students, authoring → exam → grading → published results |
| G2 | Detect the cheating behaviours named in discovery | Each scenario in the security test plan (browser, AI extension, local AI, VM, RDP, agent kill, network change, paste burst) produces the correct event and decision |
| G3 | Give the teacher fast situational awareness | Security alert visible on dashboard ≤ 2 s after detection; live view starts ≤ 3 s after click |
| G4 | Grade programming answers fairly with partial credit | Per-part marks; on a test set of answers, auto-accepted marks within ±10 % of teacher marks for ≥ 85 % of parts |
| G5 | Catch copying | Renamed-variable / reordered-function copies of a solution flagged with similarity ≥ 0.8 |
| G6 | Be technically defensible | Clean architecture, ADRs, ≥ 70 % unit-test coverage on core domain logic, security test report |

### Non-goals (explicitly out of scope)
- macOS / Linux clients.
- Webcam, microphone, face or identity proctoring.
- Remote at-home exams (the design assumes an invigilated room).
- A built-in code editor (coding happens in external IDEs).
- LMS integration (Moodle/Canvas), broadcast announcements, raise-hand requests — future work.
- Preventing a student from using a phone in the room (invigilator's responsibility).

## 4. Users

| Role | Who | Primary needs |
|---|---|---|
| **Admin** | Department lab coordinator / IT | Create teacher accounts, import students by CSV, manage courses, set global AI and privacy policy, see system health |
| **Teacher** | Course instructor / invigilator | Author exams with parts and reference solutions, configure security, run the live exam, react to alerts, review grades and evidence, publish results |
| **Student** | Undergraduate | Log in, pass the pre-exam check, answer questions, code in a familiar IDE, never lose work, submit with confidence, see results if allowed |

## 5. Deployment context

```
                       Lab LAN (no internet required)
 ┌──────────────────────┐        ┌───────────────────────────────────────┐
 │ Teacher PC/laptop     │        │ Server host (lab PC OR teacher laptop)│
 │ ExamGuard Desktop     │◀──────▶│ Docker Compose: API, worker, Postgres,│
 │ (Teacher mode)        │        │ Redis, code sandbox, Ollama (optional)│
 └──────────────────────┘        └───────────────▲───────────────────────┘
                                                 │ HTTPS/WSS
           ┌─────────────────────────────────────┼──────────────────────┐
 ┌─────────┴──────────┐ ┌──────────────────┐ ┌───┴──────────────────┐
 │ Lab PC (managed)    │ │ Lab PC (managed) │ │ Student laptop        │
 │ Desktop + Agent svc │ │ ...              │ │ (unmanaged, per-exam) │
 └─────────────────────┘ └──────────────────┘ └───────────────────────┘
```

- **Managed device:** lab PC; agent installed as a Windows Service by IT; student has no admin rights. Enforcement is strong.
- **Unmanaged device:** student's laptop; agent installed by the student (admin once). Detection is strong, enforcement is best-effort; sessions are labelled *unmanaged*.

## 6. Key user journeys

### J1 — Admin prepares the term
Admin logs in → creates teacher accounts → creates course "CSE-3101 Sec A" → imports students from CSV (ID, name, email) → assigns teacher to course → sets global AI policy (local only / external allowed).

### J2 — Teacher authors an exam
Creates exam for a course → sets schedule, duration, device policy, network lock, allowed IDEs, results visibility, assignment mode (same paper / pools / manual sets) → adds questions:
- **Programming:** statement, language(s), parts with marks, reference solution, test cases per part (visible / hidden / randomized generator), optional required-approach notes.
- **Theory / technical:** statement (with images), parts with marks, model answer, marking points.
- **Numerical:** parts with expected value, tolerance and units, plus optional method marking points.
- **MCQ:** options, correct answer(s), marks.

→ validates the paper (reference solutions run and pass their own tests) → publishes.

### J3 — Student takes the exam
Opens ExamGuard → server found automatically on LAN → logs in → sees assigned exam → reads consent (monitoring, screen viewing, data use) → **pre-exam check** (agent alive, device trust, VM/RDP, AI extensions, local AI servers, blocked apps, required compilers) → teacher starts exam → student answers theory/MCQ/numerical inside ExamGuard → for programming parts clicks **"Open in IDE"**: ExamGuard creates the workspace folder and launches the chosen IDE (VS Code with clean exam profile) → work is autosaved continuously → submits or is auto-submitted at time-out → network and IDE restrictions lifted.

### J4 — Teacher runs the live exam
Live dashboard shows every student: status, progress, time left, device trust, alert count → alert arrives ("chrome.exe started — BLOCKED", with screenshot) → teacher clicks **Watch live** → sees the screen at ~10 fps → decides: dismiss, warn, **lock**, **terminate**; or **extends time** for a student whose PC crashed.

### J5 — Grading and review
Submissions graded in background: MCQ/numerical deterministically; code compiled and run in sandbox against reference-derived tests; AI evaluates marking points, partial code and suspicious logic; similarity analysis across students → high-confidence results auto-accepted, others queued → teacher reviews queue with evidence (test results, AI rationale with quotes, similarity side-by-side, security timeline) → overrides with a reason where needed → publishes results with chosen visibility → exports CSV/PDF.

## 7. Feature requirements (MoSCoW)

Detailed, testable requirements are in [SRS.md](SRS.md). Priority: **M** = must (in the defended product), **S** = should, **C** = could (stretch).

### 7.1 Identity and administration
| Feature | P |
|---|---|
| Login for Admin/Teacher/Student; Argon2id passwords; short-lived access token + rotating refresh token; server-enforced RBAC | M |
| Admin: manage teachers, courses, sections; CSV import of students with validation report | M |
| Force password change on first login; admin password reset | M |
| One active exam session per student; device registration and trust level | M |
| LAN server discovery (mDNS) + manual connection code | M |

### 7.2 Exam authoring
| Feature | P |
|---|---|
| Question types: MCQ, numerical, theory/technical, programming (C, C++, Python, Java, JS) | M |
| Multi-part questions with marks per part | M |
| Reference solution / model answer per question/part | M |
| Test cases per part: visible, hidden, randomized (generator + reference solution) | M |
| Image attachments in questions | M |
| Assignment modes: same paper (shuffle), random pools, manual sets | M |
| Paper validation: reference solutions compile and pass their tests before publish | M |
| Per-exam settings: device policy, network lock, allowed IDEs, results visibility, security policy profile | M |
| Question bank reuse / exam cloning | S |

### 7.3 Exam delivery (student)
| Feature | P |
|---|---|
| Consent screen and pre-exam check with clear pass/fail reasons | M |
| Server-authoritative timer; autosave; reconnect without data loss; auto-submit at end | M |
| External IDE mode: workspace folder per part, IDE launch (VS Code exam profile, Code::Blocks, Dev-C++), continuous file snapshots | M |
| Local "Run" via installed toolchain (student's own testing; not used for grading) | M |
| Submission receipt (hash of submitted content) | M |
| Restrictions lifted and workspace sealed after submit | M |

### 7.4 Security and monitoring
| Feature | P |
|---|---|
| Rust agent: Windows Service + user-session Helper, own authenticated channel to server | M |
| Monitors: processes, foreground window, clipboard, file activity outside workspace, displays, VM/RDP, IDE AI extensions, local AI servers, code-insertion bursts, heartbeats | M |
| Policy engine: per-exam rules → ALLOW / WARN / FLAG / BLOCK / REVIEW; actions: notify, screenshot, kill process, lock session, terminate session | M |
| Network lock: only exam server reachable during exam (per exam) | M |
| Agent liveness: missing heartbeat/sequence gaps → violation | M |
| Security timeline per student; audit log for every event and decision | M |
| Violation screenshots stored as evidence | M |
| On-demand live screen view (≤ 4 concurrent, ~8–12 fps, not recorded) | M |
| Teacher controls: extend time, lock, resume, terminate | M |
| Agent self-protection on managed devices (service restarts helper, process protection) | S |
| WFP-based network filter instead of firewall rules | C |

### 7.5 Evaluation
| Feature | P |
|---|---|
| Deterministic: MCQ, numeric with tolerance/units | M |
| Code sandbox: Docker, per-language images, no network, CPU/memory/pids/time limits | M |
| Reference-driven tests; per-part partial credit | M |
| AI evaluation of theory/method marks/partial code with structured, evidence-quoting output | M |
| Hard-coded-output detection (randomized tests + AI/heuristic review) | M |
| Prompt-injection defence for AI grading | M |
| Confidence-based routing to teacher review queue | M |
| Similarity detection (normalized-token winnowing for code; text similarity for theory) | M |
| Teacher override with mandatory reason; full grade history | M |
| Results publishing with per-exam visibility | M |

### 7.6 AI integration
| Feature | P |
|---|---|
| Provider-agnostic AI gateway: Ollama (default), Gemini, OpenAI, Mock | M |
| External AI opt-in per exam, admin kill switch, redaction of identities, audit of every external call | M |
| Timeouts, retries, graceful fallback to "needs teacher review" | M |

### 7.7 Analytics and reporting
| Feature | P |
|---|---|
| Grade distribution, per-question/per-part statistics | M |
| Security summary per exam and per student | M |
| CSV export of results; PDF exam report | M |
| Audit log viewer with filters and export | M |

## 8. Non-functional summary
Full targets in SRS §5.
- **Scale:** ≥ 80 students per exam (load-tested at 60), 1 exam at a time per server, ≤ 4 simultaneous live views.
- **Latency:** alert → dashboard ≤ 2 s; autosave ≤ 1 s on LAN; live view start ≤ 3 s.
- **Reliability:** no answer loss on client crash, network drop or server restart (last autosave ≤ 10 s old).
- **Security:** TLS on all channels, server-side authorization on every request, append-only audit, secrets never in client storage in plain text.
- **Usability:** a teacher can author a 3-question exam in ≤ 15 minutes; a student can start an exam in ≤ 2 minutes from login.
- **Portability:** server brought up with one command on Windows (Docker Desktop) or Linux.

## 9. Assumptions and constraints
- Windows 10/11 (x64) on all clients. Server host has Docker Desktop (WSL2) or Docker on Linux.
- Lab IT permits installing the agent service on lab PCs and allows ExamGuard in antivirus.
- Required compilers/runtimes (gcc/g++, Python 3, JDK 17+, Node 20+) are installed on client machines for local runs; the pre-check verifies them.
- Invigilator is present in the room.
- Ctrl+Alt+Del, physical devices (phones), and a student with administrator rights tampering with their *own* laptop cannot be fully prevented; these are detected where possible and documented.

## 10. Release plan
See [ROADMAP.md](ROADMAP.md): 13 phases (0–12) over ~25 weeks; every phase ends in a working, tested, committed build.

## 11. Sign-off
| Role | Name | Date | Decision |
|---|---|---|---|
| Product owner | Riday Mondal | | ☐ Approved ☐ Changes requested |
