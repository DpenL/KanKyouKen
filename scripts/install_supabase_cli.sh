#!/usr/bin/env bash
# Installs the latest Supabase CLI on Ubuntu.
# Shared by setup_ci_environment.sh and the frontend E2E workflow.
set -euo pipefail

echo "[supabase-cli] Installing jq..."
sudo apt-get update -y -q
sudo apt-get install -y -q jq

echo "[supabase-cli] Fetching latest release tag..."
API_URL="https://api.github.com/repos/supabase/cli/releases/latest"

if [ -n "${GITHUB_TOKEN:-}" ]; then
    TAG_NAME=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "$API_URL" | jq -r .tag_name)
else
    TAG_NAME=$(curl -s "$API_URL" | jq -r .tag_name)
fi

if [ -z "$TAG_NAME" ] || [ "$TAG_NAME" = "null" ]; then
    echo "[supabase-cli] GitHub API failed, falling back to v2.2.3"
    TAG_NAME="v2.2.3"
fi

VERSION="${TAG_NAME#v}"
DEB_NAME="supabase_${VERSION}_linux_amd64.deb"
DEB_URL="https://github.com/supabase/cli/releases/download/${TAG_NAME}/${DEB_NAME}"

echo "[supabase-cli] Installing ${TAG_NAME}..."
curl -fsSL -o "${DEB_NAME}" "${DEB_URL}"
sudo dpkg -i "${DEB_NAME}" || sudo apt-get -y -f install
supabase --version

# Add to GITHUB_PATH so subsequent steps can find it
SUPABASE_CMD="$(command -v supabase || true)"
if [ -n "$SUPABASE_CMD" ]; then
    echo "$(dirname "$SUPABASE_CMD")" >> "$GITHUB_PATH"
else
    echo "[ERROR] Supabase binary not found after install"
    exit 1
fi
