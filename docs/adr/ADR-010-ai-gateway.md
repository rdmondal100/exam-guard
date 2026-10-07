# ADR-010: Provider-agnostic AI gateway, local-first

**Status:** Accepted · **Date:** 2026-10-07 · **Supersedes:** v1 ADR-003

## Context
AI assists theory grading, method marks, partial code credit and special-casing review. Exam data is sensitive; the server may have no GPU and no internet.

## Decision
- `AiProvider` interface: `evaluate(request: EvalRequest) → EvalResult` (structured, schema-validated). Implementations: **Ollama (default)**, Gemini, OpenAI, Mock.
- Model configured by Admin (e.g. a 7–8B instruct/coder model on a GPU host, a 3–4B model on CPU-only laptops — final choice benchmarked in Phase 9).
- External providers gated by Admin global allow + kill switch + per-exam opt-in; redaction removes identities and paths; every call logged.
- Prompts are versioned templates in the repo; student content is delimited data; outputs clamped; injection detector routes to review.
- Grading is asynchronous, so slow local models delay results but never block exams.

## Consequences
+ Works fully offline; provider swap without code changes; deterministic tests with Mock.
− Local model quality is lower than frontier cloud models; offset by deterministic evidence and teacher review.
