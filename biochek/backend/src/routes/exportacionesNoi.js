import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import {
  createExportacion,
  listExportaciones,
  descargarExportacion,
} from '../controllers/exportacionesNoiController.js';

const router = Router();
router.use(requireAuth, requireRole('admin', 'rh'));
router.post('/', requireRole('admin'), createExportacion);
router.get('/', listExportaciones);
router.get('/:id/descargar', descargarExportacion);

export default router;
