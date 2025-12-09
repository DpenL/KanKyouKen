import pytest
import psycopg2
import os
from test.utils.gen_jwt import generate_jwt

FUNCTION_NAME = "consent"


@pytest.fixture(scope="module")
def owner_token():
    """JWT token for study owner"""
    return generate_jwt(sub="11111111-1111-1111-1111-111111111111")


@pytest.fixture(scope="module")
def researcher_token():
    """JWT token for researcher with role assignment"""
    return generate_jwt(sub="22222222-2222-2222-2222-222222222222")


@pytest.fixture(scope="module")
def unauthorized_token():
    """JWT token for user without access"""
    return generate_jwt(sub="99999999-9999-9999-9999-999999999999")
