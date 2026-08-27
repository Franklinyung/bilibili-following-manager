// 风控日历（v0.10.5）单元测试
//
// 策略：把 user.js 当成一段源码，去掉 UserScript metadata 后用 vm.runInContext
// 加载到一个 jsdom-backed context 里。user.js 末尾有 Node-only 的测试 hook（仅在
// process.versions.node 存在时挂载 utils），借此把 IIFE 里的 utils 拿出来。
// 之后用内存 store 替换 GM_getValue/GM_setValue，独立测试 4 个函数。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_JS = join(ROOT, 'bilibili-following-manager.user.js');

// 加载 user.js，返回 utils 引用。store 是 { key: value } 的内存字典，
// 模拟 GM_setValue / GM_getValue 的持久层。
function loadUtils(store) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  // 去掉 // ==UserScript== ... // ==/UserScript== 头部（保留 sourceURL 让 vm 报错行号友好）
  const src = readFileSync(USER_JS, 'utf8')
    .replace(/^\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==[^\n]*\n/, '');

  const ctx = {
    document: dom.window.document,
    window: dom.window,
    location: dom.window.location,
    console,
    // setTimeout 立即触发：否则 windGuard(red) 测试会真睡 5 分钟
    setTimeout: (fn) => { fn(); return 0; },
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    Promise,
    Date, // 让测试可改 ctx.Date.now
    GM_getValue: (k, def) => (k in store ? store[k] : def),
    GM_setValue: (k, v) => { store[k] = v; },
    GM_xmlhttpRequest: () => {},
    GM_addStyle: () => {},
    GM_registerMenuCommand: () => {},
    process, // 让 typeof process 通过，触发 __bfm_utils 测试 hook
  };
  vm.createContext(ctx);
  try {
    vm.runInContext(src, ctx);
  } catch (e) {
    // init() 内部有 try/catch；但万一仍泄漏，只要 hook 已挂上就不算失败
    if (!ctx.__bfm_utils) throw e;
  }
  if (!ctx.__bfm_utils) {
    throw new Error('__bfm_utils 未挂载 — 测试 hook 没生效');
  }
  return { utils: ctx.__bfm_utils, ctx };
}

function freshStore() { return {}; }

// ============================================================
// 规格 §8 测试用例
// ============================================================

test('windLoad: GM_getValue 返回 null → null', () => {
  const { utils: u } = loadUtils(freshStore());
  assert.equal(u.windLoad(), null);
});

test('windLoad: GM_getValue 返回损坏 JSON → catch → null', () => {
  const store = { bfm_wind_calendar_v1: '{not-json' };
  const { utils: u } = loadUtils(store);
  assert.equal(u.windLoad(), null);
});

test('windRecord: 超过 200 条时截断，保留最新 200 条', () => {
  const store = freshStore();
  const { utils: u, ctx } = loadUtils(store);
  let fakeNow = 1000;
  const origNow = ctx.Date.now;
  ctx.Date.now = () => fakeNow;
  try {
    for (let i = 0; i < 201; i++) {
      u.windRecord('unfollow', 1, 'ok', 0);
      fakeNow++;
    }
  } finally {
    ctx.Date.now = origNow;
  }
  const data = u.windLoad();
  assert.equal(data.records.length, 200);
  // 最老的 ts=1000 被切，剩余 1001..1200
  assert.equal(data.records[0].ts, 1001, '第一条应为原始第 2 条');
  assert.equal(data.records[199].ts, 1200);
});

test('windStatus: 空数据 → heat 0 / green / 空 totals / null lastRiskAge', () => {
  const { utils: u } = loadUtils(freshStore());
  const s = u.windStatus();
  assert.equal(s.heat, 0);
  assert.equal(s.level, 'green');
  // vm context 与 Node 的 Object.prototype 不同；用 keys 长度比较避免原型问题
  assert.equal(Object.keys(s.totals24h).length, 0);
  assert.equal(s.lastRiskAgeMin, null);
});

test('windStatus: 1h 前 unfollow ok × 50 → heat ≥ 25 且 level=yellow', () => {
  const store = freshStore();
  const { utils: u } = loadUtils(store);
  const now = Date.now();
  const d = { version: 1, records: [] };
  for (let i = 0; i < 50; i++) {
    d.records.push({ ts: now - 3600_000, op: 'unfollow', count: 1, result: 'ok', durationMs: 0 });
  }
  store.bfm_wind_calendar_v1 = JSON.stringify(d);
  const s = u.windStatus();
  // 理论值：1.0 × 1.0 × exp(-0.5) × 50 ≈ 30.3
  assert.ok(s.heat >= 25 && s.heat <= 35, `heat 应在 25-35 范围，实际 ${s.heat}`);
  assert.equal(s.level, 'yellow', '30.3 ≥ 30 → yellow');
  assert.equal(s.totals24h.unfollow, 50);
  assert.equal(s.totals24h.writeOps, 50);
});

test('windStatus: -352 比同 count 的 ok 热度高 2.5×', () => {
  const mkData = (result) => {
    const d = { version: 1, records: [] };
    for (let i = 0; i < 50; i++) {
      d.records.push({ ts: Date.now() - 3600_000, op: 'unfollow', count: 1, result, durationMs: 0 });
    }
    return d;
  };
  const storeOk = freshStore();
  const { utils: uOk } = loadUtils(storeOk);
  storeOk.bfm_wind_calendar_v1 = JSON.stringify(mkData('ok'));
  const heatOk = uOk.windStatus().heat;

  const storeRisk = freshStore();
  const { utils: uRisk } = loadUtils(storeRisk);
  storeRisk.bfm_wind_calendar_v1 = JSON.stringify(mkData('-352'));
  const heatRisk = uRisk.windStatus().heat;

  const ratio = heatRisk / heatOk;
  assert.ok(ratio >= 2.4 && ratio <= 2.6, `ratio 应≈2.5，实际 ${ratio}`);
});

test('windGuard: red 级别返回 300000ms（5min）且真的 sleep 了', async () => {
  const store = freshStore();
  const { utils: u } = loadUtils(store);
  // 注入 90 条 0s 前 -352 unfollow，heat ≈ 1.0 × 2.5 × exp(0) × 90 = 225 → red
  const d = { version: 1, records: [] };
  for (let i = 0; i < 90; i++) {
    d.records.push({ ts: Date.now(), op: 'unfollow', count: 1, result: '-352', durationMs: 0 });
  }
  store.bfm_wind_calendar_v1 = JSON.stringify(d);
  // windGuard 是 async：返回值必须 await 拿到（回归：曾是同步 number，await 无效不减速）
  assert.equal(await u.windGuard(), 300000);
});

test('windGuard: green 级别立即返回 0 不 sleep', async () => {
  const { utils: u } = loadUtils(freshStore());
  assert.equal(await u.windGuard(), 0);
});

test('parseApiCode: API -352 → -352（正则会自带负号，不可再加）', () => {
  const { utils: u } = loadUtils(freshStore());
  assert.equal(u.parseApiCode(new Error('API -352: risk')), '-352');
  assert.equal(u.parseApiCode(new Error('API -412: too fast')), '-412');
  assert.equal(u.parseApiCode(new Error('NOT_LOGGED_IN')), '-101');
  assert.equal(u.parseApiCode(new Error('network error')), 'other');
  assert.equal(u.parseApiCode(null), 'other');
});