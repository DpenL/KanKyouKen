bash -c '
check_var() {
  local name="$1" val="$2"
  if [ -z "$val" ]; then
    printf "❌ %-28s (missing)\n" "$name"
  else
    printf "✅ %-28s %s\n" "$name" "$(echo -n "$val" | sha1sum | cut -c1-12)"
  fi
}

echo "🔍 Checking JWT secrets across environments..."
echo "---------------------------------------------"
root_val=$(grep -m1 JWT_SECRET .env | cut -d"=" -f2-)
check_var "Host (.env JWT_SECRET)" "$root_val"

auth_val=$(docker exec -it supabase_auth_kankyouken printenv GOTRUE_JWT_SECRET 2>/dev/null | tr -d "\r")
check_var "Auth (GOTRUE_JWT_SECRET)" "$auth_val"

edge_val=$(docker exec -it supabase_edge_runtime_kankyouken printenv SUPABASE_JWT_SECRET 2>/dev/null | tr -d "\r")
check_var "Edge (SUPABASE_JWT_SECRET)" "$edge_val"

python_val=$(python3 - <<PY
import os
from dotenv import load_dotenv
load_dotenv()
print(os.getenv("JWT_SECRET",""))
PY
)
check_var "Python (JWT_SECRET)" "$python_val"

echo "---------------------------------------------"
if [ "$root_val" = "$auth_val" ] && [ "$root_val" = "$edge_val" ] && [ "$root_val" = "$python_val" ]; then
  echo "✅ All secrets match — JWT verification should succeed."
else
  echo "❌ Mismatch detected — check which container is using the wrong secret."
fi
'
