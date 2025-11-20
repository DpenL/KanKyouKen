import jwt, datetime, os, hashlib

def get_secret():
    keys = [
    "JWT_SECRET",
    "SB_LOCAL_JWT_SECRET",
    "SUPABASE_JWT_SECRET",
    "SUPABASE_INTERNAL_JWT_SECRET",
    ]

    for k in keys:
        v = os.getenv(k)
        if v: return v
    return "sb_secret_fallback_for_tests"

def generate_jwt(sub="test-user", role="authenticated", hours_valid=2):
    secret = get_secret()
    payload = {
        "sub": sub,
        "role": role,
        "aud": role,
        "iat": datetime.datetime.now(datetime.UTC),
        "exp": datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=hours_valid),
    }
    return jwt.encode(payload, secret, algorithm="HS256")
