import { Router } from 'express';
import { AVISO_PRIVACIDAD } from '../utils/avisoPrivacidad.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(AVISO_PRIVACIDAD);
});

export default router;
