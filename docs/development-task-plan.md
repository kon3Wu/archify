# Development Task Plan

| Task | Scope | Branch | Base | Dependency | Status |
| --- | --- | --- | --- | --- | --- |
| BF-001 | Add the standard `business-flow` diagram type while preserving existing diagram types | `codex/bf-001-standard-business-flow` | `main` | `none` | Completed |
| BF-002 | Remove the duplicate top border rendered on `data-store` business-flow nodes | `codex/bf-002-data-store-top-border` | `codex/bf-001-standard-business-flow` | `BF-001` | Completed |
| BF-003 | Make business-flow decision branch ports role-aware and configurable | `codex/bf-003-decision-branch-ports` | `codex/bf-002-data-store-top-border` | `BF-002` | Completed |
| BF-004 | Keep decision input routes attached only to the decision top port and prevent input-route spillover into branch nodes | `codex/bf-004-decision-input-routing` | `codex/bf-003-decision-branch-ports` | `BF-003` | Completed |
| BF-005 | Make generated Archify artifacts reader-facing Chinese while preserving technical identifiers and protocols | `codex/bf-005-chinese-generated-output` | `codex/bf-004-decision-input-routing` | `BF-004` | Completed |
| BF-006 | Enforce directional edge routing: horizontal departure from left/right source ports, direct horizontal routing for aligned endpoints, and top-only entry when the target is below | `codex/bf-006-directional-edge-routing` | `codex/bf-005-chinese-generated-output` | `BF-005` | Completed (E2E_PASS) |
| BF-007 | Enforce four-side lifecycle endpoint normals: bottom/top sources depart vertically, lower targets enter from the top, and authored routes avoid immediate endpoint backtracking | `codex/bf-007-four-side-endpoint-routing` | `codex/bf-006-directional-edge-routing` | `BF-006` | Completed (E2E_PASS) |

Ponytail status: `ponytail` is unavailable in this environment (`Get-Command ponytail` returned no command; the BF-005 `$ponytail full` and `stop ponytail` attempts both returned not found), so Ponytail could not be enabled; implementation proceeded with the required scope and validation gates.

## Active work packages

| Task/WP ID | Outcome | Base | Local branch | Acceptance | Validation | Audit/E2E | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| BF-008 | Add explicit adaptive horizontal/vertical Business Flow layouts while preserving undeclared legacy layout | `ca4b5a0` / `codex/bf-007-four-side-endpoint-routing` | `codex/bf-008-adaptive-directional-layout` | PRD AC-01–AC-13 | Focused Business Flow tests, validator drift check, affected regression and golden compatibility | Independent consistency re-audit + scripted DELTA E2E at `tests/e2e/bf008` | E2E_PASS |
