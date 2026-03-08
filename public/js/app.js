import * as api from './api.js';
import { compute }  from './engine.js';

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
  from:      todayStr(),
  to:        addDays(todayStr(), 13),   // 2-week default
  scenario:  'base',
  accounts:  [],
  fxRates:   [],
  recurring: [],
  events:    [],
};

let editingEvent     = null;   // null → new, number → id being edited
let editingRecurring = null;

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  setDateInputs();
  await loadAll();
  render();
  bindToolbar();
  bindModals();
}

async function loadAll() {
  [state.accounts, state.fxRates, state.recurring] = await Promise.all([
    api.getAccounts(),
    api.getFxRates(),
    api.getRecurring(),
  ]);
  state.events = await api.getEvents(state.from, state.to, state.scenario);
}

// ── Render ────────────────────────────────────────────────────────────────────
function render() {
  renderAccountsBar();
  renderGrid();
}

function renderAccountsBar() {
  const fx = Object.fromEntries(state.fxRates.map(r => [r.currency, r.rate_to_ils]));
  fx.ILS = 1;

  const bar = document.getElementById('accounts-bar');
  bar.innerHTML = state.accounts.map(a => `
    <div class="account-chip" data-id="${a.id}">
      <span class="acc-name">${a.name}</span>
      <span class="acc-bal">${fmt(a.balance)} ${a.currency}</span>
      <span class="acc-ils">(${fmt(a.balance * (fx[a.currency] ?? 1))} ₪)</span>
    </div>
  `).join('');

  bar.querySelectorAll('.account-chip').forEach(chip => {
    chip.addEventListener('dblclick', () => openAccountModal(Number(chip.dataset.id)));
  });
}

function renderGrid() {
  const days = compute(state);
  const grid = document.getElementById('grid');

  // Build columns: label col + one col per day
  const colDefs = ['200px', ...days.map(() => '140px')].join(' ');
  grid.style.gridTemplateColumns = colDefs;

  // Rows we'll write (in order):
  // 0: date header
  // 1: opening balance
  // 2-N: all unique categories (income, supplier, operating, financial) with items
  // N+1: total in / total out
  // N+2: net
  // N+3: closing balance

  const categories = ['income', 'supplier', 'operating', 'financial'];
  const catLabels  = { income: 'הכנסות', supplier: 'ספקים', operating: 'תפעול', financial: 'פיננסי' };

  // Collect all item names per category (union across all days)
  const catItems = {}; // category → Set of names
  for (const cat of categories) catItems[cat] = new Set();
  for (const day of days) {
    for (const item of day.items) {
      catItems[item.category].add(item.name);
    }
  }

  const rows = [];

  // Header row
  rows.push({
    type: 'header',
    cells: ['', ...days.map(d => formatDateHeader(d.date))],
  });

  // Opening balance row
  rows.push({
    type: 'balance opening',
    cells: ['פתיחה', ...days.map(d => fmt(d.openingILS))],
  });

  // Category sections
  for (const cat of categories) {
    const names = [...catItems[cat]];
    if (names.length === 0) continue;

    // Section header
    rows.push({ type: `section-header cat-${cat}`, cells: [catLabels[cat], ...days.map(() => '')] });

    // Individual item rows
    for (const name of names) {
      rows.push({
        type: `item cat-${cat}`,
        cells: [
          name,
          ...days.map(day => {
            const item = day.items.find(i => i.name === name && i.category === cat);
            if (!item) return '';
            const sign = item.direction === 'out' ? '-' : '+';
            return sign + fmt(item.amountILS);
          }),
        ],
        eventEditable: true,
        name,
        cat,
      });
    }
  }

  // Totals
  rows.push({ type: 'total in',  cells: ['סה"כ הכנסות', ...days.map(d => fmt(d.inILS))]  });
  rows.push({ type: 'total out', cells: ['סה"כ הוצאות', ...days.map(d => fmt(d.outILS))] });
  rows.push({
    type: 'net',
    cells: ['תנועה נטו', ...days.map(d => {
      const v = d.netILS;
      return (v >= 0 ? '+' : '') + fmt(v);
    })],
  });
  rows.push({
    type: 'balance closing',
    cells: ['סגירה', ...days.map(d => fmt(d.closingILS))],
  });

  // DOM
  grid.innerHTML = '';
  for (const row of rows) {
    // Label cell
    const label = el('div', `grid-cell label ${row.type}`, row.cells[0]);
    grid.appendChild(label);

    // Value cells
    for (let i = 1; i < row.cells.length; i++) {
      const day  = days[i - 1];
      const cell = el('div', `grid-cell value ${row.type}`, row.cells[i]);

      if (row.type === 'net' || row.type.startsWith('balance')) {
        const val = parseFloat(row.cells[i].replace(/,/g, ''));
        if (!isNaN(val)) cell.classList.add(val >= 0 ? 'positive' : 'negative');
      }

      // Click on a date header → add event for that day
      if (row.type === 'header') {
        cell.classList.add('clickable');
        cell.addEventListener('click', () => openEventModal(null, day.date));
      }

      // Click on existing item cell → edit that event/recurring
      if (row.cells[i] !== '' && row.eventEditable) {
        cell.classList.add('clickable');
        cell.addEventListener('click', () => {
          const item = day.items.find(it => it.name === row.name && it.category === row.cat);
          if (!item) return;
          if (item.source === 'event') {
            const ev = state.events.find(e => `e-${e.id}` === item.id);
            openEventModal(ev, day.date);
          } else {
            const ri = state.recurring.find(r => `r-${r.id}` === item.id);
            openRecurringModal(ri);
          }
        });
      }

      grid.appendChild(cell);
    }
  }
}

// ── Toolbar ───────────────────────────────────────────────────────────────────
function bindToolbar() {
  document.getElementById('btn-add-event').addEventListener('click', () => openEventModal(null, state.from));
  document.getElementById('btn-add-recurring').addEventListener('click', () => openRecurringModal(null));

  document.getElementById('scenario-select').addEventListener('change', async e => {
    state.scenario = e.target.value;
    state.events = await api.getEvents(state.from, state.to, state.scenario);
    render();
  });

  document.getElementById('from-date').addEventListener('change', onDateChange);
  document.getElementById('to-date').addEventListener('change',   onDateChange);
}

async function onDateChange() {
  state.from = document.getElementById('from-date').value;
  state.to   = document.getElementById('to-date').value;
  if (state.from > state.to) return;
  state.events = await api.getEvents(state.from, state.to, state.scenario);
  render();
}

// ── Event Modal ───────────────────────────────────────────────────────────────
function openEventModal(ev, defaultDate) {
  editingEvent = ev ? ev.id : null;
  const m = document.getElementById('event-modal');
  m.querySelector('#ev-date').value      = ev?.date      ?? defaultDate ?? state.from;
  m.querySelector('#ev-name').value      = ev?.name      ?? '';
  m.querySelector('#ev-category').value  = ev?.category  ?? 'income';
  m.querySelector('#ev-direction').value = ev?.direction ?? 'in';
  m.querySelector('#ev-amount').value    = ev?.amount    ?? '';
  m.querySelector('#ev-currency').value  = ev?.currency  ?? 'ILS';
  m.querySelector('#ev-scenario').value  = ev?.scenario  ?? 'base';
  m.querySelector('#ev-confirmed').checked = ev ? Boolean(ev.confirmed) : true;
  m.querySelector('#ev-notes').value     = ev?.notes     ?? '';
  m.querySelector('#ev-delete-btn').style.display = ev ? '' : 'none';
  m.classList.add('open');
}

function bindModals() {
  // Event modal
  const evModal = document.getElementById('event-modal');
  evModal.querySelector('#ev-cancel').addEventListener('click', () => evModal.classList.remove('open'));
  evModal.querySelector('#ev-save').addEventListener('click', saveEvent);
  evModal.querySelector('#ev-delete-btn').addEventListener('click', deleteEvent);

  // Recurring modal
  const riModal = document.getElementById('recurring-modal');
  riModal.querySelector('#ri-cancel').addEventListener('click', () => riModal.classList.remove('open'));
  riModal.querySelector('#ri-save').addEventListener('click', saveRecurring);
  riModal.querySelector('#ri-delete-btn').addEventListener('click', deleteRecurring);

  // Account modal
  const accModal = document.getElementById('account-modal');
  accModal.querySelector('#acc-cancel').addEventListener('click', () => accModal.classList.remove('open'));
  accModal.querySelector('#acc-save').addEventListener('click', saveAccount);

  // Close on backdrop click
  for (const modal of document.querySelectorAll('.modal-overlay')) {
    modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('open'); });
  }

  // Recurring list panel
  document.getElementById('btn-show-recurring').addEventListener('click', renderRecurringPanel);
}

async function saveEvent() {
  const evModal = document.getElementById('event-modal');
  const data = {
    date:      evModal.querySelector('#ev-date').value,
    name:      evModal.querySelector('#ev-name').value.trim(),
    category:  evModal.querySelector('#ev-category').value,
    direction: evModal.querySelector('#ev-direction').value,
    amount:    Number(evModal.querySelector('#ev-amount').value),
    currency:  evModal.querySelector('#ev-currency').value,
    scenario:  evModal.querySelector('#ev-scenario').value,
    confirmed: evModal.querySelector('#ev-confirmed').checked ? 1 : 0,
    notes:     evModal.querySelector('#ev-notes').value.trim(),
  };
  if (!data.name || !data.amount) return alert('שם וסכום הם שדות חובה');
  if (editingEvent) {
    await api.updateEvent(editingEvent, data);
  } else {
    await api.createEvent(data);
  }
  evModal.classList.remove('open');
  state.events = await api.getEvents(state.from, state.to, state.scenario);
  render();
}

async function deleteEvent() {
  if (!editingEvent) return;
  if (!confirm('למחוק אירוע זה?')) return;
  await api.deleteEvent(editingEvent);
  document.getElementById('event-modal').classList.remove('open');
  state.events = await api.getEvents(state.from, state.to, state.scenario);
  render();
}

// ── Recurring Modal ───────────────────────────────────────────────────────────
function openRecurringModal(ri) {
  editingRecurring = ri ? ri.id : null;
  const m = document.getElementById('recurring-modal');
  m.querySelector('#ri-name').value      = ri?.name           ?? '';
  m.querySelector('#ri-category').value  = ri?.category       ?? 'operating';
  m.querySelector('#ri-direction').value = ri?.direction      ?? 'out';
  m.querySelector('#ri-amount').value    = ri?.amount         ?? '';
  m.querySelector('#ri-currency').value  = ri?.currency       ?? 'ILS';
  m.querySelector('#ri-day').value       = ri?.day_of_month   ?? 1;
  m.querySelector('#ri-method').value    = ri?.payment_method ?? '';
  m.querySelector('#ri-notes').value     = ri?.notes          ?? '';
  m.querySelector('#ri-active').checked  = ri ? Boolean(ri.active) : true;
  m.querySelector('#ri-delete-btn').style.display = ri ? '' : 'none';
  m.classList.add('open');
}

async function saveRecurring() {
  const m = document.getElementById('recurring-modal');
  const data = {
    name:           m.querySelector('#ri-name').value.trim(),
    category:       m.querySelector('#ri-category').value,
    direction:      m.querySelector('#ri-direction').value,
    amount:         Number(m.querySelector('#ri-amount').value),
    currency:       m.querySelector('#ri-currency').value,
    day_of_month:   Number(m.querySelector('#ri-day').value),
    payment_method: m.querySelector('#ri-method').value.trim(),
    notes:          m.querySelector('#ri-notes').value.trim(),
    active:         m.querySelector('#ri-active').checked ? 1 : 0,
  };
  if (!data.name || !data.amount) return alert('שם וסכום הם שדות חובה');
  if (editingRecurring) {
    await api.updateRecurring(editingRecurring, data);
  } else {
    await api.createRecurring(data);
  }
  m.classList.remove('open');
  state.recurring = await api.getRecurring();
  render();
}

async function deleteRecurring() {
  if (!editingRecurring) return;
  if (!confirm('למחוק פריט חוזר זה? (לא ישפיע על עבר)')) return;
  await api.deleteRecurring(editingRecurring);
  document.getElementById('recurring-modal').classList.remove('open');
  state.recurring = await api.getRecurring();
  render();
}

// ── Account Modal ─────────────────────────────────────────────────────────────
let editingAccountId = null;

function openAccountModal(id) {
  editingAccountId = id;
  const acc = state.accounts.find(a => a.id === id);
  const m = document.getElementById('account-modal');
  m.querySelector('#acc-name').textContent = acc.name;
  m.querySelector('#acc-balance').value = acc.balance;
  m.querySelector('#acc-currency').textContent = acc.currency;
  m.classList.add('open');
}

async function saveAccount() {
  const bal = Number(document.getElementById('acc-balance').value);
  await api.setBalance(editingAccountId, bal);
  state.accounts = await api.getAccounts();
  document.getElementById('account-modal').classList.remove('open');
  render();
}

// ── Recurring Panel ───────────────────────────────────────────────────────────
function renderRecurringPanel() {
  const panel = document.getElementById('recurring-panel');
  panel.innerHTML = `
    <div class="panel-header">
      <h3>פריטים חוזרים</h3>
      <button id="ri-panel-close">✕</button>
    </div>
    <table class="ri-table">
      <thead><tr>
        <th>שם</th><th>קטגוריה</th><th>כיוון</th><th>סכום</th><th>יום</th><th>פעיל</th><th></th>
      </tr></thead>
      <tbody>
        ${state.recurring.map(r => `
          <tr class="${r.active ? '' : 'inactive'}">
            <td>${r.name}</td>
            <td>${r.category}</td>
            <td>${r.direction === 'in' ? 'הכנסה' : 'הוצאה'}</td>
            <td>${fmt(r.amount)} ${r.currency}</td>
            <td>${r.day_of_month}</td>
            <td>${r.active ? '✓' : '—'}</td>
            <td><button class="btn-edit-ri" data-id="${r.id}">✎</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
    <button id="ri-panel-add" class="btn-primary">+ פריט חדש</button>
  `;
  panel.classList.add('open');

  panel.querySelector('#ri-panel-close').addEventListener('click', () => panel.classList.remove('open'));
  panel.querySelector('#ri-panel-add').addEventListener('click', () => {
    panel.classList.remove('open');
    openRecurringModal(null);
  });
  panel.querySelectorAll('.btn-edit-ri').forEach(btn => {
    btn.addEventListener('click', () => {
      const ri = state.recurring.find(r => r.id === Number(btn.dataset.id));
      panel.classList.remove('open');
      openRecurringModal(ri);
    });
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n) {
  return Math.round(n).toLocaleString('he-IL');
}

function el(tag, cls, text) {
  const d = document.createElement(tag);
  d.className = cls;
  if (text !== undefined) d.textContent = text;
  return d;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function formatDateHeader(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  const days = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'];
  return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

function setDateInputs() {
  document.getElementById('from-date').value = state.from;
  document.getElementById('to-date').value   = state.to;
}

// ── Go ────────────────────────────────────────────────────────────────────────
boot();
