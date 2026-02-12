#!/usr/bin/env python3
"""Generate a JWT token for SDK usage"""
import os
import sys
import subprocess
from pathlib import Path

# Add project root to path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

# Load environment
from dotenv import load_dotenv
load_dotenv(project_root / ".env")

# Import JWT generator
sys.path.insert(0, str(project_root / "test"))
from test.utils.gen_jwt import generate_jwt

# Get an owner ID from the database
result = subprocess.run(
    ["psql", "postgresql://postgres:postgres@127.0.0.1:54322/postgres", "-t", "-c",
     "SELECT owner_id FROM public.projects LIMIT 1;"],
    capture_output=True, text=True
)
owner_id = result.stdout.strip()

# Generate token (capturing all output including debug prints)
import io
from contextlib import redirect_stdout

output_capture = io.StringIO()
with redirect_stdout(output_capture):
    token = generate_jwt(sub=owner_id, role="authenticated")

# Filter out debug lines (lines starting with "JWT:")
# The actual token is the last non-debug line
all_output = output_capture.getvalue()
lines = [line for line in all_output.strip().split('\n') if not line.startswith('JWT:')]
actual_token = lines[-1] if lines else token

# Print only the token
print(actual_token)
