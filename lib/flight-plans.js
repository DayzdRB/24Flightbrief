const crypto = require('crypto');
const { redisGet, redisSet } = require('./redis');

function newToken() {
  return crypto.randomBytes(24).toString('hex');
}

async function loadPlans(userId) {
  const raw = await redisGet(`plans:${userId}`);
  return raw ? JSON.parse(raw) : [];
}

async function savePlans(userId, plans) {
  await redisSet(`plans:${userId}`, JSON.stringify(plans));
}

function defaultCustoms() {
  return {
    departure: { status: 'not-requested' },
    arrival: { status: 'not-requested' },
  };
}

function defaultPdc() {
  return {
    status: 'not-issued',
    clearance: null,
  };
}

function defaultTracking() {
  return {
    departureObservedAt: null,
    actualDepartureAt: null,
    arrivalUnlockedAt: null,
    actualArrivalAt: null,
    lastSeenAt: null,
    lastPosition: null,
  };
}

async function ensurePlanShape(plan, ownerId) {
  let changed = false;

  if (!plan.customs) {
    plan.customs = defaultCustoms();
    changed = true;
  }
  if (!plan.customs.departure) {
    plan.customs.departure = { status: 'not-requested' };
    changed = true;
  }
  if (!plan.customs.arrival) {
    plan.customs.arrival = { status: 'not-requested' };
    changed = true;
  }

  if (!plan.pdc) {
    plan.pdc = defaultPdc();
    changed = true;
  }
  if (plan.pdc.status === undefined) {
    plan.pdc.status = plan.pdc.clearance ? 'issued' : 'not-issued';
    changed = true;
  }

  const normalizedTracking = { ...defaultTracking(), ...(plan.tracking || {}) };
  if (!plan.tracking || Object.keys(normalizedTracking).some(key => plan.tracking[key] === undefined)) {
    changed = true;
  }
  plan.tracking = normalizedTracking;

  if (!plan.pdcToken) {
    plan.pdcToken = newToken();
    changed = true;
  }
  await redisSet(
    `pdc-token:${plan.pdcToken}`,
    JSON.stringify({ ownerId, planId: plan.id })
  );

  const legacyDepartureToken = plan.customsToken || plan.customsTokens?.departure;
  const departureToken = legacyDepartureToken || newToken();
  const arrivalToken = plan.customsTokens?.arrival || newToken();

  const tokensChanged = !plan.customsTokens
      || plan.customsTokens.departure !== departureToken
      || plan.customsTokens.arrival !== arrivalToken
      || plan.customsToken !== departureToken;
  if (tokensChanged) {
    plan.customsTokens = { departure: departureToken, arrival: arrivalToken };
    plan.customsToken = departureToken;
    changed = true;
    await redisSet(
      `customs-token:${departureToken}`,
      JSON.stringify({ ownerId, planId: plan.id, phase: 'departure' })
    );
    await redisSet(
      `customs-token:${arrivalToken}`,
      JSON.stringify({ ownerId, planId: plan.id, phase: 'arrival' })
    );
  }

  return changed;
}

function publicPlan(plan) {
  const departureToken = plan.customsTokens?.departure || plan.customsToken || null;
  const arrivalToken = plan.customsTokens?.arrival || null;
  const arrivalUnlocked = Boolean(plan.tracking?.arrivalUnlockedAt);
  const { customsTokens: _privateTokens, ...safePlan } = plan;
  return {
    ...safePlan,
    customsToken: departureToken,
    customsTokens: {
      departure: departureToken,
      arrival: arrivalUnlocked ? arrivalToken : null,
    },
    departureCustomsUrl: departureToken ? `/customs.html?token=${departureToken}` : null,
    arrivalCustomsUrl: arrivalUnlocked && arrivalToken
      ? `/customs.html?token=${arrivalToken}`
      : null,
    arrivalCustomsLocked: !arrivalUnlocked,
    pdcUrl: plan.pdcToken ? `/pdc.html?token=${plan.pdcToken}` : null,
  };
}

module.exports = {
  defaultCustoms,
  defaultPdc,
  defaultTracking,
  ensurePlanShape,
  loadPlans,
  newToken,
  publicPlan,
  savePlans,
};
