// GET /api/pdc/:token -> load a shareable controller clearance form
// PUT /api/pdc/:token -> atomically issue the complete PDC

const { methodNotAllowed, readJsonBody, sendHandlerError, setNoStore } = require('../../lib/http');
const { ensurePlanShape, loadPlans, savePlans } = require('../../lib/flight-plans');
const { redisGet } = require('../../lib/redis');
const { AIRPORTS, WAYPOINTS } = require('../../lib/map-data');
const { routeAirspaceAnalysis, validateAmendedWaypoints } = require('../../lib/airspace');

function cleanCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function airportCode(value) {
  const text = String(value || '').toUpperCase();
  const match = text.match(/I[A-Z0-9]{3}/);
  return match ? match[0] : cleanCode(text);
}

function cleanText(value, max = 200) {
  return String(value || '').trim().slice(0, max);
}

function fieldEnabled(value) {
  return value === true || value === 1 || ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function pdcActive(plan) {
  return fieldEnabled(plan?.data?.fields?.requestPdc) || plan?.pdc?.status === 'issued';
}

function normalizeWaypoints(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map(item => ({
      wp: cleanCode(typeof item === 'string' ? item : item?.wp),
      note: cleanText(typeof item === 'string' ? '' : item?.note, 160),
    }))
    .filter(item => item.wp);
}

function optionalNumber(value, label, { min = 0, max = 99999 } = {}) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    const error = new Error(`${label} must be between ${min} and ${max}.`);
    error.statusCode = 400;
    throw error;
  }
  return Math.round(number);
}

function normalizeAltitudeChoice(input, label, defaultUnit = 'FT') {
  let raw = input;
  let unit = String(defaultUnit || 'FT').toUpperCase() === 'FL' ? 'FL' : 'FT';

  if (input && typeof input === 'object' && !Array.isArray(input)) {
    raw = input.value ?? input.display ?? input.feet ?? '';
    const requestedUnit = String(input.unit || unit).toUpperCase();
    unit = requestedUnit === 'FL' ? 'FL' : 'FT';
  }

  if (raw === '' || raw === null || raw === undefined) {
    return { feet: null, unit, display: '' };
  }

  let text = String(raw).trim().toUpperCase();
  if (text.startsWith('FL')) {
    unit = 'FL';
    text = text.replace(/^FL\s*/, '');
  } else if (/(?:FEET|FOOT|FT)$/.test(text)) {
    unit = 'FT';
    text = text.replace(/(?:FEET|FOOT|FT)$/, '');
  }
  const digits = text.replace(/[,_\s]/g, '');
  if (!/^\d+$/.test(digits)) {
    const error = new Error(`${label} must contain numbers only.`);
    error.statusCode = 400;
    throw error;
  }

  if (unit === 'FL') {
    const level = Number(digits);
    if (!Number.isFinite(level) || level < 0 || level > 600) {
      const error = new Error(`${label} flight level must be between 000 and 600.`);
      error.statusCode = 400;
      throw error;
    }
    return { feet: Math.round(level * 100), unit: 'FL', display: String(Math.round(level)).padStart(3, '0') };
  }

  const feet = optionalNumber(Number(digits), label, { min: 0, max: 60000 });
  return { feet, unit: 'FT', display: String(feet) };
}

function validateFrequency(value) {
  const frequency = cleanText(value, 12);
  if (!frequency) return '';
  if (!/^\d{3}\.\d{3}$/.test(frequency)) {
    const error = new Error('Departure frequency must use the format 118.800.');
    error.statusCode = 400;
    throw error;
  }
  return frequency;
}

function validateSquawk(value) {
  const raw = String(value || '').trim();
  const squawk = raw.replace(/\s+/g, '');
  if (!/^[0-7]{4}$/.test(squawk)) {
    const error = new Error('Squawk must contain exactly four digits from 0 through 7.');
    error.statusCode = 400;
    throw error;
  }
  return squawk;
}

const PDC_FIELD_KEYS = [
  'depAirport',
  'arrAirport',
  'fdCallsign',
  'fdIngameCallsign',
  'cruiseAlt',
  'depRunway',
  'depRunwayEffective',
  'arrRunway',
  'arrRunwayEffective',
  'pdcInitialAltitude',
  'pdcInitialAltitudeUnit',
  'pdcInitialAltitudeDisplay',
  'pdcDelayMinutes',
  'pdcCruiseAltitude',
  'pdcCruiseAltitudeUnit',
  'pdcCruiseAltitudeDisplay',
  'pdcDepartureFrequency',
  'pdcRemarks',
  'radarVectorsUntil',
  'requestPdc',
];

function pdcRouteData(data) {
  const source = data && typeof data === 'object' ? data : {};
  const sourceFields = source.fields && typeof source.fields === 'object' ? source.fields : {};
  const fields = {};
  PDC_FIELD_KEYS.forEach(key => {
    if (sourceFields[key] !== undefined) fields[key] = sourceFields[key];
  });
  return {
    fields,
    routeType: source.routeType || 'waypoints',
    waypoints: normalizeWaypoints(source.waypoints),
  };
}

function publicPayload(plan) {
  const filedData = plan.pdc?.filedSnapshot || plan.data;
  return {
    id: plan.id,
    name: plan.name,
    data: pdcRouteData(plan.data),
    filedData: pdcRouteData(filedData),
    pdc: {
      status: plan.pdc?.status || 'not-issued',
      clearance: plan.pdc?.clearance || null,
    },
    airspace: routeAirspaceAnalysis(filedData),
  };
}

module.exports = async (req, res) => {
  setNoStore(res);
  if (!['GET', 'PUT'].includes(req.method)) return methodNotAllowed(res, ['GET', 'PUT']);

  const token = String(req.query?.token || '');
  if (!token) return res.status(400).json({ error: 'Missing PDC token.' });

  try {
    const referenceRaw = await redisGet(`pdc-token:${token}`);
    if (!referenceRaw) return res.status(404).json({ error: 'Invalid or expired PDC link.' });

    const reference = JSON.parse(referenceRaw);
    const plans = await loadPlans(reference.ownerId);
    const index = plans.findIndex(plan => plan.id === reference.planId);
    if (index < 0) return res.status(404).json({ error: 'Flight plan not found.' });

    const plan = plans[index];
    if (await ensurePlanShape(plan, reference.ownerId)) await savePlans(reference.ownerId, plans);

    if (!pdcActive(plan)) {
      return res.status(403).json({ error: 'PDC was not requested for this flight plan.' });
    }

    if (req.method === 'GET') return res.status(200).json(publicPayload(plan));

    const input = await readJsonBody(req);
    const filedData = plan.pdc?.filedSnapshot || plan.data || {};
    const filedFields = filedData.fields || {};
    const clearanceLimit = airportCode(input.clearanceLimit || filedFields.arrAirport);
    if (!AIRPORTS[clearanceLimit]) {
      return res.status(400).json({ error: 'Clearance limit must be a valid airport code.' });
    }

    const amendedWaypoints = normalizeWaypoints(input.waypoints ?? filedData.waypoints);
    const routeValidation = validateAmendedWaypoints(filedData, amendedWaypoints);
    if (!routeValidation.valid) return res.status(400).json({ error: routeValidation.error, airspace: routeValidation.analysis });

    const radarVectorsUntil = cleanCode(input.radarVectorsUntil);
    if (radarVectorsUntil && !amendedWaypoints.some(item => item.wp === radarVectorsUntil)) {
      return res.status(400).json({ error: 'Radar vectors must end at a waypoint in the cleared route.' });
    }

    const filedCruiseText = String(filedFields.cruiseAlt || '').trim().toUpperCase();
    const filedCruiseUnit = filedCruiseText.startsWith('FL') || /^\d{1,3}$/.test(filedCruiseText) ? 'FL' : 'FT';
    const initialChoice = normalizeAltitudeChoice(input.altitude?.initial, 'Initial climb', 'FT');
    const cruiseChoice = normalizeAltitudeChoice(
      input.altitude?.cruise ?? filedFields.cruiseAlt,
      'Cruising altitude',
      filedCruiseUnit
    );
    const altitude = {
      initial: initialChoice.feet,
      initialUnit: initialChoice.unit,
      initialDisplay: initialChoice.display,
      delayMinutes: optionalNumber(input.altitude?.delayMinutes, 'Delay time', { min: 0, max: 120 }),
      cruise: cruiseChoice.feet,
      cruiseUnit: cruiseChoice.unit,
      cruiseDisplay: cruiseChoice.display,
    };
    const departureFrequency = validateFrequency(input.departureFrequency);
    const squawk = validateSquawk(input.squawk);
    const controllerName = cleanText(input.controllerName, 80);
    const remarks = cleanText(input.remarks, 2000);
    const depRunway = cleanText(input.depRunway || filedFields.depRunwayEffective || filedFields.depRunway, 12);
    const arrRunway = cleanText(input.arrRunway || filedFields.arrRunwayEffective || filedFields.arrRunway, 12);
    const issuedAt = Date.now();

    const clearance = {
      clearanceLimit,
      waypoints: amendedWaypoints,
      radarVectorsUntil: radarVectorsUntil || null,
      altitude,
      departureFrequency,
      squawk,
      depRunway,
      arrRunway,
      remarks,
      controllerName: controllerName || null,
      issuedAt,
      airspace: {
        startingSector: routeValidation.analysis.startingSector,
        nextSector: routeValidation.analysis.nextSector,
        entryWaypointNode: routeValidation.analysis.entryWaypointNode,
        entryWaypointIndex: routeValidation.analysis.entryWaypointIndex,
        protectedWaypointNode: routeValidation.analysis.protectedWaypointNode,
        protectedWaypointIndex: routeValidation.analysis.protectedWaypointIndex,
        amendmentLimitNode: routeValidation.analysis.amendmentLimitNode,
        amendmentLimitWaypointIndex: routeValidation.analysis.amendmentLimitWaypointIndex,
      },
    };

    // Reload and merge immediately before saving so a simultaneous tracking/customs
    // update is preserved. No PDC amendment is exposed before this single save.
    const latestPlans = await loadPlans(reference.ownerId);
    const latestIndex = latestPlans.findIndex(item => item.id === reference.planId);
    if (latestIndex < 0) return res.status(404).json({ error: 'Flight plan not found.' });
    const latestPlan = latestPlans[latestIndex];
    await ensurePlanShape(latestPlan, reference.ownerId);
    latestPlan.data ||= {};
    latestPlan.data.fields ||= {};
    latestPlan.data.waypoints = amendedWaypoints;
    latestPlan.data.routeType = amendedWaypoints.length ? 'waypoints' : (filedData.routeType || latestPlan.data.routeType || 'waypoints');
    latestPlan.data.fields.arrAirport = clearanceLimit;
    if (altitude.cruise !== null) {
      latestPlan.data.fields.cruiseAlt = altitude.cruiseUnit === 'FL'
        ? `FL${altitude.cruiseDisplay}`
        : String(altitude.cruise);
    }
    if (depRunway && depRunway !== 'AUTO') {
      latestPlan.data.fields.depRunway = depRunway;
      latestPlan.data.fields.depRunwayEffective = depRunway;
    }
    if (arrRunway && arrRunway !== 'AUTO') {
      latestPlan.data.fields.arrRunway = arrRunway;
      latestPlan.data.fields.arrRunwayEffective = arrRunway;
    }
    latestPlan.data.fields.pdcInitialAltitude = altitude.initial === null ? '' : String(altitude.initial);
    latestPlan.data.fields.pdcInitialAltitudeUnit = altitude.initialUnit;
    latestPlan.data.fields.pdcInitialAltitudeDisplay = altitude.initialDisplay;
    latestPlan.data.fields.pdcDelayedAltitude = '';
    latestPlan.data.fields.pdcDelayMinutes = altitude.delayMinutes === null ? '' : String(altitude.delayMinutes);
    latestPlan.data.fields.pdcCruiseAltitude = altitude.cruise === null ? '' : String(altitude.cruise);
    latestPlan.data.fields.pdcCruiseAltitudeUnit = altitude.cruiseUnit;
    latestPlan.data.fields.pdcCruiseAltitudeDisplay = altitude.cruiseDisplay;
    latestPlan.data.fields.pdcDepartureFrequency = departureFrequency;
    latestPlan.data.fields.squawkCode = squawk;
    latestPlan.data.fields.pdcRemarks = remarks;
    latestPlan.data.fields.radarVectorsUntil = radarVectorsUntil || '';
    const filedSnapshot = latestPlan.pdc?.filedSnapshot || JSON.parse(JSON.stringify(filedData));
    latestPlan.pdc = { status: 'issued', filedSnapshot, clearance };
    latestPlan.updatedAt = issuedAt;
    latestPlans[latestIndex] = latestPlan;
    await savePlans(reference.ownerId, latestPlans);

    return res.status(200).json({ ok: true, ...publicPayload(latestPlan) });
  } catch (error) {
    if (error?.statusCode === 400) return res.status(400).json({ error: error.message });
    console.error('pdc error:', error);
    return sendHandlerError(res, error);
  }
};
