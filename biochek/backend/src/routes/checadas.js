import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/requireRole.js';
import { createChecada, listChecadas } from '../controllers/checadasController.js';

const router = Router();
// Admin/RH only. Employee JWTs (`role: 'empleado'`, issued by
// /api/auth/empleado/login) are signed with the same JWT_SECRET and are
// therefore accepted by `requireAuth` — without this role guard an employee
// could POST a checada for ANY empleado_id, with no biometric verification
// and no geofence (by sending `origen: 'dispositivo'`), and read every
// employee's attendance. The employee-facing write path is
// /api/mobile/checadas (requireRole('empleado')), which derives empleado_id
// from the token and always enforces match + geofence + clock drift.
router.use(requireAuth, requireRole('admin', 'rh'));
router.post('/', createChecada);
router.get('/', listChecadas);

// Known gap, intentional for this plan: `POST /api/checadas` is now
// admin/RH-only, which is correct for the mobile app (it uses
// /api/mobile/checadas instead) but leaves the *device adapter* (a kiosk,
// not a person) without a write path — it has no admin JWT. The device
// adapter plan must introduce its own write-path auth (e.g. a device API
// key/HMAC scheme) and adjust this route's middleware accordingly — do not
// ship the device adapter assuming admin login is how it authenticates.
//
// Related gap: `origen` is currently read directly from the request body
// and trusted — nothing stops an authenticated admin/RH caller from claiming
// `origen: 'dispositivo'` to skip geofence validation (which only runs
// for `origen === 'app'`). The device adapter plan must derive `origen`
// from the authentication mechanism itself (device API key -> force
// `dispositivo`), never trust it from the body.

export default router;
