import express from 'express';
import authRouter from './routes/auth.js';
import authEmpleadoRouter from './routes/authEmpleado.js';
import sedesRouter from './routes/sedes.js';
import empleadosRouter from './routes/empleados.js';
import checadasRouter from './routes/checadas.js';
import mobileRouter from './routes/mobile.js';
import enrolamientosRouter from './routes/enrolamientos.js';
import exportacionesNoiRouter from './routes/exportacionesNoi.js';
import avisoPrivacidadRouter from './routes/avisoPrivacidad.js';

export function createApp() {
  const app = express();
  app.use(express.json({ limit: '10mb' })); // enrollment photos are base64

  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/api/aviso-privacidad', avisoPrivacidadRouter);
  app.use('/api/auth', authRouter);
  app.use('/api/auth/empleado', authEmpleadoRouter);
  app.use('/api/sedes', sedesRouter);
  app.use('/api/empleados', empleadosRouter);
  app.use('/api/checadas', checadasRouter);
  app.use('/api/mobile', mobileRouter);
  app.use('/api/enrolamientos', enrolamientosRouter);
  app.use('/api/exportaciones-noi', exportacionesNoiRouter);

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: 'internal server error' });
  });

  return app;
}
