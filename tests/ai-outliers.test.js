// AI outliers 持久化 + 死粉细分类 3 段 UI 测试

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_JS = readFileSync(join(ROOT, 'bilibili-following-manager.user.js'), 'utf8');

// ---- 分类逻辑测试 ----

function classifyOutlier(name, lastActive) {
  if (/已注销|账号已注销/.test(name || '')) {
    return '已注销';
  }
  const ONE_DAY = 86400000;
  const days = lastActive > 0 ? Math.floor((Date.now() - lastActive) / ONE_DAY) : 0;
  if (days > 365) return '永久停更';
  return '内容变质';
}

test('分类：已注销（名字含"已注销"）', () => {
  assert.equal(classifyOutlier('账号已注销', Date.now()), '已注销');
  assert.equal(classifyOutlier('用户X已注销', Date.now()), '已注销');
});

test('分类：永久停更（> 365 天未更新）', () => {
  const TWO_YEARS_AGO = Date.now() - 730 * 86400000;
  assert.equal(classifyOutlier('正常UP', TWO_YEARS_AGO), '永久停更');
});

test('分类：内容变质（< 365 天 + 名字正常）', () => {
  const RECENT = Date.now() - 30 * 86400000;
  assert.equal(classifyOutlier('UP主A', RECENT), '内容变质');
  // lastActive=0（未检测）→ 算内容变质
  assert.equal(classifyOutlier('UP主A', 0), '内容变质');
});

// ---- 过期逻辑 ----

function isExpired(updatedAt, ttlMs = 7 * 86400000) {
  return Date.now() - (updatedAt || 0) > ttlMs;
}

test('过期：7 天内的 outliers 有效', () => {
  assert.equal(isExpired(Date.now() - 3 * 86400000), false);
});

test('过期：超过 7 天的 outliers 失效', () => {
  assert.equal(isExpired(Date.now() - 10 * 86400000), true);
});

// ---- 解析 AI 返回（兼容新旧格式）----

function parseOutliers(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(o => {
    if (typeof o === 'string') return { mid: null, name: o };
    const mid = Number(o?.mid);
    return {
      mid: Number.isFinite(mid) && mid > 0 ? mid : null,
      name: String(o?.name || ''),
    };
  });
}

test('AI outliers 解析：[{mid, name}] 格式', () => {
  const result = parseOutliers([{ mid: 1, name: 'A' }, { mid: 2, name: 'B' }]);
  assert.deepEqual(result, [{ mid: 1, name: 'A' }, { mid: 2, name: 'B' }]);
});

test('AI outliers 解析：字符串格式（向下兼容）', () => {
  const result = parseOutliers(['名字A', '名字B']);
  assert.deepEqual(result, [{ mid: null, name: '名字A' }, { mid: null, name: '名字B' }]);
});

test('AI outliers 解析：无效 mid 返回 null（由调用方 filter 掉）', () => {
  const result = parseOutliers([{ mid: 0, name: 'A' }, { mid: -5, name: 'B' }, { mid: 'x', name: 'C' }]);
  // 返回的对象里 mid 字段是 null（不是被过滤掉）
  assert.deepEqual(result.map(o => o.name), ['A', 'B', 'C']);
  assert.ok(result.every(o => o.mid === null));
  // 调用方应用 .filter(o => o.mid) 过滤
  const valid = result.filter(o => o.mid);
  assert.equal(valid.length, 0);
});

// ---- sync 护栏：.user.js 必须包含所有 v0.10.0 改动 ----

test('.user.js 包含 storage.state.aiOutliers', () => {
  assert.match(USER_JS, /storage\.state\.aiOutliers/);
});

test('.user.js 包含 7 天过期判断', () => {
  assert.match(USER_JS, /SEVEN_DAYS\s*=\s*7\s*\*\s*86400\s*\*\s*1000/);
});

test('.user.js 包含 _classifyOutlier / _loadAiOutliers', () => {
  assert.match(USER_JS, /_loadAiOutliers/);
  assert.match(USER_JS, /_classifyOutlier/);
});

test('.user.js 渲染"可能误关注 (AI 推断)"段', () => {
  assert.match(USER_JS, /可能误关注/);
  assert.match(USER_JS, /AI 推断/);
});

test('.user.js 渲染三类 pill', () => {
  assert.match(USER_JS, /已注销/);
  assert.match(USER_JS, /永久停更/);
  assert.match(USER_JS, /内容变质/);
});

test('.user.js AI outliers 段支持批量取关', () => {
  assert.match(USER_JS, /bfm-outlier-batch-unfollow/, '必须有批量取关按钮');
  assert.match(USER_JS, /bfm-outlier-cb/, '必须有 checkbox class');
});