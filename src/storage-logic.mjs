// Pure storage logic — no GM_* / no DOM / no side effects.
// Tests can import this directly.
// The .user.js must keep an equivalent copy in sync (verified by tests/sync.test.js).

/**
 * Days since timestamp. Returns Infinity for falsy values (never detected).
 * @param {number} ts - unix ms timestamp
 * @returns {number}
 */
export function daysSince(ts) {
  if (!ts) return Infinity;
  return Math.floor((Date.now() - ts) / 86400000);
}

/**
 * Human-readable "X days ago" / "X months ago" / "X years ago".
 * @param {number} n
 * @returns {string}
 */
export function formatDays(n) {
  if (n === Infinity) return '从未';
  if (n === undefined || n === null || Number.isNaN(n)) return '未知';
  if (n < 1) return '今天';
  if (n < 30) return `${n} 天前`;
  if (n < 365) return `${Math.floor(n / 30)} 个月前`;
  return `${Math.floor(n / 365)} 年前`;
}

/**
 * Real dead-fan candidates: must have been detected (lastActive > 0)
 * AND not updated within threshold days.
 *
 * @param {Object} following - {mid: {mid, uname, lastActive, ...}}
 * @param {number} thresholdDays - e.g. 90
 * @param {number} [now=Date.now()] - injectable for testing
 * @returns {Array} sorted by lastActive ascending (oldest first)
 */
export function getInactiveCandidates(following, thresholdDays, now = Date.now()) {
  return Object.values(following || {})
    .filter(u => u && u.lastActive > 0 && (now - u.lastActive) / 86400000 > thresholdDays)
    .sort((a, b) => (a.lastActive || 0) - (b.lastActive || 0));
}

/**
 * UP 主 that have never been checked (lastActive is 0 or undefined).
 * @param {Object} following
 * @returns {Array}
 */
export function getUndetected(following) {
  return Object.values(following || {}).filter(u => u && !u.lastActive);
}

/**
 * Compute mid set from a group.
 */
export function midsOfGroup(following, tagid) {
  const tid = Number(tagid);
  return Object.values(following || {})
    .filter(u => u && Array.isArray(u.tagids) && u.tagids.includes(tid))
    .map(u => u.mid);
}

/**
 * Default state for new storage.
 */
export function defaultState(inactiveDays = 90) {
  return {
    version: 2,
    mid: null,
    groups: [],
    following: {},
    settings: {
      inactiveThresholdDays: inactiveDays,
      panelCollapsed: false,
    },
    lastSync: 0,
  };
}

/**
 * Migrate state from any older version to current.
 * Add new branches as the schema evolves.
 */
export function migrate(state) {
  if (!state || typeof state !== 'object') return defaultState();
  const v = Number(state.version) || 0;
  if (v < 1) state.version = 1;
  if (v < 2) {
    // v1 → v2: 结构未变，仅升版本号（占位示例）
    state.version = 2;
  }
  return state;
}