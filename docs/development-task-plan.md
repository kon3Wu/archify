# Development Task Plan

| Task | Scope | Branch | Base | Dependency | Status |
| --- | --- | --- | --- | --- | --- |
| BF-001 | Add the standard `business-flow` diagram type while preserving existing diagram types | `codex/bf-001-standard-business-flow` | `main` | `none` | Completed |
| BF-002 | Remove the duplicate top border rendered on `data-store` business-flow nodes | `codex/bf-002-data-store-top-border` | `codex/bf-001-standard-business-flow` | `BF-001` | Completed |

Ponytail status: `ponytail` is unavailable in this environment (`Get-Command ponytail` returned no command), so `$ponytail full` could not be enabled; implementation continues with the required scope and validation gates.
