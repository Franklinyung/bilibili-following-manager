// Synchronisation test: ensures the .user.js contains the same fix
// as src/storage-logic.mjs. Without this, the test suite would
// pass on src/ but the actual deployed script would still have the bug.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_JS = join(ROOT, 'bilibili-following-manager.user.js');

test('.user.js 存在', () => {
  const content = readFileSync(USER_JS, 'utf8');
  assert.ok(content.length > 1000, '.user.js 文件应至少 1KB');
});

test('.user.js getInactiveCandidates 包含 lastActive > 0 过滤', () => {
  const content = readFileSync(USER_JS, 'utf8');
  // 必须显式过滤 lastActive > 0，否则会重蹈 (1845) bug
  assert.match(content, /lastActive\s*>\s*0/, '必须显式检查 lastActive > 0');
});

test('.user.js 暴露 getUndetected 方法', () => {
  const content = readFileSync(USER_JS, 'utf8');
  assert.match(content, /getUndetected\s*\(\s*\)\s*\{/, '应暴露 getUndetected 方法供 UI 调用');
});

test('.user.js @version 已升级到 v0.7.0', () => {
  const content = readFileSync(USER_JS, 'utf8');
  assert.match(content, /@version\s+0\.7\.0/, '部署版本必须是 v0.7.0');
});

test('.user.js 不应包含 @require CDN（v0.4.0 后已切内联 MD5）', () => {
  const content = readFileSync(USER_JS, 'utf8');
  assert.doesNotMatch(content, /@require\s+https?:/, '@require CDN 会触发脚本不激活');
});