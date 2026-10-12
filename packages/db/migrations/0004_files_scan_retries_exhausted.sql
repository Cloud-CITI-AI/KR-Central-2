-- QA round 2 (FIX-R2-API): tell the tracker whether a file in scan_status 'error' will still be scanned again.
--
-- Until now the tracker showed "Couldn't be checked for viruses - remove it and upload it again" after the FIRST failed scan,
-- while the hourly sweep re-scans a file in 'error' up to SCAN_ERROR_MAX_RETRIES (3) times and often makes it clean, so users
-- re-uploaded duplicates. The API cannot see the worker's setting, so the worker records the answer when it records the failure:
-- scan_retries_exhausted is true once no automatic re-scan is left (retries used up, or a failure retrying cannot fix). It only means
-- something while scan_status = 'error'; the worker resets it to false whenever a scan passes.
--
-- Expand step (BE-8): adding a column with a constant default is a catalog-only change on Postgres 11+, and an old worker or API
-- that does not know the column keeps working (the default applies, the API simply does not read it).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

ALTER TABLE files ADD COLUMN scan_retries_exhausted boolean NOT NULL DEFAULT false;

-- Files already left in 'error' after the original limit of three automatic re-scans (the fourth failed scan is the last).
UPDATE files SET scan_retries_exhausted = true WHERE scan_status = 'error' AND scan_attempts > 3;
