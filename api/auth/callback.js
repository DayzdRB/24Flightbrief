// GET /api/auth/callback?code=...&state=...

const { methodNotAllowed, setNoStore } = require('../../lib/http');
const {
  clearCookie,
  parseCookies,
  setSessionCookie,
} = require('../../lib/session');

module.exports = async (req, res) => {
  setNoStore(res);
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return res.status(500).send('Discord OAuth is not configured on the server yet.');
  }

const requestUrl = new URL(req.url, `https://${req.headers.host}`);

const firstValue = value => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const code =
  firstValue(req.query?.code) ||
  requestUrl.searchParams.get('code');

const state =
  firstValue(req.query?.state) ||
  requestUrl.searchParams.get('state');

const discordError =
  firstValue(req.query?.error) ||
  requestUrl.searchParams.get('error');

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
  return res
    .status(400)
    .send(`Discord authorization failed: ${discordError}`);
}

if (!code) {
  return res.status(400).send('Discord did not return an authorization code.');
}

if (!state) {
  return res.status(400).send('Discord did not return the OAuth state value.');
}

if (!storedState) {
  return res.status(400).send(
    'The OAuth state cookie was not returned by the browser.'
  );
}

if (state !== storedState) {
  return res.status(400).send(
    'The OAuth state cookie did not match the Discord callback.'
  );
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

    const returnTo = cookies.ffb_oauth_return?.startsWith('/') ? cookies.ffb_oauth_return : '/';
    res.writeHead(302, { Location: returnTo });
    return res.end();
  } catch (error) {
    console.error('Discord OAuth callback error:', error);
    return res.status(500).send('Login failed. Please try again.');
  }
};
