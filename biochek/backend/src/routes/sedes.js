import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { listSedes, createSede, updateSede, deleteSede } from '../controllers/sedesController.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'rh'));
router.get('/', listSedes);
router.post('/', requireRole('admin'), createSede);
router.put('/:id', requireRole('admin'), updateSede);
router.delete('/:id', requireRole('admin'), deleteSede);

export default router;
