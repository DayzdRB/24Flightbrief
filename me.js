// GET /api/auth/me
// Returns {id, username} for the logged-in user, or 401 if not logged in.

const { getSessionUser } = require('../../lib/session');

module.exports = async (req, res) => {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ error: 'Not logged in' });
    return;
  }
  res.status(200).json(user);
};
