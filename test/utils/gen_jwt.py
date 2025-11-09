from test.utils.load_env import load_env
import jwt, datetime, os, subprocess, hashlib


__cached_secret = None

def get_supabase_jwt_secret():
    """Auto-discover Supabase Auth JWT secret used by the local gateway."""
    global __cached_secret
    if __cached_secret:
        return __cached_secret

    # Environment overrides for CI / production
    for key in ["JWT_SECRET", "SUPABASE_JWT_SECRET", "SB_LOCAL_JWT_SECRET"]:
        val = os.getenv(key)
        if val:
            print(f"[gen_jwt] Using {key} sha256[:12]={hashlib.sha256(val.encode()).hexdigest()[:12]}")
            __cached_secret = val
            return val

    # Try finding the running auth container
    try:
        containers = subprocess.check_output(["docker", "ps", "--format", "{{.Names}}"], text=True).splitlines()
        for name in containers:
            if "auth" in name:  # match supabase-auth or projectname-auth-1
                try:
                    secret = subprocess.check_output(["docker", "exec", name, "printenv", "JWT_SECRET"], text=True).strip()
                    if secret:
                        print(f"[gen_jwt] Found JWT_SECRET in {name} (sha256[:12]={hashlib.sha256(secret.encode()).hexdigest()[:12]})")
                        __cached_secret = secret
                        return secret
                except subprocess.CalledProcessError:
                    continue
    except Exception as e:
        print(f"[gen_jwt] ⚠️ Could not detect Auth container: {e}")

    print("[gen_jwt] ⚠️ No valid JWT secret found; using fallback")
    __cached_secret = "sb_secret_fallback_for_tests"
    return __cached_secret


def generate_jwt(sub="test-user", role="authenticated", hours_valid=2):
    secret = get_supabase_jwt_secret()
    print("[TEST] JWT_SECRET hash:", hashlib.sha256(secret.encode()).hexdigest()[:12])

    payload = {
        "sub": sub,
        "role": role,
        "aud": role,
        "iat": datetime.datetime.now(datetime.UTC),
        "exp": datetime.datetime.now(datetime.UTC) + datetime.timedelta(hours=hours_valid),
    }
    token = jwt.encode(payload, secret, algorithm="HS256")
    print(f"[gen_jwt] Generated token len={len(token)} parts={len(token.split('.'))}")
    return token
if __name__ == "__main__":
    print("Generated JWT:", generate_jwt())
