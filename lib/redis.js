// Minimal Upstash Redis REST client. No SDK/dependency needed —
// Upstash exposes plain REST commands, which is a good fit for
// serverless functions that only need a few operations.
//
// Requires these Vercel environment variables:
//   UPSTASH_REDIS_REST_URL
//   UPSTASH_REDIS_REST_TOKEN

const BASE = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

function assertConfigured() {
  if (!BASE || !TOKEN) {
    throw new Error(
      'Redis is not configured. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in your Vercel project environment variables.'
    );
  }
}

async function call(pathParts) {
  assertConfigured();
  const url = `${BASE}/${pathParts.map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Redis request failed (${res.status}): ${text}`);
  }
  const json = await res.json();
  return json.result;
}

async function redisGet(key) {
  const result = await call(['get', key]);
  return result == null ? null : result;
}

async function redisSet(key, value, exSeconds) {
  const parts = ['set', key, value];
  if (exSeconds) parts.push('EX', String(exSeconds));
  return call(parts);
}

async function redisDel(key) {
  return call(['del', key]);
}

module.exports = { redisGet, redisSet, redisDel };
