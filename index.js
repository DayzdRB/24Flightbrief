// GET  /api/plans   -> list the logged-in user's saved flight plans
// POST /api/plans    -> save a new one, body: { name, data }

const crypto = require('crypto');
const { getSessionUser } = require('../../lib/session');
const { redisGet, redisSet } = require('../../lib/redis');

async function loadPlans(userId) {
  const raw = await redisGet(`plans:${userId}`);
  return raw ? JSON.parse(raw) : [];
}

module.exports = async (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }

  try {
    if (req.method === 'GET') {
      const plans = await loadPlans(user.id);
      res.status(200).json(plans);
      return;
    }

    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { name, data } = JSON.parse(body || '{}');
      if (!data) {
        res.status(400).json({ error: 'Missing flight plan data' });
        return;
      }
      const plans = await loadPlans(user.id);
      const plan = { id: crypto.randomUUID(), name: name || 'Untitled plan', data, createdAt: Date.now() };
      plans.unshift(plan);
      // Keep the last 50 saved plans per user to avoid unbounded growth.
      await redisSet(`plans:${user.id}`, JSON.stringify(plans.slice(0, 50)));
      res.status(201).json(plan);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('plans/index error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
