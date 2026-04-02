import 'dotenv/config';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const { Client } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    await client.query(sql);
    console.log('✅ Schema applied from schema.sql');
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
