import pytest
import requests
import psycopg2
import psycopg2.extras
import uuid
from datetime import datetime

psycopg2.extras.register_uuid()

FUNCTION_NAME = "consent"


@pytest.fixture
def test_data(db_conn):
    """Create test data: project, study, participant, granted consent record"""
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
    """, (consent_id, participant_id, study_id, datetime.now()))

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

    cur = db_conn.cursor()
    cur.execute("DELETE FROM public.consent_records WHERE study_id = %s", (data["study_id"],))
    cur.execute("DELETE FROM public.study_roles WHERE user_id = %s", (researcher_id,))
    cur.execute("DELETE FROM public.participants WHERE id = %s", (data["participant_id"],))
    cur.execute("DELETE FROM public.studies WHERE id = %s", (data["study_id"],))
    cur.execute("DELETE FROM public.projects WHERE id = %s", (data["project_id"],))
    db_conn.commit()
    cur.close()


@pytest.fixture
def fresh_participant(db_conn):
    """A participant with no consent record yet, for submit tests."""
    cur = db_conn.cursor()
    participant_id = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.participants (id, pseudonym)
        VALUES (%s, %s) RETURNING id
    """, (participant_id, f'fresh_{uuid.uuid4().hex[:8]}'))
    participant_id = cur.fetchone()[0]
    db_conn.commit()
    cur.close()

    yield participant_id

    cur = db_conn.cursor()
    cur.execute("DELETE FROM public.consent_records WHERE participant_id = %s", (participant_id,))
    cur.execute("DELETE FROM public.participants WHERE id = %s", (participant_id,))
    db_conn.commit()
    cur.close()


# ── GET ───────────────────────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_get_requires_auth(function_base_url):
    resp = requests.get(
        f"{function_base_url}{FUNCTION_NAME}",
        params={"study_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"}
    )
    assert resp.status_code == 401


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_get_returns_study_consents(test_data, owner_token, function_base_url):
    resp = requests.get(
        f"{function_base_url}{FUNCTION_NAME}",
        params={"study_id": test_data["study_id"]},
        headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)
    assert any(r["participant_id"] == str(test_data["participant_id"]) for r in data)
    assert data[0]["consent_status"] == "granted"


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_get_filters_by_participant(test_data, owner_token, function_base_url):
    resp = requests.get(
        f"{function_base_url}{FUNCTION_NAME}",
        params={"study_id": test_data["study_id"], "participant_id": test_data["participant_id"]},
        headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["participant_id"] == str(test_data["participant_id"])


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_get_denies_unauthorized_study(test_data, unauthorized_token, function_base_url):
    resp = requests.get(
        f"{function_base_url}{FUNCTION_NAME}",
        params={"study_id": test_data["study_id"]},
        headers={"Authorization": f"Bearer {unauthorized_token}"}
    )
    assert resp.status_code == 403


# ── POST (submit) ─────────────────────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_submit_records_consent(test_data, fresh_participant, db_conn, unauthorized_token, function_base_url):
    """POST /consent records consent — any valid JWT works (participant-facing, no study access needed)."""
    resp = requests.post(
        f"{function_base_url}{FUNCTION_NAME}",
        json={
            "participant_id": str(fresh_participant),
            "study_id": str(test_data["study_id"]),
            "consent_version": "v1.0",
        },
        headers={"Authorization": f"Bearer {unauthorized_token}"},
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data["success"] is True
    assert data["record"]["consent_status"] == "granted"
    assert data["record"]["granted_at"] is not None

    # Verify in DB
    cur = db_conn.cursor()
    cur.execute("""
        SELECT consent_status, metadata
        FROM public.consent_records
        WHERE participant_id = %s AND study_id = %s
    """, (fresh_participant, test_data["study_id"]))
    row = cur.fetchone()
    cur.close()
    assert row is not None
    assert row[0] == "granted"
    assert "ip" in row[1]


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_submit_missing_fields(test_data, unauthorized_token, function_base_url):
    """POST /consent returns 400 when required fields are missing."""
    resp = requests.post(
        f"{function_base_url}{FUNCTION_NAME}",
        json={"participant_id": str(test_data["participant_id"])},
        headers={"Authorization": f"Bearer {unauthorized_token}"},
    )
    assert resp.status_code == 400


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_submit_duplicate_returns_conflict(test_data, unauthorized_token, function_base_url):
    """POST /consent returns 409 when consent already exists."""
    resp = requests.post(
        f"{function_base_url}{FUNCTION_NAME}",
        json={
            "participant_id": str(test_data["participant_id"]),
            "study_id": str(test_data["study_id"]),
            "consent_version": "v1.0",
        },
        headers={"Authorization": f"Bearer {unauthorized_token}"},
    )
    assert resp.status_code == 409


# ── DELETE (withdraw + cascade) ───────────────────────────────────────────────

@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_withdraw_updates_record(test_data, owner_token, db_conn, function_base_url):
    """DELETE /consent withdraws consent and updates status."""
    resp = requests.delete(
        f"{function_base_url}{FUNCTION_NAME}",
        json={
            "participant_id": str(test_data["participant_id"]),
            "study_id": str(test_data["study_id"]),
        },
        headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["record"]["consent_status"] == "withdrawn"
    assert data["record"]["withdrawn_at"] is not None

    cur = db_conn.cursor()
    cur.execute(
        "SELECT consent_status, withdrawn_at FROM public.consent_records WHERE id = %s",
        (test_data["consent_id"],)
    )
    row = cur.fetchone()
    cur.close()
    assert row[0] == "withdrawn"
    assert row[1] is not None


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_withdraw_cascade_deletes_data(test_data, owner_token, db_conn, function_base_url):
    """DELETE /consent removes events and sessions for the participant."""
    cur = db_conn.cursor()
    event_id = uuid.uuid4()
    session_id = uuid.uuid4()

    cur.execute("""
        INSERT INTO public.sessions (id, participant_id, study_id, started_at)
        VALUES (%s, %s, %s, now())
    """, (session_id, test_data["participant_id"], test_data["study_id"]))

    cur.execute("""
        INSERT INTO public.events (id, participant_id, study_id, session_id, event_type, payload, ts)
        VALUES (%s, %s, %s, %s, 'test_event', '{}', now())
    """, (event_id, test_data["participant_id"], test_data["study_id"], session_id))
    db_conn.commit()
    cur.close()

    resp = requests.delete(
        f"{function_base_url}{FUNCTION_NAME}",
        json={
            "participant_id": str(test_data["participant_id"]),
            "study_id": str(test_data["study_id"]),
        },
        headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert resp.status_code == 200

    cur = db_conn.cursor()
    cur.execute("SELECT COUNT(*) FROM public.events WHERE id = %s", (event_id,))
    assert cur.fetchone()[0] == 0

    cur.execute("SELECT COUNT(*) FROM public.sessions WHERE id = %s", (session_id,))
    assert cur.fetchone()[0] == 0

    # Audit log must NOT be deleted
    cur.execute(
        "SELECT COUNT(*) FROM public.audit_log WHERE action = 'participant_data_deleted' AND target LIKE %s",
        (f"%participant:{test_data['participant_id']}%",)
    )
    assert cur.fetchone()[0] >= 1
    cur.close()


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_withdraw_requires_auth(test_data, function_base_url):
    """DELETE /consent requires authorization."""
    resp = requests.delete(
        f"{function_base_url}{FUNCTION_NAME}",
        json={
            "participant_id": str(test_data["participant_id"]),
            "study_id": str(test_data["study_id"]),
        }
    )
    assert resp.status_code == 401


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_withdraw_denies_unauthorized(test_data, unauthorized_token, function_base_url):
    """DELETE /consent denies withdrawal for users without study access."""
    resp = requests.delete(
        f"{function_base_url}{FUNCTION_NAME}",
        json={
            "participant_id": str(test_data["participant_id"]),
            "study_id": str(test_data["study_id"]),
        },
        headers={"Authorization": f"Bearer {unauthorized_token}"}
    )
    assert resp.status_code == 403


@pytest.mark.integration
@pytest.mark.usefixtures("function_runtime")
def test_consent_withdraw_404_if_not_granted(test_data, owner_token, db_conn, function_base_url):
    """DELETE /consent returns 404 when no granted consent exists."""
    cur = db_conn.cursor()
    cur.execute(
        "UPDATE public.consent_records SET consent_status = 'pending' WHERE id = %s",
        (test_data["consent_id"],)
    )
    db_conn.commit()
    cur.close()

    resp = requests.delete(
        f"{function_base_url}{FUNCTION_NAME}",
        json={
            "participant_id": str(test_data["participant_id"]),
            "study_id": str(test_data["study_id"]),
        },
        headers={"Authorization": f"Bearer {owner_token}"}
    )
    assert resp.status_code == 404
