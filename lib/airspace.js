const { AIRPORTS, WAYPOINTS } = require('./map-data');

// These polygons are generated from the connected paths in public/maps/boundaries.svg.
// Coordinates use the same -600..600 viewBox as the visible 24RC boundary layer.
const AIRSPACE_SECTORS = [
  {
    id: 'orenji',
    label: 'Orenji',
    centerCode: 'IOCC',
    frequency: '132.300',
    polygon: [[-185.23279124,-129.88163423],[-169,-169],[88,-169],[88,-600],[-323,-600]],
  },
  {
    id: 'perth',
    label: 'Perth',
    centerCode: 'IPCC',
    frequency: '135.250',
    polygon: [[88,-169],[134,-147],[165,-51],[220,-81],[299,-81],[383,-140],[461,-177],[600,-174],[600,-600],[88,-600]],
  },
  {
    id: 'grindavik',
    label: 'Grindavik',
    centerCode: 'IGCC',
    frequency: '126.750',
    polygon: [[-308,201],[-308,44],[-230,-22],[-185.23279124,-129.88163423],[-323,-600],[-600,-600],[-600,130],[-442.05859,146]],
  },
  {
    id: 'barthelemy',
    label: 'Saint Barthelemy',
    centerCode: 'IBCC',
    frequency: '128.600',
    polygon: [[-230,-22],[68,64],[91.6004424,108.25082949],[200.34180024,68.64346008],[219,-3],[165,-51],[134,-147],[88,-169],[-169,-169],[-185.23279124,-129.88163423]],
  },
  {
    id: 'izolirani',
    label: 'Izolirani',
    centerCode: 'IZCC',
    frequency: '125.650',
    polygon: [[330,174],[370,211],[600,260],[600,-174],[461,-177],[383,-140],[299,-81],[220,-81],[165,-51],[219,-3],[200.34180024,68.64346008],[268,44],[337,50],[334,76],[314,99],[317,162]],
  },
  {
    id: 'skopelos',
    label: 'Skopelos',
    centerCode: null,
    frequency: null,
    fallbackLabel: 'ISKP_TWR',
    fallbackFrequency: '123.250',
    polygon: [[91.6004424,108.25082949],[108,139],[126,204],[130.63292439,231.08478874],[330,174],[317,162],[314,99],[334,76],[337,50],[268,44],[200.34180024,68.64346008]],
  },
  {
    id: 'rockford',
    label: 'Rockford',
    centerCode: 'IRCC',
    frequency: '124.850',
    polygon: [[-308,201],[-308,235],[-235,310],[-235,600],[24,600],[24,339],[139,280],[130.63292439,231.08478874],[126,204],[108,139],[91.6004424,108.25082949],[68,64],[-230,-22],[-308,44]],
  },
  {
    id: 'sauthemptona',
    label: 'Sauthemptona',
    centerCode: 'ISCC',
    frequency: '127.825',
    polygon: [[-235,600],[-235,310],[-308,235],[-308,201],[-442.05859,146],[-600,130],[-600,600]],
  },
  {
    id: 'larnaca',
    label: 'Larnaca',
    centerCode: 'ICCC',
    frequency: '126.300',
    polygon: [[130.63292439,231.08478874],[139,280],[24,339],[24,600],[600,600],[600,260],[370,211],[330,174]],
  },
];

const SECTOR_BY_ID = new Map(AIRSPACE_SECTORS.map(sector => [sector.id, sector]));

function normalizeCode(value) {
  const match = String(value || '').toUpperCase().match(/I[A-Z0-9]{3}/);
  return match ? match[0] : String(value || '').trim().toUpperCase();
}

function normalizeWaypoint(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function toViewBox(position) {
  if (!position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.y))) return null;
  return { x: Number(position.x) * 1200 - 600, y: Number(position.y) * 1200 - 600 };
}

function pointOnSegment(point, a, b, epsilon = 1e-7) {
  const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
  if (Math.abs(cross) > epsilon) return false;
  const dot = (point.x - a.x) * (b.x - a.x) + (point.y - a.y) * (b.y - a.y);
  if (dot < -epsilon) return false;
  const lengthSquared = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
  return dot <= lengthSquared + epsilon;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = { x: polygon[j][0], y: polygon[j][1] };
    const b = { x: polygon[i][0], y: polygon[i][1] };
    if (pointOnSegment(point, a, b)) return true;
    const intersects = ((b.y > point.y) !== (a.y > point.y))
      && (point.x < ((a.x - b.x) * (point.y - b.y)) / ((a.y - b.y) || Number.EPSILON) + b.x);
    if (intersects) inside = !inside;
  }
  return inside;
}

function sectorForMapPosition(position) {
  const point = toViewBox(position);
  if (!point) return null;
  return AIRSPACE_SECTORS.find(sector => pointInPolygon(point, sector.polygon)) || null;
}

function sectorPublic(sector) {
  if (!sector) return null;
  const { polygon: _polygon, ...safe } = sector;
  return safe;
}

function interpolate(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function transitionPoint(start, end, low, high, fromSectorId) {
  let left = low;
  let right = high;
  for (let i = 0; i < 24; i += 1) {
    const mid = (left + right) / 2;
    const sector = sectorForMapPosition(interpolate(start, end, mid));
    if (sector?.id === fromSectorId) left = mid;
    else right = mid;
  }
  return { t: right, mapPosition: interpolate(start, end, right) };
}

function legTransitions(start, end, legIndex) {
  const transitions = [];
  const samples = 320;
  let previousT = 0;
  let previousSector = sectorForMapPosition(start);
  for (let i = 1; i <= samples; i += 1) {
    const t = i / samples;
    const sector = sectorForMapPosition(interpolate(start, end, t));
    if (sector?.id !== previousSector?.id) {
      const crossing = transitionPoint(start, end, previousT, t, previousSector?.id || null);
      transitions.push({
        legIndex,
        t: crossing.t,
        mapPosition: crossing.mapPosition,
        fromSector: sectorPublic(previousSector),
        toSector: sectorPublic(sector),
      });
      previousSector = sector;
    }
    previousT = t;
  }
  return transitions;
}

function routeNodes(data) {
  const fields = data?.fields || {};
  const departureCode = normalizeCode(fields.depAirport);
  const arrivalCode = normalizeCode(fields.arrAirport);
  const nodes = [];
  if (AIRPORTS[departureCode]) {
    nodes.push({ code: departureCode, kind: 'departure', mapPosition: AIRPORTS[departureCode], waypointIndex: null });
  }
  if ((data?.routeType || 'waypoints') === 'waypoints') {
    let waypointIndex = 0;
    (data?.waypoints || []).forEach(item => {
      const code = normalizeWaypoint(item?.wp);
      if (code && WAYPOINTS[code]) {
        nodes.push({ code, kind: 'waypoint', mapPosition: WAYPOINTS[code], waypointIndex });
        waypointIndex += 1;
      }
    });
  }
  if (AIRPORTS[arrivalCode]) {
    nodes.push({ code: arrivalCode, kind: 'arrival', mapPosition: AIRPORTS[arrivalCode], waypointIndex: null });
  }
  return nodes.map(node => ({ ...node, sector: sectorPublic(sectorForMapPosition(node.mapPosition)) }));
}

function routeAirspaceAnalysis(data) {
  const nodes = routeNodes(data);
  const transitions = [];
  for (let index = 0; index < nodes.length - 1; index += 1) {
    transitions.push(...legTransitions(nodes[index].mapPosition, nodes[index + 1].mapPosition, index));
  }

  const startingSector = nodes[0]?.sector || null;
  const firstTransition = transitions.find(item => item.fromSector?.id === startingSector?.id && item.toSector?.id !== startingSector?.id)
    || transitions[0]
    || null;

  const waypointNodes = nodes.filter(node => node.kind === 'waypoint');
  const outsideWaypointNodes = startingSector
    ? waypointNodes.filter(node => node.sector?.id !== startingSector.id)
    : [];
  // The controller owns every waypoint in the departure sector and may choose
  // one entry fix in the next sector. The second filed outside-sector waypoint
  // begins the protected suffix that must remain unchanged.
  const entryWaypointNode = outsideWaypointNodes[0] || null;
  const protectedWaypointNode = outsideWaypointNodes[1] || null;
  const entryWaypointIndex = entryWaypointNode?.waypointIndex ?? waypointNodes.length;
  const protectedWaypointIndex = protectedWaypointNode?.waypointIndex ?? waypointNodes.length;
  const nextSector = entryWaypointNode?.sector || firstTransition?.toSector || null;

  const sequence = [];
  const pushSector = sector => {
    if (!sector || sequence.at(-1)?.id === sector.id) return;
    sequence.push(sector);
  };
  pushSector(startingSector);
  transitions.forEach(item => pushSector(item.toSector));

  return {
    nodes,
    transitions,
    sectorSequence: sequence,
    startingSector,
    firstTransition,
    nextSector,
    entryWaypointNode,
    entryWaypointIndex,
    protectedWaypointNode,
    protectedWaypointIndex,
    // Backward-compatible names now point to the beginning of the immutable
    // suffix rather than the first editable entry waypoint.
    amendmentLimitNode: protectedWaypointNode,
    amendmentLimitWaypointIndex: protectedWaypointIndex,
    hasBoundaryCrossing: Boolean(firstTransition),
  };
}

function validateAmendedWaypoints(filedData, amendedWaypoints) {
  const filed = (Array.isArray(filedData?.waypoints) ? filedData.waypoints : [])
    .map(item => ({ ...item, wp: normalizeWaypoint(item?.wp) }))
    .filter(item => item.wp && WAYPOINTS[item.wp]);
  const amended = Array.isArray(amendedWaypoints) ? amendedWaypoints : [];
  const amendedCodes = amended.map(item => normalizeWaypoint(item?.wp));
  const unknown = amendedCodes.filter(code => !code || !WAYPOINTS[code]);
  const analysis = routeAirspaceAnalysis({ ...filedData, waypoints: filed });

  if (unknown.length) {
    return { valid: false, error: `Unknown waypoint${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`, analysis };
  }

  const lockIndex = Math.min(filed.length, Math.max(0, analysis.protectedWaypointIndex));
  const lockedSuffix = filed.slice(lockIndex).map(item => item.wp);
  if (lockedSuffix.length) {
    const amendedSuffix = amendedCodes.slice(-lockedSuffix.length);
    if (amendedSuffix.length !== lockedSuffix.length || amendedSuffix.some((code, index) => code !== lockedSuffix[index])) {
      return {
        valid: false,
        error: `The filed route from ${lockedSuffix[0]} onward begins with the second waypoint outside the departure airspace and must remain unchanged.`,
        analysis,
      };
    }
  }

  const editableLength = amendedCodes.length - lockedSuffix.length;
  if (editableLength < 0) {
    return { valid: false, error: 'The amended route removed protected next-airspace waypoints.', analysis };
  }
  const editableCodes = amendedCodes.slice(0, editableLength);
  const startingSectorId = analysis.startingSector?.id || null;
  const nextSectorId = analysis.nextSector?.id || null;
  let outsideCount = 0;
  let outsideIndex = -1;

  for (let index = 0; index < editableCodes.length; index += 1) {
    const sector = sectorForMapPosition(WAYPOINTS[editableCodes[index]]);
    const isOutside = Boolean(startingSectorId && sector?.id !== startingSectorId);
    if (!isOutside) {
      if (outsideIndex >= 0) {
        return {
          valid: false,
          error: 'Waypoints in the departure airspace must come before the single next-airspace entry waypoint.',
          analysis,
        };
      }
      continue;
    }

    outsideCount += 1;
    outsideIndex = index;
    if (outsideCount > 1) {
      return {
        valid: false,
        error: 'A controller may add or replace only the first waypoint outside the departure airspace. The route must then continue directly to the protected second outside waypoint.',
        analysis,
      };
    }
    if (nextSectorId && sector?.id !== nextSectorId) {
      return {
        valid: false,
        error: `The editable entry waypoint must be inside ${analysis.nextSector?.label || 'the next airspace'}.`,
        analysis,
      };
    }
  }

  if (analysis.entryWaypointNode && outsideCount !== 1) {
    return {
      valid: false,
      error: `The clearance must retain one entry waypoint inside ${analysis.nextSector?.label || 'the next airspace'} before continuing to the protected route.`,
      analysis,
    };
  }

  return {
    valid: true,
    analysis,
    lockIndex: editableLength,
    lockedSuffix,
    editableOutsideWaypoint: outsideIndex >= 0 ? editableCodes[outsideIndex] : null,
  };
}

module.exports = {
  AIRSPACE_SECTORS,
  SECTOR_BY_ID,
  sectorForMapPosition,
  sectorPublic,
  routeAirspaceAnalysis,
  validateAmendedWaypoints,
};
