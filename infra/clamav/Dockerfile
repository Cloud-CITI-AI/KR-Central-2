# ClamAV for the tracker (ADR-0011): the official image with our clamd.conf. The worker streams every upload to clamd
# over TCP 3310 (INSTREAM); the limits in clamd.conf are above UPLOAD_MAX_BYTES so every accepted upload can be scanned.
# Base: clamav/clamav:stable pinned by digest (ClamAV 1.5.x on Alpine 3.24, signatures baked in at build time and then
# kept fresh by freshclam; bump the digest deliberately). Build:  docker build -f infra/clamav/Dockerfile -t kr-clamav infra/clamav   (or with context . as the release does)
FROM clamav/clamav:stable@sha256:ebec5bc138401b36ae987caa1a3fa3c3b2a21ed3d51f0bfa5852825e663e67b0

ARG RELEASE_VERSION=dev
# The release workflow passes the repository URL (github.server_url/github.repository), so forks and renames label correctly.
ARG IMAGE_SOURCE=
LABEL org.opencontainers.image.title="kr-clamav" \
      org.opencontainers.image.description="ClamAV daemon (clamd on TCP 3310) with the tracker's upload size limits" \
      org.opencontainers.image.vendor="KR Surveys" \
      org.opencontainers.image.source="${IMAGE_SOURCE}" \
      org.opencontainers.image.version="${RELEASE_VERSION}"

# The build context is either infra/clamav (docker build ... infra/clamav, compose) or the repository root (the release
# workflow passes `context: .`). Exactly one of the two globs matches in each case (the [a] stops the second glob from
# failing on a missing directory when the context is infra/clamav); an unmatched glob is not an error, so the RUN
# below fails the build if our config did not arrive (the upstream image ships its own clamd.conf).
COPY --chown=root:root --chmod=0644 clamd.conf* infr[a]/clamav/clamd.conf* /etc/clamav/
# AlertExceedsMax is a security setting (content past a scan limit must be reported, not skipped as clean): fail the build without it.
RUN grep -q '^StreamMaxLength 60M' /etc/clamav/clamd.conf && grep -q '^AlertExceedsMax yes' /etc/clamav/clamd.conf

# The entrypoint wrapper sets clamd's bind address from CLAMD_TCP_ADDR (default `::` for Railway; 0.0.0.0 on a Docker
# host without IPv6, where clamd cannot bind `::`) and then execs the upstream /init. Same two-glob copy as above.
COPY --chown=root:root --chmod=0755 kr-entrypoint.sh* infr[a]/clamav/kr-entrypoint.sh* /usr/local/bin/
RUN test -x /usr/local/bin/kr-entrypoint.sh

# freshclam runs as a daemon next to clamd (the upstream /init starts it, and checks for new signatures on start);
# FRESHCLAM_CHECKS is checks per day. Mount a volume at /var/lib/clamav so signatures survive restarts.
ENV FRESHCLAM_CHECKS=12 \
    RELEASE_VERSION=${RELEASE_VERSION}

# The upstream entrypoint (/init, kept) starts as root only to chown the signature directory (a Railway volume is
# mounted root-owned); clamd and freshclam then drop to the unprivileged `clamav` user (see User in clamd.conf).
EXPOSE 3310
ENTRYPOINT ["/usr/local/bin/kr-entrypoint.sh"]
