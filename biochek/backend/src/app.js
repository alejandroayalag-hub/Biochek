import express from 'express';
import authRouter from './routes/auth.js';
import sedesRouter from './routes/sedes.js';
import empleadosRouter from './routes/empleados.js';
import checadasRouter from './routes/checadas.js';

export function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/sedes', sedesRouter);
  app.use('/api/empleados', empleadosRouter);
  app.use('/api/checadas', checadasRouter);

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
