/* Client-side settings store for DevGenie.
 *
 * Persists to localStorage under `devgenie.settings.v1`. All reads are
 * SSR-safe (return empty defaults when `window` is undefined) and resilient
 * to corrupted JSON.
 */

export type DevGenieSettings = {
  /** GitLab Personal Access Token (kept only in this browser). */
  pat?: string;
  /** Default repository (path_with_namespace) to open first. */
  defaultRepo?: string;
};

const KEY = 'devgenie.settings.v1';

export function getSettings(): DevGenieSettings {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as DevGenieSettings;
    }
    return {};
  } catch {
    return {};
  }
}

export function saveSettings(patch: Partial<DevGenieSettings>): DevGenieSettings {
  const merged: DevGenieSettings = { ...getSettings(), ...patch };
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(merged));
    } catch {
      /* storage full or unavailable — keep going with in-memory value */
    }
  }
  return merged;
}

export function clearPat(): void {
  const current = getSettings();
  delete current.pat;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Headers to spread into fetch() calls so the server can use the user's PAT
 * instead of the (short-lived) OAuth token. Empty when no PAT is saved.
 */
export function patHeaders(): Record<string, string> {
  const { pat } = getSettings();
  return pat ? { 'x-gitlab-pat': pat } : {};
}
