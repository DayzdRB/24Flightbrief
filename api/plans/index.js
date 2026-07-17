// GET  /api/plans -> list the logged-in user's saved flight plans
// POST /api/plans -> save a new flight plan

const crypto = require('crypto');
const { methodNotAllowed, readJsonBody, sendHandlerError, setNoStore } = require('../../lib/http');
const { redisGet, redisSet } = require('../../lib/redis');
const { getSessionUser } = require('../../lib/session');

async function loadPlans(userId) {
  const raw = await redisGet(`plans:${userId}`);
  return raw ? JSON.parse(raw) : [];
}

module.exports = async (req, res) => {
  setNoStore(res);
  if (!['GET', 'POST'].includes(req.method)) return methodNotAllowed(res, ['GET', 'POST']);

  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  try {
    if (req.method === 'GET') {
      return res.status(200).json(await loadPlans(user.id));
    }

    const { name, data } = await readJsonBody(req);
    if (!data || typeof data !== 'object') {
      return res.status(400).json({ error: 'Missing flight plan data' });
    }

    const plans = await loadPlans(user.id);
    const now = Date.now();
    const customsToken = crypto.randomBytes(24).toString('hex');
    const plan = {
      id: crypto.randomUUID(),
      name: String(name || 'Untitled plan').trim().slice(0, 100) || 'Untitled plan',
      data,
      createdAt: now,
      updatedAt: now,
      customs: {
        departure: { status: 'not-requested' },
        arrival: { status: 'not-requested' },
      },
      customsToken,
    };

    plans.unshift(plan);
    await redisSet(`plans:${user.id}`, JSON.stringify(plans.slice(0, 50)));
    await redisSet(
      `customs-token:${customsToken}`,
      JSON.stringify({ ownerId: user.id, planId: plan.id })
    );

    return res.status(201).json({
      ...plan,
      customsUrl: `/customs.html?token=${customsToken}`,
    });
  } catch (error) {
    console.error('plans/index error:', error);
    return sendHandlerError(res, error);
  }
};
