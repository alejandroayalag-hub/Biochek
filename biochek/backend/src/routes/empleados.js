import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { listEmpleados, createEmpleado, updateEmpleado, deleteEmpleado } from '../controllers/empleadosController.js';

const router = Router();
router.use(requireAuth);
router.get('/', listEmpleados);
router.post('/', createEmpleado);
router.put('/:id', updateEmpleado);
router.delete('/:id', deleteEmpleado);

export default router;
