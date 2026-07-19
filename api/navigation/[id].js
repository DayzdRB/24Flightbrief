// PUT /api/navigation/:id
// Applies pilot-controlled live navigation overrides without rewriting the
// filed PDC snapshot. Supported changes: direct-to waypoint and arrival runway.

const { methodNotAllowed, readJsonBody, sendHandlerError, setNoStore } = require('../../lib/http');
const { ensurePlanShape, loadPlans, publicPlan, savePlans } = require('../../lib/flight-plans');
const { WAYPOINTS } = require('../../lib/map-data');
const { getSessionUser } = require('../../lib/session');
const { findRunway, normalizeRunwayDesignator } = require('../../lib/runway-data');

function normalizeWaypoint(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function normalizeAirport(value) {
  const match = String(value || '').toUpperCase().match(/I[A-Z0-9]{3}/);
  return match ? match[0] : '';
}

module.exports = async (req, res) => {
  setNoStore(res);
  if (req.method !== 'PUT') return methodNotAllowed(res, ['PUT']);

  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Log in to update live navigation.' });

  const id = String(req.query?.id || '');
  if (!id) return res.status(400).json({ error: 'Missing flight plan id.' });

  try {
    const plans = await loadPlans(user.id);
    const index = plans.findIndex(plan => plan.id === id);
    if (index < 0) return res.status(404).json({ error: 'Flight plan not found.' });

    const plan = plans[index];
    await ensurePlanShape(plan, user.id);
    const input = await readJsonBody(req);
    const now = Date.now();

    if (Object.prototype.hasOwnProperty.call(input, 'directTo')) {
      const directTo = normalizeWaypoint(input.directTo);
      if (directTo && !WAYPOINTS[directTo]) {
        return res.status(400).json({ error: 'Direct-To must be a valid chart waypoint.' });
      }
      plan.navigation.directTo = directTo ? { code: directTo, setAt: now } : null;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'arrivalRunway')) {
      const airport = normalizeAirport(plan.data?.fields?.arrAirport);
      const runway = normalizeRunwayDesignator(input.arrivalRunway);
      if (!airport || !runway || !findRunway(airport, runway)) {
        return res.status(400).json({ error: 'Choose a mapped runway at the filed arrival airport.' });
      }
      plan.data ||= {};
      plan.data.fields ||= {};
      plan.data.fields.arrRunway = runway;
      plan.data.fields.arrRunwayEffective = runway;
      plan.navigation.arrivalRunwayUpdatedAt = now;
    }

    plan.updatedAt = now;
    plans[index] = plan;
    await savePlans(user.id, plans);
    return res.status(200).json({ ok: true, plan: publicPlan(plan) });
  } catch (error) {
    console.error('navigation update error:', error);
    return sendHandlerError(res, error, 'Could not update live navigation.');
  }
};
