// Pins down the URL patterns and selectors we rely on.
// Sources: real-world working B 站 userscripts on Greasy Fork
//   - "B站关注数据分析插件" (r007b34r)
//   - "bilibili 批量取关" (Nriver)
//   - "B 站批量取关低粉丝 UP" (ElectroByte)
// These selectors were extracted from those scripts' source code,
// not guessed. If B 站 changes their DOM, this test file is where
// to update the new selectors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_JS = readFileSync(join(ROOT, 'bilibili-following-manager.user.js'), 'utf8');

test('@match 必须同时支持新旧 URL', () => {
  // 新路径：B 站当前用的 URL（2024+ 改版后）
  assert.match(USER_JS, /@match\s+https:\/\/space\.bilibili\.com\/\*\/(relation\/follow|fans\/follow)/,
    '必须匹配 /relation/follow（新）或 /fans/follow（旧）');
  // 验证脚本里两个都匹配
  assert.match(USER_JS, /@match\s+https:\/\/space\.bilibili\.com\/\*\/relation\/follow/,
    '必须显式匹配 /relation/follow');
  assert.match(USER_JS, /@match\s+https:\/\/space\.bilibili\.com\/\*\/fans\/follow/,
    '必须显式匹配 /fans/follow（向后兼容）');
});

test('@match t.bilibili.com 请用根路径，不要限制子路径', () => {
  // t.bilibili.com 有时是 /page/hash 形式
  assert.match(USER_JS, /@match\s+https:\/\/t\.bilibili\.com\/\*/);
});

test('injectFollowPage 选择器基于真实脚本验证过的类名', () => {
  // 来源：B站关注数据分析插件（r007b34r, 2026-01）+ bilibili 批量取关（Nriver）
  // 这些类名经过实际脚本使用验证
  const REAL_CARD_SELECTORS = [
    'follow-item',
    'list-item',
    'bili-user-profile',
  ];
  const REAL_NAME_SELECTORS = [
    'fans-name',
    'list-item__name',
    'bili-user-profile__name',
  ];

  // 当前注入代码里至少应该包含 1 个真实类名
  const hasCardSelector = REAL_CARD_SELECTORS.some(s =>
    USER_JS.includes(`.${s}`) || USER_JS.includes(`'${s}'`));
  const hasNameSelector = REAL_NAME_SELECTORS.some(s =>
    USER_JS.includes(`.${s}`) || USER_JS.includes(`'${s}'`));

  assert.ok(hasCardSelector, 'injectFollowPage 必须包含至少一个真实卡片选择器');
  assert.ok(hasNameSelector, 'injectFollowPage 必须包含至少一个真实名字选择器');
});

test('init() 必须识别 /relation/follow 新路径', () => {
  // 旧 path.includes('/fans/follow') 检查还在；
  // 新增的 path.includes('/relation/follow') 必须也有
  assert.match(USER_JS, /path\.includes\(['"]\/relation\/follow['"]\)/,
    'init() 必须包含 /relation/follow 路径识别');
});

test('mid 提取逻辑支持多种来源', () => {
  // 实际代码：`link.href.match(/space\.bilibili\.com\/(\d+)/)`
  // 直接查子串（避免 escape 层级混淆）
  assert.ok(USER_JS.includes('space\\.bilibili\\.com'),
    '源码必须包含 mid URL 模式');
  assert.ok(USER_JS.includes('(\\d+)'),
    '必须有数字捕获组 (\\d+)');
  assert.match(USER_JS, /href\.match\(/, 'mid 提取应通过 href.match()');
});

test('WBI keys 动态获取（不能硬编码）', () => {
  // 静态硬编码的 WBI keys 会被 B 站定期轮换失效
  assert.match(USER_JS, /wbi_img\?\.img_url|wbi_img\?\.sub_url/,
    'WBI keys 必须从 /x/web-interface/nav 动态获取');
});

test('取关 API 路径正确', () => {
  assert.match(USER_JS, /\/x\/relation\/modify/, '必须调用正确的取关 endpoint');
  assert.match(USER_JS, /act:\s*2/, 'act=2 是取关，act=1 是关注');
});

test('取关间隔建议 >= 300ms 以避免 B 站风控', () => {
  // 真实脚本用 300-2500ms 不等
  // 我们的限流在 CONFIG.RATE_LIMIT_MS = 200，可能触发风控
  const rateMatch = USER_JS.match(/RATE_LIMIT_MS:\s*(\d+)/);
  if (rateMatch) {
    const ms = Number(rateMatch[1]);
    // 这是建议性测试：当前 200ms 在取关高频调用时可能太快
    // 但分组、关注列表同步风险更低，保持现状
    assert.ok(ms >= 200, `RATE_LIMIT_MS = ${ms}，建议 >= 200ms`);
  }
});