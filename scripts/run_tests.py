import subprocess
import sys
import os
import time
import requests

def run_command(cmd, cwd=None, env=None):
    """Run a shell command and stream its output."""
    process = subprocess.Popen(cmd, cwd=cwd, env=env)
    process.wait()
    return process.returncode


def main():
    
    print("🧪 Running Python unit tests...")
    test_result = run_command(["python", "-m", "unittest", "discover", "-s", "test", "-p", "test_*.py", "-v"])

    if test_result != 0:
        print("❌ Tests failed.")
        sys.exit(test_result)
    else:
        print("✅ All tests passed!")


if __name__ == "__main__":
    main()
