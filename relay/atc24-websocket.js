// 24data WebSocket relay — run exactly ONE instance on a persistent host.
//
// Mirrors the live 24data feeds into the shared Redis database that the
// Vercel functions read from:
//   ACFT_DATA    -> 24data:aircraft:websocket     (snapshot, 30s TTL)
//   CONTROLLERS  -> 24data:controllers:websocket  (snapshot, 30s TTL)
//   FLIGHT_PLAN  -> 24data:flightplans:websocket  (rolling list of recent plans)
//
// Flight plans are only available over the WebSocket (no REST route), so the
// "selected callsign" display on the navigation page depends on this worker.
// Per the 24data terms, plan data is pruned after FLIGHT_PLAN_RETENTION_MS
// (6 hours — far below the 14-day identifying-data limit).
//
// Per the 24data docs the Origin header must be unset or empty; the ws client
// does not send one by default.

const WebSocket = require('ws');
const { redisGet, redisSet } = require('../lib/redis');
const {
  AIRCRAFT_WEBSOCKET_KEY,
  CONTROLLERS_WEBSOCKET_KEY,
  FLIGHT_PLANS_KEY,
  FLIGHT_PLAN_RETENTION_MS,
} = require('../lib/atc24');

const WEBSOCKET_URL = process.env.ATC24_WEBSOCKET_URL || 'wss://24data.ptfs.app/wss';
const SNAPSHOT_TTL_SECONDS = 30;
const FLIGHT_PLAN_TTL_SECONDS = Math.ceil(FLIGHT_PLAN_RETENTION_MS / 1000);
const AIRCRAFT_WRITE_INTERVAL_MS = 1500; // feed arrives ~1/s; throttle Redis writes
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;

let flightPlans = [];
let lastAircraftWrite = 0;
let reconnectDelay = RECONNECT_BASE_MS;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function writeSnapshot(key, data) {
  await redisSet(key, JSON.stringify({ fetchedAt: Date.now(), data, source: 'websocket' }), SNAPSHOT_TTL_SECONDS);
}

function pruneFlightPlans() {
  const cutoff = Date.now() - FLIGHT_PLAN_RETENTION_MS;
  flightPlans = flightPlans.filter(plan => Number(plan.filedAt) >= cutoff);
}

async function persistFlightPlans() {
  pruneFlightPlans();
  await redisSet(
    FLIGHT_PLANS_KEY,
    JSON.stringify({ fetchedAt: Date.now(), data: flightPlans }),
    FLIGHT_PLAN_TTL_SECONDS
  );
}

function recordFlightPlan(payload) {
  if (!payload || typeof payload !== 'object') return;
  const plan = {
    robloxName: String(payload.robloxName || ''),
    callsign: String(payload.callsign || '').trim(),
    realcallsign: String(payload.realcallsign || '').trim(),
    aircraft: String(payload.aircraft || ''),
    flightrules: String(payload.flightrules || ''),
    departing: String(payload.departing || ''),
    arriving: String(payload.arriving || ''),
    flightlevel: String(payload.flightlevel || ''),
    filedAt: Date.now(),
  };
  if (!plan.callsign && !plan.realcallsign && !plan.robloxName) return;
  // A refile replaces the pilot's previous plan.
  flightPlans = flightPlans.filter(existing =>
    !(existing.robloxName && plan.robloxName && existing.robloxName === plan.robloxName)
  );
  flightPlans.push(plan);
}

async function seedFlightPlans() {
  try {
    const raw = await redisGet(FLIGHT_PLANS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.data)) {
      flightPlans = parsed.data;
      pruneFlightPlans();
      log(`Seeded ${flightPlans.length} flight plan(s) from Redis.`);
    }
  } catch {
    // Start empty if the stored snapshot is unreadable.
  }
}

async function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }
  const { t: type, d: data } = message || {};

  try {
    if (type === 'ACFT_DATA' && data && typeof data === 'object' && !Array.isArray(data)) {
      const now = Date.now();
      if (now - lastAircraftWrite >= AIRCRAFT_WRITE_INTERVAL_MS) {
        lastAircraftWrite = now;
        await writeSnapshot(AIRCRAFT_WEBSOCKET_KEY, data);
      }
    } else if (type === 'CONTROLLERS' && Array.isArray(data)) {
      await writeSnapshot(CONTROLLERS_WEBSOCKET_KEY, data);
    } else if (type === 'FLIGHT_PLAN' || type === 'EVENT_FLIGHT_PLAN') {
      recordFlightPlan(data);
      await persistFlightPlans();
    }
  } catch (error) {
    log('Redis write failed:', error.message);
  }
}

function connect() {
  log(`Connecting to ${WEBSOCKET_URL}`);
  const socket = new WebSocket(WEBSOCKET_URL);

  socket.on('open', () => {
    reconnectDelay = RECONNECT_BASE_MS;
    log('Connected to 24data WebSocket.');
  });

  socket.on('message', raw => { handleMessage(raw); });

  socket.on('error', error => log('WebSocket error:', error.message));

  socket.on('close', (code, reason) => {
    log(`WebSocket closed (${code} ${reason || 'no reason'}). Reconnecting in ${reconnectDelay}ms.`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(RECONNECT_MAX_MS, reconnectDelay * 2);
  });
}

(async () => {
  await seedFlightPlans();
  connect();
})();
