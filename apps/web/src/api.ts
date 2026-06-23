let accessToken: string | null = null;

const API = (import.meta.env.VITE_API_URL || (import.meta.env.PROD ? 'https://api.nextax.business' : 'http://localhost:4000')).replace(/\/$/, '');

function parseJson(text: string) {
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export async function api(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);

  if (!(init.body instanceof FormData) && init.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);

  let res = await fetch(`${API}${path}`, { ...init, headers, credentials: 'include' });

  if (res.status === 401) {
    const refresh = await fetch(`${API}/auth/refresh`, { method: 'POST', credentials: 'include' });

    if (refresh.ok) {
      const data = parseJson(await refresh.text()) as { accessToken?: string } | null;
      accessToken = data?.accessToken ?? null;

      if (accessToken) {
        headers.set('authorization', `Bearer ${accessToken}`);
        res = await fetch(`${API}${path}`, { ...init, headers, credentials: 'include' });
      }
    }
  }

  const payload = parseJson(await res.text());

  if (!res.ok) {
    const message = typeof payload === 'object' && payload ? (payload as any).message || (payload as any).error : null;
    throw new Error(message || 'Erro inesperado');
  }

  return payload;
}

export async function login(email: string, password: string) {
  const data = await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  setAccessToken(data.accessToken);
  return data;
}

export async function signup(name: string, email: string, password: string) {
  return api('/auth/signup', { method: 'POST', body: JSON.stringify({ name, email, password }) });
}

export async function forgotPassword(email: string) {
  return api('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function resetPassword(token: string, password: string) {
  return api('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
}

export async function verifyEmail(token: string) {
  return api('/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
}

export async function resendVerification(email: string) {
  return api('/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function changePassword(currentPassword: string, newPassword: string) {
  const result = await api('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
  setAccessToken(null);
  return result;
}

export async function deleteAccount(password: string, confirmation: string) {
  const result = await api('/account', { method: 'DELETE', body: JSON.stringify({ password, confirmation }) });
  setAccessToken(null);
  return result;
}

export async function exchangeNexCoreToken(token: string, app = 'nextax') {
  const data = await api('/auth/nexcore/exchange', { method: 'POST', body: JSON.stringify({ token, app }) });
  setAccessToken(data.accessToken);
  return data;
}

export async function logout() {
  await api('/auth/logout', { method: 'POST' }).catch(() => null);
  setAccessToken(null);
}

export async function backToNexCore() {
  const data = await api('/auth/nexcore/return-session', { method: 'POST' });
  location.href = data.url;
}
