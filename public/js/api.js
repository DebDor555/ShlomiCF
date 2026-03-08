// Thin fetch wrapper — all calls return parsed JSON or throw
const BASE = '';

async function req(method, url, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(BASE + url, opts);
  if (r.status === 401) { window.location.href = '/login'; return; }
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

// Accounts
export const getAccounts  = ()          => req('GET',  '/api/accounts');
export const setBalance   = (id, bal)   => req('PUT',  `/api/accounts/${id}`, { balance: bal });

// FX rates
export const getFxRates   = ()          => req('GET',  '/api/fx-rates');
export const setFxRate    = (id, rate)  => req('PUT',  `/api/fx-rates/${id}`, { rate });

// Recurring items
export const getRecurring    = ()       => req('GET',  '/api/recurring');
export const createRecurring = (data)   => req('POST', '/api/recurring', data);
export const updateRecurring = (id, d)  => req('PUT',  `/api/recurring/${id}`, d);
export const deleteRecurring = (id)     => req('DELETE',`/api/recurring/${id}`);

// Events
export const getEvents    = (from, to, scenario) =>
  req('GET', `/api/events?from=${from}&to=${to}&scenario=${scenario || 'base'}`);
export const createEvent  = (data)   => req('POST', '/api/events', data);
export const updateEvent  = (id, d)  => req('PUT',  `/api/events/${id}`, d);
export const deleteEvent  = (id)     => req('DELETE',`/api/events/${id}`);
