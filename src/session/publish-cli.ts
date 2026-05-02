import { publishSnapshots } from './service';

const result = publishSnapshots();

console.log(`Published snapshots at: ${result.generatedAt}`);
console.log(`Latest session: ${result.latestSession?.sessionDate ?? 'none'}`);
console.log(`Published sessions: ${result.publishedSessions.length}`);
