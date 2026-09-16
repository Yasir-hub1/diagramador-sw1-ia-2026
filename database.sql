CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100),
  email VARCHAR(100) UNIQUE,
  password VARCHAR(100) NOT NULL
);

-- NOTA: la tabla "session" para express-session (connect-pg-simple) se crea
-- automáticamente al arrancar la app (createTableIfMissing: true). No hace
-- falta declararla aquí.

-- === Diagramas colaborativos ===

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE diagrams (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL DEFAULT 'Diagrama sin título',
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  share_token UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  graph_data JSONB NOT NULL DEFAULT '{"cells":[]}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_diagrams_owner_id ON diagrams(owner_id);

-- Usuarios que han entrado alguna vez a una sala (colaboradores)
CREATE TABLE diagram_collaborators (
  id SERIAL PRIMARY KEY,
  diagram_id INTEGER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (diagram_id, user_id)
);

CREATE INDEX idx_diagram_collaborators_diagram_id ON diagram_collaborators(diagram_id);

-- Log de actividad append-only: quién modificó qué elemento y cuándo
CREATE TABLE diagram_activity (
  id BIGSERIAL PRIMARY KEY,
  diagram_id INTEGER NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name VARCHAR(100) NOT NULL,
  action_type VARCHAR(30) NOT NULL, -- class:add|class:update|class:remove|link:add|link:update|link:remove
  element_id VARCHAR(100),
  element_label VARCHAR(150),
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_diagram_activity_diagram_id ON diagram_activity(diagram_id);
CREATE INDEX idx_diagram_activity_element_id ON diagram_activity(diagram_id, element_id);
