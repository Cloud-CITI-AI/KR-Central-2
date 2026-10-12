# ClamAV image

The `clamav` Railway service (ADR-0008, ADR-0011). The worker streams every new upload to clamd with `INSTREAM` over TCP 3310
and stores `clean`, `infected` or `error` (PRODUCT_SPEC section 11). This directory is the official `clamav/clamav:stable`
image (pinned by digest) plus our `clamd.conf`.

| File                        | Purpose                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------- |
| `Dockerfile`                | Base image by digest, our `clamd.conf`, the entrypoint wrapper, OCI labels, `FRESHCLAM_CHECKS`      |
| `clamd.conf`                | TCP 3310 on `::` (see Bind address), console logging, `StreamMaxLength`/`MaxFileSize`/`MaxScanSize` |
| `kr-entrypoint.sh`          | Sets the bind address from `CLAMD_TCP_ADDR`, then execs the upstream `/init`                        |
| `test/entrypoint.test.mjs`  | The wrapper's address handling, without Docker                                                      |
| `test/scan-limits.test.mjs` | Starts the image and proves a 55 MiB file scans clean, EICAR is detected, 61 MiB is refused         |

## Limits

| Setting           | Value | Why                                                                                                                                                                                                                                                                                                 |
| ----------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StreamMaxLength` | 60M   | Largest `INSTREAM` clamd reads. Must be at least `UPLOAD_MAX_BYTES` (default 50 MB); the worker's `CLAMAV_STREAM_MAX_BYTES` (62914560) is the same number and its config refuses a smaller one. ADR-0011 records clamd's older 25M `INSTREAM` default, which would leave large uploads unscannable. |
| `MaxFileSize`     | 60M   | One scanned file (an upload is one file).                                                                                                                                                                                                                                                           |
| `MaxScanSize`     | 240M  | Total bytes scanned including archive contents, so decompression bombs stop here.                                                                                                                                                                                                                   |

If `UPLOAD_MAX_BYTES` is raised, raise all three (and `CLAMAV_STREAM_MAX_BYTES`) together and rebuild the image.

## Bind address

clamd binds `::` by default: Railway's private network is IPv6 and `::` also accepts IPv4 on a dual-stack host. A Docker host
whose kernel has no IPv6 (no `/proc/net/if_inet6`) cannot bind `::`: clamd logs `TCP: getaddrinfo failed: Name has no usable
address`, never listens on 3310, the health check stays `starting` and every upload scan stays pending. Set the environment
variable `CLAMD_TCP_ADDR` on the container to an IP literal (`0.0.0.0` for IPv4 only); `kr-entrypoint.sh` rewrites the single
`TCPAddr` line of `clamd.conf` from it at start, and refuses anything that is not an IP literal. Do not set it on Railway.
`docker compose` passes `KR_STACK_HOST` to it (`KR_STACK_HOST=0.0.0.0 docker compose --profile stack up`), and the worker
waits for the container to be healthy. The upstream `CLAMD_CONF_TCPAddr` does not work for this: it appends a second
`TCPAddr` line and clamd binds both, so `::` still fails.

## Running

- **Memory: give the service 2 to 3 GB.** clamd holds the signature database in memory (about 1.1 GiB idle) and loads the
  new database next to the old one on each reload (`ConcurrentDatabaseReload yes`), so the peak is roughly double. Under
  2 GB the reload can be OOM-killed and uploads stay in `scan pending`/`error`.
- **Volume:** mount a Railway volume at `/var/lib/clamav` so signatures survive restarts. The image ships signatures from
  build time; `freshclam` runs as a daemon (`FRESHCLAM_CHECKS=12` checks a day) and updates them, and clamd reloads
  them. A new volume starts from an empty directory and downloads the full database (about 200 MB) before clamd starts.
  Allow a few minutes for the first start and for health checks to pass.
- **Startup:** the upstream `/init` starts as root only to `chown` the signature directory (Railway mounts volumes
  root-owned); clamd and `freshclam` then run as the unprivileged `clamav` user. There is no Dockerfile `VOLUME` (Railway
  does not allow it).
- **Network:** private only (`clamav.railway.internal:3310`); never publish a public domain. clamd has no authentication.
- **Egress:** `freshclam` needs HTTPS to `database.clamav.net`. When that is unreachable clamd keeps scanning with the
  signatures it has and `freshclam` logs the failure; an alert on "database is older than 7 days" is worth adding.
- **Logs** go to the console (no `LogFile`): clamd cannot open `/dev/stdout` itself.

## Build and test

```bash
docker build -f infra/clamav/Dockerfile -t kr-clamav:test infra/clamav
docker build -f infra/clamav/Dockerfile -t kr-clamav:test .   # same image from the repository root, as the release workflow builds it
node --test infra/clamav/test/scan-limits.test.mjs   # needs Docker; builds the image itself, 30-90 s for clamd to load
```

The test runs the image as shipped. Only on a host kernel without IPv6 does it set `CLAMD_TCP_ADDR=0.0.0.0` (see Bind
address); Railway and CI runners have IPv6.

Manual check against a running container:

```bash
docker run -d --name clamav -p 3310:3310 kr-clamav:test                              # add -e CLAMD_TCP_ADDR=0.0.0.0 without host IPv6
printf 'zPING\0' | nc localhost 3310        # PONG once the signatures are loaded
```
