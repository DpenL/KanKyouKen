"""
Schema tests for consent_templates, study_consent_config, study_script_config (KN-183, KN-188).
"""
import pytest
import uuid


@pytest.mark.integration
def test_consent_templates_table_exists(db_conn):
    cur = db_conn.cursor()
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'consent_templates'
        ORDER BY column_name
    """)
    columns = {row[0] for row in cur.fetchall()}
    cur.close()
    assert {"id", "name", "content_md", "version", "is_base", "language", "created_at"} <= columns


@pytest.mark.integration
def test_study_consent_config_table_exists(db_conn):
    cur = db_conn.cursor()
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'study_consent_config'
        ORDER BY column_name
    """)
    columns = {row[0] for row in cur.fetchall()}
    cur.close()
    assert {"study_id", "base_template_id", "custom_content_md", "requires_scroll"} <= columns


@pytest.mark.integration
def test_study_script_config_table_exists(db_conn):
    cur = db_conn.cursor()
    cur.execute("""
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'study_script_config'
        ORDER BY column_name
    """)
    columns = {row[0] for row in cur.fetchall()}
    cur.close()
    assert {"id", "study_id", "script_id", "enabled"} <= columns


@pytest.mark.integration
def test_consent_templates_unique_constraint(db_conn):
    """name + version + language must be unique."""
    cur = db_conn.cursor()
    template_id_1 = uuid.uuid4()
    template_id_2 = uuid.uuid4()
    cur.execute("""
        INSERT INTO public.consent_templates (id, name, content_md, version, language)
        VALUES (%s, 'Test Template', 'Content', '1.0', 'en')
    """, (template_id_1,))
    db_conn.commit()

    with pytest.raises(Exception, match="unique"):
        cur.execute("""
            INSERT INTO public.consent_templates (id, name, content_md, version, language)
            VALUES (%s, 'Test Template', 'Other content', '1.0', 'en')
        """, (template_id_2,))
        db_conn.commit()

    db_conn.rollback()
    cur.execute("DELETE FROM public.consent_templates WHERE id = %s", (template_id_1,))
    db_conn.commit()
    cur.close()


@pytest.mark.integration
def test_study_script_config_unique_constraint(db_conn):
    """study_id + script_id must be unique."""
    cur = db_conn.cursor()

    owner_id = "11111111-1111-1111-1111-111111111111"
    project_id = uuid.uuid4()
    study_id = uuid.uuid4()
    script_id = uuid.uuid4()

    cur.execute(
        "INSERT INTO public.projects (id, name, owner_id) VALUES (%s, 'ScriptCfg Project', %s)",
        (project_id, owner_id)
    )
    cur.execute(
        "INSERT INTO public.studies (id, name, project_id, owner_id) VALUES (%s, 'ScriptCfg Study', %s, %s)",
        (study_id, project_id, owner_id)
    )
    cur.execute("""
        INSERT INTO public.pipeline_scripts (id, name, script_type, endpoint_url, trigger_tables, writes_to_table)
        VALUES (%s, 'Test Script', 'analytics', '/functions/v1/test', ARRAY['events'], 'study_metrics')
    """, (script_id,))
    cur.execute(
        "INSERT INTO public.study_script_config (study_id, script_id, enabled) VALUES (%s, %s, true)",
        (study_id, script_id)
    )
    db_conn.commit()

    with pytest.raises(Exception, match="unique"):
        cur.execute(
            "INSERT INTO public.study_script_config (study_id, script_id, enabled) VALUES (%s, %s, false)",
            (study_id, script_id)
        )
        db_conn.commit()

    db_conn.rollback()
    cur.execute("DELETE FROM public.study_script_config WHERE study_id = %s", (study_id,))
    cur.execute("DELETE FROM public.pipeline_scripts WHERE id = %s", (script_id,))
    cur.execute("DELETE FROM public.studies WHERE id = %s", (study_id,))
    cur.execute("DELETE FROM public.projects WHERE id = %s", (project_id,))
    db_conn.commit()
    cur.close()


@pytest.mark.integration
def test_study_consent_config_cascade_delete(db_conn):
    """study_consent_config is deleted when the study is deleted."""
    cur = db_conn.cursor()
    owner_id = "11111111-1111-1111-1111-111111111111"
    project_id = uuid.uuid4()
    study_id = uuid.uuid4()

    cur.execute(
        "INSERT INTO public.projects (id, name, owner_id) VALUES (%s, 'Cascade Project', %s)",
        (project_id, owner_id)
    )
    cur.execute(
        "INSERT INTO public.studies (id, name, project_id, owner_id) VALUES (%s, 'Cascade Study', %s, %s)",
        (study_id, project_id, owner_id)
    )
    cur.execute(
        "INSERT INTO public.study_consent_config (study_id, requires_scroll) VALUES (%s, true)",
        (study_id,)
    )
    db_conn.commit()

    cur.execute("DELETE FROM public.studies WHERE id = %s", (study_id,))
    cur.execute("DELETE FROM public.projects WHERE id = %s", (project_id,))
    db_conn.commit()

    cur.execute(
        "SELECT COUNT(*) FROM public.study_consent_config WHERE study_id = %s", (study_id,)
    )
    assert cur.fetchone()[0] == 0
    cur.close()
