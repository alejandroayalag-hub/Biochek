import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createEnrolamiento, getEnrolamientoEstado } from '../controllers/mobileEnrolamientosController.js';

const router = Router();
router.use(requireAuth, requireRole('empleado'));

router.post('/enrolamientos', createEnrolamiento);
router.get('/enrolamiento/estado', getEnrolamientoEstado);

export default router;
