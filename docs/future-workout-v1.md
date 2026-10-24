# future-workout-v1

`future-workout-v1` is Pacer's separate contract for a proposed, executable
future running workout. It is not part of `session-ai-v1`, and it does not
replace `nextRunWorkout.blocks`: those remain a compact human-readable summary.

The contract is proposal-only at import time. Coachat may propose a workout by
JSON, but Pacer must explicitly approve it before any future calendar sync.

## Importable proposal

```json
{
  "contractVersion": "future-workout-v1",
  "proposalKey": "long-run-steady-finish",
  "proposalRevision": 1,
  "proposedAt": "2026-10-18T12:00:00.000Z",
  "updatedAt": "2026-10-18T12:00:00.000Z",
  "sourceSession": {
    "sourceActivityId": 198651687,
    "sessionDate": "2026-10-18"
  },
  "schedule": {
    "localDate": "2026-10-25",
    "timezone": "America/Argentina/Buenos_Aires"
  },
  "workoutType": "Long Run",
  "title": "Long Run + Steady Finish",
  "coachingNotes": "Keep the first hour easy. Let the final block become steady only if the legs stay composed.",
  "blocks": [
    {
      "kind": "warmup",
      "duration": { "unit": "time", "seconds": 900 },
      "target": { "kind": "unrestricted" },
      "label": "Settle in",
      "cue": "Keep the effort conversational"
    },
    {
      "kind": "work",
      "duration": { "unit": "time", "seconds": 3600 },
      "target": { "kind": "unrestricted" },
      "label": "Aerobic volume"
    },
    {
      "kind": "work",
      "duration": { "unit": "time", "seconds": 1200 },
      "target": { "kind": "pace", "minSecPerKm": 300, "maxSecPerKm": 315 },
      "label": "Steady finish"
    },
    {
      "kind": "cooldown",
      "duration": { "unit": "time", "seconds": 600 },
      "target": { "kind": "unrestricted" }
    }
  ],
  "lifecycle": {
    "approvalStatus": "proposed",
    "approvedAt": null,
    "approvalNote": null,
    "syncStatus": "not_requested",
    "syncedAt": null,
    "intervalsEventId": null,
    "lastSyncError": null
  }
}
```

## Rules

- `sourceSession` identifies the completed activity/session that motivated the proposal.
- `schedule.localDate` is interpreted only in `schedule.timezone`.
- `workoutType` must be one of Pacer's canonical session types.
- A leaf block is `warmup`, `work`, `recovery`, or `cooldown`; it has exactly one time or distance duration and either unrestricted effort or an ordered pace range in seconds per kilometre.
- A leaf block may include an optional `cue`: a concise, single-line English coaching instruction (maximum 120 characters). `label` remains the step name; Pacer serializes a cue as `label: cue` before the duration for Intervals/Garmin. Cues cannot contain structured-workout delimiters or line breaks.
- A `repeat` group has 2–100 repetitions, cannot nest another repeat group, and must contain a `work` step.
- Imported proposals must be `proposed`, `not_requested`, and have no approval or Intervals event identifier. Import cannot approve or schedule a workout.

For repeated steps, put `cue` on each leaf step, never on the repeat group itself:

```json
{
  "kind": "repeat",
  "repetitions": 2,
  "label": "Strides",
  "steps": [
    { "kind": "work", "label": "Run", "cue": "Smooth and relaxed", "duration": { "unit": "time", "seconds": 20 }, "target": { "kind": "pace", "minSecPerKm": 300, "maxSecPerKm": 320 } },
    { "kind": "recovery", "label": "Recover", "cue": "Easy breathing", "duration": { "unit": "time", "seconds": 60 }, "target": { "kind": "pace", "minSecPerKm": 420, "maxSecPerKm": 440 } }
  ]
}
```

## Pacer-owned identity and revision safety

Pacer derives `pacerWorkoutId` from source activity ID, source session date,
scheduled date/timezone, and `proposalKey`. It also derives the stable future
Intervals event key as `pacer:<pacerWorkoutId>`. Neither value is accepted from
Coachat JSON.

This makes a revision stable only while it describes the same scheduled
occurrence. Changing `schedule.localDate` deliberately creates a different
identity: before calendar synchronization exists, a future Phase must provide
an explicit supersede/reschedule action so an old proposed occurrence is not
left looking actionable.

Phase 2B should persist one row per `pacerWorkoutId`. An import may replace an
existing proposal only when the ID matches, both versions remain `proposed`,
and `proposalRevision` increases. Approved, rejected, superseded, synchronized,
or failed proposals must require an explicit user action rather than an import
overwrite.

## Lifecycle for later phases

`approvalStatus` moves from `proposed` to `approved`, `rejected`, or
`superseded` through explicit local UI actions. Only an approved proposal may
move sync state from `not_requested` to `pending`, then `synced` or `failed`.
`intervalsEventId` is written only after a successful future Intervals.icu
calendar operation. Phase 2A performs none of those writes.

## Phase 2B.1 private API

The private Pacer server persists proposals independently of `session_ai` and
the saved-session/publishing flow. Importing or approving a proposal never
saves, edits, or publishes its `sourceSession`.

`POST /api/workouts/import`

Accepts an importable `future-workout-v1` document directly as the JSON body.
Pacer validates it, derives `pacerWorkoutId` and the future Intervals event
key, and returns the stored proposal plus a readable `preview` array.

- `201` — new proposal (`operation: "created"`)
- `200` — byte-for-byte equivalent proposal (`operation: "unchanged"`) or a
  newer permitted proposal revision (`operation: "revised"`)
- `400` — malformed JSON or invalid contract
- `409` — conflicting same revision, an older revision, or an attempted
  replacement after approval/synchronization

`GET /api/workouts`

Lists stored proposal records in scheduled-date order. Each record contains
`workout`, server timestamps, append-only revision history, and `preview`.

`GET /api/workouts/:pacerWorkoutId`

Returns one record, or `404` if it is unknown.

`POST /api/workouts/:pacerWorkoutId/approve`

Accepts an optional body of `{ "approvalNote": "..." }`. The server, rather
than Coachat JSON, sets the approval timestamp and state. The operation is
idempotent for an already approved record. It returns `409` unless the proposal
is still unsynchronized and in `proposed` state.

These routes inherit the existing private Pacer-admin deployment perimeter;
the application has no separate per-route authentication layer. They must not
be exposed through the public run.nico.ar site. A future public or multi-user
deployment needs explicit authentication before exposing mutation routes.

## Calendar-ready requirements (future Phase 2C)

This contract is sufficient to propose and approve a workout, but not yet to
create a precise calendar event. Before an Intervals.icu write integration,
add either a validated `schedule.localStartTime` (HH:MM, interpreted in the
existing IANA timezone) or an explicit all-day scheduling policy. Do not infer
a time from the duration or from a prior activity. The synchronization action
must also introduce explicit supersede/reschedule handling for a moved date,
and preserve the original proposal plus the old event key for auditability.

## Phase 2B.2 boundary

Phase 2B.2 can add a local approval UI that consumes these endpoints and
renders the server-produced preview. It should never send Pacer-owned identity
or lifecycle fields as a way to force state changes. Calendar synchronization
remains a later explicit action: it must read only an approved proposal, use
the deterministic `intervalsEventKey` for idempotency, and record its result
without modifying the original proposal content.
