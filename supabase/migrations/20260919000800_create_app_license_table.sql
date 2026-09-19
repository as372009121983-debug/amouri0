CREATE TABLE IF NOT EXISTS app_license (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  license_key text UNIQUE NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE app_license ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_app_license" ON app_license FOR SELECT
  TO anon, authenticated USING (true);

INSERT INTO app_license (license_key, active)
VALUES ('ELM-3DC8-AF8B-D32D-5AC3', true)
ON CONFLICT (license_key) DO UPDATE SET active = true;
