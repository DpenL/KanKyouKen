# Set project root for scripts that rely on it
PROJECT_ROOT := $(shell pwd)
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
	@echo "Running Python tests..."
	@python scripts/run_tests.py

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
	supabase stop || true
	supabase start
