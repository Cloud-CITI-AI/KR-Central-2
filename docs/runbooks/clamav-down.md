# clamav-down

Alert: [clamav-down](../observability/alerts.md#clamav-down) (page). Objective SLO-5. Fires when over 50 % of scans in
10 minutes end in `error`, when the `clamav` service is unhealthy for 5 minutes, or when its signatures are older than
48 hours. With clamd down no upload can be opened: every new file stays pending or becomes `error`.

## Symptoms

- Uploads stay at "Scanning…" or show "Couldn't be checked for viruses".
- Worker logs `clamd_unreachable` and `circuit_state_changed` (the clamd breaker opens after 5 connection or timeout
  failures in a row and retries after 30 s).

## Dashboards

4 Files and malware scanning (scan results, clamav health, signature age), 3 Worker and queue.

## Diagnose (read-only)

1. **Service.** Railway dashboard: `clamav` deployment status, restarts, memory graph. The service needs 2 to 3 GB. A
   memory line that touches the limit before a restart is an out-of-memory kill, usually during a signature reload.
2. **Logs** (console only): clamd start-up and "Database correctly reloaded" lines; `freshclam` update lines and
   failures. A first start on an empty volume downloads about 200 MB and takes several minutes; that is not a fault.
3. **Signatures.** Last successful `freshclam` update in the logs. Older than 48 h: `freshclam` cannot reach
   `database.clamav.net` over HTTPS (egress), or the volume is full or read-only.
4. **Volume.** A volume must be mounted at `/var/lib/clamav` (`infra/clamav/README.md`). Without it every restart
   downloads signatures again.
5. **Network.** Only the private name `clamav.railway.internal:3310` is used. Worker variables `CLAMAV_HOST`,
   `CLAMAV_PORT`, `CLAMAV_TIMEOUT_MS` must match. Did anyone change the hostname or port?
6. **Backlog.** The queue and file list queries in [worker-queue-backlog](worker-queue-backlog.md) and
   [malware-scan-errors](malware-scan-errors.md).

## Mitigate

1. **Out of memory:** raise the `clamav` service memory to at least 3 GB (a plan or resource decision in Railway, not a
   settings file value), redeploy. Allow minutes for clamd to load.
2. **Stuck or crashed:** redeploy the current `clamav` deployment from the dashboard. Do not give it a public domain: it
   has no authentication.
3. **Stale signatures:** redeploy once to trigger an update. If `freshclam` still cannot download, check Railway's
   outbound network and ClamAV's mirror status. As a last resort start from a new empty volume (it re-downloads the
   database). Record that the volume was replaced.
4. **After it is back:** the worker's breaker closes by itself, queued scans run, and files in `error` rescan at the next
   hourly sweep (redeploy `worker` to bring the first sweep to 60 seconds after start).
5. **Never** set `MALWARE_SCAN_MODE=disabled` to "get uploads going": the config refuses it outside local, and serving
   unscanned files is the exact risk this service removes. If a release broke it, roll back
   ([deploy-and-rollback](deploy-and-rollback.md)).

## Escalate

Down more than 30 minutes, or signatures older than 7 days: incident ([incident-response](incident-response.md)),
severity 2, and tell KR that uploads are unavailable. A rebuilt image (a bumped digest) goes through the normal release.
