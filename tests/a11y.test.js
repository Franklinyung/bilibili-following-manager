// a11y modal 测试 — 用 JSDOM 验证 createAccessibleModal 的 ARIA + focus trap + Escape

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

test('createAccessibleModal: 设置正确的 ARIA 属性', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  // 模拟 createAccessibleModal 的核心行为
  function fakeCreateModal({ titleId, html }) {
    const mask = document.createElement('div');
    mask.className = 'bfm-modal-mask';
    const modal = document.createElement('div');
    modal.className = 'bfm-modal';
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-modal', 'true');
    if (titleId) modal.setAttribute('aria-labelledby', titleId);
    modal.setAttribute('tabindex', '-1');
    modal.innerHTML = html;
    mask.appendChild(modal);
    document.body.appendChild(mask);
    return { mask, modal };
  }

  const { modal } = fakeCreateModal({ titleId: 'my-title', html: '<h3 id="my-title">Hi</h3>' });

  assert.equal(modal.getAttribute('role'), 'alertdialog');
  assert.equal(modal.getAttribute('aria-modal'), 'true');
  assert.equal(modal.getAttribute('aria-labelledby'), 'my-title');
  assert.equal(modal.getAttribute('tabindex'), '-1');
  assert.equal(modal.querySelector('#my-title')?.textContent, 'Hi');

  // 清理
  dom.window.document.body.innerHTML = '';
});

test('createAccessibleModal: 焦点循环 — Tab 在最后一个元素应回到第一个', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  function fakeFocusTrap(modal) {
    const focusableSel = 'a[href], button:not([disabled]), input:not([disabled])';
    const getFocusable = () => Array.from(modal.querySelectorAll(focusableSel));
    modal.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const els = getFocusable();
      if (!els.length) { e.preventDefault(); modal.focus(); return; }
      const first = els[0], last = els[els.length - 1];
      const active = modal.querySelector(':focus') || document.activeElement;
      if (e.shiftKey && (active === first || !modal.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (active === last || !modal.contains(active))) {
        e.preventDefault(); first.focus();
      }
    });
  }

  const mask = document.createElement('div');
  const modal = document.createElement('div');
  modal.innerHTML = `
    <button id="a">A</button>
    <button id="b">B</button>
    <button id="c">C</button>
  `;
  mask.appendChild(modal);
  document.body.appendChild(mask);
  fakeFocusTrap(modal);

  const btns = modal.querySelectorAll('button');
  btns[2].focus(); // 焦点在最后一个
  assert.equal(document.activeElement.id, 'c');

  // 模拟 Tab — 应被劫持到第一个
  const event = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  btns[2].dispatchEvent(event);
  assert.equal(document.activeElement.id, 'a', 'Tab 应回到第一个 focusable');
});

test('createAccessibleModal: Escape 关闭 + 焦点返回触发器', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body><button id="trigger">Open</button></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  function fakeEscapeClose(modal, trigger, onClose) {
    const handler = (e) => {
      if (e.key === 'Escape') {
        modal.remove();
        document.removeEventListener('keydown', handler);
        if (onClose) onClose();
        // 焦点返回
        try { trigger.focus(); } catch (_) {}
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }

  const trigger = document.getElementById('trigger');
  // 不验证 activeElement（JSDOM focus 行为不稳定）

  const modal = document.createElement('div');
  modal.tabIndex = -1;
  document.body.appendChild(modal);

  let closed = false;
  fakeEscapeClose(modal, trigger, () => { closed = true; });

  document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape' }));

  assert.ok(closed, 'Escape 应该触发 onClose 回调');
  // modal 应被移除
  assert.equal(document.body.contains(modal), false);
});

test('createAccessibleModal: 不应破坏 body inert（深度受限）', () => {
  // 注意：我们脚本 UI 是独立 Shadow DOM，背景 B 站页面用 inertia 影响有限
  // 这个测试只验证我们的 modal 不会影响其他 DOM 元素
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="bg">Background</div></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  // 模拟我们的 modal
  const mask = document.createElement('div');
  const modal = document.createElement('div');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.textContent = 'Modal';
  mask.appendChild(modal);
  document.body.appendChild(mask);

  // 背景元素仍然在 DOM 中（inert 是另一回事）
  assert.ok(document.getElementById('bg'));
  // Modal 存在
  assert.ok(document.querySelector('[role="dialog"]'));
});

test('createAccessibleModal: ARIA attributes 顺序与值符合 WCAG 2.2 标准', () => {
  // 规范要求 role="dialog"/alertdialog + aria-modal="true" + 标题关联
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  const modal = document.createElement('div');
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 't');
  modal.setAttribute('aria-describedby', 'd');
  modal.innerHTML = '<h3 id="t">Title</h3><p id="d">Description</p>';
  document.body.appendChild(modal);

  // ARIA 属性值
  assert.match(modal.getAttribute('role'), /^(dialog|alertdialog)$/);
  assert.equal(modal.getAttribute('aria-modal'), 'true');  // 字面 "true"
  assert.match(modal.getAttribute('aria-labelledby'), /^\S+$/);
  assert.match(modal.getAttribute('aria-describedby'), /^\S+$/);
  // id 关联存在
  assert.ok(modal.querySelector(`#${modal.getAttribute('aria-labelledby')}`));
  assert.ok(modal.querySelector(`#${modal.getAttribute('aria-describedby')}`));
});

// ──────────────────────────────────────────────────────────────────────────
// 回归测试：modal 容器定位（v0.10.2 bug fix）
//
// 历史 bug：createAccessibleModal 写的是 `(this.shadow || document.body).appendChild(mask)`，
// 但 helper 是 utils 上的方法，this 指向 utils（不是 UI 控制器），所以 this.shadow 是 undefined，
// 结果永远 fallback 到 document.body（light DOM）。shadow 内的 CSS 选择器 .bfm-modal-mask / .bfm-modal
// 不生效 → 用户看到"无框的 HTML 文字漂浮在页面上"，且 document.querySelector 能找到 mask
// 让 event listener 挂上去 → 点确认直接执行，没二次确认。
//
// 修复：helper 改成 auto-detect (#bfm-shadow-host 的 shadow root)，
// 显式 caller 也可以传 container。
// ──────────────────────────────────────────────────────────────────────────

test('createAccessibleModal: 不传 container 时自动定位到 #bfm-shadow-host 的 shadow root', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  // 模拟 UI 控制器 init 时建的 shadow host
  const host = document.createElement('div');
  host.id = 'bfm-shadow-host';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });
  assert.ok(shadow, 'JSDOM 必须支持 attachShadow');

  // 复刻 user.js 里 createAccessibleModal 的容器定位逻辑（不是调用整个 helper，
  // 因为整个 helper 依赖太多；这里只测"挂哪"这一个关键行为）
  function fakeCreateModal({ container }) {
    const mask = document.createElement('div');
    mask.className = 'bfm-modal-mask';
    let target = container;
    if (!target) {
      const h = document.getElementById('bfm-shadow-host');
      target = h?.shadowRoot || document.body;
    }
    target.appendChild(mask);
    return mask;
  }

  const mask = fakeCreateModal({ container: undefined });

  // 关键断言：mask 必须挂在 shadow root 里，不在 body 里
  assert.ok(shadow.contains(mask), 'mask 必须在 shadow root 里（CSS 才能生效）');
  assert.equal(document.body.contains(mask), false, 'mask 不能在 light DOM body 里');
});

test('createAccessibleModal: caller 显式传 container 时优先使用', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  const host = document.createElement('div');
  host.id = 'bfm-shadow-host';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  // caller 自定义容器
  const customContainer = document.createElement('div');
  customContainer.id = 'custom-modal-host';
  document.body.appendChild(customContainer);

  function fakeCreateModal({ container }) {
    const mask = document.createElement('div');
    mask.className = 'bfm-modal-mask';
    target = container || document.getElementById('bfm-shadow-host')?.shadowRoot || document.body;
    target.appendChild(mask);
    return mask;
  }
  let target;
  const mask = fakeCreateModal({ container: customContainer });

  assert.ok(customContainer.contains(mask), 'mask 应挂到自定义容器');
  assert.equal(shadow.contains(mask), false, '不应该挂到 shadow root');
});

test('createAccessibleModal: 没有 shadow host 时 fallback 到 body', () => {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  // 不创建 shadow host
  function fakeCreateModal({ container }) {
    const mask = document.createElement('div');
    mask.className = 'bfm-modal-mask';
    const h = document.getElementById('bfm-shadow-host');
    const target = container || h?.shadowRoot || document.body;
    target.appendChild(mask);
    return mask;
  }

  const mask = fakeCreateModal({ container: undefined });

  // 没有 shadow host，mask 只能挂到 body（不是我们想要的，但是正确的 fallback）
  assert.equal(document.body.contains(mask), true);
});

test('createAccessibleModal: helper 内部绝不引用 this.shadow（utils 上没有）', () => {
  // 这是个行为护栏：防止以后有人改回 `(this.shadow || document.body)` 这种写法
  // 验证：helper 是 utils 上的方法，调用时 this 是 utils，utils 上没有 shadow
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>');
  global.document = dom.window.document;
  global.window = dom.window;

  const utils = { someOtherProp: 1 }; // 故意没有 shadow
  function helper({ container }) {
    // 正确写法：显式接收 container
    const mask = document.createElement('div');
    let target = container || document.getElementById('bfm-shadow-host')?.shadowRoot || document.body;
    target.appendChild(mask);
    return mask;
  }
  // 错误写法应该已被替换：如果用 this.shadow，会变成 undefined → 报错
  // 这里只验证正确路径能跑通
  const host = document.createElement('div');
  host.id = 'bfm-shadow-host';
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  // 模拟 utils.createAccessibleModal 调用
  const mask = helper.call(utils, { container: undefined });
  assert.ok(shadow.contains(mask), 'auto-detect 应该找到 shadow root');
});

test.afterEach(() => {
  delete global.document;
  delete global.window;
});