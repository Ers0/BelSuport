// src/api.js
// Sends session token via Bearer header (from localStorage).
// Also sends httpOnly cookie automatically via credentials:'include'.
// The backend reads both — cookie gives 30-day persistent login as fallback.

const getToken = () => {
  try { return localStorage.getItem('session_token') || ''; }
  catch { return ''; }
};

export async function api(path, opts = {}) {
  const token = getToken();
  const res = await fetch(path, {
    ...opts,
    credentials: 'include',   // send httpOnly cookie on every request
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
    body: opts.body,
  });

  if (res.status === 401) {
    try { localStorage.removeItem('session_token'); } catch {}
    // Don't reload on /auth/me — App.jsx handles that gracefully to avoid loops
    if (!path.includes('/auth/me')) {
      window.location.reload();
    }
    return null;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const ADMIN_EMAILS = ['eros.belenergy@gmail.com'];
