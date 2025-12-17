// Database migration script
// Run: npm run migrate

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import pg from 'pg';
import config from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Client } = pg;

async function migrate() {
  const client = new Client({
    connectionString: config.database.connectionString,
  });

  try {
    console.log('[Migrate] Connecting to database...');
    await client.connect();

    console.log('[Migrate] Reading schema file...');
    const schemaPath = join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');

    console.log('[Migrate] Applying schema...');
    await client.query(schema);

    console.log('[Migrate] Schema applied successfully!');

    // Verify tables exist
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('tasks', 'task_executions', 'stored_notifications')
    `);

    console.log('[Migrate] Created tables:', result.rows.map(r => r.table_name).join(', '));

  } catch (error) {
    console.error('[Migrate] Error:', error.message);

    if (error.message.includes('ECONNREFUSED')) {
      console.error('\n[Migrate] Could not connect to database.');
      console.error('[Migrate] Make sure PostgreSQL is running and DATABASE_URL is correct.');
      console.error(`[Migrate] Current DATABASE_URL: ${config.database.connectionString}`);
    }

    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
