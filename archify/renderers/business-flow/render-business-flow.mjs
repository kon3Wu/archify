import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { esc, renderDefinitions, textUnits } from '../shared/utils.mjs';
import {
  animateAttr,
  focusEdgeAttrs,
  focusNodeAttrs,
  focusNodeTitle,
  loadDiagram,
  writeDiagram,
  svgAccessibleText,
  svgRootAttrs,
} from '../shared/cli.mjs';
import { throwDiagnosticError } from '../shared/diagnostics.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend, legendFootprint, relationshipLegendObstacles } from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  cleanEndpointSideProblems,
  cleanFlowProblems,
  cleanCrossingProblems,
  cleanAmbiguousCorridorProblems,
  cleanBorderRunProblems,
  cleanRouteRhythmProblems,
  cleanLabelRouteClearanceProblems,
  suggestLabelObstacleFix,
  suggestLabelPairFix,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  routeHonorsEndpointSides,
  polylinePath,
  routePointsValue,
  labelPoint,
  arrowClassMap,
  variantAccent,
} from '../shared/geometry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: businessFlow, template, outPath } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'business-flow',
  defaultExample: 'standard-business-flow.business-flow.json',
});

const KINDS = [
  'start',
  'end',
  'process',
  'decision',
  'data-store',
  'document',
  'manual-input',
  'subprocess',
  'external',
];

const KIND_DIMENSIONS = {
  start: [120, 64],
  end: [120, 64],
  process: [128, 64],
  decision: [136, 64],
  'data-store': [132, 64],
  document: [132, 64],
  'manual-input': [136, 64],
  subprocess: [140, 64],
  external: [132, 64],
};

const KIND_FILL = {
  start: 'c-frontend',
  end: 'c-database',
  process: 'c-backend',
  decision: 'c-security',
  'data-store': 'c-database',
  document: 'c-cloud',
  'manual-input': 'c-frontend',
  subprocess: 'c-backend',
  external: 'c-external',
};

const DECISION_OUTPUT_SIDES = new Set(['left', 'right', 'bottom']);
const DECISION_BRANCH_ROLES = new Set(['yes', 'no']);
const DECISION_ROUTE_GAP = 16;
const DECISION_INPUT_STAGGER = 18;

const layout = {
  laneX: 48,
  laneY: 70,
  laneW: 1284,
  laneTitleH: 28,
  rowPadTop: 18,
  rowPadBottom: 20,
  rowGap: 88,
  laneGap: 16,
  colXs: [120, 280, 440, 600, 760, 920, 1080, 1240],
  margin: 48,
};

const rawLanes = Array.isArray(businessFlow.lanes) && businessFlow.lanes.length
  ? businessFlow.lanes
  : [{ id: 'main', label: '业务流程' }];
const laneIds = new Set(rawLanes.map((lane) => lane.id));
const sourceNodes = asArray(businessFlow.nodes);
const sourceEdges = asArray(businessFlow.edges);

const maxRowsByLane = new Map(rawLanes.map((lane) => [lane.id, 0]));
for (const node of sourceNodes) {
  const laneId = node.lane || rawLanes[0].id;
  if (!laneIds.has(laneId)) continue;
  const row = Number.isInteger(node.row) && node.row >= 0 ? node.row : 0;
  maxRowsByLane.set(laneId, Math.max(maxRowsByLane.get(laneId) || 0, row));
}

function laneHeight(laneId) {
  const maxRow = maxRowsByLane.get(laneId) || 0;
  const maxNodeHeight = sourceNodes
    .filter((node) => (node.lane || rawLanes[0].id) === laneId)
    .reduce((height, node) => Math.max(height, Number.isFinite(node.height)
      ? node.height
      : (KIND_DIMENSIONS[node.kind]?.[1] || 64)), 64);
  return layout.laneTitleH + layout.rowPadTop + maxRow * layout.rowGap + maxNodeHeight + layout.rowPadBottom;
}

const laneMetrics = new Map();
let laneCursor = layout.laneY;
for (const lane of rawLanes) {
  const height = laneHeight(lane.id);
  laneMetrics.set(lane.id, { ...lane, index: laneMetrics.size, y: laneCursor, height });
  laneCursor += height + layout.laneGap;
}

function laneTop(laneId) {
  return laneMetrics.get(laneId)?.y ?? layout.laneY;
}

function laneBottom(laneId) {
  const metric = laneMetrics.get(laneId);
  return metric ? metric.y + metric.height : layout.laneY + laneHeight(rawLanes[0].id);
}

function lastLaneBottom() {
  return rawLanes.length ? laneBottom(rawLanes.at(-1).id) : layout.laneY + laneHeight('main');
}

const BUSINESS_LEGEND_CATALOG = [
  ['start', '开始'],
  ['end', '结束'],
  ['process', '处理'],
  ['decision', '决策'],
  ['data-store', '数据存储'],
  ['document', '文档'],
  ['manual-input', '手动输入'],
  ['subprocess', '子流程'],
  ['external', '外部系统'],
].map(([kind, label]) => ({ kind, label, swatchWidth: 20 }));

const legendEntries = resolveLegend(
  businessFlow.meta?.legend,
  BUSINESS_LEGEND_CATALOG,
  new Set(sourceNodes.map((node) => node.kind)),
);

function autoViewBox() {
  const width = layout.laneX + layout.laneW + layout.margin;
  const footprint = legendFootprint(legendEntries, { width: Math.max(1, width - layout.margin * 2) });
  return [
    Math.max(1380, width),
    Math.ceil(lastLaneBottom() + 72 + footprint.extraHeight),
  ];
}

const viewBox = businessFlow.meta?.viewBox || autoViewBox();

function legendY() {
  return viewBox[1] - 16;
}

function dimensionsFor(node) {
  const [defaultWidth, defaultHeight] = KIND_DIMENSIONS[node.kind] || KIND_DIMENSIONS.process;
  return {
    width: node.width || defaultWidth,
    height: node.height || defaultHeight,
  };
}

function measureNode(node) {
  const { width, height } = dimensionsFor(node);
  const metric = laneMetrics.get(node.lane) || laneMetrics.get(rawLanes[0].id);
  const col = Number.isInteger(node.col) && node.col >= 0 && node.col < layout.colXs.length ? node.col : 0;
  const row = Number.isInteger(node.row) && node.row >= 0 ? node.row : 0;
  const cx = layout.colXs[col];
  const y = (metric?.y ?? layout.laneY)
    + layout.laneTitleH
    + layout.rowPadTop
    + row * layout.rowGap
    + (node.yOffset || 0);
  return {
    ...node,
    lane: node.lane || rawLanes[0].id,
    width,
    height,
    x: cx - width / 2,
    y,
    cx,
    cy: y + height / 2,
  };
}

const nodes = new Map(sourceNodes.map((node) => [node.id, measureNode(node)]));
const mainPathSteps = new Map(asArray(businessFlow.mainPath).map((id, index) => [id, index]));
const edgeSteps = new Map(sourceEdges.map((edge, index) => {
  const fromStep = mainPathSteps.get(edge.from);
  const toStep = mainPathSteps.get(edge.to);
  const mainStep = Number.isInteger(fromStep) && toStep === fromStep + 1 ? fromStep : null;
  return [edge, mainStep ?? asArray(businessFlow.mainPath).length + index];
}));

const decisionInputRanks = new Map();
const decisionInputGroups = new Map();
for (const edge of sourceEdges) {
  const target = nodes.get(edge.to);
  if (target?.kind !== 'decision') continue;
  const group = decisionInputGroups.get(target.id) || [];
  group.push(edge);
  decisionInputGroups.set(target.id, group);
}
for (const group of decisionInputGroups.values()) {
  group.sort((left, right) => {
    const leftNode = nodes.get(left.from);
    const rightNode = nodes.get(right.from);
    if (leftNode?.cx !== rightNode?.cx) return (leftNode?.cx ?? 0) - (rightNode?.cx ?? 0);
    return `${left.id || ''}\u0000${left.from}\u0000${left.to}`.localeCompare(`${right.id || ''}\u0000${right.from}\u0000${right.to}`);
  });
  group.forEach((edge, index) => decisionInputRanks.set(edge, index));
}

function nodeStep(node) {
  return mainPathSteps.get(node.id)
    ?? asArray(businessFlow.mainPath).length + sourceNodes.findIndex((item) => item.id === node.id);
}

function nodeContext(node) {
  return laneMetrics.get(node.lane)?.label || '业务流程节点';
}

function problem(code, message, subject = {}, evidence = {}, supportedFixes = []) {
  return { code, severity: 'error', message, subject, evidence, supportedFixes };
}

function failProblems(prefix, problems) {
  if (!problems.length) return;
  const diagnostics = problems.map((entry) => typeof entry === 'string'
    ? problem('business-flow/layout-constraint', entry, { diagramType: 'business-flow' })
    : entry);
  throwDiagnosticError(
    `${prefix}:\n- ${diagnostics.map((entry) => entry.message).join('\n- ')}`,
    diagnostics,
  );
}

function validateBusinessFlow() {
  const problems = [];
  if (businessFlow.schema_version !== 1) {
    problems.push(problem('business-flow/schema-version', 'Business-flow files must set "schema_version": 1.'));
  }
  if (businessFlow.diagram_type !== 'business-flow') {
    problems.push(problem('business-flow/type', `Unsupported diagram_type "${businessFlow.diagram_type}". Expected "business-flow".`));
  }
  if (!businessFlow.meta?.title) {
    problems.push(problem('business-flow/title', 'Business-flow files must include meta.title.'));
  }
  if (!Array.isArray(businessFlow.nodes) || !businessFlow.nodes.length) {
    problems.push(problem('business-flow/nodes', 'Business-flow diagrams need at least one node.'));
  }
  if (!Array.isArray(businessFlow.edges)) {
    problems.push(problem('business-flow/edges', 'Business-flow diagrams must include an edges array.'));
  }
  if (businessFlow.lanes !== undefined && (!Array.isArray(businessFlow.lanes) || !businessFlow.lanes.length)) {
    problems.push(problem('business-flow/lanes', 'Business-flow lanes must contain at least one lane when provided.'));
  }
  if (businessFlow.mainPath !== undefined && !Array.isArray(businessFlow.mainPath)) {
    problems.push(problem('business-flow/main-path', 'Business-flow mainPath must be an array of node ids.'));
  }
  if (businessFlow.cards !== undefined && !Array.isArray(businessFlow.cards)) {
    problems.push(problem('business-flow/cards', 'Business-flow cards must be an array.'));
  }

  const allIds = new Map();
  const rememberId = (id, collection, index) => {
    if (!id) return;
    const previous = allIds.get(id);
    if (previous) {
      problems.push(problem(
        'business-flow/duplicate-id',
        `ID "${id}" is used by ${previous.collection}[${previous.index}] and ${collection}[${index}]. Node, edge, and lane ids must be globally unique.`,
        { diagramType: 'business-flow', collection, index, id },
        { previous },
        ['rename one of the duplicated node, edge, or lane ids'],
      ));
    } else {
      allIds.set(id, { collection, index });
    }
  };

  for (const [index, lane] of rawLanes.entries()) rememberId(lane.id, 'lanes', index);
  for (const [index, node] of sourceNodes.entries()) rememberId(node.id, 'nodes', index);
  for (const [index, edge] of sourceEdges.entries()) rememberId(edge.id, 'edges', index);

  const startNodes = [];
  const endNodes = [];
  const incoming = new Map(sourceNodes.map((node) => [node.id, []]));
  const outgoing = new Map(sourceNodes.map((node) => [node.id, []]));
  const multiLane = rawLanes.length > 1;

  for (const [index, node] of sourceNodes.entries()) {
    const measured = nodes.get(node.id);
    if (!KINDS.includes(node.kind)) {
      problems.push(problem('business-flow/unknown-kind', `Node "${node.id}" uses unsupported kind "${node.kind}".`, { diagramType: 'business-flow', collection: 'nodes', index, id: node.id }));
    }
    if (multiLane && !node.lane) {
      problems.push(problem('business-flow/lane-required', `Node "${node.id}" must specify lane because this business flow has multiple lanes.`, { diagramType: 'business-flow', collection: 'nodes', index, id: node.id }, {}, ['add the node lane id or reduce the diagram to one lane']));
    }
    if (node.lane && !laneIds.has(node.lane)) {
      problems.push(problem('business-flow/unknown-lane', `Node "${node.id}" uses unknown lane "${node.lane}".`, { diagramType: 'business-flow', collection: 'nodes', index, id: node.id }, { lane: node.lane }, ['reference an existing lane id']));
    }
    if (!Number.isInteger(node.row) || node.row < 0) {
      problems.push(problem('business-flow/row', `Node "${node.id}" must use a non-negative integer row.`, { diagramType: 'business-flow', collection: 'nodes', index, id: node.id }));
    }
    if (!Number.isInteger(node.col) || node.col < 0 || node.col >= layout.colXs.length) {
      problems.push(problem('business-flow/column', `Node "${node.id}" uses column ${node.col}; valid columns are integers 0..${layout.colXs.length - 1}.`, { diagramType: 'business-flow', collection: 'nodes', index, id: node.id }, { column: node.col }, ['move the node to the fixed left-to-right grid']));
    }
    if (!measured || !isFinitePoint(measured.x, measured.y, measured.cx, measured.cy, measured.width, measured.height)) {
      problems.push(problem('business-flow/non-finite-node', `Node "${node.id}" produced non-finite grid coordinates.`, { diagramType: 'business-flow', collection: 'nodes', index, id: node.id }));
      continue;
    }
    const labelAllowance = node.kind === 'decision' ? measured.width * 0.76 : measured.width - 18;
    const estimatedLabelWidth = textUnits(node.label) * 6.7;
    if (estimatedLabelWidth > labelAllowance) {
      problems.push(problem(
        'business-flow/text-overflow',
        `Label "${node.label}" (~${Math.round(estimatedLabelWidth)}px) does not fit node "${node.id}" (${Math.round(labelAllowance)}px usable width).`,
        { diagramType: 'business-flow', collection: 'nodes', index, id: node.id, field: 'label' },
        { measuredWidthPx: estimatedLabelWidth, usableWidthPx: labelAllowance, kind: node.kind },
        ['shorten the label or increase node.width'],
      ));
    }
    const availableTextW = availableNodeTextWidth(measured.width);
    for (const [field, value, minimum] of [
      ['sublabel', node.sublabel, 6],
      ['tag', node.tag, 6],
    ]) {
      if (!value) continue;
      const minimumW = minimumNodeTextWidth(value, minimum);
      if (minimumW > availableTextW) {
        problems.push(problem(
          'business-flow/text-overflow',
          `${field} "${value}" needs ~${Math.ceil(minimumW)}px at the ${minimum}px legible minimum, but node "${node.id}" provides ${availableTextW}px.`,
          { diagramType: 'business-flow', collection: 'nodes', index, id: node.id, field },
          { measuredWidthPx: minimumW, usableWidthPx: availableTextW },
          [`shorten the ${field} or increase node.width`],
        ));
      }
    }
    if (node.kind === 'start') startNodes.push(node.id);
    if (node.kind === 'end') endNodes.push(node.id);
  }

  if (!startNodes.length) problems.push(problem('business-flow/start-required', 'Business-flow diagrams need at least one start node.'));
  if (!endNodes.length) problems.push(problem('business-flow/end-required', 'Business-flow diagrams need at least one end node.'));

  for (const [index, edge] of sourceEdges.entries()) {
    if (!nodes.has(edge.from)) {
      problems.push(problem('business-flow/edge-reference', `Edge "${edge.id || `${edge.from}->${edge.to}`}" references unknown source "${edge.from}".`, { diagramType: 'business-flow', collection: 'edges', index, id: edge.id || undefined, field: 'from' }, { from: edge.from }, ['reference an existing node id']));
    } else {
      outgoing.get(edge.from).push(edge);
    }
    if (!nodes.has(edge.to)) {
      problems.push(problem('business-flow/edge-reference', `Edge "${edge.id || `${edge.from}->${edge.to}`}" references unknown target "${edge.to}".`, { diagramType: 'business-flow', collection: 'edges', index, id: edge.id || undefined, field: 'to' }, { to: edge.to }, ['reference an existing node id']));
    } else {
      incoming.get(edge.to).push(edge);
    }

    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (from?.kind === 'decision' && edge.fromSide === 'top') {
      problems.push(problem(
        'business-flow/decision-output-side',
        `Decision output edge "${edge.id || `${edge.from}->${edge.to}`}" cannot use the top side; the top tip is reserved for input.`,
        { diagramType: 'business-flow', collection: 'edges', index, id: edge.id || undefined, field: 'fromSide' },
        { fromSide: edge.fromSide, allowedSides: [...DECISION_OUTPUT_SIDES] },
        ['use fromSide "bottom", "left", or "right" for a decision output'],
      ));
    }
    if (to?.kind === 'decision' && edge.toSide && edge.toSide !== 'top') {
      problems.push(problem(
        'business-flow/decision-input-side',
        `Edge "${edge.id || `${edge.from}->${edge.to}`}" must enter decision "${to.id}" through its top tip.`,
        { diagramType: 'business-flow', collection: 'edges', index, id: edge.id || undefined, field: 'toSide' },
        { toSide: edge.toSide, requiredSide: 'top' },
        ['remove toSide or set toSide "top"'],
      ));
    }
  }

  for (const id of startNodes) {
    if (incoming.get(id)?.length) {
      problems.push(problem('business-flow/start-incoming', `Start node "${id}" must not have incoming edges.`, { diagramType: 'business-flow', collection: 'nodes', id }, { incoming: incoming.get(id).length }, ['remove incoming edges from the start node']));
    }
  }
  for (const id of endNodes) {
    if (outgoing.get(id)?.length) {
      problems.push(problem('business-flow/end-outgoing', `End node "${id}" must not have outgoing edges.`, { diagramType: 'business-flow', collection: 'nodes', id }, { outgoing: outgoing.get(id).length }, ['remove outgoing edges from the end node']));
    }
  }

  for (const node of sourceNodes.filter((candidate) => candidate.kind === 'decision')) {
    const edges = outgoing.get(node.id) || [];
    if (edges.length < 2) {
      problems.push(problem('business-flow/decision-branch-count', `Decision node "${node.id}" must have at least two outgoing edges.`, { diagramType: 'business-flow', collection: 'nodes', id: node.id }, { outgoing: edges.length }, ['add at least two decision outcomes']));
    }
    const labels = new Set();
    for (const edge of edges) {
      const label = typeof edge.label === 'string' ? edge.label.trim() : '';
      if (!label) {
        problems.push(problem('business-flow/decision-label', `Every outgoing edge from decision "${node.id}" must have a non-empty label.`, { diagramType: 'business-flow', collection: 'edges', id: edge.id || undefined, from: edge.from, to: edge.to }, {}, ['label every decision outcome']));
      } else if (labels.has(label)) {
        problems.push(problem('business-flow/decision-label-unique', `Decision "${node.id}" has duplicate outgoing label "${label}".`, { diagramType: 'business-flow', collection: 'edges', id: edge.id || undefined, from: edge.from, to: edge.to }, { label }, ['give each decision outcome a unique label']));
      }
      labels.add(label);
    }
  }

  const reachable = new Set(startNodes);
  const queue = [...startNodes];
  while (queue.length) {
    const current = queue.shift();
    for (const edge of outgoing.get(current) || []) {
      if (!reachable.has(edge.to) && nodes.has(edge.to)) {
        reachable.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  for (const node of sourceNodes) {
    if (!reachable.has(node.id)) {
      problems.push(problem('business-flow/unreachable-node', `Business node "${node.id}" is not reachable from any start node. Retry and return loops are allowed, but every node needs a start-origin path.`, { diagramType: 'business-flow', collection: 'nodes', id: node.id }, {}, ['add a path from a start node or remove the disconnected node']));
    }
  }

  const nodeList = [...nodes.values()];
  for (let left = 0; left < nodeList.length; left += 1) {
    for (let right = left + 1; right < nodeList.length; right += 1) {
      if (!rectsOverlap(nodeList[left], nodeList[right], 8)) continue;
      problems.push(problem(
        'business-flow/node-overlap',
        `Nodes "${nodeList[left].id}" and "${nodeList[right].id}" overlap or are less than 8px apart.`,
        { diagramType: 'business-flow', collection: 'nodes', id: nodeList[left].id },
        { otherNode: nodeList[right].id, gapPx: 8 },
        ['move one node to another row/column or reduce its size'],
      ));
    }
  }

  if (Array.isArray(businessFlow.mainPath)) {
    for (const [index, id] of businessFlow.mainPath.entries()) {
      if (!nodes.has(id)) problems.push(problem('business-flow/main-path-reference', `mainPath[${index}] references unknown node "${id}".`, { diagramType: 'business-flow', collection: 'mainPath', index }, { id }, ['reference an existing node id']));
    }
    for (let index = 0; index < businessFlow.mainPath.length - 1; index += 1) {
      const from = businessFlow.mainPath[index];
      const to = businessFlow.mainPath[index + 1];
      if (nodes.has(from) && nodes.has(to) && !sourceEdges.some((edge) => edge.from === from && edge.to === to)) {
        problems.push(problem('business-flow/main-path-edge', `mainPath step "${from}" -> "${to}" has no matching edge.`, { diagramType: 'business-flow', collection: 'mainPath', index }, {}, ['add the matching edge or remove this mainPath pair']));
      }
    }
  }

  const labelRects = [];
  for (const [index, edge] of sourceEdges.entries()) {
    if (!edge.label || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const [lx, ly] = labelPoint(edge, pathFor(edge).points);
    const width = Math.max(30, textUnits(edge.label) * 4.8 + 10);
    labelRects.push({ relation: edge, relationIndex: index, label: edge.label, x: lx - width / 2, y: ly - 10, width, height: 14, lx, ly });
  }
  for (const rect of labelRects) {
    for (const node of nodes.values()) {
      if (!rectsOverlap(rect, node, -2)) continue;
      problems.push(problem(
        'business-flow/label-obscures-node',
        `Label "${rect.label}" overlaps node "${node.id}". ${suggestLabelObstacleFix(rect, rect.lx, rect.ly, node, 'node')}`,
        { diagramType: 'business-flow', collection: 'edges', id: rect.relation.id || undefined },
        { label: rect.label, node: node.id, labelRect: rect },
        ['adjust labelAt, labelDx, labelDy, labelSegment, or the edge route'],
      ));
    }
  }
  for (let left = 0; left < labelRects.length; left += 1) {
    for (let right = left + 1; right < labelRects.length; right += 1) {
      if (!rectsOverlap(labelRects[left], labelRects[right], -2)) continue;
      problems.push(problem(
        'business-flow/label-overlap',
        `Labels "${labelRects[left].label}" and "${labelRects[right].label}" overlap. ${suggestLabelPairFix(labelRects[left], labelRects[right])}`,
        { diagramType: 'business-flow', collection: 'edges', id: labelRects[left].relation.id || undefined },
        { otherEdge: labelRects[right].relation.id || `${labelRects[right].relation.from}->${labelRects[right].relation.to}` },
        ['adjust labelAt, labelDx, labelDy, or labelSegment on one edge'],
      ));
    }
  }

  problems.push(...cleanEndpointSideProblems({
    relations: sourceEdges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'business-flow',
    relationCollection: 'edges',
    fromSideFor: (edge) => inferredAutoSide(edge, 'source'),
    toSideFor: (edge) => inferredAutoSide(edge, 'target'),
    routeHint: 'keep auto routing for shape-aware ports, or set truthful fromSide/toSide with perpendicular via segments',
  }));
  problems.push(...cleanFlowProblems({
    relations: sourceEdges,
    endpointIds: new Set(nodes.keys()),
    obstacles: nodes.values(),
    pathFor,
    diagramType: 'business-flow',
    relationCollection: 'edges',
    obstacleKind: 'node',
    profile: businessFlow.meta?.quality_profile,
    routeHint: 'adjust fromSide/toSide, set route/via/channel coordinates, or move the unrelated node',
  }));
  problems.push(...cleanCrossingProblems({
    relations: sourceEdges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'business-flow',
    relationCollection: 'edges',
    profile: businessFlow.meta?.quality_profile,
    routeHint: 'adjust route/via/channel coordinates so unrelated business edges use separate corridors',
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: sourceEdges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'business-flow',
    relationCollection: 'edges',
    profile: businessFlow.meta?.quality_profile,
    routeHint: 'adjust route/via/channel coordinates so unrelated business edges do not share a corridor',
  }));
  problems.push(...cleanBorderRunProblems({
    relations: sourceEdges,
    endpointIds: new Set(nodes.keys()),
    frames: compositionFrames(),
    pathFor,
    diagramType: 'business-flow',
    relationCollection: 'edges',
    profile: businessFlow.meta?.quality_profile,
    routeHint: 'route across a lane boundary perpendicularly instead of following its border',
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: sourceEdges,
    endpointIds: new Set(nodes.keys()),
    pathFor,
    diagramType: 'business-flow',
    relationCollection: 'edges',
    profile: businessFlow.meta?.quality_profile,
    routeHint: 'move route/via/channel points into a wider corridor so each turn has a readable run-up',
  }));

  for (const [index, node] of nodes.entries()) {
    if (node.x < 0 || node.y < 0 || node.x + node.width > viewBox[0] || node.y + node.height > viewBox[1]) {
      problems.push(problem('business-flow/viewport-overflow', `Node "${index}" exceeds the ${viewBox[0]}x${viewBox[1]} viewBox.`, { diagramType: 'business-flow', collection: 'nodes', id: index }, { x: node.x, y: node.y, width: node.width, height: node.height, viewBox }, ['increase meta.viewBox or move the node within the fixed grid']));
    }
  }
  for (const lane of rawLanes) {
    const metric = laneMetrics.get(lane.id);
    if (metric && (metric.y < 0 || metric.y + metric.height > viewBox[1])) {
      problems.push(problem('business-flow/viewport-overflow', `Lane "${lane.id}" exceeds the viewBox height.`, { diagramType: 'business-flow', collection: 'lanes', id: lane.id }, { lane: metric, viewBox }, ['increase meta.viewBox[1]']));
    }
  }
  for (const [index, edge] of sourceEdges.entries()) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const points = pathFor(edge).points;
    const outside = points.find((point) => point[0] < 0 || point[1] < 0 || point[0] > viewBox[0] || point[1] > viewBox[1]);
    if (outside) {
      problems.push(problem('business-flow/viewport-overflow', `Edge ${edge.id || `${edge.from}->${edge.to}`} leaves the viewBox at [${outside.join(', ')}].`, { diagramType: 'business-flow', collection: 'edges', index, id: edge.id || undefined }, { point: outside, viewBox }, ['move the route channel inside the viewBox or increase meta.viewBox']));
    }
  }
  if (viewBox[0] < layout.laneX + layout.laneW + 16) {
    problems.push(problem('business-flow/viewport-overflow', `viewBox width ${viewBox[0]} clips the fixed business-flow lanes; use at least ${layout.laneX + layout.laneW + 16}.`, { diagramType: 'business-flow', path: '/meta/viewBox/0' }, { minimum: layout.laneX + layout.laneW + 16 }, ['increase meta.viewBox[0]']));
  }
  if (legendY() - 30 < lastLaneBottom()) {
    problems.push(problem('business-flow/viewport-overflow', `The business-flow legend does not fit below the lane area in viewBox height ${viewBox[1]}.`, { diagramType: 'business-flow', path: '/meta/viewBox/1' }, { legendY: legendY(), laneBottom: lastLaneBottom() }, ['increase meta.viewBox[1] or shorten/hide legend labels']));
  }

  failProblems('Business-flow layout validation failed', problems);
}

function decisionRole(edge) {
  return DECISION_BRANCH_ROLES.has(edge?.role) ? edge.role : null;
}

function defaultDecisionOutputSide(edge, from, to) {
  const role = decisionRole(edge);
  if (role === 'yes') return 'bottom';
  if (to.cx < from.cx) return 'left';
  if (to.cx > from.cx) return 'right';
  return role === 'no' || to.cy >= from.cy ? 'right' : 'left';
}

function fromConnectionSide(edge, from, to) {
  if (from?.kind === 'decision') {
    if (DECISION_OUTPUT_SIDES.has(edge.fromSide)) return edge.fromSide;
    return defaultDecisionOutputSide(edge, from, to);
  }
  return chosenSide(edge.fromSide, defaultFromSide(from, to));
}

function toConnectionSide(edge, from, to) {
  if (to?.kind === 'decision') return 'top';
  return chosenSide(edge.toSide, defaultToSide(from, to));
}

function businessAnchor(node, side) {
  const { x, y, width, height, cx, cy } = node;
  if (node.kind === 'manual-input') {
    const slant = Math.min(18, width * 0.14);
    const ratio = (cy - y) / height;
    if (side === 'left') return [x + slant * (1 - ratio), cy];
    if (side === 'right') return [x + width - slant * ratio, cy];
    if (side === 'top') return [x + (width + slant) / 2, y];
    if (side === 'bottom') return [x + (width - slant) / 2, y + height];
  }
  if (node.kind === 'data-store' && side === 'bottom') return [cx, y + height - 4];
  if (node.kind === 'document' && side === 'bottom') return [cx, y + height - 4];
  if (node.kind === 'decision') {
    switch (side) {
      case 'left': return [x, cy];
      case 'right': return [x + width, cy];
      case 'top': return [cx, y];
      case 'bottom': return [cx, y + height];
      default: return [cx, y + height];
    }
  }
  switch (side) {
    case 'left': return [x, cy];
    case 'right': return [x + width, cy];
    case 'top': return [cx, y];
    case 'bottom': return [cx, y + height];
    default: return [x + width, cy];
  }
}

function businessPortSpread(relations, boxes) {
  const groups = new Map();
  const spread = new Map();
  const add = (relation, endpoint, node, side, counterpart) => {
    const key = `${node.id}\u0000${side}`;
    const list = groups.get(key) || [];
    list.push({ relation, endpoint, node, side, counterpart });
    groups.set(key, list);
  };
  for (const relation of asArray(relations)) {
    if (!relation || (relation.route && relation.route !== 'auto')) continue;
    if (relation.via || relation.channelX !== undefined || relation.channelY !== undefined || relation.labelAt) continue;
    const from = boxes.get(relation.from);
    const to = boxes.get(relation.to);
    if (!from || !to) continue;
    add(relation, 'from', from, fromConnectionSide(relation, from, to), to);
    add(relation, 'to', to, toConnectionSide(relation, from, to), from);
  }
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const verticalSide = list[0].side === 'left' || list[0].side === 'right';
    list.sort((left, right) => {
      const a = verticalSide ? left.counterpart.cy : left.counterpart.cx;
      const b = verticalSide ? right.counterpart.cy : right.counterpart.cx;
      if (a !== b) return a - b;
      return `${left.relation.id || ''}\u0000${left.relation.from}\u0000${left.relation.to}`.localeCompare(`${right.relation.id || ''}\u0000${right.relation.from}\u0000${right.relation.to}`);
    });
    const extent = verticalSide ? list[0].node.height : list[0].node.width;
    const usable = Math.max(0, extent - 32);
    const spacing = Math.min(14, usable / (list.length - 1));
    if (!(spacing > 0)) continue;
    for (const [index, item] of list.entries()) {
      const offset = (index - (list.length - 1) / 2) * spacing;
      const point = businessAnchor(item.node, item.side);
      // Decision ports are diamond tips/corners. Keep every yes/no and input
      // edge on the real outline instead of shifting a corner onto an
      // imaginary vertical or horizontal edge.
      if (item.node.kind !== 'decision') {
        if (verticalSide) point[1] += offset;
        else point[0] += offset;
      }
      const endpoints = spread.get(item.relation) || {};
      endpoints[item.endpoint] = point;
      spread.set(item.relation, endpoints);
    }
  }
  return spread;
}

function gapYBetween(fromLane, toLane, bias = 0.5) {
  if (fromLane === toLane) return laneBottom(fromLane) + 16;
  const from = laneBottom(fromLane);
  const to = laneTop(toLane);
  return from + (to - from) * bias;
}

function sameLaneAutoVia(start, end, from, to, fromSide, toSide) {
  if (routeHonorsEndpointSides([start, end], fromSide, toSide)) return [];
  const horizontalSides = new Set(['left', 'right']);
  const verticalSides = new Set(['top', 'bottom']);
  if (horizontalSides.has(fromSide) && horizontalSides.has(toSide)) {
    const midX = (start[0] + end[0]) / 2;
    return [[midX, start[1]], [midX, end[1]]];
  }
  if (verticalSides.has(fromSide) && verticalSides.has(toSide)) {
    const midY = (start[1] + end[1]) / 2;
    return [[start[0], midY], [end[0], midY]];
  }
  const horizontalFirst = [[end[0], start[1]]];
  const verticalFirst = [[start[0], end[1]]];
  const candidates = from.row !== to.row ? [verticalFirst, horizontalFirst] : [horizontalFirst, verticalFirst];
  return candidates.find((via) => routeHonorsEndpointSides([start, ...via, end], fromSide, toSide)) || candidates[0];
}

function decisionInputAutoVia(edge, to, start, end, fromSide) {
  const inputRank = decisionInputRanks.get(edge) || 0;
  const approachY = to.y - DECISION_ROUTE_GAP - inputRank * DECISION_INPUT_STAGGER;
  const channels = [to.x - DECISION_ROUTE_GAP, to.x + to.width + DECISION_ROUTE_GAP];
  const candidates = [];
  const horizontalSides = new Set(['left', 'right']);

  if (horizontalSides.has(fromSide)) {
    const orderedChannels = fromSide === 'right' ? channels : channels.slice().reverse();
    for (const channelX of orderedChannels) {
      candidates.push([
        [channelX, start[1]],
        [channelX, approachY],
        [end[0], approachY],
      ]);
    }
  } else {
    const firstY = fromSide === 'top'
      ? Math.min(start[1] - DECISION_ROUTE_GAP, approachY)
      : Math.max(start[1] + DECISION_ROUTE_GAP, to.y + to.height + DECISION_ROUTE_GAP);
    for (const channelX of channels) {
      candidates.push([
        [start[0], firstY],
        [channelX, firstY],
        [channelX, approachY],
        [end[0], approachY],
      ]);
    }
  }

  return candidates.find((via) => routeHonorsEndpointSides([start, ...via, end], fromSide, 'top')) || null;
}

function decisionOutputAutoVia(from, to, start, end, fromSide, toSide) {
  if (fromSide === 'bottom') {
    const channelY = Math.max(from.y + from.height, to.y + to.height) + DECISION_ROUTE_GAP;
    const targetStub = {
      left: [to.x - DECISION_ROUTE_GAP, end[1]],
      right: [to.x + to.width + DECISION_ROUTE_GAP, end[1]],
      top: [end[0], to.y - DECISION_ROUTE_GAP],
      bottom: [end[0], to.y + to.height + DECISION_ROUTE_GAP],
    }[toSide];
    if (targetStub) {
      const via = [
        [start[0], channelY],
        [targetStub[0], channelY],
        targetStub,
      ];
      if (routeHonorsEndpointSides([start, ...via, end], fromSide, toSide)) return via;
    }
  }

  return null;
}

function decisionAutoVia(edge, from, to, start, end, fromSide, toSide) {
  if (routeHonorsEndpointSides([start, end], fromSide, toSide)) return [];
  if (to.kind === 'decision') {
    const via = decisionInputAutoVia(edge, to, start, end, fromSide);
    if (via) return via;
  }
  if (from.kind === 'decision') {
    const via = decisionOutputAutoVia(from, to, start, end, fromSide, toSide);
    if (via) return via;
  }
  return null;
}

function routeVia(edge, from, to, start, end, fromSide, toSide) {
  if (edge.via) return edge.via;
  switch (edge.route || 'auto') {
    case 'straight':
      return [];
    case 'drop': {
      const y = gapYBetween(from.lane, to.lane, edge.bias ?? 0.5);
      return [[start[0], y], [end[0], y]];
    }
    case 'outside-right': {
      const x = edge.channelX ?? layout.laneX + layout.laneW + 20;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'return-left': {
      const x = edge.channelX ?? Math.max(18, Math.min(from.x, to.x) - 34);
      return [[x, start[1]], [x, end[1]]];
    }
    case 'bottom-channel': {
      const y = edge.channelY ?? Math.max(from.y + from.height, to.y + to.height) + 34;
      return [[start[0], y], [end[0], y]];
    }
    case 'up-channel': {
      const y = edge.channelY ?? Math.min(from.y, to.y) - 34;
      return [[start[0], y], [end[0], y]];
    }
    case 'auto':
    default: {
      const decisionVia = decisionAutoVia(edge, from, to, start, end, fromSide, toSide);
      if (decisionVia) return decisionVia;
      if ((from.lane !== to.lane || from.row === to.row) && routeHonorsEndpointSides([start, end], fromSide, toSide)) return [];
      if (from.lane !== to.lane) {
        const y = gapYBetween(from.lane, to.lane, edge.bias ?? 0.5);
        const drop = [[start[0], y], [end[0], y]];
        if (routeHonorsEndpointSides([start, ...drop, end], fromSide, toSide)) return drop;
      }
      return sameLaneAutoVia(start, end, from, to, fromSide, toSide);
    }
  }
}

const pathCache = new Map();
const automaticPorts = businessPortSpread(sourceEdges, nodes);

function connectionSides(edge) {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  return {
    fromSide: fromConnectionSide(edge, from, to),
    toSide: toConnectionSide(edge, from, to),
  };
}

function inferredAutoSide(edge, endpoint) {
  const field = endpoint === 'source' ? 'fromSide' : 'toSide';
  if (edge[field] && edge[field] !== 'auto') return edge[field];
  if (edge.via || (edge.route && edge.route !== 'auto')) return null;
  return connectionSides(edge)[field];
}

function pathFor(edge) {
  if (pathCache.has(edge)) return pathCache.get(edge);
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  if (!from || !to) return { d: '', points: [] };
  const ports = automaticPorts.get(edge);
  const { fromSide, toSide } = connectionSides(edge);
  const start = ports?.from || businessAnchor(from, fromSide);
  const end = ports?.to || businessAnchor(to, toSide);
  const points = [start, ...routeVia(edge, from, to, start, end, fromSide, toSide), end];
  const routed = { d: polylinePath(points), points };
  pathCache.set(edge, routed);
  return routed;
}

function compositionFrames() {
  return rawLanes.map((lane, index) => {
    const metric = laneMetrics.get(lane.id);
    return {
      id: `lane-${index}`,
      label: lane.label,
      kind: 'lane',
      x: layout.laneX,
      y: metric.y,
      width: layout.laneW,
      height: metric.height,
      radius: 10,
    };
  });
}

function renderLane(lane, index) {
  const metric = laneMetrics.get(lane.id);
  const exception = lane.variant === 'exception'
    ? `\n        <rect data-graph-role="structural-frame" data-composition-frame-kind="exception-lane" data-composition-frame-id="lane-${index}-exception" x="${layout.laneX + 6}" y="${metric.y + 6}" width="${layout.laneW - 12}" height="${metric.height - 12}" rx="8" class="c-security-group" stroke-width="1"/>`
    : '';
  const labelClass = lane.variant === 'exception' ? 't-security' : 't-dim';
  const prefix = lane.variant === 'exception' ? 'EX' : String(index + 1).padStart(2, '0');
  return `        <rect data-graph-role="structural-frame" data-composition-frame-kind="lane" data-composition-frame-id="lane-${index}" x="${layout.laneX}" y="${metric.y}" width="${layout.laneW}" height="${metric.height}" rx="10" class="c-lane" stroke-width="1"/>${exception}
        <text x="${layout.laneX + 14}" y="${metric.y + 22}" class="${labelClass}" font-size="10" font-weight="600">${prefix} / ${esc(lane.label)}</text>`;
}

function polygonPoints(node, points) {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}

function documentPath(node) {
  const { x, y, width, height } = node;
  const right = x + width;
  const base = y + height - 10;
  const waveCount = 4;
  const step = width / waveCount;
  const commands = [`M ${x} ${y}`, `H ${right}`, `V ${base}`];
  let current = right;
  for (let index = 0; index < waveCount; index += 1) {
    const next = right - step * (index + 1);
    const mid = (current + next) / 2;
    commands.push(`Q ${mid} ${y + height + 2} ${next} ${base}`);
    current = next;
  }
  commands.push('Z');
  return commands.join(' ');
}

function cylinderPath(node) {
  const { x, y, width, height } = node;
  const right = x + width;
  const top = y + 8;
  const bottom = y + height - 8;
  return `M ${x} ${top} C ${x} ${y + 3} ${right} ${y + 3} ${right} ${top} V ${bottom} C ${right} ${y + height - 3} ${x} ${y + height - 3} ${x} ${bottom} Z`;
}

function cylinderOutlinePath(node) {
  const { x, y, width, height } = node;
  const right = x + width;
  const top = y + 8;
  const bottom = y + height - 8;
  return `M ${x} ${top} V ${bottom} C ${x} ${y + height - 3} ${right} ${y + height - 3} ${right} ${bottom} V ${top}`;
}

function shapeMarkup(kind, node, className, strokeWidth = 1.5, animation = '') {
  const { x, y, width, height, cx, cy } = node;
  const attrs = `class="${className}" stroke-width="${strokeWidth}"${animation}`;
  switch (kind) {
    case 'start':
    case 'end':
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" ${attrs}/>`;
    case 'decision':
      return `<polygon points="${polygonPoints(node, [[cx, y], [x + width, cy], [cx, y + height], [x, cy]])}" ${attrs}/>`;
    case 'data-store': {
      const fillAttrs = attrs.replace(/stroke-width="[^"]+"/, 'stroke-width="0"');
      const outlineAttrs = attrs.replace(`class="${className}"`, `class="${className}" fill="none"`);
      return `<path d="${cylinderPath(node)}" ${fillAttrs}/><path d="${cylinderOutlinePath(node)}" ${outlineAttrs}/><ellipse cx="${cx}" cy="${y + 8}" rx="${width / 2}" ry="8" ${outlineAttrs}/>`;
    }
    case 'document':
      return `<path d="${documentPath(node)}" ${attrs}/>`;
    case 'manual-input': {
      const slant = Math.min(18, width * 0.14);
      return `<polygon points="${polygonPoints(node, [[x + slant, y], [x + width, y], [x + width - slant, y + height], [x, y + height]])}" ${attrs}/>`;
    }
    case 'subprocess':
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" ${attrs}/><rect x="${x + 7}" y="${y + 5}" width="${width - 14}" height="${height - 10}" rx="4" class="${className}" stroke-width="1"/>`;
    case 'external':
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" ${attrs} stroke-dasharray="5 4"/>`;
    case 'process':
    default:
      return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="6" ${attrs}/>`;
  }
}

function renderNode(node) {
  const hasSub = node.sublabel != null && node.sublabel !== '';
  const labelFontSize = fittedNodeFontSize(node.label, node.width, 11, 8);
  const sublabelFontSize = hasSub ? fittedNodeFontSize(node.sublabel, node.width, 8, 6) : 8;
  const labelY = hasSub ? node.cy - 3 : node.cy + 4;
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${node.cx}" y="${node.cy + 14}" class="t-muted" font-size="${sublabelFontSize}" text-anchor="middle">${esc(node.sublabel)}</text>`
    : '';
  const tag = node.tag
    ? `\n          <text data-detail="fine" x="${node.cx}" y="${node.y + node.height - 8}" class="t-external" font-size="${fittedNodeFontSize(node.tag, node.width, 7, 6)}" text-anchor="middle">${esc(node.tag)}</text>`
    : '';
  const animation = animateAttr(businessFlow.meta, 'node', nodeStep(node));
  const passport = { kind: node.kind, sublabel: node.sublabel, tag: node.tag, context: nodeContext(node) };
  return `        <g ${focusNodeAttrs(node.id, node.label, passport)} data-business-shape="${esc(node.kind)}">
          ${focusNodeTitle(node.label, passport)}
          ${shapeMarkup(node.kind, node, 'c-mask', 0)}
          ${shapeMarkup(node.kind, node, KIND_FILL[node.kind] || 'c-external', 1.5, animation)}
          <text${hasSub ? ' data-detail-anchor' : ''} x="${node.cx}" y="${labelY}" class="t-primary" font-size="${labelFontSize}" font-weight="600" text-anchor="middle">${esc(node.label)}</text>${sub}${tag}
        </g>`;
}

function renderEdgePath(edge, index) {
  const [className, marker] = arrowClassMap[edge.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(edge);
  const strokeWidth = edge.width || (edge.variant === 'emphasis' ? 1.8 : 1.5);
  return `        <path ${focusEdgeAttrs(edge.from, edge.to, edge.label, index, edge.id)} data-composition-points="${routePointsValue(routed.points)}" d="${routed.d}" class="${className}"${animateAttr(businessFlow.meta, 'edge', edgeSteps.get(edge))} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
}

function renderEdgeLabel(edge, index) {
  if (!edge.label) return '';
  const [lx, ly] = labelPoint(edge, pathFor(edge).points);
  const width = Math.max(30, textUnits(edge.label) * 4.8 + 10);
  return `        <g data-detail="context" ${focusEdgeAttrs(edge.from, edge.to, edge.label, index, edge.id)}>
          <rect x="${lx - width / 2}" y="${ly - 10}" width="${width}" height="14" rx="3" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${variantAccent(edge.variant)}" font-size="8" text-anchor="middle">${esc(edge.label)}</text>
        </g>`;
}

function renderBusinessLegendShape(entry) {
  const x = entry.x;
  const y = entry.baseline - 10;
  const w = 20;
  const h = 12;
  const node = { x, y, width: w, height: h, cx: x + w / 2, cy: y + h / 2 };
  const className = KIND_FILL[entry.kind] || 'c-external';
  return `<g data-legend-shape="${esc(entry.kind)}">${shapeMarkup(entry.kind, node, className, 1.1)}</g>`;
}

function renderLegend() {
  const relationshipObstacles = relationshipLegendObstacles(sourceEdges, {
    pointsFor: (edge) => pathFor(edge).points,
    labelRectFor: (edge) => {
      if (!edge.label) return null;
      const [x, y] = labelPoint(edge, pathFor(edge).points);
      const width = Math.max(30, textUnits(edge.label) * 4.8 + 10);
      return { x: x - width / 2, y: y - 10, width, height: 14 };
    },
  });
  const resolved = renderResolvedLegend({
    entries: legendEntries,
    layout: {
      x: layout.margin,
      baselineY: legendY(),
      width: viewBox[0] - layout.margin * 2,
      fontSize: 7,
      itemGap: 7,
      minTitleY: lastLaneBottom() + 10,
      obstacles: relationshipObstacles,
      unfit: businessFlow.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'business-flow',
    },
    renderSwatch: renderBusinessLegendShape,
  });
  return resolved;
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(businessFlow.meta, 'business-flow diagram')}>
${svgAccessibleText(businessFlow.meta, 'business-flow diagram')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Swimlanes -->
${rawLanes.map(renderLane).join('\n\n')}

        <!-- Business edges -->
${sourceEdges.map(renderEdgePath).join('\n')}

        <!-- Business nodes -->
${[...nodes.values()].map(renderNode).join('\n\n')}

        <!-- Edge labels -->
${sourceEdges.map(renderEdgeLabel).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

validateBusinessFlow();
writeDiagram({
  outPath,
  template,
  diagramType: 'business-flow',
  meta: businessFlow.meta,
  svg: renderSvg(),
  cards: businessFlow.cards,
});
