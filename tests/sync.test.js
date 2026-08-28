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

test('.user.js @version 已升级到 v0.10.6', () => {
  const content = readFileSync(USER_JS, 'utf8');
  assert.match(content, /@version\s+0\.10\.6/, '部署版本必须是 v0.10.6');
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

test('.user.js LLM 请求必须有 timeout（防永久挂起）', () => {
  const content = readFileSync(USER_JS, 'utf8');
  // 抓 _chatOpenAI 函数体（要匹配函数定义而非调用点）
  // 用非贪婪匹配第一个 "{...return...}" 块作为函数定义
  const fnMatch = (name) => {
    const re = new RegExp(`_${name}\\s*\\([^)]*\\)\\s*\\{`);
    const m = content.match(re);
    if (!m) return null;
    // 从函数定义开始，找到第一个 ontimeout（通常就在最后）
    const startIdx = m.index;
    const rest = content.slice(startIdx);
    const otIdx = rest.indexOf('ontimeout');
    if (otIdx < 0) return null;
    return rest.slice(0, otIdx + 50);
  };
  const openaiBlock = fnMatch('chatOpenAI');
  const anthropicBlock = fnMatch('chatAnthropic');
  assert.ok(openaiBlock, '_chatOpenAI 函数必须存在');
  assert.ok(anthropicBlock, '_chatAnthropic 函数必须存在');
  // 块内必须有 timeout: ... ?? <数字> 模式
  assert.match(openaiBlock, /timeout:\s*[^,]*?\d+_?\d*/,
    '_chatOpenAI 必须有 timeout 字段（带默认数字）');
  assert.match(anthropicBlock, /timeout:\s*[^,]*?\d+_?\d*/,
    '_chatAnthropic 必须有 timeout 字段');
  // 默认值必须是 60s 或更长
  const extractMs = block => {
    const m = block.match(/timeout:[^,]*?(\d+_?\d*)/);
    if (!m) return 0;
    return Number(m[1].replace(/_/g, ''));
  };
  assert.ok(extractMs(openaiBlock) >= 60_000, `_chatOpenAI 默认 timeout ≥ 60s，实际 ${extractMs(openaiBlock)}`);
  assert.ok(extractMs(anthropicBlock) >= 60_000, `_chatAnthropic 默认 timeout ≥ 60s，实际 ${extractMs(anthropicBlock)}`);
});

test('.user.js runAIGrouping 必须有 stopped / failedMids', () => {
  const content = readFileSync(USER_JS, 'utf8');
  assert.match(content, /stopped\s*=\s*true/, 'runAIGrouping 必须有 stopped 中断标志');
  assert.match(content, /failedMids/, 'runAIGrouping 必须用 failedMids 收集失败');
});

test('.user.js B站 API 请求必须有 timeout（防串行队列挂起）', () => {
  const content = readFileSync(USER_JS, 'utf8');
  const block = content.match(/_doRequest\([^)]*\)\s*\{[\s\S]*?ontimeout/);
  assert.ok(block, '_doRequest 必须存在');
  assert.match(block[0], /timeout:\s*CONFIG\.REQUEST_TIMEOUT_MS/,
    'GM_xmlhttpRequest 必须设置 B站 API timeout');
  assert.match(content, /REQUEST_TIMEOUT_MS:\s*\d{2,3}_?000/,
    'timeout 必须是明确的毫秒数');
});

test('.user.js 不可逆 POST 默认不能自动重试', () => {
  const content = readFileSync(USER_JS, 'utf8');
  const block = content.match(/request\(url,\s*opts\s*=\s*\{\}\)\s*\{[\s\S]*?return utils\.enqueue/);
  assert.ok(block, 'request 必须存在');
  assert.match(block[0], /defaultRetry\s*=\s*method\s*===\s*['"]GET['"]\s*\?\s*CONFIG\.MAX_RETRY\s*:\s*1/,
    'GET 可重试；POST 默认只发一次');
});

// ===== v0.10.5: 风控日历埋点护栏 =====

test('.user.js 4 个写操作点都埋了 windRecord / windGuard', () => {
  const c = readFileSync(USER_JS, 'utf8');
  // 1) api.unfollow 内部 windRecord（单条 + 批量共用）
  assert.match(c, /async unfollow\([^)]*\)\s*\{[\s\S]*?windRecord\(/,
    'api.unfollow 必须有 windRecord 埋点');
  // 2) api.createGroup 内部 windRecord
  assert.match(c, /async createGroup\([^)]*\)\s*\{[\s\S]*?windRecord\(['"]createGroup['"]/,
    'api.createGroup 必须 windRecord createGroup');
  // 3) api.addUsersToGroup 块前后 windGuard + 块内 windRecord
  assert.match(c, /async addUsersToGroup\([^)]*\)\s*\{[\s\S]*?windGuard\(\)[\s\S]*?windRecord\(['"]tags\/addUsers['"]/,
    'api.addUsersToGroup 必须 windGuard + windRecord tags/addUsers');
  // 4) runBatchUnfollow 函数体内 windGuard（不调 windRecord，避免与 api.unfollow 双计）
  assert.match(c, /async runBatchUnfollow\([^)]*\)\s*\{[\s\S]*?await utils\.windGuard\(\)/,
    'runBatchUnfollow 函数体内必须 windGuard');
});

test('.user.js removeUsersFromGroup 也要 windGuard / windRecord', () => {
  const content = readFileSync(USER_JS, 'utf8');
  // v0.10.6：签名扩展为 (tagid, mids, opts = {})
  const block = content.match(/removeUsersFromGroup\(tagid,\s*mids(?:,\s*opts[^)]*)?\)\s*\{[\s\S]*?\n    \},/);
  assert.ok(block, 'removeUsersFromGroup 必须存在');
  assert.match(block[0], /await utils\.windGuard\(\)/, '移出分组前必须自适应减速');
  assert.match(block[0], /windRecord\(['"]tags\/delUsers['"]/,
    '移出分组必须记录风控日历');
});
// ===== v0.10.1: a11y + JSDOM =====


// ===== v0.10.1: a11y + JSDOM =====

test('.user.js 包含 a11y helper createAccessibleModal', () => {
  const c = readFileSync(USER_JS, 'utf8');
  assert.match(c, /createAccessibleModal/, '必须有 helper 函数');
  assert.match(c, /setAttribute\(['"]role['"],\s*alert\s*\?\s*['"]/, 'role 通过三元设置 alertdialog/dialog');
  assert.match(c, /setAttribute\(['"]aria-modal['"],\s*['"]true['"]/, 'aria-modal="true"');
  assert.match(c, /setAttribute\(['"]aria-labelledby['"]/, 'aria-labelledby');
  assert.match(c, /e\.key\s*===\s*['"]Escape['"]/, 'Escape 关闭');
  assert.match(c, /delegatesFocus:\s*true/, 'Shadow DOM delegatesFocus');
  assert.match(c, /prefers-reduced-motion:\s*reduce/, 'prefers-reduced-motion 支持');
  assert.match(c, /:focus-visible/, ':focus-visible 焦点环');
  assert.ok(
    /['"]alertdialog['"]/.test(c) && /['"]dialog['"]/.test(c),
    '必须同时包含 alertdialog 和 dialog 字符串字面量');
});
