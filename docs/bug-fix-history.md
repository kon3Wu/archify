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
