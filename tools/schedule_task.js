// MCP Tool: schedule_task
// Schedule a one-time task for future execution

import { TaskQueries } from '../db/queries.js';
import { validateWebhookUrl, sanitizePayload } from '../utils/security.js';
import { parseTimeInput } from '../utils/time.js';
import config from '../config.js';

export const definition = {
  name: 'schedule_task',
  description: 'Schedule a one-time task to execute at a specific time in the future. The task will trigger a callback (webhook, Slack, or email) when the scheduled time arrives.',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Human-readable name for the task (e.g., "Check PR status", "Send reminder")',
      },
      description: {
        type: 'string',
        description: 'Optional detailed description of the task',
      },
      at: {
        type: 'string',
        description: 'Absolute time in ISO 8601 format (e.g., "2025-12-20T09:00:00Z"). Use either "at" or "in", not both.',
      },
      in: {
        type: 'string',
        description: 'Relative time from now (e.g., "30m", "2h", "3d", "1w"). Use either "at" or "in", not both.',
      },
      callback: {
        type: 'object',
        description: 'Callback configuration for when the task executes',
        properties: {
          type: {
            type: 'string',
            enum: ['webhook', 'slack', 'email', 'store'],
            description: 'Callback type: webhook (HTTP POST), slack (message), email, or store (poll later)',
          },
          url: {
            type: 'string',
            description: 'Webhook URL (required for webhook type)',
          },
          channel: {
            type: 'string',
            description: 'Slack channel or webhook URL (for slack type)',
          },
          email: {
            type: 'string',
            description: 'Email address (for email type)',
          },
        },
        required: ['type'],
      },
      payload: {
        type: 'object',
        description: 'Custom data to include in the callback when the task executes',
      },
      timezone: {
        type: 'string',
        description: 'Timezone for scheduling (default: UTC). Use IANA timezone names like "America/New_York".',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Tags for organizing and filtering tasks',
      },
      retries: {
        type: 'number',
        description: 'Maximum retry attempts if callback fails (default: 3)',
      },
    },
    required: ['name', 'callback'],
  },
};

export async function handler(params, context = {}) {
  const { name, description, at, in: inTime, callback, payload, timezone, tags, retries } = params;

  // Validate timing
  const timing = parseTimeInput({ at, in: inTime });
  if (timing.error) {
    return {
      success: false,
      error: timing.error,
    };
  }

  // Validate callback configuration
  if (!callback || !callback.type) {
    return {
      success: false,
      error: 'Callback configuration with type is required',
    };
  }

  // Validate webhook URL if applicable
  if (callback.type === 'webhook') {
    if (!callback.url) {
      return {
        success: false,
        error: 'Webhook URL is required for webhook callback type',
      };
    }

    const urlValidation = await validateWebhookUrl(callback.url);
    if (!urlValidation.valid) {
      return {
        success: false,
        error: `Invalid webhook URL: ${urlValidation.error}`,
      };
    }
  }

  // Validate email if applicable
  if (callback.type === 'email' && !callback.email) {
    return {
      success: false,
      error: 'Email address is required for email callback type',
    };
  }

  // Sanitize payload
  const payloadValidation = sanitizePayload(payload);
  if (!payloadValidation.valid) {
    return {
      success: false,
      error: payloadValidation.error,
    };
  }

  // Check rate limits
  const sessionId = context.sessionId || 'anonymous';
  const activeCount = await TaskQueries.countActiveByUser(sessionId);
  if (activeCount >= config.limits.maxActiveTasksPerUser) {
    return {
      success: false,
      error: `Maximum active tasks limit reached (${config.limits.maxActiveTasksPerUser})`,
    };
  }

  // Create the task
  try {
    const task = await TaskQueries.create({
      name,
      description,
      taskType: 'one_time',
      scheduledAt: timing.scheduledAt,
      timezone: timezone || 'UTC',
      callbackType: callback.type,
      callbackConfig: {
        url: callback.url,
        channel: callback.channel,
        email: callback.email,
      },
      payload: payloadValidation.sanitized,
      maxRetries: retries ?? 3,
      retryDelaySeconds: 60,
      createdBy: sessionId,
      tags: tags || [],
    });

    return {
      success: true,
      task: {
        id: task.id,
        name: task.name,
        scheduledAt: task.scheduled_at,
        status: task.status,
        callbackType: task.callback_type,
      },
      message: `Task "${name}" scheduled for ${timing.scheduledAt.toISOString()}`,
    };
  } catch (error) {
    console.error('[schedule_task] Error:', error);
    return {
      success: false,
      error: `Failed to create task: ${error.message}`,
    };
  }
}

export default { definition, handler };
