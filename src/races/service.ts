import * as fs from 'fs';
import * as path from 'path';
import { config } from '../config';

export type RacePriority = 'A' | 'B' | 'C';

export interface RaceDefinition {
  slug: string;
  title: string;
  date: string;
  distanceKm: number;
  priority: RacePriority;
}

export interface RaceInput {
  title?: unknown;
  date?: unknown;
  distanceKm?: unknown;
  priority?: unknown;
}

export interface RaceActivityMatchInput {
  date: string;
  distanceKm: number | null;
  workoutCode: string | null;
}

function validateDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error('Race date must use YYYY-MM-DD.');
  }

  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('Race date must be a real calendar date.');
  }

  return value;
}

function validateTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) {
    throw new Error('Race title is required.');
  }
  return title;
}

function validateDistance(value: unknown): number {
  const distance = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(distance) || distance <= 0) {
    throw new Error('Distance must be a positive number of kilometres.');
  }
  return distance;
}

function validatePriority(value: unknown): RacePriority {
  if (value === 'A' || value === 'B' || value === 'C') {
    return value;
  }
  return 'B';
}

function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function raceFilePath(): string {
  if (!config.runSiteRacesFile) {
    throw new Error(
      'Race calendar path is not configured. Set RUN_REPO to the run.nico.ar checkout or set RUN_SITE_RACES_FILE explicitly.'
    );
  }
  return config.runSiteRacesFile;
}

function readRaces(): RaceDefinition[] {
  const filePath = raceFilePath();
  let parsed: unknown;

  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read race calendar at ${filePath}: ${(error as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Race calendar at ${filePath} must be a JSON array.`);
  }

  return parsed.map((race, index) => {
    if (!race || typeof race !== 'object' || Array.isArray(race)) {
      throw new Error(`Race calendar entry ${index + 1} must be an object.`);
    }
    const entry = race as Record<string, unknown>;
    const slug = typeof entry.slug === 'string' ? entry.slug.trim() : '';
    if (!slug) {
      throw new Error(`Race calendar entry ${index + 1} is missing a slug.`);
    }
    return {
      slug,
      title: validateTitle(entry.title),
      date: validateDate(entry.date),
      distanceKm: validateDistance(entry.distanceKm),
      priority: validatePriority(entry.priority),
    };
  });
}

function writeRaces(races: RaceDefinition[]): void {
  const filePath = raceFilePath();
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.tmp`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(tempPath, `${JSON.stringify(races, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, filePath);
}

function sortRaces(races: RaceDefinition[]): RaceDefinition[] {
  return [...races].sort((left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title));
}

export function findMatchingRace(
  races: RaceDefinition[],
  activity: RaceActivityMatchInput,
): RaceDefinition | null {
  if (!activity.workoutCode || !Number.isFinite(activity.distanceKm) || (activity.distanceKm ?? 0) <= 0) {
    return null;
  }

  const sameDay = races.filter((race) => race.date === activity.date);
  if (sameDay.length === 0) return null;

  const distanceKm = activity.distanceKm as number;
  const candidates = sameDay
    .map((race) => ({
      race,
      differenceKm: Math.abs(distanceKm - race.distanceKm),
      toleranceKm: Math.max(0.5, race.distanceKm * 0.03),
    }))
    .filter((candidate) => candidate.differenceKm <= candidate.toleranceKm)
    .sort((left, right) => left.differenceKm - right.differenceKm);

  return candidates[0]?.race ?? null;
}

function uniqueGeneratedSlug(title: string, date: string, races: RaceDefinition[]): string {
  const base = slugify(`${title}-${date}`) || `race-${date}`;
  const existing = new Set(races.map((race) => race.slug));
  if (!existing.has(base)) return base;

  let suffix = 2;
  while (existing.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function listRaces(): RaceDefinition[] {
  return sortRaces(readRaces());
}

export function createRace(input: RaceInput): RaceDefinition {
  const races = readRaces();
  const title = validateTitle(input.title);
  const date = validateDate(input.date);
  const race: RaceDefinition = {
    slug: uniqueGeneratedSlug(title, date, races),
    title,
    date,
    distanceKm: validateDistance(input.distanceKm),
    priority: validatePriority(input.priority),
  };
  races.push(race);
  writeRaces(races);
  return race;
}

export function updateRace(slug: string, input: RaceInput): RaceDefinition {
  const races = readRaces();
  const index = races.findIndex((race) => race.slug === slug);
  if (index < 0) {
    throw new Error('Race not found.');
  }

  const current = races[index];
  const updated: RaceDefinition = {
    slug: current.slug,
    title: input.title === undefined ? current.title : validateTitle(input.title),
    date: input.date === undefined ? current.date : validateDate(input.date),
    distanceKm: input.distanceKm === undefined ? current.distanceKm : validateDistance(input.distanceKm),
    priority: input.priority === undefined ? current.priority : validatePriority(input.priority),
  };
  races[index] = updated;
  writeRaces(races);
  return updated;
}

export function deleteRace(slug: string): void {
  const races = readRaces();
  const remaining = races.filter((race) => race.slug !== slug);
  if (remaining.length === races.length) {
    throw new Error('Race not found.');
  }
  writeRaces(remaining);
}
