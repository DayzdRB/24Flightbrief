(function (global) {
  'use strict';

  const PERFORMANCE_VERSION = 2;
  const CRUISE_FACTOR = 0.85;

  // Canonical aircraft names supplied by ATC24, mapped to the aircraft code
  // required by the /createflightplan command.
  const AIRCRAFT_CODE_MAP = {
    'A10 Warthog': 'A10',
    'An 225': 'A225',
    'Airbus A320': 'A320',
    'A330 MRTT': 'A332',
    'Airbus A330': 'A332',
    'Airbus A340': 'A345',
    'Airbus A350': 'A359',
    'Airbus A380': 'A388',
    'Airbus Beluga': 'A3ST',
    'An22': 'AN22',
    'ATR72': 'AT76',
    'ATR72F': 'AT76',
    'B1 Lancer': 'B1',
    'B2 Spirit Bomber': 'B2',
    'B29 SuperFortress': 'B29',
    'Bell 412': 'B412',
    'Bell 412 Rescue': 'B412',
    '707AF1': 'B703',
    'Boeing 707': 'B703',
    'KC-707': 'B703',
    'Boeing 727': 'B722',
    'Boeing 727 Cargo': 'B722',
    'C40': 'B737',
    'Boeing 737': 'B738',
    'Boeing 737 Cargo': 'B738',
    '747AF1': 'B742',
    'Boeing 747': 'B744',
    'Boeing 747 Cargo': 'B744',
    'Boeing 757': 'B752',
    'Boeing 757 Cargo': 'B752',
    'C-32': 'B752',
    'KC767': 'B762',
    'Boeing 767': 'B763',
    'Boeing 767 Cargo': 'B763',
    'Boeing 777 Cargo': 'B77L',
    'Boeing 777': 'B77W',
    'Boeing 787': 'B789',
    'Balloon': 'BALL',
    'Airbus A220': 'BCS1',
    'KingAir 260': 'BE20',
    'DreamLifter': 'BLCF',
    'C130 Hercules': 'C130',
    'EC-18B': 'C135',
    'C17': 'C17',
    'Cessna 172': 'C172',
    'Cessna 172 Amphibian': 'C172',
    'Cessna 172 Student': 'C172',
    'Cessna 182': 'C182',
    'Cessna 182 Amphibian': 'C182',
    'Cessna Caravan': 'C208',
    'Cessna Caravan Amphibian': 'C208',
    'Cessna Caravan Cargo': 'C208',
    'KC130J': 'C30J',
    'Cessna 402': 'C402',
    'Concorde': 'CONC',
    'F4U Corsair': 'CORS',
    'Bombardier CRJ700': 'CRJ7',
    'Diamond DA50': 'DA50',
    'Bombardier Q400': 'DH8D',
    'DHC-6 Twin Otter': 'DHC6',
    'DHC-6 Twin Otter Amphibian': 'DHC6',
    'Fokker Dr1': 'DR1',
    'E190': 'E190',
    'Extra 300s': 'E300',
    'E-3 Sentry': 'E3TF',
    'H135': 'EC35',
    'Eurofighter Typhoon': 'EUFI',
    'F14': 'F14',
    'F15': 'F15',
    'F16': 'F16',
    'F/A-18 Super Hornet': 'F18S',
    'F22': 'F22',
    'F35': 'F35',
    'F4 Phantom': 'F4',
    'BaggageTruck': 'GRND',
    'BaggageTruckSmall': 'GRND',
    'Bus': 'GRND',
    'CateringTruck': 'GRND',
    'FireTruck': 'GRND',
    'FollowMeTruck': 'GRND',
    'FuelTruck': 'GRND',
    'FuelTruckSmall': 'GRND',
    'PushBackBig': 'GRND',
    'PushBackGreen': 'GRND',
    'PushBackSmall': 'GRND',
    'StairTruck': 'GRND',
    'StairTruck737': 'GRND',
    'Chinook': 'H47',
    'UH-60': 'H60',
    'UH-60 Coast Guard': 'H60',
    'Harrier': 'HAR',
    'Hawk T1': 'HAWK',
    'Hurricane': 'HURI',
    'Piper Cub': 'J3',
    'Piper Cub Amphibian': 'J3',
    'KC-1': 'L101',
    'Lockheed Tristar': 'L101',
    'Bombardier Learjet 45': 'LJ45',
    'English Electric Lightning': 'LTNG',
    'Douglas MD11': 'MD11',
    'Douglas MD11 Cargo': 'MD11',
    'Douglas MD90': 'MD90',
    'Mig-15': 'MG15',
    'Piper PA28181': 'P28A',
    'P38 Lightning': 'P38',
    'P51 Mustang': 'P51',
    'P8': 'P8',
    'Paratrike': 'PARA',
    'Sikorsky S92': 'S92',
    'Sikorsky S92 Coast Guard': 'S92',
    'Gripen': 'SB39',
    'Cirrus Vision': 'SF50',
    'Blimp': 'SHIP',
    'CaravanBlimp': 'SHIP',
    'Sled': 'SLEI',
    'SR71 BlackBird': 'SR71',
    'SU27': 'SU27',
    'SU57': 'SU57',
    'Derek Plane': 'ULAC',
    'Avro Vulcan': 'VULC',
    'Wright Brothers Plane': 'WF',
    'A6M Zero': 'ZERO',
    'Caproni Stipa': 'ZZZZ',
    'Might Walrus': 'ZZZZ',
    'Rescue Boat': 'ZZZZ',
    'UFO': 'ZZZZ'
  };

  const AIRCRAFT_ALIASES = {
    'A-10 Warthog': 'A10', 'A10': 'A10',
    'Antonov AN-225 Mriya': 'A225', 'AN225': 'A225',
    'Airbus A320 Family': 'A320', 'A319': 'A320', 'A321': 'A320',
    'Airbus A330 MRTT': 'A332', 'KC-46': 'B762', 'KC-767': 'B762',
    'Airbus BelugaXL': 'A3ST', 'BelugaXL': 'A3ST',
    'Antonov An-22': 'AN22', 'AN-22': 'AN22',
    'ATR-72': 'AT76', 'ATR 72': 'AT76',
    'B-2 Spirit': 'B2', 'B-29': 'B29',
    'Boeing Dreamlifter': 'BLCF', 'Dream Lifter': 'BLCF',
    'Boeing C-17': 'C17', 'C-17 Globemaster': 'C17',
    'C-130 Hercules': 'C130', 'KC-130': 'C30J',
    'Boeing EC-18B': 'C135',
    'Embraer E190': 'E190', 'Embraer 190': 'E190',
    'Airbus H135': 'EC35',
    'F-14 Tomcat': 'F14', 'F-15E Strike Eagle': 'F15', 'F-16 Falcon': 'F16',
    'F-22 Raptor': 'F22', 'F-35B': 'F35', 'F-4 Phantom': 'F4',
    'UH-60 Black Hawk': 'H60', 'CH-47 Chinook': 'H47',
    'Hawker Harrier': 'HAR', 'Hawker Hurricane': 'HURI',
    'Piper PA-28 Arrow': 'P28A', 'PA-28 Arrow': 'P28A',
    'P-38 Lightning': 'P38', 'P-51 Mustang': 'P51',
    'Boeing P-8 Poseidon': 'P8', 'P-8 Poseidon': 'P8',
    'Sikorsky S-92': 'S92', 'Cirrus Vision SF50': 'SF50',
    'SR-71 Blackbird': 'SR71', 'Sukhoi Su-27': 'SU27', 'Sukhoi Su-57': 'SU57',
    'Wright Flyer': 'WF', 'MiG-15': 'MG15', 'MD-11': 'MD11', 'MD-90': 'MD90',
    '737': 'B738', '737-800': 'B738', 'Boeing 737-800': 'B738',
    '747': 'B744', '747-400': 'B744', 'Jumbo Jet': 'B744',
    '757': 'B752', '767': 'B763', '777': 'B77W', '777-300': 'B77W', '777-300ER': 'B77W',
    '777 Cargo': 'B77L', '787': 'B789', 'Dreamliner': 'B789', '727': 'B722', '707': 'B703',
    'A220': 'BCS1', 'A320': 'A320', 'A330': 'A332', 'A340': 'A345', 'A350': 'A359', 'A380': 'A388',
    'E190': 'E190', 'Q400': 'DH8D', 'Dash 8': 'DH8D', 'CRJ700': 'CRJ7', 'CRJ': 'CRJ7',
    'Concorde': 'CONC', 'MD11': 'MD11', 'MD90': 'MD90',
    'C17': 'C17', 'C130': 'C130', 'Hercules': 'C130', 'KC130': 'C30J',
    'P8': 'P8', 'Poseidon': 'P8', 'E3': 'E3TF', 'AWACS': 'E3TF',
    'F14': 'F14', 'Tomcat': 'F14', 'F15': 'F15', 'Strike Eagle': 'F15',
    'F16': 'F16', 'Viper': 'F16', 'F18': 'F18S', 'Hornet': 'F18S', 'Super Hornet': 'F18S',
    'F22': 'F22', 'Raptor': 'F22', 'F35': 'F35', 'A10': 'A10', 'Warthog': 'A10',
    'B2': 'B2', 'Spirit': 'B2', 'Typhoon': 'EUFI', 'Eurofighter': 'EUFI',
    'SU27': 'SU27', 'Flanker': 'SU27', 'SU57': 'SU57',
    'C172': 'C172', 'Cessna172': 'C172', 'C182': 'C182', 'Cessna182': 'C182',
    'Caravan': 'C208', 'C208': 'C208', 'C402': 'C402', 'Twin Otter': 'DHC6',
    'Learjet': 'LJ45', 'LJ45': 'LJ45', 'P51': 'P51', 'Mustang': 'P51',
    'Corsair': 'CORS', 'Zero': 'ZERO', 'Mig15': 'MG15', 'P38': 'P38',
    'B29': 'B29', 'Superfortress': 'B29', 'Vulcan': 'VULC', 'Harrier': 'HAR',
    'F4': 'F4', 'Phantom': 'F4', 'SR71': 'SR71', 'Blackbird': 'SR71'
  };

  // Top speed and landing data are from the supplied ATC24 performance document.
  // Cruise speed is deliberately estimated at 85% of the documented top speed.
  const AIRCRAFT_PERFORMANCE = {
    A10:  { name:'A-10 Warthog', top:381, stall:88, landingLow:105, landingHigh:120 },
    A225: { name:'Antonov AN-225 Mriya', top:458, stall:140, landingLow:165, landingHigh:165, noFlaps:203 },
    A320: { name:'Airbus A320', top:447, stall:88, landingLow:121, landingHigh:156 },
    A332: { name:'Airbus A330', top:475, stall:88, landingLow:85, landingHigh:135 },
    A345: { name:'Airbus A340', top:470, stall:118, landingLow:119, landingHigh:144 },
    A359: { name:'Airbus A350', top:487, stall:95, landingLow:95, landingHigh:145 },
    A388: { name:'Airbus A380', top:566, stall:94, landingLow:144, landingHigh:144 },
    A3ST: { name:'Airbus BelugaXL', top:420, stall:80, landingLow:80, landingHigh:105, noFlaps:116 },
    AN22: { name:'Antonov An-22', top:400, stall:104, landingLow:110, landingHigh:110, noFlaps:151 },
    AT76: { name:'ATR-72', top:224, stall:91, landingLow:91, landingHigh:107 },
    B2:   { name:'B-2 Spirit', top:545, stall:134, landingLow:160, landingHigh:185 },
    B29:  { name:'B-29', top:316, stall:55, landingLow:65, landingHigh:90 },
    B412: { name:'Bell 412', top:120, mode:'rotorcraft' },
    B722: { name:'Boeing 727', top:540, stall:62, landingLow:70, landingHigh:117, noFlaps:90 },
    B738: { name:'Boeing 737', top:454, stall:108, landingLow:113, landingHigh:136 },
    B744: { name:'Boeing 747', top:495, stall:118, landingLow:120, landingHigh:144, noFlaps:174 },
    B752: { name:'Boeing 757', top:458, stall:112, landingLow:113, landingHigh:136, noFlaps:165 },
    B762: { name:'KC-767 / KC-46', top:458, stall:92, landingLow:113, landingHigh:136, noFlaps:164 },
    B763: { name:'Boeing 767', top:458, stall:92, landingLow:113, landingHigh:136, noFlaps:164 },
    B77L: { name:'Boeing 777 Cargo', top:518, stall:121, landingLow:122, landingHigh:149, noFlaps:179 },
    B77W: { name:'Boeing 777', top:518, stall:121, landingLow:122, landingHigh:149 },
    B789: { name:'Boeing 787', top:487, stall:118, landingLow:120, landingHigh:144 },
    BCS1: { name:'Airbus A220', top:470, stall:100, landingLow:145, landingHigh:145 },
    BLCF: { name:'Boeing Dreamlifter', top:495, stall:85, landingLow:85, landingHigh:110, noFlaps:123 },
    C130: { name:'C-130 Hercules', top:291, stall:89, landingLow:129, landingHigh:129, noFlaps:155 },
    C135: { name:'Boeing EC-18B', top:545, stall:118, landingLow:121, landingHigh:145 },
    C17:  { name:'Boeing C-17', top:495, stall:90, landingLow:100, landingHigh:119 },
    C172: { name:'Cessna 172', top:163, stall:40, landingLow:45, landingHigh:70 },
    C182: { name:'Cessna 182', top:145, stall:30, landingLow:35, landingHigh:60 },
    C208: { name:'Cessna Caravan', top:186, stall:65, landingLow:65, landingHigh:90, noFlaps:94 },
    C30J: { name:'KC-130', top:291, stall:89, landingLow:129, landingHigh:129, noFlaps:155 },
    C402: { name:'Cessna 402', top:230, stall:64, landingLow:65, landingHigh:92 },
    CONC: { name:'Concorde', top:1165, stall:80, landingLow:120, landingHigh:160 },
    CORS: { name:'F4U Corsair', top:387, stall:45, landingLow:55, landingHigh:80 },
    CRJ7: { name:'Bombardier CRJ700', top:447, stall:116, landingLow:116, landingHigh:141 },
    DH8D: { name:'Bombardier Q400', top:360, stall:115, landingLow:115, landingHigh:140 },
    DHC6: { name:'DHC-6 Twin Otter', top:159, stall:33, landingLow:33, landingHigh:58 },
    DR1:  { name:'Fokker Dr1', top:99, stall:35, landingLow:45, landingHigh:70 },
    E190: { name:'Embraer E190', top:470, stall:95, landingLow:109, landingHigh:133 },
    E300: { name:'Extra 300s', top:185, stall:30, landingLow:79, landingHigh:79 },
    E3TF: { name:'E-3 Sentry', top:545, stall:118, landingLow:121, landingHigh:145 },
    EC35: { name:'Airbus H135', top:120, mode:'rotorcraft' },
    EUFI: { name:'Eurofighter Typhoon', top:1347, stall:96, landingLow:115, landingHigh:135 },
    F14:  { name:'F-14 Tomcat', top:1340, stall:117, landingLow:121, landingHigh:168 },
    F15:  { name:'F-15E Strike Eagle', top:1629, stall:60, landingLow:72, landingHigh:84 },
    F16:  { name:'F-16 Falcon', top:1174, stall:71, landingLow:85, landingHigh:100 },
    F18S: { name:'F/A-18 Super Hornet', top:1034, stall:92, landingLow:117, landingHigh:117 },
    F22:  { name:'F-22 Raptor', top:1305, stall:112, landingLow:140, landingHigh:169 },
    F35:  { name:'F-35B', top:1067, stall:51, landingLow:0, landingHigh:129 },
    F4:   { name:'F-4 Phantom', top:1279, stall:55, landingLow:60, landingHigh:70 },
    H47:  { name:'Chinook (CH-47)', top:167, mode:'rotorcraft' },
    H60:  { name:'UH-60 Black Hawk', top:120, mode:'rotorcraft' },
    HAR:  { name:'Hawker Harrier', top:647, stall:0, landingLow:0, landingHigh:129, mode:'vtol' },
    HAWK: { name:'Hawk T1', top:539, stall:56, landingLow:67, landingHigh:80 },
    HURI: { name:'Hawker Hurricane', top:295, stall:60, landingLow:72, landingHigh:95 },
    J3:   { name:'Piper Cub', top:80, stall:28, landingLow:28, landingHigh:53 },
    LJ45: { name:'Bombardier Learjet 45', top:463, stall:75, landingLow:127, landingHigh:127 },
    LTNG: { name:'EE Lightning', top:1153, stall:55, landingLow:65, landingHigh:90 },
    MD11: { name:'MD-11', top:473, stall:153, landingLow:153, landingHigh:178, noFlaps:222 },
    MD90: { name:'MD-90', top:473, stall:81, landingLow:81, landingHigh:106 },
    MG15: { name:'MiG-15', top:580, stall:140, landingLow:160, landingHigh:185 },
    P28A: { name:'Piper PA-28 Arrow', top:123, stall:60, landingLow:65, landingHigh:90 },
    P38:  { name:'P-38 Lightning', top:384, stall:50, landingLow:60, landingHigh:85 },
    P51:  { name:'P-51 Mustang', top:379, stall:100, landingLow:110, landingHigh:135 },
    P8:   { name:'Boeing P-8 Poseidon', top:454, stall:108, landingLow:113, landingHigh:136 },
    PARA: { name:'Paratrike', top:55, stall:15 },
    S92:  { name:'Sikorsky S-92', top:150, mode:'rotorcraft' },
    SF50: { name:'Cirrus Vision SF50', top:300, stall:56, landingLow:84, landingHigh:84 },
    SHIP: { name:'Blimp', top:120, mode:'rotorcraft' },
    SR71: { name:'SR-71 Blackbird', top:1905, stall:120, landingLow:155, landingHigh:155 },
    SU27: { name:'Sukhoi Su-27', top:1349, stall:116, landingLow:140, landingHigh:160 },
    SU57: { name:'Sukhoi Su-57', top:1150, stall:116, landingLow:140, landingHigh:160 },
    VULC: { name:'Avro Vulcan', top:566, stall:120, landingLow:145, landingHigh:170 },
    WF:   { name:'Wright Flyer', top:20, stall:5, landingLow:9, landingHigh:9 },
    ZERO: { name:'A6M Zero', top:305, stall:35, landingLow:45, landingHigh:70 }
  };

  const VARIANT_PERFORMANCE = {};

  function normalizeAircraftKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function addVariant(names, data) {
    names.forEach(name => { VARIANT_PERFORMANCE[normalizeAircraftKey(name)] = data; });
  }

  addVariant(['A330 MRTT', 'Airbus A330 MRTT', 'MRTT'], {
    name:'A330 MRTT', top:475, stall:87, landingLow:134, landingHigh:134, noFlaps:126
  });
  addVariant(['DHC-6 Twin Otter Amphibian', 'Twin Otter Amphibian'], {
    name:'DHC-6 Twin Otter Amphibian', top:159, stall:60
  });
  addVariant(['Cessna 172 Amphibian'], {
    name:'Cessna 172 Amphibian', top:143, stall:40, landingLow:45, landingHigh:70
  });
  addVariant(['Cessna Caravan Amphibian'], {
    name:'Cessna Caravan Amphibian', top:186, stall:65, landingLow:65, landingHigh:90, noFlaps:94
  });
  addVariant(['Cessna 182 Amphibian'], {
    name:'Cessna 182 Amphibian', top:145, stall:30, landingLow:35, landingHigh:60
  });
  addVariant(['Piper Cub Amphibian'], {
    name:'Piper Cub Amphibian', top:80, stall:28, landingLow:28, landingHigh:53
  });

  const NORMALIZED_DIRECTORY = {};
  Object.entries(AIRCRAFT_CODE_MAP).forEach(([name, code]) => {
    NORMALIZED_DIRECTORY[normalizeAircraftKey(name)] = { code, name };
  });
  Object.entries(AIRCRAFT_ALIASES).forEach(([name, code]) => {
    const key = normalizeAircraftKey(name);
    if (!NORMALIZED_DIRECTORY[key]) NORMALIZED_DIRECTORY[key] = { code, name };
  });
  new Set(Object.values(AIRCRAFT_CODE_MAP)).forEach(code => {
    const key = normalizeAircraftKey(code);
    if (!NORMALIZED_DIRECTORY[key]) {
      const name = Object.keys(AIRCRAFT_CODE_MAP).find(item => AIRCRAFT_CODE_MAP[item] === code) || code;
      NORMALIZED_DIRECTORY[key] = { code, name };
    }
  });

  function levenshteinDistance(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    const current = new Array(b.length + 1);
    for (let i = 1; i <= a.length; i++) {
      current[0] = i;
      for (let j = 1; j <= b.length; j++) {
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      for (let j = 0; j <= b.length; j++) previous[j] = current[j];
    }
    return previous[b.length];
  }

  function resolveAircraftType(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return { code:'', name:'', recognized:false, rawKey:'' };
    const rawKey = normalizeAircraftKey(trimmed);
    if (NORMALIZED_DIRECTORY[rawKey]) {
      return { ...NORMALIZED_DIRECTORY[rawKey], recognized:true, rawKey };
    }

    const keysByLength = Object.keys(NORMALIZED_DIRECTORY).sort((a, b) => b.length - a.length);
    for (const key of keysByLength) {
      if (key.length >= 3 && rawKey.includes(key)) {
        return { ...NORMALIZED_DIRECTORY[key], recognized:true, rawKey };
      }
    }

    let best = null;
    for (const key of keysByLength) {
      if (key.length < 5 || Math.abs(key.length - rawKey.length) > 3) continue;
      const distance = levenshteinDistance(rawKey, key);
      const maxLength = Math.max(rawKey.length, key.length);
      const allowed = maxLength >= 12 ? 3 : maxLength >= 7 ? 2 : 1;
      if (distance <= allowed && distance / maxLength <= 0.22 && (!best || distance < best.distance)) {
        best = { ...NORMALIZED_DIRECTORY[key], distance };
      }
    }
    if (best) return { code:best.code, name:best.name, recognized:true, fuzzy:true, rawKey };

    return { code:trimmed.toUpperCase(), name:trimmed, recognized:false, rawKey };
  }

  function getPerformanceForAircraft(raw, match) {
    const resolved = match || resolveAircraftType(raw);
    const variant = VARIANT_PERFORMANCE[normalizeAircraftKey(raw)];
    return variant || AIRCRAFT_PERFORMANCE[resolved.code] || null;
  }

  function finiteNumber(value) {
    const parsed = typeof value === 'number' ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function computePerformance(rawAircraft, manualStall) {
    const match = resolveAircraftType(rawAircraft);
    const performance = getPerformanceForAircraft(rawAircraft, match);
    const documentedStall = finiteNumber(performance?.stall);
    const enteredStall = finiteNumber(manualStall);
    const stall = enteredStall !== null ? enteredStall : documentedStall;
    const cruise = finiteNumber(performance?.top) !== null
      ? Math.round(performance.top * CRUISE_FACTOR)
      : null;

    if (performance?.mode === 'rotorcraft') {
      return { match, performance, mode:'rotorcraft', stall:null, v1:null, vr:null, v2:null, vref:null, vapp:null, cruise, noFlaps:null };
    }
    if (performance?.mode === 'vtol' || stall === 0) {
      return { match, performance, mode:'vtol', stall:0, v1:null, vr:null, v2:null, vref:null, vapp:null, cruise, noFlaps:finiteNumber(performance?.noFlaps) };
    }
    if (stall === null || stall <= 0) {
      return { match, performance, mode:'fixed-wing', stall:null, v1:null, vr:null, v2:null, vref:null, vapp:null, cruise, noFlaps:finiteNumber(performance?.noFlaps) };
    }

    // ATC24 game logic requested by the project owner: rotation is the documented stall/liftoff speed.
    const vr = Math.round(stall);
    const v1 = Math.max(0, Math.round(stall * 0.95));
    const v2 = Math.round(stall * 1.05);

    let landingLow = finiteNumber(performance?.landingLow);
    let landingHigh = finiteNumber(performance?.landingHigh);
    if (landingLow === 0 && landingHigh !== null && landingHigh > 0) landingLow = landingHigh;

    let vref;
    let vapp;
    if (landingLow !== null) {
      vref = Math.max(vr, Math.round(landingLow));
      if (landingHigh !== null && landingHigh > landingLow) {
        vapp = Math.max(vref, Math.round(landingHigh));
      } else {
        vapp = Math.max(vref + 2, Math.round(vref * 1.05));
      }
    } else {
      vref = Math.round(stall * 1.2);
      vapp = Math.max(vref + 2, Math.round(vref * 1.05));
    }

    return {
      match,
      performance,
      mode:'fixed-wing',
      stall:Math.round(stall),
      v1,
      vr,
      v2,
      vref,
      vapp,
      cruise,
      noFlaps:finiteNumber(performance?.noFlaps)
    };
  }

  function formatSpeed(value, unavailableText) {
    return Number.isFinite(value) ? `${Math.round(value)} kt` : (unavailableText || '—');
  }

  function performanceFields(rawAircraft, manualStall) {
    const result = computePerformance(rawAircraft, manualStall);
    const unavailable = result.mode === 'rotorcraft' ? 'N/A' : result.mode === 'vtol' ? 'VTOL' : '—';
    return {
      result,
      perfVstall: result.mode === 'rotorcraft' ? 'N/A' : result.mode === 'vtol' ? '0' : (Number.isFinite(result.stall) ? String(result.stall) : ''),
      outV1: formatSpeed(result.v1, unavailable),
      outVR: formatSpeed(result.vr, unavailable),
      outV2: formatSpeed(result.v2, unavailable),
      outVref: formatSpeed(result.vref, unavailable),
      outVapp: formatSpeed(result.vapp, unavailable),
      outCruise: formatSpeed(result.cruise, '—'),
      outNoFlaps: formatSpeed(result.noFlaps, '—')
    };
  }

  global.ATC24Aircraft = Object.freeze({
    PERFORMANCE_VERSION,
    CRUISE_FACTOR,
    AIRCRAFT_CODE_MAP,
    AIRCRAFT_PERFORMANCE,
    normalizeAircraftKey,
    resolveAircraftType,
    getPerformanceForAircraft,
    computePerformance,
    performanceFields,
    formatSpeed
  });
})(typeof window !== 'undefined' ? window : globalThis);
