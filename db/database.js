const { Database } = require('node-sqlite3-wasm');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

const sha256 = pw => crypto.createHash('sha256').update(pw).digest('hex');

const DB_PATH = path.join(__dirname, 'cashflow.db');

// Remove stale lock directory left by a previous crashed process
try { fs.rmdirSync(DB_PATH + '.lock'); } catch (_) {}

const db = new Database(DB_PATH);

db.exec("PRAGMA foreign_keys = ON");

// node-sqlite3-wasm requires the @ prefix in the object keys to match @param SQL syntax.
// This helper converts { key: val } → { '@key': val } for all named-parameter calls.
const n = obj => Object.fromEntries(Object.entries(obj).map(([k, v]) => [`@${k}`, v]));

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT    NOT NULL,
    currency TEXT    NOT NULL DEFAULT 'ILS',
    balance  REAL    NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS fx_rates (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    currency     TEXT NOT NULL UNIQUE,
    rate_to_ils  REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS recurring_items (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL CHECK(category IN ('income','supplier','operating','financial')),
    direction       TEXT NOT NULL CHECK(direction IN ('in','out')),
    amount          REAL NOT NULL,
    currency        TEXT NOT NULL DEFAULT 'ILS',
    day_of_month    INTEGER NOT NULL CHECK(day_of_month BETWEEN 1 AND 31),
    payment_method  TEXT,
    notes           TEXT,
    active          INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    date      TEXT NOT NULL,
    name      TEXT NOT NULL,
    category  TEXT NOT NULL CHECK(category IN ('income','supplier','operating','financial')),
    direction TEXT NOT NULL CHECK(direction IN ('in','out')),
    amount    REAL NOT NULL,
    currency  TEXT NOT NULL DEFAULT 'ILS',
    scenario  TEXT NOT NULL DEFAULT 'base' CHECK(scenario IN ('base','optimistic','pessimistic','all')),
    confirmed INTEGER NOT NULL DEFAULT 1,
    notes     TEXT
  );

  CREATE TABLE IF NOT EXISTS users (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    email    TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  );
`);

// ── Seed (only if empty) ──────────────────────────────────────────────────────
function seedUsers() {
  const count = db.prepare('SELECT COUNT(*) as n FROM users').get().n;
  if (count > 0) return;
  const ins = db.prepare('INSERT INTO users (email, password) VALUES (@email, @password)');
  ins.run(n({ email: 'deborah555@gmail.com',      password: sha256('ShlomiCF123!') }));
  ins.run(n({ email: 'shlomi.nachum@amdocs.com',  password: sha256('ShlomiCF123!') }));
}

function seedIfEmpty() {
  const count = db.prepare('SELECT COUNT(*) as n FROM accounts').get().n;
  if (count > 0) return;

  db.exec('BEGIN');
  try {
    const insertAccount = db.prepare(
      'INSERT INTO accounts (name, currency, balance) VALUES (@name, @currency, @balance)'
    );
    insertAccount.run(n({ name: 'חשבון פועלים — שקלי',  currency: 'ILS', balance: 0 }));
    insertAccount.run(n({ name: 'חשבון פועלים — דולר',   currency: 'USD', balance: 0 }));
    insertAccount.run(n({ name: 'חשבון פועלים — אירו',   currency: 'EUR', balance: 0 }));
    insertAccount.run(n({ name: 'חשבון פועלים — ליש"ט', currency: 'GBP', balance: 0 }));

    const insertFX = db.prepare(
      'INSERT OR REPLACE INTO fx_rates (currency, rate_to_ils) VALUES (@currency, @rate)'
    );
    insertFX.run(n({ currency: 'USD', rate: 3.65 }));
    insertFX.run(n({ currency: 'EUR', rate: 3.95 }));
    insertFX.run(n({ currency: 'GBP', rate: 4.65 }));

    const insertRI = db.prepare(`
      INSERT INTO recurring_items
        (name, category, direction, amount, currency, day_of_month, payment_method)
      VALUES (@name, @category, @direction, @amount, @currency, @day_of_month, @payment_method)
    `);

    const ri = [
      { name: 'משכורות',                        category: 'operating', direction: 'out', amount: 89051, currency: 'ILS', day_of_month: 9,  payment_method: 'העברה ידנית עד 9 בחודש' },
      { name: 'ארנונה',                         category: 'operating', direction: 'out', amount: 10090, currency: 'ILS', day_of_month: 14, payment_method: 'הו"ק כ"א 2663' },
      { name: 'חשמל',                           category: 'operating', direction: 'out', amount: 2600,  currency: 'ILS', day_of_month: 14, payment_method: 'הו"ק כ"א 2663' },
      { name: 'שכר דירה — אלגוריתמוס',         category: 'operating', direction: 'out', amount: 16391, currency: 'ILS', day_of_month: 1,  payment_method: 'הו"ק בבנק' },
      { name: 'תחזוקת בניין — רז במערב',        category: 'operating', direction: 'out', amount: 7500,  currency: 'ILS', day_of_month: 1,  payment_method: 'העברה ידנית עד 5 בחודש' },
      { name: 'ליסינג רכב — גיא אפשטיין',       category: 'operating', direction: 'out', amount: 5380,  currency: 'ILS', day_of_month: 1,  payment_method: 'הו"ק בבנק' },
      { name: 'עו"ד עמליה פרנק — שכ"ד',        category: 'operating', direction: 'out', amount: 7078,  currency: 'ILS', day_of_month: 1,  payment_method: 'הו"ק בבנק' },
      { name: 'עו"ד עמליה פרנק — חניות',        category: 'operating', direction: 'out', amount: 1324,  currency: 'ILS', day_of_month: 1,  payment_method: 'הו"ק בבנק' },
      { name: 'קלריטי',                         category: 'operating', direction: 'out', amount: 260,   currency: 'ILS', day_of_month: 1,  payment_method: 'הרשאה בבנק' },
      { name: 'תן ביס',                         category: 'operating', direction: 'out', amount: 5640,  currency: 'ILS', day_of_month: 5,  payment_method: 'הרשאה בבנק' },
      { name: 'רו"ח — רוברט דניאל',             category: 'operating', direction: 'out', amount: 1180,  currency: 'ILS', day_of_month: 15, payment_method: 'הו"ק בבנק' },
      { name: 'דלק — גיא אפשטיין',              category: 'operating', direction: 'out', amount: 3000,  currency: 'ILS', day_of_month: 2,  payment_method: 'הרשאה בבנק' },
      { name: 'בזק',                            category: 'operating', direction: 'out', amount: 300,   currency: 'ILS', day_of_month: 20, payment_method: 'הו"ק כ"א 4522' },
      { name: 'כביש 6',                         category: 'operating', direction: 'out', amount: 160,   currency: 'ILS', day_of_month: 20, payment_method: 'הו"ק כ"א 2663' },
      { name: 'מי רעננה',                       category: 'operating', direction: 'out', amount: 200,   currency: 'ILS', day_of_month: 19, payment_method: 'הו"ק כ"א 4522' },
      { name: 'ביטוח רכב — הראל',               category: 'operating', direction: 'out', amount: 4572,  currency: 'ILS', day_of_month: 27, payment_method: 'הו"ק כ"א 4522/4514' },
      { name: 'איתוראן',                        category: 'operating', direction: 'out', amount: 88,    currency: 'ILS', day_of_month: 26, payment_method: 'הו"ק כ"א 4514' },
      { name: 'תמי 4',                          category: 'operating', direction: 'out', amount: 126,   currency: 'ILS', day_of_month: 18, payment_method: 'הו"ק כ"א 4522' },
      { name: 'קופות גמל / סוציאליות',          category: 'financial', direction: 'out', amount: 28716, currency: 'ILS', day_of_month: 15, payment_method: 'העברה ידנית עד 15 בחודש' },
      { name: 'מס הכנסה',                       category: 'financial', direction: 'out', amount: 27639, currency: 'ILS', day_of_month: 15, payment_method: 'הרשאה בבנק' },
      { name: 'ביטוח לאומי',                    category: 'financial', direction: 'out', amount: 23905, currency: 'ILS', day_of_month: 15, payment_method: 'הרשאה בבנק' },
      { name: 'מע"מ',                           category: 'financial', direction: 'out', amount: 40000, currency: 'ILS', day_of_month: 15, payment_method: 'הרשאה בבנק' },
      { name: 'הלוואה — מזרחי טפחות',           category: 'financial', direction: 'out', amount: 6960,  currency: 'ILS', day_of_month: 8,  payment_method: 'הו"ק בבנק' },
      { name: 'הלוואות — פועלים',               category: 'financial', direction: 'out', amount: 3000,  currency: 'ILS', day_of_month: 18, payment_method: 'הו"ק בבנק' },
      { name: 'ק.ל.ס — מימון רכב',              category: 'financial', direction: 'out', amount: 7660,  currency: 'ILS', day_of_month: 12, payment_method: 'הרשאה בבנק' },
    ];
    for (const row of ri) insertRI.run(n(row));

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

seedIfEmpty();
seedUsers();

// ── CRUD helpers ──────────────────────────────────────────────────────────────

// Accounts
exports.getAccounts   = () => db.prepare('SELECT * FROM accounts').all();
exports.updateAccount = (id, balance) =>
  db.prepare('UPDATE accounts SET balance = @balance WHERE id = @id').run(n({ id, balance }));

// FX rates
exports.getFxRates  = () => db.prepare('SELECT * FROM fx_rates').all();
exports.updateFxRate = (id, rate) =>
  db.prepare('UPDATE fx_rates SET rate_to_ils = @rate WHERE id = @id').run(n({ id, rate }));

// Recurring items
exports.getRecurringItems = () =>
  db.prepare('SELECT * FROM recurring_items ORDER BY day_of_month, name').all();

exports.createRecurringItem = (data) => {
  db.prepare(`
    INSERT INTO recurring_items
      (name, category, direction, amount, currency, day_of_month, payment_method, notes, active)
    VALUES (@name, @category, @direction, @amount, @currency, @day_of_month, @payment_method, @notes, @active)
  `).run(n(data));
  return { lastInsertRowid: db.lastInsertRowid };
};

exports.updateRecurringItem = (id, data) =>
  db.prepare(`
    UPDATE recurring_items SET
      name=@name, category=@category, direction=@direction,
      amount=@amount, currency=@currency, day_of_month=@day_of_month,
      payment_method=@payment_method, notes=@notes, active=@active
    WHERE id=@id
  `).run(n({ ...data, id }));

exports.deleteRecurringItem = (id) =>
  db.prepare('DELETE FROM recurring_items WHERE id = @id').run(n({ id }));

// Events
exports.getEvents = (from, to, scenario) => {
  if (scenario && scenario !== 'all') {
    return db.prepare(
      `SELECT * FROM events WHERE date >= @from AND date <= @to
       AND (scenario = @scenario OR scenario = 'all') ORDER BY date, name`
    ).all(n({ from, to, scenario }));
  }
  return db.prepare(
    'SELECT * FROM events WHERE date >= @from AND date <= @to ORDER BY date, name'
  ).all(n({ from, to }));
};

exports.createEvent = (data) => {
  db.prepare(`
    INSERT INTO events (date, name, category, direction, amount, currency, scenario, confirmed, notes)
    VALUES (@date, @name, @category, @direction, @amount, @currency, @scenario, @confirmed, @notes)
  `).run(n(data));
  return { lastInsertRowid: db.lastInsertRowid };
};

exports.updateEvent = (id, data) =>
  db.prepare(`
    UPDATE events SET
      date=@date, name=@name, category=@category, direction=@direction,
      amount=@amount, currency=@currency, scenario=@scenario, confirmed=@confirmed, notes=@notes
    WHERE id=@id
  `).run(n({ ...data, id }));

exports.deleteEvent = (id) =>
  db.prepare('DELETE FROM events WHERE id = @id').run(n({ id }));

// Users
exports.getUserByEmail = (email) =>
  db.prepare('SELECT * FROM users WHERE email = @email').get(n({ email }));

exports.sha256 = sha256;
