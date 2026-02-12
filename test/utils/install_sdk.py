"""Utility for installing the SDK package in tests"""
import os
import subprocess
from pathlib import Path


def install_sdk_package():
    """
    Install the SDK package in editable mode.

    Returns:
        bool: True if installation succeeded, False otherwise
        str: Error message if installation failed, None otherwise
    """
    # Check if SDK is already installed
    try:
        import kankyouken
        # SDK already installed, skip
        print("\n✅ KanKyouKen SDK already installed")
        return True, None
    except ImportError:
        pass

    # Use PROJECT_ROOT env var if available, otherwise calculate from file path
    project_root = os.getenv("PROJECT_ROOT")
    if project_root:
        sdk_path = Path(project_root) / "sdk"
    else:
        # Fallback: calculate relative to this file (test/utils/install_sdk.py -> sdk/)
        sdk_path = Path(__file__).parent.parent.parent / "sdk"

    print(f"\n📦 Installing KanKyouKen SDK from {sdk_path}...")

    # Run without capturing output to avoid buffer issues
    result = subprocess.run(
        ["pip", "install", "-q", "-e", str(sdk_path)],
    )

    if result.returncode != 0:
        error_msg = f"SDK installation failed with exit code {result.returncode}"
        print(f"❌ {error_msg}")
        return False, error_msg

    print("✅ SDK installed successfully")
    return True, None
