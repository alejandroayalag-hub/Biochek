import { Router } from 'express';
import { loginEmpleado } from '../controllers/authEmpleadoController.js';

const router = Router();
router.post('/login', loginEmpleado);

export default router;
