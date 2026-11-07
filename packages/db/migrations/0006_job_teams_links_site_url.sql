-- WP-25 PR 2 (ADR-0015 A2): a link remembers the SharePoint site of the team it was made in. Provisioning and pushes
-- resolve the channel folder in that site, not in whatever site Admin → Teams points at now, so a job linked while the
-- app worked in a test team keeps syncing there after the settings move to the live team.
-- Expand step (BE-8): a nullable column with no default is a catalog-only change; rows from before are filled by the
-- next provisioning run from the settings of that moment (teams-provision handler), and the API fills it on every link.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE job_teams_links ADD COLUMN team_site_url text
  CHECK (team_site_url IS NULL OR (team_site_url ~ '^https://[^/]+/' AND length(team_site_url) <= 500));
