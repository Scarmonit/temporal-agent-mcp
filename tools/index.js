// Tool registry for Temporal Agent MCP
// Exports all tool definitions and handlers

import scheduleTask from './schedule_task.js';
import scheduleRecurring from './schedule_recurring.js';
import listTasks from './list_tasks.js';
import getTask from './get_task.js';
import cancelTask from './cancel_task.js';
import pauseResume from './pause_resume.js';

// All tools available in this MCP server
export const tools = [
  scheduleTask,
  scheduleRecurring,
  listTasks,
  getTask,
  cancelTask,
  { definition: pauseResume.pause.definition, handler: pauseResume.pause.handler },
  { definition: pauseResume.resume.definition, handler: pauseResume.resume.handler },
];

// Map tool names to handlers for quick lookup
export const toolHandlers = new Map(
  tools.map(tool => [tool.definition.name, tool.handler])
);

// Get all tool definitions (for MCP protocol)
export function getToolDefinitions() {
  return tools.map(tool => tool.definition);
}

// Execute a tool by name
export async function executeTool(name, params, context = {}) {
  const handler = toolHandlers.get(name);

  if (!handler) {
    return {
      success: false,
      error: `Unknown tool: ${name}`,
    };
  }

  try {
    return await handler(params, context);
  } catch (error) {
    console.error(`[Tool:${name}] Unhandled error:`, error);
    return {
      success: false,
      error: `Tool execution failed: ${error.message}`,
    };
  }
}

export default {
  tools,
  toolHandlers,
  getToolDefinitions,
  executeTool,
};
