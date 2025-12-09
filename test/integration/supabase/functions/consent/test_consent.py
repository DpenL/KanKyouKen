import pytest
import requests
import os
import psycopg2
import psycopg2.extras
import uuid
from datetime import datetime

psycopg2.extras.register_uuid()

FUNCTION_NAME = "consent"


@pytest.fixture
def test_data(db_conn):
    """Create test data: project, study, participant, consent record"""
    cur = db_conn.cursor()

    owner_id = "11111111-1111-1111-1111-111111111111"
    researcher_id = "22222222-2222-2222-2222-222222222222"

    project_id = uuid.uuid4()
    study_id = uuid.uuid4()
    participant_id = uuid.uuid4()
    consent_id = uuid.uuid4()

    cur.execute("""
        INSERT INTO public.projects (id, name, owner_id)
        VALUES (%s, 'Test Project', %s)
        RETURNING id
    """, (project_id, owner_id))
    project_id = cur.fetchone()[0]

    cur.execute("""
        INSERT INTO public.studies (id, name, project_id, owner_id)
        VALUES (%s, 'Test Study', %s, %s)
        RETURNING id
    """, (study_id, project_id, owner_id))
    study_id = cur.fetchone()[0]

    cur.execute("""
        INSERT INTO public.participants (id, pseudonym)
        VALUES (%s, %s)
        RETURNING id
    """, (participant_id, f'participant_{uuid.uuid4().hex[:8]}'))
    participant_id = cur.fetchone()[0]

    cur.execute("""
        INSERT INTO public.consent_records (
            id, participant_id, study_id, consent_version, consent_status, granted_at
        ) VALUES (%s, %s, %s, 'v1.0', 'granted', %s)
    """, (
        consent_id,
        participant_id,
        study_id,
        datetime.now()
    ))

    cur.execute("""
        INSERT INTO public.study_roles (user_id, study_id, role, granted_by)
        VALUES (%s, %s, 'researcher', %s)
    """, (researcher_id, study_id, owner_id))

    db_conn.commit()
    cur.close()

    data = {
        "owner_id": owner_id,
        "researcher_id": researcher_id,
        "project_id": project_id,
        "study_id": study_id,
        "participant_id": participant_id,
        "consent_id": consent_id,
    }

    yield data

    # Cleanup: delete test data
    cur = db_conn.cursor()
    cur.execute("DELETE FROM public.consent_records WHERE id = %s", (data["consent_id"],))
    cur.execute("DELETE FROM public.study_roles WHERE user_id = %s", (researcher_id,))
    cur.execute("DELETE FROM public.participants WHERE id = %s", (data["participant_id"],))
    cur.execute("DELETE FROM public.studies WHERE id = %s", (data["study_id"],))
    cur.execute("DELETE FROM public.projects WHERE id = %s", (data["project_id"],))
    db_conn.commit()
    cur.close()


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_get_requires_auth():
    """GET /consent requires authorization"""
    base_url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54321")
    resp = requests.get(
        f"{base_url}/functions/v1/consent",
        params={"study_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}
    )
    assert resp.status_code == 401


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_get_returns_study_consents(test_data, owner_token):
    """GET /consent returns consent records for accessible study"""
    base_url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54321")

    resp = requests.get(
        f"{base_url}/functions/v1/consent",
        params={"study_id": test_data["study_id"]},
        headers={"Authorization": f"Bearer {owner_token}"}
    )

    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert data[0]["participant_id"] == str(test_data["participant_id"])
    assert data[0]["consent_status"] == "granted"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_get_filters_by_participant(test_data, owner_token):
    """GET /consent can filter by participant_id"""
    base_url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54321")

    resp = requests.get(
        f"{base_url}/functions/v1/consent",
        params={
            "study_id": test_data["study_id"],
            "participant_id": test_data["participant_id"]
        },
        headers={"Authorization": f"Bearer {owner_token}"}
    )

    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["participant_id"] == str(test_data["participant_id"])


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_get_denies_unauthorized_study(test_data, unauthorized_token):
    """GET /consent denies access to studies user doesn't have access to"""
    base_url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54321")

    resp = requests.get(
        f"{base_url}/functions/v1/consent",
        params={"study_id": test_data["study_id"]},
        headers={"Authorization": f"Bearer {unauthorized_token}"}
    )

    assert resp.status_code == 403


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_withdraw_updates_record(test_data, owner_token, db_conn):
    """PUT /consent withdraws consent and updates status"""
    base_url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54321")

    resp = requests.put(
        f"{base_url}/functions/v1/consent",
        json={
            "participant_id": str(test_data["participant_id"]),
            "study_id": str(test_data["study_id"])
        },
        headers={"Authorization": f"Bearer {owner_token}"}
    )

    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["record"]["consent_status"] == "withdrawn"
    assert data["record"]["withdrawn_at"] is not None

    cur = db_conn.cursor()
    cur.execute("""
        SELECT consent_status, withdrawn_at
        FROM public.consent_records
        WHERE id = %s
    """, (test_data["consent_id"],))
    row = cur.fetchone()
    assert row[0] == "withdrawn"
    assert row[1] is not None
    cur.close()


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_withdraw_denies_unauthorized(test_data, unauthorized_token):
    """PUT /consent denies withdrawal for unauthorized users"""
    base_url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54321")

    resp = requests.put(
        f"{base_url}/functions/v1/consent",
        json={
            "participant_id": str(test_data["participant_id"]),
            "study_id": str(test_data["study_id"])
        },
        headers={"Authorization": f"Bearer {unauthorized_token}"}
    )

    assert resp.status_code == 403


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_withdraw_requires_granted_status(test_data, owner_token, db_conn):
    """PUT /consent only withdraws consent with 'granted' status"""
    cur = db_conn.cursor()
    cur.execute("""
        UPDATE public.consent_records
        SET consent_status = 'pending'
        WHERE id = %s
    """, (test_data["consent_id"],))
    db_conn.commit()
    cur.close()

    base_url = os.getenv("SUPABASE_URL", "http://127.0.0.1:54321")

    resp = requests.put(
        f"{base_url}/functions/v1/consent",
        json={
            "participant_id": str(test_data["participant_id"]),
            "study_id": str(test_data["study_id"])
        },
        headers={"Authorization": f"Bearer {owner_token}"}
    )

    assert resp.status_code == 404
