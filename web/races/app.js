let currentRaces = [];
let editingRaceSlug = null;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function value(id) {
  return document.getElementById(id).value.trim();
}

function optionalNumber(value) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? 'Request failed.');
  return payload;
}

function formatRaceDate(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
}

function formatRaceDistance(distanceKm) {
  return Number(distanceKm).toFixed(3).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

function todayLocalIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function setRaceStatus(message, tone = 'notice') {
  const element = document.getElementById('race-status');
  element.textContent = message;
  element.classList.remove('hidden', 'error', 'notice');
  element.classList.add(tone === 'error' ? 'error' : 'notice');
}

function clearRaceStatus() {
  document.getElementById('race-status').classList.add('hidden');
}

function raceRowHtml(race, past) {
  const slug = encodeURIComponent(race.slug);
  return [
    `<div class="race-row${past ? ' is-past' : ''}">`,
    '<div class="race-row-main">',
    `<p class="race-title">${escapeHtml(race.title)}<span class="race-priority" aria-label="Priority ${escapeHtml(race.priority)}">${escapeHtml(race.priority)}</span></p>`,
    `<p class="race-meta">${escapeHtml(formatRaceDate(race.date))} · ${escapeHtml(formatRaceDistance(race.distanceKm))} km</p>`,
    '</div>',
    '<div class="race-row-actions">',
    `<button type="button" class="button-quiet" data-race-action="edit" data-race-slug="${escapeHtml(slug)}">Edit</button>`,
    `<button type="button" class="button-quiet" data-race-action="delete" data-race-slug="${escapeHtml(slug)}">Delete</button>`,
    '</div>',
    '</div>',
  ].join('');
}

function renderRaceCalendar() {
  const list = document.getElementById('race-list');
  if (currentRaces.length === 0) {
    list.innerHTML = '<p class="empty">No races on the calendar yet.</p>';
    return;
  }
  const today = todayLocalIso();
  const upcoming = currentRaces.filter((race) => race.date >= today);
  const past = currentRaces.filter((race) => race.date < today);
  const sections = [];
  if (upcoming.length) sections.push('<p class="race-list-heading">Upcoming</p>', ...upcoming.map((race) => raceRowHtml(race, false)));
  if (past.length) sections.push('<p class="race-list-heading is-past">Past</p>', ...past.map((race) => raceRowHtml(race, true)));
  list.innerHTML = sections.join('');
}

function resetRaceForm() {
  editingRaceSlug = null;
  document.getElementById('race-form').reset();
  document.getElementById('race-priority').value = 'B';
  document.getElementById('race-form-heading').textContent = 'Add race';
  document.getElementById('btn-race-save').textContent = 'Save race';
  document.getElementById('btn-race-cancel').classList.add('hidden');
  document.getElementById('race-slug-help').textContent = 'A stable slug is generated from the title and date when the race is created.';
}

function editRace(slug) {
  const race = currentRaces.find((entry) => entry.slug === slug);
  if (!race) return;
  editingRaceSlug = race.slug;
  document.getElementById('race-title').value = race.title;
  document.getElementById('race-date').value = race.date;
  document.getElementById('race-distance').value = race.distanceKm;
  document.getElementById('race-priority').value = race.priority;
  document.getElementById('race-form-heading').textContent = 'Edit race';
  document.getElementById('btn-race-save').textContent = 'Save changes';
  document.getElementById('btn-race-cancel').classList.remove('hidden');
  document.getElementById('race-slug-help').textContent = `Slug: ${race.slug} (kept stable when editing).`;
  document.getElementById('race-title').focus();
}

async function loadRaceCalendar() {
  const response = await fetchJson('/api/races', { cache: 'no-store' });
  currentRaces = response.races ?? [];
  renderRaceCalendar();
}

async function saveRace(event) {
  event.preventDefault();
  const button = document.getElementById('btn-race-save');
  const previousLabel = button.textContent;
  const payload = {
    title: value('race-title'),
    date: document.getElementById('race-date').value,
    distanceKm: optionalNumber(value('race-distance')),
    priority: document.getElementById('race-priority').value,
  };
  button.disabled = true;
  button.textContent = editingRaceSlug ? 'Saving…' : 'Creating…';
  clearRaceStatus();
  try {
    const url = editingRaceSlug ? `/api/races/${encodeURIComponent(editingRaceSlug)}` : '/api/races';
    const response = await fetchJson(url, {
      method: editingRaceSlug ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    currentRaces = response.races ?? currentRaces;
    renderRaceCalendar();
    resetRaceForm();
    setRaceStatus('Race saved. Use “Update run.nico.ar” when ready to publish the new calendar.');
  } catch (error) {
    setRaceStatus(error.message || 'Could not save race.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

async function deleteRace(slug) {
  const race = currentRaces.find((entry) => entry.slug === slug);
  if (!race || !window.confirm(`Delete “${race.title}” from the race calendar?`)) return;
  clearRaceStatus();
  try {
    const response = await fetchJson(`/api/races/${encodeURIComponent(slug)}`, { method: 'DELETE' });
    currentRaces = response.races ?? [];
    if (editingRaceSlug === slug) resetRaceForm();
    renderRaceCalendar();
    setRaceStatus('Race deleted. Use “Update run.nico.ar” when ready to publish the new calendar.');
  } catch (error) {
    setRaceStatus(error.message || 'Could not delete race.', 'error');
  }
}

async function publishRaceCalendar() {
  const button = document.getElementById('btn-race-publish');
  const previousLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Updating…';
  clearRaceStatus();
  setRaceStatus('Building, deploying, and verifying run.nico.ar…');
  try {
    const response = await fetchJson('/api/races/publish', { method: 'POST' });
    const status = response.publishStatus;
    const target = status?.deployTarget ? ` Target: ${status.deployTarget}.` : '';
    setRaceStatus(`${status?.message ?? 'run.nico.ar updated.'}.${target}`);
  } catch (error) {
    setRaceStatus(error.message || 'Could not update run.nico.ar.', 'error');
  } finally {
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

document.getElementById('race-form').addEventListener('submit', saveRace);
document.getElementById('btn-race-cancel').addEventListener('click', () => {
  resetRaceForm();
  clearRaceStatus();
});
document.getElementById('race-list').addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-race-action]');
  if (!button) return;
  const slug = decodeURIComponent(button.dataset.raceSlug || '');
  if (button.dataset.raceAction === 'edit') editRace(slug);
  if (button.dataset.raceAction === 'delete') await deleteRace(slug);
});
document.getElementById('btn-race-publish').addEventListener('click', publishRaceCalendar);

loadRaceCalendar().catch((error) => {
  document.getElementById('race-list').innerHTML = '<p class="empty">Could not load the race calendar.</p>';
  setRaceStatus(error.message || 'Could not load race calendar.', 'error');
});
