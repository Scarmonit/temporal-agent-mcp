// MCP Tools: pause_task, resume_task
// Pause and resume recurring tasks

import { TaskQueries } from '../db/queries.js';
import { getNextCronRun } from '../utils/time.js';

export const pauseDefinition = {
  name: 'pause_task',
  description: 'Pause a recurring task. The task will stop executing until resumed.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Task ID (UUID) to pause',
      },
    },
    required: ['id'],
  },
};

export const resumeDefinition = {
  name: 'resume_task',
  description: 'Resume a paused task. The task will continue executing according to its schedule.',
  inputSchema: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        description: 'Task ID (UUID) to resume',
      },
    },
    required: ['id'],
  },
};

export async function pauseHandler(params, context = {}) {
  const { id } = params;

  try {
    const task = await TaskQueries.getById(id);

    if (!task) {
      return { success: false, error: `Task with ID ${id} not found` };
    }

    if (task.status !== 'active') {
      return { success: false, error: `Cannot pause task with status "${task.status}"` };
    }

    const updated = await TaskQueries.pause(id);

    return {
      success: true,
      task: {
        id: updated.id,
        name: updated.name,
        status: updated.status,
      },
      message: `Task "${updated.name}" has been paused`,
    };
  } catch (error) {
    console.error('[pause_task] Error:', error);
    return { success: false, error: `Failed to pause task: ${error.message}` };
  }
}

export async function resumeHandler(params, context = {}) {
  const { id } = params;

  try {
    const task = await TaskQueries.getById(id);

    if (!task) {
      return { success: false, error: `Task with ID ${id} not found` };
    }

    if (task.status !== 'paused') {
      return { success: false, error: `Cannot resume task with status "${task.status}"` };
    }

    // Update next_run_at for recurring tasks
    let nextRunAt = task.next_run_at;
    if (task.task_type === 'recurring' && task.cron_expression) {
      nextRunAt = getNextCronRun(task.cron_expression, task.timezone);
    }

    const updated = await TaskQueries.resume(id);

    // Update next run time if it changed
    if (nextRunAt && nextRunAt !== task.next_run_at) {
      await TaskQueries.recordExecution(id, nextRunAt, false);
    }

    return {
      success: true,
      task: {
        id: updated.id,
        name: updated.name,
        status: 'active',
        nextRunAt,
      },
      message: `Task "${updated.name}" has been resumed`,
    };
  } catch (error) {
    console.error('[resume_task] Error:', error);
    return { success: false, error: `Failed to resume task: ${error.message}` };
  }
}

export default {
  pause: { definition: pauseDefinition, handler: pauseHandler },
  resume: { definition: resumeDefinition, handler: resumeHandler },
};
