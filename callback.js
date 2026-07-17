// GET /api/atis                  -> all airports' current ATIS
// GET /api/atis?airport=XX       -> one airport
// GET /api/atis?airports=XX,YY   -> selected airports

const { redisGet, redisSet } = require('../lib/redis');
const { methodNotAllowed } = require('../lib/http');

const CACHE_KEY = 'atis:cache';
const CACHE_TTL_SECONDS = 120;
const REFRESH_AFTER_MS = 60 * 1000;

async function fetchFreshAtis() {
  const response = await fetch('https://24data.ptfs.app/atis', {
    headers: { Accept: 'application/json' },
  });

  if (response.status === 503) {
    throw new Error('24data ATIS feed is temporarily unavailable.');
  }
  if (!response.ok) throw new Error(`24data returned ${response.status}`);

  const list = await response.json();
  if (!Array.isArray(list)) throw new Error('24data returned an unexpected response.');

  return list.map(({ airport, letter, content, lines }) => ({ airport, letter, content, lines }));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const cachedRaw = await redisGet(CACHE_KEY);
    let cached = cachedRaw ? JSON.parse(cachedRaw) : null;

    if (!cached || Date.now() - cached.fetchedAt > REFRESH_AFTER_MS) {
      try {
        const fresh = await fetchFreshAtis();
        cached = { fetchedAt: Date.now(), data: fresh };
        await redisSet(CACHE_KEY, JSON.stringify(cached), CACHE_TTL_SECONDS);
      } catch (error) {
        if (!cached) throw error;
      }
    }

    const query = req.query || {};
    const requestedAirports = [
      ...(Array.isArray(query.airport) ? query.airport : [query.airport]),
      ...String(query.airports || '').split(','),
    ]
      .filter(Boolean)
      .map(value => String(value).trim().toUpperCase())
      .filter(Boolean);

    const requestedSet = new Set(requestedAirports);
    const data = requestedSet.size
      ? cached.data.filter(item => requestedSet.has(String(item.airport || '').toUpperCase()))
      : cached.data;

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ fetchedAt: cached.fetchedAt, data });
  } catch (error) {
    console.error('atis endpoint error:', error);
    return res.status(502).json({ error: error.message || 'Could not fetch ATIS data' });
  }
};
