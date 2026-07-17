// GET /api/network-status?callsign=Shamrock-1337
//
// Keeps 24data requests on the server, caches controller data for six seconds,
// and caches aircraft data for three seconds as requested by 24data.

const { redisGet, redisSet } = require('../lib/redis');
const { methodNotAllowed } = require('../lib/http');

const AIRCRAFT_CACHE_KEY = '24data:aircraft:cache';
const CONTROLLERS_CACHE_KEY = '24data:controllers:cache';
const AIRCRAFT_REFRESH_MS = 3 * 1000;
const CONTROLLERS_REFRESH_MS = 6 * 1000;

async function cachedFeed(cacheKey, refreshAfterMs, url, expect) {
  const cachedRaw = await redisGet(cacheKey);
  let cached = cachedRaw ? JSON.parse(cachedRaw) : null;

  if (!cached || Date.now() - cached.fetchedAt > refreshAfterMs) {
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error(`24data returned ${response.status}`);
      const data = await response.json();
      if (!expect(data)) throw new Error('24data returned an unexpected response.');
      cached = { fetchedAt: Date.now(), data };
      await redisSet(cacheKey, JSON.stringify(cached), 30);
    } catch (error) {
      if (!cached) throw error;
    }
  }

  return cached;
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const aircraft = await cachedFeed(
      AIRCRAFT_CACHE_KEY,
      AIRCRAFT_REFRESH_MS,
      'https://24data.ptfs.app/acft-data',
      data => data && typeof data === 'object' && !Array.isArray(data)
    );
    // A controller-feed outage should not stop a pilot from filing a plan when
    // their callsign has already been confirmed by the aircraft feed.
    const controllers = await cachedFeed(
      CONTROLLERS_CACHE_KEY,
      CONTROLLERS_REFRESH_MS,
      'https://24data.ptfs.app/controllers',
      Array.isArray
    ).catch(() => ({ fetchedAt: Date.now(), data: [] }));

    const requested = String(req.query?.callsign || '').trim();
    const normalized = requested.toUpperCase();
    const matchingCallsign = Object.keys(aircraft.data).find(callsign => callsign.toUpperCase() === normalized) || null;
    const onlinePositions = controllers.data
      .filter(position => position && position.holder)
      .map(position => `${String(position.airport || '').toUpperCase()}_${String(position.position || '').toUpperCase()}`);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      fetchedAt: Math.min(aircraft.fetchedAt, controllers.fetchedAt),
      callsign: requested ? { requested, valid: Boolean(matchingCallsign), matchingCallsign } : null,
      aircraftCallsigns: Object.keys(aircraft.data).sort((a, b) => a.localeCompare(b)),
      onlinePositions,
    });
  } catch (error) {
    console.error('network-status endpoint error:', error);
    return res.status(502).json({ error: error.message || 'Could not fetch ATC24 network data' });
  }
};
