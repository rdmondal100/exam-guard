# ADR-004: Rule-based policy engine, server-authoritative with agent fast-path

**Status:** Accepted · **Date:** 2026-10-07

## Context
Security decisions must be explainable, configurable per exam and not dependent on AI. Some actions (killing a browser) must happen within a second, which a server round-trip on Wi-Fi may not guarantee.

## Options
1. AI/anomaly-based decisions — opaque, hard to defend.
2. Hard-coded checks in the agent — inflexible, not per-exam.
3. **Declarative rules evaluated by a pure engine on the server**, with a subset of BLOCK rules pushed to the agent for immediate local enforcement.

## Decision
Option 3. `packages/policy` is a pure library: `evaluate(event, sessionContext, rules) → {decision, actions, ruleId, severity}`. Rule features: event-type match, attribute predicates, sliding-window thresholds, escalation, device-trust variants. Profiles `STANDARD`, `STRICT`, `LENIENT` (SRS §6), customizable per exam. At session start the server sends the agent a **policy bundle** (block/allow lists, fast-path rules); the agent enforces and reports `actionTaken`; the server records the authoritative decision.

## Consequences
+ Deterministic, unit-testable, explainable ("rule R-BROWSER-01 matched chrome.exe → BLOCK").
+ Teachers tune strictness without code.
− Rule language must stay small; complex behaviour analysis is out of scope.
