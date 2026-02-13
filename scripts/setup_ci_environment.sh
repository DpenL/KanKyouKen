#!/usr/bin/env bash
PYTHON="${pythonLocation}/bin/python"
PIP="${pythonLocation}/bin/pip"

echo "[ci-setup] Installing system dependencies..."

sudo apt-get update -y
sudo apt-get install -y \
    dos2unix \
    make git

# get postgres 17 for supabase
echo "[ci-setup] Installing PostgreSQL 17"
. /etc/os-release
sudo sh -c "echo 'deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $VERSION_CODENAME-pgdg main' > /etc/apt/sources.list.d/pgdg.list"
sudo apt-get update
sudo apt-get install -y postgresql-client-17

sudo ln -sf /usr/lib/postgresql/17/bin/psql /usr/bin/psql
sudo ln -sf /usr/lib/postgresql/17/bin/pg_dump /usr/bin/pg_dump
sudo ln -sf /usr/lib/postgresql/17/bin/pg_restore /usr/bin/pg_restore
sudo ln -sf /usr/lib/postgresql/17/bin/pg_dumpall /usr/bin/pg_dumpall

echo "[ci-setup] Installing Python requirements..."
$PYTHON -m pip install --upgrade pip
$PYTHON -m pip install -r requirements.txt

echo "[ci-setup] Installing KanKyouKen SDK..."
$PYTHON -m pip install -e sdk/

echo "[ci-setup] Applying Supabase CI config..."
cp supabase/config.ci.toml supabase/config.toml


echo "[ci-setup] Fetching latest Supabase CLI release…"

API_URL="https://api.github.com/repos/supabase/cli/releases/latest"
sudo apt-get install -y jq

# Use GITHUB_TOKEN if available to avoid rate limits
if [ -n "$GITHUB_TOKEN" ]; then
    TAG_NAME=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "$API_URL" | jq -r .tag_name)
else
    TAG_NAME=$(curl -s "$API_URL" | jq -r .tag_name)
fi

echo "[ci-setup]   tag_name = ${TAG_NAME}"

# Validate TAG_NAME is not null or empty
if [ -z "$TAG_NAME" ] || [ "$TAG_NAME" = "null" ]; then
    echo "[ERROR] Failed to fetch Supabase CLI version from GitHub API"
    echo "[ERROR] This may be due to API rate limiting. Trying fallback version..."
    # Fallback to a known working version
    TAG_NAME="v2.2.3"
fi

# Strip leading 'v' → "2.62.10"
VERSION="${TAG_NAME#v}"

DEB_NAME="supabase_${VERSION}_linux_amd64.deb"
DEB_URL="https://github.com/supabase/cli/releases/download/${TAG_NAME}/${DEB_NAME}"

echo "[ci-setup]   tag_name = ${TAG_NAME}"
echo "[ci-setup]   version  = ${VERSION}"
echo "[ci-setup]   url      = ${DEB_URL}"

curl -L -o "${DEB_NAME}" "${DEB_URL}"

sudo dpkg -i "${DEB_NAME}" || sudo apt-get -y -f install
supabase --version

# === Add Python toolcache bin ===
PY_BIN="${pythonLocation}/bin"
if [ -d "$PY_BIN" ]; then
    echo "$PY_BIN" >> $GITHUB_PATH
else
    echo "[WARN] Python bin directory missing: $PY_BIN"
fi

# === Add Supabase CLI bin ===
SUPABASE_CMD="$(command -v supabase || true)"
if [ -n "$SUPABASE_CMD" ]; then
    SUPABASE_DIR="$(dirname "$SUPABASE_CMD")"
    echo "$SUPABASE_DIR" >> $GITHUB_PATH
else
    echo "[ERROR] Supabase binary not found after install!"
    exit 1
fi

# load variables from supabase config into .env
mkdir -p temp
python3 scripts/supabase_config_loader.py
echo "[load-config] Loaded variables:"
cat .env

# Ensure GitHub-provided secrets are in .env so edge functions can read them
echo "[ci-setup] Writing GitHub secrets to .env..."
for secret in JWT_SECRET SUPABASE_SERVICE_ROLE_KEY SUPABASE_ANON_KEY; do
    value=$(eval echo \$$secret)
    if [ -n "$value" ]; then
        # Remove existing entry if present, then add new one
        sed -i "/^${secret}=/d" .env
        echo "${secret}=${value}" >> .env
        echo "[ci-setup] ${secret} written to .env"
    fi
done

# Propagate JWT_SECRET to subsequent workflow steps so generate_jwt() uses the
# same secret as the Edge Functions (which read it from .env).
if [ -n "$GITHUB_ENV" ]; then
    JWT_SECRET_VALUE=$(grep "^JWT_SECRET=" .env | cut -d'=' -f2-)
    if [ -n "$JWT_SECRET_VALUE" ]; then
        echo "JWT_SECRET=${JWT_SECRET_VALUE}" >> "$GITHUB_ENV"
        echo "[ci-setup] JWT_SECRET exported to GITHUB_ENV"
    fi
fi
