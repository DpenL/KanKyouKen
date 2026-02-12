"""Fixtures for SDK unit tests"""
import pytest
from test.utils.install_sdk import install_sdk_package


@pytest.fixture(scope="session", autouse=True)
def install_sdk():
    """
    Install the SDK package before running SDK unit tests.

    This fixture runs once per test session and only when SDK tests are collected.
    If the SDK fails to build, only SDK tests will fail (not the entire test suite).
    """
    success, error = install_sdk_package()
    if not success:
        pytest.fail(error)
