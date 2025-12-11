# Set project root for scripts that rely on it
PROJECT_ROOT := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
export PROJECT_ROOT

RUNNING_CI ?= false

# Load environment variables from .env (if present)
ifneq (,$(wildcard .env))
-include .env
export $(shell grep -v '^#' .env | sed 's/=.*//' )
endif

export DB_PORT
export PROJECT_ID
export SUPABASE_API_PORT
export JWT_SECRET
export DB_URL=postgresql://postgres:postgres@127.0.0.1:$(DB_PORT)/postgres
LOCAL_DB_URL ?= $(DB_URL)
export LOCAL_DB_URL
export REMOTE_DB_URL

export PYTHONPATH := $(PROJECT_ROOT)


# File groups for normalization
ENV_FILES := .env test/.env scripts/run_tests.py

TEMP_DIR := $(PROJECT_ROOT)/temp
SCRIPT_DIR := $(PROJECT_ROOT)/scripts
SCHEMA_SCRIPTS := $(SCRIPT_DIR)/schema

# Ensure these targets always run
.PHONY: sanitize test lint format setup

# Normalize CRLF → LF (dos2unix)
sanitize:
	@echo "Sanitizing..."
	@for f in $$(find supabase/functions -type f -name "*.ts"; \
	             find test -type f -name "*.py"; \
	             echo $(ENV_FILES)); do \
		if [ -f "$$f" ]; then \
			dos2unix $$f 2>/dev/null || true; \
		fi; \
	done

clean:
	supabase stop || true
	docker rm -f $(docker ps -aq --filter "name=supabase") 2>/dev/null || true
	rm -rf supabase/.temp supabase/.branches


# Run Python tests
# Usage: make test                    # run all tests
#        make test TEST=path/to/test  # run specific test
TEST ?=
test: sanitize
	@if ! docker ps | grep -q supabase_db_${PROJECT_ID}; then \
		echo "Starting Supabase (auto)"; \
		make supabase-start; \
	fi
	@echo "Running Python tests..."
	@bash -o pipefail -c 'pytest $(TEST) --color=yes 2>&1 | tee temp/test-output.log'

# Quick test - single consent test for CI verification
test-quick-1:
	@if ! docker ps | grep -q supabase_db_${PROJECT_ID}; then \
		echo "Starting Supabase (auto)"; \
		make supabase-start; \
	fi
	@echo "Running quick test..."
	@pytest test/integration/supabase/functions/event_collector/test_event_collector.py::test_post_valid_event -xvs
# Quick test - single consent test for CI verification
test-quick-2:
	@if ! docker ps | grep -q supabase_db_${PROJECT_ID}; then \
		echo "Starting Supabase (auto)"; \
		make supabase-start; \
	fi
	@echo "Running quick test..."
	@pytest test/integration/supabase/functions/consent/test_consent.py::test_consent_get_requires_auth -xvs



# Lint
lint:
	@echo "Running linter..."
	@ruff check . --fix

# Install dependencies and copy authentication keys
setup:
	@echo "Installing Python dependencies..."
	@python -m pip install -r requirements.txt
	@echo "Starting Supabase..."
	@supabase stop || true
	@make supabase-start


# Database management
supabase-start:
	rm -rf supabase/.temp supabase/.branches || true
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
	@python $(SCHEMA_SCRIPTS)/snapshot_local_schema.py
	@cp temp/snapshots/schema_public_local.sql $(PROJECT_ROOT)/test/snapshots/schema_public.sql
	@echo "✅ Updated temp/snapshots/schema_public_local.sql"

# Run only schema parity tests
test-schema:
	@pytest -m schema

# Compare remote DB vs local schema (for manual / CI use)
# Requires REMOTE_DB_URL env var set
test-remote-schema:
	@REMOTE_DB_URL="$(REMOTE_DB_URL)" pytest -m "schema and remote"

checkparity:
	@python $(SCHEMA_SCRIPTS)/snapshot_local_schema.py

	@python $(SCHEMA_SCRIPTS)/snapshot_remote_schema.py
	@python $(SCHEMA_SCRIPTS)/normalize_schema_dump.py temp/snapshots/schema_public_local.sql temp/snapshots/schema_public_local_normalized.sql
	@python $(SCHEMA_SCRIPTS)/normalize_schema_dump.py temp/snapshots/schema_public_remote.sql temp/snapshots/schema_public_remote_normalized.sql
	@python $(SCHEMA_SCRIPTS)/diff_schemas.py

pushschema:
	ALLOW_REMOTE_SCHEMA_PUSH=true \
	python $(SCHEMA_SCRIPTS)/apply_schema_to_remote.py
