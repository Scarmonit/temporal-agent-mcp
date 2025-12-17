// MCP Tool: list_tasks
// Query and list scheduled tasks

import { TaskQueries } from '../db/queries.js';

export const definition = {
  name: 'list_tasks',
  description: 'List scheduled tasks with optional filtering by status, type, and tags.',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'paused', 'completed', 'failed', 'cancelled', 'all'],
        description: 'Filter by task status (default: active)',
      },
      type: {
        type: 'string',
        enum: ['one_time', 'recurring'],
        description: 'Filter by task type',
      },
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: 'Filter by tags (tasks matching any tag)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of tasks to return (default: 50, max: 200)',
      },
      offset: {
        type: 'number',
        description: 'Offset for pagination',
      },
    },
  },
};

export async function handler(params, context = {}) {
  const { status = 'active', type, tags, limit = 50, offset = 0 } = params;

  try {
    const tasks = await TaskQueries.list({
      status,
      taskType: type,
      tags,
      limit: Math.min(limit, 200),
      offset,
      createdBy: context.sessionId, // Only show tasks created by this session
    });

    const formatted = tasks.map(task => ({
      id: task.id,
      name: task.name,
      description: task.description,
      type: task.task_type,
      status: task.status,
      scheduledAt: task.scheduled_at,
      cronExpression: task.cron_expression,
      nextRunAt: task.next_run_at,
      timezone: task.timezone,
      callbackType: task.callback_type,
      executionCount: task.execution_count,
      lastExecutedAt: task.last_executed_at,
      tags: task.tags,
      createdAt: task.created_at,
    }));

    return {
      success: true,
      tasks: formatted,
      count: formatted.length,
      filters: { status, type, tags },
      pagination: { limit, offset },
    };
  } catch (error) {
    console.error('[list_tasks] Error:', error);
    return {
      success: false,
      error: `Failed to list tasks: ${error.message}`,
    };
  }
}

export default { definition, handler };
