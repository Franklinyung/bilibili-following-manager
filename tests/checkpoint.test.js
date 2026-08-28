// AI 分组断点续传测试。
//
// 场景：1000 UP 主，跑到第 10 批时浏览器崩溃 / 网络断。
// 下次进入要能从第 11 批继续，已收集的 suggestions 不能丢。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_JS = readFileSync(join(ROOT, 'bilibili-following-manager.user.js'), 'utf8');

// ---- aiJob schema 校验 ----

function isValidAiJob(job) {
  if (!job || typeof job !== 'object') return false;
  if (job.type !== 'grouping') return false;
  if (typeof job.startedAt !== 'number') return false;
  if (typeof job.lastUpdate !== 'number') return false;
  if (!Array.isArray(job.pendingMids)) return false;
  if (!Array.isArray(job.collected)) return false;
  if (!Array.isArray(job.failed)) return false;
  return true;
}

test('aiJob schema 必须包含所有必要字段', () => {
  const sample = {
    type: 'grouping',
    startedAt: Date.now(),
    pendingMids: [1, 2, 3],
    collected: [{ mid: 1, uname: 'A', groupName: '技术' }],
    failed: [],
    lastUpdate: Date.now(),
  };
  assert.ok(isValidAiJob(sample));
});

test('aiJob 缺字段视为无效', () => {
  assert.equal(isValidAiJob(null), false);
  assert.equal(isValidAiJob({}), false);
  assert.equal(isValidAiJob({ type: 'grouping' }), false, '缺其他字段');
  assert.equal(isValidAiJob({ type: 'wrong', startedAt: 0, lastUpdate: 0, pendingMids: [], collected: [], failed: [] }), false, 'type 错误');
});

// ---- 24 小时过期逻辑 ----

test('超过 24 小时的 aiJob 视为过期', () => {
  const ONE_DAY = 24 * 3600 * 1000;
  const expired = { ...validJob(), lastUpdate: Date.now() - ONE_DAY - 1 };
  const fresh = { ...validJob(), lastUpdate: Date.now() - 1000 };
  // 模拟 runAIGrouping 中的检查逻辑
  const shouldResume = (job) => Date.now() - (job.lastUpdate || 0) < ONE_DAY;
  assert.equal(shouldResume(expired), false);
  assert.equal(shouldResume(fresh), true);
});

// ---- 中断恢复：mid 列表还原 ----

test('断点续传：deleted mids 自动从 pendingMids 移除', () => {
  // 已取关的 UP 主（mid 7）不在 fullTargets 里
  const fullTargets = [{ mid: 1 }, { mid: 2 }, { mid: 3 }, { mid: 5 }].map(u => ({ mid: u.mid, uname: `UP${u.mid}` }));
  const savedMids = [1, 2, 3, 5, 7];  // 7 已取关
  
  const midSet = new Set(fullTargets.map(u => u.mid));
  const midToUser = new Map(fullTargets.map(u => [u.mid, u]));
  const restored = savedMids
    .map(m => midToUser.get(m))
    .filter(Boolean);
  
  assert.deepEqual(restored.map(u => u.mid), [1, 2, 3, 5], 'deleted mid 应被移除');
});

// ---- sync 护栏：保证 .user.js 有 checkpoint 逻辑 ----

test('.user.js 包含 aiJob checkpoint 持久化', () => {
  assert.match(USER_JS, /storage\.state\.aiJob/, '必须读写 storage.state.aiJob');
  assert.match(USER_JS, /pendingMids/, 'checkpoint 必须包含 pendingMids');
  assert.match(USER_JS, /collected/, 'checkpoint 必须包含 collected');
});

test('.user.js 断点续传检测逻辑存在', () => {
  // 进入时检测 aiJob
  assert.match(USER_JS, /existingJob|state\.aiJob/,
    '必须读取 storage.state.aiJob');
  // 弹窗询问用户
  assert.match(USER_JS, /检测到上次 AI 分组中断|继续处理剩余的/,
    '必须弹窗提示用户有未完成任务');
});

test('.user.js aiJob 过期（24h）清理', () => {
  // 24 * 3600 * 1000 = 86400000
  assert.match(USER_JS, /24\s*\*\s*3600\s*\*\s*1000|ONE_DAY\s*=\s*24/,
    '必须有 24 小时过期判断');
});

test('.user.js 每批结束保存 checkpoint', () => {
  // 每批成功后 aiJob.pendingMids 应该是剩余的 mid
  assert.match(USER_JS, /aiJob\.pendingMids\s*=/,
    '每批结束必须更新 pendingMids（剩余的 mid）');
  assert.match(USER_JS, /storage\.save\(\)/,
    '必须调用 storage.save() 持久化');
});

test('.user.js 任务完成时清除 aiJob', () => {
  assert.match(USER_JS, /delete storage\.state\.aiJob/,
    '任务完成或用户重新开始时必须清除 aiJob');
});

test('.user.js 用户停止时保留 aiJob 以便续传', () => {
  // 检查 stopped 分支有"保留"逻辑
  // 通过搜索注释或文案确认
  assert.match(USER_JS, /下次点击.*AI 分组.*继续|下次可继续/,
    '停止时必须告诉用户可继续');
});

test('.user.js 断点续传必须合并 pendingMids 和 failed（失败批能重试）', () => {
  // 抓取 resume 分支关键实现，防止回退到只读 pendingMids。
  assert.match(USER_JS, /failedMidsFromJob/,
    '恢复时必须读取 checkpoint 里的 failed mid');
  assert.match(USER_JS, /\[\.\.\.pendingMids,\s*\.\.\.failedMidsFromJob\]/,
    '待分析队列必须包含失败批');
  assert.match(
    USER_JS,
    /aiJob\.pendingMids\s*=\s*\[\.\.\.new Set\(failedMids\.map\(f\s*=>\s*f\.mid\)\)\]/,
    '本轮完成后必须把失败项写回下一轮 pending');
});

function validJob() {
  return {
    type: 'grouping',
    startedAt: Date.now(),
    pendingMids: [1, 2, 3],
    collected: [],
    failed: [],
    lastUpdate: Date.now(),
  };
}
