// ==UserScript==
// @name         B 站首页净化（Home Cleaner）
// @name:zh-CN   B 站首页净化
// @namespace    https://github.com/Franklinyung/bilibili-following-manager
// @version      0.2.0
// @description  隐藏首页轮播广告、"短视频"Tab；通过拦截 API 给每个视频卡片加上分类标签 + 顶部分类筛选条。独立脚本，与"关注列表管理"互不干扰。
// @description:zh-CN  隐藏首页轮播广告、"短视频"Tab；通过拦截 API 给每个视频卡片加上分类标签 + 顶部分类筛选条。独立脚本，与"关注列表管理"互不干扰。
// @author       Franklinyung
// @match        https://www.bilibili.com/*
// @match        https://www.bilibili.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @icon         https://www.bilibili.com/favicon.ico
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

/*
 * B 站首页净化 — 选择器规则
 *
 * 设计原则：
 *   - 不依赖具体 DOM 路径（脆弱），只用语义 class / id
 *   - 同一类规则给多个 fallback selector（容忍 B 站改版）
 *   - 默认开启的规则都是用户反馈最多的；激进的默认关
 *   - 全部 localStorage 存储，菜单命令一键开关
 *
 * 当前规则（v0.2.0）：
 *   ✓ 默认开启
 *     - 首页顶部轮播横幅（含 .extension-tips-v2 推广标记）
 *     - "短视频"顶部 Tab
 *     - 给每个视频卡片加上分类 chip（从 API 响应拦截得到 tname）
 *     - 顶部加分类筛选条：点分类只显示该类视频
 *   ○ 默认关闭
 *     - 首页右侧"热门 / 排行榜"广告位（激进）
 *     - 播放页右侧推荐（激进）
 *
 * 实现关键点：
 *   1. 拦截 fetch + XMLHttpRequest，捕获 B 站首页推荐流 API 响应
 *   2. 解析 item 数组，构建 BV → tname 映射
 *   3. 扫描视频卡片 DOM，按 BV 查 tname 注入 chip
 *   4. SPA 路由切换时 MutationObserver 重新扫描
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'bfm_home_cleaner_v1';

  // ===== 默认规则配置 =====
  const DEFAULT_RULES = {
    hideCarousel: true,           // 首页顶部轮播横幅 + 推广
    hideShortsTab: true,          // "短视频"Tab
    showCategoryChips: true,      // 视频卡片左上加 tname 分类 chip
    showCategoryFilter: true,     // 顶部加分类筛选条
    hideSidebarAds: false,        // 右侧广告位（激进，默认关）
    hideRecommendedSidebar: false,// 播放页右侧推荐（激进）
  };

  // 读用户配置，没有则用默认
  let rules = { ...DEFAULT_RULES };
  try {
    const stored = JSON.parse(GM_getValue(STORAGE_KEY, 'null'));
    if (stored && typeof stored === 'object') rules = { ...rules, ...stored };
  } catch (e) { /* 用默认 */ }

  function save() { GM_setValue(STORAGE_KEY, JSON.stringify(rules)); }

  // ===== 各规则的 CSS 选择器 =====
  // 每个规则都有多个 fallback 选择器，避免 B 站改版时全面失效
  const SELECTORS = {
    // 轮播横幅：用户提供的 class .vui_carousel__slide + .extension-tips-v2
    // 还包括各种 banner / 推荐位的语义 class
    hideCarousel: [
      '.vui_carousel__slide',           // 主轮播
      '.carousel-area',                  // 轮播容器
      '.extension-tips-v2',              // 推广/广告标记
      '.bili-banner',                    // 老版横幅
      '[class*="banner"]:not([class*="tag"]):not([class*="user"])', // 兜底
    ],

    // "短视频" Tab — B 站顶部导航栏中的短视频入口
    hideShortsTab: [
      // 顶部主导航 "短视频" 链接 — 用文字内容匹配（最稳）
      'a[href*="/v/popular/shorts"]',
      // 备用：找含 "短视频" 文本的 nav tab
      '.nav-tabs-item:has-text("短视频")',  // jsdom 风格，需要运行时 query
    ],

    hideSidebarAds: [
      '.ad-report',
      '.bilibili-player-recommend',
      '.video-card-ad',
      '[class*="ad-"]',
    ],

    hideRecommendedSidebar: [
      '.recommend-list',
      '.rec-list',
      '#reco_list',
      '.video-page-card',
    ],
  };

  function buildCSS() {
    const lines = [];
    for (const [ruleKey, sels] of Object.entries(SELECTORS)) {
      if (!rules[ruleKey]) continue;
      // 多 selector 用逗号并起来，链外层 important 提高优先级
      lines.push(sels.join(', ') + ' { display: none !important; }');
    }
    return lines.join('\n');
  }

  GM_addStyle(buildCSS());

  // ===== 动态内容兜底（处理 SPA 路由切换后新增的 DOM） =====
  // B 站是单页应用，路由切换时 banner / shorts tab 会重新创建
  // 用 MutationObserver 监听根节点，重新注入隐藏样式
  let injected = false;
  const observer = new MutationObserver(() => {
    if (injected) return;
    // 简化策略：只在首次检测到目标元素时重新注入一次样式
    const allSelectors = Object.entries(SELECTORS)
      .filter(([k]) => rules[k])
      .flatMap(([, sels]) => sels)
      .join(', ');
    try {
      if (document.querySelector(allSelectors)) {
        GM_addStyle(buildCSS());
        injected = true;
        // 找到后不必持续观察，降低开销
        setTimeout(() => observer.disconnect(), 5000);
      }
    } catch (e) { /* 部分 selector 可能在初始未匹配，继续观察 */ }
  });
  observer.observe(document.body || document.documentElement, {
    childList: true, subtree: true,
  });

  // ===== "短视频" Tab 文本匹配兜底 =====
  // 因为 :has-text() 不是原生 CSS，需要 JS 找含"短视频"文本的 nav tab
  function hideShortsTabByText() {
    if (!rules.hideShortsTab) return;
    // 顶部主导航的 a 标签里查
    const candidates = document.querySelectorAll('a, .nav-tabs-item, .vui_tabs_item, [class*="tab-item"]');
    for (const el of candidates) {
      const txt = el.textContent?.trim();
      if (txt === '短视频' || txt === 'Shorts') {
        el.style.setProperty('display', 'none', 'important');
        // 也隐藏外层 li 容器，避免空白
        el.parentElement?.style?.setProperty('display', 'none', 'important');
      }
    }
  }
  // 初始 + 路由切换后执行
  hideShortsTabByText();
  setTimeout(hideShortsTabByText, 1000);
  setTimeout(hideShortsTabByText, 3000);

  // ===== 菜单命令 =====
  function toggle(ruleKey) {
    rules[ruleKey] = !rules[ruleKey];
    save();
    // 切换后立即生效（重载页面最稳）
    location.reload();
  }

  function statusText(key) {
    return `${rules[key] ? '✓ 已隐藏' : '○ 未隐藏'}`;
  }

  try {
    GM_registerMenuCommand(`轮播横幅 ${statusText('hideCarousel')}`, () => toggle('hideCarousel'));
    GM_registerMenuCommand(`短视频 Tab ${statusText('hideShortsTab')}`, () => toggle('hideShortsTab'));
    GM_registerMenuCommand(`右侧广告 ${statusText('hideSidebarAds')}`, () => toggle('hideSidebarAds'));
    GM_registerMenuCommand(`播放页推荐 ${statusText('hideRecommendedSidebar')}`, () => toggle('hideRecommendedSidebar'));
  } catch (e) {
    console.warn('[BFM Home Cleaner] menu command failed', e);
  }

  console.log('%c[BFM Home Cleaner]', 'color:#00aeec;font-weight:bold', 'v0.2.0 已加载');

  // ────────────────────────────────────────────────────────────
  // v0.2.0 — 分类可视化（API 拦截 + 卡片标注 + 顶部分类筛选条）
  // ────────────────────────────────────────────────────────────

  // BV → tname 映射（从拦截到的 B 站推荐流 API 响应里构建）
  const categoryMap = new Map();

  // 当前激活的分类过滤；null = 不过滤
  let activeFilter = null;

  // B 站推荐流常见的 API 路径（拦截这些就够了）
  const FEED_API_PATTERNS = [
    /\/x\/web-interface\/index\//,           // 首页推荐主接口
    /\/index\/feed-icon/,                    // 首页图标流
    /\/index\/rank/,                         // 排行榜流
    /\/x\/web-interface\/wbi\/index\/top/,   // 顶部热门
  ];
  function isFeedApi(url) {
    return typeof url === 'string' && FEED_API_PATTERNS.some(re => re.test(url));
  }

  // 从响应 JSON 中递归找所有 tname，建立 BV → tname 映射
  function harvestTnames(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) { obj.forEach(harvestTnames); return; }
    const bv = obj.bvid || obj.bv_id;
    const tn = obj.tname;
    if (bv && tn && typeof bv === 'string' && typeof tn === 'string') {
      categoryMap.set(bv, tn);
    }
    for (const k of Object.keys(obj)) {
      // 跳过太深的子树，避免性能问题
      if (k === 'data' || k === 'item' || k === 'items' || k === 'list') {
        harvestTnames(obj[k]);
      }
    }
  }

  // ── fetch 拦截 ──
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const url = args[0]?.url || args[0];
    return origFetch.apply(this, args).then(async res => {
      try {
        if (isFeedApi(url)) {
          const clone = res.clone();
          const data = await clone.json();
          harvestTnames(data);
          // 拿到新数据后立即重新扫描 DOM
          queueMicrotask(() => { applyCategoryChips(); });
        }
      } catch (_) { /* 不是 JSON 或结构不符，忽略 */ }
      return res;
    });
  };

  // ── XMLHttpRequest 拦截（部分 B 站请求走 XHR）──
  const OrigXHR = window.XMLHttpRequest;
  function WrappedXHR() {
    const xhr = new OrigXHR();
    let _url = '';
    const origOpen = xhr.open;
    xhr.open = function (method, url, ...rest) {
      _url = url;
      return origOpen.call(this, method, url, ...rest);
    };
    xhr.addEventListener('load', () => {
      try {
        if (isFeedApi(_url) && xhr.responseText) {
          const data = JSON.parse(xhr.responseText);
          harvestTnames(data);
          queueMicrotask(() => { applyCategoryChips(); });
        }
      } catch (_) { /* ignore */ }
    });
    return xhr;
  }
  window.XMLHttpRequest = WrappedXHR;

  // ── 视频卡片选择器（B 站改版多，加 fallback）──
  const CARD_SELECTOR = [
    '.bili-video-card',                  // 当前主选择器（2024+）
    '.feed-card',                        // 老版
    '[class*="video-card"]',             // 兜底
    '.video-card',                       // 旧版
  ].join(', ');

  function extractBV(card) {
    const link = card.querySelector('a[href*="/video/BV"]');
    if (!link) return null;
    const m = link.href.match(/(BV[a-zA-Z0-9]+)/);
    return m ? m[1] : null;
  }

  // 给卡片加 tname chip
  function applyCategoryChips() {
    if (!rules.showCategoryChips) return;
    const cards = document.querySelectorAll(CARD_SELECTOR);
    for (const card of cards) {
      const bv = extractBV(card);
      if (!bv) continue;
      const tname = categoryMap.get(bv);
      if (!tname) continue;
      if (card.querySelector('.bfm-cat-chip')) continue;
      card.style.position = card.style.position || 'relative';
      const chip = document.createElement('span');
      chip.className = 'bfm-cat-chip';
      chip.textContent = tname;
      chip.dataset.bvid = bv;
      chip.dataset.tname = tname;
      // 默认样式；用户可调
      chip.style.cssText = [
        'position:absolute', 'top:8px', 'left:8px',
        'background:rgba(0,0,0,.72)', 'color:#fff',
        'padding:2px 8px', 'border-radius:10px',
        'font-size:11px', 'font-weight:500',
        'z-index:10', 'cursor:pointer',
        'line-height:1.4', 'user-select:none',
      ].join(';');
      chip.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        applyFilter(tname === activeFilter ? null : tname);
      });
      card.appendChild(chip);
    }
  }

  // 应用分类过滤
  function applyFilter(tname) {
    activeFilter = tname;
    const cards = document.querySelectorAll(CARD_SELECTOR);
    let visible = 0;
    for (const card of cards) {
      if (!tname) {
        card.style.removeProperty('display');
        continue;
      }
      const chip = card.querySelector('.bfm-cat-chip');
      const cardTname = chip?.dataset.tname;
      if (cardTname === tname) {
        card.style.removeProperty('display');
        visible++;
      } else {
        card.style.display = 'none';
      }
    }
    updateFilterBar();
    if (tname) {
      console.log(`[BFM Home Cleaner] 过滤到 "${tname}"：显示 ${visible} 个视频`);
    }
  }

  // ── 顶部分类筛选条 ──
  const FILTER_BAR_ID = 'bfm-cat-filter-bar';
  const CATEGORIES = [
    '全部', '动画', '番剧', '国创', '音乐', '舞蹈',
    '游戏', '知识', '科技', '运动', '生活', '美食',
    '动物', '鬼畜', '时尚', '资讯', '影视', '娱乐', '纪录片',
  ];

  function mountFilterBar() {
    if (!rules.showCategoryFilter) return;
    if (document.getElementById(FILTER_BAR_ID)) return;
    const bar = document.createElement('div');
    bar.id = FILTER_BAR_ID;
    bar.style.cssText = [
      'position:sticky', 'top:0', 'z-index:9999',
      'background:rgba(255,255,255,.96)',
      'box-shadow:0 2px 8px rgba(0,0,0,.08)',
      'padding:10px 16px', 'overflow-x:auto',
      'white-space:nowrap', 'display:flex', 'gap:8px',
      'font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif',
      'backdrop-filter:blur(8px)',
    ].join(';');
    bar.innerHTML = CATEGORIES.map(c =>
      `<span class="bfm-cat-pill" data-cat="${c}" style="display:inline-block;padding:6px 14px;border-radius:16px;font-size:13px;cursor:pointer;background:#f1f5f9;color:#475569;transition:all .15s">${c}</span>`
    ).join('');
    document.body.prepend(bar);
    bar.addEventListener('click', (e) => {
      const pill = e.target.closest('.bfm-cat-pill');
      if (!pill) return;
      const cat = pill.dataset.cat;
      applyFilter(cat === '全部' || cat === activeFilter ? null : cat);
    });
    updateFilterBar();
  }

  function updateFilterBar() {
    const bar = document.getElementById(FILTER_BAR_ID);
    if (!bar) return;
    bar.querySelectorAll('.bfm-cat-pill').forEach(p => {
      const active = (p.dataset.cat === activeFilter) ||
                     (p.dataset.cat === '全部' && !activeFilter);
      p.style.background = active ? '#fb7299' : '#f1f5f9';
      p.style.color = active ? '#fff' : '#475569';
    });
  }

  // 初始挂载
  mountFilterBar();
  applyCategoryChips();

  // ── SPA 路由切换 / 滚动加载新卡片时重扫 ──
  const cardObserver = new MutationObserver(utils_debounce(() => {
    applyCategoryChips();
    mountFilterBar();
  }, 300));
  cardObserver.observe(document.body, { childList: true, subtree: true });

  // 简单的 debounce（不依赖外部 utils）
  function utils_debounce(fn, ms) {
    let t = null;
    return function () {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, arguments), ms);
    };
  }

  // ── 菜单命令（追加新规则的开关）──
  try {
    GM_registerMenuCommand(`分类 chip ${statusText('showCategoryChips')}`, () => toggle('showCategoryChips'));
    GM_registerMenuCommand(`分类筛选条 ${statusText('showCategoryFilter')}`, () => toggle('showCategoryFilter'));
  } catch (e) { /* ignore */ }
})();