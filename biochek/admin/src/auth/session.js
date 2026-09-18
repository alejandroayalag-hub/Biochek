export function setToken(token) {
  localStorage.setItem('token', token);
}

export function getToken() {
  return localStorage.getItem('token');
}

export function clearSession() {
  localStorage.removeItem('token');
}

// Decodes the JWT payload without verifying the signature — the backend is
// the source of truth for auth; this is only used client-side to show the
// right nav items and hide actions the current role can't perform.
export function getUser() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export function isAuthenticated() {
  return !!getToken();
}
