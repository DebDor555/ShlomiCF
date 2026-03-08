/**
 * Pure cashflow computation — no DOM, no fetch.
 *
 * compute(state) → array of DayResult objects, one per day in [from, to].
 *
 * state = {
 *   from:      'YYYY-MM-DD',
 *   to:        'YYYY-MM-DD',
 *   scenario:  'base' | 'optimistic' | 'pessimistic',
 *   accounts:  [{ id, currency, balance }],
 *   fxRates:   [{ currency, rate_to_ils }],   // ILS→ILS implicit = 1
 *   recurring: [{ id, name, category, direction, amount, currency, day_of_month, active }],
 *   events:    [{ id, date, name, category, direction, amount, currency, confirmed }],
 * }
 *
 * DayResult = {
 *   date:        'YYYY-MM-DD',
 *   dayOfMonth:  number,
 *   openingILS:  number,
 *   items: [{ id, name, category, direction, amountILS, source:'recurring'|'event', confirmed }],
 *   inILS:       number,
 *   outILS:      number,
 *   netILS:      number,
 *   closingILS:  number,
 * }
 */
export function compute(state) {
  const { from, to, accounts, fxRates, recurring, events } = state;

  // Build FX lookup  currency → rate_to_ils
  const fx = { ILS: 1 };
  for (const r of fxRates) fx[r.currency] = r.rate_to_ils;

  const toILS = (amount, currency) => amount * (fx[currency] ?? 1);

  // Opening balance = sum of all accounts in ILS
  const openingTotal = accounts.reduce(
    (sum, a) => sum + toILS(a.balance, a.currency), 0
  );

  // Index events by date
  const eventsByDate = {};
  for (const ev of events) {
    if (!eventsByDate[ev.date]) eventsByDate[ev.date] = [];
    eventsByDate[ev.date].push(ev);
  }

  // Active recurring items only
  const activeRecurring = recurring.filter(r => r.active);

  // Iterate day by day
  const results = [];
  let runningBalance = openingTotal;

  for (const date of dateRange(from, to)) {
    const dom = Number(date.slice(8, 10)); // day-of-month
    const items = [];

    // Recurring items due today
    for (const r of activeRecurring) {
      if (r.day_of_month === dom) {
        items.push({
          id:        `r-${r.id}`,
          name:      r.name,
          category:  r.category,
          direction: r.direction,
          amountILS: toILS(r.amount, r.currency),
          source:    'recurring',
          confirmed: true,
        });
      }
    }

    // One-off events on this date
    for (const ev of (eventsByDate[date] ?? [])) {
      items.push({
        id:        `e-${ev.id}`,
        name:      ev.name,
        category:  ev.category,
        direction: ev.direction,
        amountILS: toILS(ev.amount, ev.currency),
        source:    'event',
        confirmed: Boolean(ev.confirmed),
      });
    }

    const inILS  = items.filter(i => i.direction === 'in' ).reduce((s, i) => s + i.amountILS, 0);
    const outILS = items.filter(i => i.direction === 'out').reduce((s, i) => s + i.amountILS, 0);
    const netILS = inILS - outILS;

    results.push({
      date,
      dayOfMonth:   dom,
      openingILS:   runningBalance,
      items,
      inILS,
      outILS,
      netILS,
      closingILS:   runningBalance + netILS,
    });

    runningBalance += netILS;
  }

  return results;
}

// Yields 'YYYY-MM-DD' strings from start to end inclusive
function* dateRange(start, end) {
  const cur = new Date(start + 'T00:00:00');
  const last = new Date(end   + 'T00:00:00');
  while (cur <= last) {
    yield cur.toISOString().slice(0, 10);
    cur.setDate(cur.getDate() + 1);
  }
}
