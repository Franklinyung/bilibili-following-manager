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

test('.user.js @version 已升级到 v0.9.1', () => {
  const content = readFileSync(USER_JS, 'utf8');
  assert.match(content, /@version\s+0\.9\.1/, '部署版本必须是 v0.9.1');
});

test('.user.js 不应包含 @require CDN（v0.4.0 后已切内联 MD5）', () => {
  const content = readFileSync(USER_JS, 'utf8');
  assert.doesNotMatch(content, /@require\s+https?:/, '@require CDN 会触发脚本不激活');
});

test('.user.js 包含取关 API 调用', () => {
  const content = readFileSync(USER_JS, 'utf8');
  assert.match(content, /x\/relation\/modify/, '必须用 B 站官方取关接口');
  assert.match(content, /act:\s*2/, '取关必须用 act=2');
});

test('.user.js 暴露 runBatchUnfollow UI 方法', () => {
  const content = readFileSync(USER_JS, 'utf8');
  assert.match(content, /runBatchUnfollow\s*\(\s*mids\s*\)/, 'UI 必须暴露批量取关方法');
  assert.match(content, /api\.unfollow\(/, 'UI 必须调用 api.unfollow');
});

test('.user.js 取关有二次确认', () => {
  const content = readFileSync(USER_JS, 'utf8');
  // 必须有 modal 确认流程，不能直接取关
  assert.match(content, /确认取关/);
  assert.match(content, /data-act="cancel"/, '必须有取消按钮');
  assert.match(content, /data-act="confirm"/, '必须有确认按钮');
});

test('.user.js 画像分析 outliers 字段要求 AI 返回 {mid, name}', () => {
  const content = readFileSync(USER_JS, 'utf8');
  // prompt 里必须告诉 AI 返回 mid
  assert.match(content, /outliers.*mid.*name/s,
    'analyzeProfile 的 prompt 必须让 AI 返回 [{mid, name}]');
  // 渲染逻辑必须兼容旧格式（纯字符串数组）
  assert.match(content, /typeof o === 'string'/,
    '_showProfileResult 必须兼容旧 AI 输出格式');
});

test('.user.js 疑似误关注列表支持批量取关', () => {
  const content = readFileSync(USER_JS, 'utf8');
  assert.match(content, /bfm-outlier-cb/, '必须有 outliers checkbox class');
  assert.match(content, /bfm-outlier-unfollow/, '必须有 outliers 批量取关按钮');
  assert.match(content, /runBatchUnfollow\(mids\)/,
    'outliers 批量取关必须复用 runBatchUnfollow，不可另写一份');
});