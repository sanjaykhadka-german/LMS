"""Tests for Wave 3 — WHS register and reminder dedup."""
from datetime import datetime, timedelta

import pytest

from app import (
    process_whs_reminders, whs_status_for,
    WHS_REMINDER_COOLDOWN_DAYS, WHS_REMINDER_LOOKAHEAD_DAYS,
)
from models import db, User, WHSRecord


@pytest.fixture
def whs_user(app):
    """Create an isolated user + cleanup after the test."""
    with app.app_context():
        u = User(email=f"whs-{datetime.utcnow().timestamp()}@t.local",
                 name="WHS User", first_name="WHS", last_name="User",
                 role="employee", is_active_flag=True, phone="1")
        u.set_password("x")
        db.session.add(u)
        db.session.commit()
        yield u
        WHSRecord.query.filter_by(user_id=u.id).delete()
        db.session.delete(u)
        db.session.commit()


def test_status_overdue(app):
    with app.app_context():
        r = WHSRecord(kind="high_risk_licence", title="Forklift",
                      expires_on=(datetime.utcnow().date() - timedelta(days=5)))
        assert whs_status_for(r) == "overdue"


def test_status_expiring_soon(app):
    with app.app_context():
        r = WHSRecord(kind="high_risk_licence", title="Forklift",
                      expires_on=(datetime.utcnow().date() + timedelta(days=10)))
        assert whs_status_for(r) == "expiring_soon"


def test_status_current(app):
    with app.app_context():
        r = WHSRecord(kind="high_risk_licence", title="Forklift",
                      expires_on=(datetime.utcnow().date() + timedelta(days=200)))
        assert whs_status_for(r) == "current"


def test_status_incident_no_expiry(app):
    with app.app_context():
        r = WHSRecord(kind="incident", title="Slip",
                      expires_on=(datetime.utcnow().date() - timedelta(days=5)))
        # Incidents always 'no_expiry' regardless of any expires_on value.
        assert whs_status_for(r) == "no_expiry"


def test_reminder_skips_records_far_from_expiry(app, whs_user):
    """Records expiring beyond LOOKAHEAD shouldn't be reminded."""
    with app.app_context():
        far = WHSRecord(kind="high_risk_licence", title="Forklift",
                        user_id=whs_user.id,
                        expires_on=(datetime.utcnow().date()
                                    + timedelta(days=WHS_REMINDER_LOOKAHEAD_DAYS + 30)))
        db.session.add(far)
        db.session.commit()
        sent = process_whs_reminders("http://x")
        assert sent == 0
        # last_reminded_at should still be None
        db.session.refresh(far)
        assert far.last_reminded_at is None


def test_reminder_fires_for_expiring_record(app, whs_user):
    with app.app_context():
        soon = WHSRecord(kind="high_risk_licence", title="Forklift",
                         user_id=whs_user.id,
                         expires_on=(datetime.utcnow().date()
                                     + timedelta(days=10)))
        db.session.add(soon)
        db.session.commit()
        sent = process_whs_reminders("http://x")
        assert sent == 1
        db.session.refresh(soon)
        assert soon.last_reminded_at is not None


def test_reminder_dedup_within_cooldown(app, whs_user):
    """Calling process_whs_reminders twice in succession should only send
    once per record (cooldown of WHS_REMINDER_COOLDOWN_DAYS)."""
    with app.app_context():
        soon = WHSRecord(kind="high_risk_licence", title="Forklift",
                         user_id=whs_user.id,
                         expires_on=(datetime.utcnow().date()
                                     + timedelta(days=10)))
        db.session.add(soon)
        db.session.commit()
        first = process_whs_reminders("http://x")
        second = process_whs_reminders("http://x")
        assert first == 1
        assert second == 0


def test_reminder_force_ignores_cooldown(app, whs_user):
    with app.app_context():
        soon = WHSRecord(kind="high_risk_licence", title="Forklift",
                         user_id=whs_user.id,
                         expires_on=(datetime.utcnow().date()
                                     + timedelta(days=10)))
        db.session.add(soon)
        db.session.commit()
        process_whs_reminders("http://x")  # uses up the first window
        forced = process_whs_reminders("http://x", force=True)
        assert forced == 1


def test_reminder_skips_disabled_user(app):
    with app.app_context():
        u = User(email=f"whs-disabled-{datetime.utcnow().timestamp()}@t.local",
                 name="Disabled WHS", first_name="D", last_name="X",
                 role="employee", is_active_flag=False, phone="1")
        u.set_password("x")
        db.session.add(u)
        db.session.commit()
        try:
            r = WHSRecord(kind="high_risk_licence", title="Forklift",
                          user_id=u.id,
                          expires_on=(datetime.utcnow().date()
                                      + timedelta(days=10)))
            db.session.add(r)
            db.session.commit()
            sent = process_whs_reminders("http://x")
            assert sent == 0
        finally:
            WHSRecord.query.filter_by(user_id=u.id).delete()
            db.session.delete(u)
            db.session.commit()


def test_reminder_skips_incidents(app, whs_user):
    """Incidents have no expiry semantics — reminder sweep ignores them."""
    with app.app_context():
        inc = WHSRecord(kind="incident", title="Slip near cooler",
                        user_id=whs_user.id,
                        incident_date=datetime.utcnow().date(),
                        # Even if expires_on were accidentally set on an
                        # incident, process_whs_reminders excludes by kind.
                        expires_on=(datetime.utcnow().date()
                                    + timedelta(days=10)))
        db.session.add(inc)
        db.session.commit()
        sent = process_whs_reminders("http://x")
        assert sent == 0
