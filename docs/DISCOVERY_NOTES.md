# ExamGuard — Requirements Discovery Notes

**Date:** 2026-10-07
**Participants:** Riday Mondal (product owner / developer), Claude (acting requirements engineer)
**Purpose:** Record what was asked, what was decided and *why*, so every requirement in the PRD/SRS can be traced back to a stakeholder decision. This is also the evidence trail for the project defense.

---

## 1. Review of the first draft documents

A first set of documents (PRD, SRS, Architecture, Threat Model, ADRs, Risk Register, Roadmap) had been generated directly from the initial idea, without a discovery phase. The review found:

| # | Problem in first draft | Resolution |
|---|---|---|
| 1 | FR-UI-2 required disabling Ctrl+Alt+Del / Alt+Tab / Win key "via Electron options". Ctrl+Alt+Del (Secure Attention Sequence) cannot be blocked by any user-mode program; Electron options cannot block Alt+Tab or Win key. Contradicted its own Constraints section. | Removed. Security model is now *allowlist + detection + enforcement by native agent*, with documented limits. |
| 2 | Agent signed event batches with an HMAC key that lives on the student machine; presented as tamper protection. | Signature only protects transit. Real integrity comes from **server-side** liveness checks (heartbeats, sequence numbers, "silence is a violation"). |
| 3 | Events flowed Agent → Electron → Server; a tampered Electron could drop them. | Agent has its **own authenticated channel to the server** (ADR-003). |
| 4 | JWT stored in `localStorage`. | Tokens held in Electron main process; refresh token encrypted with OS-backed `safeStorage`. |
| 5 | Students joined via "unique email links" (web-app concept). | Students log in to the desktop app and see exams assigned to their course. |
| 6 | Mentioned an admin console but had no Admin role. | Admin role added. |
| 7 | Over-scoped claims (300 concurrent users, Kafka, Datadog, FERPA). | Right-sized: ~80 students/exam, load-tested at 60, LAN deployment. FERPA removed (not applicable in Bangladesh); generic privacy principles used instead. |
| 8 | Rust agent described as a single Windows Service. A service runs in Session 0 and **cannot capture the user's screen, foreground window or clipboard**. | Agent split into a **Service + user-session Helper** (ADR-002). |
| 9 | PRD marked "Approved" without stakeholder review. | Superseded by this discovery-based baseline. |

## 2. Discovery decisions

### 2.1 Context
| Question | Decision |
|---|---|
| Where are exams taken? | **University computer lab** (primary). If PCs are broken or insufficient, students use **their own laptops in the same room**. Exams are on-site and invigilated. |
| Timeline / team | **5–6 months, solo developer.** All features must be fully working, not mock-ups. |
| Native agent language | **Rust.** |
| Demo priorities | All of: security enforcement, hybrid grading, end-to-end polish, architecture depth. |
| Where does the server run? | **Either a lab PC or the teacher's laptop**, chosen by the teacher. → Server must be portable (Docker Compose) and discoverable on the LAN. |
| Student laptop policy | **Teacher decides per exam** (lab-only / laptops with strict pre-check / laptops flag-only). |
| Account creation | **Admin role + CSV import** of students; admin creates teachers. |

### 2.2 Questions and grading
| Question | Decision |
|---|---|
| Programming languages | **C, C++, Python, Java, JavaScript (Node.js).** |
| Grading philosophy | Teacher writes a **reference solution / model answer** per question. Questions have **multiple parts**; each part marked independently with partial credit. Student answers are judged on whether they **achieve the same purpose**, not on matching the teacher's text/code. |
| How "purpose served" is verified for code | Reference solution is **executed** to generate expected outputs for visible, hidden and randomized test inputs, mapped to parts (deterministic, explainable). AI reviews what tests cannot: non-compiling partial work, required approach, fake/hard-coded logic. |
| Other question types | No preference → **MCQ** and **image attachments on questions** included; file-upload answers deferred. |
| GPU / AI hosting | No preference → **local Ollama default**, model configurable by hardware; cloud AI opt-in per exam. Grading runs asynchronously so slow hardware delays results rather than breaking exams. |
| Cheating the grader must catch | **All four:** hard-coded outputs, AI manipulation (prompt injection), copying between students, use of external AI/ChatGPT. |
| Authority of automatic grades | **Confidence-based:** auto-accept when deterministic and AI agree with high confidence; everything else to teacher review queue; teacher can override anything. |
| What students see after the exam | **Teacher decides per exam:** nothing / marks only / marks + per-part feedback. |
| Anti-copying in the lab | **Teacher-configurable per exam:** same paper (with shuffled order), **random question pools**, or **manual assignment** of different sets to different students. **Similarity detection** must catch code copied line-by-line with renamed variables. |

### 2.3 Live exam and security
| Question | Decision |
|---|---|
| Coding environment | **External IDEs only** — **VS Code, Code::Blocks, Dev-C++.** No built-in code editor. Theory/numerical/MCQ answers are entered in the ExamGuard app. |
| IDE built-in AI (Copilot etc.) | **Prevent + detect:** per-exam network lock, VS Code launched with clean exam profile, pre-exam scan for AI extensions and local AI servers, detection of sudden large code insertions. *Honest limit recorded:* reading what an AI extension suggests inside an IDE is not reliably possible; we make it non-functional and detect attempts instead. |
| Internet during exam | **Teacher decides per exam:** network lock (only the exam server reachable) or monitor-only. |
| Live screen viewing | **On-demand.** Teacher can open any student's live screen at any time, or from a warning alert ("Chrome launched", "AI extension detected"). No always-on grid stream. Live view not recorded. |
| Stored screen evidence | **Violations only:** screenshot attached to FLAG/BLOCK/REVIEW events. |
| Teacher live controls | **Extend time per student; lock / resume / terminate a student.** (Broadcast announcements and raise-hand were not selected → future work.) |

## 3. Consequences that shaped the architecture

1. **On-site + teacher-laptop server ⇒ LAN-first design.** No dependency on internet during an exam. mDNS discovery with manual connection-code fallback.
2. **External IDEs ⇒ no full-screen lockdown.** The exam app must coexist with IDE windows, so the security model shifts from "lock the screen" to "**allowlist processes + lock the network + watch the files + let the teacher look**".
3. **Two device trust levels.** Managed lab PCs (agent pre-installed as a service, no student admin rights) can be *enforced*; unmanaged laptops can mostly be *detected*. Every session records its trust level so the teacher can weigh evidence.
4. **Grading must be explainable.** Every mark traces to a passed test, a matched marking point with quoted evidence, or a teacher decision.
5. **Code is graded on the server**, never trusting the student machine's compiler or output.

## 4. Open items (to revisit during development)

- Exact Ollama model choice after testing on the actual server hardware (Phase 9).
- Whether WFP (Windows Filtering Platform) is needed beyond Windows Firewall rules (stretch, Phase 6).
- Lab IT constraints (whether agent service can be pre-installed on lab PCs; antivirus whitelisting) — to confirm with the department before Phase 12.
