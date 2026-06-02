import type { TrainingFetchOptions, TrainingSourceName } from './source';
import { parseTrainingSourceName } from './source';

export interface ParsedTrainingArgs extends TrainingFetchOptions {
  source?: TrainingSourceName;
  writeRaw?: boolean;
}

export function parseTrainingArgs(argv: string[]): ParsedTrainingArgs {
  const parsed: ParsedTrainingArgs = {};

  for (const arg of argv) {
    const [key, value = ''] = arg.split('=', 2);
    if (key === '--oldest') parsed.oldest = value;
    if (key === '--newest') parsed.newest = value;
    if (key === '--source') parsed.source = parseTrainingSourceName(value);
    if (key === '--write-raw') parsed.writeRaw = true;
  }

  return parsed;
}
