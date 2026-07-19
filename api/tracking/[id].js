// GET /api/tracking/:id
// Returns live ATC24 traffic, route progress and customs gating for the
// logged-in owner's saved flight plan.

const { getAircraftFeed, getFlightPlans } = require('../../lib/atc24');
const { methodNotAllowed, sendHandlerError, setNoStore } = require('../../lib/http');
const { ensurePlanShape, loadPlans, publicPlan, savePlans } = require('../../lib/flight-plans');
const {
  AIRPORTS,
  WAYPOINTS,
  CHART_WIDTH,
  CHART_HEIGHT,
  WORLD,
  STUDS_PER_NAUTICAL_MILE,
  GAME_KNOT_STUDS_PER_SECOND,
  REAL_KNOTS_PER_GAME_KNOT,
} = require('../../lib/map-data');
const { getSessionUser } = require('../../lib/session');

const DEPARTURE_AREA_RADIUS_STUDS = 7500;
const ARRIVAL_LANDING_RADIUS_STUDS = 5000;
const MIN_FLIGHT_TIME_BEFORE_ARRIVAL_MS = 60 * 1000;
const TRAFFIC_PROJECTION_SECONDS = 90;

function normalizeCode(value) {
  const match = String(value || '').toUpperCase().match(/I[A-Z0-9]{3}/);
  return match ? match[0] : String(value || '').trim().toUpperCase();
}

function normalizeWaypoint(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Loose key used to join /acft-data feed keys (in-game callsigns) against the
// pilot-typed `realcallsign` from FLIGHT_PLAN events, which has unreliable
// casing/punctuation (e.g. "channex-6725" vs "Channex-6725").
function callsignJoinKey(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Index recent filed flight plans so each live aircraft can be labelled with
// the pilot's selected callsign (what mainstream ATC24 clients display)
// instead of the raw in-game callsign.
function buildFlightPlanIndex(plans) {
  const byRealCallsign = new Map();
  const byPlayerName = new Map();
  for (const plan of plans || []) {
    if (!plan || !String(plan.callsign || '').trim()) continue;
    const realKey = callsignJoinKey(plan.realcallsign);
    const playerKey = String(plan.robloxName || '').trim().toUpperCase();
    if (realKey) byRealCallsign.set(realKey, plan);
    if (playerKey) byPlayerName.set(playerKey, plan);
  }
  return { byRealCallsign, byPlayerName };
}

function selectedCallsignFor(index, feedCallsign, playerName) {
  if (!index) return null;
  const plan = index.byRealCallsign.get(callsignJoinKey(feedCallsign))
    || index.byPlayerName.get(String(playerName || '').trim().toUpperCase());
  const selected = String(plan?.callsign || '').trim();
  return selected || null;
}

function aircraftPosition(aircraft) {
  const x = Number(aircraft?.position?.x);
  const y = Number(aircraft?.position?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

function toChart(position) {
  return {
    x: ((position.x - WORLD.minX) / (WORLD.maxX - WORLD.minX)) * CHART_WIDTH,
    y: ((position.y - WORLD.minY) / (WORLD.maxY - WORLD.minY)) * CHART_HEIGHT,
  };
}

function chartToWorld(position) {
  if (!position) return null;
  return {
    x: WORLD.minX + (position.x / CHART_WIDTH) * (WORLD.maxX - WORLD.minX),
    y: WORLD.minY + (position.y / CHART_HEIGHT) * (WORLD.maxY - WORLD.minY),
  };
}

function distance(a, b) {
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function nm(studs) {
  return Number.isFinite(studs) ? studs / STUDS_PER_NAUTICAL_MILE : null;
}

function flightLevel(altitude) {
  return `FL${String(Math.max(0, Math.round((Number(altitude) || 0) / 100))).padStart(3, '0')}`;
}

function compactAircraft(callsign, aircraft, flightPlanIndex) {
  const position = aircraftPosition(aircraft);
  if (!position) return null;
  const altitude = Number(aircraft.altitude) || 0;
  const groundSpeed = Number(aircraft.groundSpeed) || 0;
  return {
    callsign,
    displayCallsign: selectedCallsignFor(flightPlanIndex, callsign, aircraft.playerName) || callsign,
    playerName: String(aircraft.playerName || ''),
    aircraftType: String(aircraft.aircraftType || ''),
    altitude,
    flightLevel: flightLevel(altitude),
    speed: Number(aircraft.speed) || 0,
    groundSpeed,
    movementKnots: groundSpeed * REAL_KNOTS_PER_GAME_KNOT,
    heading: Number(aircraft.heading) || 0,
    isOnGround: typeof aircraft.isOnGround === 'boolean' ? aircraft.isOnGround : null,
    wind: String(aircraft.wind || ''),
    isEmergencyOccuring: Boolean(aircraft.isEmergencyOccuring),
    position,
    mapPosition: toChart(position),
  };
}

function routeNodes(plan) {
  const fields = plan.data?.fields || {};
  const departureCode = normalizeCode(fields.depAirport);
  const arrivalCode = normalizeCode(fields.arrAirport);
  const nodes = [];

  if (AIRPORTS[departureCode]) {
    nodes.push({ code: departureCode, kind: 'departure', mapPosition: AIRPORTS[departureCode] });
  }
  if ((plan.data?.routeType || 'waypoints') === 'waypoints') {
    for (const item of plan.data?.waypoints || []) {
      const code = normalizeWaypoint(item?.wp);
      if (code && WAYPOINTS[code]) {
        nodes.push({ code, kind: 'waypoint', mapPosition: WAYPOINTS[code] });
      }
    }
  }
  if (AIRPORTS[arrivalCode]) {
    nodes.push({ code: arrivalCode, kind: 'arrival', mapPosition: AIRPORTS[arrivalCode] });
  }
  return nodes.map(node => ({ ...node, worldPosition: chartToWorld(node.mapPosition) }));
}

function closestPointOnSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return { point: start, t: 0, distance: distance(point, start) || 0 };
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  const projection = { x: start.x + dx * t, y: start.y + dy * t };
  return { point: projection, t, distance: distance(point, projection) || 0 };
}

function calculateRouteProgress(nodes, aircraft) {
  if (nodes.length < 2) {
    return {
      nextWaypoint: nodes[0] || null,
      distanceToNextStuds: nodes[0] && aircraft ? distance(aircraft.position, nodes[0].worldPosition) : null,
      bearingToNextDeg: nodes[0] && aircraft ? bearingBetween(aircraft.position, nodes[0].worldPosition) : null,
      remainingStuds: null,
      remainingNm: null,
      progressPercent: null,
      etaMinutes: null,
    };
  }

  const segmentLengths = [];
  let totalStuds = 0;
  for (let index = 0; index < nodes.length - 1; index += 1) {
    const length = distance(nodes[index].worldPosition, nodes[index + 1].worldPosition) || 0;
    segmentLengths.push(length);
    totalStuds += length;
  }

  if (!aircraft) {
    return {
      nextWaypoint: nodes[1],
      distanceToNextStuds: null,
      distanceToNextNm: null,
      bearingToNextDeg: null,
      remainingStuds: totalStuds,
      remainingNm: nm(totalStuds),
      progressPercent: 0,
      crossTrackStuds: null,
      crossTrackNm: null,
      etaMinutes: null,
    };
  }

  let best = null;
  let cumulativeBefore = 0;
  for (let index = 0; index < segmentLengths.length; index += 1) {
    const projection = closestPointOnSegment(
      aircraft.position,
      nodes[index].worldPosition,
      nodes[index + 1].worldPosition
    );
    const candidate = {
      ...projection,
      segmentIndex: index,
      alongStuds: cumulativeBefore + segmentLengths[index] * projection.t,
    };
    if (!best || candidate.distance < best.distance) best = candidate;
    cumulativeBefore += segmentLengths[index];
  }

  const nextIndex = Math.min(nodes.length - 1, best.segmentIndex + 1);
  const nextWaypoint = nodes[nextIndex];
  const remainingStuds = Math.max(0, totalStuds - best.alongStuds);
  const distanceToNextStuds = distance(aircraft.position, nextWaypoint.worldPosition);
  const movementKnots = Math.max(0, aircraft.movementKnots || 0);
  const remainingNauticalMiles = nm(remainingStuds);
  const etaMinutes = movementKnots >= 5 && remainingNauticalMiles !== null
    ? (remainingNauticalMiles / movementKnots) * 60
    : null;

  return {
    nextWaypoint: { code: nextWaypoint.code, kind: nextWaypoint.kind, mapPosition: nextWaypoint.mapPosition },
    distanceToNextStuds,
    distanceToNextNm: nm(distanceToNextStuds),
    // Course the aircraft should fly (in the game's heading frame, 360 = north)
    // to reach the next route node from its present position.
    bearingToNextDeg: bearingBetween(aircraft.position, nextWaypoint.worldPosition),
    remainingStuds,
    remainingNm: remainingNauticalMiles,
    progressPercent: totalStuds > 0 ? Math.max(0, Math.min(100, (best.alongStuds / totalStuds) * 100)) : 0,
    crossTrackStuds: best.distance,
    crossTrackNm: nm(best.distance),
    etaMinutes,
  };
}

function velocity(aircraft) {
  const radians = (Number(aircraft.heading) || 0) * Math.PI / 180;
  const studsPerSecond = Math.max(0, Number(aircraft.groundSpeed) || 0) * GAME_KNOT_STUDS_PER_SECOND;
  return { x: Math.sin(radians) * studsPerSecond, y: -Math.cos(radians) * studsPerSecond };
}

function closestApproach(own, traffic) {
  const relativePosition = {
    x: traffic.position.x - own.position.x,
    y: traffic.position.y - own.position.y,
  };
  const ownVelocity = velocity(own);
  const trafficVelocity = velocity(traffic);
  const relativeVelocity = {
    x: trafficVelocity.x - ownVelocity.x,
    y: trafficVelocity.y - ownVelocity.y,
  };
  const velocitySquared = relativeVelocity.x ** 2 + relativeVelocity.y ** 2;
  let seconds = 0;
  if (velocitySquared > 0.0001) {
    seconds = Math.max(0, Math.min(
      TRAFFIC_PROJECTION_SECONDS,
      -((relativePosition.x * relativeVelocity.x) + (relativePosition.y * relativeVelocity.y)) / velocitySquared
    ));
  }
  const projected = {
    x: relativePosition.x + relativeVelocity.x * seconds,
    y: relativePosition.y + relativeVelocity.y * seconds,
  };
  return { seconds, distanceStuds: Math.hypot(projected.x, projected.y) };
}

function bearingBetween(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
}

function clockPosition(own, traffic) {
  const bearing = bearingBetween(own.position, traffic.position);
  const relative = (bearing - own.heading + 360) % 360;
  const clock = Math.round(relative / 30) % 12;
  return clock === 0 ? 12 : clock;
}

function trafficAdvisory(own, traffic) {
  const currentStuds = distance(own.position, traffic.position) || Infinity;
  const currentNm = nm(currentStuds);
  const verticalSeparation = Math.abs(traffic.altitude - own.altitude);
  const cpa = closestApproach(own, traffic);
  const cpaNm = nm(cpa.distanceStuds);

  let level = null;
  if ((currentNm <= 1.5 || (cpaNm <= 1 && cpa.seconds <= 60)) && verticalSeparation <= 500) {
    level = 'warning';
  } else if ((currentNm <= 3 || cpaNm <= 2) && verticalSeparation <= 1000) {
    level = 'caution';
  } else if ((currentNm <= 6 || cpaNm <= 4) && verticalSeparation <= 2000) {
    level = 'advisory';
  }
  if (!level) return null;

  const verticalDelta = Math.round(traffic.altitude - own.altitude);
  const verticalText = verticalDelta === 0
    ? 'same altitude'
    : `${Math.abs(verticalDelta).toLocaleString()} ft ${verticalDelta > 0 ? 'above' : 'below'}`;
  const clock = clockPosition(own, traffic);
  const displayName = traffic.displayCallsign || traffic.callsign;
  return {
    level,
    callsign: traffic.callsign,
    displayCallsign: displayName,
    flightLevel: traffic.flightLevel,
    speed: Math.round(traffic.groundSpeed),
    clock,
    distanceNm: currentNm,
    verticalSeparation,
    cpaDistanceNm: cpaNm,
    cpaSeconds: cpa.seconds,
    message: `${displayName}, ${clock} o’clock, ${currentNm.toFixed(1)} NM, ${verticalText}`,
  };
}

function levelRank(level) {
  return { warning: 0, caution: 1, advisory: 2 }[level] ?? 3;
}

module.exports = async (req, res) => {
  setNoStore(res);
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Log in to navigate a saved flight plan.' });

  const id = String(req.query?.id || '');
  if (!id) return res.status(400).json({ error: 'Missing flight plan id.' });

  try {
    const plans = await loadPlans(user.id);
    const index = plans.findIndex(plan => plan.id === id);
    if (index < 0) return res.status(404).json({ error: 'Flight plan not found.' });

    const plan = plans[index];
    let changed = await ensurePlanShape(plan, user.id);
    const fields = plan.data?.fields || {};
    const requestedCallsign = String(fields.fdIngameCallsign || '').trim();
    const departureCode = normalizeCode(fields.depAirport);
    const arrivalCode = normalizeCode(fields.arrAirport);
    const departureChart = AIRPORTS[departureCode] || null;
    const arrivalChart = AIRPORTS[arrivalCode] || null;
    const departureWorld = chartToWorld(departureChart);
    const arrivalWorld = chartToWorld(arrivalChart);

    const feed = await getAircraftFeed();
    // Filed callsigns arrive via the WebSocket relay only; degrade to in-game
    // callsigns when the relay is offline.
    const flightPlanFeed = await getFlightPlans().catch(() => ({ data: [] }));
    const flightPlanIndex = buildFlightPlanIndex(flightPlanFeed.data);
    const matchingCallsign = Object.keys(feed.data)
      .find(callsign => callsign.toUpperCase() === requestedCallsign.toUpperCase()) || null;
    const aircraft = matchingCallsign ? compactAircraft(matchingCallsign, feed.data[matchingCallsign], flightPlanIndex) : null;
    const now = Date.now();

    let departureDistance = null;
    let arrivalDistance = null;
    let landedAtDestination = false;
    if (aircraft) {
      departureDistance = distance(aircraft.position, departureWorld);
      arrivalDistance = distance(aircraft.position, arrivalWorld);
      if (!plan.tracking.lastSeenAt || now - plan.tracking.lastSeenAt >= 15000) {
        plan.tracking.lastSeenAt = now;
        plan.tracking.lastPosition = aircraft.position;
        changed = true;
      }

      if (departureDistance !== null && departureDistance <= DEPARTURE_AREA_RADIUS_STUDS) {
        if (!plan.tracking.departureObservedAt) {
          plan.tracking.departureObservedAt = now;
          changed = true;
        }
      }

      const clearlyLeftDeparture = departureDistance !== null
        && departureDistance > DEPARTURE_AREA_RADIUS_STUDS;
      const airborneAfterDepartureObservation = Boolean(plan.tracking.departureObservedAt)
        && aircraft.isOnGround === false;
      const filedWhileEnroute = !plan.tracking.departureObservedAt
        && aircraft.isOnGround === false
        && arrivalDistance !== null
        && arrivalDistance > ARRIVAL_LANDING_RADIUS_STUDS;

      if (!plan.tracking.actualDepartureAt
          && ((clearlyLeftDeparture && plan.tracking.departureObservedAt)
            || airborneAfterDepartureObservation
            || filedWhileEnroute)) {
        plan.tracking.actualDepartureAt = now;
        changed = true;
      }

      const insideLandingArea = arrivalDistance !== null
        && arrivalDistance <= ARRIVAL_LANDING_RADIUS_STUDS;
      const positiveGroundLanding = aircraft.isOnGround === true
        && aircraft.groundSpeed <= 50;
      const helicopterLandingFallback = aircraft.isOnGround === null
        && aircraft.altitude <= 500
        && aircraft.groundSpeed <= 30;
      landedAtDestination = insideLandingArea
        && (positiveGroundLanding || helicopterLandingFallback);

      const departureApproved = plan.customs?.departure?.status === 'approved';
      const flightOldEnough = plan.tracking.actualDepartureAt
        && now - plan.tracking.actualDepartureAt >= MIN_FLIGHT_TIME_BEFORE_ARRIVAL_MS;

      if (!plan.tracking.arrivalUnlockedAt
          && departureApproved
          && flightOldEnough
          && landedAtDestination) {
        plan.tracking.arrivalUnlockedAt = now;
        plan.tracking.actualArrivalAt ||= now;
        changed = true;
      }
    }

    if (changed) {
      const latestPlans = await loadPlans(user.id);
      const latestIndex = latestPlans.findIndex(item => item.id === id);
      if (latestIndex >= 0) {
        const latestPlan = latestPlans[latestIndex];
        latestPlans[latestIndex] = {
          ...latestPlan,
          customsToken: plan.customsToken,
          customsTokens: plan.customsTokens,
          customs: {
            departure: latestPlan.customs?.departure || plan.customs?.departure || { status: 'not-requested' },
            arrival: latestPlan.customs?.arrival || plan.customs?.arrival || { status: 'not-requested' },
          },
          tracking: plan.tracking,
        };
        await savePlans(user.id, latestPlans);
        plan.customs = latestPlans[latestIndex].customs;
      }
    }

    const allAircraft = Object.entries(feed.data)
      .map(([callsign, data]) => compactAircraft(callsign, data, flightPlanIndex))
      .filter(Boolean);
    const nearbyAircraft = allAircraft
      .filter(item => item.callsign !== matchingCallsign)
      .map(item => ({
        ...item,
        distanceFromTracked: aircraft ? distance(item.position, aircraft.position) : null,
        distanceFromTrackedNm: aircraft ? nm(distance(item.position, aircraft.position)) : null,
      }))
      .sort((a, b) => (a.distanceFromTracked ?? Infinity) - (b.distanceFromTracked ?? Infinity));

    const advisories = aircraft
      ? nearbyAircraft
          .map(item => trafficAdvisory(aircraft, item))
          .filter(Boolean)
          .sort((a, b) => levelRank(a.level) - levelRank(b.level)
            || a.cpaDistanceNm - b.cpaDistanceNm)
          .slice(0, 8)
      : [];

    const nodes = routeNodes(plan);
    const route = calculateRouteProgress(nodes, aircraft);
    const publicData = publicPlan(plan);
    return res.status(200).json({
      fetchedAt: feed.fetchedAt,
      feedSource: feed.source || 'rest-cache',
      plan: {
        id: plan.id,
        name: plan.name,
        fields,
        waypoints: plan.data?.waypoints || [],
        routeType: plan.data?.routeType || 'waypoints',
        customs: plan.customs,
        tracking: plan.tracking,
        departureCustomsUrl: publicData.departureCustomsUrl,
        arrivalCustomsUrl: publicData.arrivalCustomsUrl,
      },
      requestedCallsign,
      matchingCallsign,
      aircraft,
      nearbyAircraft,
      trafficAdvisories: advisories,
      route: {
        ...route,
        nodes: nodes.map(node => ({ code: node.code, kind: node.kind, mapPosition: node.mapPosition })),
      },
      destination: {
        code: arrivalCode,
        mapPosition: arrivalChart,
        distanceStuds: arrivalDistance,
        distanceNm: nm(arrivalDistance),
        insideLandingArea: arrivalDistance !== null && arrivalDistance <= ARRIVAL_LANDING_RADIUS_STUDS,
        landedAtDestination,
        arrivalLandingRadiusStuds: ARRIVAL_LANDING_RADIUS_STUDS,
        arrivalLandingRadiusMap: ARRIVAL_LANDING_RADIUS_STUDS * CHART_WIDTH / (WORLD.maxX - WORLD.minX),
      },
      departure: {
        code: departureCode,
        mapPosition: departureChart,
        distanceStuds: departureDistance,
        distanceNm: nm(departureDistance),
        observed: Boolean(plan.tracking.departureObservedAt),
        departed: Boolean(plan.tracking.actualDepartureAt),
      },
      arrivalUnlocked: Boolean(plan.tracking.arrivalUnlockedAt),
    });
  } catch (error) {
    console.error('tracking endpoint error:', error);
    return sendHandlerError(res, error, 'Could not retrieve live ATC24 tracking data.');
  }
};
