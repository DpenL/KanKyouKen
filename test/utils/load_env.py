import os
from pathlib import Path
from dotenv import dotenv_values, load_dotenv

def load_env():
    """Forcefully load .env into os.environ."""
    project_root = os.getenv("PROJECT_ROOT")
    if not project_root:
        print("[load_env] ⚠️ PROJECT_ROOT not set; using current directory")
        project_root = Path(__file__).resolve().parents[2]

    env_path = Path(project_root) / ".env"

    env_vars = dotenv_values(env_path)
    for key, value in env_vars.items():
        if key not in os.environ:
            os.environ[key] = value or ""

    secret = os.getenv("JWT_SECRET") or os.getenv("GOTRUE_JWT_SECRET")
    print(f"[load_env] ✅ Loaded .env ({len(env_vars)} vars), JWT_SECRET present={bool(secret)}")
