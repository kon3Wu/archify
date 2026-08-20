import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(__dirname, '..');
const cli = path.join(skillRoot, 'bin', 'archify.mjs');
const fixture = path.join(skillRoot, 'examples', 'standard-business-flow.business-flow.json');
const refundFixture = path.join(skillRoot, 'examples', 'refund-approval.business-flow.json');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-business-flow-'));

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: skillRoot,
    encoding: 'utf8',
  });
}

function edgePoints(html, id) {
  const match = html.match(new RegExp(`data-edge-id="${id}"[^>]*data-composition-points="([^"]+)"`));
  assert.ok(match, `missing route points for ${id}`);
  return match[1].split(';').map((point) => point.split(',').map(Number));
}

test('business-flow: standard proof renders all nine semantic shapes and real legend shapes', () => {
  const output = path.join(scratch, 'standard.html');
  const result = run(['render', 'business-flow', fixture, output]);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  for (const kind of ['start', 'end', 'process', 'decision', 'data-store', 'document', 'manual-input', 'subprocess', 'external']) {
    assert.match(html, new RegExp(`data-business-shape="${kind}"`), kind);
    assert.match(html, new RegExp(`data-legend-shape="${kind}"`), `legend ${kind}`);
  }
  assert.match(html, /data-node-kind="decision"/);
  assert.match(html, /data-edge-id="e-check-exception"/);
  const ledger = html.match(/<g id="node-ledger"[\s\S]*?<\/g>/)?.[0];
  assert.ok(ledger, 'Update ledger node should be rendered');
  assert.match(ledger, /<path d="M 854 124 C 854 119 986 119 986 124 V 172 C 986 177 854 177 854 172 Z" class="c-database" stroke-width="0"\/>/);
  assert.match(ledger, /<path d="M 854 124 V 172 C 854 177 986 177 986 172 V 124" class="c-database" fill="none" stroke-width="1\.5"\/>/);
  assert.equal((ledger.match(/class="c-database"/g) || []).length, 3, 'data-store should have one fill path, one open outline, and one top ellipse');
  assert.doesNotMatch(ledger, /class="c-database" stroke-width="1\.5"\/>\s*<ellipse/);
});

test('business-flow: schema and semantic diagnostics reject invalid decisions and unknown fields', () => {
  const doc = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  doc.unexpected = true;
  const unknownPath = path.join(scratch, 'unknown.json');
  fs.writeFileSync(unknownPath, JSON.stringify(doc));
  const unknown = run(['validate', 'business-flow', unknownPath, '--json']);
  assert.notEqual(unknown.status, 0);
  const unknownReceipt = JSON.parse(unknown.stdout);
  assert.ok(unknownReceipt.diagnostics.some((entry) => entry.code === 'schema/additionalProperties'));

  const invalid = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  invalid.edges = invalid.edges.filter((edge) => edge.from !== 'check' || edge.to !== 'exception');
  const invalidPath = path.join(scratch, 'invalid-decision.json');
  fs.writeFileSync(invalidPath, JSON.stringify(invalid));
  const invalidResult = run(['validate', 'business-flow', invalidPath, '--json']);
  assert.notEqual(invalidResult.status, 0);
  const invalidReceipt = JSON.parse(invalidResult.stdout);
  assert.ok(invalidReceipt.diagnostics.some((entry) => entry.code === 'business-flow/decision-branch-count'));

  const invalidRole = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  invalidRole.edges.find((edge) => edge.id === 'e-check-fulfill').role = 'maybe';
  const invalidRolePath = path.join(scratch, 'invalid-decision-role.json');
  fs.writeFileSync(invalidRolePath, JSON.stringify(invalidRole));
  const invalidRoleResult = run(['validate', 'business-flow', invalidRolePath, '--json']);
  assert.notEqual(invalidRoleResult.status, 0);
  const invalidRoleReceipt = JSON.parse(invalidRoleResult.stdout);
  assert.ok(invalidRoleReceipt.diagnostics.some((entry) => entry.code === 'schema/enum'));

  const invalidInputSide = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  invalidInputSide.edges.find((edge) => edge.id === 'e-capture-check').toSide = 'left';
  const invalidInputSidePath = path.join(scratch, 'invalid-decision-input-side.json');
  fs.writeFileSync(invalidInputSidePath, JSON.stringify(invalidInputSide));
  const invalidInputSideResult = run(['validate', 'business-flow', invalidInputSidePath, '--json']);
  assert.notEqual(invalidInputSideResult.status, 0);
  const invalidInputSideReceipt = JSON.parse(invalidInputSideResult.stdout);
  assert.ok(invalidInputSideReceipt.diagnostics.some((entry) => entry.code === 'business-flow/decision-input-side'));

  const invalidOutputSide = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  invalidOutputSide.edges.find((edge) => edge.id === 'e-check-fulfill').fromSide = 'top';
  const invalidOutputSidePath = path.join(scratch, 'invalid-decision-output-side.json');
  fs.writeFileSync(invalidOutputSidePath, JSON.stringify(invalidOutputSide));
  const invalidOutputSideResult = run(['validate', 'business-flow', invalidOutputSidePath, '--json']);
  assert.notEqual(invalidOutputSideResult.status, 0);
  const invalidOutputSideReceipt = JSON.parse(invalidOutputSideResult.stdout);
  assert.ok(invalidOutputSideReceipt.diagnostics.some((entry) => entry.code === 'business-flow/decision-output-side'));
});

test('business-flow: cross-lane, retry, and shape-aware route endpoints survive validation', () => {
  const output = path.join(scratch, 'refund.html');
  const result = run(['render', 'business-flow', refundFixture, output]);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /data-edge-id="e-info-retry"[^>]*data-composition-points="[^"]+"/);
  assert.match(html, /data-edge-id="e-ledger-complete"[^>]*data-composition-points="1146,616;1364,616;1364,92;1240,92;1240,116"/);
  assert.match(html, /data-edge-id="e-inspect-reject"[^>]*marker-end/);
});

test('business-flow: decision ports reserve top for input, default yes/no outputs, and allow swapped sides', () => {
  const standardOutput = path.join(scratch, 'decision-ports-standard.html');
  const standard = run(['render', 'business-flow', fixture, standardOutput]);
  assert.equal(standard.status, 0, standard.stderr);
  const standardHtml = fs.readFileSync(standardOutput, 'utf8');

  assert.deepEqual(edgePoints(standardHtml, 'e-capture-check').at(0), [506, 148], 'decision input starts at the source shape');
  assert.deepEqual(edgePoints(standardHtml, 'e-capture-check').at(-1), [600, 116], 'decision input lands on the top tip');
  assert.deepEqual(edgePoints(standardHtml, 'e-check-fulfill').at(0), [600, 180], 'yes defaults to the bottom tip');
  assert.deepEqual(edgePoints(standardHtml, 'e-check-exception').at(0), [668, 148], 'no defaults to the right corner for a right-side target');

  const swapped = JSON.parse(fs.readFileSync(fixture, 'utf8'));
  const yes = swapped.edges.find((edge) => edge.id === 'e-check-fulfill');
  const no = swapped.edges.find((edge) => edge.id === 'e-check-exception');
  yes.role = 'no';
  yes.fromSide = 'bottom';
  no.role = 'yes';
  no.fromSide = 'right';
  const swappedInput = path.join(scratch, 'decision-ports-swapped.json');
  const swappedOutput = path.join(scratch, 'decision-ports-swapped.html');
  fs.writeFileSync(swappedInput, JSON.stringify(swapped));
  const swappedResult = run(['render', 'business-flow', swappedInput, swappedOutput]);
  assert.equal(swappedResult.status, 0, swappedResult.stderr);
  const swappedHtml = fs.readFileSync(swappedOutput, 'utf8');
  assert.deepEqual(edgePoints(swappedHtml, 'e-check-fulfill').at(0), [600, 180], 'explicit fromSide keeps no below');
  assert.deepEqual(edgePoints(swappedHtml, 'e-check-exception').at(0), [668, 148], 'explicit fromSide moves yes to the right corner');

  const refundOutput = path.join(scratch, 'decision-ports-multiple-no.html');
  const refund = run(['render', 'business-flow', refundFixture, refundOutput]);
  assert.equal(refund.status, 0, refund.stderr);
  const refundHtml = fs.readFileSync(refundOutput, 'utf8');
  assert.deepEqual(edgePoints(refundHtml, 'e-receive-inspect'), [[664, 382], [676, 382], [676, 334], [760, 334], [760, 350]], 'primary decision input keeps its own approach corridor');
  assert.deepEqual(edgePoints(refundHtml, 'e-info-retry'), [[854, 470], [844, 470], [844, 316], [760, 316], [760, 350]], 'retry input uses a separate top approach height without merging into the primary input');
  assert.deepEqual(edgePoints(refundHtml, 'e-inspect-info').at(0), [828, 382], 'first no branch uses the decision right corner');
  assert.deepEqual(edgePoints(refundHtml, 'e-inspect-reject').at(0), [828, 382], 'multiple no branches may share the same real corner port');
});

test('business-flow: render, validate, preview, and deliver CLI commands are registered', { timeout: 30000 }, async () => {
  const renderOutput = path.join(scratch, 'cli-render.html');
  const render = run(['render', 'business-flow', fixture, renderOutput]);
  assert.equal(render.status, 0, render.stderr);
  const validate = run(['validate', 'business-flow', fixture, '--quality', 'showcase', '--json']);
  assert.equal(validate.status, 0, validate.stderr);
  assert.equal(JSON.parse(validate.stdout).type, 'business-flow');

  const deliverOutput = path.join(scratch, 'cli-deliver.html');
  const deliver = run(['deliver', 'business-flow', fixture, deliverOutput, '--quality', 'showcase', '--json']);
  assert.equal(deliver.status, 0, deliver.stderr);
  assert.equal(JSON.parse(deliver.stdout).ok, true);

  const previewOutput = path.join(scratch, 'cli-preview.html');
  const preview = spawn(process.execPath, [cli, 'preview', 'business-flow', fixture, previewOutput, '--no-open', '--quality', 'showcase'], {
    cwd: skillRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  preview.stdout.setEncoding('utf8');
  preview.stderr.setEncoding('utf8');
  preview.stdout.on('data', (chunk) => { stdout += chunk; });
  preview.stderr.on('data', (chunk) => { stderr += chunk; });
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      preview.kill('SIGKILL');
      reject(new Error(`business-flow preview did not publish: ${stdout}\n${stderr}`));
    }, 18000);
    const poll = setInterval(() => {
      if (!fs.existsSync(previewOutput)) return;
      clearInterval(poll);
      clearTimeout(deadline);
      preview.kill('SIGINT');
      resolve();
    }, 100);
    preview.once('error', (error) => {
      clearInterval(poll);
      clearTimeout(deadline);
      reject(error);
    });
  });
  await new Promise((resolve) => preview.once('close', resolve));
  assert.match(stdout, /preview http:\/\/127\.0\.0\.1:/);
  assert.ok(fs.existsSync(previewOutput));
});

function adaptiveChain(direction, length = 4) {
  const nodes = Array.from({ length }, (_, index) => ({
    id: `n${index}`,
    kind: index === 0 ? 'start' : (index === length - 1 ? 'end' : 'process'),
    label: index === 0 ? '开始' : (index === length - 1 ? '完成' : `处理${index}`),
  }));
  return {
    schema_version: 1,
    diagram_type: 'business-flow',
    meta: { title: `自适应${direction}`, layout_direction: direction },
    lanes: [{ id: 'main', label: '主流程' }],
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `e${index}`,
      from: node.id,
      to: nodes[index + 1].id,
      role: 'main',
    })),
  };
}

function nodeRect(html, id) {
  const group = html.match(new RegExp(`<g id="node-${id}"[\\s\\S]*?<\\/g>`));
  assert.ok(group, `missing node group ${id}`);
  const match = group[0].match(/<rect x="([0-9.-]+)" y="([0-9.-]+)"/);
  assert.ok(match, `missing rectangular shape for ${id}`);
  return [Number(match[1]), Number(match[2])];
}

function laneFrame(html, index = 0) {
  const match = html.match(new RegExp(`data-composition-frame-kind="lane" data-composition-frame-id="lane-${index}" x="([0-9.-]+)" y="([0-9.-]+)" width="([0-9.-]+)" height="([0-9.-]+)"`));
  assert.ok(match, `missing lane frame ${index}`);
  return { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) };
}

function viewBoxSize(html) {
  const match = html.match(/<svg viewBox="0 0 ([0-9.-]+) ([0-9.-]+)"/);
  assert.ok(match, 'missing SVG viewBox');
  return [Number(match[1]), Number(match[2])];
}

test('business-flow: explicit adaptive directions derive deterministic slots and expand the canvas', () => {
  for (const direction of ['horizontal', 'vertical']) {
    const doc = adaptiveChain(direction, 15);
    const input = path.join(scratch, `adaptive-${direction}.json`);
    const output = path.join(scratch, `adaptive-${direction}.html`);
    fs.writeFileSync(input, JSON.stringify(doc));
    const result = run(['render', 'business-flow', input, output]);
    assert.equal(result.status, 0, `${direction}: ${result.stderr}`);
    const html = fs.readFileSync(output, 'utf8');
    const positions = doc.nodes.map((node) => nodeRect(html, node.id));
    const axis = direction === 'horizontal' ? 0 : 1;
    for (let index = 1; index < positions.length; index += 1) {
      assert.ok(positions[index][axis] > positions[index - 1][axis], `${direction} slot ${index}`);
    }
    const [width, height] = viewBoxSize(html);
    if (direction === 'horizontal') assert.ok(width > 1380, `horizontal width ${width}`);
    else assert.ok(height > 1380, `vertical height ${height}`);
  }
});

test('business-flow: horizontal adaptive lane width contains a long lane title', () => {
  const doc = adaptiveChain('horizontal', 4);
  const label = `Operations ${'lane '.repeat(44)}`;
  doc.lanes[0].label = label;
  const input = path.join(scratch, 'adaptive-horizontal-long-lane-title.json');
  const output = path.join(scratch, 'adaptive-horizontal-long-lane-title.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = run(['render', 'business-flow', input, output]);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const frame = laneFrame(html);
  const [width] = viewBoxSize(html);
  const titleWidth = (`01 / ${label}`).length * 6.7 + 28;
  assert.ok(frame.width >= titleWidth, `lane width ${frame.width} should contain title width ${titleWidth}`);
  assert.ok(width >= frame.x + frame.width + 48, 'viewBox should include the expanded lane width and margin');
});

test('business-flow: vertical adaptive forward edges use bottom-to-top normals across lanes', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'business-flow',
    meta: { title: '纵向跨泳道端点', layout_direction: 'vertical' },
    lanes: [
      { id: 'source-lane', label: '来源' },
      { id: 'target-lane', label: '目标' },
    ],
    nodes: [
      { id: 'start', kind: 'start', label: '开始', lane: 'source-lane' },
      { id: 'source', kind: 'process', label: '来源节点', lane: 'source-lane' },
      { id: 'target', kind: 'process', label: '目标节点', lane: 'target-lane' },
      { id: 'finish', kind: 'end', label: '完成', lane: 'target-lane' },
    ],
    edges: [
      { id: 'e-start-source', from: 'start', to: 'source', role: 'main' },
      { id: 'e-source-target', from: 'source', to: 'target', role: 'main' },
      { id: 'e-target-finish', from: 'target', to: 'finish', role: 'main' },
    ],
  };
  const input = path.join(scratch, 'adaptive-vertical-cross-lane.json');
  const output = path.join(scratch, 'adaptive-vertical-cross-lane.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = run(['render', 'business-flow', input, output]);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const source = nodeRect(html, 'source');
  const target = nodeRect(html, 'target');
  const points = edgePoints(html, 'e-source-target');
  assert.deepEqual(points[0], [source[0] + 64, source[1] + 64], 'source should leave from its bottom edge');
  assert.equal(points[1][0], points[0][0], 'source endpoint segment should follow the vertical time axis');
  assert.ok(points[1][1] > points[0][1], 'source endpoint segment should leave downward');
  assert.deepEqual(points.at(-1), [target[0] + 64, target[1]], 'target should receive at its top edge');
  assert.equal(points.at(-2)[0], points.at(-1)[0], 'target endpoint segment should follow the vertical time axis');
  assert.ok(points.at(-2)[1] < points.at(-1)[1], 'target endpoint segment should approach upward');
  assert.ok(points.length >= 4, 'cross-lane route should include a lane corridor');

  const authored = JSON.parse(JSON.stringify(doc));
  const handoff = authored.edges.find((edge) => edge.id === 'e-source-target');
  handoff.fromSide = 'left';
  handoff.toSide = 'right';
  const authoredInput = path.join(scratch, 'adaptive-vertical-cross-lane-authored-sides.json');
  const authoredOutput = path.join(scratch, 'adaptive-vertical-cross-lane-authored-sides.html');
  fs.writeFileSync(authoredInput, JSON.stringify(authored));
  const authoredResult = run(['render', 'business-flow', authoredInput, authoredOutput]);
  assert.equal(authoredResult.status, 0, authoredResult.stderr);
  const authoredPoints = edgePoints(fs.readFileSync(authoredOutput, 'utf8'), 'e-source-target');
  assert.ok(authoredPoints[1][0] < authoredPoints[0][0], 'authored left source side should remain leftward');
  assert.ok(authoredPoints.at(-2)[0] > authoredPoints.at(-1)[0], 'authored right target side should remain rightward into the target');
});

test('business-flow: adaptive paths retain decision shapes, labels, and semantic identities', () => {
  for (const direction of ['horizontal', 'vertical']) {
    const doc = JSON.parse(fs.readFileSync(fixture, 'utf8'));
    doc.meta = { title: `自适应决策${direction}`, layout_direction: direction };
    doc.nodes = doc.nodes.map(({ row, col, yOffset, ...node }) => node);
    doc.edges = doc.edges.map(({ labelAt, ...edge }) => edge);
    const input = path.join(scratch, `adaptive-decision-${direction}.json`);
    const output = path.join(scratch, `adaptive-decision-${direction}.html`);
    fs.writeFileSync(input, JSON.stringify(doc));
    const result = run(['render', 'business-flow', input, output]);
    assert.equal(result.status, 0, `${direction}: ${result.stderr}`);
    const html = fs.readFileSync(output, 'utf8');
    assert.match(html, /data-business-shape="decision"/);
    assert.match(html, /data-edge-id="e-check-fulfill"/);
    assert.match(html, /data-edge-id="e-check-exception"/);
  }
});

test('business-flow: adaptive same-lane conflicts move in declaration order and parallel lanes share a slot', () => {
  const doc = {
    schema_version: 1,
    diagram_type: 'business-flow',
    meta: { title: '自适应分支', layout_direction: 'horizontal' },
    lanes: [
      { id: 'main', label: '主流程' },
      { id: 'left', label: '左支线' },
      { id: 'right', label: '右支线' },
    ],
    nodes: [
      { id: 'start', kind: 'start', label: '开始', lane: 'main' },
      { id: 'same-a', kind: 'process', label: '同泳道一', lane: 'main' },
      { id: 'same-b', kind: 'process', label: '同泳道二', lane: 'main' },
      { id: 'parallel-a', kind: 'process', label: '并行一', lane: 'left' },
      { id: 'parallel-b', kind: 'process', label: '并行二', lane: 'right' },
      { id: 'finish', kind: 'end', label: '完成', lane: 'main' },
    ],
    edges: [
      { id: 'e-start-a', from: 'start', to: 'same-a', role: 'main' },
      { id: 'e-start-b', from: 'start', to: 'same-b', role: 'main' },
      { id: 'e-start-pa', from: 'start', to: 'parallel-a', role: 'branch' },
      { id: 'e-start-pb', from: 'start', to: 'parallel-b', role: 'branch' },
      { id: 'e-a-finish', from: 'same-a', to: 'finish', role: 'main' },
      { id: 'e-b-finish', from: 'same-b', to: 'finish', role: 'main' },
      { id: 'e-pa-finish', from: 'parallel-a', to: 'finish', role: 'main' },
      { id: 'e-pb-finish', from: 'parallel-b', to: 'finish', role: 'main' },
    ],
  };
  const input = path.join(scratch, 'adaptive-conflict.json');
  const output = path.join(scratch, 'adaptive-conflict.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = run(['render', 'business-flow', input, output]);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  assert.ok(nodeRect(html, 'same-b')[0] > nodeRect(html, 'same-a')[0]);
  assert.equal(nodeRect(html, 'parallel-a')[0], nodeRect(html, 'parallel-b')[0]);
});

test('business-flow: adaptive parallel authored edges with one endpoint pair do not duplicate topology visits', () => {
  const doc = adaptiveChain('horizontal');
  doc.edges = [
    { id: 'e-primary', from: 'n0', to: 'n1', role: 'main' },
    { id: 'e-secondary', from: 'n0', to: 'n1', role: 'async' },
    { id: 'e-continue', from: 'n1', to: 'n2', role: 'main' },
    { id: 'e-finish', from: 'n2', to: 'n3', role: 'main' },
  ];
  const input = path.join(scratch, 'adaptive-parallel-edges.json');
  const firstOutput = path.join(scratch, 'adaptive-parallel-edges-first.html');
  const secondOutput = path.join(scratch, 'adaptive-parallel-edges-second.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  const validation = run(['validate', 'business-flow', input, '--json']);
  assert.equal(validation.status, 0, validation.stderr);
  assert.doesNotMatch(validation.stdout, /forward-cycle/);
  const first = run(['render', 'business-flow', input, firstOutput]);
  const second = run(['render', 'business-flow', input, secondOutput]);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(firstOutput, 'utf8'), fs.readFileSync(secondOutput, 'utf8'));
});

test('business-flow: adaptive schema contract rejects grid coordinates, invalid direction, and forward cycles', () => {
  const adaptive = adaptiveChain('horizontal');
  adaptive.nodes[1].row = 0;
  const gridPath = path.join(scratch, 'adaptive-grid-field.json');
  fs.writeFileSync(gridPath, JSON.stringify(adaptive));
  const gridResult = run(['validate', 'business-flow', gridPath, '--json']);
  assert.notEqual(gridResult.status, 0);
  assert.ok(JSON.parse(gridResult.stdout).diagnostics.some((entry) => entry.code === 'business-flow/adaptive-grid-field'));

  const invalidDirection = adaptiveChain('diagonal');
  const invalidPath = path.join(scratch, 'adaptive-invalid-direction.json');
  fs.writeFileSync(invalidPath, JSON.stringify(invalidDirection));
  const invalidResult = run(['validate', 'business-flow', invalidPath, '--json']);
  assert.notEqual(invalidResult.status, 0);
  assert.ok(JSON.parse(invalidResult.stdout).diagnostics.some((entry) => entry.code === 'schema/enum'));

  const cycle = adaptiveChain('vertical');
  cycle.nodes[1].id = 'a';
  cycle.nodes[2].id = 'b';
  cycle.edges = [
    { id: 'e-start-a', from: 'n0', to: 'a', role: 'main' },
    { id: 'e-a-b', from: 'a', to: 'b', role: 'main' },
    { id: 'e-b-a', from: 'b', to: 'a', role: 'main' },
    { id: 'e-b-end', from: 'b', to: 'n3', role: 'main' },
  ];
  const cyclePath = path.join(scratch, 'adaptive-cycle.json');
  fs.writeFileSync(cyclePath, JSON.stringify(cycle));
  const cycleResult = run(['validate', 'business-flow', cyclePath, '--json']);
  assert.notEqual(cycleResult.status, 0);
  assert.ok(JSON.parse(cycleResult.stdout).diagnostics.some((entry) => entry.code === 'business-flow/forward-cycle'));
});

test('business-flow: adaptive return edges route outside ordering and explicit viewBox is a minimum', () => {
  const doc = adaptiveChain('vertical');
  doc.meta.viewBox = [700, 240];
  doc.edges.push({ id: 'e-return', from: 'n2', to: 'n1', role: 'return' });
  const input = path.join(scratch, 'adaptive-return.json');
  const output = path.join(scratch, 'adaptive-return.html');
  fs.writeFileSync(input, JSON.stringify(doc));
  const result = run(['render', 'business-flow', input, output]);
  assert.equal(result.status, 0, result.stderr);
  const html = fs.readFileSync(output, 'utf8');
  const [width, height] = viewBoxSize(html);
  assert.ok(width >= 700 && height > 240);
  const returnPoints = edgePoints(html, 'e-return');
  assert.ok(returnPoints.some(([x]) => x > 180), 'return route should use an outer side channel');
});

process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
