import type { SessionAIInput } from './types';

export interface ResolvedSessionIdentity {
  sourceActivityId: number;
  sessionDate: string;
}

export function validateSessionAiIdentity(
  ai: SessionAIInput,
  resolved: ResolvedSessionIdentity,
): void {
  if (!Number.isInteger(ai.sourceActivityId) || (ai.sourceActivityId ?? 0) <= 0) {
    throw new Error('AI JSON must include a valid sourceActivityId.');
  }

  if (ai.sourceActivityId !== resolved.sourceActivityId) {
    throw new Error(
      `AI sourceActivityId ${ai.sourceActivityId} does not match resolved activity ${resolved.sourceActivityId}.`,
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(ai.sessionDate)) {
    throw new Error('AI JSON must include sessionDate in YYYY-MM-DD format.');
  }

  if (ai.sessionDate !== resolved.sessionDate) {
    throw new Error(
      `AI sessionDate ${ai.sessionDate} does not match resolved activity date ${resolved.sessionDate}.`,
    );
  }
}
