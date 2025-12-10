#!/usr/bin/env python3
"""Extract SERVICE_ROLE_KEY from supabase status and update .env file."""
import json
import subprocess
import sys

def main():
    try:
        # Get service role key from supabase status
        result = subprocess.run(
            ['supabase', 'status', '--output', 'json'],
            capture_output=True,
            text=True,
            check=True
        )

        status_data = json.loads(result.stdout)
        service_key = status_data.get('SERVICE_ROLE_KEY')

        if not service_key:
            print("ERROR: SERVICE_ROLE_KEY not found in supabase status", file=sys.stderr)
            sys.exit(1)

        # Update .env with local service role key
        lines = []
        with open('.env', 'r') as f:
            for line in f:
                if line.startswith('SUPABASE_SERVICE_ROLE_KEY=') or line.startswith('SERVICE_KEY='):
                    key_name = line.split('=')[0]
                    lines.append(f'{key_name}={service_key}\n')
                else:
                    lines.append(line)

        with open('.env', 'w') as f:
            f.writelines(lines)

        print(f'Updated SERVICE_ROLE_KEY: {service_key[:40]}...')

    except subprocess.CalledProcessError as e:
        print(f"ERROR: Failed to get supabase status: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
