// Headlines and sentiment for the Briefing agent. Everything here is a public,
// key-less endpoint called straight from the browser; each source can fail on its
// own, and the Briefing simply reports which ones answered.

const FEEDS = [
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed' },
  { name: 'The Block', url: 'https://www.theblock.co/rss.xml' },
];

async function getJson(url, timeoutMs = 10_000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Only http(s) links are ever rendered as hrefs.
function safeUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : null;
  } catch { return null; }
}

function clean(title) {
  const el = typeof document !== 'undefined' ? document.createElement('textarea') : null;
  let t = String(title ?? '');
  if (el) { el.innerHTML = t; t = el.value; } // decode entities; value is plain text
  return t.replace(/\s+/g, ' ').trim().slice(0, 200);
}

async function fromRss(feed) {
  const json = await getJson(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`);
  if (json.status !== 'ok') throw new Error('feed error');
  return (json.items ?? []).map((it) => ({
    title: clean(it.title),
    url: safeUrl(it.link),
    source: feed.name,
    time: Date.parse(`${String(it.pubDate).replace(' ', 'T')}Z`) || null,
  }));
}

async function fromGdelt() {
  const q = encodeURIComponent('(bitcoin OR ethereum OR crypto) sourcelang:english');
  const json = await getJson(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=artlist&format=json&maxrecords=40&timespan=12h&sort=datedesc`);
  return (json.articles ?? []).map((a) => {
    const m = String(a.seendate ?? '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    return {
      title: clean(a.title), url: safeUrl(a.url), source: a.domain ?? 'GDELT',
      time: m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null,
    };
  });
}

async function fromHackerNews() {
  const since = Math.floor(Date.now() / 1000) - 86_400;
  const json = await getJson(`https://hn.algolia.com/api/v1/search_by_date?query=bitcoin&tags=story&hitsPerPage=30&numericFilters=created_at_i>${since}`);
  return (json.hits ?? []).map((h) => ({
    title: clean(h.title), url: safeUrl(h.url) ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    source: 'Hacker News', time: h.created_at_i ? h.created_at_i * 1000 : null,
  }));
}

// → { headlines: [{ title, url, source, time }], sources: [{ name, ok, count }] }
export async function fetchHeadlines() {
  const sources = [];
  let all = [];
  const settled = await Promise.allSettled(FEEDS.map(fromRss));
  settled.forEach((r, i) => {
    const ok = r.status === 'fulfilled' && r.value.length > 0;
    sources.push({ name: FEEDS[i].name, ok, count: ok ? r.value.length : 0 });
    if (ok) all = all.concat(r.value);
  });
  // Fall back to broader sources only when the feeds came back thin.
  for (const [name, fn] of [['GDELT', fromGdelt], ['Hacker News', fromHackerNews]]) {
    if (all.length >= 8) break;
    try {
      const items = await fn();
      sources.push({ name, ok: items.length > 0, count: items.length });
      all = all.concat(items);
    } catch {
      sources.push({ name, ok: false, count: 0 });
    }
  }
  const seen = new Set();
  const headlines = all
    .filter((h) => h.title)
    .filter((h) => { const k = h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
    .slice(0, 40);
  return { headlines, sources };
}

// Stock-market and industry feeds for the sector Briefings.
const MARKET_FEEDS = [
  { name: 'CNBC', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { name: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { name: 'Fierce Pharma', url: 'https://www.fiercepharma.com/rss/xml' },
  { name: 'STAT', url: 'https://www.statnews.com/feed/' },
  { name: 'OilPrice', url: 'https://oilprice.com/rss/main' },
  { name: 'Utility Dive', url: 'https://www.utilitydive.com/feeds/news/' },
  { name: 'TechCrunch', url: 'https://techcrunch.com/feed/' },
];

// → { headlines: [{ title, url, source, time }], sources: [{ name, ok, count }] }
export async function fetchMarketHeadlines() {
  const sources = [];
  let all = [];
  const settled = await Promise.allSettled(MARKET_FEEDS.map(fromRss));
  settled.forEach((r, i) => {
    const ok = r.status === 'fulfilled' && r.value.length > 0;
    sources.push({ name: MARKET_FEEDS[i].name, ok, count: ok ? r.value.length : 0 });
    if (ok) all = all.concat(r.value);
  });
  const seen = new Set();
  const headlines = all
    .filter((h) => h.title)
    .filter((h) => { const k = h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
    .slice(0, 120);
  return { headlines, sources };
}

// Headlines that mention one of a sector's keywords (or its tickers as whole words).
export function sectorHeadlines(headlines, sector) {
  const words = (sector.keywords ?? []).map((k) => k.toLowerCase());
  const tickers = new Set((sector.symbols ?? []).filter((t) => t.length >= 3));
  return (headlines ?? []).filter((h) => {
    const t = ` ${h.title.toLowerCase()} `;
    if (words.some((w) => t.includes(w))) return true;
    return (h.title.match(/\b[A-Z]{3,5}\b/g) ?? []).some((w) => tickers.has(w));
  });
}

// → { value: 0-100, label } or null
export async function fetchFearGreed() {
  try {
    const json = await getJson('https://api.alternative.me/fng/?limit=1&format=json');
    const d = json.data?.[0];
    const value = Number(d?.value);
    if (!Number.isFinite(value)) return null;
    return { value, label: String(d.value_classification ?? '').slice(0, 30) };
  } catch { return null; }
}
