// MCP Tool: get_task
// Get detailed information about a specific task

import { TaskQueries, ExecutionQueries } from '../db/queries.js';
import { getUpcomingCronRuns, describeCron } from '../utils/time.js';

export const definition = {
  name: 'get_task',
  description: 'Get detailed information about a specific task, including execution history.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Task ID (UUID)',
      },
      include_history: {
        type: 'boolean',
        description: 'Include execution history (default: true)',
      },
    },
    required: ['id'],
  },
};

export async function handler(params, context = {}) {
  const { id, include_history = true } = params;

  try {
    const task = await TaskQueries.getById(id);

    if (!task) {
      return {
        success: false,
        error: `Task with ID ${id} not found`,
      };
    }

    const result = {
      success: true,
      task: {
        id: task.id,
        name: task.name,
        description: task.description,
        type: task.task_type,
        status: task.status,

        // Scheduling
        scheduledAt: task.scheduled_at,
        cronExpression: task.cron_expression,
        nextRunAt: task.next_run_at,
        timezone: task.timezone,

        // Callback
        callbackType: task.callback_type,
        callbackConfig: task.callback_config,

        // Payload
        payload: task.payload,

        // Retry config
        maxRetries: task.max_retries,
        retryDelaySeconds: task.retry_delay_seconds,
        currentRetryCount: task.current_retry_count,

        // Execution stats
        executionCount: task.execution_count,
        lastExecutedAt: task.last_executed_at,

        // Metadata
        tags: task.tags,
        createdAt: task.created_at,
        updatedAt: task.updated_at,
        createdBy: task.created_by,
      },
    };

    // Add cron info for recurring tasks
    if (task.task_type === 'recurring' && task.cron_expression) {
      result.schedule = {
        description: describeCron(task.cron_expression),
        upcomingRuns: getUpcomingCronRuns(task.cron_expression, task.timezone, 5)
          .map(d => d.toISOString()),
      };
    }

    // Include execution history if requested
    if (include_history) {
      const executions = await ExecutionQueries.getByTaskId(id, 10);
      result.executionHistory = executions.map(exec => ({
        id: exec.id,
        executedAt: exec.executed_at,
        completedAt: exec.completed_at,
        status: exec.status,
        responseCode: exec.response_code,
        durationMs: exec.duration_ms,
        errorMessage: exec.error_message,
        retryNumber: exec.retry_number,
      }));
    }

    return result;
  } catch (error) {
    console.error('[get_task] Error:', error);
    return {
      success: false,
      error: `Failed to get task: ${error.message}`,
    };
  }
}

export default { definition, handler };
