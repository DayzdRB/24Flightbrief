// PUT    /api/plans/:id  -> update a saved plan, body: { name, data }
// DELETE /api/plans/:id  -> delete a saved plan

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

  const { id } = req.query;

  try {
    const plans = await loadPlans(user.id);
    const idx = plans.findIndex(p => p.id === id);
    if (idx === -1) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    if (req.method === 'DELETE') {
      plans.splice(idx, 1);
      await redisSet(`plans:${user.id}`, JSON.stringify(plans));
      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === 'PUT') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const { name, data } = JSON.parse(body || '{}');
      plans[idx] = { ...plans[idx], name: name ?? plans[idx].name, data: data ?? plans[idx].data };
      await redisSet(`plans:${user.id}`, JSON.stringify(plans));
      res.status(200).json(plans[idx]);
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('plans/[id] error:', err);
    res.status(500).json({ error: 'Server error' });
  }
};
