#!/bin/sh
# Start-up of the BIOVOLAILLES container: the database first, then the server.
set -eu

case "${DATABASE_URL:-}" in
  file:*) DB_FILE="${DATABASE_URL#file:}" ;;
  *) DB_FILE="" ;;
esac

# Demonstration only: on the very first start, the database is the seeded demo snapshot (the same
# one the hosted demo serves). Never on a real installation, and never over an existing file.
if [ "${DEMO_SNAPSHOT_ON_FIRST_START:-false}" = "true" ] && [ -n "$DB_FILE" ] && [ ! -s "$DB_FILE" ]; then
  echo "Première mise en route : base de démonstration copiée depuis data/demo/snapshot.db.gz"
  mkdir -p "$(dirname "$DB_FILE")"
  gunzip -c data/demo/snapshot.db.gz > "$DB_FILE"
fi

# Applies only the migrations the database does not have yet; does nothing when it is current.
npm run -s db:migrate

exec npx next start -H 0.0.0.0 -p "${PORT:-3000}"
