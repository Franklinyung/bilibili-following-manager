import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanFace, sanitizeBackup, esc } from '../src/sanitize.mjs';

test('cleanFace: 接受合法 https URL', () => {
  assert.equal(cleanFace('https://i0.hdslb.com/face.jpg'), 'https://i0.hdslb.com/face.jpg');
  assert.equal(cleanFace('http://example.com/x.png'), 'http://example.com/x.png');
});

test('cleanFace: 拒绝 javascript: 协议', () => {
  assert.equal(cleanFace('javascript:alert(1)'), '');
});

test('cleanFace: 拒绝 data: 协议', () => {
  assert.equal(cleanFace('data:image/svg+xml,<svg onload=alert(1)>'), '');
});

test('cleanFace: 拒绝包含空格/引号的 URL', () => {
  assert.equal(cleanFace('https://example.com/x"onload="alert'), '');
  assert.equal(cleanFace('https://example.com/<script>'), '');
});

test('cleanFace: 拒绝超长 URL (>=500)', () => {
  assert.equal(cleanFace('https://example.com/' + 'a'.repeat(500)), '');
});

test('cleanFace: 接受 null/undefined/数字 → 空', () => {
  assert.equal(cleanFace(null), '');
  assert.equal(cleanFace(undefined), '');
  assert.equal(cleanFace(123), '');
});

test('sanitizeBackup: 拒绝非对象', () => {
  assert.throws(() => sanitizeBackup(null));
  assert.throws(() => sanitizeBackup('string'));
});

test('sanitizeBackup: 接受干净备份', () => {
  const result = sanitizeBackup({
    groups: [{ tagid: 1, name: '技术', count: 10 }],
    following: {
      '12345': { mid: 12345, uname: 'UP主', face: 'https://example.com/x.jpg', sign: 'hi', tagids: [1, 2] },
    },
    settings: { inactiveThresholdDays: 90, panelCollapsed: true },
  });
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].name, '技术');
  assert.equal(result.following[12345].uname, 'UP主');
  assert.deepEqual(result.following[12345].tagids, [1, 2]);
});

test('sanitizeBackup: 净化 malicious face URL', () => {
  const result = sanitizeBackup({
    following: {
      '1': { mid: 1, uname: 'evil', face: 'javascript:alert(1)' },
    },
  });
  assert.equal(result.following[1].face, '', 'malicious face 必须清空');
});

test('sanitizeBackup: 净化非法 mid（字符串形式）', () => {
  const result = sanitizeBackup({
    following: {
      'badmid': { mid: 'bad', uname: 'X' },
      '0': { mid: 0, uname: 'X' },
      '-5': { mid: -5, uname: 'X' },
    },
  });
  assert.equal(Object.keys(result.following).length, 0);
});

test('sanitizeBackup: tagids 过滤非数字', () => {
  const result = sanitizeBackup({
    following: { '1': { mid: 1, uname: 'X', tagids: [1, 'a', 2, null, 3] } },
  });
  // null 转 Number 后是 0（finite 通过），'a' 被过滤；其他数字保留
  assert.deepEqual(result.following[1].tagids, [1, 2, 0, 3]);
});

test('sanitizeBackup: 字符串长度截断', () => {
  const longName = 'a'.repeat(200);
  const result = sanitizeBackup({
    following: { '1': { mid: 1, uname: longName, sign: 'b'.repeat(500), lastTitle: 'c'.repeat(300) } },
  });
  assert.equal(result.following[1].uname.length, 64);
  assert.equal(result.following[1].sign.length, 256);
  assert.equal(result.following[1].lastTitle.length, 128);
});

test('sanitizeBackup: 不导入 LLM 配置（避免恢复旧 Key）', () => {
  const result = sanitizeBackup({
    settings: { inactiveThresholdDays: 60, llm: { apiKey: 'sk-old' } },
  });
  assert.equal(result.settings.inactiveThresholdDays, 60);
  assert.equal(result.settings.llm, undefined, 'LLM 配置不应从备份恢复');
});

test('sanitizeBackup: 越界 inactiveThresholdDays 被丢弃', () => {
  assert.equal(sanitizeBackup({ settings: { inactiveThresholdDays: 1 } }).settings.inactiveThresholdDays, undefined);
  assert.equal(sanitizeBackup({ settings: { inactiveThresholdDays: 9999 } }).settings.inactiveThresholdDays, undefined);
  assert.equal(sanitizeBackup({ settings: { inactiveThresholdDays: 90 } }).settings.inactiveThresholdDays, 90);
});

test('esc: HTML 特殊字符', () => {
  assert.equal(esc('<script>'), '&lt;script&gt;');
  assert.equal(esc('a & b'), 'a &amp; b');
  assert.equal(esc('"x"'), '&quot;x&quot;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});