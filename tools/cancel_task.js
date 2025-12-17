// MCP Tool: cancel_task
// Cancel a scheduled task

import { TaskQueries } from '../db/queries.js';

export const definition = {
  name: 'cancel_task',
  description: 'Cancel a scheduled task. The task will not execute and cannot be resumed.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Task ID (UUID) to cancel',
      },
    },
    required: ['id'],
  },
};

export async function handler(params, context = {}) {
  const { id } = params;

  try {
    const task = await TaskQueries.getById(id);

    if (!task) {
      return {
        success: false,
        error: `Task with ID ${id} not found`,
      };
    }

    if (task.status === 'cancelled') {
      return {
        success: false,
        error: 'Task is already cancelled',
      };
    }

    if (task.status === 'completed') {
      return {
        success: false,
        error: 'Cannot cancel a completed task',
      };
    }

    const updated = await TaskQueries.cancel(id);

    return {
      success: true,
      task: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
        previousStatus: task.status,
      },
      message: `Task "${updated.name}" has been cancelled`,
    };
  } catch (error) {
    console.error('[cancel_task] Error:', error);
    return {
      success: false,
      error: `Failed to cancel task: ${error.message}`,
    };
  }
}

export default { definition, handler };
