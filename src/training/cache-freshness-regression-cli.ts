import * as assert from 'node:assert/strict';
import { isRecentSessionDate, isWellnessCacheFresh, shouldCacheGarminDeviceLaps } from './cache-freshness';

const now = new Date('2026-10-17T12:00:00.000Z');

assert.equal(isRecentSessionDate('2026-10-15', now), true);
assert.equal(isRecentSessionDate('2026-10-10', now), true);
assert.equal(isRecentSessionDate('2026-10-09', now), false);
assert.equal(isRecentSessionDate('not-a-date', now), false);
assert.equal(isWellnessCacheFresh('2026-10-15', '2026-10-17T07:00:01.000Z', now), true);
assert.equal(isWellnessCacheFresh('2026-10-15', '2026-10-17T05:59:59.000Z', now), false);
assert.equal(isWellnessCacheFresh('2026-09-01', 'not-a-timestamp', now), true, 'historical cache avoids API calls');
assert.equal(shouldCacheGarminDeviceLaps([]), false, 'an empty FIT parse must retry after delayed synchronization');
assert.equal(shouldCacheGarminDeviceLaps([{ lapIndex: 1 }]), true);

console.log('Cache freshness regression checks passed.');
