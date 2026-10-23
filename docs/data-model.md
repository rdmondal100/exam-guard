# Data model

SQLite on the teacher PC only, accessed by the server process (better-sqlite3, `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`). Migrations are numbered SQL files in `apps/server/src/db/migrations/` (`0001_init.sql`, ...), applied in a transaction at startup, with the version kept in `PRAGMA user_version`.

**Conventions**
- IDs: `TEXT` UUIDv7 (time-sortable) unless noted.
- Times: `INTEGER` Unix ms, server clock.
- Marks: `INTEGER` **half-units** (4.5 marks = `9`).
- JSON columns: `TEXT` validated by the matching Zod schema in `packages/shared` on read and write.
- Enums: `TEXT` with a `CHECK` constraint.

## Tables

### settings
| col | type | notes |
|---|---|---|
| key | TEXT PK | e.g. `ai.provider`, `ai.model`, `defaults.durationMin`, `runner.limits`, `monitoring.highSeverityApps`, `retention.screenshotDays`, `server.port` |
| value | TEXT | JSON |

The AI API key is **not** here. It's stored by Electron main with `safeStorage` in `secrets.bin` (see layout).

### teacher
| col | type | notes |
|---|---|---|
| id | INTEGER PK | always 1 in Stage 1 |
| password_hash | TEXT | scrypt `N=2^15,r=8,p=1`, salt, encoded |
| created_at, updated_at | INTEGER | |

### class_lists
| col | type | notes |
|---|---|---|
| id | TEXT PK | |
| name | TEXT NOT NULL | |
| created_at | INTEGER | |

### class_students
| col | type | notes |
|---|---|---|
| id | TEXT PK | |
| class_list_id | TEXT FK → class_lists ON DELETE CASCADE | |
| student_code | TEXT NOT NULL | student ID from CSV, trimmed |
| name | TEXT NOT NULL | |
UNIQUE(class_list_id, student_code)

### exams
| col | type | notes |
|---|---|---|
| id | TEXT PK | |
| title | TEXT NOT NULL | |
| state | TEXT | `draft, ready, hosting, running, ended, grading, in_review, finalized` |
| duration_sec | INTEGER NOT NULL | |
| class_list_id | TEXT FK → class_lists (RESTRICT) | nullable while draft |
| monitoring_json | TEXT | per-exam monitoring settings (screenshot policy, high-severity apps, thresholds) |
| pin | TEXT | 6 digits, set when hosting starts |
| global_extension_sec | INTEGER DEFAULT 0 | "extend all" |
| terminal_enabled | INTEGER DEFAULT 0 | exam terminal switch (M15b, migration 0006); off by default |
| terminal_minutes | INTEGER | "on for N minutes" chosen before Start, cleared when Start sets `terminal_until` |
| terminal_until | INTEGER | server time the terminal turns off by itself; NULL = no end |
| files_enabled | INTEGER DEFAULT 1 | student Files panel switch (M15e, migration 0007); on by default; copied by duplicate |
| hosting_started_at, started_at, ended_at, finalized_at | INTEGER | nullable |
| created_at, updated_at | INTEGER | |
INDEX(state)

### questions
| col | type | notes |
|---|---|---|
| id | TEXT PK | |
| exam_id | TEXT FK → exams ON DELETE CASCADE | |
| position | INTEGER NOT NULL | |
| type | TEXT | `code, written` |
| body | TEXT NOT NULL | Markdown problem statement |
| marks | INTEGER NOT NULL | half-units, = sum of criteria |
| allowed_languages_json | TEXT | e.g. `["c","cpp","js"]`. NULL for written |
| student_note | TEXT | shown to students |
| sample_answer | TEXT NOT NULL | |
| sample_language | TEXT | `c, cpp, js, text, ...` |
| ai_notes | TEXT | |
UNIQUE(exam_id, position)

### marking_criteria
| col | type | notes |
|---|---|---|
| id | TEXT PK | |
| question_id | TEXT FK → questions ON DELETE CASCADE | |
| position | INTEGER | |
| name | TEXT NOT NULL | |
| max_marks | INTEGER NOT NULL | half-units |
UNIQUE(question_id, name)

### exam_students (one row per student per exam; this is the "session")
| col | type | notes |
|---|---|---|
| id | TEXT PK | |
| exam_id | TEXT FK → exams ON DELETE CASCADE | |
| class_student_id | TEXT FK → class_students | |
| anon_id | TEXT NOT NULL | random, sent to the AI instead of identity |
| state | TEXT | `not_joined, lobby, active, locked, submitted, ended_by_teacher` |
| connected | INTEGER (0/1) | live flag, tracked separately from state |
| token_hash | TEXT | SHA-256 of the session token. NULL = no active session |
| device_id | TEXT | bound on first join. Cleared by teacher reset |
| pinned_fp | TEXT | cert fingerprint the student trusted |
| extension_sec | INTEGER DEFAULT 0 | |
| joined_at, started_at, submitted_at, last_seen_at | INTEGER | |
| submission_hash | TEXT | SHA-256 over the canonical JSON of all final answers |
| risk_score | INTEGER DEFAULT 0 | denormalised, updated with each event batch |
| outside_ms_total | INTEGER DEFAULT 0 | denormalised |
UNIQUE(exam_id, class_student_id); UNIQUE(token_hash); INDEX(exam_id, state); INDEX(exam_id, risk_score DESC)

### exam_files (files the teacher attaches to an exam, M15f, migration 0008)
| column | type | notes |
|---|---|---|
| id | TEXT PK | UUIDv7; also the file name on disk |
| exam_id | TEXT FK → exams (CASCADE) | |
| name | TEXT NOT NULL COLLATE NOCASE | what the student's copy is called; unique per exam in any letter case |
| size | INTEGER | bytes |
| sha256 | TEXT | hex; students verify it after the download |
| created_at | INTEGER | list order |
UNIQUE(exam_id, name). The bytes are in `exam-files/<examId>/<id>` (see the folder layout); a replace gets a new id.

### answer_versions (every autosave)
| col | type | notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| exam_student_id | TEXT FK → exam_students ON DELETE CASCADE | |
| question_id | TEXT FK → questions | |
| language | TEXT | `text` for written |
| content | TEXT | |
| selected | INTEGER (0/1) | this language was the selected one when saved |
| reason | TEXT | `interval, run, switch_question, switch_language, submit, final` |
| client_seq | INTEGER | |
| client_ts, server_ts | INTEGER | |
UNIQUE(exam_student_id, client_seq); INDEX(exam_student_id, question_id, language, id DESC)

### final_answers (written at submit or auto-submit; immutable)
| col | type | notes |
|---|---|---|
| exam_student_id | TEXT FK | PK part |
| question_id | TEXT FK | PK part |
| language | TEXT | the selected language at submit |
| content | TEXT | empty string if never answered |
| version_id | INTEGER FK → answer_versions | nullable |
| sha256 | TEXT | |
| submitted_at | INTEGER | |
PRIMARY KEY(exam_student_id, question_id)

### events
| col | type | notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| exam_id | TEXT FK | |
| exam_student_id | TEXT FK, nullable | null = exam-level |
| type | TEXT | e.g. `focus_lost, focus_returned, title_changed, app_launched, processes_at_start, monitor_changed, secure_desktop, taskmgr_opened, paste_blocked, large_insertion, run_executed, agent_lost, app_relaunched, duplicate_login, network_lost, network_restored, terminal_opened, terminal_closed, terminal_command, package_installed, internet_blocked, internet_allowed, internet_block_failed` (the terminal types since M15b, the internet types with M21b) |
| severity | TEXT | `low, medium, high, critical` (set by the server classifier) |
| server_ts | INTEGER | |
| client_ts | INTEGER | when it happened on the student PC |
| details_json | TEXT | app name, exe, window title, duration_ms, ... |
| screenshot_path | TEXT | relative to the data folder, nullable |
| source | TEXT | `agent, app, server` |
| dedupe_key | TEXT | `<deviceId>:<agent/app seq>`, makes buffered replays idempotent |
UNIQUE(dedupe_key); INDEX(exam_id, server_ts); INDEX(exam_student_id, server_ts); INDEX(exam_id, severity, server_ts)

### teacher_actions (audit log)
| col | type | notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| exam_id | TEXT FK | |
| exam_student_id | TEXT FK, nullable | null = global action |
| action | TEXT | `message, warn, lock, unlock, extend, end, reset_session, broadcast, extend_all, end_all, start, host, stop_hosting, terminal, grade_edit, finalize, ...`. `terminal` (M15b): payload `{enabled, minutes?}`, or `{enabled:false, reason:"time_up"}` when the window ran out (written by the server) |
| payload_json | TEXT | |
| ts | INTEGER | |
INDEX(exam_id, ts)

### terminal_chunks (exam terminal transcripts, M15b)
| col | type | notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | arrival order = transcript order |
| exam_student_id | TEXT FK → exam_students ON DELETE CASCADE | |
| chunk_key | TEXT | `<examStudentId>:<client key>`, or `truncated:<examStudentId>` for the one cap marker |
| server_ts, client_ts | INTEGER | |
| text | TEXT | terminal output as shown to the student (ANSI kept), ≤16 KB per row |
UNIQUE(chunk_key); INDEX(exam_student_id, id). At most 1 MB of text per student; later chunks are dropped after one marker.

### grading_jobs
| col | type | notes |
|---|---|---|
| id | TEXT PK | |
| exam_id | TEXT FK | |
| question_id | TEXT FK | |
| kind | TEXT | `initial, reevaluate` |
| instruction | TEXT | for re-evaluation |
| scope_json | TEXT | which exam_student_ids |
| state | TEXT | `queued, running, done, failed, cancelled` |
| total, done_count, failed_count | INTEGER | |
| provider, model, prompt_version | TEXT | |
| created_at, finished_at | INTEGER | |
INDEX(exam_id, state)

### evaluations (append-only history: every AI result and every teacher edit)
| col | type | notes |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| exam_student_id | TEXT FK | |
| question_id | TEXT FK | |
| job_id | TEXT FK → grading_jobs, nullable | null for teacher edits |
| author | TEXT | `ai, teacher` |
| status | TEXT | `ok, invalid, error` |
| criteria_json | TEXT | `[{name,max,awarded,reason}]`, half-units |
| total | INTEGER | half-units |
| feedback | TEXT | |
| teacher_notes_json | TEXT | `[{line,issue}]` |
| confidence | TEXT | `high, medium, low`, null for teacher |
| provider, model, prompt_version | TEXT | AI only |
| instruction | TEXT | re-evaluation instruction, if any |
| raw_response | TEXT | AI only |
| attempt | INTEGER | |
| created_at | INTEGER | |
INDEX(exam_student_id, question_id, id DESC); INDEX(job_id)

### answer_grades (current grade per answer; points into history)
| col | type | notes |
|---|---|---|
| exam_student_id, question_id | TEXT | composite PK, FK → final_answers |
| status | TEXT | `pending, ai_graded, verified, modified, needs_manual` |
| current_evaluation_id | INTEGER FK → evaluations, nullable | |
| total | INTEGER | half-units, denormalised |
| updated_at | INTEGER | |
INDEX(question_id, status)

## Relationships (summary)
`class_lists 1─* class_students`, `exams 1─* questions 1─* marking_criteria`, `exams 1─* exam_students *─1 class_students`, `exam_students 1─* answer_versions`, `exam_students 1─* final_answers 1─1 answer_grades`, `exam_students 1─* terminal_chunks`, `answer_grades → evaluations (current)`, `exams 1─* events / teacher_actions / grading_jobs`.

Deleting an exam cascades to everything under it and deletes its screenshot folder and its `exam-files/<examId>/` folder (`exams 1─* exam_files`). Class lists that are assigned to an exam can't be deleted.

## Data folder layout (teacher PC)
Default `%APPDATA%\ExamGuard\` (Electron userData, per profile in dev). Movable in Settings.
```
db/examguard.sqlite (+ -wal, -shm)
secrets.bin                      safeStorage-encrypted: AI API key
certs/server.key, server.crt     self-signed TLS (key never leaves the PC)
screenshots/<examId>/<examStudentId>/<eventId>.jpg
exam-files/<examId>/<fileId>     the files the teacher attached to the exam (M15f)
exports/<examTitle>_<yyyyMMdd-HHmm>.csv
backups/<yyyyMMdd-HHmmss>/       SQLite online backup + copy of screenshots/
logs/main.log, server.log        rotated, 5 × 5 MB
```
- Backups use the better-sqlite3 `backup()` API (safe while running). A backup is taken automatically at exam end and before finalize, plus manually from Settings.
- Retention: `retention.screenshotDays` (default: keep until the exam is deleted) purges screenshot files and nulls `screenshot_path`.

## Student PC local storage
```
%APPDATA%\ExamGuard\                   (Electron userData, student user)
  queue/<examId>.jsonl                 encrypted (safeStorage) pending saves/events
  session/<examId>.json                encrypted: token, server addr, pinned fp, selected languages, buffers
%LOCALAPPDATA%\ExamGuard\run\<examStudentId>\
  <questionId>\<lang>\                 code-run folder (wiped per run and at exam end)
  workspace\                           project folder: cwd of the terminal and of Run, the Files panel's root; node_modules, site-packages, .msys\ (pacman root); kept between runs
  .examguard\                          bin\ shims, pacman.conf, gnupg\ keyring copy (ExamGuard's, not the student's)
  .examguard\exam-files\               the teacher's files while they wait for the exam to start: <fileId>, revealed.json (ids already copied into workspace\)
%ProgramData%\ExamGuard\buffer\<examId>\  agent evidence buffer (SYSTEM-only, AES-GCM)
%ProgramData%\ExamGuard\agent.log
```
