// GET /api/auth/callback?code=...&state=...
// Exchanges the authorization code for an access token, fetches the
// user's Discord identity, and sets a signed session cookie. The
// Discord access token is used once here and then discarded — we
// don't keep it, only {id, username}.
//
// Requires these Vercel environment variables:
//   DISCORD_CLIENT_ID
//   DISCORD_CLIENT_SECRET   (server-only, never exposed to the browser)
//   DISCORD_REDIRECT_URI

const { setSessionCookie, parseCookies } = require('../../lib/session');

module.exports = async (req, res) => {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    res.status(500).send('Discord OAuth is not configured on the server yet.');
    return;
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(req);

  if (!code || !state || state !== cookies.ffb_oauth_state) {
    res.status(400).send('Invalid or expired login attempt. Please try logging in again.');
    return;
  }

  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!tokenRes.ok) throw new Error(`Token exchange failed: ${await tokenRes.text()}`);
    const tokenData = await tokenRes.json();

    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) throw new Error(`Fetching user failed: ${await userRes.text()}`);
    const user = await userRes.json();

    setSessionCookie(res, { id: user.id, username: user.username });
    res.writeHead(302, { Location: '/' });
    res.end();
  } catch (err) {
    console.error('Discord OAuth callback error:', err);
    res.status(500).send('Login failed. Please try again.');
  }
};
