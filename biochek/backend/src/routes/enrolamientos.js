import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { listEnrolamientos, aprobarEnrolamiento, rechazarEnrolamiento } from '../controllers/enrolamientosController.js';

const router = Router();
router.use(requireAuth);
router.get('/', listEnrolamientos);
router.post('/:id/aprobar', requireRole('admin'), aprobarEnrolamiento);
router.post('/:id/rechazar', requireRole('admin'), rechazarEnrolamiento);

export default router;
