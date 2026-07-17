// POST /api/auth/logout

const { methodNotAllowed, setNoStore } = require('../../lib/http');
const { clearSessionCookie } = require('../../lib/session');

module.exports = async (req, res) => {
  setNoStore(res);
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
};
