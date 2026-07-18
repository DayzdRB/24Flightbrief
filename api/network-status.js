// GET /api/network-status?callsign=Shamrock-1337
// Keeps 24data requests on the server and uses the shared Redis cache.

const { getAircraftFeed, getControllerFeed } = require('../lib/atc24');
const { methodNotAllowed } = require('../lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);

  try {
    const aircraft = await getAircraftFeed();
    const controllers = await getControllerFeed()
      .catch(() => ({ fetchedAt: Date.now(), data: [] }));

    const requested = String(req.query?.callsign || '').trim();
    const normalized = requested.toUpperCase();
    const matchingCallsign = Object.keys(aircraft.data)
      .find(callsign => callsign.toUpperCase() === normalized) || null;
    const onlinePositions = controllers.data
      .filter(position => position && position.holder)
      .map(position => `${String(position.airport || '').toUpperCase()}_${String(position.position || '').toUpperCase()}`);

    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      fetchedAt: Math.min(aircraft.fetchedAt, controllers.fetchedAt),
      callsign: requested ? { requested, valid: Boolean(matchingCallsign), matchingCallsign } : null,
      aircraftCallsigns: Object.keys(aircraft.data).sort((a, b) => a.localeCompare(b)),
      onlinePositions,
    });
  } catch (error) {
    console.error('network-status endpoint error:', error);
    return res.status(502).json({ error: error.message || 'Could not fetch ATC24 network data' });
  }
};
