// Pure data-sanitisation helpers (XSS-safe import path).
// Used by both the .user.js and the test suite.

const URL_RE = /^https?:\/\//;

/**
 * Validate and clean a user-supplied face URL.
 * Only accepts http(s) URLs, no javascript:/data:/vbscript:
 * @param {*} v
 * @returns {string} cleaned URL or empty string if rejected
 */
export function cleanFace(v) {
  if (typeof v !== 'string') return '';
  const f = v.trim();
  if (!URL_RE.test(f)) return '';
  if (/[\s"'<>]/.test(f)) return '';          // 防 quote break
  if (f.length >= 500) return '';              // 防 DoS
  return f;
}

/**
 * Sanitize an imported backup JSON object.
 * - Whitelist fields only
 * - Coerce types
 * - Reject suspicious strings
 * @param {*} data
 * @returns {object}
 */
export function sanitizeBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('备份格式错误');
  const safe = { groups: [], following: {}, settings: {} };

  if (Array.isArray(data.groups)) {
    for (const g of data.groups) {
      const tagid = Number(g?.tagid);
      const name = String(g?.name ?? '').slice(0, 32);
      if (!Number.isFinite(tagid) || tagid <= 0) continue;
      safe.groups.push({ tagid, name, count: Number(g?.count) || 0 });
    }
  }

  if (data.following && typeof data.following === 'object' && !Array.isArray(data.following)) {
    for (const [midStr, u] of Object.entries(data.following)) {
      const mid = Number(midStr);
      if (!Number.isFinite(mid) || mid <= 0) continue;
      safe.following[mid] = {
        mid,
        uname: String(u?.uname ?? '').slice(0, 64),
        face: cleanFace(u?.face),
        sign: String(u?.sign ?? '').slice(0, 256),
        tagids: Array.isArray(u?.tagids) ? u.tagids.map(Number).filter(Number.isFinite) : [],
        mtime: Number(u?.mtime) || 0,
        lastActive: Number(u?.lastActive) || 0,
        lastTitle: String(u?.lastTitle ?? '').slice(0, 128),
      };
    }
  }

  const st = data.settings || {};
  if (Number.isFinite(Number(st.inactiveThresholdDays))) {
    const v = Number(st.inactiveThresholdDays);
    if (v >= 7 && v <= 3650) safe.settings.inactiveThresholdDays = v;
  }
  if (typeof st.panelCollapsed === 'boolean') safe.settings.panelCollapsed = st.panelCollapsed;

  // LLM 配置不导入（安全考虑）
  return safe;
}

/**
 * HTML-escape a string for safe insertion via innerHTML.
 */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}