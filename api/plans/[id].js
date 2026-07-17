// PUT    /api/plans/:id -> update a saved flight plan
// DELETE /api/plans/:id -> delete a saved flight plan

const { methodNotAllowed, readJsonBody, sendHandlerError, setNoStore } = require('../../lib/http');
const { redisDel, redisGet, redisSet } = require('../../lib/redis');
const { getSessionUser } = require('../../lib/session');

async function loadPlans(userId) {
  const raw = await redisGet(`plans:${userId}`);
  return raw ? JSON.parse(raw) : [];
}

module.exports = async (req, res) => {
  setNoStore(res);
  if (!['PUT', 'DELETE'].includes(req.method)) return methodNotAllowed(res, ['PUT', 'DELETE']);

  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  const id = String(req.query?.id || '');
  if (!id) return res.status(400).json({ error: 'Missing flight plan id' });

  try {
    const plans = await loadPlans(user.id);
    const index = plans.findIndex(plan => plan.id === id);
    if (index < 0) return res.status(404).json({ error: 'Not found' });

    if (req.method === 'DELETE') {
      const [deletedPlan] = plans.splice(index, 1);
      await redisSet(`plans:${user.id}`, JSON.stringify(plans));
      if (deletedPlan.customsToken) {
        await redisDel(`customs-token:${deletedPlan.customsToken}`);
      }
      return res.status(200).json({ ok: true });
    }

    const input = await readJsonBody(req);
    const existing = plans[index];
    plans[index] = {
      ...existing,
      name: input.name === undefined
        ? existing.name
        : String(input.name).trim().slice(0, 100) || 'Untitled plan',
      data: input.data === undefined ? existing.data : input.data,
      updatedAt: Date.now(),
    };

    await redisSet(`plans:${user.id}`, JSON.stringify(plans));
    return res.status(200).json(plans[index]);
  } catch (error) {
    console.error('plans/[id] error:', error);
    return sendHandlerError(res, error);
  }
};
