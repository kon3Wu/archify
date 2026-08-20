import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const cli = path.join(root, 'archify', 'bin', 'archify.mjs');
const evidenceDir = path.join(root, 'artifacts', 'bf008', 'e2e');
const commandLog = [];

const relative = (value) => path.relative(root, value).replaceAll('\\', '/');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function runProcess(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
  });
  commandLog.push({
    command: [command, ...args.map((arg) => `${arg}`)].join(' '),
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  return result;
}

function runCli(args) {
  return runProcess(process.execPath, [cli, ...args]);
}

function receipt(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  return parsed;
}

function viewBoxSize(html) {
  const match = html.match(/<svg viewBox="0 0 ([0-9.-]+) ([0-9.-]+)"/);
  assert.ok(match, 'missing SVG viewBox');
  return [Number(match[1]), Number(match[2])];
}

function nodePosition(html, id) {
  const group = html.match(new RegExp(`<g id="node-${id}"[\\s\\S]*?<\\/g>`));
  assert.ok(group, `missing node ${id}`);
  const shape = group[0].match(/<(?:rect|polygon|path)[^>]*(?:x="([0-9.-]+)" y="([0-9.-]+)"|points="([0-9.-]+),([0-9.-]+))/);
  assert.ok(shape, `missing measurable shape for ${id}`);
  return [Number(shape[1] ?? shape[3]), Number(shape[2] ?? shape[4])];
}

function edgePoints(html, id) {
  const match = html.match(new RegExp(`data-edge-id="${id}"[^>]*data-composition-points="([^"]+)"`));
  assert.ok(match, `missing edge ${id}`);
  return match[1].split(';').map((point) => point.split(',').map(Number));
}

function longHorizontalInput() {
  const nodes = Array.from({ length: 15 }, (_, index) => ({
    id: `step-${index}`,
    kind: index === 0 ? 'start' : (index === 14 ? 'end' : 'process'),
    label: index === 0 ? '开始' : (index === 14 ? '完成' : `步骤${index}`),
    lane: 'main',
  }));
  return {
    schema_version: 1,
    diagram_type: 'business-flow',
    meta: { title: 'BF-008 横向长流程', layout_direction: 'horizontal' },
    lanes: [{ id: 'main', label: '主流程' }],
    nodes,
    edges: nodes.slice(0, -1).map((node, index) => ({
      id: `edge-${index}`,
      from: node.id,
      to: nodes[index + 1].id,
      role: 'main',
    })),
  };
}

const cases = [
  {
    id: 'BF008-E2E-01',
    run() {
      const output = path.join(evidenceDir, 'legacy.html');
      const result = runCli(['render', 'business-flow', path.join(root, 'archify', 'examples', 'standard-business-flow.business-flow.json'), output]);
      assert.equal(result.status, 0, result.stderr);
      const expected = fs.readFileSync(path.join(root, 'archify', 'examples', 'business-flow-standard-rendered.html'));
      const actual = fs.readFileSync(output);
      assert.deepEqual(actual, expected);
      return { evidence: relative(output), sha256: sha256(actual), bytes: actual.length };
    },
  },
  {
    id: 'BF008-E2E-02',
    run() {
      const input = path.join(evidenceDir, 'horizontal-input.json');
      const output = path.join(evidenceDir, 'horizontal.html');
      const repeated = path.join(evidenceDir, 'horizontal-repeat.html');
      fs.writeFileSync(input, `${JSON.stringify(longHorizontalInput(), null, 2)}\n`);
      const firstReceipt = receipt(runCli(['deliver', 'business-flow', input, output, '--quality', 'showcase', '--json']));
      assert.equal(firstReceipt.validation.checksPassed, firstReceipt.validation.checkCount);
      assert.equal(firstReceipt.validation.compositionStatus, 'pass');
      receipt(runCli(['deliver', 'business-flow', input, repeated, '--quality', 'showcase', '--json']));
      const html = fs.readFileSync(output, 'utf8');
      const positions = Array.from({ length: 15 }, (_, index) => nodePosition(html, `step-${index}`)[0]);
      for (let index = 1; index < positions.length; index += 1) assert.ok(positions[index] > positions[index - 1]);
      assert.ok(viewBoxSize(html)[0] > 1380);
      assert.equal(fs.readFileSync(repeated, 'utf8'), html);
      return { evidence: relative(output), checks: firstReceipt.validation.checksPassed, width: viewBoxSize(html)[0] };
    },
  },
  {
    id: 'BF008-E2E-03',
    run() {
      const input = path.join(root, 'archify', 'examples', 'adaptive-business-flow-vertical.business-flow.json');
      const output = path.join(evidenceDir, 'vertical.html');
      const delivered = receipt(runCli(['deliver', 'business-flow', input, output, '--quality', 'showcase', '--json']));
      assert.equal(delivered.validation.checksPassed, delivered.validation.checkCount);
      assert.equal(delivered.validation.compositionStatus, 'pass');
      const html = fs.readFileSync(output, 'utf8');
      for (const id of ['e-decide-approve', 'e-decide-reject', 'e-approve-merge', 'e-reject-merge', 'e-request-decide', 'e-merge-retry']) {
        assert.match(html, new RegExp(`data-edge-id="${id}"`));
      }
      const points = edgePoints(html, 'e-request-decide');
      assert.equal(points[0][0], points[1][0]);
      assert.ok(points[1][1] > points[0][1]);
      assert.equal(points.at(-2)[0], points.at(-1)[0]);
      assert.ok(points.at(-1)[1] > points.at(-2)[1]);
      return { evidence: relative(output), checks: delivered.validation.checksPassed, routePoints: points };
    },
  },
  {
    id: 'BF008-E2E-04',
    run() {
      const input = path.join(evidenceDir, 'cycle-input.json');
      const output = path.join(evidenceDir, 'cycle.html');
      const document = {
        schema_version: 1,
        diagram_type: 'business-flow',
        meta: { title: 'BF-008 非法循环', layout_direction: 'vertical' },
        lanes: [{ id: 'main', label: '主流程' }],
        nodes: [
          { id: 'start', kind: 'start', label: '开始', lane: 'main' },
          { id: 'a', kind: 'process', label: '节点A', lane: 'main' },
          { id: 'b', kind: 'process', label: '节点B', lane: 'main' },
          { id: 'end', kind: 'end', label: '结束', lane: 'main' }
        ],
        edges: [
          { id: 'e-start-a', from: 'start', to: 'a', role: 'main' },
          { id: 'e-a-b', from: 'a', to: 'b', role: 'main' },
          { id: 'e-b-a', from: 'b', to: 'a', role: 'main' },
          { id: 'e-b-end', from: 'b', to: 'end', role: 'main' }
        ]
      };
      fs.writeFileSync(input, `${JSON.stringify(document, null, 2)}\n`);
      const result = runCli(['deliver', 'business-flow', input, output, '--quality', 'showcase', '--json']);
      assert.notEqual(result.status, 0);
      const failed = JSON.parse(result.stdout);
      assert.ok(failed.diagnostics.some((diagnostic) => diagnostic.code === 'business-flow/forward-cycle'));
      assert.equal(fs.existsSync(output), false);
      return { evidence: relative(input), diagnostic: 'business-flow/forward-cycle' };
    },
  },
];

if (process.argv.includes('--list')) {
  process.stdout.write(`${JSON.stringify({ mode: 'DELTA', workPackage: 'BF-008', cases: cases.map(({ id }) => id) }, null, 2)}\n`);
  process.exit(0);
}

fs.mkdirSync(evidenceDir, { recursive: true });
const startedAt = new Date().toISOString();
const results = [];
for (const current of cases) {
  try {
    const details = current.run();
    results.push({ id: current.id, status: 'pass', details });
  } catch (error) {
    results.push({ id: current.id, status: 'fail', error: error?.stack || `${error}` });
  }
}
const regressionSpecs = [
  { id: 'BF008-REG-01', command: process.execPath, args: ['--test', 'archify/test/business-flow.test.mjs'] },
  { id: 'BF008-REG-02', command: process.execPath, args: ['archify/scripts/generate-validators.mjs', '--check'] },
  { id: 'BF008-REG-03', command: process.execPath, args: ['archify/test/golden.mjs'] },
];
const regression = regressionSpecs.map((spec) => {
  const result = runProcess(spec.command, spec.args);
  return {
    id: spec.id,
    status: result.status === 0 ? 'pass' : 'fail',
    command: [spec.command, ...spec.args].join(' '),
    firstError: result.status === 0
      ? null
      : (result.error?.message || result.stderr || result.stdout || 'process failed without output').split(/\r?\n/).find(Boolean),
  };
});
const summary = {
  schemaVersion: 1,
  mode: 'DELTA',
  workPackage: 'BF-008',
  startedAt,
  finishedAt: new Date().toISOString(),
  counts: {
    pass: results.filter((result) => result.status === 'pass').length,
    fail: results.filter((result) => result.status === 'fail').length,
    blocked: 0,
    notRun: 0,
  },
  results,
  regression,
  boundary: 'Local Node.js CLI and generated HTML; not a release-level result.',
};
fs.writeFileSync(path.join(evidenceDir, 'commands.json'), `${JSON.stringify(commandLog, null, 2)}\n`);
fs.writeFileSync(path.join(evidenceDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
if (summary.counts.fail || regression.some((result) => result.status !== 'pass')) process.exitCode = 1;
