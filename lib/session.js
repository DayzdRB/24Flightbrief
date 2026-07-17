// Small stateless session helper. We never store a Discord access
// token — once we've fetched the user's id/username right after
// OAuth, we throw the token away and just sign {id, username} into
// a cookie so future requests can trust it without hitting Discord
// again. This keeps what we retain to the minimum necessary.
//
// Requires this Vercel environment variable:
//   SESSION_SECRET   (any long random string you generate yourself)

const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET;
const COOKIE_NAME = 'ffb_session';

function sign(payloadObj) {
  if (!SECRET) throw new Error('SESSION_SECRET is not set in environment variables.');
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!SECRET || !token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header.split(';').filter(Boolean).map(p => {
      const idx = p.indexOf('=');
      return [p.slice(0, idx).trim(), decodeURIComponent(p.slice(idx + 1).trim())];
    })
  );
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  return verify(token);
}

function appendSetCookie(res, cookie) {
  const existing = res.getHeader('Set-Cookie');

  if (!existing) {
    res.setHeader('Set-Cookie', cookie);
    return;
  }

  const cookies = Array.isArray(existing) ? existing : [String(existing)];
  res.setHeader('Set-Cookie', [...cookies, cookie]);
}

function setSessionCookie(res, payloadObj, maxAgeSeconds = 60 * 60 * 24 * 30) {
  const token = sign(payloadObj);
  appendSetCookie(
    res,
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`
  );
}

function clearCookie(res, name) {
  appendSetCookie(
    res,
    `${name}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax`
  );
}

function clearSessionCookie(res) {
  clearCookie(res, COOKIE_NAME);
}

function setShortCookie(res, name, value, maxAgeSeconds = 600) {
  appendSetCookie(
    res,
    `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`
  );
}

module.exports = {
  getSessionUser,
  setSessionCookie,
  clearSessionCookie,
  clearCookie,
  parseCookies,
  setShortCookie,
};
