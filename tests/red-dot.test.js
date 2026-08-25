// 红点（hasNewDynamic）逻辑 + sync 护栏测试

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_JS = readFileSync(join(ROOT, 'bilibili-following-manager.user.js'), 'utf8');

// 提取 utils.hasNewDynamic 实现（与 .user.js 同源）
function hasNewDynamic(u, lastSeenMap) {
  if (!u || !u.dynamic_ts) return false;
  const lastSeen = lastSeenMap?.[u.mid] || 0;
  return u.dynamic_ts > lastSeen;
}

// ---- hasNewDynamic 核心逻辑 ----

test('UP 主无 dynamic_ts（未检测）→ 不显示红点', () => {
  assert.equal(hasNewDynamic({ mid: 1, dynamic_ts: 0 }, {}), false);
  assert.equal(hasNewDynamic({ mid: 1 }, {}), false);
  assert.equal(hasNewDynamic({ mid: 1, dynamic_ts: null }, {}), false);
});

test('从未看过该 UP（lastSeen=0 或缺失）→ 显示红点', () => {
  assert.equal(hasNewDynamic({ mid: 1, dynamic_ts: 1000 }, {}), true);
  assert.equal(hasNewDynamic({ mid: 1, dynamic_ts: 1000 }, undefined), true);
  assert.equal(hasNewDynamic({ mid: 1, dynamic_ts: 1000 }, null), true);
});

test('lastSeen >= dynamic_ts（已读）→ 不显示红点', () => {
  assert.equal(hasNewDynamic({ mid: 1, dynamic_ts: 1000 }, { 1: 1000 }), false);
  assert.equal(hasNewDynamic({ mid: 1, dynamic_ts: 1000 }, { 1: 5000 }), false);
});

test('lastSeen < dynamic_ts（新动态）→ 显示红点', () => {
  assert.equal(hasNewDynamic({ mid: 1, dynamic_ts: 1000 }, { 1: 500 }), true);
});

test('lastSeen 跨 UP 主互相独立', () => {
  const lastSeen = { 1: 100, 2: 200 };
  // UP 1 dynamic_ts=150 > lastSeen[1]=100 → 红
  assert.equal(hasNewDynamic({ mid: 1, dynamic_ts: 150 }, lastSeen), true);
  // UP 2 dynamic_ts=100 < lastSeen[2]=200 → 不红
  assert.equal(hasNewDynamic({ mid: 2, dynamic_ts: 100 }, lastSeen), false);
});

test('UP 主不存在于 lastSeen 中当作 0 处理（显示红点）', () => {
  const lastSeen = { 1: 999 };
  // UP 99 不在 lastSeen 中
  assert.equal(hasNewDynamic({ mid: 99, dynamic_ts: 1000 }, lastSeen), true);
});

// ---- sync 护栏：保证 .user.js 包含红点实现 ----

test('.user.js 包含 hasNewDynamic 函数', () => {
  assert.match(USER_JS, /hasNewDynamic/);
});

test('.user.js 包含 lastSeen 字段读写', () => {
  assert.match(USER_JS, /storage\.state\.lastSeen/, '必须读写 storage.state.lastSeen');
  assert.match(USER_JS, /lastSeen\[mid\]\s*=\s*Date\.now\(\)/,
    '必须记录点击时间戳');
});

test('.user.js 包含红点 UI class', () => {
  assert.match(USER_JS, /\.bfm-new-dot/, '必须有 bfm-new-dot class');
});

test('.user.js refreshInactive 存 dynamic_ts', () => {
  assert.match(USER_JS, /dynamic_ts\s*=\s*v\.created/,
    '刷新活跃度时必须存 dynamic_ts（=最新动态时间）');
});

test('.user.js 全部已读按钮', () => {
  assert.match(USER_JS, /全部标记为已读/, '必须有批量标记已读功能');
});

test('.user.js STORAGE_VERSION = 3', () => {
  assert.match(USER_JS, /const\s+STORAGE_VERSION\s*=\s*3/,
    'v0.10.0 引入新字段，需要 bump 到 v3 触发 migration');
});

test('.user.js 包含 v2→v3 迁移（补 lastSeen 字段）', () => {
  assert.match(USER_JS, /lastSeen\s*=\s*s\.lastSeen\s*\|\|\s*\{\}/,
    '迁移逻辑必须补 lastSeen 字段');
});