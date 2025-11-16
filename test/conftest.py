import os
from pathlib import Path
from dotenv import load_dotenv

# Always load .env at the project root before any tests run
ROOT = Path(__file__).resolve().parents[1]
env_path = ROOT / ".env"

assert os.getenv("JWT_SECRET"), "JWT_SECRET is not loaded — ensure .env exists!"

if env_path.exists():
    load_dotenv(env_path)
