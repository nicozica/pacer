export interface ActivityNameMetadata {
  rawActivityName: string;
  displayActivityName: string;
  workoutCode: string | null;
  workoutType: string | null;
  sessionTypeSuggestion: string | null;
}

const LOCATION_PREFIXES = [
  'Buenos Aires City',
  'Buenos Aires',
];

const GENERIC_RUN_NAMES = new Set([
  'running',
  'run',
]);

export const CANONICAL_SESSION_TYPES = [
  'Easy Run',
  'Long Run',
  'Recovery Run',
  'Hills',
  'Strides',
  'Interval Session',
  'Tempo Session',
  'Time Trial',
  'Race',
] as const;

const SESSION_TYPE_ALIASES: Array<[RegExp, string]> = [
  [/\beasy\s*run\b/i, 'Easy Run'],
  [/\brecovery\s*run\b/i, 'Recovery Run'],
  [/\blong\s*run\b/i, 'Long Run'],
  [/\bintervals?\s*(run|session)?\b/i, 'Interval Session'],
  [/\bfartlek\s*run\b/i, 'Interval Session'],
  [/\bfartlek\b/i, 'Interval Session'],
  [/\btempo\b/i, 'Tempo Session'],
  [/\bthreshold\s*run\b/i, 'Tempo Session'],
  [/\bthreshold\b/i, 'Tempo Session'],
  [/\bstrides?\b/i, 'Strides'],
  [/\bhills?\b/i, 'Hills'],
  [/\brace\b/i, 'Race'],
  [/\btime\s*trial\b/i, 'Time Trial'],
];

export function normalizeSessionTypeAlias(value: string | null | undefined): string | null {
  const normalized = (value ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) {
    return null;
  }

  for (const canonical of CANONICAL_SESSION_TYPES) {
    if (normalized.toLowerCase() === canonical.toLowerCase()) {
      return canonical;
    }
  }

  for (const [pattern, sessionType] of SESSION_TYPE_ALIASES) {
    if (pattern.test(normalized)) return sessionType;
  }

  return normalized;
}

function stripLocationPrefix(value: string): string {
  let normalized = value.trim();

  for (const prefix of LOCATION_PREFIXES) {
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    normalized = normalized.replace(new RegExp(`^${escapedPrefix}\\s*-\\s*`, 'i'), '').trim();
    normalized = normalized.replace(new RegExp(`^${escapedPrefix}\\s+`, 'i'), '').trim();
  }

  return normalized || value.trim();
}

function detectWorkoutCode(value: string): string | null {
  return value.match(/\b(W\d{2}D\d{1,2})\b/i)?.[1].toUpperCase() ?? null;
}

function detectSessionType(value: string, sport: string | undefined): string | null {
  for (const [pattern, sessionType] of SESSION_TYPE_ALIASES) {
    if (pattern.test(value)) return sessionType;
  }

  return sport === 'Run' ? 'Run' : null;
}

function cleanWorkoutDisplay(value: string): string {
  return value.replace(/\b(W\d{2}D\d{1,2})\s*-\s*/i, (_match, code: string) => `${code.toUpperCase()} · `);
}

export function buildActivityNameMetadata(rawName: string | undefined, sport: string | undefined): ActivityNameMetadata {
  const rawActivityName = (rawName ?? '').trim() || 'Untitled activity';
  const withoutLocation = stripLocationPrefix(rawActivityName);
  const workoutCode = detectWorkoutCode(withoutLocation);
  const sessionTypeSuggestion = detectSessionType(withoutLocation, sport);
  const lowerWithoutLocation = withoutLocation.toLowerCase();
  const displayBase = GENERIC_RUN_NAMES.has(lowerWithoutLocation) && sport === 'Run'
    ? 'Run'
    : withoutLocation;
  const displayActivityName = cleanWorkoutDisplay(displayBase);

  return {
    rawActivityName,
    displayActivityName,
    workoutCode,
    workoutType: sessionTypeSuggestion,
    sessionTypeSuggestion,
  };
}
