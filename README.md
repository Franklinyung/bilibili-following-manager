# B 站关注管理助手 (bilibili-following-manager)

> 一个油猴脚本，让你的关注列表井井有条——批量分组、动态页分组筛选、死粉识别、AI 智能分类、断点续传。
>
> 配套独立项目：[**bilibili-home-cleaner**](https://github.com/Franklinyung/bilibili-home-cleaner) — 隐藏首页轮播广告、"短视频"Tab、给视频卡片加分类标签、按分类浏览。与本脚本互不干扰，建议同时启用。

**GitHub**：https://github.com/Franklinyung/bilibili-following-manager
**当前版本**：v0.10.6 · **测试**：171 / 171 通过 · 9 / 9 smoke 通过

---

## 为什么需要它

B 站推荐流越来越偏向热门和冷启动，**关注的几百上千位 UP 主经常看不到**。本脚本帮你：

- 把关注的 UP 主按兴趣分组（技术 / 学习 / 娱乐 / 摸鱼 / ...）
- 在动态页只看指定分组的动态，告别"系统替我决定优先级"
- 标记⭐手动标星的"特别关注"UP，**置顶**且带**新动态小红点**
- 一键识别长期不更新的"死粉"（已注销 / 停更 / 变质三段细分），决定是否取关
- 批量分组 / 批量取关，免去一个个手动操作的痛苦
- AI 智能分组 + 关注画像分析，**断点续传**支持几千人次的全量分析

---

## 功能特性

### 关注列表
- 📥 **全量同步关注列表** + 分组到本地缓存
- 🗂️ **分组 CRUD** — 创建 / 重命名 / 删除（B 站官方分组，跨设备同步）
- ☑️ **批量分组** — 在 `space.bilibili.com/*/relation/follow` 多选 UP 主一键加入 / 移出分组
- ⭐ **特别关注** — 手动标星（双层分组：⭐ 特别关注 / 👥 普通关注）
- 🔴 **新动态红点** — 关注的 UP 更新后自动亮起小红点，一眼看到

### 死粉治理（v0.7 - v0.10 重头戏）
- 💀 **死粉识别** — 标记 >90 天未更新 UP 主
- 📊 **死粉三段细分** — 已注销 / 停更 / 内容变质（AI 判定）
- 🚫 **死粉一键取关** — checkbox + 模态确认 + 显式列出名字，三层防误操作
- 🤔 **疑似误关注** — AI 帮你识别"当时手滑关注的"，独立于死粉判断

### 动态页
- 🎯 **分组 Tab 筛选** — `t.bilibili.com` 顶部注入分组 Tab
- 📍 **特别关注置顶** — ⭐ UP 的动态永远在最前面

### AI 功能（v0.2 起，v0.9 大幅强化）
- 🧠 **AI 智能分组** — 把 UP 主用户名 / 签名 / 最近视频发给模型推荐分组（弹窗确认后批量应用）
- 🪞 **AI 关注画像** — 汇总你的关注列表，让模型总结兴趣关键词、推荐新分组名、识别误关注
- 💾 **断点续传**（v0.9.3）— 中途中断下次自动从断点继续，**唯一支持**的 B 站脚本
- ⏱️ **超时保护 + 可中断**（v0.9.2）— 长任务可暂停 / 取消
- 📋 **失败聚合** — 失败的请求汇总展示，方便重试

### 数据
- 💾 **JSON 导出备份** — 一键备份所有数据
- 🔒 **导入安全净化** — 白名单 + 类型校验 + 协议过滤，防 XSS
- 🌗 **深色模式** — 跟随系统

---

## AI 服务商

支持 **OpenAI 兼容** 和 **Anthropic 兼容** 两种协议，开箱即用 10 家：

| 类别 | 服务商 | 协议 | 说明 |
|---|---|---|---|
| 国内 | MiniMax 按量计费 | OpenAI | `sk-api-` 开头，国际账户 `api.minimax.io` |
| 国内 | MiniMax Token Plan | Anthropic | `sk-cp-` 开头（订阅 Key），走 `/anthropic` 端点 |
| 国内 | DeepSeek | OpenAI | 便宜，V3/R1 |
| 国内 | Kimi（月之暗面） | OpenAI | 长文本 128k |
| 国内 | 通义千问（DashScope） | OpenAI | 阿里云 |
| 国内 | 智谱 BigModel | OpenAI | GLM-4-Flash 限时免费 |
| 国内 | 硅基流动 SiliconFlow | OpenAI | 多模型聚合站 |
| 国外 | Google Gemini | OpenAI | 需海外网络 |
| 国外 | OpenAI 官方 | OpenAI | `gpt-4o-mini` 最便宜 |
| 本地 | Ollama | OpenAI | 本地推理免费 |

**自定义** — 任何其他 OpenAI 兼容厂商都可填 Base URL + Model 名。

API Key 仅存在浏览器油猴存储，**不上传任何第三方**。

---

## 安装

### 1. 安装油猴插件
任选其一：
- **Tampermonkey**（推荐）：[Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) / [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/) / [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
- **Violentmonkey**：开源替代品

### 2. 安装脚本
- **方式一**：访问 [GitHub 仓库](https://github.com/Franklinyung/bilibili-following-manager) → 点 `bilibili-following-manager.user.js` → "Raw" → 油猴自动提示安装
- **方式二**：复制文件内容 → 油猴插件面板 → "新建脚本" → 粘贴保存
- **方式三**：从 [Greasy Fork](https://greasyfork.org/) 搜索（待发布）

### 3. 首次使用
1. 登录 B 站网页版（确保右上角有头像）
2. 访问任意 B 站页面（如首页）
3. 点右下角悬浮的 📺 按钮打开管理面板
4. 点 **同步** 按钮，等待同步完成（带进度条）

**首次同步耗时**（按当前 200ms 限流）：
| 关注数 | 拉列表 | 活跃度刷新 | 总计 |
|---|---|---|---|
| 500 | ~5 秒 | ~100 秒 | ~2 分钟 |
| 1000 | ~10 秒 | ~200 秒 | ~3-4 分钟 |
| 3000 | ~30 秒 | ~600 秒 | ~10 分钟 |

期间保持页面打开，不要关闭浏览器。脚本有 **自动重试 + 失败聚合**，但极端情况下也可能挂——挂了就再点一次同步即可（会从断点继续）。

---

## 使用说明

### 主面板（点 📺 按钮）

```
┌─────────────────────────────────────────────────┐
│ 📺 关注管理  [同步] [刷新活跃度] [AI 分组] ...   │
├─────────────────────────────────────────────────┤
│ ▼ ⭐ 特别关注 (12)                              │
│   - UP主A      🔴 [活跃 2 小时前]               │
│ ▶ 👥 普通关注 (1247)                            │
│ ▼ 💀 死粉 (89) — 详见"死粉细分"                  │
│   - 已注销 (12) / 停更 >90 天 (61) / 变质 (16) │
│ ▶ 📂 我的分组 (技术 / 学习 / 娱乐 / ...)        │
├─────────────────────────────────────────────────┤
│ 共 1247 位 | 上次同步: 3 分钟前 | [导出/导入]   │
└─────────────────────────────────────────────────┘
```

- **同步**：从 B 站拉最新关注列表和分组
- **刷新活跃度**：后台批量查每个 UP 主最新视频发布时间
- **AI 分组 / 画像**：调模型，半自动确认后写入分组
- **导出 / 导入**：JSON 备份

### 关注页增强（`space.bilibili.com/*/relation/follow`）

访问关注列表时，脚本注入：
1. **顶部工具栏**：开启批量模式后每个 UP 主卡片前出现复选框
2. **每个卡片右下**：分组标签 + `[+ 分组]` / `[⭐ 标星]` / `[🚫 取关]` 按钮

### 动态页增强（`t.bilibili.com`）

```
📺 分组： [全部] [⭐ 特别关注] [技术] [学习] [娱乐]
```

- ⭐ 永远置顶
- 选某分组后只显示该组 UP 的动态
- 关注的 UP 主有新动态 → 列表头像右上角 🔴 红点

---

## 数据存储

- 存储位置：浏览器油猴 `GM_setValue`（Chrome 油猴 10MB+ 容量）
- 存储 key：`bfm_state_v1`
- 跨域请求：`GM_xmlhttpRequest` 走油猴通道，不受 CORS 限制

**首次同步建议**：关注数 1000 以内约 5 分钟，3000+ 约 15 分钟。同步期间**保持页面打开**。

---

## 常见问题

### Q: 进 B 站弹"您的页面展示可能受到浏览器插件影响"，脚本没激活？
A: B 站对 Shadow DOM 有反广告检测。脚本已经把 FAB 放到 body 顶层且用 CSS 前缀躲检测。如果还弹：
1. 确认油猴已启用脚本（管理面板能看到）
2. 控制台输入 `BFM.open()` 强制开面板（v0.4.2 起的兜底入口）
3. 控制台输入 `allow pasting` 再 `BFM.sync()` 跑命令

### Q: 同步后看不到任何数据？
A: 检查浏览器是否登录 B 站（页面右上角头像）。脚本需要 `SESSDATA` cookie。**别手动覆盖 Cookie 头**（v0.4.1 教训，会触发"登录态失效"）。

### Q: 触发风控了怎么办？
A: 脚本默认串行 200ms 间隔，正常使用不会。万一触发，等几小时再同步。**取关操作** `runBatchUnfollow` 单独控速。

### Q: 脚本会污染我 B 站官方分组吗？
A: 会的。脚本调的就是 B 站官方 API，分组跨设备同步。如果你不想污染，目前没有"纯本地分组"模式。

### Q: 死粉识别准确吗？
A: 通过查每个 UP 最近一条视频发布时间判断。**注意**：有些 UP 长期不发视频但开了付费课程 / 直播——不算"死"。v0.10 起新增 AI 判定"内容变质"维度，但都建议人工二次确认。

### Q: AI 分组 / 画像准确吗？
A: 模型只看到用户名 / 签名 / 最近视频标题，**没有观看历史**。所以仅作"半自动建议"，最后一步必须人工确认才写入分组。**v0.9.3 起支持断点续传**，跑一半关了下次再点继续。

### Q: API Key 安全吗？
A: Key 只存在你浏览器油猴存储，**不会上传任何第三方服务器**。脚本开源，请自行审查代码。**别把你的 Key 贴公共 issue**。

### Q: 数据能迁移到其他浏览器吗？
A: 可以。"导出"按钮备份 JSON，另一台浏览器"导入"恢复。

---

## 开发

### 项目结构
```
bilibili-following-manager/
├── bilibili-following-manager.user.js   # 主脚本（单文件 ~3400 行）
├── src/                                 # 纯逻辑（测试用）
│   ├── md5.mjs                          # WBI 签名用的 MD5（内联到 .user.js）
│   ├── sanitize.mjs                     # 导入净化
│   └── storage-logic.mjs                # 存储逻辑
├── tests/                               # node --test（JSDOM）
│   ├── a11y.test.js                     # 无障碍测试
│   ├── sync.test.js                     # src/ 与 .user.js 一致性护栏
│   ├── ai-grouping.test.js              # AI 分组（断点续传 / 超时 / 中断）
│   ├── ai-outliers.test.js              # AI 死粉细分
│   ├── checkpoint.test.js               # 断点续传
│   ├── inactive.test.js                 # 死粉识别
│   ├── llm-providers.test.js            # 多 provider 路由
│   ├── profile-outliers.test.js         # 关注画像
│   ├── red-dot.test.js                  # 新动态红点
│   ├── starred.test.js                  # 特别关注
│   ├── unfollow.test.js                 # 批量取关
│   ├── selectors.test.js                # B 站 DOM 选择器
│   ├── sanitize.test.js
│   └── md5.test.js
├── scripts/                             # 工具脚本
│   ├── build.js
│   ├── lint.js
│   ├── smoke.js                         # 9 项代码形状检查
│   └── dev.js
├── package.json
└── README.md
```

### npm scripts
```bash
npm run test      # node --test tests/*.test.js
npm run lint      # 静态检查（用户脚本元数据 + src/ 同步护栏）
npm run build     # 打包（占位，目前单文件直发）
npm run smoke     # 9 项代码形状检查（不能替代 E2E）
npm run verify    # lint + test + build + smoke 全部
npm run dev       # 开发模式（占位）
```

### 设计原则
- **单文件分发** — 油猴脚本安装体验最友好
- **零运行时依赖** — 不引 `@require` CDN（v0.4.0 教训：CDN 挂整个脚本挂）
- **Shadow DOM 隔离** — UI 内容放 shadow host（`delegatesFocus: true`），FAB 放 body 顶层（v0.5.1 教训：shadow 内 `position: fixed` 定位 bug）
- **永不静默失败** — API 错误 / 风控 / 死粉 bug 全部显式提示
- **测试护栏** — `src/` 与 `.user.js` 必须同步，`sync.test.js` 校验

### 关键 B 站 API
| 功能 | Endpoint |
|---|---|
| 关注列表 | `GET /x/relation/followings?vmid={mid}&pn={n}&ps=50` |
| 分组列表 | `GET /x/relation/tags` |
| 创建分组 | `POST /x/relation/tag/add` |
| 批量加入分组 | `POST /x/relation/tags/addUsers` |
| 取关 | `POST /x/relation/modify` (`act=2`) |
| UP 主最新视频 | `GET /x/space/wbi/arc/search?mid={mid}&pn=1&ps=1&order=pubdate` |
| 关注列表页 URL | `space.bilibili.com/{mid}/relation/follow` |

---

## 版本演进

| 版本 | 重点 |
|---|---|
| v0.10.6 | 写入节流：-352/-412 熔断立即抛错 + 单轮 ≤500 硬上限 + fids 去重 + 块间随机抖动 ±30% |
| v0.10.5 | 风控日历：衰减滑窗热度评分 + 自动减速（-352 加权 ×2.5）+ 设置页可视化 + 红色警告条 |
| v0.10.4 | 风控长退避（-352/-412）+ 写操作节流（块 25 + 600ms）+ AI 分组 prompt v2（复用已有组 / 批次 20） |
| v0.10.3 | AI 分组 JSON 容错解析 + 重试；应用分组三级匹配 + 分类失败报告 |
| v0.10.2 | 修复 modal 挂载点 — 确认框可见且真正阻断操作 |
| v0.10.1 | a11y helper + JSDOM 测试基础设施 |
| v0.10.0 | ⭐ 特别关注 + 🔴 新动态红点 + 📊 死粉三段细分（已注销/停更/变质） |
| v0.9.3 | AI 分组**断点续传** |
| v0.9.2 | AI 分组超时保护 + 可中断 + 失败聚合 |
| v0.9.1 | 疑似误关注批量取关 |
| v0.9.0 | 接入真实 B 站 DOM 选择器 + `/relation/follow` URL 适配 |
| v0.8.0 | 💀 死粉一键取关 |
| v0.7.0 | 死粉识别 bug + 建立完整开发闭环 |
| v0.6.0 | MiniMax Token Plan 拆分 + Anthropic 协议支持 |
| v0.5.x | UI 重设计 + FAB 位置 bug + 反广告弹窗 |
| v0.4.x | SESSDATA 修复 + `BFM.open()` 兜底 |
| v0.2 - v0.3 | AI 功能引入 |

完整开发笔记见本地 `DEVELOPMENT.md`（不上传 GitHub）。

---

## 路线图

### P0（短期）
- [ ] 关注列表 / 动态页 WebSocket 实时更新（新动态不刷页就看到）
- [ ] Greasy Fork 发布

### P1（中期）
- [ ] 分组规则自动化（按 UP 主类型自动归类）
- [ ] 批量调整分组（先取消再加入新分组）
- [ ] 关注列表导入其他平台（YouTube / Twitter）

### P2（差异化）
- [ ] 浏览器通知（关注的 UP 主更新时推送）
- [ ] 数据可视化（关注时间分布、分组占比饼图）
- [ ] 跨端同步（WebDAV / iCloud Drive）

### ❌ 明确不做
- TypeScript（重构 ROI 低）
- 模块化打包（保持单文件分发）
- 错误上报（隐私顾虑）
- 账号系统（脚本纯本地）

---

## 风险与免责

- 脚本仅使用 B 站**官方公开 API**，理论上不违反用户协议
- 脚本运行需要 `SESSDATA` cookie，**请勿将 cookie 提供给任何第三方**
- 频繁调用 API 存在风控风险，脚本默认限流，仍建议合理使用
- 数据存在浏览器本地，**请定期导出备份**
- 仅供参考学习，使用者风险自负

---

## 致谢

- 选择器参考：[B站关注数据分析插件](https://greasyfork.org/zh-TW/scripts/562384) (r007b34r)
- 取关 API 参考：[bilibili 批量取关](https://greasyfork.org/) (Nriver)
- URL pattern 参考：程序员做饭指南
- 动态页分组筛选灵感：[bilibili时间线筛选](https://greasyfork.org/en/scripts/396032) (hi94740)
- WBI 签名算法：social-media-soup/bilibili-API-collect
- MiniMax API 文档：https://platform.minimaxi.com/docs/guides/models-intro

---

## License

MIT