// v0.10.6 P0 修复测试：写入节流（熔断 / 硬上限 / 去重 / 随机抖动）
//
// 这些保护来自社区调研结论：
//   1) -352/-412 是「熔断信号」而非「重试信号」（MrXJG 实战）
//   2) 单轮 >500 易触发账号级风控（Greasy Fork 关注管理器反馈）
//   3) 相邻 fids 串越长越易 -352（wuko233）
//   4) 固定间隔易被节奏识别（YZz-S / 拉黑工具）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_JS = readFileSync(join(ROOT, 'bilibili-following-manager.user.js'), 'utf8');

// ============================================================
// P0-1：-352/-412 熔断
// ============================================================

test('P0-1: request() 收到 -352 立即抛出，不再重试', () => {
  // 抓取 request() 函数体
  const block = USER_JS.match(/request\(url,\s*opts = \{\}\)\s*\{[\s\S]*?\n    \},/);
  assert.ok(block, 'request() 函数必须存在');
  // 关键：isRisk 命中后必须 throw（不能继续 retry loop）
  assert.match(block[0], /if\s*\(\s*isRisk\s*\)\s*\{[\s\S]*?throw e/,
    'isRisk 命中后必须立即 throw，不再走退避');
  // 不能保留旧的 5s/10s 退避逻辑（会被重试污染）
  assert.doesNotMatch(block[0],
    /isRisk\s*\?\s*5000\s*\*\s*Math\.pow\s*\(2/,
    '旧的 isRisk ? 5000 * Math.pow 退避已删除');
});

test('P0-1: request() 收到 -412 立即抛出，不再重试', () => {
  const block = USER_JS.match(/request\(url,\s*opts = \{\}\)\s*\{[\s\S]*?\n    \},/);
  assert.match(block[0], /\/-352\|\-412\//, '必须识别 -352 和 -412');
  assert.match(block[0], /if\s*\(\s*isRisk\s*\)\s*\{/,
    '风控码走统一的熔断分支');
});

test('P0-1: request() onRiskAbort 回调（供外层感知熔断）', () => {
  const block = USER_JS.match(/request\(url,\s*opts = \{\}\)\s*\{[\s\S]*?\n    \},/);
  assert.match(block[0], /onRiskAbort/,
    '必须支持 onRiskAbort 回调，让 _applyAISuggestions 能 break 剩余写入');
  assert.match(block[0], /typeof onRiskAbort === 'function'[\s\S]*?onRiskAbort\(e\)/,
    '熔断触发时必须调用回调');
});

test('P0-1: 普通错误（非风控码）维持原短退避', () => {
  const block = USER_JS.match(/request\(url,\s*opts = \{\}\)\s*\{[\s\S]*?\n    \},/);
  assert.match(block[0], /500 \* Math\.pow\(2, attempt - 1\)/,
    '普通错误仍走 500/1000/2000 短退避');
});

// ============================================================
// P0-2：单轮写入硬上限
// ============================================================

test('P0-2: CONFIG.APPLY_HARD_CAP = 100', () => {
  assert.match(USER_JS, /APPLY_HARD_CAP:\s*100/,
    '硬上限必须 = 100（社区反馈 >500 触发账号级风控）');
});

test('P0-2: _applyAISuggestions 在 >硬上限 时二次确认', () => {
  const block = USER_JS.match(/async\s+_applyAISuggestions\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/);
  assert.ok(block, '_applyAISuggestions 函数必须存在');
  assert.match(block[0], /items\.length\s*>\s*CONFIG\.APPLY_HARD_CAP/,
    '必须用 CONFIG.APPLY_HARD_CAP 作为阈值');
  assert.match(block[0], /confirm\(/,
    '超阈值必须弹 confirm 二次确认');
  assert.match(block[0], /强制实名|账号级/,
    '弹窗必须警示账号级后果');
});

// ============================================================
// P0-3：基于本地缓存的写入去重
// ============================================================

test('P0-3: _applyAISuggestions 必须按本地缓存去重', () => {
  const block = USER_JS.match(/async\s+_applyAISuggestions\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/);
  assert.match(block[0], /alreadyApplied/,
    '必须有 alreadyApplied(mid, tagid) 工具函数');
  // 两种合法写法：链式 following?.[mid]?.tagids 或抽变量后 f.tagids
  const ok = /following\?\.\[[^\]]+\][\s\S]{0,40}tagids/.test(block[0])
          || /\bf\s*&&[\s\S]{0,40}\.tagids/.test(block[0]);
  assert.ok(ok, '必须读取 following[mid].tagids（本地缓存）');
  assert.match(block[0], /pending\s*=\s*mids\.filter\(mid\s*=>\s*!alreadyApplied/,
    '必须用 filter 排除已应用项');
});

test('P0-3: 报告里必须显示跳过数量', () => {
  const block = USER_JS.match(/async\s+_applyAISuggestions\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/);
  assert.match(block[0], /skipped\s*\+=\s*mids\.length\s*-\s*pending\.length/,
    'skipped 必须累计跳过数');
  assert.match(block[0], /跳过\s*\$\{skipped\}/,
    '报告必须告诉用户跳过了多少');
});

// ============================================================
// P0-4：风控熔断停写
// ============================================================

test('P0-4: _applyAISuggestions 必须能熔断停止剩余写入', () => {
  const block = USER_JS.match(/async\s+_applyAISuggestions\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/);
  assert.match(block[0], /stoppedByRisk/,
    '必须有 stoppedByRisk 标志控制 for 循环 break');
  assert.match(block[0], /onRisk/,
    '必须把 onRisk 传给 addUsersToGroup');
  assert.match(block[0], /if\s*\(\s*stoppedByRisk\s*\)\s*break/,
    '循环末尾必须 break 停写');
  assert.match(block[0], /\/-352\|\-412\/\.test\(e\.message/,
    'catch 分支也必须检测 -352/-412 标记熔断');
});

test('P0-4: 报告里必须显式提示风控熔断', () => {
  const block = USER_JS.match(/async\s+_applyAISuggestions\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/);
  assert.match(block[0], /触发风控熔断/,
    'alert 报告必须提到「风控熔断」');
  assert.match(block[0], /等待\s*5-10\s*分钟/,
    '必须给用户冷却期建议');
});

// ============================================================
// P0-5：块大小 25→10 + 随机抖动
// ============================================================

test('P0-5: CONFIG.WRITE_BATCH_SIZE = 10', () => {
  assert.match(USER_JS, /WRITE_BATCH_SIZE:\s*10/,
    '块大小硬编码 10 已废弃，必须用 CONFIG 读');
});

test('P0-5: addUsersToGroup 块大小走 CONFIG 且不再用 25', () => {
  const block = USER_JS.match(/addUsersToGroup\(tagid,\s*mids(?:,\s*opts[^)]*)?\)\s*\{[\s\S]*?\n    \},/);
  assert.ok(block, 'addUsersToGroup 必须存在');
  assert.match(block[0], /i \+= SIZE/,
    '循环步长必须 = SIZE（CONFIG.WRITE_BATCH_SIZE）');
  assert.match(block[0], /CONFIG\.WRITE_BATCH_SIZE/,
    'SIZE 必须从 CONFIG 读取');
  assert.doesNotMatch(block[0], /i \+= 25/,
    'v0.10.6 不再硬编码 25');
});

test('P0-5: addUsersToGroup 使用风控等级自适应延迟 + 随机抖动', () => {
  const block = USER_JS.match(/addUsersToGroup\(tagid,\s*mids(?:,\s*opts[^)]*)?\)\s*\{[\s\S]*?\n    \},/);
  assert.match(block[0], /windGuard\(\)/, '每块前 windGuard');
  assert.match(block[0], /WRITE_JITTER_GREEN/, 'green 等级随机抖动');
  assert.match(block[0], /WRITE_JITTER_(YELLOW|ORANGE)/, 'yellow/orange 附加抖动');
  assert.match(block[0], /_jitter\(/, '必须有 _jitter helper 生成随机区间');
  assert.doesNotMatch(block[0], /_sleep\(600\)/, '不再用固定 600ms');
});

test('P0-5: api._jitter helper 存在且返回整数毫秒', () => {
  assert.match(USER_JS, /_jitter\(\[lo,\s*hi\]\)\s*\{[\s\S]*?Math\.floor/,
    '_jitter 必须用 Math.floor 返回整数');
});

// ============================================================
// P0 综合：request() 调用方必须能传 onRiskAbort
// ============================================================

test('P0: addUsersToGroup 签名扩展支持 opts.onRisk', () => {
  const block = USER_JS.match(/addUsersToGroup\(tagid,\s*mids(?:,\s*opts[^)]*)?\)\s*\{[\s\S]*?\n    \},/);
  assert.match(block[0], /opts\.onRisk/, '必须解构 opts.onRisk');
  assert.match(block[0], /onRiskAbort:\s*onRisk/,
    '传给 request 的 onRiskAbort 必须是 opts.onRisk');
});
