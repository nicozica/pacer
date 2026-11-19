import assert from 'node:assert/strict';
import { compactPublicWeekSummary } from './service';

assert.equal(
  compactPublicWeekSummary("Two 7.1 km sessions restored aerobic rhythm. Sunday's long run should consolidate progress."),
  'Two 7.1 km sessions restored aerobic rhythm. The long run should consolidate progress.',
  'a future weekday attached to a planned workout must not be public',
);

assert.equal(
  compactPublicWeekSummary('Tuesday\'s completed activity showed a controlled effort.'),
  'Tuesday\'s completed activity showed a controlled effort.',
  'historical activity wording is not rewritten',
);

console.log('Public weekly-summary privacy regression checks passed.');
