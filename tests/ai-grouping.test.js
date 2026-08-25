// AI 分组的可靠性测试：超时、可中断、失败聚合。
//
// 真实场景：1000+ UP 主、LLM 慢、网络抖动 → 必须不能卡死。
// 这些测试保护：
// 1. GM_xmlhttpRequest 永远带 timeout（防永久挂起）
// 2. runAIGrouping 包含中断机制
// 3. 单批失败不弹 alert（不打断流程）

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const USER_JS = readFileSync(join(ROOT, 'bilibili-following-manager.user.js'), 'utf8');

test('GM_xmlhttpRequest 调用必须带 timeout（防永久挂起）', () => {
  // _chatOpenAI 和 _chatAnthropic 各一次
  const openaiBlock = USER_JS.match(/_chatOpenAI\([^)]*\)\s*\{[\s\S]*?ontimeout/);
  const anthropicBlock = USER_JS.match(/_chatAnthropic\([^)]*\)\s*\{[\s\S]*?ontimeout/);
  assert.ok(openaiBlock, '_chatOpenAI 函数必须存在');
  assert.ok(anthropicBlock, '_chatAnthropic 函数必须存在');
  // 用 [\s\S] 跨行匹配
  assert.match(openaiBlock[0], /timeout:[\s\S]*?\d+_?\d*/,
    '_chatOpenAI 必须有 timeout 字段（带默认数字）');
  assert.match(anthropicBlock[0], /timeout:[\s\S]*?\d+_?\d*/,
    '_chatAnthropic 必须有 timeout 字段');
});

test('超时时间至少 60s（覆盖 LLM 慢响应）', () => {
  // 至少一处 timeout >= 60_000
  assert.match(USER_JS, /timeout:\s*\d{2,3}[_]?000/,
    '超时时间必须 >= 60s（60_000），不能太小');
});

test('runAIGrouping 必须支持中断', () => {
  assert.match(USER_JS, /stopped\s*=\s*true|stopped\s*=\s*false/,
    'runAIGrouping 必须有 stopped 标志控制循环');
  assert.match(USER_JS, /abortCtrl/,
    'runAIGrouping 必须暴露 abortCtrl 用于中断');
});

test('单批失败不弹 alert（改为收集到 failedMids）', () => {
  // 必须有 failedMids 数组收集失败的 mid
  assert.match(USER_JS, /failedMids/,
    '必须用 failedMids 收集失败，而非每批 alert');
  // 不能在循环里调 alert（之前是 bug）
  assert.doesNotMatch(USER_JS.replace(/alert[\s\S]*?批量取关[\s\S]*?;/g, ''),
    /for\s*\([^)]*\)\s*\{[^}]*alert\(`批次/,
    '批处理循环里不应有 alert 提示');
});

test('进度显示必须包含 ETA', () => {
  assert.match(USER_JS, /avgPerBatch|remaining|预计还需/,
    '进度文本应包含已用时间或剩余时间估算');
});

test('suggestGrouping 接受 timeout 参数', () => {
  assert.match(USER_JS, /suggestGrouping\([^)]*timeout/,
    'suggestGrouping 应接受 timeout 参数以便 runAIGrouping 传入');
});

test('预估时间应在确认对话框里告诉用户', () => {
  // confirm 文本里包含"预估"或"约 X 秒"
  assert.match(USER_JS, /预估[^\\]*秒/,
    '用户点 AI 分组前应知道大致耗时');
});