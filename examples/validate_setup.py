#!/usr/bin/env python
"""
Validate that your environment is set up correctly to run the example notebooks.

Usage:
    python examples/validate_setup.py
"""

import sys
import os


def check_python_version():
    """Check Python version."""
    print("Checking Python version...", end=" ")
    version = sys.version_info
    if version.major >= 3 and version.minor >= 8:
        print(f"✓ Python {version.major}.{version.minor}.{version.micro}")
        return True
    else:
        print(f"✗ Python {version.major}.{version.minor}.{version.micro} (need 3.8+)")
        return False


def check_package(package_name, import_name=None):
    """Check if a package is installed."""
    if import_name is None:
        import_name = package_name

    print(f"Checking {package_name}...", end=" ")
    try:
        __import__(import_name)
        print("✓")
        return True
    except ImportError:
        print("✗")
        return False


def check_environment_variable(var_name, required=True):
    """Check if an environment variable is set."""
    print(f"Checking {var_name}...", end=" ")
    value = os.getenv(var_name)
    if value:
        # Don't print the full token for security
        if 'TOKEN' in var_name:
            masked = value[:8] + "..." if len(value) > 8 else "***"
            print(f"✓ (set to {masked})")
        else:
            print(f"✓ (set to {value})")
        return True
    else:
        if required:
            print("✗ (not set)")
        else:
            print("⚠ (optional, not set)")
        return not required


def check_api_connection():
    """Check if we can connect to the API."""
    print("Checking API connection...", end=" ")

    url = os.getenv('KANKYOUKEN_URL')
    token = os.getenv('KANKYOUKEN_TOKEN')
    study_id = os.getenv('STUDY_ID')

    if not url or not token:
        print("⚠ (skipped - credentials not set)")
        return True

    try:
        from kankyouken import KanKyouKenClient

        client = KanKyouKenClient()

        # Try with study_id if available, otherwise just test connection
        if study_id:
            response = client.query_events(study_id=study_id, limit=1)
            print(f"✓ (found {response.pagination.total} total events in study)")
        else:
            # Test connection without querying (will likely fail, but we can catch it)
            print("⚠ (STUDY_ID not set, skipping data check)")
        return True
    except Exception as e:
        print(f"✗ ({str(e)})")
        return False


def main():
    """Run all validation checks."""
    print("=" * 60)
    print("KanKyouKen Examples - Environment Validation")
    print("=" * 60)
    print()

    results = []

    # Check Python version
    print("1. Python Environment")
    print("-" * 60)
    results.append(check_python_version())
    print()

    # Check required packages
    print("2. Required Packages")
    print("-" * 60)
    results.append(check_package("requests"))
    results.append(check_package("kankyouken"))
    results.append(check_package("pandas"))
    print()

    # Check optional packages
    print("3. Optional Packages (for notebooks)")
    print("-" * 60)
    check_package("jupyter")
    check_package("matplotlib")
    check_package("seaborn")
    check_package("plotly")
    check_package("sklearn", "sklearn")
    check_package("nbformat")
    check_package("nbconvert")
    print()

    # Check environment variables
    print("4. Environment Variables")
    print("-" * 60)
    results.append(check_environment_variable("KANKYOUKEN_URL"))
    results.append(check_environment_variable("KANKYOUKEN_TOKEN"))
    check_environment_variable("STUDY_ID", required=False)
    print()

    # Check API connection
    print("5. API Connection")
    print("-" * 60)
    results.append(check_api_connection())
    print()

    # Summary
    print("=" * 60)
    if all(results):
        print("✓ All required checks passed!")
        print()
        print("You're ready to run the example notebooks:")
        print("  jupyter notebook examples/")
        print()
        print("Or run the automated tests:")
        print("  pytest test/examples/test_notebooks.py -v")
        return 0
    else:
        print("✗ Some checks failed. Please fix the issues above.")
        print()
        print("Common fixes:")
        print()
        print("Install missing packages:")
        print("  pip install -e 'sdk[notebooks]'")
        print()
        print("Set environment variables:")
        print("  export KANKYOUKEN_URL='http://localhost:54321'")
        print("  export KANKYOUKEN_TOKEN='your-token-here'")
        print("  export STUDY_ID='your-study-id'")
        print()
        print("See examples/SETUP.md for detailed instructions.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
