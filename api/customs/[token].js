// GET /api/customs/:token
// PUT /api/customs/:token

const { methodNotAllowed, readJsonBody, sendHandlerError, setNoStore } = require('../../lib/http');
const { redisGet, redisSet } = require('../../lib/redis');
const { getSessionUser } = require('../../lib/session');

async function loadPlans(userId) {
  const raw = await redisGet(`plans:${userId}`);
  return raw ? JSON.parse(raw) : [];
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
    if (req.method === 'GET') {
      return res.status(200).json({
        id: plan.id,
        name: plan.name,
        data: plan.data,
        customs: plan.customs || { departure: {}, arrival: {} },
        ownerId: reference.ownerId,
        agent: { id: agent.id, username: agent.username },
      });
    }

    const input = await readJsonBody(req);
    const phase = input.phase === 'arrival' ? 'arrival' : 'departure';
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
      'depAirport',
      'arrAirport',
      'cruiseAlt',
      'perfVstall',
      'outV1',
      'outVR',
      'outV2',
      'outVref',
      'outVapp',
      'outCruise',
      'outNoFlaps',
    ];

    for (const key of whitelist) {
      if (Object.prototype.hasOwnProperty.call(amendments, key)) {
        fields[key] = String(amendments[key] || '').slice(0, 100);
      }
    }

    plan.data.performanceVersion = Number(input.performanceVersion || 2);
    plan.updatedAt = Date.now();
    plans[index] = plan;
    await redisSet(`plans:${reference.ownerId}`, JSON.stringify(plans));

    return res.status(200).json({
      ok: true,
      customs: plan.customs[phase],
      data: plan.data,
    });
  } catch (error) {
    console.error('customs error:', error);
    return sendHandlerError(res, error);
  }
};
