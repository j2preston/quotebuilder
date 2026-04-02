import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate() {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
  try {
    const migrationSQL = readFileSync(
      join(__dirname, 'migrations/001_initial.sql'),
      'utf8'
    );
    await sql.unsafe(migrationSQL);
    console.log('✅ Migration 001_initial applied');
  } finally {
    await sql.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
