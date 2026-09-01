import 'dotenv/config';
import { createApp } from './app.js';
import { runMigrations } from './db/migrate.js';

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'change-me-in-production') {
  console.error('JWT_SECRET must be set to a real secret before starting the server');
  process.exit(1);
}

const app = createApp();
const port = process.env.PORT || 3012;

runMigrations()
  .then(() => {
    app.listen(port, () => console.log(`biochek-backend listening on ${port}`));
  })
  .catch(err => {
    console.error('migration failed', err);
    process.exit(1);
  });
