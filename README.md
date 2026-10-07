# ExamGuard

A secure Windows desktop platform for invigilated university lab exams — CSE final-year project.

ExamGuard lets a teacher run programming and technical exams in a lab (or on students' laptops in the same room), **prevents and detects cheating** (internet/ChatGPT, IDE built-in AI, unauthorized apps, copying), shows the teacher **live alerts with screenshot evidence and on-demand live screen view**, and grades answers with an **explainable hybrid engine**: reference-solution-driven tests, AI-assisted marking points, similarity detection and teacher review.

## Components
| Component | Tech |
|---|---|
| Desktop app (Admin / Teacher / Student) | Electron · React · TypeScript |
| Server & workers | Node.js · Fastify · Prisma · PostgreSQL · Redis/BullMQ |
| Security agent (Windows Service + Helper) | Rust |
| Code sandbox | Docker (C, C++, Python, Java, JavaScript) |
| AI | Ollama (default, local) · Gemini / OpenAI (opt-in) |

## Documentation
| Document | Purpose |
|---|---|
| [docs/DISCOVERY_NOTES.md](docs/DISCOVERY_NOTES.md) | Requirement discovery: decisions and rationale |
| [docs/PRD.md](docs/PRD.md) | Product requirements |
| [docs/SRS.md](docs/SRS.md) | Detailed, testable software requirements |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture |
| [docs/adr/](docs/adr/) | Architecture decision records |
| [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md) | Threats, mitigations, honest capability statement |
| [docs/RISK_REGISTER.md](docs/RISK_REGISTER.md) | Project risks |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Phased delivery plan |

## Status
Phase 0 — requirements and design. See the roadmap for what comes next.
