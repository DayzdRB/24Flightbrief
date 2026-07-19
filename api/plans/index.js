// GET  /api/plans -> list the logged-in user's saved flight plans
// POST /api/plans -> save a new flight plan

const crypto = require('crypto');
const { methodNotAllowed, readJsonBody, sendHandlerError, setNoStore } = require('../../lib/http');
const {
  defaultCustoms,
  defaultPdc,
  defaultNavigation,
  defaultTracking,
  ensurePlanShape,
  loadPlans,
  newToken,
  publicPlan,
  savePlans,
} = require('../../lib/flight-plans');
const { redisSet } = require('../../lib/redis');
const { getSessionUser } = require('../../lib/session');

module.exports = async (req, res) => {
  setNoStore(res);
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);

  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  try {
    if (req.method === 'GET') {
      const plans = await loadPlans(user.id);
      let changed = false;
      for (const plan of plans) {
        if (await ensurePlanShape(plan, user.id)) changed = true;
      }
      if (changed) await savePlans(user.id, plans);
      return res.status(200).json(plans.map(publicPlan));
    }

    const { name, data } = await readJsonBody(req);
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Missing flight plan data' });
    }

    const plans = await loadPlans(user.id);
    const now = Date.now();
    const departureToken = newToken();
    const arrivalToken = newToken();
    const pdcToken = newToken();
    const plan = {
      id: crypto.randomUUID(),
      name: String(name || 'Untitled plan').trim().slice(0, 100) || 'Untitled plan',
      data,
      createdAt: now,
      updatedAt: now,
      customs: defaultCustoms(),
      customsTokens: { departure: departureToken, arrival: arrivalToken },
      customsToken: departureToken,
      tracking: defaultTracking(),
      navigation: defaultNavigation(),
      pdc: defaultPdc(),
      pdcToken,
    };

    plans.unshift(plan);
    await savePlans(user.id, plans.slice(0, 50));
    await redisSet(
      `customs-token:${departureToken}`,
      JSON.stringify({ ownerId: user.id, planId: plan.id, phase: 'departure' })
    );
    await redisSet(
      `pdc-token:${pdcToken}`,
      JSON.stringify({ ownerId: user.id, planId: plan.id })
    );
    await redisSet(
      `customs-token:${arrivalToken}`,
      JSON.stringify({ ownerId: user.id, planId: plan.id, phase: 'arrival' })
    );

    return res.status(201).json(publicPlan(plan));
  } catch (error) {
    console.error('plans/index error:', error);
    return sendHandlerError(res, error);
  }
};
