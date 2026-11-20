# ExamGuard AI

A Windows desktop platform for running, monitoring and AI-grading programming exams in a university computer lab. The teacher's PC hosts the exam over the lab network; students write and run code in a built-in editor; everything they do outside the exam is recorded as evidence; Gemini grades the answers and the teacher reviews and finalizes them.

**Start here:** [docs/guide/ExamGuard-Project-Guide.md](docs/guide/ExamGuard-Project-Guide.md) (also as [PDF](docs/guide/ExamGuard-Project-Guide.pdf)): what the app does, a full exam walkthrough with screenshots, architecture, tech stack and a tour of the code.

## Quick start

```bash
pnpm install
pnpm fetch-toolchains   # once, for running student code
pnpm dev:teacher        # the Teacher app
pnpm dev:student        # the Student app (joins 127.0.0.1 on the same PC)
pnpm test               # all tests
```

## Repository

| Path | What |
|---|---|
| `apps/desktop` | Both Electron apps (Teacher and Student) from one codebase |
| `apps/server` | The exam server (Express 5 + ws + SQLite), runs inside the Teacher app |
| `packages/shared` | Zod schemas and types for every message |
| `tools/student-sim` | Load test with up to 200 simulated students |
| `docs/` | Requirements, architecture, protocol, data model, decisions, lab IT notes |

`requirements.md` is the source of truth for the product.
