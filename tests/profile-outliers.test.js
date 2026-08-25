// 画像分析的 outliers 字段解析：必须兼容新旧两种 AI 输出格式。
//
// 历史格式：`outliers: ["UP主A", "UP主B"]`
// 新格式：`outliers: [{"mid": 123, "name": "UP主A"}, ...]`
// 渲染前必须兼容两种，否则老用户的 AI 输出会变只读。

import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * 与 .user.js 中 _showProfileResult 相同的 normalize 逻辑
 */
function parseOutliers(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.map(o => {
    if (typeof o === 'string') return { mid: null, name: o };
    const mid = Number(o?.mid);
    return {
      mid: Number.isFinite(mid) && mid > 0 ? mid : null,
      name: String(o?.name || ''),
    };
  });
}

test('新格式：数组里是 {mid, name} 对象', () => {
  const raw = [
    { mid: 12345, name: 'UP主A' },
    { mid: 67890, name: 'UP主B' },
  ];
  const result = parseOutliers(raw);
  assert.deepEqual(result, [
    { mid: 12345, name: 'UP主A' },
    { mid: 67890, name: 'UP主B' },
  ]);
});

test('旧格式：数组里是字符串名字', () => {
  const raw = ['UP主A', 'UP主B'];
  const result = parseOutliers(raw);
  assert.deepEqual(result, [
    { mid: null, name: 'UP主A' },
    { mid: null, name: 'UP主B' },
  ]);
});

test('混合：新旧格式混在一起', () => {
  const raw = ['旧格式UP主', { mid: 999, name: '新格式UP主' }];
  const result = parseOutliers(raw);
  assert.equal(result.length, 2);
  assert.equal(result[0].mid, null);
  assert.equal(result[0].name, '旧格式UP主');
  assert.equal(result[1].mid, 999);
});

test('mid 为 0 / undefined / null / 字符串 都视为无效', () => {
  const raw = [
    { mid: 0, name: 'A' },
    { mid: undefined, name: 'B' },
    { mid: null, name: 'C' },
    { mid: 'not-a-number', name: 'D' },
    { mid: -5, name: 'E' },
    { mid: 123, name: 'F' },
  ];
  const result = parseOutliers(raw);
  const valid = result.filter(o => o.mid);
  assert.equal(valid.length, 1, '只有 mid=123 应保留');
  assert.equal(valid[0].name, 'F');
});

test('name 缺失时回退为空字符串', () => {
  const raw = [{ mid: 1 }, { mid: 2, name: 'X' }];
  const result = parseOutliers(raw);
  assert.equal(result[0].name, '');
  assert.equal(result[1].name, 'X');
});

test('null / undefined / 非数组输入', () => {
  assert.deepEqual(parseOutliers(null), []);
  assert.deepEqual(parseOutliers(undefined), []);
  assert.deepEqual(parseOutliers('string'), []);
});

test('能筛出 validOutliers 用于批量取关', () => {
  const raw = ['名字无mid', { mid: 1, name: 'A' }, { mid: 0, name: 'B-mid0无效' }];
  const result = parseOutliers(raw);
  const validMids = result.filter(o => o.mid).map(o => o.mid);
  assert.deepEqual(validMids, [1]);
});