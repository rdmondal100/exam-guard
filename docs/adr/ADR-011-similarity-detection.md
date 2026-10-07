# ADR-011: Similarity detection with normalized-token winnowing

**Status:** Accepted · **Date:** 2026-10-07

## Context
Students sitting together may copy code line by line and rename variables. Teachers may give the same paper to everyone or use pools/sets; similarity must compare only students who answered the same question.

## Options
1. Plain text diff — defeated by renaming/reformatting.
2. AST/tree edit distance — strongest, but needs full parsers for five languages; expensive O(n²) per pair.
3. **Token-based winnowing (MOSS family):** language lexer → normalize identifiers to `ID`, literals to `NUM`/`STR`, drop comments/whitespace → k-gram hashes → winnowing fingerprints → similarity = |A∩B| / min(|A|,|B|); matched fingerprints map back to line ranges for side-by-side display.
4. Embedding similarity via AI — opaque, unreliable for code.

## Decision
Option 3 for code (tokenizers per language via a lightweight lexer; tree-sitter optional later), shingled normalized text for theory answers. Thresholds configurable (defaults 0.80 code, 0.70 text). Reference solution and starter code fingerprints are excluded so common boilerplate does not count. Results shown as a ranked pair list and clusters.

## Consequences
+ Robust to renaming, reformatting, comment changes; explainable via highlighted matches; O(n) fingerprinting + set intersections.
− Reordering of large blocks lowers scores somewhat; structural rewrites evade it — acceptable; teacher sees the evidence.
− Short solutions naturally look similar; mitigated by minimum-length thresholds and boilerplate exclusion.
