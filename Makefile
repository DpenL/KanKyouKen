PROJECT_ROOT := $(shell pwd)
export PROJECT_ROOT

# export environment variables
include .env
export $(shell sed 's/=.*//' .env)

.PHONY: test lint format setup

# Run Python tests
test:
	@echo "Running Python tests..."
	@python scripts/run_tests.py

# Format code
format:
	@echo "Formatting Python code..."
	@black test

# Install dependencies
setup:
	@echo "Installing Python dependencies..."
	@pip install -r requirements.txt

lint:
	@flake8 test
