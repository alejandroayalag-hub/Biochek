import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { createChecada, listChecadas } from '../controllers/checadasController.js';

const router = Router();
router.use(requireAuth);
router.post('/', createChecada);
router.get('/', listChecadas);

// Known gap, intentional for this plan: `requireAuth` checks the admin
// panel's JWT (`usuarios` table). That's correct for `GET /api/checadas`
// (reportes viewed by RH/admin) but is a stand-in for `POST /api/checadas`
// — real callers are the mobile app (acting on behalf of an employee, not
// an admin) and the device adapter (a kiosk, not a person). Neither will
// have an admin JWT. The mobile app plan and the device adapter plan must
// each introduce their own write-path auth (e.g. a short-lived employee
// token issued after a successful local biometric match, and a device
// API key/HMAC scheme respectively) and adjust this route's middleware
// accordingly — do not ship the mobile app or device adapter assuming
// admin login is how they authenticate.
//
// Related gap: `origen` is currently read directly from the request body
// and trusted — nothing stops an authenticated caller from claiming
// `origen: 'dispositivo'` to skip geofence validation (which only runs
// for `origen === 'app'`). The mobile app plan and device adapter plan
// must derive `origen` from the authentication mechanism itself (employee
// token -> force `app`; device API key -> force `dispositivo`), never
// trust it from the body.

export default router;
