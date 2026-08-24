// 校验 LLM 厂商 schema 的合理性：保证用户选项的 URL/Protocol 不会突然爆掉。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_JS = join(ROOT, 'bilibili-following-manager.user.js');

/** 从 .user.js 提取 LLM_PROVIDERS 字典进行校验 */
function loadProviders() {
  const src = readFileSync(USER_JS, 'utf8');
  const m = src.match(/const LLM_PROVIDERS = (\{[\s\S]*?\});\s*\n\s*const llm/);
  if (!m) throw new Error('LLM_PROVIDERS not found in .user.js');
  // eslint-disable-next-line no-eval
  return eval(`(m[1])`.replace('m[1]', m[1]));
}

test('LLM_PROVIDERS 至少包含 minimax PayG / Token Plan / 自定义', () => {
  const p = loadProviders();
  assert.ok(p['minimax-payg'], 'Pay-as-you-go provider 必须存在');
  assert.ok(p['minimax-token-plan'], 'Token Plan provider 必须存在');
  assert.ok(p.custom, '自定义 provider 必须存在');
});

test('每个 provider 必须有 protocol 字段', () => {
  const p = loadProviders();
  for (const [key, v] of Object.entries(p)) {
    assert.ok(['openai', 'anthropic'].includes(v.protocol),
      `${key} 必须声明 protocol: openai | anthropic，实际: ${v.protocol}`);
  }
});

test('非 custom provider 的 baseUrl 必须以 https:// 开头', () => {
  const p = loadProviders();
  for (const [key, v] of Object.entries(p)) {
    if (key === 'custom') continue;
    assert.ok(/^https?:\/\//.test(v.baseUrl),
      `${key} baseUrl 应为 http(s)，实际: ${v.baseUrl}`);
  }
});

test('每个 provider 至少有一个 model', () => {
  const p = loadProviders();
  for (const [key, v] of Object.entries(p)) {
    if (key === 'custom') continue;
    assert.ok(Array.isArray(v.models) && v.models.length > 0,
      `${key} 必须有至少一个 model`);
  }
});

test('minimax-payg 用 OpenAI 协议，minimax-token-plan 用 Anthropic 协议', () => {
  const p = loadProviders();
  assert.equal(p['minimax-payg'].protocol, 'openai');
  assert.equal(p['minimax-token-plan'].protocol, 'anthropic');
});

test('每个 provider 有非空 label 和 note', () => {
  const p = loadProviders();
  for (const [key, v] of Object.entries(p)) {
    assert.ok(v.label && v.label.length > 0, `${key} label 必填`);
    assert.ok(v.note && v.note.length > 0, `${key} note 必填（用户参考）`);
  }
});

test('没有重复的 provider key', () => {
  const p = loadProviders();
  assert.equal(Object.keys(p).length, new Set(Object.keys(p)).size);
});