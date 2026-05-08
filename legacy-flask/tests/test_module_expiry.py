"""Tests for per-module training expiry: form round-trip, schema upgrade,
and process_expired_completions using each module's own validity window."""
from datetime import datetime, timedelta

from app import process_expired_completions
from models import db, Module, Assignment, User


def _make_module(title, valid_for_days):
    m = Module(title=title, description="", is_published=True,
               valid_for_days=valid_for_days)
    db.session.add(m)
    db.session.flush()
    return m


def test_module_form_create_with_blank_persists_null(auth_client, app):
    resp = auth_client.post("/admin/modules/new",
                            data={"title": "test_expiry_blank",
                                  "description": "x",
                                  "valid_for_days": ""},
                            follow_redirects=False)
    assert resp.status_code in (302, 303)
    with app.app_context():
        m = Module.query.filter_by(title="test_expiry_blank").first()
        assert m is not None
        assert m.valid_for_days is None


def test_module_form_create_with_zero_persists_zero(auth_client, app):
    resp = auth_client.post("/admin/modules/new",
                            data={"title": "test_expiry_zero",
                                  "description": "x",
                                  "valid_for_days": "0"},
                            follow_redirects=False)
    assert resp.status_code in (302, 303)
    with app.app_context():
        m = Module.query.filter_by(title="test_expiry_zero").first()
        assert m is not None
        assert m.valid_for_days == 0


def test_module_form_create_with_positive_persists(auth_client, app):
    resp = auth_client.post("/admin/modules/new",
                            data={"title": "test_expiry_30",
                                  "description": "x",
                                  "valid_for_days": "30"},
                            follow_redirects=False)
    assert resp.status_code in (302, 303)
    with app.app_context():
        m = Module.query.filter_by(title="test_expiry_30").first()
        assert m is not None
        assert m.valid_for_days == 30


def test_module_form_negative_rejected(auth_client, app):
    resp = auth_client.post("/admin/modules/new",
                            data={"title": "test_expiry_neg",
                                  "description": "x",
                                  "valid_for_days": "-5"},
                            follow_redirects=False)
    # Reject + redirect back, no module created.
    assert resp.status_code in (302, 303)
    with app.app_context():
        assert Module.query.filter_by(title="test_expiry_neg").first() is None


def test_module_inline_update_valid_for_days(auth_client, app):
    """The AI studio inline update endpoint accepts valid_for_days."""
    with app.app_context():
        m = _make_module("test_expiry_inline", None)
        db.session.commit()
        mid = m.id

    resp = auth_client.post(f"/admin/modules/{mid}/update",
                            json={"field": "valid_for_days", "value": "14"})
    assert resp.status_code == 200
    with app.app_context():
        m = db.session.get(Module, mid)
        assert m.valid_for_days == 14

    # Blank → None
    resp = auth_client.post(f"/admin/modules/{mid}/update",
                            json={"field": "valid_for_days", "value": ""})
    assert resp.status_code == 200
    with app.app_context():
        m = db.session.get(Module, mid)
        assert m.valid_for_days is None

    # Negative rejected
    resp = auth_client.post(f"/admin/modules/{mid}/update",
                            json={"field": "valid_for_days", "value": "-1"})
    assert resp.status_code == 400


def test_process_expired_completions_uses_per_module_days(auth_client, app):
    """Two modules with different valid_for_days expire on their own clocks.
    A 7-day module's 10-day-old completion resets; a 0-day (never-expires)
    module's 10-day-old completion does not."""
    with app.app_context():
        # A learner to attach assignments to. Reuse the seeded one.
        user = User.query.filter_by(email="overdue@test.local").first()
        assert user is not None

        m_short = _make_module("test_exp_short", 7)
        m_never = _make_module("test_exp_never", 0)
        db.session.flush()

        now = datetime.utcnow()
        ten_days_ago = now - timedelta(days=10)
        a_short = Assignment(
            user_id=user.id, module_id=m_short.id,
            assigned_at=ten_days_ago, due_at=ten_days_ago + timedelta(days=7),
            completed_at=ten_days_ago,
        )
        a_never = Assignment(
            user_id=user.id, module_id=m_never.id,
            assigned_at=ten_days_ago, due_at=None,
            completed_at=ten_days_ago,
        )
        db.session.add_all([a_short, a_never])
        db.session.commit()
        a_short_id, a_never_id = a_short.id, a_never.id

    # Run expiry sweep.
    with app.app_context(), app.test_request_context():
        process_expired_completions("http://localhost")

    with app.app_context():
        a_short_after = db.session.get(Assignment, a_short_id)
        a_never_after = db.session.get(Assignment, a_never_id)
        # Short-validity assignment was reset.
        assert a_short_after.completed_at is None
        # Never-expires assignment is untouched.
        assert a_never_after.completed_at is not None

        # Cleanup so other tests' state isn't affected.
        db.session.delete(a_short_after)
        db.session.delete(a_never_after)
        m_short = Module.query.filter_by(title="test_exp_short").first()
        m_never = Module.query.filter_by(title="test_exp_never").first()
        if m_short:
            db.session.delete(m_short)
        if m_never:
            db.session.delete(m_never)
        db.session.commit()
