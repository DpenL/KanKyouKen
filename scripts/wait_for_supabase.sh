#!/usr/bin/env bash
set -euo pipefail

echo "⏳ Waiting for Supabase containers to become healthy..."

# Local project suffix
PROJECT_SUFFIX="_${PROJECT_ID}"

# Containers that define healthchecks (the only ones we should wait for)
REQUIRED=(
  "supabase_db"
  "supabase_auth"
  "supabase_storage"
  "supabase_realtime"
  "supabase_kong"
)


# Expand names with project suffix
for i in "${!REQUIRED[@]}"; do
  REQUIRED[$i]="${REQUIRED[$i]}${PROJECT_SUFFIX}"
done

MAX_WAIT=180
INTERVAL=3
elapsed=0

while (( elapsed < MAX_WAIT )); do
  all_healthy=true

  for cname in "${REQUIRED[@]}"; do
    health=$(docker inspect --format='{{.State.Health.Status}}' "$cname" 2>/dev/null || echo "missing")

    case "$health" in
      healthy)
        ;;
      starting | unhealthy | failed)
        all_healthy=false
        ;;
      missing | "")
        all_healthy=false
        ;;
      *)
        echo "[WARN] Unexpected health value for $cname: '$health'"
        all_healthy=false
        ;;
    esac

    if ! $all_healthy; then
      break
    fi
  done


  if $all_healthy; then
    echo "✅ All Supabase containers are healthy."
    exit 0
  fi

  sleep "$INTERVAL"
  (( elapsed += INTERVAL ))

done

echo "❌ Timeout waiting for Supabase containers to become healthy."
docker ps
exit 1
