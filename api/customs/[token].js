// GET /api/customs/:token
// PUT /api/customs/:token
// Each token is permanently bound to departure or arrival inspection.

const { methodNotAllowed, readJsonBody, sendHandlerError, setNoStore } = require('../../lib/http');
const { ensurePlanShape, loadPlans, savePlans } = require('../../lib/flight-plans');
const { redisGet, redisSet } = require('../../lib/redis');
const { getSessionUser } = require('../../lib/session');

function fieldEnabled(value) {
  return value === true || value === 1 || ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function inspectionActive(plan, phase) {
  const field = phase === 'arrival' ? 'requestArrivalCustoms' : 'requestDepartureCustoms';
  const status = plan.customs?.[phase]?.status;
  return fieldEnabled(plan.data?.fields?.[field]) || Boolean(status && status !== 'not-requested');
}

function arrivalAccessError(plan) {
  if (!inspectionActive(plan, 'arrival')) {
    return 'Arrival cargo inspection was not requested for this flight plan.';
  }
  if (inspectionActive(plan, 'departure') && plan.customs?.departure?.status !== 'approved') {
    return 'Arrival inspection is locked until the requested departure cargo inspection is approved.';
  }
  if (!plan.tracking?.arrivalUnlockedAt) {
    return 'Arrival inspection is locked until live tracking confirms the aircraft has landed near the destination.';
  }
  return null;
}

module.exports = async (req, res) => {
  setNoStore(res);
  if (!['GET', 'PUT'].includes(req.method)) return methodNotAllowed(res, ['GET', 'PUT']);

  const agent = getSessionUser(req);
  if (!agent) return res.status(401).json({ error: 'Sign in with Discord to inspect cargo.' });

  const token = String(req.query?.token || '');
  if (!token) return res.status(400).json({ error: 'Missing customs token.' });

  try {
    const referenceRaw = await redisGet(`customs-token:${token}`);
    if (!referenceRaw) return res.status(404).json({ error: 'Invalid or expired customs link.' });

    const reference = JSON.parse(referenceRaw);
    const plans = await loadPlans(reference.ownerId);
    const index = plans.findIndex(plan => plan.id === reference.planId);
    if (index < 0) return res.status(404).json({ error: 'Flight plan not found.' });

    const plan = plans[index];
    const changed = await ensurePlanShape(plan, reference.ownerId);
    const phase = reference.phase === 'arrival' ? 'arrival' : 'departure';
    if (!reference.phase) {
      reference.phase = phase;
      await redisSet(`customs-token:${token}`, JSON.stringify(reference));
    }
    if (changed) await savePlans(reference.ownerId, plans);

    if (phase === 'departure' && !inspectionActive(plan, 'departure')) {
      return res.status(403).json({ error: 'Departure cargo inspection was not requested for this flight plan.', phase });
    }
    if (phase === 'arrival') {
      const accessError = arrivalAccessError(plan);
      if (accessError) {
        return res.status(403).json({
          error: accessError,
          phase,
          departureStatus: plan.customs?.departure?.status || 'not-requested',
          arrivalUnlocked: Boolean(plan.tracking?.arrivalUnlockedAt),
        });
      }
    }

    if (req.method === 'GET') {
      return res.status(200).json({
        id: plan.id,
        name: plan.name,
        data: plan.data,
        customs: plan.customs,
        phase,
        inspection: plan.customs?.[phase] || { status: 'not-requested' },
        tracking: plan.tracking || {},
        ownerId: reference.ownerId,
        agent: { id: agent.id, username: agent.username },
      });
    }

    const input = await readJsonBody(req);
    const allowedDecisions = ['pending', 'approved', 'rejected', 'changes-requested'];
    const decision = allowedDecisions.includes(input.decision) ? input.decision : 'pending';

    plan.customs ||= { departure: {}, arrival: {} };
    plan.customs[phase] = {
      status: decision,
      itemDecisions: Array.isArray(input.itemDecisions)
        ? input.itemDecisions.map(item => ({
            index: Number(item.index),
            decision: item.decision === 'accepted' ? 'accepted' : 'rejected',
          }))
        : [],
      remarks: String(input.remarks || '').slice(0, 2000),
      signature: String(input.signature || '').trim().slice(0, 60),
      agentId: agent.id,
      agentDiscordUsername: agent.username,
      signedAt: Date.now(),
    };

    const amendments = input.amendments || {};
    const fields = plan.data.fields || (plan.data.fields = {});
    const whitelist = [
      'depAirport', 'arrAirport', 'cruiseAlt', 'perfVstall',
      'outV1', 'outVR', 'outV2', 'outVref', 'outVapp', 'outCruise', 'outNoFlaps',
    ];
    for (const key of whitelist) {
      if (Object.prototype.hasOwnProperty.call(amendments, key)) {
        fields[key] = String(amendments[key] || '').slice(0, 100);
      }
    }

    plan.data.performanceVersion = Number(input.performanceVersion || 2);
    plan.updatedAt = Date.now();

    // Merge the inspection into the newest stored plan. Tracking can update
    // concurrently while the customs agent is completing the form.
    const latestPlans = await loadPlans(reference.ownerId);
    const latestIndex = latestPlans.findIndex(item => item.id === reference.planId);
    if (latestIndex < 0) return res.status(404).json({ error: 'Flight plan not found.' });
    const latestPlan = latestPlans[latestIndex];
    latestPlan.customs ||= { departure: {}, arrival: {} };
    latestPlan.customs[phase] = plan.customs[phase];
    latestPlan.data ||= {};
    latestPlan.data.fields ||= {};
    for (const key of whitelist) {
      if (Object.prototype.hasOwnProperty.call(amendments, key)) {
        latestPlan.data.fields[key] = plan.data.fields[key];
      }
    }
    latestPlan.data.performanceVersion = plan.data.performanceVersion;
    latestPlan.updatedAt = plan.updatedAt;
    latestPlans[latestIndex] = latestPlan;
    await savePlans(reference.ownerId, latestPlans);

    return res.status(200).json({
      ok: true,
      phase,
      customs: latestPlan.customs[phase],
      allCustoms: latestPlan.customs,
      data: latestPlan.data,
    });
  } catch (error) {
    console.error('customs error:', error);
    return sendHandlerError(res, error);
  }
};
