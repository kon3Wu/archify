# BF-008 Technical Delta — Adaptive Directional Business Flow Layout

## Decision

| Item | Decision |
| --- | --- |
| Change route | `STANDARD` |
| Reason | One bounded feature inside the existing Business Flow renderer. It adds an opt-in input-contract field and a constrained layout path, without persistence, authorization, external integrations, destructive data handling, or a breaking legacy default. |
| PRD | `UPDATE_DELTA` — v0.2 freezes legacy preservation and explicit opt-in behavior. |
| Architecture | `VERIFY_NO_CHANGE` — the existing JSON IR → typed renderer → verified artifact boundary remains authoritative. |
| Domain model | `SKIP` — no business identity, ownership, lifecycle, persistence, or event model changes. |
| Input contract | `UPDATE_DELTA` — Business Flow gains an optional explicit layout direction and adaptive nodes no longer require authored grid coordinates. |
| UI field/prototype | `SKIP` — no editor or viewer control is added. |
| Development plan | `UPDATE_DELTA` — one BF-008 Work Package. |
| Formal test suite | `UPDATE_DELTA` — add a scripted `DELTA` E2E for legacy, adaptive horizontal, adaptive vertical, and invalid forward cycles. |

## Work Package Brief

- ID: BF-008
- Outcome: authors can explicitly render deterministic adaptive horizontal or vertical Business Flow diagrams, while every input without the new direction field retains the existing fixed-grid output path.
- Base: `ca4b5a0` on `codex/bf-007-four-side-endpoint-routing`.
- Branch: `codex/bf-008-adaptive-directional-layout`.
- Target platform: local Node.js CLI and generated HTML/SVG artifacts; minimum runtime remains Node.js 18.
- In scope: Business Flow schema, validator, renderer layout/routing, focused tests, examples/documentation required by the contract, and BF-008 DELTA E2E.
- Out of scope: other diagram types, a generic graph-layout engine, viewer direction controls, drag/drop editing, BPMN expansion, deployment, push, release, or production writes.
- Hard dependency: BF-007 base behavior and existing shared geometry/viewer contracts.
- Acceptance: PRD AC-01 through AC-13.
- Focused validation: `node --test test/business-flow.test.mjs` from `archify/`.
- Affected validation: generated-validator drift check, Business Flow CLI tests, golden compatibility, and the smallest affected regression set identified by the implementation diff.
- Audit: main-agent requirement/diff review; the additive shared input schema triggers an independent read-only consistency audit before formal E2E.
- Formal E2E: `tests/e2e/bf008/manifest.json` and runner/replay command defined during the test-design stage.
- Rollback: remove the explicit adaptive direction from new inputs to return to the byte-stable legacy path; reverting BF-008 removes the additive contract without migrating stored data.

## Frozen input and compatibility contract

1. Add one optional Business Flow layout-direction setting with exactly `horizontal` and `vertical` values. The implementation name is `meta.layout_direction`.
2. Absence of `meta.layout_direction` selects the existing renderer path without altering legacy node placement, routes, viewBox calculation, or output bytes covered by golden tests.
3. Presence of either allowed value selects the adaptive renderer path.
4. Legacy inputs continue to require and consume authored `row` and `col`; adaptive inputs derive chronological slots from edges and do not consume `row`, `col`, or `yOffset` as placement authority.
5. In adaptive inputs, `row`, `col`, and `yOffset` are rejected with an actionable diagnostic rather than silently ignored.
6. The schema permits adaptive nodes without authored grid coordinates; semantic validation enforces the legacy/adaptive conditional contract.

## Constrained layout design

1. Treat every edge except `role: "return"` as a forward ordering constraint. A forward edge `A → B` requires B to occupy a later slot than A.
2. Reject a cycle in the forward graph and report the involved node or edge identities. Return edges are routed but excluded from the ordering graph.
3. Use a stable topological traversal ordered by node declaration index. For each node, choose the earliest slot after all assigned forward predecessors and after the last occupied slot in the same lane.
4. Different lanes may share a slot. The per-lane next-slot rule guarantees at most one node per lane and slot while propagating any shift into downstream placement.
5. Preserve lane declaration order. Horizontal adaptive layout renders lanes top-to-bottom and slots left-to-right. Vertical adaptive layout renders lanes left-to-right and slots top-to-bottom.
6. Derive the shared flow-axis extent from the largest occupied slot plus node, route, label, legend, and margin requirements. Derive each lane's cross-axis thickness from its content. Explicit `meta.viewBox` is a minimum, never a clipping boundary, in adaptive mode.
7. Forward default ports follow the time axis: right→left for horizontal and bottom→top for vertical. Authored sides remain valid when they honor endpoint normals and quality gates. Return routes use an outer channel appropriate to the selected orientation.
8. Reuse existing node shapes, semantic identities, legend, viewer, export, diagnostics, and shared geometry quality gates. Do not introduce a general-purpose layout dependency.

## Behavior trace

| Accepted behavior | Implementation surface | Focused evidence |
| --- | --- | --- |
| Legacy inputs retain existing layout | Direction dispatch before current fixed-grid calculations | Golden byte/fixture comparison and AC-01 |
| Explicit horizontal/vertical layouts | Schema, adaptive metrics, orientation-aware placement and routing | Business Flow focused tests for AC-02–AC-09 |
| Forward topology determines order | Stable topological slot assignment | Branch, merge, parallel-lane, same-lane and return tests |
| Invalid direction/cycle fails closed | Schema and semantic diagnostics | AC-10 and AC-11 diagnostics |
| All outputs consume one verified geometry | Renderer/CLI/artifact checks | AC-12 DELTA E2E |
| Repeated input is deterministic | Stable declaration-index tie breaking | AC-13 repeated render comparison |

## Risk triggers

- Upgrade to `CRITICAL` if implementation evidence shows that preserving legacy output requires a breaking schema version, migration, or non-reversible compatibility change.
- Stop and re-plan if shared geometry changes alter non-Business-Flow diagram outputs.
- Do not weaken Clean Flow, endpoint, crossing, corridor, label-clearance, or artifact containment gates to make adaptive examples pass.

## Delivery evidence

- Independent consistency re-audit: `PASS`, 100/100, with AC-01 through AC-13 covered and no evidence-backed Blocker, High, Medium, or Low findings.
- Scripted DELTA replay: `node tests/e2e/bf008/run.mjs` — 4/4 BF-008 cases passed and 3/3 impacted regression commands passed.
- Focused Business Flow suite: 13/13 tests passed.
- Legacy artifact compatibility: byte-identical SHA-256 `79eda392a8136e5ebb00b042a2e885471fbafee1ebaa781249389d23fad11f9f`.
- Machine-readable evidence: `artifacts/bf008/e2e/summary.json`; detailed command log: `artifacts/bf008/e2e/commands.json`.
- Boundary: this is a local CLI/generated-HTML DELTA result, not a release-level Go/No-Go or production deployment claim.
