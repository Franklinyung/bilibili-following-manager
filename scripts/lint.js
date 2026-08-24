// Lint placeholder — extends naturally as the codebase grows.
// Currently we rely on smoke.js + tests for code quality gates,
// since the .user.js is a single large file and standard linters
// (eslint) don't parse the userscript metadata well.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let failed = 0;
function check(name, ok, hint = '') {
  if (!ok) {
    console.error(`✗ ${name}${hint ? ' — ' + hint : ''}`);
    failed++;
  } else {
    console.log(`✓ ${name}`);
  }
}

// 检查 src/ 文件不超过 1000 行（保持可读）
import { readdirSync, statSync } from 'node:fs';
function walk(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith('.mjs')) out.push(p);
  }
  return out;
}

for (const file of walk(join(ROOT, 'src'))) {
  const lines = readFileSync(file, 'utf8').split('\n').length;
  check(`${file.replace(ROOT + '/', '')} ≤ 1000 行`, lines <= 1000, `实际 ${lines} 行`);
}

// 检查没有 hardcoded 的 API key 前缀（应使用占位符）
const userJs = readFileSync(join(ROOT, 'bilibili-following-manager.user.js'), 'utf8');
check('.user.js 不含真实 API key',
  !/sk-[a-zA-Z0-9_-]{20,}/.test(userJs),
  '检测到形如 sk-xxx 的硬编码 key');

if (failed > 0) {
  console.error(`\n${failed} 项 lint 失败`);
  process.exit(1);
} else {
  console.log('\n所有 lint 检查通过');
}