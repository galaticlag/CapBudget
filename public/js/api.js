'use strict';

const TOKEN_KEY = 'capbudget.token';
const HOUSEHOLD_KEY = 'capbudget.householdId';

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}
function getHouseholdId() {
  return localStorage.getItem(HOUSEHOLD_KEY);
}
function setHouseholdId(id) {
  if (id) localStorage.setItem(HOUSEHOLD_KEY, id);
  else localStorage.removeItem(HOUSEHOLD_KEY);
}

let onUnauthorized = () => {};
function setUnauthorizedHandler(fn) {
  onUnauthorized = fn;
}

async function request(method, path, { query, body, rawResponse } = {}) {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, value);
    }
  }
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const householdId = getHouseholdId();
  if (householdId) headers['x-household-id'] = householdId;
  let payload;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const res = await fetch(url.toString(), { method, headers, body: payload });

  if (res.status === 401) {
    setToken(null);
    onUnauthorized();
    const err = new Error('Session expirée.');
    err.status = 401;
    throw err;
  }

  if (rawResponse) return res;

  let data = null;
  const text = await res.text();
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }

  if (!res.ok) {
    const message = (data && data.error) || `Erreur ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...opts, body }),
  put: (path, body, opts) => request('PUT', path, { ...opts, body }),
  del: (path, opts) => request('DELETE', path, opts)
};

export { api, getToken, setToken, getHouseholdId, setHouseholdId, setUnauthorizedHandler };
