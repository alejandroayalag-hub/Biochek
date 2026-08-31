CREATE TABLE usuarios (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'rh')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sedes (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  direccion TEXT,
  lat NUMERIC(9,6) NOT NULL,
  lng NUMERIC(9,6) NOT NULL,
  radio_metros INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE dispositivos (
  id SERIAL PRIMARY KEY,
  sede_id INTEGER NOT NULL REFERENCES sedes(id),
  nombre TEXT NOT NULL,
  tipo TEXT NOT NULL,
  protocolo TEXT NOT NULL,
  identificador TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE empleados (
  id SERIAL PRIMARY KEY,
  nombre TEXT NOT NULL,
  codigo_noi TEXT UNIQUE NOT NULL,
  sede_id INTEGER NOT NULL REFERENCES sedes(id),
  estado TEXT NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'baja')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE enrolamientos_biometricos (
  id SERIAL PRIMARY KEY,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('rostro', 'huella_dispositivo')),
  embedding_cifrado BYTEA,
  fecha_enrolamiento TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_expiracion_retencion TIMESTAMPTZ NOT NULL,
  aviso_privacidad_aceptado_at TIMESTAMPTZ,
  aviso_privacidad_ip TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE checadas (
  id SERIAL PRIMARY KEY,
  empleado_id INTEGER NOT NULL REFERENCES empleados(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  origen TEXT NOT NULL CHECK (origen IN ('app', 'dispositivo')),
  dispositivo_id INTEGER REFERENCES dispositivos(id),
  lat NUMERIC(9,6),
  lng NUMERIC(9,6),
  metodo TEXT,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE exportaciones_noi (
  id SERIAL PRIMARY KEY,
  desde DATE NOT NULL,
  hasta DATE NOT NULL,
  archivo TEXT NOT NULL,
  disparado_por INTEGER REFERENCES usuarios(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  usuario_id INTEGER REFERENCES usuarios(id),
  accion TEXT NOT NULL,
  detalle TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
