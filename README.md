# B 站关注管理助手 (bilibili-following-manager)

> 一个油猴脚本，让你的关注列表井井有条——批量分组、动态页分组筛选、死粉识别、AI 智能分类。

**GitHub 仓库**：https://github.com/Franklinyung/bilibili-following-manager

## 为什么需要它

B 站推荐流越来越偏向热门和冷启动，**关注的几百上千位 UP 主经常看不到**。本脚本帮你：

- 把关注的 UP 主按兴趣分组（技术 / 学习 / 娱乐 / 摸鱼 / ...）
- 在动态页只看指定分组的动态
- 一眼识别长期不更新的"死粉"，决定是否取关
- 批量分组，免去一个个手动操作的痛苦

## 功能特性

### P0 必备
- 📥 **全量同步关注列表** + 分组到本地缓存（受限流约束）
- 🗂️ **分组 CRUD** — 创建 / 重命名 / 删除分组
- ☑️ **批量分组** — 在 `/fans/follow` 关注页多选 UP 主一键加入/移出分组
- 🎯 **动态页分组筛选** — 在 `t.bilibili.com` 顶部注入分组 Tab
- 💾 **JSON 导出备份** — 一键备份所有数据
- 🔒 **导入安全净化** — 白名单 + 类型校验 + 协议过滤，防 XSS 注入

### P1 增强
- 💀 **死粉识别** — 标记 >90 天未更新 UP 主，可刷新活跃度
- 🔍 **关注列表按分组筛选**（在主面板中）
- 📥 **JSON 导入** — 从备份恢复

### 🤖 AI 功能（v0.2 新增）
- **AI 智能分组**：把 UP 主用户名/签名/最近视频发给模型，让它推荐分组（弹窗确认后批量应用）
- **AI 画像分析**：汇总你的关注列表，让模型总结兴趣关键词、推荐新分组名、识别疑似误关注
- **OpenAI 兼容**：支持 OpenAI / DeepSeek / Kimi / 智谱 / Ollama 等任何兼容接口
- **本地存 Key**：API Key 仅存在你的浏览器油猴存储，不上传任何第三方

## 安装

### 1. 安装油猴插件
任选其一：
- **Tampermonkey**（推荐）：[Chrome](https://chrome.google.com/webstore/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) / [Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/) / [Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
- **Violentmonkey**：开源替代品
- **Greasemonkey**：Firefox 原生

### 2. 安装脚本
- **方式一**：从 [Greasy Fork](https://greasyfork.org/) 搜索 "bilibili-following-manager"（待发布）
- **方式二**：访问 [GitHub 仓库](https://github.com/Franklinyung/bilibili-following-manager) → 点击 `bilibili-following-manager.user.js` → "Raw" → 油猴会自动提示安装
- **方式三**：复制文件内容 → 油猴插件面板 → "新建脚本" → 粘贴保存

### 3. 首次使用
1. 登录 B 站网页版
2. 访问任意 B 站页面（如首页）
3. 点击右下角悬浮的 📺 按钮打开管理面板
4. 点击 **同步** 按钮，等待同步完成（会显示进度）

**首次同步耗时预估**（按当前限流 200ms/请求）：
- 1000 位关注：拉关注列表约 20 页 = 4 秒 + 活跃度刷新 1000 次 = 200 秒 ≈ **3-4 分钟**
- 3000 位关注：拉关注列表约 60 页 = 12 秒 + 活跃度刷新 3000 次 = 600 秒 ≈ **10 分钟**

期间保持页面打开，不要关闭浏览器。

## 使用说明

### 主面板（点击 📺 按钮）

```
┌──────────────────────────────────────┐
│ 📺 关注管理 [同步] [刷新活跃度] [×] │
├──────────────────────────────────────┤
│ ▼ 未分组 (43)                         │
│   - UP主A    [活跃 5 天前]           │
│   - UP主B    [未检测]                │
│ ▶ 技术 (213)                          │
│ ▶ 学习 (87)                           │
│ ▶ 娱乐 (502)                          │
├──────────────────────────────────────┤
│ 共 1247 位关注 | 上次同步: 3 分钟前  │
└──────────────────────────────────────┘
```

- **同步**：从 B 站拉取最新关注列表和分组
- **刷新活跃度**：后台批量查询每个 UP 主最新视频发布时间（用于死粉识别）
- **导出 / 导入**：JSON 备份

### 关注页增强（`space.bilibili.com/*/fans/follow`）

访问关注列表时，脚本会注入：

1. **顶部工具栏**：开启批量模式后，每个 UP 主卡片前出现复选框，可一键加入/移出分组
2. **每个卡片右下**：分组标签 + `[+ 分组]` 按钮，点击即可将该 UP 主加入指定分组

### 动态页增强（`t.bilibili.com`）

访问动态页时，脚本会注入一行自定义分组 Tab：

```
📺 分组： [全部] [技术 (213)] [学习 (87)] [娱乐 (502)]
```

点击某个分组后，只显示该分组 UP 主的动态，其他动态自动隐藏。再次点击"全部"恢复。

## 数据存储

- 存储位置：浏览器油猴插件的 `GM_setValue`（Chrome 油猴 10MB+ 容量）
- 存储 key：`bfm_state_v1`
- 跨域请求：通过 `GM_xmlhttpRequest` 走油猴通道，不受 CORS 限制

**首次同步建议**：
- 关注数 1000 以内，约 5 分钟
- 关注数 3000+，约 15 分钟
- 同步期间请保持页面打开，不要关闭

## 常见问题

### Q: 同步后看不到任何数据？
A: 检查浏览器是否已登录 B 站（页面右上角有头像）。脚本需要 `SESSDATA` cookie 身份。

### Q: 触发风控了怎么办？
A: 脚本默认串行限流 + 200ms 间隔，正常使用不会触发。如果意外触发，等几小时再同步即可。

### Q: 脚本会污染我的 B 站官方分组吗？
A: 会的。脚本调用的就是 B 站官方分组 API，分组会在所有设备上同步显示。如果你不想污染，请等后续版本的"纯本地分组"模式。

### Q: 死粉识别准确吗？
A: 通过查询每个 UP 主最近一条视频发布时间来判断。**注意**：有些 UP 主长期不发视频但开了付费课程/直播，这种不算"死"。建议人工二次确认。

### Q: 数据能迁移到其他浏览器吗？
A: 可以。用"导出"按钮备份 JSON，在另一台浏览器用"导入"按钮恢复。

### Q: 数据会丢失吗？
A: 数据存在油猴插件的本地存储，清除浏览器数据 / 卸载油猴插件会丢失。**建议定期导出备份**。

### Q: AI 功能要收费吗？
A: 看你的 API Key 接的是哪家。DeepSeek、Kimi、智谱都有免费额度，足够个人用。本地 Ollama 完全免费。

### Q: AI 分组准确吗？
A: 模型只看到用户名/签名/最近视频标题，**没有观看历史**。所以仅作"半自动建议"，最后一步必须人工确认才写入分组。

### Q: API Key 安全吗？
A: Key 只存在你浏览器的油猴插件存储里，**不会上传到任何第三方服务器**。但脚本本身是开源的，请自行审查代码。

## 开发

### 项目结构
```
bilibili-following-manager/
├── bilibili-following-manager.user.js   # 主脚本（单文件）
└── README.md
```

### 模块划分（脚本内）
| 模块 | 职责 |
|---|---|
| `utils` | cookie、限流队列、缓存、通用工具 |
| `storage` | 状态持久化（GM_setValue） |
| `api` | B 站 API 封装 |
| `sync` | 全量同步 + 死粉识别调度 |
| `events` | 简单事件总线 |
| `ui` | 主面板（抽屉式） |
| `injectFollowPage` | `/fans/follow` 注入 |
| `injectDynamicPage` | `t.bilibili.com` 注入 |

### 本地开发
直接编辑 `bilibili-following-manager.user.js`，保存后油猴会自动热更新。

### 关键 API
| 功能 | Endpoint |
|---|---|
| 关注列表 | `GET /x/relation/followings?vmid={mid}&pn={n}&ps=50` |
| 分组列表 | `GET /x/relation/tags` |
| 创建分组 | `POST /x/relation/tag/add` (form: `name`) |
| 重命名分组 | `POST /x/relation/tag/update` (form: `tagid`, `name`) |
| 删除分组 | `POST /x/relation/tag/del` (form: `tagid`) |
| 批量加入分组 | `POST /x/relation/tags/addUsers` (form: `tagid`, `fids`) |
| 批量移出分组 | `POST /x/relation/tags/delUsers` (form: `tagid`, `fids`) |
| UP 主最新视频 | `GET /x/space/wbi/arc/search?mid={mid}&pn=1&ps=1&order=pubdate` |

## 风险与免责

- 本脚本仅使用 B 站**官方公开 API**，理论上不会违反用户协议
- 但脚本运行需要 `SESSDATA` cookie 身份，请勿将 cookie 提供给任何第三方
- 频繁调用 API 存在风控风险，脚本默认限流，但仍建议合理使用
- 数据存储在浏览器本地，**请定期导出备份**

## License

MIT
