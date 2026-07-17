// GET /api/auth/me

const { methodNotAllowed, setNoStore } = require('../../lib/http');
const { getSessionUser } = require('../../lib/session');

module.exports = async (req, res) => {
  setNoStore(res);
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });

  return res.status(200).json({ id: user.id, username: user.username });
};
