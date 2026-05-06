const token = () => localStorage.getItem('session_token') || '';

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      'Authorization': `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
    body: opts.body,
  });
  if (res.status === 401) { localStorage.removeItem('session_token'); window.location.reload(); }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const ADMIN_EMAILS = ['eros.belenergy@gmail.com'];