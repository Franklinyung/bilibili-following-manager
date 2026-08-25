// 特别关注（starred）功能测试
//
// 行为：
// - following[mid].starred = true 表示用户手动标记的特别关注
// - 死粉 tab 顶部 toggle [⭐ N] 切换"只看特别关注"
// - AI 推断（analyzeProfile 返回 suggestedUnstar）可标记 UP 不该是特别关注

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_JS = readFileSync(join(ROOT, 'bilibili-following-manager.user.js'), 'utf8');

// ---- 同步要求：保证 .user.js 包含 starred 字段 ----

test('.user.js 包含 starred 字段读写', () => {
  assert.match(USER_JS, /starred\s*=/, '代码中必须存在 starred 字段赋值');
});

test('.user.js 包含 ⭐ 标星按钮渲染', () => {
  assert.match(USER_JS, /bfm-star-btn/, '必须有 bfm-star-btn class');
  assert.match(USER_JS, /is-starred/, '必须有 is-starred 状态 class');
  assert.match(USER_JS, /data-mid="\${u\.mid}" title="\$\{starred[^}]*特别关注/,
    '按钮 title 必须根据 starred 状态切换文字');
});

test('.user.js 包含"只看特别关注"切换按钮', () => {
  assert.match(USER_JS, /bfm-starred-only/, '必须有 bfm-starred-only id');
  assert.match(USER_JS, /_starredOnly/, '必须维护 _starredOnly 状态');
});

test('.user.js ★ 与 ☆ 字符对应星标状态', () => {
  // 模板字符串里：${starred ? '★' : '☆'}
  assert.match(USER_JS, /starred\s*\?\s*'★'\s*:\s*'☆'/, '必须 ★ 在已标星分支，☆ 在未标星分支');
});

// ---- 数据过滤逻辑（手动测试预期） ----

test('starred=true 的 UP 在"只看特别关注"模式下应显示', () => {
  // 模拟 renderInactive 中的过滤逻辑
  const dead = [
    { mid: 1, uname: 'A', starred: true },
    { mid: 2, uname: 'B', starred: false },
    { mid: 3, uname: 'C', starred: true },
  ];
  const starredOnly = true;
  const visible = starredOnly ? dead.filter(u => u.starred) : dead;
  assert.deepEqual(visible.map(u => u.mid), [1, 3]);
});

test('starred=false 的 UP 在普通模式下全部显示', () => {
  const dead = [
    { mid: 1, uname: 'A', starred: true },
    { mid: 2, uname: 'B', starred: false },
  ];
  const visible = dead; // 默认模式
  assert.equal(visible.length, 2);
});

test('undefined starred 应被当作 false 处理', () => {
  const dead = [
    { mid: 1, uname: 'A', starred: true },
    { mid: 2, uname: 'B' }, // 没有 starred 字段（老数据）
  ];
  const visible = dead.filter(u => !!u.starred);
  assert.deepEqual(visible.map(u => u.mid), [1]);
});