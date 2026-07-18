const { redisDel, redisGet, redisSet, redisSetNx } = require('./redis');

const AIRCRAFT_CACHE_KEY = '24data:aircraft:cache';
const CONTROLLERS_CACHE_KEY = '24data:controllers:cache';
const AIRCRAFT_WEBSOCKET_KEY = '24data:aircraft:websocket';
const CONTROLLERS_WEBSOCKET_KEY = '24data:controllers:websocket';
const AIRCRAFT_REFRESH_MS = 3 * 1000;
const CONTROLLERS_REFRESH_MS = 6 * 1000;
const WEBSOCKET_STALE_MS = 5 * 1000;
const AIRCRAFT_FEED_URL = process.env.ATC24_AIRCRAFT_FEED_URL || 'https://24data.ptfs.app/acft-data';
const CONTROLLERS_FEED_URL = process.env.ATC24_CONTROLLERS_FEED_URL || 'https://24data.ptfs.app/controllers';

function parseSnapshot(raw) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || !Number.isFinite(Number(parsed.fetchedAt))) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function websocketSnapshot(key, expect) {
  const snapshot = parseSnapshot(await redisGet(key));
  if (!snapshot || Date.now() - Number(snapshot.fetchedAt) > WEBSOCKET_STALE_MS) return null;
  if (!expect(snapshot.data)) return null;
  return { ...snapshot, source: 'websocket' };
}

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function cachedRestFeed(cacheKey, refreshAfterMs, url, expect) {
  let cached = parseSnapshot(await redisGet(cacheKey));
  if (cached && Date.now() - Number(cached.fetchedAt) <= refreshAfterMs) {
    return { ...cached, source: cached.source || 'rest-cache' };
  }

  const lockKey = `${cacheKey}:refresh-lock`;
  const lockValue = `${process.pid || 'serverless'}:${Date.now()}:${Math.random()}`;
  const acquired = await redisSetNx(lockKey, lockValue, 5).catch(() => false);

  if (!acquired) {
    if (cached && expect(cached.data)) return { ...cached, source: cached.source || 'rest-stale' };
    await sleep(180);
    cached = parseSnapshot(await redisGet(cacheKey));
    if (cached && expect(cached.data)) return { ...cached, source: cached.source || 'rest-cache' };
    throw new Error('The shared ATC24 feed is refreshing. Try again momentarily.');
  }

  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': '24FlightBrief/1.0' },
    });
    if (!response.ok) throw new Error(`24data returned ${response.status}`);
    const data = await response.json();
    if (!expect(data)) throw new Error('24data returned an unexpected response.');
    cached = { fetchedAt: Date.now(), data, source: 'rest' };
    await redisSet(cacheKey, JSON.stringify(cached), 30);
    return cached;
  } catch (error) {
    if (cached && expect(cached.data)) return { ...cached, source: 'rest-stale' };
    throw error;
  } finally {
    await redisDel(lockKey).catch(() => {});
  }
}

async function getAircraftFeed() {
  const live = await websocketSnapshot(
    AIRCRAFT_WEBSOCKET_KEY,
    data => data && typeof data === 'object' && !Array.isArray(data)
  );
  if (live) return live;
  return cachedRestFeed(
    AIRCRAFT_CACHE_KEY,
    AIRCRAFT_REFRESH_MS,
    AIRCRAFT_FEED_URL,
    data => data && typeof data === 'object' && !Array.isArray(data)
  );
}

async function getControllerFeed() {
  const live = await websocketSnapshot(CONTROLLERS_WEBSOCKET_KEY, Array.isArray);
  if (live) return live;
  return cachedRestFeed(
    CONTROLLERS_CACHE_KEY,
    CONTROLLERS_REFRESH_MS,
    CONTROLLERS_FEED_URL,
    Array.isArray
  );
}

module.exports = {
  AIRCRAFT_WEBSOCKET_KEY,
  CONTROLLERS_WEBSOCKET_KEY,
  getAircraftFeed,
  getControllerFeed,
};
