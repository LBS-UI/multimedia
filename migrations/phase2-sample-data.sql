-- Fictional sample data only. Run after the Phase 2 migration.
-- Do not use real student names.

INSERT INTO memberships (
  member_number, display_name, club_role, status, token_hash, created_at,
  public_id, visibility, updated_at, activated_at
)
SELECT 'MC-SAMPLE1', 'Sample Member', 'Member', 'active', 'sample-hash-1', datetime('now'),
       'sample-public-member-001', 'public', datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE public_id = 'sample-public-member-001');

INSERT INTO memberships (
  member_number, display_name, club_role, status, token_hash, created_at,
  public_id, visibility, updated_at, activated_at, revoked_at
)
SELECT 'MC-SAMPLE2', 'Sample Revoked', 'Member', 'revoked', 'sample-hash-2', datetime('now'),
       'sample-public-revoked-002', 'public', datetime('now'), datetime('now'), datetime('now')
WHERE NOT EXISTS (SELECT 1 FROM memberships WHERE public_id = 'sample-public-revoked-002');
