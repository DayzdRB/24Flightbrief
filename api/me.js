// GET /api/auth/login

const crypto = require('crypto');
const { methodNotAllowed, setNoStore } = require('../../lib/http');
const { setShortCookie } = require('../../lib/session');

module.exports = async (req, res) => {
  setNoStore(res);
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const clientId = process.env.DISCORD_CLIENT_ID;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return res.status(500).send('Discord OAuth is not configured on the server yet.');
  }

  const state = crypto.randomBytes(24).toString('hex');
  setShortCookie(res, 'ffb_oauth_state', state, 600);

  const requestUrl = new URL(req.url, `https://${req.headers.host}`);
  const requestedReturn = requestUrl.searchParams.get('returnTo') || '/';
  let safeReturn = '/';

  try {
    const parsed = new URL(requestedReturn, requestUrl.origin);
    if (parsed.origin === requestUrl.origin) {
      safeReturn = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    }
  } catch {
    safeReturn = '/';
  }

  setShortCookie(res, 'ffb_oauth_return', safeReturn, 600);

  const discordUrl = new URL('https://discord.com/oauth2/authorize');
  discordUrl.searchParams.set('client_id', clientId);
  discordUrl.searchParams.set('response_type', 'code');
  discordUrl.searchParams.set('redirect_uri', redirectUri);
  discordUrl.searchParams.set('scope', 'identify');
  discordUrl.searchParams.set('state', state);

  res.writeHead(302, { Location: discordUrl.toString() });
  return res.end();
};
