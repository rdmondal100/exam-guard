# ADR-001: Monorepo with pnpm workspaces and a Cargo workspace

**Status:** Accepted · **Date:** 2026-10-07

## Context
A solo developer builds four deployables (desktop, server/worker, sandbox runner, Rust agent) that share contracts: API DTOs, WebSocket protocol, security-event catalogue, policy rules. Contract drift between client and server is a common source of bugs.

## Options
1. **Monorepo** — pnpm workspaces for TypeScript, Cargo workspace for Rust, one CI.
2. Multi-repo — separate repos per component, published shared package.

## Decision
Option 1. Layout in ARCHITECTURE §4. Shared contracts live in `packages/shared`; pure domain logic in `packages/policy` and `packages/grading-core`. The Rust agent mirrors the protocol types in `agent/core`; a JSON-schema export from `packages/shared` is used in Rust tests to detect drift.

## Consequences
+ One commit can change contract and both sides; one CI pipeline; easy to demonstrate.
+ Pure packages are testable without I/O.
− Two toolchains (Node, Rust) in CI; Rust job runs on `windows-latest`.
