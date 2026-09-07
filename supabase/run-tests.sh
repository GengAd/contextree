#!/usr/bin/env bash
# Applique `schema.sql` et rejoue `rls.test.sql` sur un Postgres jetable.
# Docker requis — c'est pour ça que ce n'est pas dans `npm test`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
name="contextree-schema-test"

cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
cleanup

docker run -d --name "$name" -e POSTGRES_PASSWORD=x postgres:16 >/dev/null
until docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; do sleep 0.5; done

docker cp "$here/schema.sql" "$name:/schema.sql" >/dev/null
docker cp "$here/rls.test.sql" "$name:/rls.test.sql" >/dev/null
docker exec "$name" psql -U postgres -q -v ON_ERROR_STOP=1 -f /rls.test.sql
