// ==UserScript==
// @name         Bilibili 关注管理 (Following Manager)
// @name:zh-CN   B 站关注管理助手
// @namespace    https://github.com/Franklinyung/bilibili-following-manager
// @version      0.10.5
// @description  批量分组、动态页分组筛选、死粉识别，让你的关注列表井井有条
// @description:zh-CN  批量分组、动态页分组筛选、死粉识别，让你的关注列表井井有条
// @author       Franklinyung
// @match        https://space.bilibili.com/*/fans/follow*
// @match        https://space.bilibili.com/*/relation/follow*
// @match        https://t.bilibili.com/*
// @match        https://www.bilibili.com/*
// @match        https://space.bilibili.com/*
// @icon         https://www.bilibili.com/favicon.ico
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @connect      api.bilibili.com
// @connect      i0.hdslb.com
// @connect      api.deepseek.com
// @connect      api.openai.com
// @connect      api.moonshot.cn
// @connect      open.bigmodel.cn
// @connect      api.minimax.io
// @connect      api.minimaxi.com
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
  // 0.5 内联 MD5 — 替代 SparkMD5 CDN 依赖（防止 CDN 加载失败导致脚本不激活）
  //     标准公开实现，零依赖
  // ============================================================
  const md5 = (function () {
    function safeAdd(x, y) {
      const lsw = (x & 0xffff) + (y & 0xffff);
      const msw = (x >> 16) + (y >> 16) + (lsw >> 16);
      return (msw << 16) | (lsw & 0xffff);
    }
    function bitRotateLeft(num, cnt) { return (num << cnt) | (num >>> (32 - cnt)); }
    function md5cmn(q, a, b, x, s, t) { return safeAdd(bitRotateLeft(safeAdd(safeAdd(a, q), safeAdd(x, t)), s), b); }
    function md5ff(a, b, c, d, x, s, t) { return md5cmn((b & c) | (~b & d), a, b, x, s, t); }
    function md5gg(a, b, c, d, x, s, t) { return md5cmn((b & d) | (c & ~d), a, b, x, s, t); }
    function md5hh(a, b, c, d, x, s, t) { return md5cmn(b ^ c ^ d, a, b, x, s, t); }
    function md5ii(a, b, c, d, x, s, t) { return md5cmn(c ^ (b | ~d), a, b, x, s, t); }

    function binlMD5(x, len) {
      x[len >> 5] |= 0x80 << (len % 32);
      x[(((len + 64) >>> 9) << 4) + 14] = len;
      let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
      for (let i = 0; i < x.length; i += 16) {
        const olda = a, oldb = b, oldc = c, oldd = d;
        a = md5ff(a, b, c, d, x[i], 7, -680876936);
        d = md5ff(d, a, b, c, x[i + 1], 12, -389564586);
        c = md5ff(c, d, a, b, x[i + 2], 17, 606105819);
        b = md5ff(b, c, d, a, x[i + 3], 22, -1044525330);
        a = md5ff(a, b, c, d, x[i + 4], 7, -176418897);
        d = md5ff(d, a, b, c, x[i + 5], 12, 1200080426);
        c = md5ff(c, d, a, b, x[i + 6], 17, -1473231341);
        b = md5ff(b, c, d, a, x[i + 7], 22, -45705983);
        a = md5ff(a, b, c, d, x[i + 8], 7, 1770035416);
        d = md5ff(d, a, b, c, x[i + 9], 12, -1958414417);
        c = md5ff(c, d, a, b, x[i + 10], 17, -42063);
        b = md5ff(b, c, d, a, x[i + 11], 22, -1990404162);
        a = md5ff(a, b, c, d, x[i + 12], 7, 1804603682);
        d = md5ff(d, a, b, c, x[i + 13], 12, -40341101);
        c = md5ff(c, d, a, b, x[i + 14], 17, -1502002290);
        b = md5ff(b, c, d, a, x[i + 15], 22, 1236535329);
        a = md5gg(a, b, c, d, x[i + 1], 5, -165796510);
        d = md5gg(d, a, b, c, x[i + 6], 9, -1069501632);
        c = md5gg(c, d, a, b, x[i + 11], 14, 643717713);
        b = md5gg(b, c, d, a, x[i], 20, -373897302);
        a = md5gg(a, b, c, d, x[i + 5], 5, -701558691);
        d = md5gg(d, a, b, c, x[i + 10], 9, 38016083);
        c = md5gg(c, d, a, b, x[i + 15], 14, -660478335);
        b = md5gg(b, c, d, a, x[i + 4], 20, -405537848);
        a = md5gg(a, b, c, d, x[i + 9], 5, 568446438);
        d = md5gg(d, a, b, c, x[i + 14], 9, -1019803690);
        c = md5gg(c, d, a, b, x[i + 3], 14, -187363961);
        b = md5gg(b, c, d, a, x[i + 8], 20, 1163531501);
        a = md5gg(a, b, c, d, x[i + 13], 5, -1444681467);
        d = md5gg(d, a, b, c, x[i + 2], 9, -51403784);
        c = md5gg(c, d, a, b, x[i + 7], 14, 1735328473);
        b = md5gg(b, c, d, a, x[i + 12], 20, -1926607734);
        a = md5hh(a, b, c, d, x[i + 5], 4, -378558);
        d = md5hh(d, a, b, c, x[i + 8], 11, -2022574463);
        c = md5hh(c, d, a, b, x[i + 11], 16, 1839030562);
        b = md5hh(b, c, d, a, x[i + 14], 23, -35309556);
        a = md5hh(a, b, c, d, x[i + 1], 4, -1530992060);
        d = md5hh(d, a, b, c, x[i + 4], 11, 1272893353);
        c = md5hh(c, d, a, b, x[i + 7], 16, -155497632);
        b = md5hh(b, c, d, a, x[i + 10], 23, -1094730640);
        a = md5hh(a, b, c, d, x[i + 13], 4, 681279174);
        d = md5hh(d, a, b, c, x[i], 11, -358537222);
        c = md5hh(c, d, a, b, x[i + 3], 16, -722521979);
        b = md5hh(b, c, d, a, x[i + 6], 23, 76029189);
        a = md5hh(a, b, c, d, x[i + 9], 4, -640364487);
        d = md5hh(d, a, b, c, x[i + 12], 11, -421815835);
        c = md5hh(c, d, a, b, x[i + 15], 16, 530742520);
        b = md5hh(b, c, d, a, x[i + 2], 23, -995338651);
        a = md5ii(a, b, c, d, x[i], 6, -198630844);
        d = md5ii(d, a, b, c, x[i + 7], 10, 1126891415);
        c = md5ii(c, d, a, b, x[i + 14], 15, -1416354905);
        b = md5ii(b, c, d, a, x[i + 5], 21, -57434055);
        a = md5ii(a, b, c, d, x[i + 12], 6, 1700485571);
        d = md5ii(d, a, b, c, x[i + 3], 10, -1894986606);
        c = md5ii(c, d, a, b, x[i + 10], 15, -1051523);
        b = md5ii(b, c, d, a, x[i + 1], 21, -2054922799);
        a = md5ii(a, b, c, d, x[i + 8], 6, 1873313359);
        d = md5ii(d, a, b, c, x[i + 15], 10, -30611744);
        c = md5ii(c, d, a, b, x[i + 6], 15, -1560198380);
        b = md5ii(b, c, d, a, x[i + 13], 21, 1309151649);
        a = md5ii(a, b, c, d, x[i + 4], 6, -145523070);
        d = md5ii(d, a, b, c, x[i + 11], 10, -1120210379);
        c = md5ii(c, d, a, b, x[i + 2], 15, 718787259);
        b = md5ii(b, c, d, a, x[i + 9], 21, -343485551);
        a = safeAdd(a, olda);
        b = safeAdd(b, oldb);
        c = safeAdd(c, oldc);
        d = safeAdd(d, oldd);
      }
      return [a, b, c, d];
    }

    function binl2hex(binarray) {
      const hexTab = '0123456789abcdef';
      let str = '';
      for (let i = 0; i < binarray.length * 4; i++) {
        str += hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8 + 4)) & 0xf) +
               hexTab.charAt((binarray[i >> 2] >> ((i % 4) * 8)) & 0xf);
      }
      return str;
    }

    function str2binl(str) {
      const bin = [];
      for (let i = 0; i < str.length; i++) {
        bin[i >> 2] |= (str.charCodeAt(i) & 255) << ((i % 4) * 8);
      }
      return bin;
    }

    return function (s) {
      return binl2hex(binlMD5(str2binl(s), s.length * 8));
    };
  })();

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

    /**
     * UP 主是否有未读新动态（红点）
     * - 没 dynamic_ts（没测过活跃度）→ false
     * - 没 lastSeen（用户从未看过）→ true
     * - lastSeen < dynamic_ts → true（新动态）
     * - 否则 false（已读）
     * @param {{mid:number, dynamic_ts?:number}} u
     * @param {Object} lastSeenMap storage.state.lastSeen
     * @returns {boolean}
     */
    hasNewDynamic(u, lastSeenMap) {
      if (!u || !u.dynamic_ts) return false;
      const lastSeen = lastSeenMap?.[u.mid] || 0;
      return u.dynamic_ts > lastSeen;
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
     * 创建无障碍模态对话框。
     * 符合 WCAG 2.1：
     *  - role="dialog" + aria-modal="true" + aria-labelledby
     *  - 打开时焦点移到第一个可聚焦元素
     *  - Tab/Shift+Tab 焦点循环在 modal 内
     *  - Escape 关闭
     *  - 关闭时焦点返回触发器
     * @param {Object} opts
     * @param {HTMLElement} opts.trigger - 触发器元素（用于返回焦点）
     * @param {string} [opts.titleId] - modal 标题的 id（用于 aria-labelledby）
     * @param {string} [opts.html] - modal 内容 HTML
     * @param {boolean} [opts.alert] - 是否 alertdialog（更强烈的打断）
     * @param {Function} [opts.onClose] - 关闭回调
     * @param {HTMLElement} [opts.container] - 挂载容器；不传则自动用 #bfm-shadow-host 的 shadow root
     * @returns {{mask: HTMLElement, modal: HTMLElement, close: Function}}
     */
    createAccessibleModal({ trigger, titleId, html, alert = false, onClose, container }) {
      const mask = document.createElement('div');
      mask.className = 'bfm-modal-mask';

      const modal = document.createElement('div');
      modal.className = 'bfm-modal';
      modal.setAttribute('role', alert ? 'alertdialog' : 'dialog');
      modal.setAttribute('aria-modal', 'true');
      if (titleId) modal.setAttribute('aria-labelledby', titleId);
      modal.setAttribute('tabindex', '-1');
      modal.innerHTML = html;
      mask.appendChild(modal);

      // 让其他内容对屏幕阅读器"不可达"（背景 inert）
      // 注意：脚本本身在 body 顶层，无法用 inert 锁定整页，但我们的 UI 是独立 Shadow DOM，
      // 背景的 B 站页面用户应已被脚本的 FAB 接管焦点路径，影响有限。
      mask.style.pointerEvents = 'auto';
      // 挂载容器自动定位：caller 传入 → #bfm-shadow-host 的 shadow root → document.body
      // ⚠️ 不能用 this.shadow：helper 是 utils 上的方法，this 指的是 utils（不是 UI 控制器）。
      // 之前 (this.shadow || document.body) 永远走 fallback，modal 被挂到 body（light DOM），
      // shadow 内的 CSS 选择器 .bfm-modal-mask / .bfm-modal 不生效 → 用户看到无框内容
      let target = container;
      if (!target) {
        const host = document.getElementById('bfm-shadow-host');
        target = host?.shadowRoot || document.body;
      }
      target.appendChild(mask);

      const focusableSel = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const getFocusable = () => Array.from(modal.querySelectorAll(focusableSel));

      // 初始焦点：移到 modal 容器或第一个可聚焦元素
      requestAnimationFrame(() => {
        const first = getFocusable()[0];
        (first || modal).focus();
      });

      // 焦点循环 + Escape
      const onKey = (e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          close();
          return;
        }
        if (e.key !== 'Tab') return;
        const els = getFocusable();
        if (!els.length) {
          e.preventDefault();
          modal.focus();
          return;
        }
        const first = els[0], last = els[els.length - 1];
        const active = modal.querySelector(':focus') || document.activeElement;
        if (e.shiftKey) {
          if (active === first || !modal.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (active === last || !modal.contains(active)) {
            e.preventDefault();
            first.focus();
          }
        }
      };
      mask.addEventListener('keydown', onKey);

      const close = () => {
        mask.removeEventListener('keydown', onKey);
        mask.remove();
        // 焦点返回触发器
        if (trigger && typeof trigger.focus === 'function') {
          try { trigger.focus(); } catch (_) { /* noop */ }
        }
        if (onClose) try { onClose(); } catch (e) { utils.error('modal onClose failed', e); }
      };

      return { mask, modal, close };
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

    // ===== 风控日历：衰减滑窗热度评分（v0.10.5） =====
    // 错误码解析：-101 = 未登录，'API -352:' / 'API -412:' 是风控码，其他 → 'other'
    parseApiCode(e) {
      if (e?.message === 'NOT_LOGGED_IN') return '-101';
      const m = e?.message?.match(/API (-?\d+):/);
      return m ? `-${m[1]}` : 'other';
    },

    windLoad() {
      try { return JSON.parse(GM_getValue('bfm_wind_calendar_v1', 'null')); }
      catch { return null; }
    },

    windRecord(op, count, result, durationMs) {
      const data = this.windLoad() || { version: 1, records: [] };
      data.records.push({ ts: Date.now(), op, count, result, durationMs });
      if (data.records.length > 200) data.records = data.records.slice(-200);
      if (result === '-352' || result === '-412') data.lastRiskAt = Date.now();
      GM_setValue('bfm_wind_calendar_v1', JSON.stringify(data));
    },

    windStatus() {
      const data = this.windLoad();
      if (!data) return { heat: 0, level: 'green', totals24h: {}, lastRiskAgeMin: null };
      const TAU = 7200;
      let heat = 0;
      const totals = { unfollow: 0, writeOps: 0 };
      for (const r of data.records) {
        const dt = (Date.now() - r.ts) / 1000;
        if (dt > 86400) continue;
        const w = { unfollow: 1.0, 'tags/addUsers': 0.6, createGroup: 0.4,
                    'tags/delUsers': 0.4 }[r.op] ?? 0.5;
        const f = { ok: 1.0, '-352': 2.5, '-412': 2.0, '-101': 0 }[r.result] ?? 1.0;
        heat += w * f * Math.exp(-dt / TAU) * r.count;
        if (dt <= 86400) {
          totals.writeOps += r.count;
          if (r.op === 'unfollow') totals.unfollow += r.count;
        }
      }
      const level = heat < 30 ? 'green' : heat < 60 ? 'yellow' : heat < 80 ? 'orange' : 'red';
      const lastRiskAgeMin = data.lastRiskAt
        ? Math.round((Date.now() - data.lastRiskAt) / 60000) : null;
      return { heat: Math.round(heat), level, totals24h: totals, lastRiskAgeMin };
    },

    // 写操作前调用：返回应额外 sleep 的毫秒数（0 = 不减速）
    windGuard() {
      const { level } = this.windStatus();
      if (level === 'green') return 0;
      if (level === 'yellow') return 1500;
      if (level === 'orange') return 3000;
      return 5 * 60_000;
    },
  };

  // 测试 hook：仅 Node 环境挂载（浏览器中 process 不存在，自然跳过）
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    globalThis.__bfm_utils = utils;
  }

  // ============================================================
  // 2. 持久化存储 (storage)
  // ============================================================
  const STORAGE_VERSION = 3;   // 当前版本，破坏性变更时 +1 并写迁移
  const storage = {
    state: null,

    defaultState() {
      return {
        version: STORAGE_VERSION,
        mid: null,                  // 自己的 mid
        groups: [],                 // [{tagid, name, count}]
        following: {},              // mid -> {mid, uname, face, tagids:[], mtime, lastActive, dynamic_ts}
        settings: {
          inactiveThresholdDays: CONFIG.INACTIVE_DAYS,
          panelCollapsed: false,
        },
        lastSeen: {},              // {mid: timestamp} 用户最后一次查看该 UP 的时间
        aiOutliers: null,           // AI 画像分析推断的疑似误关注 {items, updatedAt}
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
      if (v < 3) {
        // v2 → v3: 加 lastSeen 字段（用户查看 UP 时间戳，用于红点）
        s.lastSeen = s.lastSeen || {};
        // 同时把已有 lastActive 复制成 dynamic_ts（如果还没有）
        for (const mid in s.following || {}) {
          if (s.following[mid] && !s.following[mid].dynamic_ts && s.following[mid].lastActive) {
            s.following[mid].dynamic_ts = s.following[mid].lastActive;
          }
        }
        // aiOutliers 是 v3 新加的，旧数据自然没有
        s.aiOutliers = s.aiOutliers || null;
        s.version = 3;
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

    // 死粉候选（已修复 lastActive=0 误判 bug）
    // 只统计真正检测过且超过阈值未更新的 UP 主
    getInactiveCandidates() {
      const days = this.state.settings.inactiveThresholdDays;
      const now = Date.now();
      return Object.values(this.state.following)
        .filter(u => u && u.lastActive > 0 && (now - u.lastActive) / 86400000 > days)
        .sort((a, b) => (a.lastActive || 0) - (b.lastActive || 0));
    },

    // 未检测过的 UP 主（独立于死粉，方便 UI 分段显示）
    getUndetected() {
      return Object.values(this.state.following).filter(u => u && !u.lastActive);
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
            // v0.10.4：风控码（-352 拦截 / -412 请求过快）用更长的退避，
            // 普通 API 错误维持原有短退避
            const isRisk = /-352|-412/.test(e.message);
            const backoff = isRisk
              ? 5000 * Math.pow(2, attempt - 1)
              : 500 * Math.pow(2, attempt - 1);
            utils.warn(`retry ${attempt}/${retry} for ${url}`, e.message);
            await utils._sleep(backoff);
          }
        }
      });
    },

    _doRequest(url, method, body, extraHeaders) {
      return new Promise((resolve, reject) => {
        const headers = {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          // 不显式设 Cookie：让 GM_xmlhttpRequest + anonymous:false 自动带浏览器全部 cookie
          // （含 SESSDATA 即便是 httpOnly）
          ...extraHeaders,
        };
        // bili_jct 通过 URL query 形式注入（部分接口认）
        // 对于需要 CSRF 的 POST，B 站也能从 form body 的 csrf 字段读取，所以这里只补 Referer
        if (method === 'POST') {
          headers['Referer'] = 'https://www.bilibili.com/';
          headers['Origin'] = 'https://www.bilibili.com';
        }
        GM_xmlhttpRequest({
          method,
          url,
          data: body ? Object.entries(body).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&') : undefined,
          headers,
          responseType: 'json',
          anonymous: false,        // 关键：false 才会带浏览器 cookie（true 不带）
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
      const start = Date.now();
      try {
        const data = await this.request(`${CONFIG.API_BASE}/x/relation/tag/add`, {
          method: 'POST',
          body: { name, csrf: utils.getBiliJct() },
        });
        utils.windRecord('createGroup', 1, 'ok', Date.now() - start);
        return data;
      } catch (e) {
        utils.windRecord('createGroup', 1, utils.parseApiCode(e), Date.now() - start);
        throw e;
      }
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
      // 单次最多 25 个（v0.10.4 从 50 降半：大 fids 串更容易触发 -352 风控）
      // 块间强制间隔 600ms：写操作比读操作更容易被风控盯上
      // v0.10.5：块前后 windGuard（基于风控评分自适应减速）+ 块内 try/catch 埋点
      for (let i = 0; i < mids.length; i += 25) {
        const slice = mids.slice(i, i + 25);
        await utils.windGuard();
        const start = Date.now();
        try {
          await this.request(`${CONFIG.API_BASE}/x/relation/tags/addUsers`, {
            method: 'POST',
            body: { tagid, fids: slice.join(','), csrf: utils.getBiliJct() },
          });
          utils.windRecord('tags/addUsers', slice.length, 'ok', Date.now() - start);
        } catch (e) {
          utils.windRecord('tags/addUsers', slice.length, utils.parseApiCode(e), Date.now() - start);
          throw e;
        }
        await utils.windGuard();
        if (i + 25 < mids.length) await utils._sleep(600);
      }
    },

    async removeUsersFromGroup(tagid, mids) {
      if (!mids.length) return;
      // 同上：v0.10.4 块 50→25，块间 +600ms
      for (let i = 0; i < mids.length; i += 25) {
        const slice = mids.slice(i, i + 25);
        await this.request(`${CONFIG.API_BASE}/x/relation/tags/delUsers`, {
          method: 'POST',
          body: { tagid, fids: slice.join(','), csrf: utils.getBiliJct() },
        });
        if (i + 25 < mids.length) await utils._sleep(600);
      }
    },

    /**
     * 取关单个 UP 主
     * B 站接口：POST /x/relation/modify
     *   fid=目标mid  act=2  re_src=来源码  csrf=bili_jct
     * act=1 关注，2 取关，5 拉黑
     */
    async unfollow(mid, reSrc = 11) {
      const start = Date.now();
      try {
        const data = await this.request(`${CONFIG.API_BASE}/x/relation/modify`, {
          method: 'POST',
          body: { fid: mid, act: 2, re_src: reSrc, csrf: utils.getBiliJct() },
        });
        utils.windRecord('unfollow', 1, 'ok', Date.now() - start);
        return data;
      } catch (e) {
        utils.windRecord('unfollow', 1, utils.parseApiCode(e), Date.now() - start);
        throw e;
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
    'minimax-payg': {
      label: 'minimax 按量计费（Pay-as-you-go）',
      baseUrl: 'https://api.minimaxi.com/v1',
      protocol: 'openai',
      models: ['MiniMax-M3', 'MiniMax-M2.7', 'MiniMax-M2.7-highspeed'],
      note: 'OpenAI 兼容。Key 以 sk-api- 开头。国际账户改 api.minimax.io',
    },
    'minimax-token-plan': {
      label: 'minimax Token Plan（订阅）',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      protocol: 'anthropic',
      models: ['MiniMax-M3', 'MiniMax-M2.7'],
      note: 'Anthropic 兼容。Key 以 sk-cp- 开头。国际账户改 api.minimax.io',
    },
    'deepseek': {
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
      protocol: 'openai',
      models: ['deepseek-chat', 'deepseek-reasoner'],
      note: '国内，便宜，V3/R1 都有',
    },
    'kimi': {
      label: 'Kimi（Moonshot 月之暗面）',
      baseUrl: 'https://api.moonshot.cn/v1',
      protocol: 'openai',
      models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k', 'kimi-k2-0711-preview'],
      note: '长文本友好，最高 128k context',
    },
    'qwen': {
      label: '通义千问（阿里 DashScope）',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      protocol: 'openai',
      models: ['qwen-turbo', 'qwen-plus', 'qwen-max', 'qwen-long'],
      note: '阿里云，需先在控制台开通 DashScope',
    },
    'zhipu': {
      label: '智谱 BigModel',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4/',
      protocol: 'openai',
      models: ['glm-4-flash', 'glm-4-air', 'glm-4', 'glm-4-plus'],
      note: '兼容模式，GLM-4-Flash 限时免费',
    },
    'siliconflow': {
      label: '硅基流动 SiliconFlow',
      baseUrl: 'https://api.siliconflow.cn/v1',
      protocol: 'openai',
      models: ['Qwen/Qwen2.5-7B-Instruct', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-ai/DeepSeek-V2.5', 'meta-llama/Llama-3.1-8B-Instruct'],
      note: '聚合站，多模型可选',
    },
    'gemini': {
      label: 'Google Gemini',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
      protocol: 'openai',
      models: ['gemini-1.5-flash', 'gemini-1.5-flash-8b', 'gemini-1.5-pro'],
      note: '需要海外网络',
    },
    'openai': {
      label: 'OpenAI 官方',
      baseUrl: 'https://api.openai.com/v1',
      protocol: 'openai',
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
      note: '需科学上网，gpt-4o-mini 最便宜',
    },
    'ollama': {
      label: 'Ollama（本地）',
      baseUrl: 'http://localhost:11434/v1',
      protocol: 'openai',
      models: ['llama3.1:8b', 'qwen2.5:7b', 'deepseek-r1:8b'],
      note: '本地推理免费，API Key 随便填一个字符串',
    },
    'custom': {
      label: '自定义（其他厂商）',
      baseUrl: '',
      protocol: 'openai',
      models: [],
      note: '填你自己的 Base URL 和 Model 名（OpenAI 兼容）',
    },
  };

  const llm = {
    // 配置
    defaults: {
      provider: 'minimax-token-plan',
      baseUrl: 'https://api.minimaxi.com/anthropic',
      apiKey: '',
      model: 'MiniMax-M3',
      temperature: 0.3,
      maxTokens: 2000,
    },

    isConfigured() {
      const c = this.getConfig();
      return Boolean(c.apiKey && c.baseUrl && c.model);
    },

    getConfig() {
      const stored = storage.state.settings.llm || {};
      let provider = stored.provider;
      // 老用户迁移：旧 'minimax' 按 baseUrl 拆分到 payg / token-plan
      if (provider === 'minimax') {
        provider = stored.baseUrl?.includes('/anthropic') ? 'minimax-token-plan' : 'minimax-payg';
      }
      const merged = { ...this.defaults, ...stored, provider };
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

    // 通用 chat 调用 — 根据 provider.protocol 分发到 OpenAI / Anthropic 两种实现
    async chat(messages, opts = {}) {
      const cfg = this.getConfig();
      if (!this.isConfigured()) throw new Error('请先在设置页配置 LLM API Key');
      const protocol = LLM_PROVIDERS[cfg.provider]?.protocol || 'openai';
      return protocol === 'anthropic'
        ? this._chatAnthropic(messages, opts)
        : this._chatOpenAI(messages, opts);
    },

    // OpenAI 兼容协议（DeepSeek/Kimi/Qwen/OpenAI/Gemini/...）
    _chatOpenAI(messages, opts = {}) {
      const cfg = this.getConfig();
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
          anonymous: true,
          timeout: opts.timeout ?? 90_000,  // 90s 默认上限（防永久挂起）
          onload(r) {
            try {
              const resp = typeof r.response === 'string' ? JSON.parse(r.response) : r.response;
              if (resp.error) return reject(new Error(resp.error.message || 'LLM error'));
              const content = resp.choices?.[0]?.message?.content || '';
              resolve(content);
            } catch (e) { reject(e); }
          },
          onerror(e) { reject(new Error(`网络错误 (status=${e?.status || '?'})`)); },
          ontimeout() { reject(new Error('请求超时（90s 内未返回）')); },
        });
      }));
    },

    // Anthropic 兼容协议（minimax Token Plan、Claude 等）
    _chatAnthropic(messages, opts = {}) {
      const cfg = this.getConfig();
      // OpenAI 格式 -> Anthropic 格式
      // system message 提到顶层，user/assistant 的 content 改为数组
      const systemParts = [];
      const chatMessages = [];
      for (const m of messages) {
        if (m.role === 'system') systemParts.push(m.content);
        else if (m.role === 'user' || m.role === 'assistant') {
          chatMessages.push({ role: m.role, content: [{ type: 'text', text: String(m.content ?? '') }] });
        }
      }
      const body = {
        model: cfg.model,
        messages: chatMessages,
        max_tokens: opts.maxTokens ?? cfg.maxTokens,
        temperature: opts.temperature ?? cfg.temperature,
      };
      if (systemParts.length) body.system = systemParts.join('\n\n');

      return utils.enqueue(() => new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'POST',
          url: `${cfg.baseUrl.replace(/\/$/, '')}/v1/messages`,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.apiKey}`,
            'anthropic-version': '2023-06-01',
          },
          data: JSON.stringify(body),
          responseType: 'json',
          anonymous: true,
          timeout: opts.timeout ?? 90_000,
          onload(r) {
            try {
              const resp = typeof r.response === 'string' ? JSON.parse(r.response) : r.response;
              if (resp.error) return reject(new Error(resp.error.message || (resp.error.type || 'LLM error')));
              // Anthropic 响应: { content: [{type:"text", text:"..."}], ... }
              const block = (resp.content || []).find(b => b.type === 'text');
              resolve(block?.text || '');
            } catch (e) { reject(e); }
          },
          onerror(e) { reject(new Error(`网络错误 (status=${e?.status || '?'})`)); },
          ontimeout() { reject(new Error('请求超时（90s 内未返回）')); },
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
    async suggestGrouping(users, existingGroups = [], opts = {}) {
      const userList = users.map(u =>
        `- mid=${u.mid} | ${u.uname} | 签名:${u.sign || '无'} | 最近:${u.lastTitle || '无'}`
      ).join('\n');

      // v0.10.4：带人数的分组清单 — 模型更倾向复用大组，而不是为每个人建新组
      const groupsHint = existingGroups.length
        ? `\n已有分组（按人数排序。请优先把 UP 主归入这些组，名字必须原样照抄）：\n${existingGroups
            .slice()
            .sort((a, b) => (b.count || 0) - (a.count || 0))
            .map(g => `- ${g.name}${g.count ? `（已有 ${g.count} 人）` : ''}`)
            .join('\n')}\n`
        : '';

      // v0.10.4 重写 prompt：严格约束复用、限制新组数量、给出B站常见分类示例
      const prompt = `你是 B 站关注列表整理助手。下面是 ${users.length} 位 UP 主的名字/签名/最近视频标题。

任务：给每位 UP 主推荐一个分组。

硬性要求：
1. 只要某个已有分组说得通，就必须复用它（名字一字不差）。新分组总数不要超过 3 个。
2. 新分组必须是 2-6 字的宽泛中文类别（如：知识科普 / 影视剪辑 / 生活记录 / 游戏 / 音乐 / 美食），禁止为人名或单一主题建组。
3. 拿不准就归入最接近的宽泛类别，不要用"其他/杂项"兜底超过 2 人。
4. 每人一句 ≤15 字理由。
5. 只输出 JSON 数组，无任何其他文字。${groupsHint}

UP 主列表：
${userList}

输出格式：
[{"mid":123,"group":"技术","reason":"编程教程"},{"mid":456,"group":"娱乐","reason":"游戏实况"}]`;

      const content = await this.chat([
        { role: 'system', content: '你只输出 JSON，不要任何解释性文字。' },
        { role: 'user', content: prompt },
      ], { temperature: 0.2, timeout: opts.timeout });

      // v0.10.3：解析失败时重试一次（让模型重新格式化）— 大幅降低"模型偶尔不输出 JSON"的失败率
      let arr;
      try {
        arr = this._parseJsonArray(content);
      } catch (e) {
        utils.warn('AI 分组 JSON 解析失败，重试一次', e.message);
        const retry = await this.chat([
          { role: 'system', content: '你只输出合法 JSON 数组，不要任何解释、markdown 代码块或多余文字。' },
          { role: 'user', content: prompt + '\n\n[提醒] 上一次输出无法解析。请严格按 JSON 数组格式输出，不要 ``` 包裹，不要写任何额外文字。' },
        ], { temperature: 0.0, timeout: opts.timeout });
        arr = this._parseJsonArray(retry);  // 二次失败直接抛出，让外层收集到 failedMids
      }
      return arr.filter(x => x.mid && x.group);
    },

    /**
     * 容错 JSON 数组解析（v0.10.3）
     * 容忍：markdown 代码块包裹、尾部逗号、首尾多余文字、空白字符
     * 失败抛错，由 suggestGrouping 决定是否重试
     */
    _parseJsonArray(content) {
      if (!content || typeof content !== 'string') {
        throw new Error('模型返回为空');
      }
      let s = content.trim();
      // 1. 剥 markdown 代码块（```json ... ``` 或 ``` ... ```）
      const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fence) s = fence[1].trim();
      // 2. 找首个 [ 到末尾 ]（容忍模型在前面/后面写了别的文字）
      const bracketStart = s.indexOf('[');
      const bracketEnd = s.lastIndexOf(']');
      if (bracketStart === -1 || bracketEnd === -1 || bracketEnd < bracketStart) {
        throw new Error('模型未返回 JSON 数组（找不到 [...]）');
      }
      s = s.slice(bracketStart, bracketEnd + 1);
      // 3. 修 trailing comma (",]" 或 ",}")
      s = s.replace(/,(\s*[}\]])/g, '$1');
      // 4. parse
      let arr;
      try {
        arr = JSON.parse(s);
      } catch (e) {
        throw new Error(`JSON 解析失败：${e.message}`);
      }
      if (!Array.isArray(arr)) throw new Error('模型返回不是数组');
      return arr;
    },

    // ---- 场景 2: 画像分析 ----
    /**
     * 汇总关注列表，返回兴趣画像 + 推荐新分组
     */
    async analyzeProfile(sampleUsers) {
      // 抽样：取最多 200 个 UP 主，传入 mid 让 AI 能精确指认
      const sample = sampleUsers.slice(0, 200).map(u =>
        `- mid=${u.mid} | ${u.uname} | ${u.sign || ''}`
      ).join('\n');

      const prompt = `分析以下 B 站用户关注的 UP 主列表，给出：

1. **兴趣画像**：用 3-5 个关键词概括
2. **建议的新分组**：列出 5-8 个合理分组（基于关注结构推测用户尚未创建的分组）
3. **可能误关注**：识别那些看起来与主兴趣无关的 UP 主（返回 mid 和 name，必须严格按下方格式）

UP 主列表（共 ${sampleUsers.length} 个，抽样展示前 ${Math.min(200, sampleUsers.length)} 个）：
${sample}

输出格式（严格 JSON）：
{
  "profile": ["关键词1", "关键词2"],
  "suggestedGroups": [{"name":"分组名","reason":"为什么需要这个分组"}],
  "outliers": [{"mid": 12345, "name": "UP主名字"}]
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
      // 内联 md5（零 CDN 依赖）
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
            // dynamic_ts 与 lastActive 用同一时间戳（最新视频时间）
            // 后续如果接入真正的"动态时间"接口，可独立更新
            storage.state.following[u.mid].dynamic_ts = v.created;
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
    shadow: null,         // ShadowRoot：所有 UI 都在这里，规避 B 站检测
    shadowHost: null,

    /**
     * SVG 图标库（Heroicons-style outline, 16x16 / 24x24）
     * 用法：utils.icons.tv 或 utils.icons.<name>
     */
    icons: {
      tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2V7Z"/><path d="m8 21 4-3 4 3"/></svg>',
      refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.3L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-15.5 6.3L3 16"/><path d="M3 21v-5h5"/></svg>',
      spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3m0 12v3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M3 12h3m12 0h3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg>',
      download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14"/></svg>',
      upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21V9m0 0-4 4m4-4 4 4M5 3h14"/></svg>',
      settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/></svg>',
      close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
      folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>',
      plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
      edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4 20 8 8 20H4v-4L16 4Z"/></svg>',
      trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 7V4h4v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/></svg>',
      chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10m6 10V4m6 16v-7m6 7V13"/></svg>',
      key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="14" r="4"/><path d="m11 11 9-9m-3 0h3v3"/></svg>',
      chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
      filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 5h18l-7 9v6l-4-2v-4L3 5Z"/></svg>',
    },

    mount() {
      // ============================================================
      // 设计令牌（Design Tokens）
      // ============================================================
      const CSS = `
        :host {
          /* Color — 主题色用 B 站蓝作为 accent，主体走中性灰 */
          --bfm-primary: #00aeec;
          --bfm-primary-hover: #00b5e5;
          --bfm-primary-press: #0080bf;
          --bfm-primary-soft: rgba(0, 174, 236, 0.08);
          --bfm-accent: #fb7299;
          --bfm-accent-soft: rgba(251, 114, 153, 0.08);
          --bfm-success: #10b981;
          --bfm-warning: #f59e0b;
          --bfm-danger: #ef4444;

          /* Surface */
          --bfm-bg: #ffffff;
          --bfm-bg-alt: #f7f8fa;
          --bfm-bg-hover: #f1f5f9;
          --bfm-border: #e5e7eb;
          --bfm-border-strong: #d1d5db;

          /* Text */
          --bfm-text: #0f172a;
          --bfm-text-2: #475569;
          --bfm-text-3: #94a3b8;

          /* Radius */
          --bfm-r-sm: 6px;
          --bfm-r-md: 10px;
          --bfm-r-lg: 14px;
          --bfm-r-pill: 999px;

          /* Shadow — 多层柔光 */
          --bfm-sh-sm: 0 1px 2px rgba(15, 23, 42, .06);
          --bfm-sh-md: 0 4px 12px -2px rgba(15, 23, 42, .08), 0 1px 2px rgba(15, 23, 42, .04);
          --bfm-sh-lg: 0 16px 32px -8px rgba(15, 23, 42, .12), 0 4px 8px rgba(15, 23, 42, .04);

          /* Motion */
          --bfm-ease: cubic-bezier(.4, 0, .2, 1);
          --bfm-spring: cubic-bezier(.34, 1.56, .64, 1);
          --bfm-dur: 200ms;

          font-family: -apple-system, BlinkMacSystemFont, "PingFang SC",
            "Hiragino Sans GB", "Microsoft YaHei", "Segoe UI", Roboto,
            "Helvetica Neue", Arial, sans-serif;
          font-size: 14px;
          line-height: 1.5;
          color: var(--bfm-text);
        }

        /* ---------- FAB ---------- */
        .bfm-fab {
          position: fixed;
          right: 24px;
          bottom: 80px;
          width: 52px;
          height: 52px;
          border-radius: 14px;
          border: none;
          cursor: pointer;
          background: linear-gradient(135deg, #00aeec 0%, #0080bf 100%);
          color: #fff;
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow:
            0 8px 24px -4px rgba(0, 174, 236, .45),
            0 2px 4px rgba(15, 23, 42, .06),
            inset 0 1px 0 rgba(255, 255, 255, .25);
          transition:
            transform var(--bfm-dur) var(--bfm-spring),
            box-shadow var(--bfm-dur) var(--bfm-ease);
          z-index: 9999;
        }
        .bfm-fab:hover {
          transform: translateY(-2px) scale(1.04);
          box-shadow:
            0 14px 32px -4px rgba(0, 174, 236, .55),
            0 4px 8px rgba(15, 23, 42, .08),
            inset 0 1px 0 rgba(255, 255, 255, .25);
        }
        .bfm-fab:active { transform: scale(.96); }
        .bfm-fab svg { width: 24px; height: 24px; display: block; }
        .bfm-fab.bfm-busy {
          background: linear-gradient(135deg, #fb7299 0%, #d94575 100%);
          animation: bfm-pulse 1.4s var(--bfm-ease) infinite;
        }
        @keyframes bfm-pulse {
          0%, 100% { box-shadow: 0 8px 24px -4px rgba(251, 114, 153, .45); }
          50%      { box-shadow: 0 8px 32px -4px rgba(251, 114, 153, .75); }
        }

        /* ---------- Panel ---------- */
        .bfm-panel {
          position: fixed;
          top: 0;
          right: 0;
          height: 100vh;
          width: 460px;
          max-width: 96vw;
          background: var(--bfm-bg);
          box-shadow: var(--bfm-sh-lg);
          z-index: 10000;
          transform: translateX(100%);
          transition: transform 320ms var(--bfm-ease);
          display: flex;
          flex-direction: column;
        }
        .bfm-panel.bfm-open { transform: translateX(0); }

        /* ---------- Header ---------- */
        .bfm-head {
          padding: 20px 22px 18px;
          border-bottom: 1px solid var(--bfm-border);
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .bfm-brand {
          width: 32px; height: 32px;
          border-radius: 9px;
          background: linear-gradient(135deg, #00aeec 0%, #0080bf 100%);
          display: flex; align-items: center; justify-content: center;
          color: #fff; flex-shrink: 0;
          box-shadow: 0 2px 8px -2px rgba(0, 174, 236, .35);
        }
        .bfm-brand svg { width: 18px; height: 18px; }
        .bfm-title {
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -.01em;
          flex: 1;
        }
        .bfm-title small {
          display: block;
          font-size: 11px;
          font-weight: 400;
          color: var(--bfm-text-3);
          margin-top: 1px;
          letter-spacing: 0;
        }

        /* ---------- Buttons ---------- */
        .bfm-btn {
          padding: 7px 12px;
          border: 1px solid var(--bfm-border);
          background: var(--bfm-bg);
          color: var(--bfm-text);
          border-radius: var(--bfm-r-sm);
          cursor: pointer;
          font-size: 12.5px;
          font-weight: 500;
          display: inline-flex;
          align-items: center;
          gap: 5px;
          transition: border-color var(--bfm-dur), background var(--bfm-dur), transform 100ms var(--bfm-ease);
        }
        .bfm-btn:hover { background: var(--bfm-bg-hover); border-color: var(--bfm-border-strong); }
        .bfm-btn:active { transform: scale(.97); }
        .bfm-btn svg { width: 13px; height: 13px; }
        .bfm-btn-primary {
          background: var(--bfm-primary);
          color: #fff;
          border-color: var(--bfm-primary);
        }
        .bfm-btn-primary:hover {
          background: var(--bfm-primary-hover);
          border-color: var(--bfm-primary-hover);
        }
        .bfm-btn-ghost {
          background: transparent;
          border-color: transparent;
          color: var(--bfm-text-3);
        }
        .bfm-btn-ghost:hover {
          background: var(--bfm-bg-hover);
          color: var(--bfm-text);
        }
        .bfm-btn-icon {
          width: 30px; height: 30px; padding: 0;
          justify-content: center;
        }

        /* ---------- Tabs（分段控件） ---------- */
        .bfm-tabs {
          display: flex;
          padding: 12px 22px;
          gap: 0;
          background: var(--bfm-bg);
          border-bottom: 1px solid var(--bfm-border);
        }
        .bfm-tabs-wrap {
          display: inline-flex;
          background: var(--bfm-bg-alt);
          padding: 3px;
          border-radius: var(--bfm-r-md);
          gap: 2px;
        }
        .bfm-tab {
          padding: 5px 14px;
          border-radius: 7px;
          cursor: pointer;
          font-size: 13px;
          font-weight: 500;
          color: var(--bfm-text-2);
          transition: color var(--bfm-dur), background var(--bfm-dur);
          white-space: nowrap;
        }
        .bfm-tab:hover { color: var(--bfm-text); }
        .bfm-tab.bfm-active {
          background: var(--bfm-bg);
          color: var(--bfm-text);
          box-shadow: var(--bfm-sh-sm);
        }

        /* ---------- Body ---------- */
        .bfm-body {
          flex: 1;
          overflow: auto;
          padding: 18px 22px;
          background: var(--bfm-bg);
        }
        .bfm-empty {
          text-align: center;
          color: var(--bfm-text-3);
          padding: 48px 20px;
          font-size: 13px;
        }
        .bfm-section-title {
          font-size: 11px;
          font-weight: 600;
          color: var(--bfm-text-3);
          text-transform: uppercase;
          letter-spacing: .06em;
          margin: 16px 0 10px;
        }
        .bfm-section-title:first-child { margin-top: 0; }

        /* ---------- Group Card ---------- */
        .bfm-group {
          border: 1px solid var(--bfm-border);
          border-radius: var(--bfm-r-md);
          margin-bottom: 10px;
          overflow: hidden;
          background: var(--bfm-bg);
          transition: border-color var(--bfm-dur), box-shadow var(--bfm-dur);
        }
        .bfm-group:hover { border-color: var(--bfm-border-strong); box-shadow: var(--bfm-sh-sm); }
        .bfm-group-head {
          padding: 10px 14px;
          display: flex;
          align-items: center;
          gap: 10px;
          cursor: pointer;
          user-select: none;
        }
        .bfm-group-name {
          font-weight: 600;
          font-size: 13.5px;
          flex: 1;
        }
        .bfm-group-count {
          font-size: 11.5px;
          color: var(--bfm-text-3);
          font-variant-numeric: tabular-nums;
        }
        .bfm-group-body { border-top: 1px solid var(--bfm-border); }

        /* ---------- UP Row ---------- */
        .bfm-up {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 14px;
          transition: background var(--bfm-dur);
        }
        .bfm-up:hover { background: var(--bfm-bg-alt); }
        .bfm-up img {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          flex-shrink: 0;
          background: var(--bfm-bg-alt);
          object-fit: cover;
        }
        .bfm-up-name {
          flex: 1;
          font-size: 13px;
          font-weight: 500;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .bfm-up-meta {
          font-size: 11.5px;
          color: var(--bfm-text-3);
          font-variant-numeric: tabular-nums;
        }
        .bfm-up-meta.bfm-inactive {
          color: var(--bfm-accent);
          font-weight: 600;
        }

        /* 新动态红点 */
        .bfm-new-dot {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: var(--bfm-accent);
          margin-left: 6px;
          flex-shrink: 0;
          box-shadow: 0 0 0 2px rgba(251, 114, 153, .25);
          animation: bfm-new-pulse 2s var(--bfm-ease) infinite;
        }
        @keyframes bfm-new-pulse {
          0%, 100% { box-shadow: 0 0 0 2px rgba(251, 114, 153, .25); transform: scale(1); }
          50%      { box-shadow: 0 0 0 5px rgba(251, 114, 153, .10); transform: scale(1.15); }
        }

        /* 标星按钮（特别关注） */
        .bfm-star-btn {
          background: transparent;
          border: none;
          cursor: pointer;
          font-size: 16px;
          line-height: 1;
          padding: 4px 6px;
          color: var(--bfm-text-3);
          transition: transform 120ms var(--bfm-ease), color 120ms var(--bfm-ease);
          flex-shrink: 0;
        }
        .bfm-star-btn:hover { transform: scale(1.2); color: var(--bfm-warning); }
        .bfm-star-btn.is-starred { color: var(--bfm-warning); }

        /* ---------- Tag (group label) ---------- */
        .bfm-tag {
          display: inline-flex;
          align-items: center;
          gap: 3px;
          padding: 2px 8px;
          background: var(--bfm-primary-soft);
          color: var(--bfm-primary-press);
          border-radius: var(--bfm-r-pill);
          font-size: 10.5px;
          font-weight: 600;
          letter-spacing: .02em;
        }

        /* ---------- Footer ---------- */
        .bfm-foot {
          padding: 12px 22px;
          border-top: 1px solid var(--bfm-border);
          font-size: 11.5px;
          color: var(--bfm-text-3);
          display: flex;
          gap: 8px;
          align-items: center;
          background: var(--bfm-bg);
        }
        .bfm-foot b {
          color: var(--bfm-text);
          font-variant-numeric: tabular-nums;
          font-weight: 600;
        }

        /* ---------- Action Bar ---------- */
        .bfm-actionbar {
          padding: 12px 22px 16px;
          display: flex;
          gap: 8px;
          border-top: 1px solid var(--bfm-border);
          background: var(--bfm-bg);
        }
        .bfm-actionbar .bfm-btn { flex: 1; justify-content: center; padding: 9px 12px; }
        .bfm-actionbar .bfm-btn-icon { flex: 0 0 38px; }

        /* ---------- Progress ---------- */
        .bfm-progress {
          padding: 10px 22px;
          background: var(--bfm-bg-alt);
          border-bottom: 1px solid var(--bfm-border);
          font-size: 12px;
          color: var(--bfm-text-2);
        }
        .bfm-progress-bar {
          height: 3px;
          background: rgba(0, 174, 236, .15);
          border-radius: 2px;
          margin-top: 8px;
          overflow: hidden;
          position: relative;
        }
        .bfm-progress-bar > div {
          position: absolute;
          inset: 0 auto 0 0;
          background: linear-gradient(90deg, #00aeec 0%, #fb7299 100%);
          border-radius: 2px;
          transition: width 300ms var(--bfm-ease);
        }

        /* ---------- Modal ---------- */
        .bfm-modal-mask {
          position: fixed;
          inset: 0;
          background: rgba(15, 23, 42, .55);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          z-index: 10001;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          pointer-events: auto;
          animation: bfm-fade-in 200ms var(--bfm-ease);
        }
        @keyframes bfm-fade-in { from { opacity: 0; } to { opacity: 1; } }
        .bfm-modal {
          background: var(--bfm-bg);
          border-radius: var(--bfm-r-lg);
          min-width: 360px;
          max-width: 90vw;
          max-height: 80vh;
          overflow: auto;
          padding: 22px 24px;
          box-shadow: var(--bfm-sh-lg);
          display: flex;
          flex-direction: column;
          animation: bfm-modal-in 280ms var(--bfm-spring);
        }
        @keyframes bfm-modal-in {
          from { opacity: 0; transform: translateY(8px) scale(.96); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        .bfm-modal h3 {
          margin: 0 0 16px;
          font-size: 16px;
          font-weight: 600;
          letter-spacing: -.01em;
        }
        .bfm-modal input,
        .bfm-modal select {
          width: 100%;
          padding: 9px 12px;
          border: 1px solid var(--bfm-border);
          border-radius: var(--bfm-r-sm);
          font-size: 13.5px;
          box-sizing: border-box;
          background: var(--bfm-bg);
          color: var(--bfm-text);
          transition: border-color var(--bfm-dur), box-shadow var(--bfm-dur);
          font-family: inherit;
        }
        .bfm-modal input:focus,
        .bfm-modal select:focus {
          outline: none;
          border-color: var(--bfm-primary);
          box-shadow: 0 0 0 3px var(--bfm-primary-soft);
        }
        .bfm-modal label {
          display: inline-block;
          font-size: 12px;
          color: var(--bfm-text-2);
          margin-bottom: 5px;
          font-weight: 500;
        }
        .bfm-modal-actions {
          margin-top: 18px;
          display: flex;
          gap: 8px;
          justify-content: flex-end;
        }
        .bfm-modal-note {
          font-size: 11.5px;
          color: var(--bfm-text-3);
          margin-top: 4px;
          line-height: 1.5;
        }

        /* AI suggestion row */
        .bfm-sug-row {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 9px 12px;
          border-bottom: 1px solid var(--bfm-border);
          cursor: pointer;
          transition: background var(--bfm-dur);
        }
        .bfm-sug-row:hover { background: var(--bfm-bg-alt); }
        .bfm-sug-row:last-child { border-bottom: none; }
        .bfm-sug-row input[type="checkbox"] {
          width: 16px; height: 16px;
          accent-color: var(--bfm-primary);
        }
        .bfm-sug-row > span:nth-child(2) { flex: 1; font-size: 13px; }

        .bfm-tag-pill {
          padding: 3px 10px;
          border-radius: var(--bfm-r-pill);
          font-size: 11px;
          font-weight: 600;
          background: var(--bfm-primary);
          color: #fff;
          white-space: nowrap;
        }
        .bfm-tag-pill.bfm-tag-new {
          background: var(--bfm-accent);
        }
        .bfm-sug-reason {
          font-size: 11.5px;
          color: var(--bfm-text-3);
          max-width: 200px;
          text-align: right;
          line-height: 1.4;
        }

        /* Profile tag cloud */
        .bfm-tag-cloud {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 8px;
        }
        .bfm-tag-cloud span {
          background: var(--bfm-primary);
          color: #fff;
          padding: 5px 12px;
          border-radius: var(--bfm-r-pill);
          font-size: 12px;
          font-weight: 500;
        }
        .bfm-tag-cloud.bfm-tag-warn span {
          background: var(--bfm-accent);
        }

        /* Original page styles */
        .bfm-hidden-by-group { display: none !important; }
        .bfm-check { position: absolute; top: 8px; left: 8px; width: 18px; height: 18px; cursor: pointer; z-index: 2; accent-color: var(--bfm-primary); }

        /* ---------- a11y: focus visible ---------- */
        /* 键盘焦点显示清晰环，鼠标点击不显示 */
        :focus { outline: none; }
        :focus-visible {
          outline: 2px solid var(--bfm-primary);
          outline-offset: 2px;
          border-radius: 4px;
        }
        .bfm-btn:focus-visible {
          outline-offset: 2px;
        }
        /* 关闭按钮需显著 */
        .bfm-modal:focus-visible {
          outline: none;
        }

        /* ---------- a11y: prefers-reduced-motion ---------- */
        @media (prefers-reduced-motion: reduce) {
          .bfm-fab, .bfm-panel, .bfm-modal, .bfm-modal-mask,
          .bfm-new-dot, .bfm-star-btn, .bfm-btn {
            animation: none !important;
            transition: none !important;
          }
          .bfm-new-dot { animation: none !important; }
        }

        /* Dark mode (system) */
        @media (prefers-color-scheme: dark) {
          :host {
            --bfm-bg: #1a1b1f;
            --bfm-bg-alt: #25262b;
            --bfm-bg-hover: #2d2e34;
            --bfm-border: #2e2f35;
            --bfm-border-strong: #3e3f47;
            --bfm-text: #e8e8e8;
            --bfm-text-2: #a8aab0;
            --bfm-text-3: #6e7079;
            --bfm-primary-soft: rgba(0, 174, 236, .14);
            --bfm-accent-soft: rgba(251, 114, 153, .14);
            --bfm-sh-sm: 0 1px 2px rgba(0,0,0,.3);
            --bfm-sh-md: 0 4px 12px -2px rgba(0,0,0,.4), 0 1px 2px rgba(0,0,0,.3);
            --bfm-sh-lg: 0 16px 32px -8px rgba(0,0,0,.5), 0 4px 8px rgba(0,0,0,.3);
          }
          .bfm-modal-mask { background: rgba(0,0,0,.7); }
        }
      `;
      // 原页面需要 bfm-hidden-by-group / bfm-check 样式（注入到 document）
      GM_addStyle(`
        .bfm-hidden-by-group { display: none !important; }
        .bfm-check { position: absolute; top: 8px; left: 8px; width: 18px; height: 18px; cursor: pointer; z-index: 2; }
      `);

      // 创建 Shadow DOM host（B 站检测代码看不到 shadow 内部）
      // host 用 display:contents 不产生盒子，shadow 内 fixed 元素自然相对视口定位
      this.shadowHost = document.createElement('div');
      this.shadowHost.id = 'bfm-shadow-host';
      this.shadowHost.style.cssText = 'all:initial;display:contents;color-scheme:light dark';
      document.documentElement.appendChild(this.shadowHost);
      this.shadow = this.shadowHost.attachShadow({ mode: 'open', delegatesFocus: true });

      // 样式注入到 shadow 内（FAB/面板/弹窗）
      const styleEl = document.createElement('style');
      styleEl.textContent = CSS;
      this.shadow.appendChild(styleEl);

      // FAB 按钮 — 放回 Shadow DOM 躲 B 站反广告检测
      // host 用 display:contents 不产生盒子，shadow 内 fixed 元素自然相对视口定位
      this.btnEl = document.createElement('button');
      this.btnEl.className = 'bfm-fab';
      this.btnEl.innerHTML = this.icons.tv;
      this.btnEl.title = 'B 站关注管理';
      this.btnEl.addEventListener('click', () => this.toggle());
      this.shadow.appendChild(this.btnEl);

      // 跟随深色模式
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.classList.add('bfm-dark');
      }

      // 菜单命令
      try {
        GM_registerMenuCommand('打开管理面板', () => this.openPanel());
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

      // 把 shadow 引用传给注入模块，让它们也躲 B 站检测
      injectFollowPage.shadow = this.shadow;
      injectDynamicPage.shadow = this.shadow;

      // 自动首次同步（如有缓存则跳过）
      this.maybeFirstRun();
    },

    async maybeFirstRun() {
      const s = storage.state;
      const oneWeek = 7 * 86400000;
      // 仅在从未同步过（或数据为空超过一周）时自动同步；
      // 静默失败，不弹 alert，避免干扰浏览
      let needRefreshInactive = false;
      if (!s.lastSync || (Date.now() - s.lastSync > oneWeek && Object.keys(s.following).length === 0)) {
        await utils._sleep(500);
        try {
          await sync.fullSync();
          needRefreshInactive = true;  // 首次同步后顺手刷一次活跃度
          this.render();
        } catch (e) {
          utils.warn('自动同步失败（可忽略，稍后手动同步）', e.message || e);
        }
      } else if (Object.keys(s.following).length > 0 && !s.lastInactiveRefresh) {
        // 有数据但从未刷过活跃度 → 也自动刷一次（修 v0.6 之前的 (1845) bug）
        needRefreshInactive = true;
      }

      if (needRefreshInactive) {
        await utils._sleep(800);
        try {
          this.updateProgress?.('首次使用：检测活跃度（首次会等几分钟）');
          await sync.refreshInactive();
          storage.patch({ lastInactiveRefresh: Date.now() });
          this.clearProgress?.();
          this.render();
        } catch (e) {
          utils.warn('首次活跃度检测失败', e.message || e);
        }
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
          <div class="bfm-brand">${this.icons.tv}</div>
          <div class="bfm-title">
            关注管理
            <small>Following Manager</small>
          </div>
          <button class="bfm-btn bfm-btn-icon bfm-btn-ghost" data-act="close" title="关闭">${this.icons.close}</button>
        </div>
        <div class="bfm-progress" style="display:none"></div>
        <div class="bfm-tabs">
          <div class="bfm-tabs-wrap">
            <div class="bfm-tab bfm-active" data-view="groups">分组</div>
            <div class="bfm-tab" data-view="inactive">死粉</div>
            <div class="bfm-tab" data-view="settings">设置</div>
          </div>
        </div>
        <div class="bfm-body"></div>
        <div class="bfm-foot">
          <span>共 <b data-foot-count>0</b> 位关注</span>
          <span style="flex:1"></span>
          <span data-foot-sync>尚未同步</span>
        </div>
        <div class="bfm-actionbar">
          <button class="bfm-btn" data-act="sync" title="同步关注列表">${this.icons.refresh}<span>同步</span></button>
          <button class="bfm-btn" data-act="inactive" title="刷新活跃度">${this.icons.refresh}<span>活跃度</span></button>
          <button class="bfm-btn bfm-btn-primary" data-act="ai-group" title="AI 智能分组">${this.icons.spark}<span>AI 分组</span></button>
          <button class="bfm-btn" data-act="export" title="导出备份">${this.icons.download}</button>
          <button class="bfm-btn" data-act="import" title="导入备份">${this.icons.upload}</button>
        </div>
      `;
      // shadowHost 已在 mount() 时挂到 document.documentElement，这里不再动它
      this.panelEl.style.pointerEvents = 'auto';
      this.shadow.appendChild(this.panelEl);

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

    // 读取 AI 推断的疑似误关注（7 天内有效，过期清掉）
    _loadAiOutliers() {
      const data = storage.state.aiOutliers;
      if (!data || !data.items?.length) return [];
      const SEVEN_DAYS = 7 * 86400 * 1000;
      if (Date.now() - (data.updatedAt || 0) > SEVEN_DAYS) {
        storage.state.aiOutliers = null;
        storage.save();
        return [];
      }
      // 只保留仍然在关注列表里的 mid
      return data.items.filter(o => o.mid && storage.state.following[o.mid]);
    },

    // 给 AI outlier 分 3 类
    _classifyOutlier(name, u) {
      if (/已注销|账号已注销/.test(name || '')) {
        return { label: '已注销', color: '#94a3b8' };
      }
      const days = utils.daysSince(u.lastActive);
      if (days > 365) {
        return { label: '永久停更', color: '#ef4444' };
      }
      // 其余：内容变质/疑似误关注
      return { label: '内容变质', color: '#fb7299' };
    },

    renderInactive(body) {
      const dead = storage.getInactiveCandidates();
      const undetected = storage.getUndetected();
      const threshold = storage.state.settings.inactiveThresholdDays;

      if (!dead.length && !undetected.length) {
        body.innerHTML = `<div class="bfm-empty">暂无死粉<br><br>所有关注的 UP 主都活跃</div>`;
        return;
      }

      // 死粉行：带勾选 + 标星 + 取关 + 新动态红点
      const lastSeenMap = storage.state.lastSeen || {};
      const renderDeadUp = u => {
        const hasNew = utils.hasNewDynamic(u, lastSeenMap);
        const starred = !!u.starred;
        return `
        <div class="bfm-up" data-mid="${u.mid}">
          <input type="checkbox" class="bfm-dead-cb" data-mid="${u.mid}" style="width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:var(--bfm-primary)">
          <button class="bfm-star-btn ${starred ? 'is-starred' : ''}" data-mid="${u.mid}" title="${starred ? '取消特别关注' : '标为特别关注'}">
            ${starred ? '★' : '☆'}
          </button>
          <img src="${utils.esc(u.face)}" loading="lazy">
          <div class="bfm-up-name">${utils.esc(u.uname)}${hasNew ? '<span class="bfm-new-dot" title="有新动态"></span>' : ''}</div>
          <span class="bfm-up-meta bfm-inactive">${utils.formatDays(utils.daysSince(u.lastActive))}</span>
          <button class="bfm-btn bfm-btn-ghost bfm-btn-icon bfm-unfollow-one" data-mid="${u.mid}" title="取关">取关</button>
          <a class="bfm-btn bfm-btn-ghost bfm-btn-icon" href="https://space.bilibili.com/${u.mid}" target="_blank" title="查看空间">↗</a>
        </div>
      `;
      };

      const renderUndetectedUp = u => {
        const hasNew = utils.hasNewDynamic(u, lastSeenMap);
        return `
        <div class="bfm-up">
          <img src="${utils.esc(u.face)}" loading="lazy">
          <div class="bfm-up-name">${utils.esc(u.uname)}${hasNew ? '<span class="bfm-new-dot" title="有新动态"></span>' : ''}</div>
          <span class="bfm-up-meta">未检测</span>
          <a class="bfm-btn bfm-btn-ghost bfm-btn-icon" href="https://space.bilibili.com/${u.mid}" target="_blank" title="查看空间">↗</a>
        </div>
      `;
      };

      let html = '';
      if (dead.length) {
        // 区分：特别关注 vs 普通关注
        const starred = dead.filter(u => u.starred);
        const normal = dead.filter(u => !u.starred);
        const starredCount = starred.length;
        const normalCount = normal.length;
        // "只看特别关注" toggle 状态：默认 false（看全部）
        this._starredOnly = this._starredOnly || false;
        const visibleDead = this._starredOnly ? starred : dead;

        html += `
          <div class="bfm-section-title">超过 ${threshold} 天未更新 (${dead.length})</div>
          <div id="bfm-dead-toolbar" style="display:flex;gap:8px;align-items:center;margin-bottom:10px;padding:8px 12px;background:var(--bfm-bg-alt);border-radius:var(--bfm-r-md);flex-wrap:wrap">
            <button class="bfm-btn" id="bfm-select-all">全选</button>
            <button class="bfm-btn" id="bfm-select-none">清空</button>
            <span style="flex:1;color:var(--bfm-text-2);font-size:12px">已选 <b id="bfm-selected-count" style="color:var(--bfm-text)">0</b> / ${visibleDead.length}</span>
            <button class="bfm-btn ${this._starredOnly ? 'bfm-btn-primary' : ''}" id="bfm-starred-only" title="只看特别关注">
              ⭐ ${starredCount}
            </button>
            <button class="bfm-btn bfm-btn-danger" id="bfm-batch-unfollow" disabled style="opacity:.5">取关</button>
          </div>
          ${visibleDead.length === 0
            ? `<div class="bfm-empty">${this._starredOnly ? '没有特别关注的死粉' : '没有死粉'}</div>`
            : visibleDead.map(renderDeadUp).join('')}
        `;
      }
      if (undetected.length) {
        html += `
          <div class="bfm-section-title">尚未检测活跃度 (${undetected.length})</div>
          <div class="bfm-modal-note" style="margin-bottom:8px">
            这些 UP 主还没有最新视频时间数据。<br>
            点击下方按钮或顶栏"活跃度"刷新（约 ${Math.ceil(undetected.length * 0.2)} 秒）。
          </div>
          <button class="bfm-btn bfm-btn-primary" id="bfm-refresh-undetected" style="width:100%">
            一键刷新 ${undetected.length} 位 UP 主的活跃度
          </button>
          ${undetected.slice(0, 50).map(renderUndetectedUp).join('')}
          ${undetected.length > 50 ? `<div class="bfm-empty" style="padding:8px">还有 ${undetected.length - 50} 个未显示</div>` : ''}
        `;
      }

      // ===== 第三段：AI 推断的"可能误关注" =====
      const aiOutliers = this._loadAiOutliers();
      if (aiOutliers.length) {
        const renderOutlier = o => {
          // AI outliers 可能不在 storage.state.following 里（AI 推断但用户没关注过？）
          // 但通常应该在 following 里。这里 fallback：构造最小对象
          const u = storage.state.following[o.mid] || {
            mid: o.mid,
            uname: o.name,
            face: '',
            lastActive: 0,
            dynamic_ts: 0,
          };
          const cat = this._classifyOutlier(o.name, u);
          return `
        <div class="bfm-up" data-mid="${u.mid}">
          <input type="checkbox" class="bfm-outlier-cb" data-mid="${u.mid}" style="width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:var(--bfm-primary)">
          <button class="bfm-star-btn" data-mid="${u.mid}" title="标为特别关注">${u.starred ? '★' : '☆'}</button>
          ${u.face ? `<img src="${utils.esc(u.face)}" loading="lazy">` : '<div style="width:32px;height:32px;flex-shrink:0"></div>'}
          <div class="bfm-up-name">${utils.esc(u.uname)}</div>
          <span class="bfm-tag-pill" style="background:${cat.color}">${cat.label}</span>
          <button class="bfm-btn bfm-btn-ghost bfm-btn-icon bfm-outlier-unfollow-one" data-mid="${u.mid}" title="取关">取关</button>
          <a class="bfm-btn bfm-btn-ghost bfm-btn-icon" href="https://space.bilibili.com/${u.mid}" target="_blank" title="查看空间">↗</a>
        </div>
          `;
        };
        html += `
          <div class="bfm-section-title">可能误关注 (AI 推断) (${aiOutliers.length})${this._starredOnly ? '' : ''}</div>
          <div class="bfm-modal-note" style="margin-bottom:8px">
            AI 画像分析判定为不符合你兴趣的 UP 主（${Math.round((Date.now() - storage.state.aiOutliers.updatedAt) / 86400000)} 天前分析）。
            <button class="bfm-btn bfm-btn-ghost" id="bfm-clear-outliers" style="padding:2px 8px;font-size:11px;margin-left:8px">清除</button>
          </div>
          <div id="bfm-outlier-toolbar" style="display:flex;gap:8px;align-items:center;margin-bottom:10px;padding:8px 12px;background:var(--bfm-bg-alt);border-radius:var(--bfm-r-md)">
            <button class="bfm-btn" id="bfm-outlier-all">全选</button>
            <button class="bfm-btn" id="bfm-outlier-none">清空</button>
            <span style="flex:1;color:var(--bfm-text-2);font-size:12px">已选 <b id="bfm-outlier-count">0</b></span>
            <button class="bfm-btn bfm-btn-danger" id="bfm-outlier-batch-unfollow" disabled style="opacity:.5">取关</button>
          </div>
          ${aiOutliers.map(renderOutlier).join('')}
        `;
      }
      body.innerHTML = html;

      const refreshBtn = body.querySelector('#bfm-refresh-undetected');
      if (refreshBtn) refreshBtn.addEventListener('click', () => this.runInactiveRefresh());

      // 死粉区交互
      if (dead.length) {
        const checkboxes = body.querySelectorAll('.bfm-dead-cb');
        const countEl = body.querySelector('#bfm-selected-count');
        const unfollowBtn = body.querySelector('#bfm-batch-unfollow');
        const updateCount = () => {
          const n = body.querySelectorAll('.bfm-dead-cb:checked').length;
          countEl.textContent = n;
          unfollowBtn.disabled = n === 0;
          unfollowBtn.style.opacity = n === 0 ? '.5' : '1';
        };
        checkboxes.forEach(cb => cb.addEventListener('change', updateCount));

        body.querySelector('#bfm-select-all').addEventListener('click', () => {
          checkboxes.forEach(cb => cb.checked = true);
          updateCount();
        });
        body.querySelector('#bfm-select-none').addEventListener('click', () => {
          checkboxes.forEach(cb => cb.checked = false);
          updateCount();
        });
        unfollowBtn.addEventListener('click', () => {
          const mids = Array.from(body.querySelectorAll('.bfm-dead-cb:checked'))
            .map(cb => Number(cb.dataset.mid));
          this.runBatchUnfollow(mids);
        });

        // 单行取关按钮
        body.querySelectorAll('.bfm-unfollow-one').forEach(btn => {
          btn.addEventListener('click', () => {
            const mid = Number(btn.dataset.mid);
            this.runBatchUnfollow([mid]);
          });
        });

        // ⭐ 标星/取消标星
        body.querySelectorAll('.bfm-star-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            const mid = Number(btn.dataset.mid);
            if (!storage.state.following[mid]) return;
            const cur = !!storage.state.following[mid].starred;
            storage.state.following[mid].starred = !cur;
            storage.save();
            // 立即更新 UI（不重渲染整个列表，避免丢失勾选状态）
            btn.classList.toggle('is-starred', !cur);
            btn.textContent = !cur ? '★' : '☆';
            btn.title = !cur ? '取消特别关注' : '标为特别关注';
            // 更新顶部 "⭐ N" 计数
            this.render();
          });
        });

        // "只看特别关注" 切换
        const starredToggle = body.querySelector('#bfm-starred-only');
        if (starredToggle) {
          starredToggle.addEventListener('click', () => {
            this._starredOnly = !this._starredOnly;
            this.render();
          });
        }
      }

      // ===== AI outliers 段交互 =====
      const outlierCbs = body.querySelectorAll('.bfm-outlier-cb');
      if (outlierCbs.length) {
        const countEl = body.querySelector('#bfm-outlier-count');
        const batchBtn = body.querySelector('#bfm-outlier-batch-unfollow');
        const updateOutlierCount = () => {
          const n = body.querySelectorAll('.bfm-outlier-cb:checked').length;
          if (countEl) countEl.textContent = n;
          if (batchBtn) {
            batchBtn.disabled = n === 0;
            batchBtn.style.opacity = n === 0 ? '.5' : '1';
          }
        };
        outlierCbs.forEach(cb => cb.addEventListener('change', updateOutlierCount));
        const allBtn = body.querySelector('#bfm-outlier-all');
        const noneBtn = body.querySelector('#bfm-outlier-none');
        if (allBtn) allBtn.addEventListener('click', () => {
          outlierCbs.forEach(cb => cb.checked = true);
          updateOutlierCount();
        });
        if (noneBtn) noneBtn.addEventListener('click', () => {
          outlierCbs.forEach(cb => cb.checked = false);
          updateOutlierCount();
        });
        if (batchBtn) batchBtn.addEventListener('click', () => {
          const mids = Array.from(body.querySelectorAll('.bfm-outlier-cb:checked'))
            .map(cb => Number(cb.dataset.mid)).filter(Boolean);
          this.runBatchUnfollow(mids);
        });
        body.querySelectorAll('.bfm-outlier-unfollow-one').forEach(btn => {
          btn.addEventListener('click', () => {
            this.runBatchUnfollow([Number(btn.dataset.mid)]);
          });
        });

        // "清除"按钮：用户认为 AI 推断不准时
        const clearBtn = body.querySelector('#bfm-clear-outliers');
        if (clearBtn) clearBtn.addEventListener('click', () => {
          if (confirm('清除 AI 推断列表？下次跑 AI 画像分析会重新生成。')) {
            storage.state.aiOutliers = null;
            storage.save();
            this.render();
          }
        });

        // AI outliers 行里也要支持 ⭐ 标星（用户看了发现"其实这个我关心"）
        body.querySelectorAll('#bfm-outlier-toolbar ~ .bfm-up .bfm-star-btn, [class="bfm-section-title"]:not([class*="starred"]) ~ .bfm-up .bfm-star-btn')
          .forEach(btn => {
            btn.addEventListener('click', () => {
              const mid = Number(btn.dataset.mid);
              if (!storage.state.following[mid]) return;
              const cur = !!storage.state.following[mid].starred;
              storage.state.following[mid].starred = !cur;
              storage.save();
              btn.classList.toggle('is-starred', !cur);
              btn.textContent = !cur ? '★' : '☆';
              btn.title = !cur ? '取消特别关注' : '标为特别关注';
            });
          });
      }

      // 通用：点击 UP 名字 / 头像链接 → 记录 lastSeen（用于消除红点）
      // 注意：取关按钮和 checkbox 不能算"看过"
      body.querySelectorAll('.bfm-up a[href*="space.bilibili.com"]').forEach(a => {
        a.addEventListener('click', () => {
          const mid = Number(a.href.match(/space\.bilibili\.com\/(\d+)/)?.[1]);
          if (!mid) return;
          if (!storage.state.lastSeen) storage.state.lastSeen = {};
          storage.state.lastSeen[mid] = Date.now();
          storage.save();
          // 立即移除红点（不必等下次 render）
          const dot = a.closest('.bfm-up')?.querySelector('.bfm-new-dot');
          if (dot) dot.remove();
        });
      });

      // "全部已读"按钮（如果有红点的行）
      if (body.querySelectorAll('.bfm-new-dot').length > 0) {
        // 把这条工具条插到顶部（覆盖整个渲染的最前）
        const markAllReadBtn = document.createElement('button');
        markAllReadBtn.className = 'bfm-btn bfm-btn-ghost';
        markAllReadBtn.style.cssText = 'width:100%;margin-bottom:8px';
        markAllReadBtn.textContent = '✓ 全部标记为已读';
        markAllReadBtn.addEventListener('click', () => {
          const now = Date.now();
          if (!storage.state.lastSeen) storage.state.lastSeen = {};
          for (const u of [...dead, ...undetected]) {
            if (utils.hasNewDynamic(u, storage.state.lastSeen)) {
              storage.state.lastSeen[u.mid] = now;
            }
          }
          storage.save();
          this.render();
        });
        body.prepend(markAllReadBtn);
      }
    },

    /**
     * 批量取关：先弹确认框 → 用户确认后逐个调用 api.unfollow → 完成后刷新
     * @param {number[]} mids
     */
    async runBatchUnfollow(mids) {
      if (!mids.length) return;
      const items = mids
        .map(mid => storage.state.following[mid])
        .filter(Boolean);
      if (!items.length) return;

      const triggerEl = document.activeElement; // 用于关闭后焦点返回

      // 用无障碍 helper 创建确认对话框（自动 ARIA + Escape + focus trap）
      const preview = items.slice(0, 10)
        .map(u => `<li>${utils.esc(u.uname)}</li>`).join('');
      const more = items.length > 10 ? `<li style="color:var(--bfm-text-3)">…还有 ${items.length - 10} 位</li>` : '';
      const titleId = `bfm-confirm-${Date.now()}`;
      const { close, mask } = utils.createAccessibleModal({
        container: this.shadow,           // 显式挂到 shadow root（CSS 才会生效）
        trigger: triggerEl,
        titleId,
        alert: true,
        html: `
          <h3 id="${titleId}">确认取关 ${items.length} 位 UP 主？</h3>
          <div style="background:var(--bfm-bg-alt);border-radius:var(--bfm-r-sm);padding:10px 14px;margin:8px 0 4px;max-height:200px;overflow:auto">
            <ul style="margin:0;padding-left:18px;font-size:13px;color:var(--bfm-text-2)">
              ${preview}${more}
            </ul>
          </div>
          <div style="background:var(--bfm-accent-soft);color:var(--bfm-accent);padding:10px 12px;border-radius:var(--bfm-r-sm);font-size:12.5px;margin:8px 0">
            ⚠ 取关后需要手动重新关注，此操作不可撤销
          </div>
          <div class="bfm-modal-actions">
            <button class="bfm-btn" data-act="cancel">取消</button>
            <button class="bfm-btn bfm-btn-danger" data-act="confirm">确认取关 ${items.length} 位</button>
          </div>
        `,
      });

      const confirmed = await new Promise(resolve => {
        mask.querySelector('[data-act="cancel"]').addEventListener('click', () => { close(); resolve(false); });
        mask.querySelector('[data-act="confirm"]').addEventListener('click', () => { close(); resolve(true); });
      });
      if (!confirmed) return;

      // 执行批量取关
      let ok = 0, fail = 0;
      const total = items.length;
      this.updateProgress?.(`批量取关 0/${total}`);
      for (let i = 0; i < items.length; i++) {
        // v0.10.5：每条 windGuard（api.unfollow 已埋点；这里避免双计只做自适应 sleep）
        await utils.windGuard();
        try {
          await api.unfollow(items[i].mid);
          // 立即从本地存储移除（即使 API 失败也不影响显示）
          delete storage.state.following[items[i].mid];
          ok++;
        } catch (e) {
          utils.warn('unfollow failed', items[i].mid, e.message);
          fail++;
        }
        this.updateProgress?.(`批量取关 ${i + 1}/${total}`);
      }
      storage.save();
      this.clearProgress?.();
      this.render();
      alert(`完成：成功取关 ${ok} 位，失败 ${fail} 位${fail ? '\n\n失败原因可能是：\n• 风控（请 5 分钟后重试）\n• 登录态失效（请重新登录 B 站）' : ''}`);
    },

    renderSettings(body) {
      const s = storage.state.settings;
      const lc = llm.getConfig();
      // v0.10.5：风控日历状态（先算 status，red 时模板顶部塞 warning 条）
      const ws = utils.windStatus();
      const wColor = { green: '#10b981', yellow: '#f59e0b', orange: '#f97316', red: '#ef4444' }[ws.level];
      const wEmoji = { green: '🟢', yellow: '🟡', orange: '🟠', red: '🔴' }[ws.level];
      const wLabel = { green: '健康', yellow: '轻度风险', orange: '高度风险', red: '极限' }[ws.level];
      const wTime = ws.lastRiskAgeMin == null
        ? '（从未触发）'
        : ws.lastRiskAgeMin < 60
          ? `${ws.lastRiskAgeMin} 分钟前${ws.lastRiskAgeMin >= 30 ? '（恢复中）' : '（已恢复）'}`
          : `${Math.round(ws.lastRiskAgeMin / 60)} 小时前（已恢复）`;
      const redWarning = ws.level === 'red'
        ? '<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:6px;padding:10px 14px;margin:0 0 16px;color:#92400e;font-size:13px">'
          + '⚠ 账号写操作热度过高（' + ws.heat + '/100），建议 1 小时后再继续。</div>'
        : '';
      const wRecent = (utils.windLoad()?.records || [])
        .slice().sort((a, b) => b.ts - a.ts).slice(0, 10);
      const opLabelMap = { unfollow: '取关', 'tags/addUsers': '写分组', createGroup: '创建分组', 'tags/delUsers': '移除分组' };
      const resultColorMap = { ok: '#10b981', '-352': '#ef4444', '-412': '#f97316', '-101': '#888' };
      const recordsHtml = wRecent.length
        ? '<ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:var(--bfm-text-2)">'
          + wRecent.map(r => {
            const t = new Date(r.ts);
            const tStr = (t.getMonth() + 1) + '/' + t.getDate() + ' ' + String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
            const opL = opLabelMap[r.op] || r.op;
            const rc = resultColorMap[r.result] || '#888';
            return '<li>' + tStr + ' · ' + opL + ' ×' + r.count + ' · <span style="color:' + rc + '">' + r.result + '</span></li>';
          }).join('')
          + '</ul>'
        : '<div style="font-size:12px;color:var(--bfm-text-3);margin-top:4px">暂无记录</div>';
      body.innerHTML = `
        ${redWarning}
        <div class="bfm-section-title">基础设置</div>
        <div style="margin: 12px 0">
          <label>死粉阈值（天）：</label>
          <input id="bfm-threshold" type="number" min="7" max="3650" value="${s.inactiveThresholdDays}" style="padding:6px 10px;width:80px;border:1px solid #ddd;border-radius:4px">
          <button class="bfm-btn" id="bfm-save-threshold">保存</button>
        </div>

        <div class="bfm-section-title" style="margin-top:24px">LLM 配置（OpenAI 兼容）</div>
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
          <button class="bfm-btn" id="bfm-llm-profile">AI 画像分析</button>
        </div>

        <div class="bfm-section-title" style="margin-top:24px">账号写操作健康度</div>
        <div style="background:var(--bfm-bg-alt);border:1px solid var(--bfm-border);border-radius:6px;padding:12px 14px;font-size:13px;color:var(--bfm-text-2)">
          <div><span style="color:${wColor};font-weight:600">${wEmoji} ${wLabel}（热度 ${ws.heat}/100）</span></div>
          <div style="margin-top:6px;color:var(--bfm-text-3);font-size:12px">24h 内：取关 ${ws.totals24h.unfollow || 0} · 写操作 ${ws.totals24h.writeOps || 0}</div>
          <div style="margin-top:4px;color:var(--bfm-text-3);font-size:12px">上次 -352/-412：${wTime}</div>
          <details style="margin-top:8px">
            <summary style="cursor:pointer;color:var(--bfm-text);font-size:12px;user-select:none">查看最近 ${wRecent.length} 条记录 ▾</summary>
            ${recordsHtml}
          </details>
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
        this.render();
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
      const fullTargets = ungrouped.length ? ungrouped : list;

      // ===== 断点续传检查 =====
      let targets = fullTargets;
      let resumed = false;
      const ONE_DAY = 24 * 3600 * 1000;
      const existingJob = storage.state.aiJob;
      if (existingJob && existingJob.type === 'grouping'
          && existingJob.pendingMids?.length
          && Date.now() - (existingJob.lastUpdate || 0) < ONE_DAY) {
        const age = Math.round((Date.now() - existingJob.lastUpdate) / 60000);
        const resumeAns = confirm(
          `检测到上次 AI 分组中断：\n` +
          `• 已收集 ${(existingJob.collected || []).length} 条建议\n` +
          `• 失败 ${(existingJob.failed || []).length} 位\n` +
          `• 剩余 ${existingJob.pendingMids.length} 位待分析\n` +
          `• 上次更新 ${age} 分钟前\n\n` +
          `继续处理剩余的？\n（确定=继续 / 取消=从头开始）`
        );
        if (resumeAns) {
          // 按 mid 还原 UP 主对象（可能被取关/重新同步）
          const midSet = new Set(fullTargets.map(u => u.mid));
          const midToUser = new Map(fullTargets.map(u => [u.mid, u]));
          targets = existingJob.pendingMids
            .map(m => midToUser.get(m))
            .filter(Boolean);
          // 只保留当前仍存在的 mid；不存在的从 checkpoint 删掉（已经取关）
          const aliveMids = new Set(targets.map(u => u.mid));
          if (existingJob.pendingMids.length !== targets.length) {
            existingJob.pendingMids = [...aliveMids];
            storage.save();
          }
          resumed = true;
          utils.log(`[BFM] 断点续传：恢复 ${targets.length} 位待分析`);
        } else {
          delete storage.state.aiJob;
          storage.save();
        }
      } else if (existingJob) {
        // 超过 1 天的进度作废
        delete storage.state.aiJob;
        storage.save();
      }

      if (!targets.length) {
        return alert('没有需要分析的 UP 主');
      }

      // 估算耗时（每批 10s 保守估计）
      const estSec = Math.ceil(targets.length / 30) * 10;
      if (!confirm(
        `将使用 AI 分析 ${targets.length} 位${ungrouped.length ? '未分组' : ''}UP 主并推荐分组${resumed ? '（续传）' : ''}。\n\n` +
        `预估 ${Math.ceil(targets.length / 30)} 次 API 调用，约 ${estSec} 秒\n` +
        `提示：\n• 单批超时 90s（自动跳过）\n• 可中途点停止按钮中断\n• 中断后下次可继续（断点续传）\n• 模型不保证准确，结果需人工确认\n\n继续？`
      )) return;

      // v0.10.4：BATCH 30→20。批越大模型越容易漏人/串人，准确率明显下降；
      // 批次变多后靠已有的断点续传保证可恢复。
      const BATCH = 20;
      const TOTAL_BATCH = Math.ceil(targets.length / BATCH);
      const suggestions = resumed ? (existingJob.collected || []).slice() : [];
      const failedMids = resumed ? (existingJob.failed || []).slice() : [];
      let stopped = false;

      // 暴露"停止"按钮到面板（点 FAB 或工具栏都能触发）
      this.abortCtrl = { stop: () => { stopped = true; } };

      // 初始化/恢复 aiJob checkpoint
      const aiJob = {
        type: 'grouping',
        startedAt: existingJob?.startedAt || Date.now(),
        pendingMids: targets.map(u => u.mid),
        collected: suggestions,
        failed: failedMids,
        lastUpdate: Date.now(),
      };
      storage.state.aiJob = aiJob;
      storage.save();

      this.btnEl?.classList.add('bfm-busy');
      const startTime = Date.now();

      for (let i = 0; i < targets.length; i += BATCH) {
        if (stopped) break;

        const batch = targets.slice(i, i + BATCH);
        const users = batch.map(u => ({
          mid: u.mid, uname: u.uname, sign: u.sign || u.lastTitle || '',
        }));
        const batchNo = Math.floor(i / BATCH) + 1;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        const avgPerBatch = batchNo > 1 ? (Date.now() - startTime) / batchNo / 1000 : 0;
        const remaining = Math.max(0, Math.ceil((TOTAL_BATCH - batchNo) * avgPerBatch));
        this.updateProgress?.(
          `AI 分组 第 ${batchNo}/${TOTAL_BATCH} 批（${Math.min(i + BATCH, targets.length)}/${targets.length}） · 已用 ${elapsed}s · 预计还需 ${remaining}s`
        );

        try {
          // 每批前重新拉一次现有分组（上一批可能新建了分组）
          const existing = storage.state.groups;
          const arr = await llm.suggestGrouping(users, existing, { timeout: 90_000 });
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
          // 不再 alert（中断流程），收集失败的 mid 留待重试
          for (const u of users) failedMids.push({ mid: u.mid, uname: u.uname, err: e.message });
        }

        // 每批结束：checkpoint 到 storage（防断电/崩溃丢失进度）
        aiJob.pendingMids = targets.slice(i + BATCH).map(u => u.mid);
        aiJob.collected = suggestions;
        aiJob.failed = failedMids;
        aiJob.lastUpdate = Date.now();
        try { storage.save(); } catch (e) { utils.warn('checkpoint save failed', e); }
      }

      this.btnEl?.classList.remove('bfm-busy');
      this.clearProgress?.();
      this.abortCtrl = null;

      // 汇总报告
      if (stopped) {
        // 保留 aiJob，下次可继续
        alert(
          `已停止。\n` +
          `已收集 ${suggestions.length} 条建议\n` +
          `失败 ${failedMids.length} 位\n` +
          `剩余 ${aiJob.pendingMids.length} 位待分析\n\n` +
          `下次点击"AI 分组"可继续。`
        );
      } else if (failedMids.length) {
        // 失败的有 aiJob 记录，下次会先重试这批
        alert(
          `完成 ${suggestions.length} 条建议\n` +
          `⚠ 失败 ${failedMids.length} 位（${failedMids.slice(0, 3).map(f => f.uname).join('、')}...）\n` +
          `原因：${failedMids[0]?.err || '未知'}\n\n` +
          `已保存进度（已含失败列表）。下次点 AI 分组会自动重试失败批。`
        );
      }

      if (!suggestions.length) return;

      // 任务完成，清除 aiJob
      delete storage.state.aiJob;
      storage.save();
      this._showAISuggestions(suggestions);
    },

    _showAISuggestions(suggestions) {
      // 弹窗展示建议，用户可勾选后应用
      const mask = document.createElement('div');
      mask.className = 'bfm-modal-mask';
      mask.innerHTML = `
        <div class="bfm-modal" style="min-width:560px;max-height:80vh;display:flex;flex-direction:column">
          <h3>AI 分组建议（共 ${suggestions.length} 条）</h3>
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
      // 弹窗挂到 shadow 而不是 body（躲 B 站检测）
      mask.style.pointerEvents = 'auto';
      (ui.shadow || document.body).appendChild(mask);

      mask.querySelector('[data-act="close"]').addEventListener('click', () => mask.remove());
      mask.querySelector('[data-act="apply"]').addEventListener('click', async () => {
        const checked = Array.from(mask.querySelectorAll('.bfm-sug-cb:checked')).map(cb => suggestions[Number(cb.dataset.idx)]);
        mask.remove();
        await this._applyAISuggestions(checked);
      });
    },

    async _applyAISuggestions(items) {
      if (!items.length) return alert('未选择任何项');

      // v0.10.3：规范化 groupName（去空格）— 避免"技术" vs " 技术 " 被判为不同
      const normalize = (s) => String(s || '').replace(/\s+/g, '').trim();
      for (const item of items) item.groupName = normalize(item.groupName);

      // 1. 按 groupName 分组
      const byGroup = new Map(); // groupName -> [mids]
      for (const item of items) {
        if (!byGroup.has(item.groupName)) byGroup.set(item.groupName, []);
        byGroup.get(item.groupName).push(item.mid);
      }

      // 2. 创建不存在的新分组（v0.10.3：记录每个分组的成败，不再 silently warn 后让用户看不到）
      const existingNames = new Set(storage.state.groups.map(g => normalize(g.name)));
      const toCreate = Array.from(byGroup.keys()).filter(n => !existingNames.has(n));
      const createResults = [];
      this.updateProgress?.(`创建 ${toCreate.length} 个新分组...`);
      for (const name of toCreate) {
        try {
          await api.createGroup(name);
          createResults.push({ name, ok: true });
        } catch (e) {
          // 单个失败不 throw（阻断其他分组），但要记录，汇总时报告
          createResults.push({ name, ok: false, err: e.message });
          utils.warn('create group failed', name, e.message);
        }
      }
      // 即使有失败也刷新缓存（成功的那部分要可见）
      if (createResults.length) {
        try {
          storage.state.groups = await api.listGroups();
        } catch (e) {
          utils.warn('listGroups failed after create', e.message);
        }
      }

      // 3. 批量加入分组（v0.10.3：精确 → 模糊 → 失败明细 三级降级）
      const failedMatches = [];   // 模型 groupName 找不到对应 B站分组
      const failedAdds = [];      // 加入分组 API 失败
      let applied = 0;
      for (const [name, mids] of byGroup) {
        // 3a. 精确匹配（normalize 后）
        let g = storage.state.groups.find(g => normalize(g.name) === name);
        // 3b. 模糊匹配：双向 includes（应对模型返回 "技术" 而 B站叫"技术开发" 的情况）
        if (!g) {
          g = storage.state.groups.find(g => {
            const a = normalize(g.name), b = name;
            return a && b && (a.includes(b) || b.includes(a));
          });
          if (g) utils.warn(`模糊匹配：模型建议"${name}" → 匹配到"${g.name}"`);
        }
        if (!g) {
          failedMatches.push({ name, midCount: mids.length });
          this.updateProgress?.(`分组匹配失败：${name} (${mids.length}人)`);
          continue;
        }
        try {
          await api.addUsersToGroup(g.tagid, mids);
          for (const mid of mids) {
            if (!storage.state.following[mid]) storage.state.following[mid] = { mid };
            const set = new Set(storage.state.following[mid].tagids || []);
            set.add(g.tagid);
            storage.state.following[mid].tagids = Array.from(set);
          }
          applied += mids.length;
        } catch (e) {
          utils.warn('add users failed', name, e.message);
          failedAdds.push({ name, midCount: mids.length, err: e.message });
        }
        this.updateProgress?.(`应用中 ${applied}/${items.length}`);
        // v0.10.4：跨分组写操作之间加 300ms 呼吸间隔（连续高频写极易触发 -352）
        await utils._sleep(300);
      }
      storage.save();
      this.clearProgress?.();
      this.render();

      // 4. 分类报告（v0.10.3：让用户知道到底哪步出问题）
      const lines = [`完成：成功分组 ${applied} 位 UP 主`];
      const failedCreates = createResults.filter(r => !r.ok);
      if (failedCreates.length) {
        lines.push(`\n⚠ 分组创建失败 ${failedCreates.length} 个：${failedCreates.slice(0, 3).map(f => `"${f.name}"`).join('、')}${failedCreates.length > 3 ? '...' : ''}`);
      }
      if (failedMatches.length) {
        lines.push(`\n⚠ 分组名找不到匹配 ${failedMatches.length} 个：${failedMatches.slice(0, 3).map(f => `"${f.name}"(${f.midCount}人)`).join('、')}${failedMatches.length > 3 ? '...' : ''}`);
        lines.push(`提示：可以手动建同名分组后再次应用`);
      }
      if (failedAdds.length) {
        lines.push(`\n⚠ 加入分组失败 ${failedAdds.length} 个：${failedAdds.slice(0, 3).map(f => `"${f.name}"(${f.err})`).join('、')}`);
      }
      alert(lines.join(''));
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

        // 持久化 outliers 到主面板（v0.10.0 新增）
        if (result.outliers && result.outliers.length) {
          const SEVEN_DAYS = 7 * 86400 * 1000;
          storage.state.aiOutliers = {
            items: result.outliers.map(o => {
              if (typeof o === 'string') return { mid: null, name: o };
              const mid = Number(o?.mid);
              return { mid: Number.isFinite(mid) && mid > 0 ? mid : null, name: String(o?.name || '') };
            }).filter(o => o.mid),
            updatedAt: Date.now(),
          };
          storage.save();
          utils.log(`[BFM] AI 推断 ${storage.state.aiOutliers.items.length} 位疑似误关注`);
        }

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
      // 兼容老 AI 输出格式（数组或对象）和新格式（[{mid, name}]）：
      // 老：`outliers: ["名字1", "名字2"]`
      // 新：`outliers: [{mid: 1, name: "名字1"}, ...]`
      const outliers = (result.outliers || []).map(o => {
        if (typeof o === 'string') return { mid: null, name: o };
        const mid = Number(o?.mid);
        return {
          mid: Number.isFinite(mid) && mid > 0 ? mid : null,
          name: String(o?.name || ''),
        };
      });
      const validOutliers = outliers.filter(o => o.mid);
      const outliersHtml = outliers.length === 0
        ? '<i style="color:#888">无</i>'
        : outliers.map(o => `
          <label style="display:flex;align-items:center;gap:8px;padding:6px 8px;border-bottom:1px dashed var(--bfm-border);cursor:pointer">
            <input type="checkbox" class="bfm-outlier-cb" data-mid="${o.mid || ''}" data-name="${utils.esc(o.name)}"
              ${o.mid ? '' : 'disabled title="AI 未返回 mid，需手动取关"'}
              style="width:16px;height:16px;accent-color:var(--bfm-primary)">
            <span style="flex:1;font-size:13px">${utils.esc(o.name)}</span>
            ${o.mid
              ? `<span style="font-size:11px;color:var(--bfm-text-3)">mid:${o.mid}</span>
                 <a class="bfm-btn bfm-btn-ghost bfm-btn-icon" href="https://space.bilibili.com/${o.mid}" target="_blank" title="查看空间">↗</a>`
              : '<span style="font-size:11px;color:var(--bfm-accent)">无 mid</span>'}
          </label>
        `).join('');
      mask.innerHTML = `
        <div class="bfm-modal" style="min-width:480px">
          <h3>你的关注画像</h3>
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
            ${outliersHtml}
          </div>
          <div class="bfm-modal-actions">
            <button class="bfm-btn" data-act="close">关闭</button>
            ${validOutliers.length ? `
              <button class="bfm-btn" id="bfm-outlier-select-all">全选</button>
              <span style="color:var(--bfm-text-2);font-size:12px">已选 <b id="bfm-outlier-count">0</b></span>
              <button class="bfm-btn bfm-btn-danger" id="bfm-outlier-unfollow" disabled style="opacity:.5">取消关注</button>
            ` : ''}
          </div>
        </div>
      `;
      mask.style.pointerEvents = 'auto';
      (ui.shadow || document.body).appendChild(mask);
      mask.querySelector('[data-act="close"]').addEventListener('click', () => mask.remove());

      if (validOutliers.length) {
        const checkboxes = mask.querySelectorAll('.bfm-outlier-cb:not([disabled])');
        const countEl = mask.querySelector('#bfm-outlier-count');
        const btn = mask.querySelector('#bfm-outlier-unfollow');
        const updateCount = () => {
          const n = mask.querySelectorAll('.bfm-outlier-cb:checked').length;
          countEl.textContent = n;
          btn.disabled = n === 0;
          btn.style.opacity = n === 0 ? '.5' : '1';
        };
        checkboxes.forEach(cb => cb.addEventListener('change', updateCount));
        mask.querySelector('#bfm-outlier-select-all').addEventListener('click', () => {
          checkboxes.forEach(cb => cb.checked = true);
          updateCount();
        });
        btn.addEventListener('click', async () => {
          const mids = Array.from(mask.querySelectorAll('.bfm-outlier-cb:checked'))
            .map(cb => Number(cb.dataset.mid))
            .filter(Boolean);
          mask.remove();
          await this.runBatchUnfollow(mids);
        });
      }
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

    // 选择器来源：B站关注数据分析插件（r007b34r）+ bilibili 批量取关（Nriver）
    // 这些是真实工作脚本使用并验证过的类名
    _containerSelector() {
      return '.follow-list, .relation-list, .follow-item-container, .relation-list-container, .be-scrollbar, ul.list-list';
    },
    _listSelector() {
      return '.follow-list .list-item, .relation-list .list-item, .follow-item, .bili-user-profile, [class*="user-card"], [class*="user-item"], ul.list-list li';
    },

    _waitForList() {
      return new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
          const list = document.querySelector(this._containerSelector());
          if (list) resolve();
          else if (++attempts < 30) setTimeout(check, 500);
          else {
            utils.warn('关注页选择器失效，请联系脚本作者更新');
            resolve();
          }
        };
        check();
        setTimeout(resolve, 10000);
      });
    },

    _observe() {
      const target = document.querySelector(this._containerSelector()) || document.body;
      this._observer = new MutationObserver(utils.debounce(() => this._enhanceCards(), 300));
      this._observer.observe(target, { childList: true, subtree: true });
    },

    _injectToolbar() {
      const bar = document.createElement('div');
      bar.id = 'bfm-follow-toolbar';
      bar.style.cssText = 'position:sticky;top:0;z-index:100;background:#00aeec;color:#fff;padding:8px 12px;display:flex;gap:8px;align-items:center;font-size:13px;border-radius:4px;margin-bottom:8px';
      bar.innerHTML = `
        <span><b>关注管理</b></span>
        <span style="flex:1"></span>
        <button id="bfm-batch-toggle" style="background:#fff;color:#00aeec;border:none;padding:6px 12px;border-radius:4px;cursor:pointer">开启批量</button>
        <button id="bfm-batch-assign" style="background:#fb7299;color:#fff;border:none;padding:6px 12px;border-radius:4px;cursor:pointer;display:none">将选中 (0) 加入分组</button>
        <button id="bfm-batch-remove" style="background:rgba(255,255,255,.2);color:#fff;border:1px solid #fff;padding:6px 12px;border-radius:4px;cursor:pointer;display:none">移出分组</button>
      `;
      const target = document.querySelector(this._containerSelector())?.parentElement;
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
      const cards = document.querySelectorAll(this._listSelector());
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
        const info = card.querySelector('.info, .fans-info, .list-item-info, .user-info');
        const name = card.querySelector('.fans-name, .list-item-name, .list-item__name, .bili-user-profile__name, [class*="name"]')?.textContent?.trim() || '';
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
    shadow: null,   // 从 ui 传入

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
        wrap.innerHTML = `<span style="color:var(--bfm-text-3);font-size:12px;margin-right:8px;font-weight:500">分组筛选</span>
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
      // 顶部提示（放 shadow 里，躲 B 站检测）
      let tip = this.shadow?.getElementById('bfm-filter-tip') || document.getElementById('bfm-filter-tip');
      if (!tip) {
        tip = document.createElement('div');
        tip.id = 'bfm-filter-tip';
        tip.style.cssText = 'position:fixed;top:8px;right:8px;background:#00aeec;color:#fff;padding:4px 10px;border-radius:14px;font-size:12px;z-index:9999;box-shadow:0 2px 6px rgba(0,0,0,.15);pointer-events:auto';
        (this.shadow || document.body).appendChild(tip);
      }
      const g = storage.state.groups.find(g => g.tagid === this.activeGroup);
      tip.textContent = `仅显示分组：${g?.name || ''}（已隐藏 ${hidden} 条）`;
    },
  };

  // ============================================================
  // 9. 入口
  // ============================================================
  function init() {
    try {
      storage.load();
      ui.mount();

      const path = location.pathname;
      if (path.includes('/fans/follow') || path.includes('/relation/follow')) {
        injectFollowPage.mount();
      } else if (location.host === 't.bilibili.com') {
        injectDynamicPage.mount();
      }

      // 暴露全局兜底入口：即使 FAB/菜单都失效，在 Console 输入 BFM.open() 也能用
      window.BFM = {
        open: () => ui.openPanel(),
        sync: () => ui.runSync(),
        inactive: () => ui.runInactiveRefresh(),
        export: () => ui.exportData(),
        import: () => ui.importData(),
        debug: () => ({
            fab: ui.shadow?.querySelector('.bfm-fab'),
            panel: ui.panelEl,
            shadow: ui.shadow,
            storage: storage.state,
            version: storage.state.version,
          }),
      };
    } catch (e) {
      // 任何初始化异常都要可见，避免"脚本没反应"又无从查起
      console.error('[BFM] 初始化失败:', e);
      try {
        const box = document.createElement('div');
        box.style.cssText = 'position:fixed;bottom:20px;left:20px;z-index:999999;background:#fb7299;color:#fff;padding:12px 16px;border-radius:8px;font-size:13px;font-family:monospace;max-width:80vw;box-shadow:0 4px 12px rgba(0,0,0,.3)';
        box.textContent = '[BFM] 初始化失败: ' + (e.message || e) + '（按 F12 看完整报错）';
        document.body.appendChild(box);
        setTimeout(() => box.remove(), 15000);
      } catch (_) { /* 忽略 */ }
    }
  }

  // 等待 DOM 就绪
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
