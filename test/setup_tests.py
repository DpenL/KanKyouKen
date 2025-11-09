import unittest
from test.utils.load_env import load_env

_sb_proc = None
_fn_proc = None

def setUpModule():
    """Global test setup – runs once before any test module."""
    load_env()

    global _sb_proc, _fn_proc
    _sb_proc = None
    _fn_proc = None


def tearDownModule():
    """Global teardown – runs once after all tests."""
    global _sb_proc, _fn_proc
