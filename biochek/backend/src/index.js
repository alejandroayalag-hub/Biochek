import 'dotenv/config';
import { createApp } from './app.js';
import { runMigrations } from './db/migrate.js';

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
