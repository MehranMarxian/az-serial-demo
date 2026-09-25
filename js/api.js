export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `HTTP ${status}`);
    this.status = status;
    this.code = body?.code || (status === 0 ? 'NETWORK' : 'GENERIC');
    this.errors = body?.errors || null;
  }
}

export const isDemo = () => globalThis.AZS_DEMO === true;

export async function api(method, path, body) {
  if (isDemo()) {
    // Static demo build (GitHub Pages): serve the API from the browser instead of a server.
    const { handle } = await import('./demo-api.js');
    try {
      return await handle(method, path, body);
    } catch (err) {
      if (err.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('azs:unauthorized'));
      throw err;
    }
  }
  let res;
  try {
    res = await fetch(`api${path}`, {
      method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'az-serial' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, null);
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new CustomEvent('azs:unauthorized'));
    throw new ApiError(res.status, data);
  }
  return data;
}

export const get = (path) => api('GET', path);
export const post = (path, body) => api('POST', path, body ?? {});
export const patch = (path, body) => api('PATCH', path, body);
export const del = (path) => api('DELETE', path);

export function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
}
