// Regression test for the (1845) false-positive bug.
//
// Bug history:
//   getInactiveCandidates() filtered by `daysSince(u.lastActive) > 90`,
//   and daysSince(0) returned Infinity, so ALL never-detected UP 主
//   were counted as dead fans. The displayed count was essentially
//   the full following size minus actively checked ones.
//
// These tests pin down the correct behaviour:
//   1. UP 主 with lastActive=0 (never checked) MUST NOT appear in the dead list
//   2. UP 主 with lastActive older than threshold MUST appear
//   3. Detected-recently UP 主 MUST NOT appear
//   4. getUndetected returns only the never-checked ones

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getInactiveCandidates, getUndetected, daysSince } from '../src/storage-logic.mjs';

const NOW = 1_700_000_000_000; // fixed timestamp for deterministic tests
const DAY = 86_400_000;

const sample = {
  '1': { mid: 1, uname: '活跃 UP',     lastActive: NOW - 10  * DAY },  // 10 天前
  '2': { mid: 2, uname: '刚发的 UP',   lastActive: NOW - 1   * DAY },  // 1 天前
  '3': { mid: 3, uname: '半年没更新', lastActive: NOW - 200 * DAY },  // 200 天前 → 真死粉
  '4': { mid: 4, uname: '一年没更新', lastActive: NOW - 400 * DAY },  // 400 天前 → 真死粉
  '5': { mid: 5, uname: '从未检测',   lastActive: 0 },                 // ← 关键：必须排除
  '6': { mid: 6, uname: '未检测2',    lastActive: undefined },         // ← 关键：必须排除
  '7': { mid: 7, uname: '未检测3',    lastActive: null },              // ← 关键：必须排除
};

test('getInactiveCandidates 排除 lastActive=0 的"未检测" UP 主', () => {
  const result = getInactiveCandidates(sample, 90, NOW).map(u => u.mid);
  assert.deepEqual(result, [4, 3], '只有真正过期的 mid=3 和 mid=4 应进入死粉列表（mid=4 更久在前）');
});

test('getInactiveCandidates 排除 undefined 和 null lastActive', () => {
  const fixture = {
    '1': { mid: 1, lastActive: undefined },
    '2': { mid: 2, lastActive: null },
    '3': { mid: 3, lastActive: NOW - 200 * DAY },
  };
  const result = getInactiveCandidates(fixture, 90, NOW).map(u => u.mid);
  assert.deepEqual(result, [3]);
});

test('getInactiveCandidates 按 lastActive 升序排序（最久未更新的在前）', () => {
  const result = getInactiveCandidates(sample, 90, NOW);
  // mid=4 (400天) 比 mid=3 (200天) 更久未更新，应该在前
  assert.equal(result[0].mid, 4, 'mid=4 (400天未更新) 应该在 mid=3 (200天未更新) 之前');
  assert.equal(result[1].mid, 3);
});

test('getInactiveCandidates 阈值边界：刚好等于阈值不算死粉', () => {
  const fixture = {
    '1': { mid: 1, lastActive: NOW - 90 * DAY },   // 恰好 90 天
    '2': { mid: 2, lastActive: NOW - 91 * DAY },   // 91 天
  };
  const result = getInactiveCandidates(fixture, 90, NOW).map(u => u.mid);
  assert.deepEqual(result, [2], '边界：90 天不计入，91 天计入');
});

test('getUndetected 只返回 lastActive 为 0/undefined/null 的', () => {
  const result = getUndetected(sample).map(u => u.mid);
  assert.deepEqual(result.sort(), [5, 6, 7]);
});

test('daysSince(0) 返回 Infinity（哨兵值）', () => {
  assert.equal(daysSince(0), Infinity);
  assert.equal(daysSince(undefined), Infinity);
  assert.equal(daysSince(null), Infinity);
});

test('空 following 不报错', () => {
  assert.deepEqual(getInactiveCandidates({}, 90, NOW), []);
  assert.deepEqual(getUndetected({}), []);
  assert.deepEqual(getInactiveCandidates(null, 90, NOW), []);
});

test('following 中有非对象元素也不报错', () => {
  const dirty = { '1': null, '2': undefined, '3': { mid: 3, lastActive: NOW - 200 * DAY } };
  const result = getInactiveCandidates(dirty, 90, NOW).map(u => u.mid);
  assert.deepEqual(result, [3]);
});