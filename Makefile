# Set project root for scripts that rely on it
PROJECT_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
export PROJECT_ROOT

# File groups for normalization
ENV_FILES := .env test/.env scripts/run_tests.py
SOURCE_FILES := $(shell find supabase/functions -type f -name "*.ts") \
                 $(shell find test -type f -name "*.py") \
                 $(ENV_FILES)

# Ensure these targets always run
.PHONY: sanitize test lint format setup

# Normalize CRLF → LF (dos2unix)
sanitize:
	@echo "Sanitizing..."
	@for f in $(SOURCE_FILES); do \
	  if [ -f "$$f" ]; then \
	    dos2unix $$f 2>/dev/null || true; \
	  fi \
	done

# Load environment variables from .env (if present)
ifneq (,$(wildcard .env))
  include .env
  export $(shell grep -v '^#' .env | sed 's/=.*//' )
endif

clean:
	supabase stop || true
	docker rm -f $(docker ps -aq --filter "name=supabase") 2>/dev/null || true
	rm -rf supabase/.temp supabase/.branches


# Run Python tests
test: sanitize
	@if ! docker ps | grep -q supabase_db_kankyouken; then \
		echo "Starting Supabase (auto)"; \
		make supabase-start; \
	fi
	@echo "Running Python tests..."
	@pytest

# Format code
format:
	@echo "Formatting Python code..."
	@black test

# Lint
lint:
	@echo "Running linter..."
	@flake8 test

# Install dependencies and copy authentication keys
setup:
	@echo "Installing Python dependencies..."
	@pip install -r requirements.txt
	@echo "Starting Supabase..."
	@supabase stop || true
	@make supabase-start


# Database management
supabase-start:
	supabase stop || true
	supabase start --ignore-health-check
	@bash ./scripts/wait_for_supabase.sh

.PHONY: check-migrations
check-migrations:
	@echo "🔎 Checking migration file order and timestamps..."
	@files=$$(ls -1 supabase/migrations | grep -E '^[0-9]{8,}__' | sort); \
	prev=""; \
	duplicates=0; \
	for f in $$files; do \
	  prefix=$$(echo $$f | cut -d'_' -f1); \
	  if [ "$$prefix" = "$$prev" ]; then \
	    echo "❌ Duplicate migration timestamp found: $$f"; \
	    duplicates=1; \
	  fi; \
	  prev=$$prefix; \
	done; \
	if [ $$duplicates -ne 0 ]; then \
	  echo "🚫 Duplicate timestamps detected. Fix before pushing."; \
	  exit 1; \
	fi; \
	echo "✅ Migration order looks consistent."; \
	echo "$$files" | awk '{print NR, $$0}'


# Prevent accidental remote migrations
IS_LINKED := $(shell supabase link status 2>/dev/null | grep -q 'Linked project' && echo yes || echo no)


# --- DB connection for local dev (Supabase default) ---
DB_URL ?= postgresql://postgres:postgres@127.0.0.1:54322/postgres

.PHONY: migrate seed snapshot-schema test-schema test-remote-schema

migrate: check-migrations
ifeq ($(IS_LINKED),yes)
	@echo "Project is linked! Refusing to apply local migrations to remote."
	@echo "   Use 'supabase db reset --linked' manually if you really intend to deploy."
	@exit 1
else
	@echo "Applying local migrations..."
	@supabase db reset --local --no-seed
	@echo "Running migrations..."
	@supabase db push --local
	@echo "✅ Local database reset and migrations applied."
endif

seed:
	@echo "Seeding database..."
	@psql "$(DB_URL)" -v ON_ERROR_STOP=1 -f supabase/seed.sql
	@echo "✅ Seed data applied."

# Generate / update canonical schema snapshot from local DB
snapshot-schema:
	@echo "Generating canonical schema snapshot from local DB..."
	@LOCAL_DB_URL="$(DB_URL)" python scripts/snapshot_local_schema.py
	@echo "✅ Updated test/snapshots/schema_public.sql"

# Run only schema parity tests
test-schema:
	@LOCAL_DB_URL="$(DB_URL)" pytest -m schema

# Compare remote DB vs local schema (for manual / CI use)
# Requires REMOTE_DB_URL env var set
test-remote-schema:
	@LOCAL_DB_URL="$(DB_URL)" REMOTE_DB_URL="$(REMOTE_DB_URL)" pytest -m "schema and remote"

