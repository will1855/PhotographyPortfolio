'use strict';

/**
 * Logs an event asynchronously to the analytics database.
 * Uses a deferred dispatch to yield main-thread execution during loads.
 * @param {string} type - Event type (e.g. 'page_view', 'lightbox_click')
 * @param {string} target - Target identifier
 */
export function logAnalyticsEvent(type, target) {
  setTimeout(() => {
    fetch('/api/analytics/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: type, event_target: target })
    }).catch(() => {}); // Gracefully ignore network/analytics failures silently
  }, 2500);
}
