ALTER TABLE enrolamientos_biometricos
  ADD COLUMN aviso_privacidad_version TEXT,
  ADD COLUMN anonimizado_at TIMESTAMPTZ;
