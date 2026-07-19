// Consolidated Discord authentication endpoint.
//
// Vercel maps this single dynamic function to the existing URLs:
//   GET  /api/auth/login
//   GET  /api/auth/callback
//   GET  /api/auth/me
//   POST /api/auth/logout
//
// Keeping these actions in one file reduces the number of bundled
// Serverless Functions while preserving all existing frontend URLs and
// the Discord OAuth redirect URI.

const crypto = require('crypto');
const { methodNotAllowed, setNoStore } = require('../../lib/http');
const {
  clearCookie,
  clearSessionCookie,
  getSessionUser,
  parseCookies,
  setSessionCookie,
  setShortCookie,
} = require('../../lib/session');

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function getAction(req) {
  const queryAction = firstValue(req.query?.action);
  if (queryAction) return String(queryAction).toLowerCase();

  // Fallback for local/manual tests where the dynamic query parameter is
  // not injected by Vercel.
  try {
    const requestUrl = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
    const parts = requestUrl.pathname.split('/').filter(Boolean);
    return String(parts[parts.length - 1] || '').toLowerCase();
  } catch {
    return '';
  }
}

async function handleLogin(req, res) {
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
}

async function handleCallback(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).send('Discord OAuth is not configured on the server yet.');
  }

  const requestUrl = new URL(req.url, `https://${req.headers.host}`);
  const code = firstValue(req.query?.code) || requestUrl.searchParams.get('code');
  const state = firstValue(req.query?.state) || requestUrl.searchParams.get('state');
  const discordError = firstValue(req.query?.error) || requestUrl.searchParams.get('error');

  const parsedCookies = parseCookies(req);
  const cookies = {
    ...parsedCookies,
    ...(req.cookies || {}),
  };
  const storedState = cookies.ffb_oauth_state;

  console.log('Discord OAuth callback validation:', {
    host: req.headers.host,
    hasCode: Boolean(code),
    hasState: Boolean(state),
    hasStoredState: Boolean(storedState),
    stateMatches: Boolean(state && storedState && state === storedState),
    discordError: discordError || null,
  });

  if (discordError) {
    return res.status(400).send(`Discord authorization failed: ${discordError}`);
  }
  if (!code) {
    return res.status(400).send('Discord did not return an authorization code.');
  }
  if (!state) {
    return res.status(400).send('Discord did not return the OAuth state value.');
  }
  if (!storedState) {
    return res.status(400).send('The OAuth state cookie was not returned by the browser.');
  }
  if (state !== storedState) {
    return res.status(400).send('The OAuth state cookie did not match the Discord callback.');
  }

  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenResponse.ok) {
      throw new Error(`Discord token exchange failed with status ${tokenResponse.status}`);
    }
    const tokenData = await tokenResponse.json();

    const userResponse = await fetch('https://discord.com/api/v10/users/@me', {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${tokenData.access_token}`,
      },
    });
    if (!userResponse.ok) {
      throw new Error(`Discord user lookup failed with status ${userResponse.status}`);
    }

    const user = await userResponse.json();
    setSessionCookie(res, { id: user.id, username: user.username });
    clearCookie(res, 'ffb_oauth_state');
    clearCookie(res, 'ffb_oauth_return');

    const returnTo = cookies.ffb_oauth_return?.startsWith('/')
      ? cookies.ffb_oauth_return
      : '/';
    res.writeHead(302, { Location: returnTo });
    return res.end();
  } catch (error) {
    console.error('Discord OAuth callback error:', error);
    return res.status(500).send('Login failed. Please try again.');
  }
}

async function handleMe(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const user = getSessionUser(req);
  if (!user) return res.status(401).json({ error: 'Not logged in' });
  return res.status(200).json({ id: user.id, username: user.username });
}

async function handleLogout(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST']);

  clearSessionCookie(res);
  return res.status(200).json({ ok: true });
}

module.exports = async (req, res) => {
  setNoStore(res);

  switch (getAction(req)) {
    case 'login':
      return handleLogin(req, res);
    case 'callback':
      return handleCallback(req, res);
    case 'me':
      return handleMe(req, res);
    case 'logout':
      return handleLogout(req, res);
    default:
      return res.status(404).json({ error: 'Unknown authentication action' });
  }
};
