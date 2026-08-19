import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, renderDefinitions, renderSemanticSigil, textUnits } from '../shared/utils.mjs';
import { animateAttr, focusEdgeAttrs, focusNodeAttrs, focusNodeTitle, loadDiagram, writeDiagram, svgAccessibleText, svgRootAttrs } from '../shared/cli.mjs';
import { throwDiagnosticProblems } from '../shared/diagnostics.mjs';
import { resolveLegend, renderLegend as renderResolvedLegend } from '../shared/legend.mjs';
import { availableNodeTextWidth, fittedNodeFontSize, minimumNodeTextWidth } from '../shared/text-fit.mjs';
import {
  asArray,
  isFinitePoint,
  rectsOverlap,
  cleanFlowProblems,
  cleanCrossingProblems,
  cleanAmbiguousCorridorProblems,
  cleanBorderRunProblems,
  cleanRouteRhythmProblems,
  cleanLabelRouteClearanceProblems,
  suggestLabelObstacleFix,
  suggestLabelPairFix,
  anchor,
  automaticPortSpread,
  automaticOrthogonalVia,
  defaultFromSide,
  defaultToSide,
  chosenSide,
  routeHonorsEndpointSides,
  segmentIntersectsRect,
  normalizeRoutePoints,
  roundedPath,
  routePointsValue,
  labelPoint,
  arrowClassMap,
  variantAccent
} from '../shared/geometry.mjs';

const stateTextFit = {
  sublabelPreferred: 7,
  sublabelMinimum: 6,
  tagPreferred: 7,
  tagMinimum: 6,
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { diagram: lifecycle, template, outPath } = loadDiagram({
  rendererDir: __dirname,
  diagramType: 'lifecycle',
  defaultExample: 'agent-run.lifecycle.json'
});

const viewBox = lifecycle.meta?.viewBox || [980, 660];
const layout = {
  phaseY: 126,
  eventY: 278,
  outcomeY: 450,
  phaseW: 118,
  phaseH: 62,
  eventW: 126,
  eventH: 58,
  outcomeW: 118,
  outcomeH: 58,
  phaseXs: [94, 248, 402, 556, 710],
  eventXs: [402, 556, 710],
  outcomeXs: [402, 556, 710]
};

const typeClass = {
  start: 'c-frontend',
  active: 'c-backend',
  waiting: 'c-cloud',
  decision: 'c-security',
  success: 'c-database',
  failure: 'c-security',
  neutral: 'c-external',
  external: 'c-external'
};

const textClass = {
  start: 't-frontend',
  active: 't-backend',
  waiting: 't-cloud',
  decision: 't-security',
  success: 't-database',
  failure: 't-security',
  neutral: 't-muted',
  external: 't-muted'
};

function legendY() {
  return viewBox[1] - 36;
}

// Keep the authored state-placement contract independent from the measured
// legend's lower baseline. Moving legend chrome must not admit new state
// geometry into the reserved outcome/legend band.
function lifecycleAreaBottom() {
  return viewBox[1] - 122;
}

// Lane semantics are fixed: lane id "main" maps to the top phase band, lane id
// "terminal" maps to the bottom outcome band, and every other lane shares the
// middle event band (separated visually via yOffset).
function bandFor(lane) {
  if (lane === 'main') return 'phase';
  if (lane === 'terminal') return 'outcome';
  return 'event';
}

function measureState(state) {
  const isPhase = bandFor(state.lane) === 'phase';
  const isOutcome = bandFor(state.lane) === 'outcome';
  const width = state.width || (isPhase ? layout.phaseW : isOutcome ? layout.outcomeW : layout.eventW);
  const height = state.height || (isPhase ? layout.phaseH : isOutcome ? layout.outcomeH : layout.eventH);
  const xs = isPhase ? layout.phaseXs : isOutcome ? layout.outcomeXs : layout.eventXs;
  const cx = xs[state.col] ?? xs[xs.length - 1];
  const y = (
    isPhase ? layout.phaseY :
      isOutcome ? layout.outcomeY :
        layout.eventY
  ) + (state.yOffset || 0);
  return {
    ...state,
    width,
    height,
    x: cx - width / 2,
    y,
    cx,
    cy: y + height / 2
  };
}

const states = new Map(asArray(lifecycle.states).map((state) => [state.id, measureState(state)]));
const laneLabels = new Map(asArray(lifecycle.lanes).map((lane) => [lane.id, lane.label]));
const stateSteps = new Map();
for (const [index, transition] of asArray(lifecycle.transitions).entries()) {
  if (!stateSteps.has(transition.from)) stateSteps.set(transition.from, index);
  if (!stateSteps.has(transition.to)) stateSteps.set(transition.to, index + 1);
}
for (const [index, state] of asArray(lifecycle.states).entries()) {
  if (!stateSteps.has(state.id)) stateSteps.set(state.id, index);
}

function validateLifecycle() {
  const problems = [];
  if (lifecycle.schema_version !== 1) problems.push('Lifecycle files must set "schema_version": 1.');
  if (lifecycle.diagram_type !== 'lifecycle') problems.push('Lifecycle files must set "diagram_type": "lifecycle".');
  if (!lifecycle.meta?.title) problems.push('Lifecycle files must include meta.title.');
  if (!Array.isArray(lifecycle.lanes) || lifecycle.lanes.length < 1) problems.push('Lifecycle diagrams need at least one lane.');
  if (!Array.isArray(lifecycle.states) || lifecycle.states.length < 2) problems.push('Lifecycle diagrams need at least two states.');
  if (!Array.isArray(lifecycle.transitions)) problems.push('Lifecycle diagrams must include a transitions array.');
  if (lifecycle.cards !== undefined && !Array.isArray(lifecycle.cards)) problems.push('Lifecycle "cards" must be an array.');
  if (states.size !== asArray(lifecycle.states).length) problems.push('State ids must be unique.');

  // The three bands are fixed at y=112/264/436. Preserve the original
  // outcome/legend reserve even though measured legend rows now sit lower.
  if (lifecycleAreaBottom() + 4 < 448) {
    problems.push(`viewBox height ${viewBox[1]} is too short for the fixed band layout — set meta.viewBox[1] to at least 566.`);
  }

  const laneIds = new Set(asArray(lifecycle.lanes).map((lane) => lane.id));
  if (laneIds.size !== asArray(lifecycle.lanes).length) problems.push('Lane ids must be unique.');
  if (!laneIds.has('main')) {
    problems.push('Lifecycle diagrams need a lane with id "main" (the phase rail). Lane ids "main" and "terminal" are reserved: "main" maps to the top phase band, "terminal" to the bottom outcome band, and all other lanes share the middle event band.');
  }

  for (const state of states.values()) {
    if (!laneIds.has(state.lane)) {
      problems.push(`State "${state.id}" uses unknown lane "${state.lane}".`);
      continue;
    }
    const band = bandFor(state.lane);
    const maxCol = band === 'phase'
      ? layout.phaseXs.length
      : band === 'outcome'
        ? layout.outcomeXs.length
        : layout.eventXs.length;
    if (!Number.isInteger(state.col) || state.col < 0 || state.col >= maxCol) {
      problems.push(`State "${state.id}" uses invalid column ${state.col} — the ${band} band has integer columns 0..${maxCol - 1}.`);
      continue;
    }
    if (!isFinitePoint(state.x, state.y, state.cx, state.cy)) {
      problems.push(`State "${state.id}" produced non-finite coordinates — check col, width, height, and yOffset are numbers.`);
      continue;
    }
    if (state.x < 32 || state.x + state.width > viewBox[0] - 32) {
      problems.push(`State "${state.id}" exceeds the horizontal bounds of the diagram — reduce state.width or increase meta.viewBox[0].`);
    }
    if (state.y < 64 || state.y + state.height > lifecycleAreaBottom()) {
      problems.push(`State "${state.id}" exceeds the vertical lifecycle area — keep y between 64 and ${lifecycleAreaBottom()} (adjust yOffset or increase meta.viewBox[1]).`);
    }
    const estLabelW = textUnits(state.label) * 6.2;
    if (estLabelW > state.width + 6) {
      problems.push(`Label "${state.label}" (~${Math.round(estLabelW)}px) is wider than state "${state.id}" (${state.width}px) — shorten the label or increase state.width.`);
    }
    // sublabel and tag render as single unwrapped <text> elements; shrink-to-fit
    // handles the ordinary case, this rejects what it cannot rescue.
    const availableTextW = availableNodeTextWidth(state.width);
    for (const [field, value, minimum] of [
      ['Sublabel', state.sublabel, stateTextFit.sublabelMinimum],
      ['Tag', state.tag, stateTextFit.tagMinimum],
    ]) {
      if (!value) continue;
      const minimumW = minimumNodeTextWidth(value, minimum);
      if (minimumW > availableTextW) {
        problems.push(`${field} "${value}" needs ~${Math.ceil(minimumW)}px at the ${minimum}px legible minimum, but state "${state.id}" provides ${availableTextW}px — shorten the ${field.toLowerCase()} or increase state.width.`);
      }
    }
  }

  // All non-main/non-terminal lanes share the same y band, so the overlap
  // check must run across lanes — not per-lane.
  const allStates = [...states.values()];
  for (let i = 0; i < allStates.length; i += 1) {
    for (let j = i + 1; j < allStates.length; j += 1) {
      if (rectsOverlap(allStates[i], allStates[j], 10)) {
        problems.push(`States "${allStates[i].id}" and "${allStates[j].id}" are less than 10px apart — move one to another col or separate them with yOffset (lanes other than "main"/"terminal" share one band).`);
      }
    }
  }

  for (const transition of asArray(lifecycle.transitions)) {
    if (!states.has(transition.from)) problems.push(`Transition "${transition.label || transition.from}" references unknown source "${transition.from}".`);
    if (!states.has(transition.to)) problems.push(`Transition "${transition.label || transition.to}" references unknown target "${transition.to}".`);
    if (states.has(transition.from) && states.has(transition.to)) {
      const routed = pathFor(transition);
      const [start, end] = [routed.points[0], routed.points[routed.points.length - 1]];
      const distance = Math.hypot(end[0] - start[0], end[1] - start[1]);
      if (distance < 32) problems.push(`Transition "${transition.label || `${transition.from}->${transition.to}`}" is too short (${Math.round(distance)}px; minimum 32px) — route it through a channel or drop its label.`);
    }
  }

  problems.push(...cleanFlowProblems({
    relations: lifecycle.transitions,
    endpointIds: new Set(states.keys()),
    obstacles: states.values(),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    obstacleKind: 'state',
    profile: lifecycle.meta?.quality_profile,
    routeHint: 'adjust fromSide/toSide, set route/via or channelX/channelY, or move the state with col/yOffset'
  }));
  problems.push(...cleanCrossingProblems({
    relations: lifecycle.transitions,
    endpointIds: new Set(states.keys()),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: lifecycle.meta?.quality_profile,
    routeHint: 'adjust route/via or channelX/channelY so the transitions use separate lifecycle corridors'
  }));
  problems.push(...cleanAmbiguousCorridorProblems({
    relations: lifecycle.transitions,
    endpointIds: new Set(states.keys()),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: lifecycle.meta?.quality_profile,
    routeHint: 'adjust route/via or channelX/channelY so unrelated transitions do not visually merge'
  }));
  // Lifecycle bands are dashed reading guides, not closed containers. Keep the
  // shared contract wired with an explicit empty frame set so future typed
  // lifecycle containers cannot accidentally inherit presentation geometry.
  problems.push(...cleanBorderRunProblems({
    relations: lifecycle.transitions,
    endpointIds: new Set(states.keys()),
    frames: [],
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: lifecycle.meta?.quality_profile
  }));
  problems.push(...cleanRouteRhythmProblems({
    relations: lifecycle.transitions,
    endpointIds: new Set(states.keys()),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: lifecycle.meta?.quality_profile,
    routeHint: 'move route/via or channel coordinates so each lifecycle turn has a readable run-up'
  }));

  const labelRects = [];
  for (const [transitionIndex, transition] of asArray(lifecycle.transitions).entries()) {
    if (!transition.label || !states.has(transition.from) || !states.has(transition.to)) continue;
    const [lx, ly] = labelPoint(transition, pathFor(transition).points);
    const longestLine = Math.max(textUnits(transition.label), textUnits(transition.note || ''));
    const width = Math.max(32, longestLine * 4.9 + 12);
    const height = transition.note ? 27 : 16;
    labelRects.push({ relation: transition, relationIndex: transitionIndex, label: transition.label, x: lx - width / 2, y: ly - 11, width, height, lx, ly });
  }
  for (const rect of labelRects) {
    for (const state of states.values()) {
      if (rectsOverlap(rect, state, -2)) {
        problems.push(`Label "${rect.label}" overlaps state "${state.id}" — adjust labelDx/labelDy/labelSegment or set labelAt.\n${suggestLabelObstacleFix(rect, rect.lx, rect.ly, state, 'state')}`);
      }
    }
  }
  for (let i = 0; i < labelRects.length; i += 1) {
    for (let j = i + 1; j < labelRects.length; j += 1) {
      if (rectsOverlap(labelRects[i], labelRects[j], -2)) {
        problems.push(`Labels "${labelRects[i].label}" and "${labelRects[j].label}" overlap — adjust labelDx/labelDy.\n${suggestLabelPairFix(labelRects[i], labelRects[j])}`);
      }
    }
  }
  problems.push(...cleanLabelRouteClearanceProblems({
    relations: lifecycle.transitions,
    labels: labelRects,
    endpointIds: new Set(states.keys()),
    pathFor,
    diagramType: 'lifecycle',
    relationCollection: 'transitions',
    profile: lifecycle.meta?.quality_profile,
  }));

  if (problems.length) {
    throwDiagnosticProblems('Lifecycle layout validation failed', problems, {
      subject: { diagramType: 'lifecycle' },
    });
  }
}

function transitionFromSide(transition, from, to) {
  return chosenSide(transition.fromSide, defaultFromSide(from, to));
}

function transitionToSide(transition, from, to) {
  // A lower state is entered from above. This is a lifecycle invariant, so an
  // authored side cannot turn a downward transition into a bottom/side entry.
  if (to.cy > from.cy) return 'top';
  return chosenSide(transition.toSide, defaultToSide(from, to));
}

function routeClearsStates(points, fromId, toId) {
  for (const state of states.values()) {
    if (state.id === fromId || state.id === toId) continue;
    for (let index = 0; index < points.length - 1; index += 1) {
      if (segmentIntersectsRect({ start: points[index], end: points[index + 1] }, state, 2)) return false;
    }
  }
  return true;
}

function outsideLowerTargetVia(start, end, from, to, fromSide, toSide) {
  if (toSide !== 'top' || fromSide === 'top' || fromSide === 'bottom' || to.cy <= from.cy) return null;
  const horizontal = fromSide === 'left' || fromSide === 'right';
  if (!horizontal) return null;
  const obstacles = [...states.values()].filter((state) => state.id !== from.id && state.id !== to.id);
  const sign = fromSide === 'right' ? 1 : -1;
  const startStub = [start[0] + sign * 24, start[1]];
  const targetStub = [end[0], end[1] - 24];
  const obstacleRight = Math.max(start[0], end[0], ...obstacles.map((state) => state.x + state.width));
  const obstacleLeft = Math.min(start[0], end[0], ...obstacles.map((state) => state.x));
  const channelX = fromSide === 'right' ? obstacleRight + 36 : obstacleLeft - 36;
  const channelYs = [
    ...obstacles.flatMap((state) => [state.y - 24, state.y + state.height + 24]),
    start[1] - 36,
    start[1] + 36,
    targetStub[1] - 24,
    targetStub[1] + 24,
  ];
  let safeFallback = null;
  for (const channelY of channelYs) {
    const points = [
      start,
      startStub,
      [startStub[0], channelY],
      [channelX, channelY],
      [channelX, targetStub[1]],
      targetStub,
      end,
    ];
    if (!routeHonorsEndpointSides(points, fromSide, toSide)) continue;
    if (!safeFallback) safeFallback = points;
    if (routeClearsStates(points, from.id, to.id)) return points.slice(1, -1);
  }
  // Keep the endpoint contract even when every conservative outside channel
  // is blocked; the normal diagnostic can then report the real obstruction.
  return safeFallback ? safeFallback.slice(1, -1) : null;
}

const endpointVectors = {
  left: [-1, 0],
  right: [1, 0],
  top: [0, -1],
  bottom: [0, 1],
};

function endpointSegmentHonors(start, end, side, endpoint) {
  const vector = endpointVectors[side];
  if (!vector) return true;
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const axisAligned = vector[0] ? Math.abs(dy) <= 0.0001 : Math.abs(dx) <= 0.0001;
  if (!axisAligned) return false;
  const direction = endpoint === 'source' ? 1 : -1;
  return (dx * vector[0] + dy * vector[1]) * direction > 0.0001;
}

// Keep authored route/via points intact while adding only the endpoint bends
// needed to satisfy lifecycle direction contracts. This also makes straight
// and channel routes orthogonal when their anchors are not aligned.
function correctEndpointRoute(points, fromSide, toSide) {
  const corrected = normalizeRoutePoints(points);
  if (corrected.length < 2) return corrected;

  const start = corrected[0];
  const first = corrected[1];
  if ((fromSide === 'left' || fromSide === 'right')
      && !endpointSegmentHonors(start, first, fromSide, 'source')) {
    const vector = endpointVectors[fromSide];
    const stub = [start[0] + vector[0] * 24, start[1] + vector[1] * 24];
    const connector = vector[0] ? [stub[0], first[1]] : [first[0], stub[1]];
    corrected.splice(1, 0, stub, connector);
  }

  const end = corrected.at(-1);
  const last = corrected.at(-2);
  if (!endpointSegmentHonors(last, end, toSide, 'target')) {
    const vector = endpointVectors[toSide];
    const stub = [end[0] + vector[0] * 16, end[1] + vector[1] * 16];
    const bridge = Math.abs(last[0] - stub[0]) <= 0.0001 || Math.abs(last[1] - stub[1]) <= 0.0001
      ? [stub]
      : vector[0]
        ? [[stub[0], last[1]], stub]
        : [[last[0], stub[1]], stub];
    corrected.splice(corrected.length - 1, 0, ...bridge);
  }

  return normalizeRoutePoints(corrected);
}

function routeVia(transition, from, to, start, end, fromSide, toSide) {
  if (transition.via) return transition.via;
  switch (transition.route || 'auto') {
    case 'straight':
      return [];
    case 'drop': {
      const y = transition.channelY ?? (start[1] + end[1]) / 2;
      return [[start[0], y], [end[0], y]];
    }
    case 'bottom-channel': {
      const y = transition.channelY ?? Math.max(from.y + from.height, to.y + to.height) + 34;
      return [[start[0], y], [end[0], y]];
    }
    case 'top-channel': {
      const y = transition.channelY ?? Math.min(from.y, to.y) - 28;
      return [[start[0], y], [end[0], y]];
    }
    case 'right-channel': {
      const x = transition.channelX ?? Math.max(from.x + from.width, to.x + to.width) + 36;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'left-channel': {
      const x = transition.channelX ?? Math.min(from.x, to.x) - 36;
      return [[x, start[1]], [x, end[1]]];
    }
    case 'auto':
    default: {
      const automatic = automaticOrthogonalVia(start, end, fromSide, toSide, {
        accept: (points) => routeClearsStates(points, from.id, to.id),
      });
      if (automatic !== null) return automatic;
      const outside = outsideLowerTargetVia(start, end, from, to, fromSide, toSide);
      if (outside !== null) return outside;
      const directional = automaticOrthogonalVia(start, end, fromSide, toSide);
      if (directional !== null) return directional;
      if (from.lane === to.lane) return [];
      const y = transition.channelY ?? (start[1] + end[1]) / 2;
      const channel = [[start[0], y], [end[0], y]];
      return routeHonorsEndpointSides([start, ...channel, end], fromSide, toSide) ? channel : [];
    }
  }
}

const pathCache = new Map();
const automaticPorts = automaticPortSpread(lifecycle.transitions, states, {
  fromSideFor: transitionFromSide,
  toSideFor: transitionToSide,
});

function pathFor(transition) {
  if (pathCache.has(transition)) return pathCache.get(transition);
  const from = states.get(transition.from);
  const to = states.get(transition.to);
  const ports = automaticPorts.get(transition);
  const fromSide = transitionFromSide(transition, from, to);
  const toSide = transitionToSide(transition, from, to);
  const start = ports?.from || anchor(from, fromSide);
  const end = ports?.to || anchor(to, toSide);
  const via = routeVia(transition, from, to, start, end, fromSide, toSide);
  const points = correctEndpointRoute([start, ...via, end], fromSide, toSide);
  const routed = {
    d: roundedPath(points, transition.cornerRadius ?? 10),
    points
  };
  pathCache.set(transition, routed);
  return routed;
}

function bandTitles() {
  const lanes = asArray(lifecycle.lanes);
  const mainLane = lanes.find((lane) => lane.id === 'main');
  const terminalLane = lanes.find((lane) => lane.id === 'terminal');
  const eventLanes = lanes.filter((lane) => lane.id !== 'main' && lane.id !== 'terminal');
  return [
    mainLane?.label || '生命周期阶段',
    eventLanes.length ? eventLanes.map((lane) => lane.label).join(' + ') : '中断与恢复',
    terminalLane?.label || '结果'
  ];
}

function renderBands() {
  const right = viewBox[0] - 72;
  const titles = bandTitles();
  return `        <path d="M 72 112 L ${right} 112" class="a-default" stroke-width="0.8" stroke-dasharray="3,8"/>
        <text x="72" y="100" class="t-dim" font-size="10" font-weight="600">01 / ${esc(titles[0])}</text>
        <path d="M 72 264 L ${right} 264" class="a-default" stroke-width="0.8" stroke-dasharray="3,8"/>
        <text x="72" y="252" class="t-dim" font-size="10" font-weight="600">02 / ${esc(titles[1])}</text>
        <path d="M 72 436 L ${right} 436" class="a-default" stroke-width="0.8" stroke-dasharray="3,8"/>
        <text x="72" y="424" class="t-dim" font-size="10" font-weight="600">03 / ${esc(titles[2])}</text>`;
}

function renderState(state) {
  const fill = typeClass[state.type] || typeClass.neutral;
  const accent = textClass[state.type] || 't-muted';
  const hasSub = state.sublabel != null && state.sublabel !== '';
  const sub = hasSub
    ? `\n          <text data-detail="context" x="${state.cx}" y="${state.y + 37}" class="t-muted" font-size="${fittedNodeFontSize(state.sublabel, state.width, stateTextFit.sublabelPreferred, stateTextFit.sublabelMinimum)}" text-anchor="middle">${esc(state.sublabel)}</text>`
    : '';
  const tag = state.tag
    ? `\n        <text data-detail="fine" x="${state.cx}" y="${state.y + state.height - 11}" class="${accent}" font-size="${fittedNodeFontSize(state.tag, state.width, stateTextFit.tagPreferred, stateTextFit.tagMinimum)}" text-anchor="middle">${esc(state.tag)}</text>`
    : '';
  const step = state.step
    ? `\n        <text data-detail="fine" x="${state.x + 10}" y="${state.y + 14}" class="${accent}" font-size="7" font-weight="700">${esc(state.step)}</text>`
    : '';
  const passport = { kind: state.type, sublabel: state.sublabel, tag: state.tag, context: laneLabels.get(state.lane) || '生命周期状态' };
  return `        <g ${focusNodeAttrs(state.id, state.label, passport)}>
          ${focusNodeTitle(state.label, passport)}
          <rect x="${state.x}" y="${state.y}" width="${state.width}" height="${state.height}" rx="7" class="c-mask"/>
          <rect x="${state.x}" y="${state.y}" width="${state.width}" height="${state.height}" rx="7" class="${fill}"${animateAttr(lifecycle.meta, 'node', stateSteps.get(state.id))} stroke-width="1.5"/>
          ${renderSemanticSigil(state.type, { x: state.x + state.width - 17, y: state.y + 6 })}${step}
          <text${hasSub ? ' data-detail-anchor' : ''} x="${state.cx}" y="${state.y + 21}" class="t-primary" font-size="10" font-weight="600" text-anchor="middle">${esc(state.label)}</text>${sub}${tag}
        </g>`;
}

function renderTransitionPath(transition, index) {
  const [cls, marker] = arrowClassMap[transition.variant || 'default'] || arrowClassMap.default;
  const routed = pathFor(transition);
  const strokeWidth = transition.width || (transition.variant === 'emphasis' ? 2 : 1.1);
  return `        <path ${focusEdgeAttrs(transition.from, transition.to, transition.label, index, transition.id)} data-composition-points="${routePointsValue(routed.points)}" d="${routed.d}" class="${cls}"${animateAttr(lifecycle.meta, 'edge', index)} stroke-width="${strokeWidth}" marker-end="url(#${marker})"/>`;
}

function renderTransitionLabel(transition, index) {
  if (!transition.label) return '';
  const routed = pathFor(transition);
  const [lx, ly] = labelPoint(transition, routed.points);
  const longestLine = Math.max(textUnits(transition.label), textUnits(transition.note || ''));
  const labelW = Math.max(32, longestLine * 4.9 + 12);
  const labelH = transition.note ? 27 : 16;
  const note = transition.note
    ? `\n        <text data-detail="fine" x="${lx}" y="${ly + 11}" class="t-dim" font-size="7" text-anchor="middle">${esc(transition.note)}</text>`
    : '';
  return `        <g data-detail="context" ${focusEdgeAttrs(transition.from, transition.to, transition.label, index, transition.id)}>
          <rect x="${lx - labelW / 2}" y="${ly - 11}" width="${labelW}" height="${labelH}" rx="4" class="c-mask"/>
          <text x="${lx}" y="${ly}" class="${variantAccent(transition.variant)}" font-size="8" text-anchor="middle">${esc(transition.label)}</text>${note}
        </g>`;
}

const LEGEND_CATALOG = [
  ['start', '开始'],
  ['active', '活动状态'],
  ['waiting', '等待'],
  ['decision', '决策'],
  ['success', '终态成功'],
  ['failure', '失败 / 退出'],
  ['neutral', '中性'],
  ['external', '外部'],
].map(([kind, label]) => ({ kind, label }));

function renderLegend() {
  const presentKinds = new Set([...states.values()].map((state) => state.type));
  const entries = resolveLegend(lifecycle.meta?.legend, LEGEND_CATALOG, presentKinds);
  return renderResolvedLegend({
    entries,
    layout: {
      x: 40,
      baselineY: legendY(),
      width: viewBox[0] - 80,
      minTitleY: lifecycleAreaBottom() + 8,
      unfit: lifecycle.meta?.legend === undefined ? 'hide' : 'error',
      diagramType: 'lifecycle',
    },
    renderSwatch: (entry) => `<rect x="${entry.x}" y="${entry.baseline - 8}" width="14" height="9" rx="2" class="${typeClass[entry.kind] || 'c-external'}" stroke-width="1"/>`,
  });
}

function renderLifecycleRail() {
  const phaseStates = [...states.values()]
    .filter((state) => bandFor(state.lane) === 'phase')
    .filter((state) => (state.yOffset || 0) === 0)
    .sort((left, right) => left.col - right.col || left.id.localeCompare(right.id));
  const byCol = new Map();
  for (const state of phaseStates) {
    const statesAtCol = byCol.get(state.col) || [];
    statesAtCol.push(state);
    byCol.set(state.col, statesAtCol);
  }
  const segments = [];
  for (const state of phaseStates) {
    const next = byCol.get(state.col + 1);
    if (!next || next.length !== 1 || (byCol.get(state.col)?.length || 0) !== 1) continue;
    const to = next[0];
    if (Math.abs(state.cy - to.cy) > 0.0001 || to.x < state.x + state.width) continue;
    segments.push({ from: state, to });
  }
  if (!segments.length) {
    if (!phaseStates.length) return '';
    const from = phaseStates[0];
    const to = phaseStates.at(-1);
    if (from.id === to.id) {
      const maxCol = Math.max(...phaseStates.map((state) => state.col));
      const railEnd = layout.phaseXs[maxCol] + 38;
      return `        <path data-graph-role="lifecycle-rail" data-rail-key="main-fallback" data-composition-points="154,${layout.phaseY + 31};${railEnd},${layout.phaseY + 31}" d="M 154 ${layout.phaseY + 31} L ${railEnd} ${layout.phaseY + 31}" class="a-emphasis" stroke-width="2.2" marker-end="url(#arrowhead-emphasis)"/>`;
    }
    const start = anchor(from, 'right');
    const end = anchor(to, 'left');
    const points = Math.abs(start[1] - end[1]) <= 0.0001
      ? [start, end]
      : [start, [end[0], start[1]], end];
    const d = points.map(([x, y], pointIndex) => `${pointIndex ? 'L' : 'M'} ${x} ${y}`).join(' ');
    const edgeId = `main-${from.id}-${to.id}`;
    return `        <path data-graph-role="lifecycle-rail" data-rail-from="${esc(from.id)}" data-rail-to="${esc(to.id)}" data-rail-key="main-fallback" data-rail-id="${esc(edgeId)}" data-composition-points="${routePointsValue(points)}" d="${d}" class="a-emphasis" stroke-width="2.2" marker-end="url(#arrowhead-emphasis)"/>`;
  }
  return segments.map(({ from, to }, index) => {
    const start = anchor(from, 'right');
    const end = anchor(to, 'left');
    const points = Math.abs(start[1] - end[1]) <= 0.0001
      ? [start, end]
      : [start, [end[0], start[1]], end];
    const edgeId = `main-${from.id}-${to.id}`;
    const d = points.map(([x, y], pointIndex) => `${pointIndex ? 'L' : 'M'} ${x} ${y}`).join(' ');
    return `        <path data-graph-role="lifecycle-rail" data-rail-from="${esc(from.id)}" data-rail-to="${esc(to.id)}" data-rail-key="main-${index}" data-rail-id="${esc(edgeId)}" data-composition-points="${routePointsValue(points)}" d="${d}" class="a-emphasis" stroke-width="2.2" marker-end="url(#arrowhead-emphasis)"/>`;
  }).join('\n');
}

function renderSvg() {
  return `      <svg viewBox="0 0 ${viewBox[0]} ${viewBox[1]}" ${svgRootAttrs(lifecycle.meta, 'lifecycle diagram')}>
${svgAccessibleText(lifecycle.meta, 'lifecycle diagram')}
${renderDefinitions()}

        <!-- Background Grid -->
        <rect width="100%" height="100%" fill="url(#grid)" />

        <!-- Lifecycle bands -->
${renderBands()}

        <!-- Primary lifecycle rail -->
${renderLifecycleRail()}

        <!-- Transition paths -->
${asArray(lifecycle.transitions).map(renderTransitionPath).join('\n')}

        <!-- States -->
${[...states.values()].map(renderState).join('\n\n')}

        <!-- Transition labels -->
${asArray(lifecycle.transitions).map(renderTransitionLabel).join('\n')}

        <!-- Legend -->
${renderLegend()}
      </svg>`;
}

validateLifecycle();
writeDiagram({
  outPath,
  template,
  diagramType: 'lifecycle',
  meta: lifecycle.meta,
  svg: renderSvg(),
  cards: lifecycle.cards,
});
