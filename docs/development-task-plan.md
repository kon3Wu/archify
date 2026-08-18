# Development Task Plan

| Task | Scope | Branch | Base | Dependency | Status |
| --- | --- | --- | --- | --- | --- |
| BF-001 | Add the standard `business-flow` diagram type while preserving existing diagram types | `codex/bf-001-standard-business-flow` | `main` | `none` | Completed |
| BF-002 | Remove the duplicate top border rendered on `data-store` business-flow nodes | `codex/bf-002-data-store-top-border` | `codex/bf-001-standard-business-flow` | `BF-001` | Completed |
| BF-003 | Make business-flow decision branch ports role-aware and configurable | `codex/bf-003-decision-branch-ports` | `codex/bf-002-data-store-top-border` | `BF-002` | Completed |
| BF-004 | Keep decision input routes attached only to the decision top port and prevent input-route spillover into branch nodes | `codex/bf-004-decision-input-routing` | `codex/bf-003-decision-branch-ports` | `BF-003` | Completed |
| BF-005 | Make generated Archify artifacts reader-facing Chinese while preserving technical identifiers and protocols | `codex/bf-005-chinese-generated-output` | `codex/bf-004-decision-input-routing` | `BF-004` | Completed |

Ponytail status: `ponytail` is unavailable in this environment (`Get-Command ponytail` returned no command; the BF-005 `$ponytail full` and `stop ponytail` attempts both returned not found), so Ponytail could not be enabled; implementation proceeded with the required scope and validation gates.
