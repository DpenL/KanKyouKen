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

echo "[ci-setup] Installing fsrs..."
$PYTHON -m pip install "fsrs>=1.0.0"

echo "[ci-setup] Applying Supabase CI config..."
cp supabase/config.ci.toml supabase/config.toml

# Supabase CLI is installed by supabase/setup-cli@v1 action before this script runs.

# === Add Python toolcache bin ===
PY_BIN="${pythonLocation}/bin"
if [ -d "$PY_BIN" ]; then
    echo "$PY_BIN" >> $GITHUB_PATH
else
    echo "[WARN] Python bin directory missing: $PY_BIN"
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
# Commented out: load_env fixture in test/conftest.py already loads from .env;
# re-enable if tests still fail with "signature verification failed".
#if [ -n "$GITHUB_ENV" ]; then
#    JWT_SECRET_VALUE=$(grep "^JWT_SECRET=" .env | cut -d'=' -f2-)
#    if [ -n "$JWT_SECRET_VALUE" ]; then
#        echo "JWT_SECRET=${JWT_SECRET_VALUE}" >> "$GITHUB_ENV"
#        echo "[ci-setup] JWT_SECRET exported to GITHUB_ENV"
#    fi
#fi
