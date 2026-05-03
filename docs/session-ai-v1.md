# session-ai-v1

`session-ai-v1` is the first structured interpretation contract between ChatGPT and Pacer.

It is intentionally small. The goal is not to automate coaching logic yet, but to give Pacer a stable place to store the interpretation layer that later feeds `run.nico.ar`.

## Current workflow

1. Pacer prepares the brief from the selected session plus manual inputs.
2. The brief can be sent to ChatGPT, optionally with a TCX file.
3. ChatGPT returns structured interpretation text.
4. The operator pastes that JSON into the AI import block in Pacer, or uploads it as a `.json` file.
5. Pacer stores the result in `session_ai`.

## Fields

- `signal_title`
  Short headline for the session read.

- `signal_paragraphs`
  Main interpretation body. In the UI it is imported from JSON.
  Pacer accepts either an array of paragraphs or a multiline string and stores JSON.

- `carry_forward`
  What should persist into the next session or the rest of the week.

- `next_run_title`
  Short label for the next suggested run.

- `next_run_summary`
  One short paragraph describing the next run intent.

- `next_run_duration_min`
  Minimum suggested duration in minutes.

- `next_run_duration_max`
  Maximum suggested duration in minutes.

- `next_run_pace_min_sec_per_km`
  Slower edge of the pace guidance, in seconds per kilometer.

- `next_run_pace_max_sec_per_km`
  Faster edge of the pace guidance, in seconds per kilometer.

- `next_run_workout`
  Optional practical workout guide for manually recreating the next session in Garmin Connect.
  When present, `type` must use one of Pacer's controlled session types, and `blocks` is an ordered list of readable workout steps.

- `week_title`
  Short weekly headline.

- `week_summary`
  Short weekly paragraph.

## Example

```json
{
  "signalTitle": "Solid aerobic signal",
  "signalParagraphs": [
    "The session stayed honest from the first kilometer and never drifted into panic pacing.",
    "The closing part looked stronger than the opening part, which is exactly the kind of control worth protecting for the rest of the week."
  ],
  "carryForward": "Keep the week calm and progressive.",
  "nextRunTitle": "Easy reset run",
  "nextRunSummary": "Keep the effort quiet, restore rhythm, and arrive fresh for the next quality day.",
  "nextRunDurationMin": 40,
  "nextRunDurationMax": 45,
  "nextRunPaceMinSecPerKm": 400,
  "nextRunPaceMaxSecPerKm": 425,
  "nextRunWorkout": {
    "type": "Easy Run",
    "blocks": [
      "Run — 40:00-45:00 @ 6:40-7:05 /km"
    ]
  },
  "weekTitle": "Steady base",
  "weekSummary": "Enough volume to move the week forward without turning it into a spreadsheet contest."
}
```

## What is not in v1

- No race calendar logic
- No Garmin automation
- No extra manual tags like soreness or mood
- No direct publish into `run.nico.ar`
- No model-specific orchestration beyond storing optional metadata when available
