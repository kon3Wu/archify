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

process.on('exit', () => fs.rmSync(scratch, { recursive: true, force: true }));
