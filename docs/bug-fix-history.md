# Bug Fix History


## 2026-08-18 11:41:39 - Business-flow data-store duplicate top border

**Bug**
The Update ledger data-store cylinder showed an extra border arc across its top ellipse.

**Root Cause**
The data-store renderer stroked the cylinder body path, whose first cubic segment already drew a top arc, and then stroked the full top ellipse separately.

**Changes**
Render the cylinder body path as fill-only, add a separate open path for the side and bottom outline, and keep one stroked top ellipse; add a focused SVG regression assertion.

**Validation**
Passed node --test test/business-flow.test.mjs, node --test test/gallery.test.mjs, node test/golden.mjs, render-output checking, four-viewport visual-check containment with light/dark captures, rebuilt ZIP package smoke without node_modules, and installed doctor/examples plus validate/render/preview/deliver and guide routing checks.

**Files Changed**
- archify/renderers/business-flow/render-business-flow.mjs
- archify/test/business-flow.test.mjs
- archify/examples/business-flow-standard-rendered.html
- docs/gallery.html
- docs/gallery/manifest.json
- docs/gallery/artifacts/refund-approval.business-flow.html
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.1440x900.dark.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.1440x900.light.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.2048x1320.dark.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.2048x1320.light.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.json
- archify.zip
- docs/development-task-plan.md

## 2026-08-18 12:23:15 - Business-flow decision branch ports

**Bug**
Decision nodes did not consistently reserve the top tip for input or provide configurable yes/no outputs at the diamond's semantic ports; branch fan-out and swapped yes/no positions could not be expressed reliably.

**Root Cause**
Decision edges reused rectangular side inference and automatic port spreading, so diamond tips and corners were treated like ordinary box edges and role semantics were not represented in the schema or renderer.

**Changes**
Added yes/no edge roles, schema and validator diagnostics, top-only decision inputs, role-aware default output ports, explicit fromSide overrides for swapped positions, multi-edge fan-out at real diamond points, and decision-aware orthogonal routing; updated proof examples, tests, docs, and generated package artifacts.

**Validation**
Passed node --test test/business-flow.test.mjs test/gallery.test.mjs (6/6), npm run check:validators, node test/golden.mjs, release identity, showcase validation and visual-check containment/captures, package smoke without node_modules, and installed-skill doctor/examples/validate/render/preview/deliver/guide checks. The full npm test completed 633 tests with 612 passed, 3 skipped, and 18 environment-related failures (Windows symlink permissions, temporary repository-root/case handling, and a pre-existing README showcase drift check).

**Files Changed**
- CHANGELOG.md
- README.md
- README_EN.md
- README_ZH.md
- ROADMAP.md
- archify.zip
- archify/SKILL.md
- archify/examples/refund-approval.business-flow.json
- archify/examples/standard-business-flow.business-flow.json
- archify/renderers/business-flow/render-business-flow.mjs
- archify/renderers/shared/generated-validators.mjs
- archify/schemas/business-flow.schema.json
- archify/test/business-flow.test.mjs
- docs/development-task-plan.md
- docs/gallery.html
- docs/gallery/artifacts/refund-approval.business-flow.html
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.1440x900.dark.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.1440x900.light.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.2048x1320.dark.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.2048x1320.light.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.json
- docs/gallery/manifest.json
- docs/gallery/sources/refund-approval.business-flow.json
- examples/business-flow-standard-rendered.html
- examples/business-flow-standard-rendered.visual-check.1440x900.dark.png
- examples/business-flow-standard-rendered.visual-check.1440x900.light.png
- examples/business-flow-standard-rendered.visual-check.2048x1320.dark.png
- examples/business-flow-standard-rendered.visual-check.2048x1320.light.png
- examples/business-flow-standard-rendered.visual-check.json

## 2026-08-18 13:58:50 - Business-flow decision input corridor spillover

**Bug**
In the Chinese refund approval proof, the line from 受理申请 to 资料完整? visually merged with the retry line from 补充资料, making it appear that 受理申请 also connected to 补充资料.

**Root Cause**
Both automatic decision inputs were forced through the same top approach height, and the authored retry via reused the primary input corridor at [760,334]; multiple valid edges therefore looked like one unintended branch before reaching the shared decision top tip.

**Changes**
Ranked automatic inputs per decision and staggered their top approach heights by 18px; kept the retry input on the right-side geometric channel at its separate height, removed the stale hard-coded retry via from the refund example, and added exact route regression assertions plus regenerated gallery, screenshots, and ZIP artifacts.

**Validation**
Passed node --test test/business-flow.test.mjs test/gallery.test.mjs (6/6), npm run check:validators, node test/golden.mjs, release identity, business-flow showcase validate with 9/9 checks, visual-check containment at 1440x900/1600x1000/1920x1080/2048x1320 with light/dark captures, source and ZIP package smoke without node_modules, and installed-skill doctor/examples/validate/render/deliver. The focused first routing attempt was rejected by the existing proper-crossing gate and was corrected before final validation.

**Files Changed**
- archify.zip
- archify/examples/refund-approval.business-flow.json
- archify/renderers/business-flow/render-business-flow.mjs
- archify/test/business-flow.test.mjs
- docs/development-task-plan.md
- docs/gallery.html
- docs/gallery/artifacts/refund-approval.business-flow.html
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.1440x900.dark.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.1440x900.light.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.2048x1320.dark.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.2048x1320.light.png
- docs/gallery/artifacts/refund-approval.business-flow.visual-check.json
- docs/gallery/manifest.json
- docs/gallery/sources/refund-approval.business-flow.json

## 2026-08-19 14:53:16 - Lifecycle directional endpoint routing

**Bug**
Lifecycle transitions could leave left/right source ports vertically, enter lower targets from the side, or appear as unidentified rail fragments; forcing a lower target to its top port also exposed a diagonal final segment in an authored `via` route.

**Root Cause**
The lifecycle renderer used a cross-lane midpoint channel without enforcing endpoint direction, kept authored route endpoints unchanged when their target port moved, and rendered the primary lifecycle rail as one anonymous background path.

**Changes**
Added deterministic orthogonal endpoint routing, lifecycle-specific top entry for every lower target, endpoint bend correction that preserves authored middle `via` points, horizontal direct routing for aligned states, obstacle-aware conservative fallback channels, and identifiable orthogonal rail segments with a v1-compatible fallback.

**Validation**
Passed the focused lifecycle, geometry, and v1 compatibility suite (84/84), official lifecycle showcase validation (9/9), Gallery source/artifact consistency, Golden renders, and the complete `npm test` suite (642 tests: 623 passed, 19 environment skips, 0 failed). The refreshed Chinese lifecycle deliverable also passed atomic delivery validation (9/9). Ponytail enable/stop commands were attempted but are unavailable in this Windows environment.

**Files Changed**
- archify/renderers/lifecycle/render-lifecycle.mjs
- archify/renderers/shared/geometry.mjs
- archify/test/automatic-port-spread.test.mjs
- archify/examples/lifecycle-agent-run.html
- examples/lifecycle-agent-run.html
- docs/gallery.html
- docs/gallery/manifest.json
- docs/gallery/artifacts/agent-run.lifecycle.html
- docs/gallery/artifacts/deployment-release.lifecycle.html
- docs/development-task-plan.md

## 2026-08-19 15:44:59 - BF-007 生命周期四向端口法线与反向同轴路由

**Bug**
生命周期关系在目标节点位于源节点下方时可能未从目标顶部进入；源节点使用 bottom 端口时，连线也可能未先竖直向下，部分显式路径还会产生未连接视觉短线或同轴折返。

**Root Cause**
生命周期端点补正只完整约束了左右源端口与部分目标端口；对 top/bottom 源端口和反向同轴端点，补入法线短段后会直接连接反方向路径点，形成 U-turn，且示例 via 未显式保留正确的端点接近段。

**Changes**
统一校正四向源/目标端口法线；当目标在正后方同轴位置时使用正交水平偏移通道，保留 authored via 的中间语义点并禁止相邻同轴反向；更新 agent-run 生命周期示例、golden 与 Gallery 产物，重建并安装自包含 ZIP。

**Validation**
BF-007 DELTA 3/3；automatic-port-spread 25/25；v1 compatibility 12/12；lifecycle showcase 9/9 且 0 error/0 warning；完整 npm test 646 项、627 passed、19 Windows symlink skips、0 failed；ZIP 无 node_modules package smoke 通过；安装后 doctor/examples 通过并 deliver lifecycle 9/9。最终路径 execution-failed=343,157→320,157→320,345→402,345→402,356；approval-cancelled=402,336→402,352→480,352→480,432→402,432→402,450。

**Files Changed**
- archify/examples/agent-run.lifecycle.json
- archify/examples/lifecycle-agent-run.html
- archify/renderers/lifecycle/render-lifecycle.mjs
- archify/test/automatic-port-spread.test.mjs
- docs/development-task-plan.md
- docs/gallery.html
- docs/gallery/artifacts/agent-run.lifecycle.html
- docs/gallery/manifest.json
- docs/gallery/sources/agent-run.lifecycle.json
- examples/lifecycle-agent-run.html
- tests/e2e/bf007/manifest.json
- archify.zip
