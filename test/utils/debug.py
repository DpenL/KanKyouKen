import os, base64, json, hashlib
from typing import Tuple

def _b64pad(s: str) -> str:
    return s + "=" * ((4 - len(s) % 4) % 4)

def short_hash(s: str) -> str:
    if s is None:
        return "<missing>"
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:12]

def decode_jwt_parts(token: str) -> Tuple[dict, dict]:
    """Decode JWT header/payload without verifying signature."""
    header_b64, payload_b64, *_ = token.split(".")
    header = json.loads(base64.urlsafe_b64decode(_b64pad(header_b64)))
    payload = json.loads(base64.urlsafe_b64decode(_b64pad(payload_b64)))
    return header, payload

def print_env_and_token_debug(token: str):
    print("\n=== DEBUG: ENV & TOKEN ===")
    for key in ["JWT_SECRET", "SB_LOCAL_JWT_SECRET", "SUPABASE_JWT_SECRET"]:
        v = os.getenv(key)
        print(f"{key}: present={bool(v)} sha256[:12]={short_hash(v)} len={len(v) if v else 0}")

    parts = token.split(".")
    print(f"token parts: {len(parts)} (should be 3)")
    print(f"token head: {parts[0][:8]}... tail: ...{parts[-1][-8:]} length={len(token)}")

    try:
        header, payload = decode_jwt_parts(token)
        print("header:", header)
        print("payload:", payload)
    except Exception as e:
        print("Failed to decode JWT header/payload (no verify):", repr(e))
    print("=== /DEBUG ===\n")
