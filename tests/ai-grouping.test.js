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

// ──────────────────────────────────────────────────────────────────────────
// v0.10.3 修复：
//   1. JSON 解析容错（_parseJsonArray：剥 markdown / 修 trailing comma / 找括号）
//   2. JSON 解析失败时重试一次
//   3. _applyAISuggestions：createGroup 失败要记录、find 失败要降级为 includes、
//      报告分类（成功 / 创建失败 / 匹配失败 / 加入失败）
// ──────────────────────────────────────────────────────────────────────────

test('v0.10.3: 有 _parseJsonArray 容错 helper', () => {
  assert.match(USER_JS, /_parseJsonArray\s*\(\s*content\s*\)/,
    '必须实现 _parseJsonArray(content) 容错解析');
});

test('v0.10.3: _parseJsonArray 必须处理 markdown 代码块', () => {
  const block = USER_JS.match(/_parseJsonArray\s*\(\s*content\s*\)\s*\{[\s\S]*?\n\s{4}\}/);
  assert.ok(block, '_parseJsonArray 函数必须存在');
  assert.match(block[0], /```/,
    '必须识别 markdown 代码块包裹（```）');
  assert.match(block[0], /bracketStart|lastIndexOf|indexOf/,
    '必须用方括号定位提取 JSON 数组');
});

test('v0.10.3: _parseJsonArray 必须处理 trailing comma', () => {
  const block = USER_JS.match(/_parseJsonArray\s*\(\s*content\s*\)\s*\{[\s\S]*?\n\s{4}\}/);
  assert.match(block[0], /trailing\s*comma|,(\s*\[}\]\])/,
    '必须移除 trailing comma 容忍 JSON 格式错误');
});

test('v0.10.3: suggestGrouping 解析失败时必须重试一次', () => {
  const block = USER_JS.match(/async\s+suggestGrouping\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/);
  assert.ok(block, 'suggestGrouping 函数必须存在');
  // 重试模式：在 try/catch 后再次 await this.chat(...)
  assert.match(block[0], /_parseJsonArray/,
    'suggestGrouping 必须用 _parseJsonArray 解析');
  // 第二次 chat 调用（重试）
  const chatCalls = block[0].match(/this\.chat\s*\(/g) || [];
  assert.ok(chatCalls.length >= 2,
    `suggestGrouping 至少调用 chat 两次（首次 + 重试），实际 ${chatCalls.length} 次`);
});

test('v0.10.3: _applyAISuggestions 必须跟踪 createGroup 失败', () => {
  const block = USER_JS.match(/async\s+_applyAISuggestions\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/);
  assert.ok(block, '_applyAISuggestions 函数必须存在');
  assert.match(block[0], /createResults/,
    '必须用 createResults 数组记录每个分组的成败');
  assert.match(block[0], /failedMatches/,
    '必须用 failedMatches 数组记录分组名匹配失败的');
  assert.match(block[0], /failedAdds/,
    '必须用 failedAdds 数组记录加入分组 API 失败的');
});

test('v0.10.3: _applyAISuggestions 必须有降级匹配（精确 → includes）', () => {
  const block = USER_JS.match(/async\s+_applyAISuggestions\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/);
  assert.match(block[0], /\.includes\s*\(|\.includes/,
    'find 失败时必须降级为 includes 模糊匹配');
});

test('v0.10.3: _applyAISuggestions 完成时必须报告分类明细', () => {
  const block = USER_JS.match(/async\s+_applyAISuggestions\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/);
  // 报告必须包含三类失败中至少两类的提示
  assert.match(block[0], /分组创建失败|分组名找不到匹配|加入分组失败/,
    '汇总 alert 必须分类提示失败原因');
});

test('v0.10.3: _applyAISuggestions 不再 silently warn（必须收集到结果数组）', () => {
  // 历史 bug：createGroup 失败只 utils.warn，用户看不到 → "应用后 0 个成功"
  // 修复后必须 push 到 createResults 数组
  const block = USER_JS.match(/async\s+_applyAISuggestions\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/);
  // createGroup 调用前后必须有 push 到 createResults 的逻辑
  assert.match(block[0], /createResults\.push/,
    'createGroup 调用后必须 push 到 createResults，不能只 warn');
});

// ──────────────────────────────────────────────────────────────────────────
// v0.10.4：风控退避 + 写操作节流 + 分组准确率（prompt v2）
// 背景：用户批量取关后账号进入风控期，addUsersToGroup 一批 50 个 mid + 200ms
// 间隔必然连续 -352 失败；同时模型批 30 个时漏人/乱建新组。
// ──────────────────────────────────────────────────────────────────────────

test('v0.10.4: 风控码 -352/-412 必须用长退避（不是普通 500ms）', () => {
  const block = USER_JS.match(/request\(url,\s*opts = \{\}\)\s*\{[\s\S]*?\n    \},/);
  assert.ok(block, 'api.request 函数必须存在');
  assert.match(block[0], /-352|-412/, '必须识别风控错误码');
  assert.match(block[0], /isRisk|5000/, '风控退避至少 5s 起步');
});

test('v0.10.4: addUsersToGroup 单块 ≤25 个 mid 且块间有间隔', () => {
  const block = USER_JS.match(/addUsersToGroup\(tagid,\s*mids\)\s*\{[\s\S]*?\n    \},/);
  assert.ok(block, 'addUsersToGroup 必须存在');
  assert.match(block[0], /i \+= 25/, '单块从 50 降到 25');
  assert.match(block[0], /_sleep\(600\)/, '块间必须有 600ms 间隔');
});

test('v0.10.4: removeUsersFromGroup 同样降块 + 块间间隔', () => {
  const block = USER_JS.match(/removeUsersFromGroup\(tagid,\s*mids\)\s*\{[\s\S]*?\n    \},/);
  assert.match(block[0], /i \+= 25/, '单块 25');
  assert.match(block[0], /_sleep\(600\)/, '块间 600ms');
});

test('v0.10.4: _applyAISuggestions 跨分组写之间要有呼吸间隔', () => {
  const block = USER_JS.match(/async\s+_applyAISuggestions\s*\([^)]*\)\s*\{[\s\S]*?\n\s{4}\}/);
  assert.match(block[0], /_sleep\(300\)/, '跨分组之间必须 _sleep(300)');
});

test('v0.10.4: AI 分组批次降到 20', () => {
  const block = USER_JS.match(/runAIGrouping[\s\S]*?const BATCH = (\d+)/);
  assert.equal(Number(block?.[1]), 20, 'BATCH 必须 = 20（30 个太大，漏人严重）');
});

test('v0.10.4: prompt 硬性要求复用已有分组并限制新组数', () => {
  const block = USER_JS.match(/async suggestGrouping\([\s\S]*?\n    \},/);
  assert.ok(block, 'suggestGrouping 必须存在');
  assert.match(block[0], /必须复用|原样照抄/, '必须硬性要求复用已有组名');
  assert.match(block[0], /新分组总数不要超过|不超过 ?3 ?个/, '必须限制新组数量');
  assert.match(block[0], /已有 \$\{|已有 .*人/, '分组清单要带人数（大组优先复用）');
  assert.match(block[0], /count/, '要读取分组的 count 字段排序');
});

test('v0.10.4: suggestGrouping 把 opts.timeout 传给 chat', () => {
  const block = USER_JS.match(/async suggestGrouping\([\s\S]*?\n    \},/);
  assert.match(block[0], /opts\.timeout/, '调用方传入的 timeout 不能被忽略');
});