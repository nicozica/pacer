(function attachEditorStateHelpers(root, factory) {
  const helpers = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = helpers;
  }

  root.PacerEditorState = helpers;
}(typeof globalThis !== 'undefined' ? globalThis : this, function createEditorStateHelpers() {
  function toActivityId(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
  }

  function selectSourceActivityAfterRefresh({
    selectedSourceActivityId,
    previousLatestSourceActivityId,
    currentLatestSourceActivityId,
  }) {
    const selectedId = toActivityId(selectedSourceActivityId);
    const previousLatestId = toActivityId(previousLatestSourceActivityId);
    const currentLatestId = toActivityId(currentLatestSourceActivityId);

    if (selectedId === null) return currentLatestId;
    if (selectedId === previousLatestId && currentLatestId !== null) return currentLatestId;
    return selectedId;
  }

  function assertAiIdentityMatchesSession(ai, session) {
    const expectedId = toActivityId(session?.selectedSourceActivityId);
    const actualId = toActivityId(ai?.sourceActivityId);
    const expectedDate = typeof session?.source?.sessionDate === 'string' ? session.source.sessionDate : '';
    const actualDate = typeof ai?.sessionDate === 'string' ? ai.sessionDate : '';

    if (actualId !== expectedId) {
      throw new Error(`AI sourceActivityId ${actualId ?? 'is missing'} does not match selected activity ${expectedId ?? 'unknown'}.`);
    }

    if (actualDate !== expectedDate) {
      throw new Error(`AI sessionDate ${actualDate || 'is missing'} does not match selected activity date ${expectedDate || 'unknown'}.`);
    }
  }

  function resolveAiIdentityFields(sourceActivityId, sessionDate, session) {
    const expectedId = toActivityId(session?.selectedSourceActivityId);
    const expectedDate = typeof session?.source?.sessionDate === 'string' ? session.source.sessionDate : '';
    if (expectedId === null || !/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) {
      throw new Error('Select a valid activity before importing AI JSON.');
    }

    return {
      sourceActivityId: sourceActivityId === undefined ? expectedId : sourceActivityId,
      sessionDate: sessionDate === undefined ? expectedDate : sessionDate,
    };
  }

  function buildAiIdentityBriefLines(session) {
    return [
      'Required top-level fields in the returned AI JSON:',
      `  "sourceActivityId": ${session.selectedSourceActivityId}`,
      `  "sessionDate": "${session.source.sessionDate}"`,
      'Return both values exactly as shown. They identify the session that may be saved.',
    ];
  }

  function buildCoachatResponseBriefLines(session) {
    return [
      'Reply with ONE JSON object and nothing else:',
      '  "contractVersion": "coachat-response-v1"',
      '  "sessionAi": the completed-session analysis (session-ai-v1)',
      '  "futureWorkout": the next executable workout (future-workout-v1)',
      'Both parts must identify this session exactly:',
      `  sessionAi.sourceActivityId = ${session.selectedSourceActivityId}`,
      `  sessionAi.sessionDate = "${session.source.sessionDate}"`,
      '  futureWorkout.sourceSession = the same sourceActivityId and sessionDate',
    ];
  }

  return {
    assertAiIdentityMatchesSession,
    buildAiIdentityBriefLines,
    buildCoachatResponseBriefLines,
    resolveAiIdentityFields,
    selectSourceActivityAfterRefresh,
  };
}));
