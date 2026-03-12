import pytest
import requests
import uuid
from test.utils.gen_jwt import generate_jwt

FUNCTION_NAME = "audit-export"


@pytest.fixture(scope="module")
def supervisor_token():
    return generate_jwt(sub="11111111-1111-1111-1111-111111111111")


@pytest.fixture(scope="module")
def researcher_token():
    return generate_jwt(sub="22222222-2222-2222-2222-222222222222")


@pytest.fixture(scope="module")
def unauthorized_token():
    return generate_jwt(sub="99999999-9999-9999-9999-999999999999")


@pytest.fixture
def audit_study(db_conn):
    """Project + study + supervisor role + some audit log entries."""
    cur = db_conn.cursor()
    owner_id = "11111111-1111-1111-1111-111111111111"
    researcher_id = "22222222-2222-2222-2222-222222222222"

    project_id = uuid.uuid4()
    study_id = uuid.uuid4()

    cur.execute(
        "INSERT INTO public.projects (id, name, owner_id) VALUES (%s, 'Audit Test Project', %s)",
        (project_id, owner_id)
    )
    cur.execute(
        "INSERT INTO public.studies (id, name, project_id, owner_id) VALUES (%s, 'Audit Study', %s, %s)",
        (study_id, project_id, owner_id)
    )
    # owner_id already gets 'owner' role via study_owner_role_on_insert trigger (owner > supervisor)
    cur.execute(
        "INSERT INTO public.study_roles (user_id, study_id, role, granted_by) VALUES (%s, %s, 'researcher', %s)",
        (researcher_id, study_id, owner_id)
    )

    # Seed some audit log entries for this study
    for action in ("consent_granted", "participant_data_deleted"):
        cur.execute(
            "INSERT INTO public.audit_log (user_id, action, target) VALUES (%s, %s, %s)",
            (owner_id, action, f"participant:aaa:study:{study_id}")
        )

    db_conn.commit()
    cur.close()

    yield {"owner_id": owner_id, "researcher_id": researcher_id, "project_id": project_id, "study_id": study_id}

    cur = db_conn.cursor()
    cur.execute("DELETE FROM public.audit_log WHERE target LIKE %s", (f"%study:{study_id}%",))
    cur.execute("DELETE FROM public.study_roles WHERE study_id = %s", (study_id,))
    cur.execute("DELETE FROM public.studies WHERE id = %s", (study_id,))
    cur.execute("DELETE FROM public.projects WHERE id = %s", (project_id,))
    db_conn.commit()
    cur.close()


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_audit_export_requires_auth(audit_study, function_base_url):
    resp = requests.get(
        f"{function_base_url}{FUNCTION_NAME}",
        params={"study_id": str(audit_study["study_id"])}
    )
    assert resp.status_code == 401


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_audit_export_requires_supervisor(audit_study, researcher_token, function_base_url):
    """Researcher role (below supervisor) is denied."""
    resp = requests.get(
        f"{function_base_url}{FUNCTION_NAME}",
        params={"study_id": str(audit_study["study_id"])},
        headers={"Authorization": f"Bearer {researcher_token}"}
    )
    assert resp.status_code == 403


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_audit_export_csv(audit_study, supervisor_token, function_base_url):
    """Supervisor can export audit log as CSV."""
    resp = requests.get(
        f"{function_base_url}{FUNCTION_NAME}",
        params={"study_id": str(audit_study["study_id"]), "format": "csv"},
        headers={"Authorization": f"Bearer {supervisor_token}"}
    )
    assert resp.status_code == 200
    assert "text/csv" in resp.headers.get("Content-Type", "")
    lines = resp.text.strip().splitlines()
    assert lines[0] == "id,user_id,action,target,timestamp"
    assert len(lines) >= 3  # header + at least 2 seeded entries


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_audit_export_json(audit_study, supervisor_token, function_base_url):
    """Supervisor can export audit log as JSON."""
    resp = requests.get(
        f"{function_base_url}{FUNCTION_NAME}",
        params={"study_id": str(audit_study["study_id"]), "format": "json"},
        headers={"Authorization": f"Bearer {supervisor_token}"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "logs" in data
    assert data["study_id"] == str(audit_study["study_id"])
    assert len(data["logs"]) >= 2


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_audit_export_missing_study_id(supervisor_token, function_base_url):
    resp = requests.get(
        f"{function_base_url}{FUNCTION_NAME}",
        headers={"Authorization": f"Bearer {supervisor_token}"}
    )
    assert resp.status_code == 400


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_audit_export_invalid_format(audit_study, supervisor_token, function_base_url):
    resp = requests.get(
        f"{function_base_url}{FUNCTION_NAME}",
        params={"study_id": str(audit_study["study_id"]), "format": "xml"},
        headers={"Authorization": f"Bearer {supervisor_token}"}
    )
    assert resp.status_code == 400


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_audit_export_denies_unauthorized(audit_study, unauthorized_token, function_base_url):
    resp = requests.get(
        f"{function_base_url}{FUNCTION_NAME}",
        params={"study_id": str(audit_study["study_id"])},
        headers={"Authorization": f"Bearer {unauthorized_token}"}
    )
    assert resp.status_code == 403
