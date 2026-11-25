// US stock market calendar: regular NYSE / Nasdaq hours in New York time.
//
// The regular session runs 9:30 am to 4:00 pm New York time on weekdays that
// are not exchange holidays, and closes at 1:00 pm on a few days around
// holidays. New York time (and its daylight-saving changes) comes from the
// browser's time-zone data through Intl, never from a fixed UTC offset.

const TZ = 'America/New_York';
const DAY_MS = 86_400_000;
const CLOSE_GRACE_MS = 15 * 60_000; // a session counts as finished 15 minutes after the close

// NYSE full-day closures, as published by the exchange.
const HOLIDAYS = {
  '2025-01-01': "New Year's Day",
  '2025-01-09': 'National Day of Mourning',
  '2025-01-20': 'Martin Luther King Jr. Day',
  '2025-02-17': "Presidents' Day",
  '2025-04-18': 'Good Friday',
  '2025-05-26': 'Memorial Day',
  '2025-06-19': 'Juneteenth',
  '2025-07-04': 'Independence Day',
  '2025-09-01': 'Labor Day',
  '2025-11-27': 'Thanksgiving',
  '2025-12-25': 'Christmas',

  '2026-01-01': "New Year's Day",
  '2026-01-19': 'Martin Luther King Jr. Day',
  '2026-02-16': "Presidents' Day",
  '2026-04-03': 'Good Friday',
  '2026-05-25': 'Memorial Day',
  '2026-06-19': 'Juneteenth',
  '2026-07-03': 'Independence Day',
  '2026-09-07': 'Labor Day',
  '2026-11-26': 'Thanksgiving',
  '2026-12-25': 'Christmas',

  '2027-01-01': "New Year's Day",
  '2027-01-18': 'Martin Luther King Jr. Day',
  '2027-02-15': "Presidents' Day",
  '2027-03-26': 'Good Friday',
  '2027-05-31': 'Memorial Day',
  '2027-06-18': 'Juneteenth',
  '2027-07-05': 'Independence Day',
  '2027-09-06': 'Labor Day',
  '2027-11-25': 'Thanksgiving',
  '2027-12-24': 'Christmas',
};
const LISTED_YEARS = new Set([2025, 2026, 2027]);

// ── Dates as 'YYYY-MM-DD' strings ────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return { y, m: mo, d, t };
}

const dateOfUtc = (t) => new Date(t).toISOString().slice(0, 10);
const addDays = (dateStr, n) => dateOfUtc(parseDate(dateStr).t + n * DAY_MS);
const weekdayOf = (dateStr) => new Date(parseDate(dateStr).t).getUTCDay(); // 0 = Sunday

// ── New York wall clock ─────────────────────────────────────────────────────
let partsFmt = null;
function etParts(ms) {
  partsFmt ??= new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = {};
  for (const { type, value } of partsFmt.formatToParts(new Date(ms))) p[type] = value;
  return { y: +p.year, m: +p.month, d: +p.day, hour: +p.hour % 24, minute: +p.minute, second: +p.second };
}

export function etDateOf(ms) {
  const p = etParts(ms);
  return ymd(p.y, p.m, p.d);
}

// The moment (ms) when New York clocks show `hour:minute` on `dateStr`.
function etTime(dateStr, hour, minute) {
  const { y, m, d } = parseDate(dateStr);
  const wall = Date.UTC(y, m - 1, d, hour, minute);
  let t = wall;
  for (let i = 0; i < 3; i++) {
    const p = etParts(t);
    const diff = wall - Date.UTC(p.y, p.m - 1, p.d, p.hour, p.minute, p.second);
    if (diff === 0) break;
    t += diff;
  }
  return t;
}

// ── Holidays for years outside the published list (same NYSE rules) ────────
function nthWeekday(y, month, weekday, n) { // n-th weekday of a month (n = -1: last)
  if (n > 0) {
    const first = new Date(Date.UTC(y, month - 1, 1)).getUTCDay();
    return ymd(y, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(y, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(y, month - 1, lastDay)).getUTCDay();
  return ymd(y, month, lastDay - ((last - weekday + 7) % 7));
}

function easterSunday(y) { // anonymous Gregorian algorithm
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return ymd(y, month, day);
}

// Saturday holidays move to Friday, Sunday holidays to Monday
// (except New Year's Day on a Saturday, which is not made up).
function observed(dateStr, { skipSaturday = false } = {}) {
  const wd = weekdayOf(dateStr);
  if (wd === 6) return skipSaturday ? null : addDays(dateStr, -1);
  if (wd === 0) return addDays(dateStr, 1);
  return dateStr;
}

export function computedHolidays(y) {
  const out = {};
  const add = (d, name) => { if (d) out[d] = name; };
  add(observed(ymd(y, 1, 1), { skipSaturday: true }), "New Year's Day");
  add(nthWeekday(y, 1, 1, 3), 'Martin Luther King Jr. Day');
  add(nthWeekday(y, 2, 1, 3), "Presidents' Day");
  add(addDays(easterSunday(y), -2), 'Good Friday');
  add(nthWeekday(y, 5, 1, -1), 'Memorial Day');
  if (y >= 2022) add(observed(ymd(y, 6, 19)), 'Juneteenth');
  add(observed(ymd(y, 7, 4)), 'Independence Day');
  add(nthWeekday(y, 9, 1, 1), 'Labor Day');
  add(nthWeekday(y, 11, 4, 4), 'Thanksgiving');
  add(observed(ymd(y, 12, 25)), 'Christmas');
  return out;
}

const computedCache = new Map();
function holidayName(dateStr) {
  const y = +dateStr.slice(0, 4);
  if (LISTED_YEARS.has(y)) return HOLIDAYS[dateStr] ?? null;
  if (!computedCache.has(y)) computedCache.set(y, computedHolidays(y));
  return computedCache.get(y)[dateStr] ?? null;
}

// ── Trading days ─────────────────────────────────────────────────────────────
export function isTradingDay(dateStr) {
  if (!parseDate(dateStr)) return false;
  const wd = weekdayOf(dateStr);
  return wd !== 0 && wd !== 6 && !holidayName(dateStr);
}

// Regular close at 1:00 pm: the day after Thanksgiving, Christmas Eve and
// July 3 (when they are trading days).
function isEarlyClose(dateStr) {
  if (!isTradingDay(dateStr)) return false;
  const { y, m, d } = parseDate(dateStr);
  if (m === 12 && d === 24) return true;
  if (m === 7 && d === 3) return true;
  return dateStr === addDays(nthWeekday(y, 11, 4, 4), 1);
}

function stepTradingDay(dateStr, dir) {
  let d = dateStr;
  for (let i = 0; i < 20; i++) {
    d = addDays(d, dir);
    if (isTradingDay(d)) return d;
  }
  return d;
}

const sessionOpen = (dateStr) => etTime(dateStr, 9, 30);
const sessionClose = (dateStr) => etTime(dateStr, isEarlyClose(dateStr) ? 13 : 16, 0);

// ── Labels ───────────────────────────────────────────────────────────────────
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clockLabel(hour, minute) {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${pad(minute)} ${hour < 12 ? 'am' : 'pm'} ET`;
}

function dayLabel(dateStr, todayStr) {
  if (dateStr === todayStr) return 'today';
  const days = Math.round((parseDate(dateStr).t - parseDate(todayStr).t) / DAY_MS);
  const wd = WEEKDAYS[weekdayOf(dateStr)];
  if (days <= 6) return wd;
  const { m, d } = parseDate(dateStr);
  return `${wd} ${MONTHS[m - 1]} ${d}`;
}

// Where the US market stands at `now`.
// → { open, reason: null|'weekend'|'holiday'|'before-open'|'after-close', todayET, closesAt, nextOpen,
//     lastCompletedSession, earlyClose, holiday, label }
export function usMarketStatus(now = Date.now()) {
  const todayET = etDateOf(now);
  const trading = isTradingDay(todayET);
  const wd = weekdayOf(todayET);
  const holiday = trading || wd === 0 || wd === 6 ? null : holidayName(todayET);
  const earlyClose = isEarlyClose(todayET);

  let open = false, reason, closesAt = null, nextOpenDay;
  let todayDone = false;
  if (!trading) {
    reason = holiday ? 'holiday' : 'weekend';
    nextOpenDay = stepTradingDay(todayET, 1);
  } else {
    const o = sessionOpen(todayET), c = sessionClose(todayET);
    todayDone = now >= c + CLOSE_GRACE_MS;
    if (now < o) { reason = 'before-open'; nextOpenDay = todayET; }
    else if (now >= c) { reason = 'after-close'; nextOpenDay = stepTradingDay(todayET, 1); }
    else { open = true; reason = null; closesAt = c; nextOpenDay = stepTradingDay(todayET, 1); }
  }

  const opens = `opens ${dayLabel(nextOpenDay, todayET)} ${clockLabel(9, 30)}`;
  let label;
  if (open) label = `Market open — closes ${clockLabel(earlyClose ? 13 : 16, 0)}${earlyClose ? ' (early close)' : ''}`;
  else if (reason === 'weekend') label = `Market closed (weekend) — ${opens}`;
  else if (reason === 'holiday') label = `Market closed (${holiday}) — ${opens}`;
  else if (reason === 'before-open') label = `Market not open yet — ${opens}`;
  else label = `Market closed for the day — ${opens}`;

  return {
    open, reason, todayET, closesAt,
    nextOpen: sessionOpen(nextOpenDay),
    lastCompletedSession: todayDone ? todayET : stepTradingDay(todayET, -1),
    earlyClose, holiday, label,
  };
}
