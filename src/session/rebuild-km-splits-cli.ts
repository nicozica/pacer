import { publishSnapshots, saveSession } from "./service";
import { listStoredSessions } from "./storage";

function toAiInput(session: ReturnType<typeof listStoredSessions>[number]["ai"]) {
  return {
    signalTitle: session.signalTitle,
    signalParagraphs: session.signalParagraphs,
    carryForward: session.carryForward,
    nextRunTitle: session.nextRunTitle,
    nextRunSummary: session.nextRunSummary,
    nextRunDurationMin: session.nextRunDurationMin,
    nextRunDurationMax: session.nextRunDurationMax,
    nextRunPaceMinSecPerKm: session.nextRunPaceMinSecPerKm,
    nextRunPaceMaxSecPerKm: session.nextRunPaceMaxSecPerKm,
    weekTitle: session.weekTitle,
    weekSummary: session.weekSummary,
  };
}

function summarizeLapDistances(laps: { distanceM: number | null }[]): string {
  return laps
    .map((lap) => ((lap.distanceM ?? 0) / 1000).toFixed(1))
    .join(", ");
}

async function main() {
  const sessions = listStoredSessions().sort((left, right) => {
    const dateOrder = left.core.sessionDate.localeCompare(right.core.sessionDate);
    if (dateOrder !== 0) {
      return dateOrder;
    }

    return left.core.id - right.core.id;
  });

  console.log(`Rebuilding kilometer splits for ${sessions.length} stored sessions...`);
  let rebuiltCount = 0;
  let skippedCount = 0;

  for (const session of sessions) {
    try {
      const previous = summarizeLapDistances(session.laps);
      const result = await saveSession(
        {
          sourceActivityId: session.core.sourceActivityId,
          manual: session.manual,
          files: session.files,
          ai: toAiInput(session.ai),
        },
        {
          publish: false,
          aiMetadata: {
            modelName: session.ai.modelName,
            promptVersion: session.ai.promptVersion,
            generatedAt: session.ai.generatedAt,
          },
        }
      );

      const next = summarizeLapDistances(result.session.laps);
      rebuiltCount += 1;
      console.log(
        `${session.core.sessionDate} · ${session.core.title} · ${session.core.sourceActivityId}\n` +
        `  before: [${previous}]\n` +
        `  after:  [${next}]`
      );
    } catch (error) {
      skippedCount += 1;
      console.warn(
        `${session.core.sessionDate} · ${session.core.title} · ${session.core.sourceActivityId}\n` +
        `  skipped: ${(error as Error).message}`
      );
    }
  }

  const artifacts = publishSnapshots();
  console.log(`Rebuilt: ${rebuiltCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Published snapshots at: ${artifacts.generatedAt}`);
  console.log(`Latest session: ${artifacts.latestSession?.sessionDate ?? "none"}`);
  console.log(`Published sessions: ${artifacts.publishedSessions.length}`);
}

main().catch((error) => {
  console.error("Failed to rebuild kilometer splits.", error);
  process.exitCode = 1;
});
