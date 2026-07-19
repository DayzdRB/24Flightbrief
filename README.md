# 24FlightBrief

Flight planning, cargo/customs inspection, and live navigation for the ATC24 PTFS network.

## Included in this build

- Eight-step flight-plan workflow with saved plans and PDF/image exports.
- Separate departure and arrival cargo/customs inspection links.
- Interactive chart route editing: select the departure, arrival, or an existing route fix, click a chart waypoint, then insert it at that location or add it to the end. Duplicate fixes require confirmation.
- Shareable Pre-Departure Clearance (PDC) workflow using CRAFT, optional controller identification, route amendments, radar vectors, altitude restrictions, departure frequency, octal squawk validation, runway assignments, and remarks.
- Boundary-defined airspace classification based on the visible `boundaries.svg`; route legs and live aircraft positions determine sector/frequency changes without hiding any airport or ground SVG layers.
- Departure inspection is available after a flight plan is saved.
- Arrival inspection remains locked until:
  1. departure customs is approved;
  2. live aircraft tracking confirms the flight departed; and
  3. the aircraft lands inside the destination airport area.
- Approved departure and arrival agent signatures appear on the flight-plan summary.
- Live navigation workspace with:
  - planned route and waypoint progression;
  - next waypoint, distance remaining, and ETA;
  - actual departure and arrival milestones;
  - all tracked traffic plotted with aircraft-type SVG icons;
  - callsign, flight level, groundspeed, and heading labels;
  - projected traffic advisories.
- Redis-backed ATC24 data cache with a rate-limited REST fallback.
- Optional single-instance ATC24 WebSocket relay for near-real-time updates.

## Vercel environment variables

The existing Discord OAuth, session, and Upstash Redis variables remain required. The ATC24 REST fallback does not require an API key.

Common Redis variable names supported by the project:

```text
KV_REST_API_URL
KV_REST_API_TOKEN
```

or:

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
```

## Install

```bash
npm install
```

The `ws` dependency is used only by the optional persistent relay.

## Run the site

Use the normal Vercel development or deployment process for the repository.

The Vercel API routes use a shared Redis cache and a distributed refresh lock. When no fresh WebSocket snapshot is available, one server request refreshes the ATC24 REST aircraft feed no more than once every three seconds; downstream browsers receive the cached result.

## Optional live WebSocket relay

The ATC24 WebSocket allows a maximum of three upstream connections and should be opened by a server without an `Origin` header. Run the included relay as exactly one persistent worker on Railway, Render, Fly.io, a VPS, or another process host:

```bash
npm run relay
```

The relay connects to:

```text
wss://24data.ptfs.app/wss
```

It writes live aircraft and controller snapshots into the same Redis instance used by Vercel. Vercel then serves those cached snapshots to every browser. Do not scale the relay above one instance unless the upstream connection limit is deliberately coordinated.

See `relay/README.md` for deployment details.

## PDC workflow

1. Save/file a flight plan while signed in.
2. Copy the PDC link from the planner summary, saved-plan card, or navigation workspace.
3. The controller may enter an optional name/callsign and accept or amend the CRAFT fields.
4. Route amendments are restricted before the first filed waypoint in the next airspace; the protected filed suffix stays unchanged. Radar vectors may continue to an eligible cleared waypoint.
5. Nothing changes on the pilot's active plan until **Submit complete PDC** is pressed. The route, altitude, frequency, squawk, runway, and remarks are then saved together.
6. Navigation automatically resumes the cleared route when the aircraft reaches the radar-vector target.

The public PDC token endpoint returns only clearance-relevant route and flight fields. It does not expose unrelated crew, cargo, or full filed-plan data.

## Customs workflow

1. Save/file a flight plan while signed in.
2. Copy the departure inspection link from the summary or navigation workspace.
3. A customs agent completes and approves the departure form.
4. Open **Navigate with Flight Plan** so the site tracks the exact in-game callsign filed on the plan.
5. After a real departure and a confirmed landing near the destination, the arrival inspection link unlocks automatically.
6. Approved agent signatures and timestamps appear on the flight-plan summary.

## Aircraft icons

Aircraft radar symbols are stored in `public/aircraft-icons`. The renderer chooses the closest available icon from the tracked aircraft type and falls back to a generic aircraft symbol when no exact match exists. Attribution from the uploaded icon pack is preserved in `public/aircraft-icons/ATTRIBUTION.txt`.
