-- Whether the email of the user's latest sign-in was verified by the identity provider (Entra `xms_edov`; members
-- always true). A grant may bind to an external account only while this is true (PRODUCT_SPEC §3.4, ADR-0014).
-- `false` is the safe default for rows that exist before this column: the flag is refreshed at their next sign-in.
-- A constant default is metadata-only on PostgreSQL 11+, so no table rewrite and no long lock.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '5s';
ALTER TABLE users ADD COLUMN email_verified boolean NOT NULL DEFAULT false;
