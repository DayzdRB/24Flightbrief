const { getSessionUser } = require('../../lib/session');
const { redisGet, redisSet } = require('../../lib/redis');

async function loadPlans(userId) {
  const raw = await redisGet(`plans:${userId}`);
  return raw ? JSON.parse(raw) : [];
}

module.exports = async (req, res) => {
  const agent = getSessionUser(req);
  if (!agent) return res.status(401).json({ error: 'Sign in with Discord to inspect cargo.' });
  const token = String(req.query.token || '');
  try {
    const refRaw = await redisGet(`customs-token:${token}`);
    if (!refRaw) return res.status(404).json({ error: 'Invalid or expired customs link.' });
    const ref = JSON.parse(refRaw);
    const plans = await loadPlans(ref.ownerId);
    const idx = plans.findIndex(p => p.id === ref.planId);
    if (idx < 0) return res.status(404).json({ error: 'Flight plan not found.' });
    const plan = plans[idx];

    if (req.method === 'GET') {
      return res.status(200).json({
        id: plan.id, name: plan.name, data: plan.data,
        customs: plan.customs || { departure: {}, arrival: {} },
        ownerId: ref.ownerId, agent: { id: agent.id, username: agent.username }
      });
    }

    if (req.method === 'PUT') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || '{}');
      const phase = input.phase === 'arrival' ? 'arrival' : 'departure';
      const allowedDecision = ['pending','approved','rejected','changes-requested'];
      const decision = allowedDecision.includes(input.decision) ? input.decision : 'pending';
      plan.customs ||= { departure: {}, arrival: {} };
      plan.customs[phase] = {
        status: decision,
        itemDecisions: Array.isArray(input.itemDecisions) ? input.itemDecisions.map(x => ({ index: Number(x.index), decision: x.decision === 'accepted' ? 'accepted' : 'rejected' })) : [],
        remarks: String(input.remarks || '').slice(0, 2000),
        signature: String(input.signature || '').trim().slice(0, 60),
        agentId: agent.id,
        agentDiscordUsername: agent.username,
        signedAt: Date.now()
      };
      // Customs links may amend only the explicitly approved operational fields.
      const amendments = input.amendments || {};
      const fields = plan.data.fields || (plan.data.fields = {});
      const whitelist = ['depAirport','arrAirport','cruiseAlt','perfVstall','outV1','outVR','outV2','outVref','outVapp'];
      whitelist.forEach(key => {
        if (Object.prototype.hasOwnProperty.call(amendments, key)) fields[key] = String(amendments[key] || '').slice(0, 100);
      });
      plan.updatedAt = Date.now();
      plans[idx] = plan;
      await redisSet(`plans:${ref.ownerId}`, JSON.stringify(plans));
      return res.status(200).json({ ok: true, customs: plan.customs[phase], data: plan.data });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('customs error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
