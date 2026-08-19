import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');

function render(mode, doc) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-port-spread-'));
  const input = path.join(tmp, 'input.json');
  const output = path.join(tmp, 'output.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  try {
    execFileSync('node', [
      path.join(skillRoot, `renderers/${mode}/render-${mode}.mjs`),
      input,
      output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    return fs.readFileSync(output, 'utf8');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function connectionPoints(html, id) {
  const pattern = new RegExp(`data-edge-id="${id}"[^>]+data-composition-points="([^"]+)"`);
  const match = html.match(pattern);
  assert.ok(match, `missing rendered connection ${id}`);
  return match[1].split(';').map((point) => point.split(',').map(Number));
}

function railPoints(html, id) {
  const pattern = new RegExp(`data-rail-id="${id}"[^>]+data-composition-points="([^"]+)"`);
  const match = html.match(pattern);
  assert.ok(match, `missing lifecycle rail ${id}`);
  return match[1].split(';').map((point) => point.split(',').map(Number));
}

function fanOutArchitecture(connections) {
  return {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Automatic port spread' },
    components: [
      { id: 'hub', type: 'backend', label: 'Hub', pos: [100, 280], size: [120, 60] },
      { id: 'upper', type: 'external', label: 'Upper', pos: [500, 100], size: [120, 60] },
      { id: 'middle', type: 'database', label: 'Middle', pos: [500, 280], size: [120, 60] },
      { id: 'lower', type: 'cloud', label: 'Lower', pos: [500, 460], size: [120, 60] },
    ],
    connections,
  };
}

test('architecture: automatic fan-out uses distinct symmetric ports with corner clearance', () => {
  const html = render('architecture', fanOutArchitecture([
    { id: 'to-upper', from: 'hub', to: 'upper' },
    { id: 'to-middle', from: 'hub', to: 'middle' },
    { id: 'to-lower', from: 'hub', to: 'lower' },
  ]));

  assert.deepEqual(connectionPoints(html, 'to-upper')[0], [220, 296]);
  assert.deepEqual(connectionPoints(html, 'to-middle')[0], [220, 310]);
  assert.deepEqual(connectionPoints(html, 'to-lower')[0], [220, 324]);
});

test('architecture: automatic port assignment is stable when relationship input order changes', () => {
  const connections = [
    { id: 'to-upper', from: 'hub', to: 'upper' },
    { id: 'to-middle', from: 'hub', to: 'middle' },
    { id: 'to-lower', from: 'hub', to: 'lower' },
  ];
  const forward = render('architecture', fanOutArchitecture(connections));
  const reversed = render('architecture', fanOutArchitecture([...connections].reverse()));

  for (const connection of connections) {
    assert.deepEqual(
      connectionPoints(forward, connection.id),
      connectionPoints(reversed, connection.id),
      `${connection.id} moved after input reordering`,
    );
  }
});

test('architecture: a singly spread near-aligned vertical relationship keeps one direct axis', () => {
  const html = render('architecture', {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Near-aligned fan-out' },
    components: [
      { id: 'api', type: 'backend', label: 'API', pos: [675, 300], size: [120, 60] },
      { id: 'auth', type: 'security', label: 'Auth', pos: [570, 120], size: [100, 60] },
      { id: 'cache', type: 'database', label: 'Cache', pos: [685, 120], size: [100, 60] },
    ],
    connections: [
      { id: 'verify', from: 'api', to: 'auth', fromSide: 'top', toSide: 'bottom' },
      { id: 'read', from: 'api', to: 'cache', fromSide: 'top', toSide: 'bottom' },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'read'), [[742, 300], [742, 180]]);
  assert.notDeepEqual(connectionPoints(html, 'verify')[0], connectionPoints(html, 'read')[0]);
});

test('architecture: a singly spread near-aligned horizontal relationship keeps one direct axis', () => {
  const html = render('architecture', {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Near-aligned horizontal fan-out' },
    components: [
      { id: 'hub', type: 'backend', label: 'Hub', pos: [100, 100], size: [120, 60] },
      { id: 'direct', type: 'database', label: 'Direct', pos: [500, 107], size: [120, 60] },
      { id: 'branch', type: 'cloud', label: 'Branch', pos: [500, 300], size: [120, 60] },
    ],
    connections: [
      { id: 'hub-direct', from: 'hub', to: 'direct', fromSide: 'right', toSide: 'left' },
      { id: 'hub-branch', from: 'hub', to: 'branch', fromSide: 'right', toSide: 'left' },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'hub-direct'), [[220, 123], [500, 123]]);
  assert.notDeepEqual(connectionPoints(html, 'hub-branch')[0], connectionPoints(html, 'hub-direct')[0]);
});

test('architecture: a shared bottom port keeps its aligned child relationship straight', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Vertical child relationship' },
    components: [
      { id: 'parent', type: 'backend', label: 'Parent Session', pos: [300, 100], size: [200, 60] },
      { id: 'terminal', type: 'backend', label: 'Background terminal', pos: [300, 300], size: [200, 60] },
      { id: 'workflow', type: 'backend', label: 'Workflow', pos: [560, 300], size: [180, 60] },
    ],
    connections: [
      { id: 'parent-terminal', from: 'parent', to: 'terminal', fromSide: 'bottom', toSide: 'top' },
      { id: 'parent-workflow', from: 'parent', to: 'workflow', fromSide: 'bottom', toSide: 'top' },
    ],
  };
  const forward = render('architecture', doc);
  const reversed = render('architecture', {
    ...doc,
    connections: [...doc.connections].reverse(),
  });

  assert.deepEqual(connectionPoints(forward, 'parent-terminal'), [[393, 160], [393, 300]]);
  assert.notDeepEqual(
    connectionPoints(forward, 'parent-workflow')[0],
    connectionPoints(forward, 'parent-terminal')[0],
  );
  for (const connection of doc.connections) {
    assert.deepEqual(
      connectionPoints(forward, connection.id),
      connectionPoints(reversed, connection.id),
      `${connection.id} moved after input reordering`,
    );
  }
});

test('architecture: incoming and outgoing relationships keep distinct bottom ports while the direct child stays straight', () => {
  const html = render('architecture', {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Shared incoming and outgoing side' },
    components: [
      { id: 'workflow', type: 'backend', label: 'Workflow', pos: [80, 320], size: [180, 60] },
      { id: 'child', type: 'security', label: 'Child boundary', pos: [300, 100], size: [200, 60] },
      { id: 'footer', type: 'frontend', label: 'Footer', pos: [300, 320], size: [200, 60] },
    ],
    connections: [
      { id: 'workflow-child', from: 'workflow', to: 'child', fromSide: 'right', toSide: 'bottom' },
      { id: 'child-footer', from: 'child', to: 'footer', fromSide: 'bottom', toSide: 'top' },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'child-footer'), [[407, 160], [407, 320]]);
  assert.notDeepEqual(
    connectionPoints(html, 'workflow-child').at(-1),
    connectionPoints(html, 'child-footer')[0],
  );
});

test('architecture: a near-aligned relationship keeps the outside bridge when both endpoints are spread', () => {
  const html = render('architecture', {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Two-sided port competition' },
    components: [
      { id: 'source', type: 'backend', label: 'Source', pos: [300, 320], size: [160, 60] },
      { id: 'source-peer', type: 'backend', label: 'Source peer', pos: [80, 320], size: [160, 60] },
      { id: 'target', type: 'database', label: 'Target', pos: [300, 100], size: [160, 60] },
      { id: 'target-peer', type: 'database', label: 'Target peer', pos: [560, 100], size: [160, 60] },
    ],
    connections: [
      { id: 'source-target', from: 'source', to: 'target', fromSide: 'top', toSide: 'bottom' },
      { id: 'source-peer-target', from: 'source-peer', to: 'target', fromSide: 'top', toSide: 'bottom' },
      { id: 'source-target-peer', from: 'source', to: 'target-peer', fromSide: 'top', toSide: 'bottom' },
    ],
  });

  const points = connectionPoints(html, 'source-target');
  assert.ok(points.length > 2);
  assert.notEqual(points[0][0], points.at(-1)[0]);
});

test('architecture: a singly spread near-aligned relationship keeps the bridge when its direct axis is blocked', () => {
  const html = render('architecture', {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Blocked vertical axis' },
    components: [
      { id: 'parent', type: 'backend', label: 'Parent', pos: [300, 100], size: [200, 60] },
      { id: 'terminal', type: 'backend', label: 'Terminal', pos: [300, 400], size: [200, 60] },
      { id: 'workflow', type: 'backend', label: 'Workflow', pos: [560, 400], size: [180, 60] },
      { id: 'obstacle', type: 'external', label: 'X', pos: [382, 245], size: [26, 60] },
    ],
    connections: [
      { id: 'parent-terminal', from: 'parent', to: 'terminal', fromSide: 'bottom', toSide: 'top' },
      { id: 'parent-workflow', from: 'parent', to: 'workflow', fromSide: 'bottom', toSide: 'top' },
    ],
  });

  const points = connectionPoints(html, 'parent-terminal');
  assert.ok(points.length > 2);
  assert.notEqual(points[0][0], points.at(-1)[0]);
});

test('architecture: single and explicitly positioned relationships keep legacy anchors', () => {
  const doc = fanOutArchitecture([
    { id: 'single', from: 'hub', to: 'middle' },
    { id: 'via', from: 'hub', to: 'upper', via: [[300, 310], [300, 130]] },
    { id: 'fixed-route', from: 'hub', to: 'lower', route: 'orthogonal-h' },
    { id: 'fixed-label', from: 'hub', to: 'upper', label: 'contract', labelAt: [360, 200] },
  ]);
  const html = render('architecture', doc);

  assert.deepEqual(connectionPoints(html, 'single'), [[220, 310], [500, 310]]);
  assert.deepEqual(connectionPoints(html, 'via'), [[220, 310], [300, 310], [300, 130], [500, 130]]);
  assert.deepEqual(connectionPoints(html, 'fixed-route'), [[220, 310], [360, 310], [360, 490], [500, 490]]);
  assert.deepEqual(connectionPoints(html, 'fixed-label'), [[220, 310], [360, 310], [360, 130], [500, 130]]);
});

test('architecture: an unspread near-aligned connection shares one horizontal axis', () => {
  const html = render('architecture', {
    schema_version: 1,
    diagram_type: 'architecture',
    meta: { title: 'Near-aligned single connection' },
    components: [
      { id: 'console', type: 'frontend', label: 'Console', pos: [260, 300], size: [170, 64] },
      { id: 'controlplane', type: 'backend', label: 'Control plane', pos: [500, 300], size: [190, 72] },
    ],
    connections: [
      { id: 'console-controlplane', from: 'console', to: 'controlplane', label: 'REST /api', variant: 'emphasis', labelDy: -36 },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'console-controlplane'), [[430, 332], [500, 332]]);
});

test('workflow: automatic cross-lane fan-out spreads the shared source port', () => {
  const html = render('workflow', {
    schema_version: 1,
    diagram_type: 'workflow',
    meta: { title: 'Workflow port spread' },
    lanes: [
      { id: 'upper-lane', label: 'Upper' },
      { id: 'hub-lane', label: 'Hub' },
      { id: 'lower-lane', label: 'Lower' },
    ],
    nodes: [
      { id: 'hub', lane: 'hub-lane', col: 0, type: 'backend', label: 'Hub' },
      { id: 'upper', lane: 'upper-lane', col: 3, type: 'external', label: 'Upper' },
      { id: 'middle', lane: 'hub-lane', col: 3, type: 'database', label: 'Middle' },
      { id: 'lower', lane: 'lower-lane', col: 3, type: 'cloud', label: 'Lower' },
    ],
    edges: [
      { id: 'to-upper', from: 'hub', to: 'upper' },
      { id: 'to-middle', from: 'hub', to: 'middle' },
      { id: 'to-lower', from: 'hub', to: 'lower' },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'to-upper')[0], [134, 233]);
  assert.deepEqual(connectionPoints(html, 'to-middle')[0], [134, 243]);
  assert.deepEqual(connectionPoints(html, 'to-lower')[0], [134, 253]);
});

test('dataflow: automatic fan-out spreads flows without changing their authored topology', () => {
  const html = render('dataflow', {
    schema_version: 1,
    diagram_type: 'dataflow',
    meta: { title: 'Data-flow port spread' },
    stages: [{ label: 'Source' }, { label: 'Transform' }, { label: 'Sinks' }],
    nodes: [
      { id: 'hub', type: 'backend', label: 'Hub', stage: 0, row: 2 },
      { id: 'upper', type: 'external', label: 'Upper', stage: 2, row: 0 },
      { id: 'middle', type: 'database', label: 'Middle', stage: 2, row: 2 },
      { id: 'lower', type: 'cloud', label: 'Lower', stage: 2, row: 4 },
    ],
    flows: [
      { id: 'to-upper', from: 'hub', to: 'upper', label: 'upper feed' },
      { id: 'to-middle', from: 'hub', to: 'middle', label: 'middle feed' },
      { id: 'to-lower', from: 'hub', to: 'lower', label: 'lower feed' },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'to-upper')[0], [156, 372]);
  assert.deepEqual(connectionPoints(html, 'to-middle')[0], [156, 385]);
  assert.deepEqual(connectionPoints(html, 'to-lower')[0], [156, 398]);
});

test('lifecycle: automatic fan-out spreads transitions across lifecycle bands', () => {
  const html = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Lifecycle port spread' },
    lanes: [
      { id: 'main', label: 'Main' },
      { id: 'event', label: 'Events' },
      { id: 'terminal', label: 'Outcomes' },
    ],
    states: [
      { id: 'hub', type: 'active', label: 'Hub', lane: 'event', col: 0 },
      { id: 'upper', type: 'waiting', label: 'Upper', lane: 'main', col: 4 },
      { id: 'middle', type: 'success', label: 'Middle', lane: 'event', col: 2 },
      { id: 'lower', type: 'failure', label: 'Lower', lane: 'terminal', col: 2 },
    ],
    transitions: [
      { id: 'to-upper', from: 'hub', to: 'upper' },
      { id: 'to-middle', from: 'hub', to: 'middle' },
      { id: 'to-lower', from: 'hub', to: 'lower' },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'to-upper')[0], [465, 294]);
  assert.deepEqual(connectionPoints(html, 'to-middle')[0], [465, 307]);
  assert.deepEqual(connectionPoints(html, 'to-lower')[0], [465, 320]);
});

test('lifecycle: same-band port spread remains orthogonal', () => {
  const html = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Orthogonal same-band spread' },
    lanes: [{ id: 'main', label: 'Main' }],
    states: [
      { id: 'hub', type: 'active', label: 'Hub', lane: 'main', col: 0 },
      { id: 'upper', type: 'waiting', label: 'Upper', lane: 'main', col: 2, yOffset: -50 },
      { id: 'lower', type: 'success', label: 'Lower', lane: 'main', col: 4, yOffset: 50 },
    ],
    transitions: [
      { id: 'to-upper', from: 'hub', to: 'upper' },
      { id: 'to-lower', from: 'hub', to: 'lower' },
    ],
  });

  assert.deepEqual(connectionPoints(html, 'to-upper'), [
    [153, 150], [248, 150], [248, 107], [343, 107],
  ]);
  assert.deepEqual(connectionPoints(html, 'to-lower'), [
    [153, 164], [710, 164], [710, 176],
  ]);
});

test('lifecycle: automatic routes leave left/right ports horizontally and enter lower targets from the top', () => {
  const html = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Directional lifecycle routing' },
    lanes: [
      { id: 'main', label: 'Main' },
      { id: 'events', label: 'Events' },
    ],
    states: [
      { id: 'source', type: 'active', label: 'Source', lane: 'main', col: 0 },
      { id: 'target', type: 'waiting', label: 'Target', lane: 'events', col: 0 },
    ],
    transitions: [{ id: 'downward', from: 'source', to: 'target' }],
  });

  const points = connectionPoints(html, 'downward');
  assert.deepEqual(points, [[153, 157], [402, 157], [402, 278]]);
  assert.equal(points[1][1], points[0][1], 'left/right departure must be horizontal');
  assert.equal(points.at(-2)[0], points.at(-1)[0], 'lower target must receive a vertical top entry');
});

test('lifecycle: top/bottom source ports leave on their vertical normals', () => {
  const bottomHtml = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Bottom lifecycle endpoint routing' },
    lanes: [
      { id: 'main', label: 'Main' },
      { id: 'events', label: 'Events' },
    ],
    states: [
      { id: 'bottom-source', type: 'active', label: 'Bottom source', lane: 'main', col: 0 },
      { id: 'bottom-target', type: 'waiting', label: 'Bottom target', lane: 'events', col: 2 },
    ],
    transitions: [{ id: 'bottom-departure', from: 'bottom-source', to: 'bottom-target', fromSide: 'bottom', route: 'straight' }],
  });

  const bottom = connectionPoints(bottomHtml, 'bottom-departure');
  assert.equal(bottom[0][0], bottom[1][0]);
  assert.ok(bottom[1][1] > bottom[0][1]);

  const topHtml = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Top lifecycle endpoint routing' },
    lanes: [
      { id: 'main', label: 'Main' },
      { id: 'events', label: 'Events' },
    ],
    states: [
      { id: 'top-source', type: 'active', label: 'Top source', lane: 'events', col: 2 },
      { id: 'top-target', type: 'waiting', label: 'Top target', lane: 'main', col: 4 },
    ],
    transitions: [{ id: 'top-departure', from: 'top-source', to: 'top-target', fromSide: 'top', toSide: 'bottom', route: 'straight' }],
  });

  const top = connectionPoints(topHtml, 'top-departure');
  assert.equal(top[0][0], top[1][0]);
  assert.ok(top[1][1] < top[0][1]);
});

test('lifecycle: opposite vertical endpoints use an offset channel without U-turns', () => {
  const assertClean = (points) => {
    for (let index = 0; index < points.length - 1; index += 1) {
      assert.ok(
        points[index][0] === points[index + 1][0] || points[index][1] === points[index + 1][1],
        `segment ${points[index]} -> ${points[index + 1]} must stay orthogonal`,
      );
    }
    for (let index = 0; index < points.length - 2; index += 1) {
      const first = [points[index + 1][0] - points[index][0], points[index + 1][1] - points[index][1]];
      const second = [points[index + 2][0] - points[index + 1][0], points[index + 2][1] - points[index + 1][1]];
      const sameAxis = (first[0] === 0 && second[0] === 0) || (first[1] === 0 && second[1] === 0);
      assert.ok(!sameAxis || first[0] * second[0] + first[1] * second[1] >= 0, `U-turn at ${points[index + 1]}`);
    }
  };

  const sourceBelowHtml = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Source below target' },
    lanes: [{ id: 'main', label: 'Main' }, { id: 'events', label: 'Events' }],
    states: [
      { id: 'target', type: 'waiting', label: 'Target', lane: 'events', col: 0 },
      { id: 'source', type: 'active', label: 'Source', lane: 'events', col: 0, yOffset: 150 },
    ],
    transitions: [{ id: 'source-below', from: 'source', to: 'target', fromSide: 'bottom', route: 'straight' }],
  });
  const sourceBelow = connectionPoints(sourceBelowHtml, 'source-below');
  assert.equal(sourceBelow[0][0], sourceBelow[1][0]);
  assert.ok(sourceBelow[1][1] > sourceBelow[0][1]);
  assertClean(sourceBelow);

  const targetBelowHtml = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Target below source' },
    lanes: [{ id: 'main', label: 'Main' }, { id: 'events', label: 'Events' }],
    states: [
      { id: 'source', type: 'active', label: 'Source', lane: 'events', col: 0 },
      { id: 'target', type: 'waiting', label: 'Target', lane: 'events', col: 0, yOffset: 150 },
    ],
    transitions: [{ id: 'target-below', from: 'source', to: 'target', fromSide: 'top', toSide: 'top', route: 'straight' }],
  });
  const targetBelow = connectionPoints(targetBelowHtml, 'target-below');
  assert.equal(targetBelow.at(-2)[0], targetBelow.at(-1)[0]);
  assert.ok(targetBelow.at(-2)[1] < targetBelow.at(-1)[1]);
  assertClean(targetBelow);
});

test('lifecycle: actual authored routes honor vertical endpoints without backtracking', () => {
  const html = render('lifecycle', JSON.parse(fs.readFileSync(path.join(skillRoot, 'examples/agent-run.lifecycle.json'), 'utf8')));
  const assertNoBacktracking = (points, id) => {
    for (let index = 0; index < points.length - 2; index += 1) {
      const first = points[index];
      const middle = points[index + 1];
      const last = points[index + 2];
      const firstVector = [middle[0] - first[0], middle[1] - first[1]];
      const secondVector = [last[0] - middle[0], last[1] - middle[1]];
      const sameAxis = (firstVector[0] === 0 && secondVector[0] === 0)
        || (firstVector[1] === 0 && secondVector[1] === 0);
      const dot = firstVector[0] * secondVector[0] + firstVector[1] * secondVector[1];
      assert.ok(!sameAxis || dot >= 0, `${id} route backtracks at ${middle}`);
    }
  };

  const executionFailed = connectionPoints(html, 'execution-failed');
  assertNoBacktracking(executionFailed, 'execution-failed');

  const approvalCancelled = connectionPoints(html, 'approval-cancelled');
  assert.equal(approvalCancelled[0][0], approvalCancelled[1][0], 'approval-cancelled must leave the bottom port vertically');
  assert.ok(approvalCancelled[1][1] > approvalCancelled[0][1], 'approval-cancelled must leave downward');
  assert.equal(approvalCancelled.at(-2)[0], approvalCancelled.at(-1)[0], 'approval-cancelled must enter the target vertically');
  assert.ok(approvalCancelled.at(-2)[1] < approvalCancelled.at(-1)[1], 'approval-cancelled must enter cancelled from its top');
  assertNoBacktracking(approvalCancelled, 'approval-cancelled');
});

test('lifecycle: endpoint correction removes unequal same-axis U-turns', () => {
  const assertNoBacktracking = (points) => {
    for (let index = 0; index < points.length - 2; index += 1) {
      const first = [points[index + 1][0] - points[index][0], points[index + 1][1] - points[index][1]];
      const second = [points[index + 2][0] - points[index + 1][0], points[index + 2][1] - points[index + 1][1]];
      const sameAxis = (first[0] === 0 && second[0] === 0) || (first[1] === 0 && second[1] === 0);
      assert.ok(!sameAxis || first[0] * second[0] + first[1] * second[1] >= 0);
    }
  };

  const sourceHtml = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Source endpoint repair' },
    lanes: [{ id: 'main', label: 'Main' }, { id: 'events', label: 'Events' }],
    states: [
      { id: 'source', type: 'active', label: 'Source', lane: 'main', col: 0 },
      { id: 'target', type: 'waiting', label: 'Target', lane: 'events', col: 2 },
    ],
    transitions: [{ id: 'source-reverse', from: 'source', to: 'target', fromSide: 'bottom', via: [[94, 172], [300, 172], [710, 172]] }],
  });
  const sourcePoints = connectionPoints(sourceHtml, 'source-reverse');
  assert.equal(sourcePoints[0][0], sourcePoints[1][0]);
  assert.ok(sourcePoints[1][1] > sourcePoints[0][1]);
  assertNoBacktracking(sourcePoints);

  const targetHtml = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Target endpoint repair' },
    lanes: [{ id: 'main', label: 'Main' }, { id: 'events', label: 'Events' }],
    states: [
      { id: 'source', type: 'active', label: 'Source', lane: 'events', col: 0 },
      { id: 'target', type: 'waiting', label: 'Target', lane: 'main', col: 4 },
    ],
    transitions: [{ id: 'target-reverse', from: 'source', to: 'target', fromSide: 'right', toSide: 'bottom', via: [[500, 307], [500, 196], [710, 196], [710, 230]] }],
  });
  const targetPoints = connectionPoints(targetHtml, 'target-reverse');
  assert.equal(targetPoints.at(-2)[0], targetPoints.at(-1)[0]);
  assert.ok(targetPoints.at(-2)[1] > targetPoints.at(-1)[1]);
  assertNoBacktracking(targetPoints);
});

test('lifecycle: lower targets override a conflicting authored toSide', () => {
  const html = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Lower target side contract' },
    lanes: [
      { id: 'main', label: 'Main' },
      { id: 'events', label: 'Events' },
    ],
    states: [
      { id: 'source', type: 'active', label: 'Source', lane: 'main', col: 0 },
      { id: 'target', type: 'waiting', label: 'Target', lane: 'events', col: 0 },
    ],
    transitions: [{ id: 'conflicting-side', from: 'source', to: 'target', toSide: 'bottom' }],
  });

  const points = connectionPoints(html, 'conflicting-side');
  assert.equal(points.at(-1)[1], 278, 'an authored bottom side cannot override lower-target top entry');
  assert.equal(points.at(-2)[0], points.at(-1)[0]);
});

test('lifecycle: authored via keeps its middle points while endpoint bends stay orthogonal', () => {
  const html = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Authored lifecycle via' },
    lanes: [
      { id: 'main', label: 'Main' },
      { id: 'events', label: 'Events' },
    ],
    states: [
      { id: 'source', type: 'active', label: 'Source', lane: 'main', col: 2 },
      { id: 'target', type: 'waiting', label: 'Target', lane: 'events', col: 0, yOffset: 78 },
    ],
    transitions: [{
      id: 'authored-via',
      from: 'source',
      to: 'target',
      fromSide: 'left',
      toSide: 'left',
      via: [[320, 157], [320, 385]],
    }],
  });

  const points = connectionPoints(html, 'authored-via');
  assert.deepEqual(points.slice(1, 3), [[320, 157], [320, 385]], 'authored middle via points must remain intact');
  assert.equal(points[1][1], points[0][1], 'left source departure must be horizontal');
  assert.equal(points.at(-2)[0], points.at(-1)[0], 'lower target must receive a vertical top entry');
  for (let index = 0; index < points.length - 1; index += 1) {
    assert.ok(
      points[index][0] === points[index + 1][0] || points[index][1] === points[index + 1][1],
      `via segment ${points[index]} -> ${points[index + 1]} must stay orthogonal`,
    );
  }
});

test('lifecycle: aligned automatic endpoints keep a direct horizontal connection', () => {
  const html = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Aligned lifecycle routing' },
    lanes: [{ id: 'main', label: 'Main' }],
    states: [
      { id: 'first', type: 'start', label: 'First', lane: 'main', col: 0 },
      { id: 'second', type: 'success', label: 'Second', lane: 'main', col: 1 },
    ],
    transitions: [{ id: 'aligned', from: 'first', to: 'second' }],
  });

  assert.deepEqual(connectionPoints(html, 'aligned'), [[153, 157], [189, 157]]);
});

test('lifecycle: primary rail is anchored and identifiable without becoming a graph relationship', () => {
  const html = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Lifecycle rail identity' },
    lanes: [{ id: 'main', label: 'Main' }],
    states: [
      { id: 'first', type: 'start', label: 'First', lane: 'main', col: 0 },
      { id: 'last', type: 'success', label: 'Last', lane: 'main', col: 2 },
    ],
    transitions: [],
  });

  assert.deepEqual(railPoints(html, 'main-first-last'), [[153, 157], [343, 157]]);
  assert.match(html, /data-graph-role="lifecycle-rail" data-rail-from="first" data-rail-to="last"/);
  assert.doesNotMatch(html, /data-edge-from="first" data-edge-to="last"/);
});

test('lifecycle: rail stays orthogonal and v1-compatible with offset or duplicate columns', () => {
  const html = render('lifecycle', {
    schema_version: 1,
    diagram_type: 'lifecycle',
    meta: { title: 'Legacy lifecycle rail' },
    lanes: [{ id: 'main', label: 'Main' }],
    states: [
      { id: 'first', type: 'start', label: 'First', lane: 'main', col: 0 },
      { id: 'offset', type: 'active', label: 'Offset', lane: 'main', col: 1, yOffset: 24 },
      { id: 'last', type: 'success', label: 'Last', lane: 'main', col: 2 },
    ],
    transitions: [],
  });

  assert.deepEqual(railPoints(html, 'main-first-last'), [[153, 157], [343, 157]]);
  for (const match of html.matchAll(/data-graph-role="lifecycle-rail"[^>]*data-composition-points="([^"]+)"/g)) {
    const points = match[1].split(';').map((point) => point.split(',').map(Number));
    for (let index = 0; index < points.length - 1; index += 1) {
      assert.ok(
        points[index][0] === points[index + 1][0] || points[index][1] === points[index + 1][1],
        `rail segment ${points[index]} -> ${points[index + 1]} must stay orthogonal`,
      );
    }
  }
});

test('skill and READMEs describe automatic port spread as bounded default behavior', () => {
  const skill = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
  assert.match(skill, /Automatic Port Spread is a default renderer behavior/);
  assert.match(skill, /single relationship|single relationships/);
  assert.match(skill, /explicit `via`.*`channelX`.*`channelY`.*`labelAt`/);
  assert.match(skill, /facing automatic ports \(`left`\/`right` or `top`\/`bottom`\).*one shared axis/);

  const authoringContract = fs.readFileSync(path.join(skillRoot, 'references/authoring-contract.md'), 'utf8');
  assert.match(authoringContract, /unobstructed facing ports.*may share one horizontal or vertical axis/);

  const repoRoot = path.resolve(skillRoot, '..');
  for (const file of ['README.md', 'README_EN.md']) {
    assert.match(fs.readFileSync(path.join(repoRoot, file), 'utf8'), /shared automatic endpoints spread deterministically/);
  }
  assert.match(fs.readFileSync(path.join(repoRoot, 'README_ZH.md'), 'utf8'), /共享的自动端点会确定性展开/);
});
