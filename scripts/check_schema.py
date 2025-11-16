import psycopg2, os

def check_tables():
    conn = psycopg2.connect(os.getenv("SUPABASE_DB_URL"))
    cur = conn.cursor()
    cur.execute("select table_name from information_schema.tables where table_schema='public'")
    tables = [r[0] for r in cur.fetchall()]
    expected = ["projects","studies","participants","sessions","events","event_schemas","audit_log"]
    missing = [t for t in expected if t not in tables]
    if missing:
        print("❌ Missing tables:", missing)
        exit(1)
    print("✅ All expected tables present.")
    cur.close()
    conn.close()

if __name__ == "__main__":
    check_tables()
