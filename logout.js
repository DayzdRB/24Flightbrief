// POST /api/auth/logout
const { clearSessionCookie } = require('../../lib/session');

module.exports = async (req, res) => {
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
};
