// Verify the inline MD5 implementation produces standard test vectors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { md5 } from '../src/md5.mjs';

const cases = [
  ['',                              'd41d8cd98f00b204e9800998ecf8427e'],
  ['a',                             '0cc175b9c0f1b6a831c399e269772661'],
  ['abc',                           '900150983cd24fb0d6963f7d28e17f72'],
  ['message digest',                'f96b697d7cb7938d525a2f31aaf161d0'],
  ['abcdefghijklmnopqrstuvwxyz',    'c3fcd3d76192e4007dfb496cca67e13b'],
  // 大字符串 + 大字母 + 数字的混合向量（覆盖多 block 处理）
  ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
                                     'd174ab98d277d9f5a5611c2c9f419d9f'],
  ['12345678901234567890123456789012345678901234567890123456789012345678901234567890',
                                     '57edf4a22be3c955ac49da2e2107b67a'],
];

test('MD5 标准测试向量', () => {
  for (const [input, expected] of cases) {
    assert.equal(md5(input), expected, `MD5(${JSON.stringify(input)})`);
  }
});

test('MD5 中文字符串', () => {
  // 不对比固定哈希（不同编码会不同），只验证是 32 位 hex
  const hash = md5('中文测试');
  assert.equal(hash.length, 32);
  assert.match(hash, /^[0-9a-f]{32}$/);
});

test('MD5 长字符串（>56 字节，触发多 block）', () => {
  const long = 'a'.repeat(1000);
  const hash = md5(long);
  assert.equal(hash.length, 32);
  assert.match(hash, /^[0-9a-f]{32}$/);
});