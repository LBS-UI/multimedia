-- Run these one statement at a time in the Cloudflare D1 console.
-- If a statement says the column or table already exists, skip it and continue.

ALTER TABLE memberships ADD COLUMN public_id TEXT;
ALTER TABLE memberships ADD COLUMN visibility TEXT DEFAULT 'public';
ALTER TABLE memberships ADD COLUMN updated_at TEXT;
ALTER TABLE memberships ADD COLUMN activated_at TEXT;
ALTER TABLE memberships ADD COLUMN revoked_at TEXT;

CREATE TABLE IF NOT EXISTS member_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  link TEXT,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS membership_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  member_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS memberships_public_id_idx ON memberships(public_id);
CREATE INDEX IF NOT EXISTS member_projects_member_idx ON member_projects(member_id);
CREATE INDEX IF NOT EXISTS membership_audit_created_idx ON membership_audit_logs(created_at);
