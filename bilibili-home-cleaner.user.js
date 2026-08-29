// ==UserScript==
// @name         B 站首页净化（Home Cleaner）
// @name:zh-CN   B 站首页净化
// @namespace    https://github.com/Franklinyung/bilibili-following-manager
// @version      0.1.0
// @description  隐藏 B 站首页轮播广告、推广横幅、右侧广告、"短视频"Tab 等噪音。独立脚本，与"关注列表管理"脚本互不干扰。
// @description:zh-CN  隐藏 B 站首页轮播广告、推广横幅、右侧广告、"短视频"Tab 等噪音。独立脚本，与"关注列表管理"脚本互不干扰。
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
 * 当前规则（v0.1.0）：
 *   ✓ 默认开启
 *     - 首页顶部轮播横幅（含 .extension-tips-v2 推广标记）
 *     - "短视频"顶部 Tab
 *   ○ 默认关闭
 *     - 首页右侧"热门 / 排行榜"广告位（用户反馈有噪音再开）
 *     - 播放页右侧推荐（保留供选择）
 */

(function () {
  'use strict';

  const STORAGE_KEY = 'bfm_home_cleaner_v1';

  // ===== 默认规则配置 =====
  const DEFAULT_RULES = {
    hideCarousel: true,           // 首页顶部轮播横幅 + 推广
    hideShortsTab: true,          // "短视频"Tab
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

  console.log('%c[BFM Home Cleaner]', 'color:#00aeec;font-weight:bold', 'v0.1.0 已加载');
})();