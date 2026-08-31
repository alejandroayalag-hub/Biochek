import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { listEmpleados, createEmpleado, updateEmpleado, deleteEmpleado } from '../controllers/empleadosController.js';

const router = Router();
router.use(requireAuth);
router.get('/', listEmpleados);
router.post('/', requireRole('admin'), createEmpleado);
router.put('/:id', requireRole('admin'), updateEmpleado);
router.delete('/:id', requireRole('admin'), deleteEmpleado);

export default router;
