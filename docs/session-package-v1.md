# session-package-v1

`session-package-v1` is the first structured session contract stored in Pacer.

It reflects the current workflow:

1. Strava remains the raw activity source.
2. Pacer loads the selected run from `storage/json/activities.latest.json`.
3. The editor merges raw activity data with manual notes, file references, and AI interpretation.
4. SQLite becomes the source of truth.
5. Pacer can publish local JSON snapshots for `run.nico.ar` later, without writing into that repo directly.

## Stored shape

Each saved session is composed of five parts plus derived weekly data:

- `sessions`: immutable-ish workout facts coming from Strava plus best-effort weather enrichment.
- `session_laps`: lap data when Pacer has it available.
- `session_manual`: human notes entered in the editor.
- `session_files`: file references managed in Pacer.
- `session_ai`: structured interpretation layer coming from ChatGPT or manual edits.
- `weekly_snapshots`: rolling 7-day summary generated from saved sessions.

## Manual fields

`session_manual` only includes:

- `session_type`
- `legs`
- `sleep_score`
- `restedness`
- `extra_notes`

No extra manual fields are part of v1.

## JSON-facing package

When Pacer loads or saves a session in the editor, the effective package is:

```json
{
  "session": {
    "sessionId": 12,
    "sessionDate": "2026-03-17",
    "title": "Morning Run",
    "sport": "Run",
    "source": "strava-api",
    "sourceActivityId": 17751752060,
    "distanceM": 8511.2,
    "movingTimeS": 3447,
    "elapsedTimeS": 3606,
    "paceSecPerKm": 405,
    "hrAvg": 156,
    "hrMax": 183,
    "elevationM": 44,
    "weatherTempC": 22.1,
    "weatherCondition": "clear",
    "weatherWindKmh": 7.8,
    "polyline": "...",
    "city": null,
    "createdAt": "2026-03-17T14:00:00.000Z",
    "updatedAt": "2026-03-17T14:08:00.000Z"
  },
  "laps": [
    {
      "lapIndex": 1,
      "distanceM": 1000,
      "durationS": 404,
      "paceSecPerKm": 404,
      "hrAvg": 149
    }
  ],
  "manual": {
    "sessionType": "Easy Run",
    "legs": "Normal",
    "sleepScore": 76,
    "restedness": "3 - Normal",
    "extraNotes": "Felt mostly controlled, but heart rate ran a bit higher than a pure reset day."
  },
  "files": {
    "tcxFilename": "",
    "tcxAttached": false,
    "briefFilename": "2026-03-17-session-brief.txt"
  },
  "ai": {
    "signalTitle": "Not a pure easy run",
    "signalParagraphs": [
      "The pace stayed manageable, but the internal cost drifted above what a fully easy day would usually ask for.",
      "Treat it as useful aerobic work with a little extra load rather than as a free recovery slot."
    ],
    "carryForward": "Let the next run absorb the effort instead of stacking more intensity on top of it.",
    "nextRunTitle": "Short recovery shuffle",
    "nextRunSummary": "Run by feel, keep the stride light, and let the heart rate settle lower than today.",
    "nextRunDurationMin": 30,
    "nextRunDurationMax": 40,
    "nextRunDistanceKm": 6.0,
    "nextRunPaceMinSecPerKm": 410,
    "nextRunPaceMaxSecPerKm": 440,
    "nextRunWorkout": {
      "type": "Recovery Run",
      "blocks": [
        "Run — 30:00-40:00 easy"
      ]
    },
    "weekTitle": "Aerobic control first",
    "weekSummary": "The week is moving forward, but the easiest days still need to look easy enough to protect the bigger sessions."
  }
}
```

## Publish snapshots

`Save and publish` writes local snapshots under `storage/json/cms/`:

- `latest-session.json`
- `next-run.json`
- `weekly-summary.json`
- `archive-list.json`

These are local Pacer outputs only. `run.nico.ar` can consume them later, but Pacer does not write into that repo.

Dashboard summary guidance:
- `next-run.json.summary` should stay compact: 1-2 short sentences, about 120-180 characters, focused on intent rather than step-by-step structure.
- `next-run.json.distanceKm` should stay optional and represent one practical estimated distance value, formatted later by `run.nico.ar`.
- `weekly-summary.json.summary` should also stay compact and fit naturally in about 3 visual lines on `run.nico.ar`.
- When `nextRunWorkout` exists, warm-up / reps / cooldown details belong in `nextRunWorkout.blocks`, not duplicated in `nextRunSummary`.
- `nextRunSummary` should describe the intent and feel of the run, not restate the recipe.
- Exact rep counts, detailed step timing, and explicit pace brackets should live in `nextRunWorkout.blocks`, not in the dashboard summary.
