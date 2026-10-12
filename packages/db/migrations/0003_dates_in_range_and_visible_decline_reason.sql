-- QA round 2 (FIX-R2-API): two data-integrity repairs that keep every stored row servable.
--
-- 1. Business dates on a job must lie in 1900-01-01..2199-12-31 (the range @kr/contracts accepts). A parsed or derived date
--    outside it (e.g. approval_expiry 2999-03-03 from a letter, outcome_date 2200-03-30 from a conformed date of 2199-12-31)
--    made GET /v1/jobs/{id} fail serialisation with a 500 forever. The application now refuses such dates before writing;
--    this migration (a) forward-fixes rows that already hold one and (b) adds the same rule as a CHECK so it cannot recur.
--    The repair sets each out-of-range date to NULL. A conformed date that is nulled takes its method, source file, stamp text
--    and outcome date with it (R10 ties the outcome date to the conformed date; the CHECK jobs_conformed_method_with_date
--    requires method and date to be null together). Each repaired job gets its version bumped and one system audit row
--    ('job.dates_repaired') naming the old values. The values that were stored are lost from the table but not from the audit log.
--
-- 2. A declined decision needs a visible reason (R14, PRODUCT_SPEC §8): the comment must not be only whitespace or invisible
--    format characters (zero-width space, joiners, BOM ...). is_blank_text() is the database twin of isBlank() in @kr/contracts
--    (a test compares them over the whole Basic Multilingual Plane). Rows that already violate the stronger rule get the visible
--    placeholder '(No reason was recorded)' and one system audit row ('checkpoint.decision_repaired').
--
-- Both constraints are added NOT VALID (expand step, BE-8): they are enforced for every new and updated row at once, without a
-- full-table scan under the ACCESS EXCLUSIVE lock. The repair above leaves no violating row, so a later migration may
-- VALIDATE CONSTRAINT jobs_dates_in_range and checkpoint_states_decline_needs_comment in its own transaction (contract step).
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15s';

-- ------------------------------------------------------------------------------------------ is_blank_text
-- True when the text is empty or made only of white space and invisible format (Cf) characters.
-- Keep the character list a subset of JS /[\s\u0085\p{Cf}]/u (the API checks first, the database is the backstop).
CREATE FUNCTION is_blank_text(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$
  SELECT regexp_replace(
    value,
    '[\t\n\v\f\r \u0085 ­؀-؅؜۝܏ ᠎ -‏ -  -⁤⁦-⁯　﻿￹-￻]',
    '',
    'g'
  ) = ''
$$;

-- ------------------------------------------------------------------------------------------ job dates
WITH bad AS (
  SELECT id, approval_date, approval_expiry, conformed_date, conformed_method, outcome_date
  FROM jobs
  WHERE approval_date NOT BETWEEN DATE '1900-01-01' AND DATE '2199-12-31'
     OR approval_expiry NOT BETWEEN DATE '1900-01-01' AND DATE '2199-12-31'
     OR conformed_date NOT BETWEEN DATE '1900-01-01' AND DATE '2199-12-31'
     OR outcome_date NOT BETWEEN DATE '1900-01-01' AND DATE '2199-12-31'
), repaired AS (
  UPDATE jobs j
  SET approval_date = CASE WHEN j.approval_date BETWEEN DATE '1900-01-01' AND DATE '2199-12-31' THEN j.approval_date END,
      approval_expiry = CASE WHEN j.approval_expiry BETWEEN DATE '1900-01-01' AND DATE '2199-12-31' THEN j.approval_expiry END,
      conformed_date = CASE WHEN j.conformed_date BETWEEN DATE '1900-01-01' AND DATE '2199-12-31' THEN j.conformed_date END,
      conformed_method = CASE WHEN j.conformed_date BETWEEN DATE '1900-01-01' AND DATE '2199-12-31' THEN j.conformed_method END,
      conformed_file_id = CASE WHEN j.conformed_date BETWEEN DATE '1900-01-01' AND DATE '2199-12-31' THEN j.conformed_file_id END,
      conformed_stamp_text = CASE WHEN j.conformed_date BETWEEN DATE '1900-01-01' AND DATE '2199-12-31' THEN j.conformed_stamp_text END,
      outcome_date = CASE
        WHEN j.conformed_date NOT BETWEEN DATE '1900-01-01' AND DATE '2199-12-31' THEN NULL
        WHEN j.outcome_date BETWEEN DATE '1900-01-01' AND DATE '2199-12-31' THEN j.outcome_date
      END,
      version = j.version + 1
  FROM bad
  WHERE j.id = bad.id
  RETURNING j.id
)
INSERT INTO audit_events (actor_type, action, entity_type, entity_id, job_id, changes)
SELECT 'system', 'job.dates_repaired', 'job', bad.id::text, bad.id,
       CASE WHEN bad.approval_date NOT BETWEEN DATE '1900-01-01' AND DATE '2199-12-31'
            THEN jsonb_build_object('approvalDate', jsonb_build_object('from', bad.approval_date, 'to', NULL)) ELSE '{}'::jsonb END
       || CASE WHEN bad.approval_expiry NOT BETWEEN DATE '1900-01-01' AND DATE '2199-12-31'
               THEN jsonb_build_object('approvalExpiry', jsonb_build_object('from', bad.approval_expiry, 'to', NULL)) ELSE '{}'::jsonb END
       || CASE WHEN bad.conformed_date NOT BETWEEN DATE '1900-01-01' AND DATE '2199-12-31'
               THEN jsonb_build_object('conformedDate', jsonb_build_object('from', bad.conformed_date, 'to', NULL)) ELSE '{}'::jsonb END
       || CASE WHEN bad.conformed_date NOT BETWEEN DATE '1900-01-01' AND DATE '2199-12-31'
                    OR bad.outcome_date NOT BETWEEN DATE '1900-01-01' AND DATE '2199-12-31'
               THEN jsonb_build_object('outcomeDate', jsonb_build_object('from', bad.outcome_date, 'to', NULL)) ELSE '{}'::jsonb END
FROM bad
JOIN repaired ON repaired.id = bad.id;

ALTER TABLE jobs
  ADD CONSTRAINT jobs_dates_in_range CHECK (
    (approval_date IS NULL OR approval_date BETWEEN DATE '1900-01-01' AND DATE '2199-12-31')
    AND (approval_expiry IS NULL OR approval_expiry BETWEEN DATE '1900-01-01' AND DATE '2199-12-31')
    AND (conformed_date IS NULL OR conformed_date BETWEEN DATE '1900-01-01' AND DATE '2199-12-31')
    AND (outcome_date IS NULL OR outcome_date BETWEEN DATE '1900-01-01' AND DATE '2199-12-31')
  ) NOT VALID;

-- ------------------------------------------------------------------------------------------ declined decision comment
WITH repaired AS (
  UPDATE checkpoint_states
  SET decision_comment = '(No reason was recorded)',
      version = version + 1
  WHERE decision = 'declined' AND is_blank_text(decision_comment)
  RETURNING job_id, checkpoint_key
)
INSERT INTO audit_events (actor_type, action, entity_type, entity_id, job_id, changes)
SELECT 'system', 'checkpoint.decision_repaired', 'checkpoint', repaired.checkpoint_key, repaired.job_id,
       jsonb_build_object('decisionComment', jsonb_build_object('from', 'blank', 'to', '(No reason was recorded)'))
FROM repaired;

ALTER TABLE checkpoint_states DROP CONSTRAINT checkpoint_states_decline_needs_comment;
ALTER TABLE checkpoint_states
  ADD CONSTRAINT checkpoint_states_decline_needs_comment
  CHECK (decision IS DISTINCT FROM 'declined' OR NOT is_blank_text(decision_comment)) NOT VALID;
