const { getSessionUser } = require('../../lib/session');
const { redisGet, redisSet } = require('../../lib/redis');

module.exports = async (req, res) => {
  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  const key = `profile:${user.id}`;
  try {
    if (req.method === 'GET') {
      const raw = await redisGet(key);
      return res.status(200).json(raw ? JSON.parse(raw) : { robloxUsername: '' });
    }
    if (req.method === 'PUT') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const input = JSON.parse(body || '{}');
      const robloxUsername = String(input.robloxUsername || '').trim().slice(0, 40);
      const profile = { discordUserId: user.id, discordUsername: user.username, robloxUsername, updatedAt: Date.now() };
      await redisSet(key, JSON.stringify(profile));
      return res.status(200).json(profile);
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('profile error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
};
