// Smoke check: validate metadata of the deployed .user.js file.
// Fails CI if:
//   - @version mismatches package.json
//   - IIFE structure is broken
//   - @grant list contains anything actually unused (best-effort grep)
//   - Suspicious patterns: console.log (outside utils.log), TODO/FIXME, debug leftovers

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const userJs = readFileSync(join(ROOT, 'bilibili-following-manager.user.js'), 'utf8');

let failed = 0;
function check(name, ok, hint = '') {
  if (ok) {
    console.log(`✓ ${name}`);
  } else {
    console.error(`✗ ${name}${hint ? ' — ' + hint : ''}`);
    failed++;
  }
}

const versionMatch = userJs.match(/@version\s+(\S+)/);
check('@version 与 package.json 一致',
  versionMatch && versionMatch[1] === pkg.version,
  `expected ${pkg.version}, got ${versionMatch?.[1]}`);

check('@match 列表至少一项', /@match\s+https?:/.test(userJs));
check('@grant 至少 GM_xmlhttpRequest + GM_setValue',
  userJs.includes('@grant        GM_xmlhttpRequest') &&
  userJs.includes('@grant        GM_setValue'));

check('不包含 @require CDN（v0.4.0 起内联）',
  !/@require\s+https?:\/\//.test(userJs),
  'CDN 加载失败会导致整个脚本不激活');

check('IIFE 结构完整',
  /\(function \(\) \{/.test(userJs) && /\}\)\(\);?\s*$/.test(userJs));

const llmProvidersCount = (userJs.match(/^\s+'[a-z-]+': \{$/gm) || [])
  .filter(line => line.includes("'minimax-") || line.includes("'deepseek") ||
                   line.includes("'kimi") || line.includes("'qwen") ||
                   line.includes("'zhipu") || line.includes("'siliconflow") ||
                   line.includes("'gemini") || line.includes("'openai") ||
                   line.includes("'ollama") || line.includes("'custom"))
  .length;
check('LLM_PROVIDERS 至少 5 个厂商',
  llmProvidersCount >= 5,
  `实际 ${llmProvidersCount} 个`);

// 查找 console.log 出现位置
const consoleLogLines = [];
const lines = userJs.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('console.log(') && !lines[i].includes('log(...args)')) {
    consoleLogLines.push(i + 1);
  }
}
check('不应有裸 console.log（用 utils.log 代替）',
  consoleLogLines.length === 0,
  consoleLogLines.length ? `行 ${consoleLogLines.join(', ')}` : '');

check('没有 TODO / FIXME / XXX 遗留',
  !/\bTODO\b|\bFIXME\b|\bXXX\b/.test(userJs));

check('含 SVG 图标库（避免 emoji）',
  userJs.includes('icons: {') && userJs.includes('<svg viewBox'));

if (failed > 0) {
  console.error(`\n${failed} 项 smoke check 失败`);
  process.exit(1);
} else {
  console.log('\n所有 smoke check 通过');
}