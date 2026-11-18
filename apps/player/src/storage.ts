/** localStorage that never throws (it can be disabled or full on some devices). */
const KEY = 'slidecast.token';

export function loadToken(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

/** Returns true if the token was actually persisted. */
export function saveToken(token: string): boolean {
  try {
    window.localStorage.setItem(KEY, token);
    return window.localStorage.getItem(KEY) === token;
  } catch {
    return false;
  }
}

export function clearToken(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
