// ==UserScript==
// @name         Bilibili 关注管理 (Following Manager)
// @name:zh-CN   B 站关注管理助手
// @namespace    https://github.com/Franklinyung/bilibili-following-manager
// @version      0.3.1
// @description  批量分组、动态页分组筛选、死粉识别，让你的关注列表井井有条
// @description:zh-CN  批量分组、动态页分组筛选、死粉识别，让你的关注列表井井有条
// @author       Franklinyung
// @match        https://space.bilibili.com/*/fans/follow*
// @match        https://t.bilibili.com/*
// @match        https://www.bilibili.com/
// @match        https://space.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @require      https://cdn.jsdelivr.net/npm/spark-md5@3.0.2/spark-md5.min.js
// @connect      api.bilibili.com
// @connect      i0.hdslb.com
// @connect      api.deepseek.com
// @connect      api.openai.com
// @connect      api.moonshot.cn
// @connect      open.bigmodel.cn
// @connect      api.minimax.io
// @connect      localhost
// @connect      127.0.0.1
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

/*
 * Bilibili 关注管理助手
 *
 * 功能：
 *  - 全量同步关注列表 + 分组到本地缓存
 *  - 批量分组（多选 UP 主一键加入/移出分组，写入 B 站官方分组）
 *  - 动态页按分组筛选（解决推荐流看不到已关注 UP 主的问题）
 *  - 死粉识别（标记长期未更新 UP 主，辅助取关决策）
 *  - JSON 导出/导入（数据备份与迁移）
 *
 * 数据存储：GM_setValue（10MB+ 容量）
 * API 请求：GM_xmlhttpRequest（带 SESSDATA，规避 CORS）
 * 限流策略：串行队列 + 200ms 间隔 + 指数退避
 */

(function () {
  'use strict';

  // ============================================================
  // 0. 配置常量
  // ============================================================
  const CONFIG = {
    CACHE_KEY: 'bfm_state_v1',
    RATE_LIMIT_MS: 200,           // 单请求最小间隔
    INACTIVE_DAYS: 90,            // 死粉阈值（天）
    SYNC_PAGE_SIZE: 50,           // 同步关注列表每页大小
    MAX_RETRY: 3,                 // 失败重试次数
    API_BASE: 'https://api.bilibili.com',
    PANEL_WIDTH: 480,             // 抽屉宽度
  };

  // ============================================================
  // 1. 工具层 (utils)
  // ============================================================
  const utils = {
    // 取 cookie
    getCookie(name) {
      const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
      return m ? decodeURIComponent(m[2]) : '';
    },

    // SESSDATA 用于登录身份，bili_jct 用于 CSRF
    getSessdata() { return this.getCookie('SESSDATA'); },
    getBiliJct() { return this.getCookie('bili_jct'); },

    // 限流队列：串行执行，每个请求间隔至少 RATE_LIMIT_MS
    _queue: [],
    _busy: false,
    enqueue(fn) {
      return new Promise((resolve, reject) => {
        this._queue.push({ fn, resolve, reject });
        this._drain();
      });
    },
    async _drain() {
      if (this._busy) return;
      this._busy = true;
      while (this._queue.length) {
        const { fn, resolve, reject } = this._queue.shift();
        try {
          const r = await fn();
          resolve(r);
        } catch (e) {
          reject(e);
        }
        await this._sleep(CONFIG.RATE_LIMIT_MS);
      }
      this._busy = false;
    },

    sleep(ms) { return new Promise(r => setTimeout(r, ms)); },
    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); },

    // 简单日志
    log(...args) { console.log('%c[BFM]', 'color:#00aeec;font-weight:bold', ...args); },
    warn(...args) { console.warn('[BFM]', ...args); },
    error(...args) { console.error('[BFM]', ...args); },

    // 时间工具
    daysSince(ts) {
      if (!ts) return Infinity;
      return Math.floor((Date.now() - ts) / 86400000);
    },
    formatDays(n) {
      if (n === Infinity) return '从未';
      if (n < 1) return '今天';
      if (n < 30) return `${n} 天前`;
      if (n < 365) return `${Math.floor(n / 30)} 个月前`;
      return `${Math.floor(n / 365)} 年前`;
    },

    // HTML 转义
    esc(s) {
      return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
    },

    // 防抖
    debounce(fn, ms) {
      let t;
      return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
    },

    // 下载 JSON 文件
    downloadJSON(filename, data) {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 100);
    },

    // 选择文件
    pickFile() {
      return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'application/json,.json';
        input.onchange = () => {
          const f = input.files?.[0];
          if (!f) return reject(new Error('未选择文件'));
          const r = new FileReader();
          r.onload = () => {
            try { resolve(JSON.parse(r.result)); }
            catch (e) { reject(e); }
          };
          r.onerror = () => reject(r.error);
          r.readAsText(f);
        };
        input.click();
      });
    },

    /**
     * 数据净化：防止导入的 JSON 携带恶意字段（XSS / 原型链污染）
     * 只保留白名单字段，并做类型校验
     */
    sanitizeBackup(data) {
      if (!data || typeof data !== 'object') throw new Error('备份格式错误');
      const safe = { groups: [], following: {}, settings: {} };

      // 分组
      if (Array.isArray(data.groups)) {
        for (const g of data.groups) {
          const tagid = Number(g?.tagid);
          const name = String(g?.name ?? '').slice(0, 32);
          if (!Number.isFinite(tagid) || tagid <= 0) continue;
          safe.groups.push({ tagid, name, count: Number(g?.count) || 0 });
        }
      }

      // 关注列表
      if (data.following && typeof data.following === 'object' && !Array.isArray(data.following)) {
        for (const [midStr, u] of Object.entries(data.following)) {
          const mid = Number(midStr);
          if (!Number.isFinite(mid) || mid <= 0) continue;
          // face 必须是 http(s) 图片，拒绝 javascript: / data: 等
          let face = '';
          if (typeof u?.face === 'string') {
            const f = u.face.trim();
            if (/^https?:\/\//.test(f) && !/[\s"'<>]/.test(f) && f.length < 500) face = f;
          }
          safe.following[mid] = {
            mid,
            uname: String(u?.uname ?? '').slice(0, 64),
            face,
            sign: String(u?.sign ?? '').slice(0, 256),
            tagids: Array.isArray(u?.tagids) ? u.tagids.map(Number).filter(Number.isFinite) : [],
            mtime: Number(u?.mtime) || 0,
            lastActive: Number(u?.lastActive) || 0,
            lastTitle: String(u?.lastTitle ?? '').slice(0, 128),
          };
        }
      }

      // settings 只合并白名单
      const st = data.settings || {};
      if (Number.isFinite(Number(st.inactiveThresholdDays))) {
        const v = Number(st.inactiveThresholdDays);
        if (v >= 7 && v <= 3650) safe.settings.inactiveThresholdDays = v;
      }
      if (typeof st.panelCollapsed === 'boolean') safe.settings.panelCollapsed = st.panelCollapsed;
      // LLM 配置不导入（安全考虑，让用户重新填）
      return safe;
    },
  };

  // ============================================================
  // 2. 持久化存储 (storage)
  // ============================================================
  const STORAGE_VERSION = 2;   // 当前版本，破坏性变更时 +1 并写迁移
  const storage = {
    state: null,

    defaultState() {
      return {
        version: STORAGE_VERSION,
        mid: null,                  // 自己的 mid
        groups: [],                 // [{tagid, name, count}]
        following: {},              // mid -> {mid, uname, face, tagids:[], mtime, lastActive}
        settings: {
          inactiveThresholdDays: CONFIG.INACTIVE_DAYS,
          panelCollapsed: false,
        },
        lastSync: 0,
      };
    },

    load() {
      try {
        const raw = GM_getValue(CONFIG.CACHE_KEY, null);
        this.state = raw ? JSON.parse(raw) : this.defaultState();
        // 版本迁移
        this.state = this._migrate(this.state);
        // 兼容老版本缺字段
        const d = this.defaultState();
        for (const k of Object.keys(d)) {
          if (!(k in this.state)) this.state[k] = d[k];
        }
      } catch (e) {
        utils.error('load failed, reset', e);
        this.state = this.defaultState();
      }
      return this.state;
    },

    /**
     * 版本迁移：state 是从老版本读出的数据，返回迁移后的数据
     * 未来破坏性变更时在这里按版本号写迁移路径
     */
    _migrate(s) {
      if (!s || typeof s !== 'object') return this.defaultState();
      const v = Number(s.version) || 0;
      if (v < 1) {
        // v0 → v1: 老版本可能没有 version 字段，直接补齐
        s.version = 1;
      }
      if (v < 2) {
        // v1 → v2: 当前示例，未发生结构变化，仅升版本号
        // 未来示例：if (v < 2) { s.following = renameKeys(s.following); }
        s.version = 2;
      }
      return s;
    },

    save() {
      GM_setValue(CONFIG.CACHE_KEY, JSON.stringify(this.state));
    },

    patch(partial) {
      Object.assign(this.state, partial);
      this.save();
    },

    // 获取某个分组的所有 UP 主 mid
    midsOfGroup(tagid) {
      const tagidNum = Number(tagid);
      return Object.values(this.state.following)
        .filter(u => u.tagids && u.tagids.includes(tagidNum))
        .map(u => u.mid);
    },

    // 按 mid 集合查询
    getFollowings(mids) {
      const set = new Set(mids);
      return Object.values(this.state.following).filter(u => set.has(u.mid));
    },

    // 死粉候选
    getInactiveCandidates() {
      const days = this.state.settings.inactiveThresholdDays;
      return Object.values(this.state.following)
        .filter(u => utils.daysSince(u.lastActive) > days)
        .sort((a, b) => (a.lastActive || 0) - (b.lastActive || 0));
    },
  };

  // ============================================================
  // 3. API 层
  // ============================================================
  const api = {
    /**
     * 通用请求封装：走 GM_xmlhttpRequest，带 cookie，支持限流+重试
     */
    request(url, opts = {}) {
      const { method = 'GET', body = null, headers = {}, retry = CONFIG.MAX_RETRY } = opts;
      return utils.enqueue(async () => {
        for (let attempt = 1; attempt <= retry; attempt++) {
          try {
            const resp = await this._doRequest(url, method, body, headers);
            if (resp.code === -101) {
              throw new Error('NOT_LOGGED_IN');
            }
            if (resp.code !== 0) {
              throw new Error(`API ${resp.code}: ${resp.message || 'unknown'}`);
            }
            return resp.data;
          } catch (e) {
            if (e.message === 'NOT_LOGGED_IN' || attempt === retry) throw e;
            utils.warn(`retry ${attempt}/${retry} for ${url}`, e.message);
            await utils._sleep(500 * Math.pow(2, attempt - 1));
          }
        }
      });
    },

    _doRequest(url, method, body, extraHeaders) {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method,
          url,
          data: body ? Object.entries(body).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : undefined,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
            'Cookie': `SESSDATA=${utils.getSessdata()}`,
            ...extraHeaders,
          },
          responseType: 'json',
          anonymous: false,
          onload(r) {
            try {
              const resp = typeof r.response === 'string' ? JSON.parse(r.response) : r.response;
              resolve(resp);
            } catch (e) { reject(e); }
          },
          onerror(e) { reject(new Error('network error')); },
          ontimeout() { reject(new Error('timeout')); },
        });
      });
    },

    // ---- 关注列表 ----
    async listAllFollowings(mid, onProgress) {
      const all = [];
      let pn = 1, total = Infinity;
      while (all.length < total) {
        const data = await this.request(
          `${CONFIG.API_BASE}/x/relation/followings?vmid=${mid}&pn=${pn}&ps=${CONFIG.SYNC_PAGE_SIZE}&order=desc&jsonp=jsonp`
        );
        total = data.total || 0;
        for (const u of (data.list || [])) {
          all.push({
            mid: u.mid,
            uname: u.uname,
            face: u.face,
            sign: u.sign,
            mtime: u.mtime,                  // 关注时间
            tagids: (u.tag && u.tag.length) ? u.tag.map(Number) : [],
          });
        }
        if (onProgress) onProgress({ loaded: all.length, total, pn });
        if ((data.list || []).length < CONFIG.SYNC_PAGE_SIZE) break;
        pn++;
        // 防止同步阶段被风控
        if (pn % 10 === 0) await utils._sleep(1000);
      }
      return all;
    },

    // ---- 分组 ----
    async listGroups() {
      const data = await this.request(`${CONFIG.API_BASE}/x/relation/tags`);
      return (data || []).map(g => ({ tagid: g.tagid, name: g.name, count: g.count }));
    },

    async createGroup(name) {
      return this.request(`${CONFIG.API_BASE}/x/relation/tag/add`, {
        method: 'POST',
        body: { name, csrf: utils.getBiliJct() },
      });
    },

    async updateGroup(tagid, name) {
      return this.request(`${CONFIG.API_BASE}/x/relation/tag/update`, {
        method: 'POST',
        body: { tagid, name, csrf: utils.getBiliJct() },
      });
    },

    async deleteGroup(tagid) {
      return this.request(`${CONFIG.API_BASE}/x/relation/tag/del`, {
        method: 'POST',
        body: { tagid, csrf: utils.getBiliJct() },
      });
    },

    async addUsersToGroup(tagid, mids) {
      if (!mids.length) return;
      // 单次最多 50 个
      for (let i = 0; i < mids.length; i += 50) {
        const slice = mids.slice(i, i + 50);
        await this.request(`${CONFIG.API_BASE}/x/relation/tags/addUsers`, {
          method: 'POST',
          body: { tagid, fids: slice.join(','), csrf: utils.getBiliJct() },
        });
      }
    },

    async removeUsersFromGroup(tagid, mids) {
      if (!mids.length) return;
      for (let i = 0; i < mids.length; i += 50) {
        const slice = mids.slice(i, i + 50);
        await this.request(`${CONFIG.API_BASE}/x/relation/tags/delUsers`, {
          method: 'POST',
          body: { tagid, fids: slice.join(','), csrf: utils.getBiliJct() },
        });
      }
    },

    // ---- 当前用户信息 ----
    async getNavInfo() {
      return this.request(`${CONFIG.API_BASE}/x/web-interface/nav`);
    },

    // ---- UP 主活跃度 ----
    async upstat(mid) {
      try {
        const data = await this.request(`${CONFIG.API_BASE}/x/space/upstat?mid=${mid}`);
        return {
          videos: data.archive?.view,
          articles: data.article?.view,
          // B 站没有直接的"最后更新时间"接口，只能从 archive 中读取最新稿件
        };
      } catch (e) { return null; }
    },

    // 取 UP 主最新一条视频的发布时间（需要 WBI 签名）
    async latestVideo(mid) {
      try {
        const qs = await wbi.sign({ mid, pn: 1, ps: 1, order: 'pubdate' });
        const data = await this.request(`${CONFIG.API_BASE}/x/space/wbi/arc/search?${qs}`);
        const v = data?.list?.vlist?.[0];
        if (!v) return null;
        return { title: v.title, created: v.created * 1000, aid: v.aid };
      } catch (e) { return null; }
    },
  };

  // ============================================================
  // 3.5 LLM 模块 — OpenAI 兼容接口
  // ============================================================

  /**
   * 预设厂商列表（OpenAI 兼容接口）
   * 修改/添加新厂商只需改这里
   * models 第一个为该厂商默认推荐模型
   */
  const LLM_PROVIDERS = {
    'minimax': {
      label: 'minimax（默认）',
      baseUrl: 'https://api.minimax.io/v1',
      models: ['MiniMax-M2.7', 'MiniMax-M2.7-highspeed', 'MiniMax-M2.5', 'MiniMax-M2.5-highspeed', 'M2-her'],
      note: 'OpenAI 兼容。Code Plan 用户填订阅 Key，Pay-as-you-go 填 API Key',
    },
    'deepseek': {
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      note: '国内，便宜，V3/R1 都有',
    },
    'kimi': {
      label: 'Kimi（Moonshot 月之暗面）',
      baseUrl: 'https://api.moonshot.cn/v1',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0711-preview'],
      note: '长文本友好，最高 128k context',
    },
    'qwen': {
      label: '通义千问（阿里 DashScope）',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'],
      note: '阿里云，需先在控制台开通 DashScope',
    },
    'zhipu': {
      label: '智谱 BigModel',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
      models: ['glm-4-flash', 'glm-4-air', 'glm-4', 'glm-4-plus'],
      note: '兼容模式，GLM-4-Flash 限时免费',
    },
    'siliconflow': {
      label: '硅基流动 SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V2.5', 'meta-llama/Llama-3.1-8B-Instruct'],
      note: '聚合站，多模型可选',
    },
    'gemini': {
      label: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      models: ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro'],
      note: '需要海外网络',
    },
    'openai': {
      label: 'OpenAI 官方',
      baseUrl: 'https://api.openai.com/v1',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
      note: '需科学上网，gpt-4o-mini 最便宜',
    },
    'ollama': {
      label: 'Ollama（本地）',
      baseUrl: 'http://localhost:11434/v1',
      models: ['llama3.1:8b', 'qwen2.5:7b', 'deepseek-r1:8b'],
      note: '本地推理免费，API Key 随便填一个字符串',
    },
    'custom': {
      label: '自定义（其他厂商）',
      baseUrl: '',
      models: [],
      note: '填你自己的 Base URL 和 Model 名',
    },
  };

  const llm = {
    // 配置
    defaults: {
      provider: 'minimax',
      baseUrl: 'https://api.minimax.io/v1',
      apiKey: '',
      model: 'MiniMax-M2.7',
      temperature: 0.3,
      maxTokens: 2000,
    },

    isConfigured() {
      const c = this.getConfig();
      return Boolean(c.apiKey && c.baseUrl && c.model);
    },

    getConfig() {
      const stored = storage.state.settings.llm || {};
      const merged = { ...this.defaults, ...stored };
      // 老用户迁移：如果没有 provider 字段，根据 baseUrl 自动推断
      if (!stored.provider && stored.baseUrl) {
        for (const [k, v] of Object.entries(LLM_PROVIDERS)) {
          if (k === 'custom') continue;
          if (v.baseUrl && stored.baseUrl.replace(/\/$/, '') === v.baseUrl.replace(/\/$/, '')) {
            merged.provider = k;
            break;
          }
        }
      }
      return merged;
    },

    setConfig(partial) {
      const cur = this.getConfig();
      const next = { ...cur, ...partial };
      // 如果选了非 custom，强制以预设的 baseUrl 为准（除非用户手动改过）
      if (partial.provider && partial.provider !== 'custom' && LLM_PROVIDERS[partial.provider]) {
        const preset = LLM_PROVIDERS[partial.provider];
        if (!partial.baseUrl || partial.baseUrl === LLM_PROVIDERS[cur.provider]?.baseUrl) {
          next.baseUrl = preset.baseUrl;
        }
        if (!partial.model || !preset.models.includes(partial.model)) {
          next.model = preset.models[0] || '';
        }
      }
      storage.patch({ settings: { ...storage.state.settings, llm: next } });
    },

    getProviderList() {
      return Object.entries(LLM_PROVIDERS).map(([k, v]) => ({ key: k, ...v }));
    },

    getModelList(provider) {
      return LLM_PROVIDERS[provider]?.models || [];
    },

    getProviderNote(provider) {
      return LLM_PROVIDERS[provider]?.note || '';
    },

    // 通用 chat 调用
    async chat(messages, opts = {}) {
      const cfg = this.getConfig();
      if (!this.isConfigured()) throw new Error('请先在设置页配置 LLM API Key');

      return utils.enqueue(() => new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'POST',
          url: `${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`,
          },
          data: JSON.stringify({
            model: cfg.model,
            messages,
            temperature: opts.temperature ?? cfg.temperature,
            max_tokens: opts.maxTokens ?? cfg.maxTokens,
            stream: false,
          }),
          responseType: 'json',
          onload(r) {
            try {
              const resp = typeof r.response === 'string' ? JSON.parse(r.response) : r.response;
              if (resp.error) return reject(new Error(resp.error.message || 'LLM error'));
              const content = resp.choices?.[0]?.message?.content || '';
              resolve(content);
            } catch (e) { reject(e); }
          },
          onerror() { reject(new Error('网络错误')); },
          ontimeout() { reject(new Error('请求超时')); },
        });
      }));
    },

    // ---- 场景 1: 智能分组推荐 ----
    /**
     * 批量分析 UP 主，返回建议分组
     * @param {Array<{mid,uname,sign,lastTitle}>} users 一次最多 30 个
     * @param {Array<{tagid,name}>} existingGroups 已有分组（模型优先复用）
     * @returns {Promise<Array<{mid, groupName, reason}>>}
     */
    async suggestGrouping(users, existingGroups = []) {
      const userList = users.map(u =>
        `- mid=${u.mid} | ${u.uname} | 签名:${u.sign || '无'} | 最近:${u.lastTitle || '无'}`
      ).join('\n');

      const groupsHint = existingGroups.length
        ? `\n已有分组（请优先复用，不要随意创建新分组）：\n${existingGroups.map(g => `- ${g.name}`).join('\n')}\n`
        : '';

      const prompt = `你是 B 站关注管理助手。根据以下 UP 主的信息，为每个 UP 主推荐一个分组名称。

要求：
1. 优先复用已有分组${existingGroups.length ? `（如：${existingGroups.slice(0, 5).map(g => g.name).join('、')}）` : ''}
2. 如确实需要新分组，给出简洁的中文名（2-6 字）
3. 每个 UP 主给一句话简要理由
4. 严格按 JSON 数组格式输出，不要任何额外文字${groupsHint}

UP 主列表：
${userList}

输出格式（严格 JSON，不要 markdown 代码块）：
[{"mid":123,"group":"技术","reason":"分享编程教程"},{"mid":456,"group":"娱乐","reason":"游戏实况"}]`;

      const content = await this.chat([
        { role: 'system', content: '你只输出 JSON，不要任何解释性文字。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.2 });

      // 提取 JSON（容忍模型偶尔包 ```json```）
      const match = content.match(/\[[\s\S]*\]/);
      if (!match) throw new Error('模型未返回有效 JSON');
      const arr = JSON.parse(match[0]);
      return arr.filter(x => x.mid && x.group);
    },

    // ---- 场景 2: 画像分析 ----
    /**
     * 汇总关注列表，返回兴趣画像 + 推荐新分组
     */
    async analyzeProfile(sampleUsers) {
      // 抽样：取最多 200 个 UP 主，按关注时间倒序优先
      const sample = sampleUsers.slice(0, 200).map(u =>
        `- ${u.uname} | ${u.sign || ''}`
      ).join('\n');

      const prompt = `分析以下 B 站用户关注的 UP 主列表，给出：

1. **兴趣画像**：用 3-5 个关键词概括
2. **建议的新分组**：列出 5-8 个合理分组（基于关注结构推测用户尚未创建的分组）
4. **可能误关注 / 死粉**：识别那些看起来与主兴趣无关的 UP 主（仅返回名字）

UP 主列表（共 ${sampleUsers.length} 个，抽样展示前 ${Math.min(200, sampleUsers.length)} 个）：
${sample}

输出格式（严格 JSON）：
{
  "profile": ["关键词1", "关键词2"],
  "suggestedGroups": [{"name":"分组名","reason":"为什么需要这个分组"}],
  "outliers": ["UP主名字"]
}`;

      const content = await this.chat([
        { role: 'system', content: '你是关注列表分析师。严格按 JSON 输出，不要 markdown 代码块。' },
        { role: 'user', content: prompt },
      ], { maxTokens: 3000, temperature: 0.4 });

      const match = content.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('模型未返回有效 JSON');
      return JSON.parse(match[0]);
    },

    // 测试连通性
    async testConnection() {
      return this.chat([
        { role: 'user', content: '你好，请用一句话回复"连通成功"' },
      ], { maxTokens: 50 });
    },
  };

  // ============================================================
  // 3.4 WBI 签名 — B 站 2024 起强制要求
  // ============================================================
  const wbi = {
    _keys: null,         // {imgKey, subKey, cachedAt}
    _KEY_TTL: 24 * 3600 * 1000,

    // 固定的 MixinKeyEncTab（B 站官方）
    _MixinKeyEncTab: [
      46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
      33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40,
      61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11,
      36, 20, 34, 44, 52,
    ],

    async getKeys() {
      const now = Date.now();
      if (this._keys && now - this._keys.cachedAt < this._KEY_TTL) return this._keys;
      const nav = await api.getNavInfo();
      const imgUrl = nav.wbi_img?.img_url || '';
      const subUrl = nav.wbi_img?.sub_url || '';
      const imgKey = imgUrl.split('/').pop()?.split('.')[0] || '';
      const subKey = subUrl.split('/').pop()?.split('.')[0] || '';
      if (!imgKey || !subKey) throw new Error('无法获取 WBI keys');
      this._keys = { imgKey, subKey, cachedAt: now };
      return this._keys;
    },

    mixinKey(imgKey, subKey) {
      const raw = imgKey + subKey;
      return this._MixinKeyEncTab.map(i => raw[i]).join('').slice(0, 32);
    },

    /**
     * 对参数做 WBI 签名，返回完整 query string
     * @param {Object} params 待签名参数（不含 wts / w_rid）
     */
    async sign(params) {
      const { imgKey, subKey } = await this.getKeys();
      const mk = this.mixinKey(imgKey, subKey);
      const wts = Math.floor(Date.now() / 1000);
      const p = { ...params, wts };
      // 按 key 排序，过滤 value 中的 !'()* 
      const query = Object.keys(p).sort().map(k => {
        const v = String(p[k]).replace(/[!'()*]/g, '');
        return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
      }).join('&');
      const md5 = typeof SparkMD5 !== 'undefined' ? SparkMD5.hash : null;
      if (!md5) throw new Error('SparkMD5 未加载');
      return `${query}&w_rid=${md5(query + mk)}`;
    },
  };

  // ============================================================
  // 4. 同步与死粉识别
  // ============================================================
  const sync = {
    async fullSync() {
      const nav = await api.getNavInfo();
      const mid = nav.mid;
      if (!mid) throw new Error('NOT_LOGGED_IN');

      // 并行：分组列表 + 关注列表
      const [groups, followings] = await Promise.all([
        api.listGroups(),
        api.listAllFollowings(mid, ({ loaded, total }) => {
          events.emit('sync-progress', { loaded, total });
        }),
      ]);

      // 合并：保留已有 lastActive
      const old = storage.state.following || {};
      const merged = {};
      for (const u of followings) {
        merged[u.mid] = { ...(old[u.mid] || {}), ...u };
      }

      storage.patch({
        mid,
        groups,
        following: merged,
        lastSync: Date.now(),
      });

      events.emit('sync-done', { groups, following: merged });
      return { groups, following: merged };
    },

    async refreshInactive(concurrency = 3) {
      const list = Object.values(storage.state.following);
      const queue = [...list];
      let done = 0;
      const total = queue.length;
      // 进度节流：每 50 个才更新一次 DOM
      let lastReported = 0;
      const report = (force = false) => {
        if (force || done - lastReported >= 50) {
          lastReported = done;
          events.emit('inactive-progress', { done, total });
        }
      };

      const worker = async () => {
        while (true) {
          const u = queue.shift();
          if (!u) break;                     // 队列空或多 worker 竞态拿到 undefined
          const v = await api.latestVideo(u.mid);
          if (v) {
            storage.state.following[u.mid].lastActive = v.created;
            storage.state.following[u.mid].lastTitle = v.title;
          } else {
            storage.state.following[u.mid].lastActive = storage.state.following[u.mid].lastActive || 0;
          }
          done++;
          report();
        }
      };

      await Promise.all(Array(concurrency).fill(0).map(worker));
      report(true);
      storage.save();
      events.emit('inactive-done');
    },
  };

  // ============================================================
  // 5. 事件总线
  // ============================================================
  const events = {
    _h: {},
    on(name, fn) { (this._h[name] = this._h[name] || []).push(fn); },
    emit(name, payload) { (this._h[name] || []).forEach(fn => { try { fn(payload); } catch (e) { utils.error(e); } }); },
  };

  // ============================================================
  // 6. 主面板 UI
  // ============================================================
  const ui = {
    rootEl: null,
    btnEl: null,
    panelEl: null,
    activeView: 'groups',

    mount() {
      // 注入样式
      GM_addStyle(`
        .bfm-fab { position: fixed; right: 24px; bottom: 80px; z-index: 9999;
          width: 48px; height: 48px; border-radius: 50%; border: none; cursor: pointer;
          background: #00aeec; color: #fff; font-size: 22px; box-shadow: 0 4px 12px rgba(0,0,0,.18);
          transition: transform .15s;
        }
        .bfm-fab:hover { transform: scale(1.08); background: #00b5e5; }
        .bfm-fab.bfm-busy { background: #fb7299; animation: bfm-spin 1.4s linear infinite; }
        @keyframes bfm-spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }

        .bfm-panel { position: fixed; top: 0; right: 0; height: 100vh; width: ${CONFIG.PANEL_WIDTH}px;
          max-width: 96vw; background: #fff; box-shadow: -4px 0 18px rgba(0,0,0,.18);
          z-index: 10000; transform: translateX(100%); transition: transform .25s;
          display: flex; flex-direction: column; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .bfm-panel.bfm-open { transform: translateX(0); }
        .bfm-dark .bfm-panel { background: #18191c; color: #e8e8e8; }

        .bfm-head { padding: 14px 16px; border-bottom: 1px solid #eee; display: flex; align-items: center; gap: 8px; }
        .bfm-dark .bfm-head { border-bottom-color: #2a2b2f; }
        .bfm-title { font-size: 16px; font-weight: 600; flex: 1; }
        .bfm-btn { padding: 6px 10px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; }
        .bfm-dark .bfm-btn { background: #2a2b2f; border-color: #3a3b3f; color: #e8e8e8; }
        .bfm-btn:hover { background: #f3f3f3; }
        .bfm-dark .bfm-btn:hover { background: #353638; }
        .bfm-btn-primary { background: #00aeec; color: #fff; border-color: #00aeec; }
        .bfm-btn-primary:hover { background: #00b5e5; }
        .bfm-btn-danger { background: #fb7299; color: #fff; border-color: #fb7299; }
        .bfm-btn-danger:hover { background: #fc8aab; }
        .bfm-btn-ghost { background: transparent; border-color: transparent; color: #888; }
        .bfm-dark .bfm-btn-ghost { color: #aaa; }

        .bfm-tabs { display: flex; padding: 8px 12px; gap: 8px; border-bottom: 1px solid #eee; }
        .bfm-dark .bfm-tabs { border-bottom-color: #2a2b2f; }
        .bfm-tab { padding: 6px 12px; border-radius: 16px; cursor: pointer; font-size: 13px; }
        .bfm-tab:hover { background: #f3f3f3; }
        .bfm-dark .bfm-tab:hover { background: #2a2b2f; }
        .bfm-tab.bfm-active { background: #00aeec; color: #fff; }

        .bfm-body { flex: 1; overflow: auto; padding: 12px 16px; }
        .bfm-empty { text-align: center; color: #999; padding: 60px 20px; font-size: 13px; }
        .bfm-section-title { font-size: 13px; color: #666; margin: 14px 0 6px; font-weight: 600; }
        .bfm-dark .bfm-section-title { color: #aaa; }
        .bfm-group { border: 1px solid #eee; border-radius: 6px; margin-bottom: 8px; overflow: hidden; }
        .bfm-dark .bfm-group { border-color: #2a2b2f; }
        .bfm-group-head { padding: 8px 12px; background: #fafafa; display: flex; align-items: center; gap: 8px; cursor: pointer; }
        .bfm-dark .bfm-group-head { background: #212225; }
        .bfm-group-name { font-weight: 500; flex: 1; }
        .bfm-group-count { color: #999; font-size: 12px; }
        .bfm-group-body { padding: 4px 0; }
        .bfm-up { display: flex; align-items: center; gap: 10px; padding: 6px 12px; }
        .bfm-up:hover { background: #f7f9fb; }
        .bfm-dark .bfm-up:hover { background: #212225; }
        .bfm-up img { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; }
        .bfm-up-name { flex: 1; font-size: 13px; }
        .bfm-up-meta { font-size: 12px; color: #999; }
        .bfm-up-meta.bfm-inactive { color: #fb7299; font-weight: 500; }

        .bfm-foot { padding: 10px 16px; border-top: 1px solid #eee; font-size: 12px; color: #888; display: flex; gap: 8px; align-items: center; }
        .bfm-dark .bfm-foot { border-top-color: #2a2b2f; }

        .bfm-modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,.45); z-index: 10001; display: flex; align-items: center; justify-content: center; }
        .bfm-modal { background: #fff; border-radius: 8px; min-width: 360px; max-width: 90vw; padding: 18px 20px; }
        .bfm-dark .bfm-modal { background: #212225; color: #e8e8e8; }
        .bfm-modal h3 { margin: 0 0 12px; font-size: 15px; }
        .bfm-modal input { width: 100%; padding: 8px 10px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; box-sizing: border-box; }
        .bfm-dark .bfm-modal input { background: #2a2b2f; border-color: #3a3b3f; color: #e8e8e8; }
        .bfm-modal-actions { margin-top: 14px; display: flex; gap: 8px; justify-content: flex-end; }

        .bfm-progress { padding: 12px 16px; background: #fff8e1; border-bottom: 1px solid #f0e1a8; font-size: 13px; }
        .bfm-dark .bfm-progress { background: #2d2a1d; border-bottom-color: #4a4530; }
        .bfm-progress-bar { height: 4px; background: #eee; border-radius: 2px; margin-top: 6px; overflow: hidden; }
        .bfm-progress-bar > div { height: 100%; background: #00aeec; transition: width .2s; }

        .bfm-hidden-by-group { display: none !important; }
        .bfm-check { position: absolute; top: 8px; left: 8px; width: 18px; height: 18px; cursor: pointer; z-index: 2; }
      `);

      // FAB
      this.btnEl = document.createElement('button');
      this.btnEl.className = 'bfm-fab';
      this.btnEl.textContent = '📺';
      this.btnEl.title = 'B 站关注管理';
      this.btnEl.addEventListener('click', () => this.toggle());
      document.body.appendChild(this.btnEl);

      // 跟随深色模式
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('bfm-dark');
      }

      // 菜单命令
      try {
        GM_registerMenuCommand('同步关注列表', () => this.runSync());
        GM_registerMenuCommand('刷新活跃度', () => this.runInactiveRefresh());
        GM_registerMenuCommand('导出备份', () => this.exportData());
        GM_registerMenuCommand('导入备份', () => this.importData());
      } catch (e) { utils.warn('menu command failed', e); }

      // 事件订阅
      events.on('sync-progress', ({ loaded, total }) => {
        this.btnEl.classList.add('bfm-busy');
        this.updateProgress(`同步关注列表 ${loaded}/${total}`);
      });
      events.on('sync-done', () => {
        this.btnEl.classList.remove('bfm-busy');
        this.clearProgress();
        this.render();
      });
      events.on('inactive-progress', ({ done, total }) => {
        this.updateProgress(`刷新活跃度 ${done}/${total}`);
      });
      events.on('inactive-done', () => {
        this.clearProgress();
        this.render();
      });

      // 自动首次同步（如有缓存则跳过）
      this.maybeFirstRun();
    },

    async maybeFirstRun() {
      const s = storage.state;
      const oneWeek = 7 * 86400000;
      if (!s.lastSync || (Date.now() - s.lastSync > oneWeek && Object.keys(s.following).length === 0)) {
        await utils._sleep(500);
        this.runSync();
      }
    },

    toggle() {
      if (!this.panelEl) this.openPanel();
      else this.panelEl.classList.toggle('bfm-open');
      storage.patch({
        settings: { ...storage.state.settings, panelCollapsed: !this.panelEl.classList.contains('bfm-open') },
      });
    },

    openPanel() {
      this.panelEl = document.createElement('div');
      this.panelEl.className = 'bfm-panel';
      this.panelEl.innerHTML = `
        <div class="bfm-head">
          <span class="bfm-title">📺 关注管理</span>
          <button class="bfm-btn bfm-btn-primary" data-act="sync">同步</button>
          <button class="bfm-btn" data-act="inactive">刷新活跃度</button>
          <button class="bfm-btn" data-act="ai-group" title="AI 智能分组">🤖 AI 分组</button>
          <button class="bfm-btn" data-act="export">导出</button>
          <button class="bfm-btn" data-act="import">导入</button>
          <button class="bfm-btn bfm-btn-ghost" data-act="close">×</button>
        </div>
        <div class="bfm-progress" style="display:none"></div>
        <div class="bfm-tabs">
          <div class="bfm-tab bfm-active" data-view="groups">分组</div>
          <div class="bfm-tab" data-view="inactive">死粉候选</div>
          <div class="bfm-tab" data-view="settings">设置</div>
        </div>
        <div class="bfm-body"></div>
        <div class="bfm-foot">
          <span>共 <b data-foot-count>0</b> 位关注</span>
          <span style="flex:1"></span>
          <span data-foot-sync></span>
        </div>
      `;
      document.body.appendChild(this.panelEl);

      // 事件
      this.panelEl.addEventListener('click', e => {
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act === 'close') return this.toggle();
        if (act === 'sync') return this.runSync();
        if (act === 'inactive') return this.runInactiveRefresh();
        if (act === 'ai-group') return this.runAIGrouping();
        if (act === 'export') return this.exportData();
        if (act === 'import') return this.importData();
        const view = e.target.closest('[data-view]')?.dataset.view;
        if (view) {
          this.activeView = view;
          this.panelEl.querySelectorAll('.bfm-tab').forEach(t => {
            t.classList.toggle('bfm-active', t.dataset.view === view);
          });
          this.render();
        }
      });

      if (storage.state.settings.panelCollapsed === false) {
        requestAnimationFrame(() => this.panelEl.classList.add('bfm-open'));
      }
      this.render();
    },

    setProgress(html) {
      const el = this.panelEl?.querySelector('.bfm-progress');
      if (!el) return;
      el.innerHTML = html;
      el.style.display = 'block';
    },
    updateProgress(text) {
      const el = this.panelEl?.querySelector('.bfm-progress');
      if (!el) return;
      const m = text.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) {
        const pct = Math.min(100, Math.round(m[1] / m[2] * 100));
        el.innerHTML = `${text}<div class="bfm-progress-bar"><div style="width:${pct}%"></div></div>`;
      } else {
        el.innerHTML = text;
      }
      el.style.display = 'block';
    },
    clearProgress() {
      const el = this.panelEl?.querySelector('.bfm-progress');
      if (el) el.style.display = 'none';
    },

    render() {
      if (!this.panelEl) return;
      const body = this.panelEl.querySelector('.bfm-body');
      const foot = this.panelEl.querySelector('[data-foot-count]');
      const syncEl = this.panelEl.querySelector('[data-foot-sync]');
      foot.textContent = Object.keys(storage.state.following).length;
      syncEl.textContent = storage.state.lastSync
        ? `上次同步: ${new Date(storage.state.lastSync).toLocaleString()}`
        : '尚未同步';

      if (this.activeView === 'groups') return this.renderGroups(body);
      if (this.activeView === 'inactive') return this.renderInactive(body);
      if (this.activeView === 'settings') return this.renderSettings(body);
    },

    renderGroups(body) {
      const groups = storage.state.groups || [];
      const following = storage.state.following || {};
      const RENDER_LIMIT = 100;
      const ungroupedList = Object.values(following).filter(u => !u.tagids || u.tagids.length === 0);
      const totalUngrouped = ungroupedList.length;

      let html = `
        <div class="bfm-section-title">未分组 (${totalUngrouped})</div>
        <div class="bfm-group">
          <div class="bfm-group-body" data-group="__ungrouped">
            ${this._renderUpList(ungroupedList.slice(0, RENDER_LIMIT))}
            ${totalUngrouped > RENDER_LIMIT ? `<div class="bfm-empty" style="padding:8px">还有 ${totalUngrouped - RENDER_LIMIT} 个未显示（请用动态页筛选或搜索）</div>` : ''}
          </div>
        </div>
        <div class="bfm-section-title">分组列表</div>
      `;
      html += groups.map(g => {
        const mids = storage.midsOfGroup(g.tagid);
        const list = mids.map(mid => following[mid]).filter(Boolean);
        return `
          <div class="bfm-group">
            <div class="bfm-group-head" data-toggle-group="${g.tagid}">
              <span>▼</span>
              <span class="bfm-group-name">${utils.esc(g.name)}</span>
              <span class="bfm-group-count">${mids.length}</span>
              <button class="bfm-btn bfm-btn-ghost" data-rename-group="${g.tagid}">重命名</button>
              <button class="bfm-btn bfm-btn-ghost" data-delete-group="${g.tagid}">删除</button>
            </div>
            <div class="bfm-group-body">
              ${this._renderUpList(list.slice(0, RENDER_LIMIT))}
              ${list.length > RENDER_LIMIT ? `<div class="bfm-empty" style="padding:8px">还有 ${list.length - RENDER_LIMIT} 个未显示</div>` : ''}
            </div>
          </div>
        `;
      }).join('');

      html += `<button class="bfm-btn bfm-btn-primary" data-act="new-group" style="margin-top:12px">+ 新建分组</button>`;
      body.innerHTML = html;

      // 绑定事件
      body.querySelector('[data-act="new-group"]').addEventListener('click', () => this.createGroup());
      body.querySelectorAll('[data-rename-group]').forEach(b => {
        b.addEventListener('click', e => {
          e.stopPropagation();
          this.renameGroup(Number(b.dataset.renameGroup));
        });
      });
      body.querySelectorAll('[data-delete-group]').forEach(b => {
        b.addEventListener('click', e => {
          e.stopPropagation();
          this.deleteGroup(Number(b.dataset.deleteGroup));
        });
      });
    },

    _renderUpList(list) {
      if (!list.length) return `<div class="bfm-empty">无</div>`;
      return list.map(u => {
        const days = utils.daysSince(u.lastActive);
        const meta = u.lastActive
          ? `<span class="bfm-up-meta ${days > CONFIG.INACTIVE_DAYS ? 'bfm-inactive' : ''}">活跃 ${utils.formatDays(days)}</span>`
          : `<span class="bfm-up-meta">未检测</span>`;
        return `
          <div class="bfm-up" data-mid="${u.mid}">
            <img src="${utils.esc(u.face)}" loading="lazy" onerror="this.style.visibility='hidden'">
            <div class="bfm-up-name">${utils.esc(u.uname)}</div>
            ${meta}
          </div>
        `;
      }).join('');
    },

    renderInactive(body) {
      const list = storage.getInactiveCandidates();
      if (!list.length) {
        body.innerHTML = `<div class="bfm-empty">暂无死粉候选<br><br>请先点击"刷新活跃度"</div>`;
        return;
      }
      body.innerHTML = `
        <div class="bfm-section-title">超过 ${storage.state.settings.inactiveThresholdDays} 天未更新的关注 (${list.length})</div>
        ${list.map(u => `
          <div class="bfm-up">
            <img src="${utils.esc(u.face)}" loading="lazy">
            <div class="bfm-up-name">${utils.esc(u.uname)}</div>
            <span class="bfm-up-meta bfm-inactive">${utils.formatDays(utils.daysSince(u.lastActive))}</span>
            <a class="bfm-btn bfm-btn-ghost" href="https://space.bilibili.com/${u.mid}" target="_blank">查看</a>
          </div>
        `).join('')}
      `;
    },

    renderSettings(body) {
      const s = storage.state.settings;
      const lc = llm.getConfig();
      body.innerHTML = `
        <div class="bfm-section-title">基础设置</div>
        <div style="margin: 12px 0">
          <label>死粉阈值（天）：</label>
          <input id="bfm-threshold" type="number" min="7" max="3650" value="${s.inactiveThresholdDays}" style="padding:6px 10px;width:80px;border:1px solid #ddd;border-radius:4px">
          <button class="bfm-btn" id="bfm-save-threshold">保存</button>
        </div>

        <div class="bfm-section-title" style="margin-top:24px">🤖 LLM 配置（OpenAI 兼容）</div>
        <div style="font-size:12px;color:#888;margin-bottom:8px">
          用于 AI 智能分组和画像分析。<br>
          API Key 仅存储在你的浏览器中，不会上传任何第三方。
        </div>
        <div style="margin: 8px 0">
          <label style="display:inline-block;width:90px">服务商：</label>
          <select id="bfm-llm-provider" style="width:280px;padding:6px 10px;border:1px solid #ddd;border-radius:4px;font-size:13px">
            ${llm.getProviderList().map(p =>
              `<option value="${p.key}" ${lc.provider === p.key ? 'selected' : ''}>${utils.esc(p.label)}</option>`
            ).join('')}
          </select>
        </div>
        <div style="margin: 8px 0">
          <label style="display:inline-block;width:90px">Base URL：</label>
          <input id="bfm-llm-url" value="${utils.esc(lc.baseUrl)}" placeholder="https://api.deepseek.com/v1" style="width:280px;padding:6px 10px;border:1px solid #ddd;border-radius:4px">
        </div>
        <div style="margin: 8px 0">
          <label style="display:inline-block;width:90px">Model：</label>
          <input id="bfm-llm-model" list="bfm-llm-models" value="${utils.esc(lc.model)}" placeholder="deepseek-chat" style="width:280px;padding:6px 10px;border:1px solid #ddd;border-radius:4px">
          <datalist id="bfm-llm-models">
            ${llm.getModelList(lc.provider).map(m => `<option value="${utils.esc(m)}">`).join('')}
          </datalist>
        </div>
        <div style="margin: 8px 0">
          <label style="display:inline-block;width:90px">API Key：</label>
          <input id="bfm-llm-key" type="password" value="${utils.esc(lc.apiKey)}" placeholder="sk-..." style="width:280px;padding:6px 10px;border:1px solid #ddd;border-radius:4px">
          <span id="bfm-llm-status" style="margin-left:8px;font-size:12px"></span>
        </div>
        <div id="bfm-llm-note" style="margin:4px 0 8px 94px;font-size:12px;color:#888;min-height:18px">
          ${utils.esc(llm.getProviderNote(lc.provider))}
        </div>
        <div style="margin-top:12px">
          <button class="bfm-btn bfm-btn-primary" id="bfm-llm-save">保存配置</button>
          <button class="bfm-btn" id="bfm-llm-test">测试连通</button>
          <button class="bfm-btn" id="bfm-llm-profile">📊 AI 画像分析</button>
        </div>

        <div style="margin-top:24px;color:#888;font-size:12px">
          数据版本: v${storage.state.version}<br>
          存储 key: ${CONFIG.CACHE_KEY}<br>
        </div>
      `;
      body.querySelector('#bfm-save-threshold').addEventListener('click', () => {
        const v = parseInt(body.querySelector('#bfm-threshold').value, 10);
        if (v >= 7 && v <= 3650) {
          storage.patch({ settings: { ...storage.state.settings, inactiveThresholdDays: v } });
          alert('已保存');
        }
      });
      body.querySelector('#bfm-llm-save').addEventListener('click', () => {
        llm.setConfig({
          provider: body.querySelector('#bfm-llm-provider').value,
          baseUrl: body.querySelector('#bfm-llm-url').value.trim(),
          model: body.querySelector('#bfm-llm-model').value.trim(),
          apiKey: body.querySelector('#bfm-llm-key').value.trim(),
        });
        body.querySelector('#bfm-llm-status').textContent = '✓ 已保存';
        body.querySelector('#bfm-llm-status').style.color = '#5fb351';
        setTimeout(() => { body.querySelector('#bfm-llm-status').textContent = ''; }, 2000);
      });
      body.querySelector('#bfm-llm-test').addEventListener('click', async () => {
        llm.setConfig({
          provider: body.querySelector('#bfm-llm-provider').value,
          baseUrl: body.querySelector('#bfm-llm-url').value.trim(),
          model: body.querySelector('#bfm-llm-model').value.trim(),
          apiKey: body.querySelector('#bfm-llm-key').value.trim(),
        });
        const status = body.querySelector('#bfm-llm-status');
        status.textContent = '测试中...';
        status.style.color = '#888';
        try {
          const r = await llm.testConnection();
          status.textContent = '✓ 连通成功';
          status.style.color = '#5fb351';
        } catch (e) {
          status.textContent = '✗ ' + e.message;
          status.style.color = '#fb7299';
        }
      });
      body.querySelector('#bfm-llm-profile').addEventListener('click', () => this.runAIProfile());

      // 服务商切换：自动填充 baseUrl + 推荐 model + 更新提示
      body.querySelector('#bfm-llm-provider').addEventListener('change', (e) => {
        const key = e.target.value;
        const list = llm.getProviderList().find(p => p.key === key);
        if (!list) return;
        body.querySelector('#bfm-llm-url').value = list.baseUrl;
        body.querySelector('#bfm-llm-model').value = list.models[0] || '';
        // 更新 model datalist
        body.querySelector('#bfm-llm-models').innerHTML =
          list.models.map(m => `<option value="${utils.esc(m)}">`).join('');
        body.querySelector('#bfm-llm-note').textContent = list.note || '';
      });
    },

    // ---- 操作 ----
    async runSync() {
      this.btnEl.classList.add('bfm-busy');
      try {
        await sync.fullSync();
        this.render();
      } catch (e) {
        utils.error(e);
        if (e.message === 'NOT_LOGGED_IN') {
          alert('登录态已失效\n\n请先访问 https://www.bilibili.com 并确保右上角显示头像，然后再试。');
        } else if (/^-412|-799|请求过频/.test(e.message || '')) {
          alert('触发 B 站风控\n\n请等待 5-10 分钟后再试，或减少操作频率。');
        } else {
          alert('同步失败：' + (e.message || e));
        }
      } finally {
        this.btnEl.classList.remove('bfm-busy');
      }
    },

    async runInactiveRefresh() {
      if (!Object.keys(storage.state.following).length) {
        alert('请先同步关注列表');
        return;
      }
      try {
        await sync.refreshInactive();
      } catch (e) {
        utils.error(e);
        alert('刷新失败：' + (e.message || e));
      }
    },

    async createGroup() {
      const name = prompt('新分组名称：');
      if (!name) return;
      try {
        await api.createGroup(name);
        const groups = await api.listGroups();
        storage.patch({ groups });
        this.render();
      } catch (e) { alert('创建失败：' + e.message); }
    },

    async renameGroup(tagid) {
      const g = storage.state.groups.find(g => g.tagid === tagid);
      const name = prompt('新分组名称：', g?.name || '');
      if (!name || name === g?.name) return;
      try {
        await api.updateGroup(tagid, name);
        const groups = await api.listGroups();
        storage.patch({ groups });
        this.render();
      } catch (e) { alert('重命名失败：' + e.message); }
    },

    async deleteGroup(tagid) {
      const g = storage.state.groups.find(g => g.tagid === tagid);
      if (!confirm(`确认删除分组 "${g?.name}"？此操作不会取消关注。`)) return;
      try {
        await api.deleteGroup(tagid);
        const groups = await api.listGroups();
        // 同步本地缓存的 tagids
        for (const mid in storage.state.following) {
          storage.state.following[mid].tagids = (storage.state.following[mid].tagids || []).filter(t => t !== tagid);
        }
        storage.patch({ groups });
        this.render();
      } catch (e) { alert('删除失败：' + e.message); }
    },

    exportData() {
      utils.downloadJSON(`bfm-backup-${Date.now()}.json`, {
        version: storage.state.version,
        exportedAt: new Date().toISOString(),
        groups: storage.state.groups,
        following: storage.state.following,
        settings: storage.state.settings,
      });
    },

    // ---- AI 功能 ----
    async runAIGrouping() {
      if (!llm.isConfigured()) {
        alert('请先在"设置"页配置 LLM API Key');
        return;
      }
      const list = Object.values(storage.state.following);
      if (!list.length) return alert('请先同步关注列表');

      // 默认只分析"未分组"的 UP 主
      const ungrouped = list.filter(u => !u.tagids || u.tagids.length === 0);
      const targets = ungrouped.length ? ungrouped : list;

      if (!confirm(
        `将使用 AI 分析 ${targets.length} 位${ungrouped.length ? '未分组' : ''}UP 主并推荐分组。\n\n` +
        `提示：\n• 每次约消耗 ${Math.ceil(targets.length / 30)} 次 API 调用\n• 建议先在设置页测试连通\n• 模型不保证准确，结果需人工确认\n\n继续？`
      )) return;

      const BATCH = 30;
      const suggestions = []; // {mid, uname, groupName, reason, isNew}

      this.btnEl?.classList.add('bfm-busy');
      for (let i = 0; i < targets.length; i += BATCH) {
        const batch = targets.slice(i, i + BATCH);
        const users = batch.map(u => ({
          mid: u.mid, uname: u.uname, sign: u.sign || u.lastTitle || '',
        }));
        this.updateProgress?.(`AI 分组 ${Math.min(i + BATCH, targets.length)}/${targets.length}`);
        try {
          // 每批前重新拉一次现有分组（上一批可能新建了分组）
          const existing = storage.state.groups;
          const arr = await llm.suggestGrouping(users, existing);
          const byMid = new Map(users.map(u => [u.mid, u]));
          for (const item of arr) {
            const u = byMid.get(Number(item.mid));
            if (!u) continue;
            suggestions.push({
              mid: u.mid, uname: u.uname,
              groupName: item.group, reason: item.reason || '',
              isNew: !existing.some(g => g.name === item.group),
            });
          }
        } catch (e) {
          utils.error('AI batch failed', e);
          alert(`批次 ${i / BATCH + 1} 失败：${e.message}\n已成功 ${suggestions.length} 条，建议重试失败部分`);
        }
      }
      this.btnEl?.classList.remove('bfm-busy');
      this.clearProgress?.();

      if (!suggestions.length) return;
      this._showAISuggestions(suggestions);
    },

    _showAISuggestions(suggestions) {
      // 弹窗展示建议，用户可勾选后应用
      const mask = document.createElement('div');
      mask.className = 'bfm-modal-mask';
      mask.innerHTML = `
        <div class="bfm-modal" style="min-width:560px;max-height:80vh;display:flex;flex-direction:column">
          <h3>🤖 AI 分组建议（共 ${suggestions.length} 条）</h3>
          <div style="font-size:12px;color:#888;margin-bottom:10px">
            默认全选；可取消单项；分组名按现有/新建区分显示。
          </div>
          <div style="flex:1;overflow:auto;border:1px solid #eee;border-radius:4px;padding:6px">
            ${suggestions.map((s, i) => `
              <label style="display:flex;align-items:center;gap:8px;padding:6px;border-bottom:1px dashed #eee;cursor:pointer">
                <input type="checkbox" checked data-idx="${i}" class="bfm-sug-cb">
                <span style="flex:1;font-size:13px">${utils.esc(s.uname)}</span>
                <span style="background:${s.isNew ? '#fb7299' : '#00aeec'};color:#fff;padding:2px 8px;border-radius:10px;font-size:11px">
                  ${s.isNew ? '+ ' : ''}${utils.esc(s.groupName)}
                </span>
                <span style="font-size:11px;color:#888;max-width:160px;text-align:right">${utils.esc(s.reason)}</span>
              </label>
            `).join('')}
          </div>
          <div class="bfm-modal-actions">
            <button class="bfm-btn" data-act="close">取消</button>
            <button class="bfm-btn bfm-btn-primary" data-act="apply">应用勾选项</button>
          </div>
        </div>
      `;
      document.body.appendChild(mask);

      mask.querySelector('[data-act="close"]').addEventListener('click', () => mask.remove());
      mask.querySelector('[data-act="apply"]').addEventListener('click', async () => {
        const checked = Array.from(mask.querySelectorAll('.bfm-sug-cb:checked')).map(cb => suggestions[Number(cb.dataset.idx)]);
        mask.remove();
        await this._applyAISuggestions(checked);
      });
    },

    async _applyAISuggestions(items) {
      if (!items.length) return alert('未选择任何项');

      // 1. 按 groupName 分组
      const byGroup = new Map(); // groupName -> [mids]
      for (const item of items) {
        if (!byGroup.has(item.groupName)) byGroup.set(item.groupName, []);
        byGroup.get(item.groupName).push(item.mid);
      }

      // 2. 创建不存在的新分组
      const existingNames = new Set(storage.state.groups.map(g => g.name));
      const toCreate = Array.from(byGroup.keys()).filter(n => !existingNames.has(n));
      this.updateProgress?.(`创建 ${toCreate.length} 个新分组...`);
      for (const name of toCreate) {
        try { await api.createGroup(name); }
        catch (e) { utils.warn('create group failed', name, e); }
      }
      if (toCreate.length) {
        storage.state.groups = await api.listGroups();
      }

      // 3. 批量加入分组
      let applied = 0;
      for (const [name, mids] of byGroup) {
        const g = storage.state.groups.find(g => g.name === name);
        if (!g) continue;
        try {
          await api.addUsersToGroup(g.tagid, mids);
          for (const mid of mids) {
            if (!storage.state.following[mid]) storage.state.following[mid] = { mid };
            const set = new Set(storage.state.following[mid].tagids || []);
            set.add(g.tagid);
            storage.state.following[mid].tagids = Array.from(set);
          }
          applied += mids.length;
        } catch (e) { utils.warn('add users failed', name, e); }
        this.updateProgress?.(`应用中 ${applied}/${items.length}`);
      }
      storage.save();
      this.clearProgress?.();
      this.render();
      alert(`完成：成功分组 ${applied} 位 UP 主`);
    },

    async runAIProfile() {
      if (!llm.isConfigured()) return alert('请先在"设置"页配置 LLM API Key');
      const list = Object.values(storage.state.following);
      if (!list.length) return alert('请先同步关注列表');

      this.btnEl?.classList.add('bfm-busy');
      this.updateProgress?.('AI 画像分析中...');
      try {
        const result = await llm.analyzeProfile(list);
        this.clearProgress?.();
        this._showProfileResult(result);
      } catch (e) {
        alert('分析失败：' + e.message);
      } finally {
        this.btnEl?.classList.remove('bfm-busy');
        this.clearProgress?.();
      }
    },

    _showProfileResult(result) {
      const mask = document.createElement('div');
      mask.className = 'bfm-modal-mask';
      const groupsHtml = (result.suggestedGroups || []).map(g => `
        <li style="margin:6px 0">
          <b>${utils.esc(g.name)}</b>
          <span style="color:#888;font-size:12px;margin-left:8px">${utils.esc(g.reason || '')}</span>
        </li>
      `).join('');
      mask.innerHTML = `
        <div class="bfm-modal" style="min-width:480px">
          <h3>📊 你的关注画像</h3>
          <div style="margin:12px 0">
            <div style="font-weight:600;margin-bottom:6px">兴趣关键词：</div>
            <div>${(result.profile || []).map(p => `<span style="display:inline-block;background:#00aeec;color:#fff;padding:4px 12px;border-radius:14px;margin:4px;font-size:13px">${utils.esc(p)}</span>`).join('') || '<i style="color:#888">无</i>'}</div>
          </div>
          <div style="margin:12px 0">
            <div style="font-weight:600;margin-bottom:6px">建议创建的新分组：</div>
            <ul style="margin:0;padding-left:20px">${groupsHtml || '<i style="color:#888">无</i>'}</ul>
          </div>
          <div style="margin:12px 0">
            <div style="font-weight:600;margin-bottom:6px">疑似误关注：</div>
            <div>${(result.outliers || []).map(o => `<span style="display:inline-block;background:#fb7299;color:#fff;padding:4px 12px;border-radius:14px;margin:4px;font-size:13px">${utils.esc(o)}</span>`).join('') || '<i style="color:#888">无</i>'}</div>
          </div>
          <div class="bfm-modal-actions">
            <button class="bfm-btn" data-act="close">关闭</button>
          </div>
        </div>
      `;
      document.body.appendChild(mask);
      mask.querySelector('[data-act="close"]').addEventListener('click', () => mask.remove());
    },

    async importData() {
      try {
        const raw = await utils.pickFile();
        // 净化数据：白名单 + 类型校验 + 协议过滤
        const safe = utils.sanitizeBackup(raw);
        const count = Object.keys(safe.following).length;
        if (!confirm(`将覆盖当前分组与关注元数据（${count} 条），是否继续？\n注：LLM 配置不会从备份恢复，需重新填写。`)) return;
        storage.patch({
          groups: safe.groups,
          following: safe.following,
          settings: { ...storage.state.settings, ...safe.settings },
        });
        this.render();
        alert(`导入完成：${count} 位关注，${safe.groups.length} 个分组`);
      } catch (e) {
        if (e.message !== '未选择文件') alert('导入失败：' + e.message);
      }
    },
  };

  // ============================================================
  // 7. 关注页注入 (space.bilibili.com/*/fans/follow*)
  // ============================================================
  const injectFollowPage = {
    mounted: false,
    selected: new Set(),
    batchMode: false,
    _observer: null,   // 持有引用便于卸载

    async mount() {
      if (this.mounted) return;
      this.mounted = true;
      utils.log('inject follow page');

      // 等待关注列表渲染
      await this._waitForList();
      this._injectToolbar();
      this._observe();

      // 页面卸载 / 离开 SPA 路由时清理 observer，防止内存泄漏
      window.addEventListener('beforeunload', () => this._observer?.disconnect());
    },

    _waitForList() {
      return new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
          const list = document.querySelector('.follow-list, .relation-list, ul.list-list');
          if (list && list.children.length > 0) resolve();
          else if (++attempts < 30) setTimeout(check, 500);
          else {
            utils.warn('关注页选择器失效，请联系脚本作者更新');
            resolve();  // 不阻塞脚本运行
          }
        };
        check();
        setTimeout(resolve, 10000);
      });
    },

    _observe() {
      // 仅监听关注列表容器，不监听整个 body，降低开销
      const target = document.querySelector('.follow-list, .relation-list, ul.list-list') || document.body;
      this._observer = new MutationObserver(utils.debounce(() => this._enhanceCards(), 300));
      this._observer.observe(target, { childList: true, subtree: true });
    },

    _injectToolbar() {
      const bar = document.createElement('div');
      bar.id = 'bfm-follow-toolbar';
      bar.style.cssText = 'position:sticky;top:0;z-index:100;background:#00aeec;color:#fff;padding:8px 12px;display:flex;gap:8px;align-items:center;font-size:13px;border-radius:4px;margin-bottom:8px';
      bar.innerHTML = `
        <span>📺 <b>关注管理</b></span>
        <span style="flex:1"></span>
        <button id="bfm-batch-toggle" style="background:#fff;color:#00aeec;border:none;padding:6px 12px;border-radius:4px;cursor:pointer">开启批量</button>
        <button id="bfm-batch-assign" style="background:#fb7299;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;display:none">将选中 (0) 加入分组</button>
        <button id="bfm-batch-remove" style="background:rgba(255,255,255,.2);color:#fff;border:1px solid #fff;padding:6px 12px;border-radius:4px;cursor:pointer;display:none">移出分组</button>
      `;
      const target = document.querySelector('.follow-list, .relation-list, ul.list-list')?.parentElement;
      if (target) target.prepend(bar);

      bar.querySelector('#bfm-batch-toggle').addEventListener('click', () => {
        this.batchMode = !this.batchMode;
        bar.querySelector('#bfm-batch-toggle').textContent = this.batchMode ? '退出批量' : '开启批量';
        bar.querySelector('#bfm-batch-assign').style.display = this.batchMode ? '' : 'none';
        bar.querySelector('#bfm-batch-remove').style.display = this.batchMode ? '' : 'none';
        this._enhanceCards();
      });
      bar.querySelector('#bfm-batch-assign').addEventListener('click', () => this._batchAssign(true));
      bar.querySelector('#bfm-batch-remove').addEventListener('click', () => this._batchAssign(false));
    },

    _enhanceCards() {
      const cards = document.querySelectorAll('.follow-list .list-item, .relation-list .list-item, ul.list-list li');
      cards.forEach(card => {
        if (card.dataset.bfmDone) return;
        card.dataset.bfmDone = '1';

        // 提取 mid
        const link = card.querySelector('a[href*="space.bilibili.com"]');
        if (!link) return;
        const m = link.href.match(/space\.bilibili\.com\/(\d+)/);
        if (!m) return;
        const mid = Number(m[1]);

        // 注入分组标签
        const info = card.querySelector('.info, .fans-info, .list-item-info');
        const name = card.querySelector('.fans-name, .list-item-name a, .list-item-name')?.textContent?.trim() || '';
        const face = card.querySelector('img')?.src || '';

        if (info && !info.querySelector('.bfm-tags')) {
          const tagWrap = document.createElement('div');
          tagWrap.className = 'bfm-tags';
          tagWrap.style.cssText = 'margin-top:6px;display:flex;flex-wrap:wrap;gap:4px';
          this._renderTags(mid, tagWrap);
          info.appendChild(tagWrap);
        }

        // 批量模式：加复选框
        if (this.batchMode && !card.querySelector('.bfm-check')) {
          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.className = 'bfm-check';
          cb.style.cssText = 'position:absolute;top:8px;left:8px;width:18px;height:18px;cursor:pointer;z-index:2';
          cb.addEventListener('change', () => {
            if (cb.checked) this.selected.add(mid); else this.selected.delete(mid);
            const btn = document.getElementById('bfm-batch-assign');
            if (btn) btn.textContent = `将选中 (${this.selected.size}) 加入分组`;
          });
          card.style.position = 'relative';
          card.prepend(cb);
        } else if (!this.batchMode) {
          card.querySelector('.bfm-check')?.remove();
        }
      });
    },

    _renderTags(mid, wrap) {
      const u = storage.state.following[mid];
      const tagids = u?.tagids || [];
      const tags = storage.state.groups.filter(g => tagids.includes(g.tagid));
      wrap.innerHTML = tags.map(t => `
        <span style="background:#00aeec;color:#fff;padding:1px 8px;border-radius:10px;font-size:11px">${utils.esc(t.name)}</span>
      `).join('') + `
        <button data-add-tag="${mid}" style="background:transparent;border:1px dashed #ccc;color:#888;padding:0 6px;border-radius:10px;font-size:11px;cursor:pointer">+ 分组</button>
      `;
      wrap.querySelector('[data-add-tag]').addEventListener('click', () => this._showGroupPicker(mid));
    },

    async _showGroupPicker(mid) {
      const groups = storage.state.groups;
      if (!groups.length) {
        alert('请先在主面板中创建分组');
        return;
      }
      const html = groups.map(g => `<option value="${g.tagid}">${utils.esc(g.name)}</option>`).join('');
      const tagid = prompt(`选择分组（输入编号）：\n${groups.map((g, i) => `${i + 1}. ${g.name}`).join('\n')}\n\n输入编号或留空取消：`, '');
      if (!tagid) return;
      const idx = parseInt(tagid, 10) - 1;
      const g = groups[idx];
      if (!g) return;
      try {
        await api.addUsersToGroup(g.tagid, [mid]);
        if (!storage.state.following[mid]) storage.state.following[mid] = { mid };
        storage.state.following[mid].tagids = Array.from(new Set([...(storage.state.following[mid].tagids || []), g.tagid]));
        storage.save();
        this._enhanceCards();
      } catch (e) { alert('加入分组失败：' + e.message); }
    },

    async _batchAssign(add) {
      const mids = Array.from(this.selected);
      if (!mids.length) return alert('未选择任何 UP 主');
      const groups = storage.state.groups;
      if (!groups.length) return alert('请先创建分组');
      const input = prompt(`选择分组（输入编号）：\n${groups.map((g, i) => `${i + 1}. ${g.name}`).join('\n')}\n\n${add ? '加入' : '移出'}该分组：`);
      if (!input) return;
      const idx = parseInt(input, 10) - 1;
      const g = groups[idx];
      if (!g) return;
      try {
        if (add) await api.addUsersToGroup(g.tagid, mids);
        else await api.removeUsersFromGroup(g.tagid, mids);
        for (const mid of mids) {
          if (!storage.state.following[mid]) continue;
          const set = new Set(storage.state.following[mid].tagids || []);
          if (add) set.add(g.tagid); else set.delete(g.tagid);
          storage.state.following[mid].tagids = Array.from(set);
        }
        storage.save();
        alert(`${add ? '加入' : '移出'}成功：${mids.length} 个 UP 主`);
        this._enhanceCards();
      } catch (e) { alert('批量操作失败：' + e.message); }
    },
  };

  // ============================================================
  // 8. 动态页注入 (t.bilibili.com)
  // ============================================================
  const injectDynamicPage = {
    mounted: false,
    activeGroup: null,
    _observer: null,

    async mount() {
      if (this.mounted) return;
      this.mounted = true;
      utils.log('inject dynamic page');
      this._injectTabs();
      this._observeTabs();

      window.addEventListener('beforeunload', () => this._observer?.disconnect());
    },

    _injectTabs() {
      // 等待原生 tab 容器
      const wait = (attempt = 0) => {
        let host = document.querySelector('.bili-dyn-list-tabs, .tab-bar, .nav-tabs, [class*="tab-list"]');
        if (!host) {
          host = document.querySelector('.bili-dyn-home--member, main')?.querySelector('[role="tablist"]')?.parentElement;
        }
        if (!host) {
          if (attempt < 20) { setTimeout(() => wait(attempt + 1), 500); }
          else {
            // 选择器失效兜底：直接在动态列表容器前插入
            const list = document.querySelector('.bili-dyn-list, .dynamic-list, [class*="bili-dyn-list"]');
            if (list?.parentElement) this._renderTabsInto(list.parentElement);
            else utils.warn('动态页选择器失效，请联系脚本作者更新');
          }
          return;
        }
        this._renderTabsInto(host);
      };
      wait();
    },

    _renderTabsInto(host) {
      if (document.getElementById('bfm-group-tabs')) return;
      const groups = storage.state.groups;
      if (!groups.length) return;

      const wrap = document.createElement('div');
      wrap.id = 'bfm-group-tabs';
      wrap.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;padding:8px 12px;background:#fafafa;border-bottom:1px solid #eee;align-items:center;font-size:13px';
      const render = (activeId) => {
        const items = groups.map(g => {
          const cnt = storage.midsOfGroup(g.tagid).length;
          const active = activeId === g.tagid;
          return `<button data-gid="${g.tagid}" style="padding:4px 12px;border-radius:14px;border:1px solid ${active ? '#00aeec' : '#ddd'};background:${active ? '#00aeec' : '#fff'};color:${active ? '#fff' : '#333'};cursor:pointer;font-size:12px">
            ${utils.esc(g.name)} (${cnt})
          </button>`;
        }).join('');
        wrap.innerHTML = `<span style="color:#888;margin-right:6px">📺 分组：</span>
          <button data-gid="__none__" style="padding:4px 12px;border-radius:14px;border:1px solid ${!activeId ? '#00aeec' : '#ddd'};background:${!activeId ? '#00aeec' : '#fff'};color:${!activeId ? '#fff' : '#333'};cursor:pointer;font-size:12px">全部</button>
          ${items}`;
        wrap.querySelectorAll('[data-gid]').forEach(b => {
          b.addEventListener('click', () => {
            const gid = b.dataset.gid === '__none__' ? null : Number(b.dataset.gid);
            this.activeGroup = gid;
            render(gid);
            this._applyFilter();
          });
        });
      };
      render(null);
      host.prepend(wrap);
    },

    _observeTabs() {
      // 当动态列表变化时重新应用过滤
      const list = document.querySelector('.bili-dyn-list, .dynamic-list, [class*="bili-dyn-list"]');
      if (!list) return;
      this._observer = new MutationObserver(utils.debounce(() => this._applyFilter(), 200));
      this._observer.observe(list, { childList: true, subtree: true });
    },

    _applyFilter() {
      if (this.activeGroup == null) {
        document.querySelectorAll('.bfm-hidden-by-group').forEach(el => el.classList.remove('bfm-hidden-by-group'));
        return;
      }
      const mids = new Set(storage.midsOfGroup(this.activeGroup));
      const cards = document.querySelectorAll('.bili-dyn-list .bili-dyn-item, .dynamic-list .dynamic-item, [class*="bili-dyn-item"]');
      let hidden = 0;
      cards.forEach(card => {
        const link = card.querySelector('a[href*="space.bilibili.com"]');
        const m = link?.href.match(/space\.bilibili\.com\/(\d+)/);
        if (!m) return;
        const mid = Number(m[1]);
        const isMember = mids.has(mid);
        card.classList.toggle('bfm-hidden-by-group', !isMember);
        if (!isMember) hidden++;
      });
      // 顶部提示
      let tip = document.getElementById('bfm-filter-tip');
      if (!tip) {
        tip = document.createElement('div');
        tip.id = 'bfm-filter-tip';
        tip.style.cssText = 'position:fixed;top:8px;right:8px;background:#00aeec;color:#fff;padding:4px 10px;border-radius:14px;font-size:12px;z-index:9999;box-shadow:0 2px 6px rgba(0,0,0,.15)';
        document.body.appendChild(tip);
      }
      const g = storage.state.groups.find(g => g.tagid === this.activeGroup);
      tip.textContent = `📺 仅显示分组：${g?.name || ''}（已隐藏 ${hidden} 条）`;
    },
  };

  // ============================================================
  // 9. 入口
  // ============================================================
  function init() {
    storage.load();
    ui.mount();

    const path = location.pathname;
    if (path.includes('/fans/follow') || path.includes('/fans/fans')) {
      injectFollowPage.mount();
    } else if (location.host === 't.bilibili.com') {
      injectDynamicPage.mount();
    }
  }

  // 等待 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
