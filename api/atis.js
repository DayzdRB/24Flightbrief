// GET /api/atis            -> all airports' current ATIS
// GET /api/atis?airport=XX -> just one airport
// GET /api/atis?airports=XX,YY -> selected airports
//
// 24data's rules say requests must come from a server, not a
// browser, and to keep polling well under their suggested rate
// (10 req/min). Instead of a cron job, this refreshes its own cache
// on read whenever it's more than 60s old — that caps us at 1
// request/minute to 24data no matter how many visitors hit this
// endpoint. We also drop the `editor` field before caching, since
// we don't need it and their terms ask us to keep only what's
// necessary.

const { redisGet, redisSet } = require('../lib/redis');

const CACHE_KEY = 'atis:cache';
const CACHE_TTL_SECONDS = 120; // Redis auto-expires stale cache; refreshed well before this.
const REFRESH_AFTER_MS = 60 * 1000;

async function fetchFreshAtis() {
  const res = await fetch('https://24data.ptfs.app/atis');
  if (res.status === 503) {
    throw new Error('24data ATIS feed is temporarily unavailable (bot offline).');
  }
  if (!res.ok) throw new Error(`24data returned ${res.status}`);
  const list = await res.json();
  // Strip the editor field — keep only what this tool actually uses.
  return list.map(({ airport, letter, content, lines }) => ({ airport, letter, content, lines }));
}

module.exports = async (req, res) => {
  try {
    const cachedRaw = await redisGet(CACHE_KEY);
    let cached = cachedRaw ? JSON.parse(cachedRaw) : null;

    if (!cached || Date.now() - cached.fetchedAt > REFRESH_AFTER_MS) {
      try {
        const fresh = await fetchFreshAtis();
        cached = { fetchedAt: Date.now(), data: fresh };
        await redisSet(CACHE_KEY, JSON.stringify(cached), CACHE_TTL_SECONDS);
      } catch (err) {
        // If a refresh fails but we still have a (slightly stale) cache, serve that instead of erroring out.
        if (!cached) throw err;
      }
    }

    const url = new URL(req.url, `https://${req.headers.host}`);
    const requestedAirports = [
      ...url.searchParams.getAll('airport'),
      ...(url.searchParams.get('airports') || '').split(','),
    ]
      .map(value => value.trim().toUpperCase())
      .filter(Boolean);
    const requestedSet = new Set(requestedAirports);
    const data = requestedSet.size
      ? cached.data.filter(a => requestedSet.has(String(a.airport || '').toUpperCase()))
      : cached.data;

    res.status(200).json({ fetchedAt: cached.fetchedAt, data });
  } catch (err) {
    console.error('atis endpoint error:', err);
    res.status(502).json({ error: err.message || 'Could not fetch ATIS data' });
  }
};
