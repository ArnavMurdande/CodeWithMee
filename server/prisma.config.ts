import dotenv from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'prisma/config';

dotenv.config({ path: path.join(__dirname, '.env') });
dotenv.config();

const unconfiguredUrl =
  'postgresql://unconfigured:unconfigured@127.0.0.1:1/codewithmee_unconfigured';

export default defineConfig({
  schema: path.join('..', 'prisma', 'schema.prisma'),
  migrations: {
    path: path.join('..', 'prisma', 'migrations'),
    seed: 'node scripts/seed-database.js',
  },
  datasource: {
    // Schema-only commands remain usable without secrets. Database commands hit
    // an intentionally unreachable address unless DATABASE_URL is explicit.
    url: process.env.DATABASE_URL ?? unconfiguredUrl,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
