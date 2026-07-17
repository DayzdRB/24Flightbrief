// GET /api/profile
// PUT /api/profile

const { methodNotAllowed, readJsonBody, sendHandlerError, setNoStore } = require('../../lib/http');
const { redisGet, redisSet } = require('../../lib/redis');
const { getSessionUser } = require('../../lib/session');

module.exports = async (req, res) => {
  setNoStore(res);
  if (!['GET', 'PUT'].includes(req.method)) return methodNotAllowed(res, ['GET', 'PUT']);

  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  const key = `profile:${user.id}`;
  try {
    if (req.method === 'GET') {
      const raw = await redisGet(key);
      return res.status(200).json(raw ? JSON.parse(raw) : { robloxUsername: '' });
    }

    const input = await readJsonBody(req);
    const robloxUsername = String(input.robloxUsername || '').trim().slice(0, 40);
    const profile = {
      discordUserId: user.id,
      discordUsername: user.username,
      robloxUsername,
      updatedAt: Date.now(),
    };

    await redisSet(key, JSON.stringify(profile));
    return res.status(200).json(profile);
  } catch (error) {
    console.error('profile error:', error);
    return sendHandlerError(res, error);
  }
};
