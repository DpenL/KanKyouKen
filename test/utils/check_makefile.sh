#!/usr/bin/env bash
set -euo pipefail

FILE="Makefile"

echo "🔍 Checking Makefile for CI-breaking issues..."
echo "------------------------------------------------"

if [ ! -f "$FILE" ]; then
    echo "❌ No Makefile found"
    exit 1
fi

echo "📄 Showing first 10 lines with visible characters:"
sed -n '1,10p' "$FILE" | cat -A
echo "------------------------------------------------"

echo "🔎 Checking for leading TABs outside recipes..."
grep -n $'\t' "$FILE" | awk '!($1 ~ /^[^:]+:[[:space:]]*?\t@\S/)'
echo "------------------------------------------------"

echo "❎ Checking for CRLF line endings..."
if file "$FILE" | grep -q "CRLF"; then
    echo "❌ CRLF detected"
else
    echo "✅ No CRLF found"
fi
echo "------------------------------------------------"

echo "🔎 Checking for UTF-8 BOM on first line..."
if head -c3 "$FILE" | xxd -p | grep -q "efbbbf"; then
    echo "❌ BOM detected on first line"
else
    echo "✅ No BOM found"
fi
echo "------------------------------------------------"

echo "🔎 Checking for trailing whitespace (backslash-space bug)..."
if git diff --check "$FILE" >/dev/null 2>&1; then
    :
else
    git diff --check "$FILE"
fi
echo "------------------------------------------------"

echo "🔎 Try running GNU make in CI-mode (strict):"
make --warn --debug=b -n 2>&1 | head -20 || true
echo "------------------------------------------------"

echo "✅ Done."
