import * as assert from 'assert';
import { RaceDefinition, findMatchingRace } from './service';

const races: RaceDefinition[] = [
  {
    slug: 'maraton',
    title: 'Maratón de Buenos Aires',
    date: '2026-09-20',
    distanceKm: 42.195,
    priority: 'A',
  },
];

assert.equal(
  findMatchingRace(races, { date: '2026-09-20', distanceKm: 42.92333, workoutCode: 'W16D7' })?.title,
  'Maratón de Buenos Aires',
);
assert.equal(findMatchingRace(races, { date: '2026-09-19', distanceKm: 42.195, workoutCode: 'W16D6' }), null);
assert.equal(findMatchingRace(races, { date: '2026-09-20', distanceKm: 10, workoutCode: 'W16D7' }), null);
assert.equal(findMatchingRace(races, { date: '2026-09-20', distanceKm: 42.195, workoutCode: null }), null);

console.log('Race activity matching regression checks passed.');
