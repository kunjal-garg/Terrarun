/**
 * Nickname availability check. Used by onboarding to enforce unique nicknames.
 * Currently uses a local list (localStorage); replace with API call when backend supports it.
 * e.g. GET /api/nickname/check?nickname=xxx -> { available: boolean }
 */

const STORAGE_KEY = 'terrarun_nicknames_taken';

function getTakenList() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

/**
 * Returns true if the nickname is available (not already taken).
 * @param {string} nickname - Trimmed nickname to check
 * @param {string|null} exceptCurrent - If provided, this nickname is treated as available (e.g. user's own current nickname)
 * @returns {boolean}
 */
export function isNicknameAvailable(nickname, exceptCurrent = null) {
  if (!nickname || typeof nickname !== 'string') return false;
  const normalized = nickname.trim().toLowerCase();
  if (!normalized) return false;
  if (exceptCurrent && exceptCurrent.trim().toLowerCase() === normalized) return true;
  const taken = getTakenList().map((n) => (n || '').toLowerCase());
  return !taken.includes(normalized);
}

/**
 * Registers a nickname as taken after successful set (e.g. after POST /api/nickname succeeds).
 * Call this when the user has successfully claimed the nickname.
 * @param {string} nickname - Trimmed nickname to register
 */
export function registerNicknameTaken(nickname) {
  const trimmed = nickname.trim();
  if (!trimmed) return;
  try {
    const list = getTakenList();
    const normalized = trimmed.toLowerCase();
    if (list.map((n) => (n || '').toLowerCase()).includes(normalized)) return;
    list.push(trimmed);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (_) {}
}
