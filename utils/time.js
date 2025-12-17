// Time parsing and cron utilities
import cronParser from 'cron-parser';
import ms from 'ms';

/**
 * Parse relative time string to absolute datetime
 * @param {string} relativeTime - e.g., "30m", "2h", "3d", "1w"
 * @returns {Date|null}
 */
export function parseRelativeTime(relativeTime) {
  if (!relativeTime) return null;

  const milliseconds = ms(relativeTime);
  if (milliseconds === undefined) {
    return null;
  }

  return new Date(Date.now() + milliseconds);
}

/**
 * Parse time input (ISO string or relative)
 * @param {{at?: string, in?: string}} timing
 * @returns {{scheduledAt: Date|null, error?: string}}
 */
export function parseTimeInput(timing) {
  if (timing.at) {
    const date = new Date(timing.at);
    if (isNaN(date.getTime())) {
      return { scheduledAt: null, error: 'Invalid datetime format. Use ISO 8601 (e.g., 2025-12-20T09:00:00Z)' };
    }
    if (date <= new Date()) {
      return { scheduledAt: null, error: 'Scheduled time must be in the future' };
    }
    return { scheduledAt: date };
  }

  if (timing.in) {
    const date = parseRelativeTime(timing.in);
    if (!date) {
      return { scheduledAt: null, error: 'Invalid relative time format. Use formats like "30m", "2h", "3d", "1w"' };
    }
    return { scheduledAt: date };
  }

  return { scheduledAt: null, error: 'Either "at" or "in" must be specified for timing' };
}

/**
 * Calculate the next run time for a cron expression
 * @param {string} cronExpression
 * @param {string} timezone
 * @returns {Date|null}
 */
export function getNextCronRun(cronExpression, timezone = 'UTC') {
  try {
    const interval = cronParser.parseExpression(cronExpression, {
      tz: timezone,
      currentDate: new Date(),
    });
    return interval.next().toDate();
  } catch (error) {
    console.error('[Cron] Failed to parse expression:', error.message);
    return null;
  }
}

/**
 * Get multiple upcoming cron runs
 * @param {string} cronExpression
 * @param {string} timezone
 * @param {number} count
 * @returns {Date[]}
 */
export function getUpcomingCronRuns(cronExpression, timezone = 'UTC', count = 5) {
  try {
    const interval = cronParser.parseExpression(cronExpression, {
      tz: timezone,
      currentDate: new Date(),
    });

    const runs = [];
    for (let i = 0; i < count; i++) {
      runs.push(interval.next().toDate());
    }
    return runs;
  } catch (error) {
    return [];
  }
}

/**
 * Describe a cron expression in human-readable format
 * @param {string} cronExpression
 * @returns {string}
 */
export function describeCron(cronExpression) {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) return cronExpression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Simple descriptions for common patterns
  if (minute === '0' && hour === '9' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every day at 9:00 AM';
  }
  if (minute === '0' && hour === '9' && dayOfMonth === '*' && month === '*' && dayOfWeek === '1') {
    return 'Every Monday at 9:00 AM';
  }
  if (minute === '0' && hour === '*' && dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return 'Every hour at minute 0';
  }
  if (minute.startsWith('*/')) {
    const interval = parseInt(minute.slice(2), 10);
    return `Every ${interval} minutes`;
  }

  return cronExpression;
}

/**
 * Format a date for display
 * @param {Date} date
 * @param {string} timezone
 * @returns {string}
 */
export function formatDateTime(date, timezone = 'UTC') {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'long',
    timeZone: timezone,
  }).format(date);
}

export default {
  parseRelativeTime,
  parseTimeInput,
  getNextCronRun,
  getUpcomingCronRuns,
  describeCron,
  formatDateTime,
};
