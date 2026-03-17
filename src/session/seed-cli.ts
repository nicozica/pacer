import { seedInitialSessions } from './service';

async function main(): Promise<void> {
  const result = await seedInitialSessions();
  console.log(`Seed complete. Inserted: ${result.inserted}. Skipped: ${result.skipped}.`);
  console.log(`Exports refreshed at: ${result.publishArtifacts.generatedAt}`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
