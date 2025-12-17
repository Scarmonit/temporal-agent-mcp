// MCP Tool: schedule_recurring
// Schedule a recurring task using cron expressions

import { TaskQueries } from '../db/queries.js';
import { validateWebhookUrl, validateCronExpression, sanitizePayload } from '../utils/security.js';
import { getNextCronRun, getUpcomingCronRuns, describeCron } from '../utils/time.js';
import config from '../config.js';

export const definition = {
  name: 'schedule_recurring',
  description: 'Schedule a recurring task using a cron expression. The task will trigger a callback repeatedly according to the schedule.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Human-readable name for the recurring task',
      },
      description: {
        type: 'string',
        description: 'Optional detailed description',
      },
      cron: {
        type: 'string',
        description: 'Cron expression (5 parts: minute hour day month weekday). Examples: "0 9 * * 1" (Mon 9am), "0 */2 * * *" (every 2 hours), "30 8 * * 1-5" (weekdays 8:30am)',
      },
      timezone: {
        type: 'string',
        description: 'Timezone for cron evaluation (default: UTC). Use IANA timezone names.',
      },
      callback: {
        type: 'object',
        description: 'Callback configuration',
        properties: {
          type: {
            type: 'string',
            enum: ['webhook', 'slack', 'email', 'store'],
          },
          url: { type: 'string' },
          channel: { type: 'string' },
          email: { type: 'string' },
        },
        required: ['type'],
      },
      payload: {
        type: 'object',
        description: 'Custom data to include in callbacks',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
      },
      enabled: {
        type: 'boolean',
        description: 'Whether to start the task enabled (default: true). Set to false to create paused.',
      },
    },
    required: ['name', 'cron', 'callback'],
  },
};

export async function handler(params, context = {}) {
  const { name, description, cron, timezone = 'UTC', callback, payload, tags, enabled = true } = params;

  // Validate cron expression
  const cronValidation = validateCronExpression(cron);
  if (!cronValidation.valid) {
    return {
      success: false,
      error: cronValidation.error,
    };
  }

  // Calculate next run time
  const nextRunAt = getNextCronRun(cron, timezone);
  if (!nextRunAt) {
    return {
      success: false,
      error: 'Failed to parse cron expression. Ensure format is: minute hour day month weekday',
    };
  }

  // Validate callback
  if (!callback || !callback.type) {
    return {
      success: false,
      error: 'Callback configuration with type is required',
    };
  }

  if (callback.type === 'webhook') {
    if (!callback.url) {
      return { success: false, error: 'Webhook URL is required' };
    }
    const urlValidation = await validateWebhookUrl(callback.url);
    if (!urlValidation.valid) {
      return { success: false, error: `Invalid webhook URL: ${urlValidation.error}` };
    }
  }

  // Sanitize payload
  const payloadValidation = sanitizePayload(payload);
  if (!payloadValidation.valid) {
    return { success: false, error: payloadValidation.error };
  }

  // Rate limit check
  const sessionId = context.sessionId || 'anonymous';
  const activeCount = await TaskQueries.countActiveByUser(sessionId);
  if (activeCount >= config.limits.maxActiveTasksPerUser) {
    return {
      success: false,
      error: `Maximum active tasks limit reached (${config.limits.maxActiveTasksPerUser})`,
    };
  }

  // Create the recurring task
  try {
    const task = await TaskQueries.create({
      name,
      description,
      taskType: 'recurring',
      cronExpression: cron,
      timezone,
      nextRunAt,
      callbackType: callback.type,
      callbackConfig: {
        url: callback.url,
        channel: callback.channel,
        email: callback.email,
      },
      payload: payloadValidation.sanitized,
      maxRetries: 3,
      retryDelaySeconds: 60,
      createdBy: sessionId,
      tags: tags || [],
    });

    // If created disabled, pause it
    if (!enabled) {
      await TaskQueries.pause(task.id);
    }

    // Get upcoming runs for display
    const upcomingRuns = getUpcomingCronRuns(cron, timezone, 3);

    return {
      success: true,
      task: {
        id: task.id,
        name: task.name,
        cron: task.cron_expression,
        timezone: task.timezone,
        nextRunAt: task.next_run_at,
        status: enabled ? 'active' : 'paused',
        callbackType: task.callback_type,
      },
      schedule: {
        description: describeCron(cron),
        upcomingRuns: upcomingRuns.map(d => d.toISOString()),
      },
      message: `Recurring task "${name}" created. ${describeCron(cron)}. Next run: ${nextRunAt.toISOString()}`,
    };
  } catch (error) {
    console.error('[schedule_recurring] Error:', error);
    return {
      success: false,
      error: `Failed to create recurring task: ${error.message}`,
    };
  }
}

export default { definition, handler };
