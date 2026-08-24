// Build script.
//
// 当前架构：.user.js 是手写 + git 跟踪的，没有构建步骤。
// src/ 里是可测试的纯模块，tests/ 保证 .user.js 与 src/ 同步。
//
// 未来如果要做 split-and-bundle（如用 esbuild 把 src/* 打包进 .user.js），
// 就在这里实现。当前仅做完整性校验。

import { statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ARTIFACT = join(ROOT, 'bilibili-following-manager.user.js');

const stat = statSync(ARTIFACT);
if (stat.size < 10_000) {
  console.error(`✗ ${ARTIFACT} 大小异常：${stat.size} 字节`);
  process.exit(1);
}
console.log(`✓ ${ARTIFACT} (${(stat.size / 1024).toFixed(1)} KB)`);