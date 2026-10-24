/* Stored future-workout data for the Review & Publish section. Rendering and the
 * publish/approve/sync actions live in app.js; this module only loads records and
 * notifies listeners. It never writes. */
(function futureWorkoutData() {
  'use strict';

  let records = [];
  let loadError = '';
  let loaded = false;
  const listeners = [];

  async function load() {
    try {
      const response = await fetch('/api/workouts');
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `Request failed (${response.status}).`);
      records = Array.isArray(body.proposals) ? body.proposals : [];
      loadError = '';
    } catch (error) {
      loadError = error.message || 'Could not load workouts.';
    }
    loaded = true;
    listeners.forEach((listener) => listener());
  }

  window.PacerWorkouts = {
    reload() { return load(); },
    records() { return records; },
    error() { return loadError; },
    isLoaded() { return loaded; },
    onChange(listener) { listeners.push(listener); },
  };
  load();
}());
