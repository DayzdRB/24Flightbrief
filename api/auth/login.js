// GET /api/auth/login
// Redirects the user to Discord to authorize, with a random `state`
// value stashed in a short-lived cookie so the callback can verify
// the request wasn't forged (CSRF protection).
//
// Requires these Vercel environment variables:
//   DISCORD_CLIENT_ID
//   DISCORD_REDIRECT_URI   e.g. https://your-app.vercel.app/api/auth/callback

const crypto = require('crypto');
const { setShortCookie } = require('../../lib/session');

module.exports = async (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    res.status(500).send('Discord OAuth is not configured on the server yet.');
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
  setShortCookie(res, 'ffb_oauth_state', state, 600);
  const requestUrl = new URL(req.url, `https://${req.headers.host}`);
  const requestedReturn = requestUrl.searchParams.get('returnTo') || '/';
  let safeReturn = '/';
  try {
    const parsed = new URL(requestedReturn, `https://${req.headers.host}`);
    if (parsed.host === req.headers.host) safeReturn = parsed.pathname + parsed.search;
  } catch {}
  const prior = res.getHeader('Set-Cookie');
  const returnCookie = `ffb_oauth_return=${encodeURIComponent(safeReturn)}; Max-Age=600; Path=/; HttpOnly; Secure; SameSite=Lax`;
  res.setHeader('Set-Cookie', Array.isArray(prior) ? [...prior, returnCookie] : [prior, returnCookie].filter(Boolean));

  const url = new URL('https://discord.com/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', 'identify');
  url.searchParams.set('state', state);

  res.writeHead(302, { Location: url.toString() });
  res.end();
};

