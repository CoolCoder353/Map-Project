/**
 * Admin CLI (run inside the api container):
 *   node dist/cli.js migrate
 *   node dist/cli.js bootstrap-admin <email> [password]   create or promote the first admin
 *   node dist/cli.js create-invite [count] [role]
 *   node dist/cli.js reset-link <email>
 */
import { createPool } from '@wayfinder/core';
import { runCommand } from './cli-commands.js';

const [command, ...args] = process.argv.slice(2);
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}
const db = createPool(url, 2);

runCommand(db, command, args, (line) => console.log(line), process.env.PUBLIC_WEB_URL)
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.end());
