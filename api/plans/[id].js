// PUT    /api/plans/:id -> update a saved flight plan
// DELETE /api/plans/:id -> delete a saved flight plan

const { methodNotAllowed, readJsonBody, sendHandlerError, setNoStore } = require('../../lib/http');
const { ensurePlanShape, loadPlans, publicPlan, savePlans } = require('../../lib/flight-plans');
const { redisDel } = require('../../lib/redis');
const { getSessionUser } = require('../../lib/session');

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

    await ensurePlanShape(plans[index], user.id);

    if (req.method === 'DELETE') {
      const [deletedPlan] = plans.splice(index, 1);
      await savePlans(user.id, plans);
      const tokens = new Set([
        deletedPlan.customsToken,
        deletedPlan.customsTokens?.departure,
        deletedPlan.customsTokens?.arrival,
      ].filter(Boolean));
      await Promise.all([...tokens].map(token => redisDel(`customs-token:${token}`)));
      if (deletedPlan.pdcToken) await redisDel(`pdc-token:${deletedPlan.pdcToken}`);
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

    await savePlans(user.id, plans);
    return res.status(200).json(publicPlan(plans[index]));
  } catch (error) {
    console.error('plans/[id] error:', error);
    return sendHandlerError(res, error);
  }
};
