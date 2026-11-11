-- Phase 2 migration: QR membership identity foundation
-- Safe for the existing D1 database. Do not drop existing tables.

ALTER TABLE memberships ADD COLUMN public_id TEXT;
ALTER TABLE memberships ADD COLUMN visibility TEXT DEFAULT 'public';
ALTER TABLE memberships ADD COLUMN updated_at TEXT;
ALTER TABLE memberships ADD COLUMN activated_at TEXT;
ALTER TABLE memberships ADD COLUMN revoked_at TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_public_id_idx ON memberships(public_id);

UPDATE memberships
SET visibility = COALESCE(visibility, 'public'),
    updated_at = COALESCE(updated_at, created_at),
    activated_at = COALESCE(activated_at, created_at)
WHERE visibility IS NULL OR updated_at IS NULL OR activated_at IS NULL;

CREATE TABLE IF NOT EXISTS member_projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  link TEXT,
  publication_status TEXT NOT NULL DEFAULT 'draft',
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (member_id) REFERENCES memberships(id)
);

CREATE INDEX IF NOT EXISTS member_projects_member_idx ON member_projects(member_id);
CREATE INDEX IF NOT EXISTS member_projects_status_idx ON member_projects(publication_status);

CREATE TABLE IF NOT EXISTS membership_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  member_id INTEGER,
  detail TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS membership_audit_member_idx ON membership_audit_logs(member_id);
CREATE INDEX IF NOT EXISTS membership_audit_created_idx ON membership_audit_logs(created_at);
