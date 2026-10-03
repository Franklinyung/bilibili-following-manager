// 导出（downloadJSON）回归测试
//
// 背景：原实现只有 blob: URL + <a download>，并在 100ms 后 revokeObjectURL。
// 实测在油猴沙箱下 download 属性不被采纳，这次点击被当成普通链接**导航**；
// blob 此时已被撤销，于是页面停在"无法访问"，且一个文件都没有生成
// （Edge downloads 表无记录、磁盘无文件）。
//
// 对照实验（普通页面，非沙箱）：
//   blob: + <a download>  → ✅ 可下载，文件名正确
//   data: + <a download>  → ❌ 静默失败（既无文件也无下载记录）
// 所以修复必须走 GM_download，而不是给 anchor 换 data: URL。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_JS = join(ROOT, 'bilibili-following-manager.user.js');
const content = readFileSync(USER_JS, 'utf8');

// 只取出 downloadJSON 方法体，避免误伤文件里其它代码
const START = content.indexOf('downloadJSON(filename, data)');
const block = START < 0 ? '' : content.slice(START, content.indexOf('\n    },', START));

test('能定位到 downloadJSON 方法', () => {
  assert.ok(START > 0, '未找到 downloadJSON(filename, data)');
  assert.ok(block.length > 100, 'downloadJSON 方法体异常');
});

test('元数据声明 @grant GM_download', () => {
  assert.match(content, /\/\/\s*@grant\s+GM_download/,
    '缺少 @grant GM_download，运行时会拿不到 GM_download');
});

test('优先使用 GM_download，且先用 typeof 探测', () => {
  assert.match(block, /typeof\s+GM_download\s*===\s*'function'/,
    '必须先探测 GM_download 是否存在（非油猴环境没有它）');
  assert.match(block, /GM_download\s*\(\s*\{/, '应调用 GM_download');
  assert.match(block, /name:\s*filename/, 'GM_download 应传下载文件名');
});

test('GM_download 分支必须排在 blob 兜底之前', () => {
  const gm = block.indexOf('GM_download({');
  const blob = block.indexOf('createObjectURL');
  assert.ok(gm > 0, '未找到 GM_download 调用');
  assert.ok(blob > 0, '兜底路径应保留原有 blob 实现');
  assert.ok(gm < blob, 'GM_download 必须优先；否则沙箱下仍会走坏掉的 blob 路径');
});

test('GM_download 用 data: URL 且做了 URL 编码', () => {
  assert.match(block, /data:application\/json;charset=utf-8,/,
    'GM_download 应传 data: URL（无生命周期问题，不会被 revoke）');
  assert.match(block, /encodeURIComponent/, 'data: URL 内容必须 encodeURIComponent');
});

test('非油猴兜底保留原有 <a download> 行为', () => {
  assert.match(block, /createElement\('a'\)/, '兜底通道应创建一个 anchor');
  assert.match(block, /a\.download\s*=\s*filename/, '兜底 anchor 必须设置 download 文件名');
});
