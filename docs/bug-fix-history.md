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
