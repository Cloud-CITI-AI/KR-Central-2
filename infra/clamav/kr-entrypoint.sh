#!/bin/sh
# Entrypoint wrapper for the kr-clamav image: sets the address clamd binds from CLAMD_TCP_ADDR, then hands over to the
# upstream /init (which stays PID 1 through exec: tini, signature volume chown, freshclam and clamd).
#
# Default `::`, which is what Railway's IPv6 private network needs and which also accepts IPv4 on a dual-stack host.
# A Docker host whose kernel has no IPv6 cannot bind `::` (clamd logs "TCP: getaddrinfo failed: Name has no usable
# address" and never listens); set CLAMD_TCP_ADDR=0.0.0.0 there (docker-compose.yml passes KR_STACK_HOST through).
#
# KR_CLAMD_CONF and KR_CLAMAV_INIT exist only so infra/clamav/test/entrypoint.test.mjs can run this without the image.
set -eu

conf="${KR_CLAMD_CONF:-/etc/clamav/clamd.conf}"
init="${KR_CLAMAV_INIT:-/init}"
addr="${CLAMD_TCP_ADDR:-::}"

# Fail closed: an IP literal only (hex digits, dots and colons), never a value that could carry sed or config syntax.
case "$addr" in
  '' | *[!0-9A-Fa-f:.]*)
    echo "kr-entrypoint: CLAMD_TCP_ADDR must be an IPv4 or IPv6 address, got '$addr'" >&2
    exit 64
    ;;
esac

if ! grep -q '^TCPAddr ' "$conf"; then
  echo "kr-entrypoint: no TCPAddr line in $conf" >&2
  exit 70
fi
sed -i "s|^TCPAddr .*|TCPAddr $addr|" "$conf"

exec "$init" "$@"
