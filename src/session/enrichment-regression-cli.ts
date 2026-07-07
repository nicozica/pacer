import assert from 'assert';
import { buildNormalizedLaps, parseTcxLapsFromText } from './service';
import type { SourceStreamPayload } from './source';
import type { StoredSession } from './types';

function streamPayload(): SourceStreamPayload {
  return {
    distance: { data: [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000] },
    time: { data: [0, 90, 180, 270, 360, 455, 550, 645, 740] },
    heartrate: { data: [120, 130, 135, 140, 145, 150, 155, 160, 165] },
    moving: { data: [true, true, true, true, true, true, true, true, true] },
  };
}

function tcxFixture(): string {
  return `
    <TrainingCenterDatabase>
      <Activities>
        <Activity Sport="Running">
          <Lap StartTime="2026-07-07T10:00:00Z">
            <TotalTimeSeconds>360</TotalTimeSeconds>
            <DistanceMeters>1000</DistanceMeters>
            <AverageHeartRateBpm><Value>142</Value></AverageHeartRateBpm>
          </Lap>
          <Lap StartTime="2026-07-07T10:06:00Z">
            <TotalTimeSeconds>370</TotalTimeSeconds>
            <DistanceMeters>1000</DistanceMeters>
            <AverageHeartRateBpm><Value>151</Value></AverageHeartRateBpm>
          </Lap>
        </Activity>
      </Activities>
    </TrainingCenterDatabase>
  `;
}

function storedSessionWithLaps(laps: ReturnType<typeof buildNormalizedLaps>['laps']): StoredSession {
  return {
    core: {
      id: 1,
      sessionDate: '2026-07-07',
      startDateLocal: '2026-07-07T07:00:00',
      title: 'Test Run',
      sport: 'Run',
      source: 'intervals-api',
      sourceActivityId: 123,
      distanceM: 2000,
      movingTimeS: 740,
      elapsedTimeS: 740,
      paceSecPerKm: 370,
      hrAvg: 150,
      hrMax: 165,
      elevationM: null,
      weatherTempC: null,
      weatherCondition: null,
      weatherWindKmh: null,
      polyline: null,
      city: null,
      createdAt: '2026-07-07T00:00:00.000Z',
      updatedAt: '2026-07-07T00:00:00.000Z',
      publishedAt: null,
    },
    manual: {
      sessionType: '',
      legs: '',
      sleepScore: null,
      restedness: '',
      extraNotes: '',
    },
    files: {
      tcxFilename: '',
      tcxAttached: false,
      briefFilename: '',
    },
    ai: {
      signalTitle: '',
      signalParagraphs: [],
      carryForward: '',
      nextRunTitle: '',
      nextRunSummary: '',
      nextRunDurationMin: null,
      nextRunDurationMax: null,
      nextRunDistanceKm: null,
      nextRunPaceMinSecPerKm: null,
      nextRunPaceMaxSecPerKm: null,
      nextRunWorkout: null,
      weekTitle: '',
      weekSummary: '',
      modelName: null,
      promptVersion: null,
      generatedAt: null,
    },
    laps,
  };
}

async function assertLatestSelectionWins(): Promise<void> {
  let requestId = 0;
  let applied: string | null = null;

  async function loadSelection(label: string, delayMs: number): Promise<void> {
    const currentRequestId = ++requestId;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    if (currentRequestId === requestId) {
      applied = label;
    }
  }

  const slow = loadSelection('slow-old-selection', 20);
  const fast = loadSelection('fast-new-selection', 1);
  await Promise.all([slow, fast]);

  assert.equal(applied, 'fast-new-selection');
}

async function main(): Promise<void> {
  const intervals = buildNormalizedLaps({ streamPayload: streamPayload() });
  assert.equal(intervals.lapSource, 'intervals');
  assert.equal(intervals.laps.length, 2);
  assert.equal(intervals.laps[0].lapSource, 'intervals');

  const tcxLaps = parseTcxLapsFromText(tcxFixture());
  const tcxFallback = buildNormalizedLaps({ tcxLaps });
  assert.equal(tcxFallback.lapSource, 'tcx');
  assert.equal(tcxFallback.laps.length, 2);
  assert.equal(tcxFallback.laps[0].paceSecPerKm, 360);

  const saved = buildNormalizedLaps({
    streamPayload: streamPayload(),
    existing: storedSessionWithLaps(tcxFallback.laps),
    tcxLaps,
  });
  assert.deepEqual(saved, intervals);

  const none = buildNormalizedLaps({});
  assert.equal(none.lapSource, 'none');
  assert.equal(none.laps.length, 0);

  await assertLatestSelectionWins();

  console.log('Session enrichment regression checks passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
