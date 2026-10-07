# ADR-005: Programming in external IDEs with watched workspaces (no built-in editor)

**Status:** Accepted · **Date:** 2026-10-07

## Context
The product owner requires students to code in real IDEs (VS Code, Code::Blocks, Dev-C++), as in normal lab work, and wants IDE built-in AI (Copilot etc.) handled. A built-in editor + full-screen lockdown was offered as the most secure alternative and declined.

## Options
1. Built-in editor only (Monaco) with full-screen lockdown.
2. Both modes per exam.
3. **External IDEs only.**

## Decision
Option 3.
- ExamGuard creates a workspace folder per part and asks the Helper to launch the chosen IDE on it.
- **VS Code** is launched with an ExamGuard profile: `--user-data-dir` and `--extensions-dir` under `%ProgramData%\ExamGuard\vscode`, containing only allowlisted extensions (language support), and settings disabling telemetry/chat features. VS Code instances started outside this profile raise `IDE_LAUNCHED_OUTSIDE_PROFILE`.
- **Code::Blocks / Dev-C++** have no built-in AI; launched normally on the workspace.
- IDE AI handled by **prevent + detect**: network lock (cloud AI cannot work), clean profile, pre-check scan of extension folders and local AI servers, code-insertion burst detection.
- The agent snapshots workspace files continuously; the submission is the final snapshot. Grading always re-runs code on the server.

## Consequences
+ Realistic lab experience; students use familiar tools.
+ File history gives behavioural evidence (sudden insertions).
− No full-screen lockdown: security relies on allowlists, network lock and live view; documented honestly.
− Toolchains must be installed on client machines (checked in pre-check).
− Reading what an IDE AI suggests is not possible; we make it non-functional and detect attempts instead.
