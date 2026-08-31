import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listSedes, createSede, updateSede, deleteSede } from '../controllers/sedesController.js';

const router = Router();
router.use(requireAuth);
router.get('/', listSedes);
router.post('/', createSede);
router.put('/:id', updateSede);
router.delete('/:id', deleteSede);

export default router;
