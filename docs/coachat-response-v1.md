# coachat-response-v1

Pacer accepts one Coachat response with a completed-session analysis and one
proposed future workout. `sessionAi` remains internally compatible with
`session-ai-v1`; `futureWorkout` remains internally compatible with
`future-workout-v1`.

```json
{
  "contractVersion": "coachat-response-v1",
  "sessionAi": {
    "sourceActivityId": 198651687,
    "sessionDate": "2026-10-18",
    "signalTitle": "Aerobic work absorbed well",
    "signalParagraphs": ["Keep the next long run controlled."],
    "carryForward": "Watch calf tightness.",
    "nextRunTitle": "Long Run + Steady Finish",
    "nextRunSummary": "Easy volume, with a conditional steady finish.",
    "nextRunWorkout": { "type": "Long Run", "blocks": ["75 min easy", "20 min steady if comfortable"] },
    "weekTitle": "Build", "weekSummary": "One quality long run."
  },
  "futureWorkout": {
    "contractVersion": "future-workout-v1",
    "proposalKey": "long-run-steady-finish",
    "proposalRevision": 1,
    "proposedAt": "2026-10-18T12:00:00.000Z",
    "updatedAt": "2026-10-18T12:00:00.000Z",
    "sourceSession": { "sourceActivityId": 198651687, "sessionDate": "2026-10-18" },
    "schedule": { "localDate": "2026-10-25", "timezone": "America/Argentina/Buenos_Aires" },
    "workoutType": "Long Run", "title": "Long Run + Steady Finish", "coachingNotes": "Finish steady only if comfortable.",
    "blocks": [{ "kind": "work", "label": "Easy Run", "cue": "Keep it conversational", "duration": { "unit": "time", "seconds": 4500 }, "target": { "kind": "unrestricted" } }],
    "lifecycle": { "approvalStatus": "proposed", "approvedAt": null, "approvalNote": null, "syncStatus": "not_requested", "syncedAt": null, "intervalsEventId": null, "lastSyncError": null }
  }
}
```
