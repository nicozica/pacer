/* Dedicated Skip Workout page (/skip/?id=<pacerWorkoutId>), three steps:
 *   1 Workout & Recovery (GET/POST skip-preview, brief + context export)
 *   2 Coachat Response (standalone future-workout-v1 JSON draft, kept in sessionStorage)
 *   3 Confirm, Sync & Publish: POST skip/complete runs skip -> cancel its verified Intervals event -> import -> approve -> sync -> public Next Run.
 * Retries after a partial failure resume with POST sync / publish-next-run only (re-posting the full flow
 * would conflict on the already-approved replacement). Only the replacement workout is ever published. */
(function skipPage() {
  'use strict';

  const { esc, request, plannedDuration, stamp, recoveryHtml, buildContext, combinedText, copy } = window.PacerSkipCommon;
  const fmt = window.PacerWorkoutFormat;
  const byId = (id) => document.getElementById(id);
  const id = new URLSearchParams(location.search).get('id') || '';
  const api = (suffix) => `/api/workouts/${encodeURIComponent(id)}/${suffix}`;
  const draftKey = `pacer-skip-draft:${id}`;

  let details = null;      // latest backend details for the skipped workout
  let replacement = null;  // backend record of the replacement workout (looked up by the draft's id)
  let published = false;   // public Next Run published in this page session
  let running = '';        // '' | 'all' | 'cancel' | 'sync' | 'publish' while a request is active
  let stageError = {};     // backend-reported failure text per stage: { cancellation, sync, publish, request }
  let busy = false;
  let draftEntries = null; // parsed draft: { workout } | { error }
  let briefExplanation = null; // explanation the current brief was generated with
  let copied = null;       // { signature, anchor } of the context last copied to Coachat

  /* ---------- small helpers ---------- */

  function storage(op, key, value) {
    try { return op === 'get' ? sessionStorage.getItem(key) : op === 'set' ? sessionStorage.setItem(key, value) : sessionStorage.removeItem(key); } catch { return null; }
  }
  function notice(message) { const el = byId('save-banner'); el.textContent = message; el.classList.toggle('hidden', !message); }
  function showError(message) { const el = byId('error-banner'); el.textContent = message; el.classList.toggle('hidden', !message); }
  function setStatus(message, tone) {
    const el = byId('ai-import-status');
    el.textContent = message;
    el.className = `field-help ai-status${tone ? ` is-${tone}` : ''}`;
  }
  function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.keys(value).sort().filter((k) => value[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
    }
    return JSON.stringify(value);
  }

  /* ---------- rendering ---------- */

  const explanationText = () => byId('skip-explanation').value.trim();
  const isSkipped = () => Boolean(details?.skip);

  /** Values that matter to the decision, without fetch timestamps, for change disclosure. */
  function recoverySignature(d) {
    if (!d) return null;
    const ctx = buildContext(d);
    return { anchor: d.planningAnchor?.sourceActivityId ?? null, availability: ctx.recovery.availability, intervals: ctx.recovery.intervals?.sessionDay ?? null, garmin: ctx.recovery.garmin?.sessionDay ?? null };
  }
  function describeChange(before, after, label) {
    if (!before || !after) return '';
    const parts = [];
    if (before.anchor !== after.anchor) parts.push(`planning anchor ${before.anchor ?? 'none'} → ${after.anchor ?? 'none'}`);
    if (canonicalJson({ ...before, anchor: 0 }) !== canonicalJson({ ...after, anchor: 0 })) parts.push('recovery data');
    return parts.length ? `${label}: ${parts.join(' and ')} changed. Copy again so Coachat sees the current context.` : '';
  }
  function showChange(message) {
    const el = byId('skip-change-note');
    el.textContent = message;
    el.classList.toggle('hidden', !message);
  }

  function render() {
    const skipped = isSkipped();
    const conflict = details?.outcomeStatus === 'completed_after_skip';
    const workout = details?.workout;

    byId('skip-page-status').textContent = !details ? 'Loading…' : skipped ? 'Skipped' : 'Not skipped yet';
    const badge = byId('skip-badge');
    badge.className = `status-badge ${conflict ? 'is-conflict' : 'is-skipped'}${details ? '' : ' hidden'}`;
    badge.textContent = conflict ? 'Skipped · activity found' : skipped ? 'Skipped' : 'Intended skip · not recorded';

    if (workout) {
      let html = `<div class="wk-title">${esc(workout.title || 'Untitled workout')}</div>`
        + `<div class="wk-meta">${esc(fmt.formatDateLabel(workout.schedule?.localDate))} · ${esc(workout.workoutType || '')} · ${esc(plannedDuration(workout))}</div>`
        + fmt.blocksHtml(workout.blocks);
      if (conflict) {
        html += `<p class="skip-conflict" role="alert">Conflict: activity ${esc(details.completedAfterSkipActivityId)} was completed for this workout after it was skipped. Pacer has not changed either record.</p>`;
      } else if (!details.eligible && !skipped) {
        html += `<p class="skip-conflict">${esc(details.eligibilityReason || 'This workout cannot be skipped.')}</p>`;
      }
      byId('skip-workout').innerHTML = html;

      const snapshot = skipped ? details.skip.wellnessSnapshot : details.recoveryPreview;
      const collected = stamp(snapshot?.collectedAt);
      const recovery = byId('skip-recovery');
      recovery.classList.remove('hidden');
      recovery.innerHTML = `<h4>Recovery indicators <small>${skipped ? `snapshot stored when skipped, ${esc(stamp(details.skip.skippedAt))}` : `preview collected ${esc(collected)}; not stored`}</small></h4>${recoveryHtml(snapshot)}`;
    }

    const explanation = byId('skip-explanation');
    if (skipped) explanation.value = details.skip.explanation || '';
    explanation.disabled = skipped || !details?.eligible || busy;
    explanation.placeholder = skipped && !details.skip.explanation ? 'No explanation given.' : 'Why are you skipping it?';

    // Brief + context export (single action).
    const canCopy = Boolean(details?.brief) && (skipped || details.eligible);
    byId('skip-copy-all').disabled = !canCopy || busy;
    const note = byId('skip-brief-note');
    if (skipped) note.textContent = 'Skip recorded. Copying uses the stored record.';
    else if (details && !details.eligible) note.textContent = '';
    else if (briefExplanation !== null && briefExplanation !== explanationText()) note.textContent = 'The explanation changed. Copying will refresh the brief first.';
    else note.textContent = 'Intended skip, not recorded yet. The brief includes your explanation.';
    const exp = byId('skip-export');
    exp.value = canCopy ? combinedText(details, { explanation: briefExplanation ?? '' }) : '';
    byId('skip-review').classList.toggle('hidden', !canCopy);

    byId('ai-json-input').disabled = !details || (!skipped && !details.eligible);
    byId('ai-json-file').disabled = byId('ai-json-input').disabled;
    renderImport();
  }

  const lifecycle = () => replacement?.workout?.lifecycle || null;
  const isApproved = () => lifecycle()?.approvalStatus === 'approved';
  const isSynced = () => isApproved() && lifecycle().syncStatus === 'synced';

  /** What the single primary button does, derived from backend state so retries never repeat finished work. */
  function primaryAction() {
    const draftOk = Boolean(draftEntries?.workout);
    if (replacement && isApproved() && !replacement.skip) {
      if (details?.remoteCancellation?.status === 'failed') return { kind: 'cancel', label: 'Retry remote cancellation', disabled: busy };
      if (isSynced()) return published ? { kind: 'done', label: 'Published', disabled: true } : { kind: 'publish', label: 'Publish Next Run', disabled: busy };
      return { kind: 'sync', label: 'Retry sync & publish', disabled: busy };
    }
    const open = isSkipped() || Boolean(details?.eligible);
    return { kind: 'complete', label: 'Confirm, Sync & Publish', disabled: busy || !draftOk || !open };
  }

  function renderStages() {
    const lc = lifecycle();
    const rows = [];
    const add = (label, cls, text) => rows.push(`<li class="is-${cls}"><strong>${label}</strong><span>${esc(text)}</span></li>`);
    const all = running === 'all';
    add('Skip', isSkipped() ? 'ok' : all ? 'pending' : 'skipped', isSkipped() ? 'Recorded privately.' : all ? 'Recording…' : 'Not recorded.');
    const cancellation = details?.remoteCancellation;
    if (cancellation?.status === 'deleted') add('Original Intervals workout', 'ok', 'Verified Pacer-owned planned event removed. Garmin propagation is unverified.');
    else if (cancellation?.status === 'already_absent') add('Original Intervals workout', 'ok', 'Verified Pacer event was already absent. Garmin propagation is unverified.');
    else if (stageError.cancellation || cancellation?.status === 'failed') add('Original Intervals workout', 'failed', `Cancellation failed: ${stageError.cancellation || cancellation?.error || 'unknown error'} The skip and replacement are kept; retry cancellation when ready.`);
    else add('Original Intervals workout', all || running === 'cancel' ? 'pending' : 'skipped', all || running === 'cancel' ? 'Verifying and cancelling the original planned event…' : 'Runs after skip confirmation; only the verified original planned event is eligible.');
    add('Replacement', isApproved() ? 'ok' : replacement ? 'pending' : all ? 'pending' : 'skipped',
      isApproved() ? 'Imported and approved.' : replacement ? 'Imported, not approved.' : all ? 'Importing and approving…' : 'Not imported.');
    if (lc?.syncStatus === 'synced') add('Intervals.icu', 'ok', 'Synced. Garmin Connect delivery isn’t verifiable from Pacer.');
    else if (stageError.sync || lc?.syncStatus === 'failed') add('Intervals.icu', 'failed', `Sync failed: ${stageError.sync || lc?.lastSyncError || 'unknown error'} The skip and replacement are kept; use Retry sync & publish.`);
    else add('Intervals.icu', all || running === 'sync' ? 'pending' : 'skipped', all || running === 'sync' ? 'Sending…' : 'Not started.');
    if (published) add('run.nico.ar', 'ok', 'Next Run published (replacement workout only).');
    else if (stageError.publish) add('run.nico.ar', 'failed', `Not published: ${stageError.publish} Synced work is kept; use Publish Next Run to retry.`);
    else add('run.nico.ar', all || running === 'publish' ? 'pending' : 'skipped', all || running === 'publish' ? 'Publishing…' : 'Not started.');
    const list = byId('skip-stages');
    const any = busy || isSkipped() && (replacement || stageError.cancellation || stageError.sync || stageError.publish || cancellation);
    list.innerHTML = rows.join('');
    list.classList.toggle('hidden', !any);
  }

  function renderImport() {
    const lc = lifecycle();
    const preview = byId('skip-workout-preview');
    const shown = replacement?.workout || null;
    const draftOk = Boolean(draftEntries?.workout);
    const badge = byId('workout-status-badge');
    const note = byId('workout-status-note');
    if (shown) {
      preview.innerHTML = fmt.renderWorkout(shown);
      let key = 'proposed'; let label = 'Imported (not approved)';
      if (lc.syncStatus === 'syncing') { key = 'syncing'; label = 'Syncing'; }
      else if (isSynced()) { key = 'sent'; label = 'Sent to Intervals'; }
      else if (lc.syncStatus === 'failed') { key = 'failed'; label = 'Sync failed'; }
      else if (isApproved()) { key = 'approved'; label = 'Approved · not sent'; }
      badge.className = `status-badge is-${key}`; badge.textContent = label;
      note.innerHTML = {
        proposed: 'Stored but not approved. Confirm to approve, sync and publish it.',
        syncing: 'Sending to Intervals.icu…',
        sent: `On your Intervals.icu calendar and now the Next workout on the Pacer home screen.${published ? ' Public Next Run published.' : ''} <a href="/">Back to Pacer</a>`,
        failed: 'Not on your calendar yet. Use Retry sync & publish.',
        approved: 'Approved but not on your calendar yet. Use Retry sync & publish.',
      }[key];
    } else {
      badge.classList.add('hidden');
      note.textContent = '';
      preview.innerHTML = draftOk
        ? `<p class="skip-note">Not imported yet. Review, then confirm:</p>${fmt.renderWorkout(draftEntries.workout)}`
        : '<p class="empty">Nothing to confirm yet.</p>';
    }
    badge.classList.toggle('hidden', !shown);
    const action = primaryAction();
    const button = byId('btn-confirm');
    button.textContent = busy ? 'Working…' : action.label;
    button.disabled = action.disabled || busy;
    renderStages();
  }

  /* ---------- JSON draft ---------- */

  function classify(text) {
    if (!text.trim()) return { empty: true };
    let payload;
    try { payload = JSON.parse(text); } catch (err) { return { error: `Not valid JSON: ${err.message}` }; }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return { error: 'The JSON must be an object.' };
    if (payload.contractVersion === 'coachat-response-v1') return { error: 'This is the unified coachat-response-v1 envelope. Skipped workouts use a standalone future-workout-v1; paste that, or use the home screen for session analysis.' };
    if (payload.contractVersion !== 'future-workout-v1') return { error: `Expected contractVersion "future-workout-v1", got ${payload.contractVersion === undefined ? 'none' : `"${payload.contractVersion}"`}.` };
    if (payload.pacerWorkoutId === id) return { error: 'This is the skipped workout itself. Paste the new workout proposed by Coachat.' };
    return { workout: payload };
  }

  function onDraftChange() {
    const text = byId('ai-json-input').value;
    storage(text ? 'set' : 'remove', draftKey, text);
    replacement = null; stageError = {}; // a different draft is a different workout
    notice('');
    draftEntries = classify(text);
    if (draftEntries.empty) setStatus('Paste the future-workout-v1 JSON returned by Coachat.');
    else if (draftEntries.error) setStatus(draftEntries.error, 'error');
    else {
      const anchor = details?.planningAnchor?.sourceActivityId;
      const src = draftEntries.workout.sourceSession?.sourceActivityId;
      const mismatch = anchor && src && anchor !== src ? ` Note: its sourceSession (${src}) differs from the planning anchor (${anchor}).` : '';
      setStatus(`Valid future-workout-v1. Review it in step 3; nothing happens until you confirm.${mismatch}`, 'valid');
    }
    renderImport();
    void loadReplacement();
  }

  /* ---------- actions ---------- */

  /** Intended-skip preview: builds the brief without recording a skip. */
  const fetchPreview = (explanation) => request(api('skip-preview'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(explanation ? { explanation } : {}) });

  async function load() {
    if (!id) { showError('No workout selected. Return to Pacer and use Skip workout… on a workout.'); byId('skip-page-status').textContent = 'No workout'; return; }
    const saved = storage('get', draftKey);
    try {
      details = await fetchPreview('');
      briefExplanation = '';
      showError('');
    } catch (err) {
      showError(`Could not load this workout: ${err.message}`);
      byId('skip-workout').innerHTML = '<p class="empty">Workout unavailable.</p>';
      byId('skip-page-status').textContent = 'Unavailable';
      return;
    }
    if (saved) {
      byId('ai-json-input').value = saved; draftEntries = classify(saved);
      if (draftEntries.error) setStatus(draftEntries.error, 'error');
      else if (draftEntries.workout) setStatus('Draft restored. Review it in step 3.', 'valid');
    }
    render();
    void loadReplacement();
  }

  async function flash(text, ok) {
    const el = byId('skip-copy-status');
    el.textContent = ok ? text : 'Copy failed. Open "Review what will be copied" and copy it manually.';
    setTimeout(() => { el.textContent = ''; }, 4000);
  }

  /** Copies brief + context. A changed explanation refreshes the preview first; changes are disclosed. */
  async function copyAll() {
    if (busy || !details?.brief) return;
    busy = true; render();
    try {
      if (isSkipped()) {
        const fresh = await request(api('skip')); // authoritative stored record
        details = { ...details, ...fresh };
      } else if (explanationText() !== briefExplanation) {
        const before = recoverySignature(details);
        const next = await fetchPreview(explanationText());
        if (!next.brief) throw new Error('The backend returned no brief.');
        showChange(describeChange(before, recoverySignature(next), 'Refreshed preview'));
        details = next; briefExplanation = explanationText();
      }
      busy = false; render();
      const ok = await copy(byId('skip-export').value);
      if (ok) copied = { signature: recoverySignature(details), explanation: briefExplanation };
      flash('✓ Brief and context copied. Paste into Coachat.', ok);
    } catch (err) {
      showError(`Could not prepare the copy: ${err.message}`);
    } finally { busy = false; render(); }
  }

  /* ---------- completion ---------- */

  /** Never throws: returns { ok, status, body } so stage/error bodies (e.g. 502 publish) are used as sent. */
  async function post(url, body) {
    try {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
    } catch (err) {
      return { ok: false, status: 0, body: { error: `Network error: ${err.message}` } };
    }
  }

  /**
   * Reads the stored replacement: the pasted draft's workout, or - for an already-skipped workout with an
   * empty draft - the current synced Next workout, so a failed publication can be retried after a reload.
   * Also used after errors so the page shows what was actually recorded.
   */
  async function loadReplacement() {
    const wid = draftEntries?.workout?.pacerWorkoutId;
    const emptyDraft = !byId('ai-json-input').value.trim();
    if (!wid && !(isSkipped() && emptyDraft)) { renderImport(); return; }
    try {
      const { proposals = [] } = await request('/api/workouts');
      if (draftEntries?.workout?.pacerWorkoutId !== wid) return;
      replacement = wid ? proposals.find((p) => p.workout.pacerWorkoutId === wid) || null : fmt.selectUpcomingWorkouts(proposals, []).next;
    } catch { /* keep what we know */ }
    renderImport();
  }
  async function refreshSkip() {
    try { details = { ...details, ...(await request(api('skip'))) }; } catch { /* keep */ }
  }

  /** After the skip first becomes persisted, disclose differences from the context copied to Coachat. */
  function discloseConfirmed() {
    if (!copied || !details?.skip) return;
    const msg = describeChange(copied.signature, recoverySignature(details), 'Confirmed record');
    let text = msg ? msg.replace(' Copy again so Coachat sees the current context.', ' It differs from the context you copied to Coachat.') : '';
    if (copied.explanation !== (details.skip.explanation || '')) text = `${text} The stored explanation differs from the one in the copied brief.`.trim();
    showChange(text);
  }

  async function runComplete() {
    const body = { futureWorkout: draftEntries.workout, publishNextRun: true };
    if (explanationText()) body.explanation = explanationText();
    const wasSkipped = isSkipped();
    const r = await post(api('skip/complete'), body);
    if (!r.ok) {
      // Partial progress is possible (e.g. skip recorded, then a validation error): show real state, repeat nothing.
      stageError.request = r.body.error || `Request failed (${r.status}).`;
      await refreshSkip(); await loadReplacement();
      showError(`Completion stopped: ${stageError.request} The stages below show what was actually recorded. Your JSON and explanation are kept; nothing is repeated automatically.`);
      return;
    }
    const result = r.body;
    replacement = result.synchronized || result.imported?.proposal || replacement;
    await refreshSkip();
    if (!wasSkipped) discloseConfirmed();
    if (result.remoteCancellation?.operation === 'failed') stageError.cancellation = result.remoteCancellation.error || result.remoteCancellation.cancellation?.error || 'Intervals cancellation did not succeed.';
    published = result.complete === true;
    if (result.stage === 'sync') stageError.sync = replacement?.workout?.lifecycle?.lastSyncError || 'Intervals.icu did not accept the workout.';
    if (result.stage === 'publish') stageError.publish = result.publicNextRun?.publishStatus?.message || 'The public site build or deploy did not succeed.';
    if (result.complete) {
      storage('remove', draftKey);
      notice(result.remoteCancellation?.operation === 'failed'
        ? 'Done except for the original Intervals workout cancellation. The skip, replacement sync and public Next Run are complete; retry cancellation below when ready.'
        : 'Done. The skip is recorded privately, the original verified Intervals event is cancelled, the replacement is synced, and the public Next Run is published.');
    } else {
      showError(result.stage === 'sync'
        ? 'The skip and the replacement are saved, but the Intervals.icu sync failed. Retry below; nothing already done will be repeated.'
        : 'The skip and the Intervals.icu sync succeeded, but publishing the public Next Run failed. Retry below; the skip and sync will not be repeated.');
    }
  }

  async function runSync() {
    const r = await post(`/api/workouts/${encodeURIComponent(replacement.workout.pacerWorkoutId)}/sync`);
    if (!r.ok) { stageError.sync = r.body.error || `Sync request failed (${r.status}).`; await loadReplacement(); return false; }
    replacement = r.body.proposal || replacement;
    // The sync API answers 200 even when Intervals.icu rejected it; the lifecycle tells the truth.
    if (!isSynced()) { stageError.sync = lifecycle()?.lastSyncError || 'Intervals.icu did not accept the workout.'; return false; }
    return true;
  }

  async function runCancellation() {
    const r = await post(api('skip/cancel-remote'));
    if (!r.ok) { stageError.cancellation = r.body.error || `Cancellation request failed (${r.status}).`; await refreshSkip(); return false; }
    await refreshSkip();
    if (details?.remoteCancellation?.status === 'failed') { stageError.cancellation = details.remoteCancellation.error || 'Intervals cancellation did not succeed.'; return false; }
    delete stageError.cancellation;
    return true;
  }

  async function runPublish() {
    const r = await post(`/api/workouts/${encodeURIComponent(replacement.workout.pacerWorkoutId)}/publish-next-run`);
    if (!r.ok) { stageError.publish = r.body.publishStatus?.message || r.body.error || `Publish request failed (${r.status}).`; return false; }
    published = true;
    return true;
  }

  /** The single primary action. Fresh runs use the backend orchestration; retries resume only unfinished stages. */
  async function submit() {
    const action = primaryAction();
    if (busy || action.disabled || action.kind === 'done') return;
    busy = true; stageError = {}; showError(''); notice('');
    running = action.kind === 'complete' ? 'all' : action.kind;
    render();
    try {
      if (action.kind === 'complete') await runComplete();
      else if (action.kind === 'cancel') {
        if (await runCancellation()) notice('Original verified Intervals workout cancellation completed. Garmin propagation remains unverified.');
        else showError(`Original Intervals workout cancellation failed: ${stageError.cancellation} The skip and replacement were not changed.`);
      }
      else {
        const synced = action.kind === 'publish' ? true : await runSync();
        if (synced) {
          running = 'publish'; render();
          if (await runPublish()) { storage('remove', draftKey); notice('Public Next Run published (replacement workout only). The skip and sync were not repeated.'); }
          else showError(`Publishing failed: ${stageError.publish} Synced work is kept; use Publish Next Run to retry.`);
        } else showError(`Sync failed: ${stageError.sync} The skip and replacement are kept; use Retry sync & publish.`);
      }
    } finally { busy = false; running = ''; render(); }
  }

  /* ---------- wiring ---------- */

  byId('skip-copy-all').addEventListener('click', copyAll);
  byId('skip-explanation').addEventListener('input', render);
  byId('ai-json-input').addEventListener('input', onDraftChange);
  byId('ai-json-file').addEventListener('change', async (event) => {
    const [file] = event.target.files ?? [];
    if (!file) return;
    try { byId('ai-json-input').value = await file.text(); onDraftChange(); }
    catch { setStatus(`Could not read ${file.name}.`, 'error'); }
    event.target.value = '';
  });
  byId('btn-confirm').addEventListener('click', submit);

  load();
}());
