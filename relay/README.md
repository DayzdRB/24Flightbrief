# 24data WebSocket relay

Vercel offers WebSocket support, but autoscaled Function instances are not a dependable singleton for an upstream service capped at three connections. Run `atc24-websocket.js` as **one instance** on a persistent Node service such as Railway, Render, Fly.io, or a VPS.

The relay also captures `FLIGHT_PLAN` events (24data streams these over the WebSocket only — there is no REST route). That is what lets the navigation page label aircraft with the pilot's selected/filed callsign instead of the raw in-game callsign. Without the relay the site still works from the REST cache, but callsign labels fall back to in-game callsigns. Captured plans are pruned after 6 hours, in line with the 24data terms.

Use the same Redis database as the Vercel site. Configure either variable pair:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

or:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

Optional:

```text
ATC24_WEBSOCKET_URL
```

It defaults to `wss://24data.ptfs.app/wss`.

Start command:

```bash
npm run relay
```

Do not scale this worker above one instance. The website continues to work with the server-side REST cache if the relay is not deployed.
