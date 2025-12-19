/**
 * Setup Memory Maintenance Tasks
 *
 * Creates scheduled recurring tasks for semantic memory maintenance:
 * - Daily decay of old low-importance memories
 * - Weekly cleanup of very low importance memories
 *
 * Run with: node scripts/setup-memory-maintenance.js
 */

const TEMPORAL_API_URL = process.env.TEMPORAL_API_URL || 'http://localhost:3324';
const SEMANTIC_MEMORY_URL = process.env.SEMANTIC_MEMORY_URL || 'https://memory.scarmonit.com';

async function createTask(config) {
  try {
    const response = await fetch(`${TEMPORAL_API_URL}/mcp/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tool: 'schedule_recurring',
        params: config,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API error: ${response.status} - ${error}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Failed to create task:', error.message);
    return { success: false, error: error.message };
  }
}

async function setupMemoryMaintenanceTasks() {
  console.log('Setting up memory maintenance tasks...\n');
  console.log('Temporal API:', TEMPORAL_API_URL);
  console.log('Semantic Memory:', SEMANTIC_MEMORY_URL);
  console.log('');

  // Task 1: Daily Memory Decay
  // Runs at 3 AM UTC daily
  // Soft deletes memories older than 60 days with importance < 0.2
  console.log('Creating daily memory decay task...');
  const dailyResult = await createTask({
    name: 'memory-daily-decay',
    description: 'Apply decay to old low-importance memories (60+ days, importance < 0.2)',
    cron: '0 3 * * *', // 3 AM daily
    timezone: 'UTC',
    callback: {
      type: 'webhook',
      url: `${SEMANTIC_MEMORY_URL}/mcp/execute`,
    },
    payload: {
      tool: 'forget',
      parameters: {
        olderThanDays: 60,
        belowImportance: 0.2,
        soft: true,
        decayFactor: 0.7, // Reduce importance by 30%
      },
    },
    tags: ['memory-maintenance', 'daily', 'decay'],
    enabled: true,
  });

  if (dailyResult.success) {
    console.log('  Daily decay task created:', dailyResult.task?.id);
    console.log('  Schedule:', dailyResult.schedule?.description);
    console.log('  Next run:', dailyResult.task?.nextRunAt);
  } else {
    console.error('  Failed:', dailyResult.error);
  }

  console.log('');

  // Task 2: Weekly Memory Cleanup
  // Runs at 4 AM UTC on Sundays
  // More aggressive cleanup for very old, low importance memories
  console.log('Creating weekly memory cleanup task...');
  const weeklyResult = await createTask({
    name: 'memory-weekly-cleanup',
    description: 'Clean up very old low-importance memories (90+ days, importance < 0.1)',
    cron: '0 4 * * 0', // 4 AM Sunday
    timezone: 'UTC',
    callback: {
      type: 'webhook',
      url: `${SEMANTIC_MEMORY_URL}/mcp/execute`,
    },
    payload: {
      tool: 'forget',
      parameters: {
        olderThanDays: 90,
        belowImportance: 0.1,
        soft: true,
        decayFactor: 0.3, // Reduce importance by 70%
      },
    },
    tags: ['memory-maintenance', 'weekly', 'cleanup'],
    enabled: true,
  });

  if (weeklyResult.success) {
    console.log('  Weekly cleanup task created:', weeklyResult.task?.id);
    console.log('  Schedule:', weeklyResult.schedule?.description);
    console.log('  Next run:', weeklyResult.task?.nextRunAt);
  } else {
    console.error('  Failed:', weeklyResult.error);
  }

  console.log('');

  // Task 3: Monthly Deep Cleanup (optional)
  // Runs at 2 AM UTC on the 1st of each month
  // Hard deletes memories that have decayed to near-zero importance
  console.log('Creating monthly deep cleanup task...');
  const monthlyResult = await createTask({
    name: 'memory-monthly-deep-cleanup',
    description: 'Hard delete memories with near-zero importance (< 0.01)',
    cron: '0 2 1 * *', // 2 AM on 1st of month
    timezone: 'UTC',
    callback: {
      type: 'webhook',
      url: `${SEMANTIC_MEMORY_URL}/mcp/execute`,
    },
    payload: {
      tool: 'forget',
      parameters: {
        belowImportance: 0.01,
        soft: false, // Hard delete
      },
    },
    tags: ['memory-maintenance', 'monthly', 'deep-cleanup'],
    enabled: true,
  });

  if (monthlyResult.success) {
    console.log('  Monthly deep cleanup task created:', monthlyResult.task?.id);
    console.log('  Schedule:', monthlyResult.schedule?.description);
    console.log('  Next run:', monthlyResult.task?.nextRunAt);
  } else {
    console.error('  Failed:', monthlyResult.error);
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('Memory maintenance tasks setup complete!');
  console.log('═══════════════════════════════════════════════════════════');
}

// Run setup
setupMemoryMaintenanceTasks();
