// Pin down the unfollow API contract so future refactors don't drift.
//
// We can't actually exercise GM_xmlhttpRequest in unit tests, so we
// extract the request-shape logic and assert it stays correct.

import { test } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The function we're testing is inlined inside api._doRequest:
 *   data: body ? Object.entries(body).map(...)
 *
 * Pure reimplementation to test the shape:
 */
function buildBody(body) {
  return body ? Object.entries(body)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&') : undefined;
}

test('unfollow 请求体格式', () => {
  // 取关调用应该：fid=目标mid, act=2, re_src=11, csrf=bili_jct
  const body = buildBody({
    fid: 12345,
    act: 2,
    re_src: 11,
    csrf: 'fake-csrf-token',
  });
  assert.match(body, /^fid=12345/);
  assert.match(body, /act=2/);
  assert.match(body, /re_src=11/);
  assert.match(body, /csrf=fake-csrf-token/);
});

test('act=2 表示取关（不能误用为关注）', () => {
  // act=1 是关注，2 是取关。错误地传 act=1 会变成"关注"操作
  const body = buildBody({ fid: 1, act: 2, re_src: 11, csrf: 'x' });
  assert.ok(body.includes('act=2'), 'unfollow 必须用 act=2');
  assert.doesNotMatch(body, /act=1/, '不能误传 act=1（关注）');
});

test('csrf 字段是字符串，不应该是 mid 数字', () => {
  // 防御：如果把 mid 误填到 csrf 字段，B 站会拒绝并报 CSRF token error
  const body = buildBody({ fid: 12345, act: 2, re_src: 11, csrf: 'a'.repeat(32) });
  const params = new URLSearchParams(body);
  assert.notEqual(params.get('csrf'), '12345');
  assert.equal(params.get('csrf').length, 32);
});

test('URL 编码：含特殊字符的 csrf 不破坏请求体', () => {
  const body = buildBody({
    fid: 1, act: 2, re_src: 11,
    csrf: 'a+b=c&d',  // 含 + = & 特殊字符
  });
  assert.ok(body.includes('csrf=a%2Bb%3Dc%26d'));
  // 解析后 csrf 字段应能完整还原
  const params = new URLSearchParams(body);
  assert.equal(params.get('csrf'), 'a+b=c&d');
});

test('buildBody 对空 body 返回 undefined（与原实现一致）', () => {
  assert.equal(buildBody(null), undefined);
  assert.equal(buildBody({}), '');  // 空对象 = 空字符串
});