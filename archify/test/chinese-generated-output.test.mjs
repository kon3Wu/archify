import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const skillRoot = path.resolve(here, '..');
const examplesRoot = path.join(skillRoot, 'examples');
const rendererRoot = path.join(skillRoot, 'renderers');
const templatePath = path.join(skillRoot, 'assets', 'template.html');

const TYPES = Object.freeze([
  'architecture',
  'business-flow',
  'workflow',
  'sequence',
  'dataflow',
  'lifecycle',
]);

const REPRESENTATIVE_INPUTS = Object.freeze({
  architecture: 'web-app.architecture.json',
  'business-flow': 'refund-approval.business-flow.json',
  workflow: 'agent-tool-call.workflow.json',
  sequence: 'cache-miss-request.sequence.json',
  dataflow: 'product-analytics.dataflow.json',
  lifecycle: 'agent-run.lifecycle.json',
});

const EXPECTED_LEGEND_LABELS = Object.freeze({
  architecture: ['前端', '后端', '数据库', '云服务', '安全', '消息总线', '外部系统'],
  'business-flow': ['开始', '结束', '处理', '决策', '数据存储', '文档', '手动输入', '子流程', '外部系统'],
  workflow: ['用户界面', '智能体逻辑', '策略', '工具操作', '上下文 / 追踪', '云服务', '外部系统'],
  sequence: ['请求', '返回', '安全', '异步追踪', '默认消息'],
  dataflow: ['主数据', '策略 / PII', '异步批处理', '数据存储', '数据流'],
  lifecycle: ['开始', '活动状态', '等待', '决策', '终态成功', '失败 / 退出', '中性', '外部'],
});

// This list is deliberately finite. It covers protocols, API/product names,
// formats, formal deployment terms, and stable identifiers used by the
// canonical examples. It is not a general ASCII escape hatch for prose.
const ALLOWED_TECHNICAL_WORDS = new Set([
  'Agent', 'Android', 'API', 'Archify', 'AWS', 'AZ', 'CDN', 'CloudFront', 'CSS',
  'DLQ', 'DR', 'Enter', 'Esc', 'FastAPI', 'GET', 'HTML', 'HTTPS', 'ID', 'IR', 'JSON', 'JPEG', 'JWT', 'Kafka',
  'MCP', 'MIT', 'ML', 'mTLS', 'OAI', 'OAuth', 'OTLP', 'PII', 'PKCE', 'PNG', 'POST',
  'Pod', 'Postgres', 'PostgreSQL', 'Pull', 'React', 'Redis', 'Request', 'Runbook',
  'S3', 'SDK', 'SEV', 'SLO', 'SQS', 'SRE', 'SQL', 'SRC', 'SVG', 'TLS', 'UI',
  'VPC', 'WAF', 'WAL', 'Web', 'WebM', 'Webhook', 'WebP', 'LB', 'iOS',
]);

const ALLOWED_TECHNICAL_IDENTIFIERS = new Set([
  '200', '202', '8000', '443', '5432', '6379', '10%', 'v1', 'v2',
  'AZ-a', 'AZ-b', 'SEV-1/2', 'eu-west-1', 'us-east-1', 'us-west-2',
  'diagram_type', 'OrderPlaced', 'PaymentCaptured', 'order_id', 'orders.v1', 'payments.v2', 'events.dlq', 'job.completed',
  'sg-api', 'POST /jobs', 'GET /jobs/:id', 'GET /dashboard', 'SQL tx',
]);

const READER_KEYS = new Set(['classification', 'label', 'note', 'sublabel', 'subtitle', 'tag', 'title']);
const FORBIDDEN_READER_PHRASES = [
  'Copy link',
  'Download SVG',
  'Share Card',
  'primary data',
  'async trace',
  'default message',
  'active state',
  'terminal success',
  'failure / exit',
  'Message bus',
];

function englishTokens(value) {
  return String(value).match(/[A-Za-z][A-Za-z0-9]*(?:[-_./:][A-Za-z0-9]+)*/g) || [];
}

function unknownEnglish(value) {
  let remaining = String(value);
  for (const phrase of [...ALLOWED_TECHNICAL_IDENTIFIERS, 'Pull Request'].sort((left, right) => right.length - left.length)) {
    remaining = remaining.split(phrase).join(' ');
  }
  return englishTokens(remaining).filter((token) => {
    if (token.length <= 1) return false;
    if (ALLOWED_TECHNICAL_WORDS.has(token)) return false;
    if (ALLOWED_TECHNICAL_IDENTIFIERS.has(token)) return false;
    return true;
  });
}

function assertChineseCopy(value, where) {
  const unknown = unknownEnglish(value);
  assert.deepEqual(unknown, [], `${where} contains non-allowlisted English reader text: ${unknown.join(', ')} in ${JSON.stringify(value)}`);
}

function collectReaderStrings(value, where, output) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectReaderStrings(item, `${where}[${index}]`, output));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const childWhere = `${where}.${key}`;
    if (key === 'items' && Array.isArray(child)) {
      child.forEach((item, index) => {
        if (typeof item === 'string') output.push([`${childWhere}[${index}]`, item]);
        else collectReaderStrings(item, `${childWhere}[${index}]`, output);
      });
    } else if (READER_KEYS.has(key) && typeof child === 'string') {
      output.push([childWhere, child]);
    } else {
      collectReaderStrings(child, childWhere, output);
    }
  }
}

function extractQuotedStrings(line) {
  const values = [];
  const re = /(['"])((?:\\.|(?!\1)[\s\S])*?)\1/g;
  let match;
  while ((match = re.exec(line))) values.push(match[2]);
  return values;
}

function copyValuesFromLine(line) {
  if (line.includes('<')) {
    return [...line.matchAll(/(?:aria-label|placeholder|title)="([^"]*)"/gi)].map((match) => match[1]);
  }
  return extractQuotedStrings(line);
}

function readerMarkupStrings(html) {
  const copy = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const strings = [];
  const text = copy.replace(/<[^>]+>/g, ' ').replace(/&(?:bull|nbsp|times);/gi, ' ');
  strings.push(['visible text', text]);
  for (const match of copy.matchAll(/\b(?:aria-label|placeholder|title)="([^"]*)"/gi)) {
    strings.push(['reader attribute', match[1]]);
  }
  return strings;
}

function renderExample(type, input, output) {
  execFileSync(process.execPath, [
    path.join(rendererRoot, type, `render-${type}.mjs`),
    input,
    output,
  ], { cwd: skillRoot, stdio: ['ignore', 'ignore', 'pipe'] });
}

test('generated Viewer is a Chinese-only reader surface', () => {
  const template = fs.readFileSync(templatePath, 'utf8');
  assert.match(template, /<html lang="zh-CN"/);
  assert.doesNotMatch(template, /id="language"|Switch language|切换到英文/);

  for (const phrase of [
    '图表操作', '切换颜色主题', '视觉样式', '导出图表', '分享卡片', '复制分享卡片',
    '引导式图表视图', '播放引导故事', '图表指南', '查找节点', '语义护照', '路径探针',
    '语义透镜', '语义雷达', '复制链接', '追踪有向路径', '进入演示舞台',
  ]) {
    assert.match(template, new RegExp(phrase), `Viewer must contain Chinese copy for ${phrase}`);
  }
  for (const phrase of FORBIDDEN_READER_PHRASES) {
    const copyLines = template.split(/\r?\n/).filter((line) =>
    /(textContent|aria-label\s*=|\.title\s*=|placeholder\s*:|resultsLabel\s*:|empty\s*:|alert\(|toast\()/.test(line));
    assert.equal(copyLines.some((line) => line.includes(phrase)), false, `reader-facing Viewer line contains ${phrase}`);
  }
  assert.match(template, /canvas2dOrThrow\(canvas, '分享卡片'\)/);
  assert.match(template, /toast\('已下载分享卡片'\)/);
  assert.match(template, /alert\('导出失败：'/);
  assert.match(template, /复制 PNG 到剪贴板/);

  const dynamicCopyLines = template.split(/\r?\n/).filter((line) =>
    /(textContent|aria-label\s*=|\.title\s*=|placeholder\s*:|resultsLabel\s*:|empty\s*:|alert\(|toast\()/.test(line)
      && !line.trim().startsWith('//'));
  for (const line of dynamicCopyLines) {
    for (const value of copyValuesFromLine(line)) {
      if (/\p{Script=Han}/u.test(value) || /[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(value)) {
        assertChineseCopy(value.replaceAll('[PROJECT NAME]', ''), `template dynamic copy line ${line.trim()}`);
      }
    }
  }
});

test('six renderer default legends and representative HTML are Chinese', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-zh-contract-'));
  try {
    for (const type of TYPES) {
      const renderer = fs.readFileSync(path.join(rendererRoot, type, `render-${type}.mjs`), 'utf8');
      for (const label of EXPECTED_LEGEND_LABELS[type]) {
        assert.match(renderer, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${type} legend is not localized: ${label}`);
      }
      const input = path.join(examplesRoot, REPRESENTATIVE_INPUTS[type]);
      const output = path.join(temp, `${type}.html`);
      renderExample(type, input, output);
      const html = fs.readFileSync(output, 'utf8');
      assert.match(html, /<html lang="zh-CN"/);
      assert.match(html, />图例</);
      for (const [where, copy] of readerMarkupStrings(html)) assertChineseCopy(copy, `${type} ${where}`);
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('all 15 canonical examples keep reader-facing fields Chinese with a finite English allowlist', () => {
  const files = fs.readdirSync(examplesRoot).filter((name) => name.endsWith('.json')).sort();
  assert.equal(files.length, 15, 'the canonical example set must contain exactly 15 JSON files');
  for (const name of files) {
    const document = JSON.parse(fs.readFileSync(path.join(examplesRoot, name), 'utf8'));
    const readerStrings = [];
    collectReaderStrings(document, name, readerStrings);
    assert.ok(readerStrings.length > 0, `${name} should expose reader-facing fields to audit`);
    for (const [where, value] of readerStrings) assertChineseCopy(value, where);
  }
});
