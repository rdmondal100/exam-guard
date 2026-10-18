Read requirements.md in full. It is the source of truth for this project, ExamGuard AI.

We are in the PLANNING phase. Do not write application code, do not install packages, and do not scaffold the project yet.

Step 1 — Clarify.
Ask me up to 10 clarifying questions about anything in requirements.md that is ambiguous, contradictory, risky, or missing. Do not ask again about decisions already listed in section 13. Put the most important first. Wait for my answers before continuing.

Step 2 — Write the project documents.
After I answer, create these files. Keep each one concise and practical: future coding sessions will read them, so avoid repeating the same information across files, and reference other docs instead of copying.

1. CLAUDE.md (root, under ~80 lines)
   - One-paragraph project summary
   - Tech stack and monorepo layout (apps/desktop, apps/server, packages/shared, agent/, tools/student-sim)
   - Commands to install, run, build, and test (placeholders until the skeleton exists)
   - Coding rules: TypeScript strict mode, shared Zod schemas in packages/shared for every API and message, no `any`, small focused files
   - Workflow rules for every session:
     * Read docs/progress.md first
     * Work on one milestone only
     * Run only the tests relevant to the change
     * Update docs/progress.md at the end of the session
   - Dev safety notes (running teacher + student on one PC, never calling the real AI API in tests)
   - Pointers to each file in docs/

2. docs/architecture.md
   - Components and processes on the teacher PC and student PCs
   - How they communicate: protocols, ports, discovery (mDNS + manual IP), TLS approach
   - Rust agent design: Windows service + user-session helper, named pipe to the student app, what it detects and how, screenshots, heartbeat, tamper lock. The agent observes only; it changes no network or firewall settings
   - Local code runner: compilers, Job Object limits, temp folders
   - Screen thumbnails and WebRTC live view design, sized for 200 students
   - Autosave, offline queue, reconnect, same-PC resume, and server crash recovery
   - AI grading pipeline behind a provider interface (Gemini adapter first)
   - Key libraries, each with a one-line reason

3. docs/data-model.md
   - SQLite tables with columns, types, keys, relationships, and indexes
   - File storage layout in the app data folder (screenshots, exports, backups)

4. docs/protocol.md
   - HTTP endpoints (student and teacher)
   - WebSocket message types in both directions, as TypeScript-style shapes
   - Agent ↔ student app messages
   - Protocol versioning

5. docs/milestones.md
   - Organize by the phases in requirements.md section 10 (Phase 1 Foundation through Phase 7 Packaging & hardening). No weeks or dates
   - Break each phase into small milestones, each completable in one focused session, numbered in build order (M01, M02, ...)
   - Each milestone: goal, areas/files touched, acceptance criteria, and how I can test it manually
   - Each phase ends with a demo-able result matching its "Done when" line
   - Place proof-of-concept spikes for the risky parts (agent service + helper seeing the desktop and capturing screenshots; thumbnails for 200 simulated students; WebRTC live view) before the phase that depends on them
   - Mark milestones that could be deferred to Stage 2 if time runs short, and include the checkpoint after Phase 4
   - List Stage 2 items at the end, without breaking them down

6. docs/progress.md
   - A tracker: current phase and milestone, completed milestones, decisions log (start it with the section 13 decisions), known issues, next step, session log

Step 3 — Summarize and stop.
Give me a short summary of: decisions you made that were not in requirements.md, the top risks, and anything you would change in the requirements. Then stop. Do not start Milestone 1.
