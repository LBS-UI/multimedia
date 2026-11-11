CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT,
  date TEXT,
  description TEXT,
  image TEXT,
  location TEXT,
  poster_color TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS announcements (
  id TEXT PRIMARY KEY,
  title TEXT,
  content TEXT,
  image TEXT,
  category TEXT,
  date TEXT,
  posted_at TEXT,
  pinned INTEGER DEFAULT 0,
  author TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS member_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT,
  role TEXT,
  text TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS push_subs (
  id TEXT PRIMARY KEY,
  endpoint TEXT,
  subscription TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  body TEXT,
  created_at TEXT,
  link TEXT,
  category TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT,
  email TEXT UNIQUE,
  password_hash TEXT,
  role TEXT,
  session_token TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS club_requests (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  username TEXT,
  title TEXT,
  category TEXT,
  priority TEXT,
  description TEXT,
  status TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS join_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  membership_id TEXT UNIQUE NOT NULL,
  pin_requested INTEGER DEFAULT 0,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS site_presence (
  id TEXT PRIMARY KEY,
  label TEXT,
  last_seen TEXT
);

CREATE TABLE IF NOT EXISTS memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_number TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  club_role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL,
  public_id TEXT UNIQUE,
  visibility TEXT DEFAULT 'public',
  updated_at TEXT,
  activated_at TEXT,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS memberships_status_idx ON memberships(status);
CREATE INDEX IF NOT EXISTS memberships_token_idx ON memberships(token_hash);
CREATE UNIQUE INDEX IF NOT EXISTS memberships_public_id_idx ON memberships(public_id);

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

CREATE INDEX IF NOT EXISTS announcements_posted_idx ON announcements(posted_at);
CREATE INDEX IF NOT EXISTS member_messages_id_idx ON member_messages(id);
CREATE INDEX IF NOT EXISTS alerts_id_idx ON alerts(id);
CREATE INDEX IF NOT EXISTS club_requests_user_idx ON club_requests(user_id);
CREATE INDEX IF NOT EXISTS join_requests_id_idx ON join_requests(id);
