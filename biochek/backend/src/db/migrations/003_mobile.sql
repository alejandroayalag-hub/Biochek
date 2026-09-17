ALTER TABLE empleados ADD COLUMN pin_hash TEXT;

ALTER TABLE enrolamientos_biometricos
  ADD COLUMN estado TEXT NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('pendiente', 'aprobado', 'rechazado')),
  ADD COLUMN foto_urls TEXT[];

ALTER TABLE checadas
  ADD COLUMN score_verificacion NUMERIC,
  ADD COLUMN foto_url TEXT,
  ADD COLUMN timestamp_dispositivo TIMESTAMPTZ;
