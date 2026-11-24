import { config } from './config.js';
import { createApp } from './app.js';
import { migrate } from './migrate.js';
import { pool } from './db.js';

async function main() {
  // Apply any pending schema migrations on start so upgrades are automatic.
  await migrate();
  const app = createApp();
  const server = app.listen(config.port, () => {
    console.log(`Smart Dairy Farm Manager running on http://localhost:${config.port}`);
  });
  const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
