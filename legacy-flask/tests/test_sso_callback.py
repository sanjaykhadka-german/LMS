"""Phase 2 SSO bridge: tests for /sso/callback."""
import time
import uuid

import jwt
import pytest

from models import db, User


SECRET = "test-sso-secret-do-not-use-in-prod"
ALLOWED_TENANT = "00000000-0000-0000-0000-000000000001"
OTHER_TENANT = "00000000-0000-0000-0000-000000000002"


@pytest.fixture
def sso_app(app):
    prev_secret = app.config.get("LMS_SSO_SECRET", "")
    prev_tenant = app.config.get("LMS_ALLOWED_TENANT_ID", "")
    app.config["LMS_SSO_SECRET"] = SECRET
    app.config["LMS_ALLOWED_TENANT_ID"] = ALLOWED_TENANT
    yield app
    app.config["LMS_SSO_SECRET"] = prev_secret
    app.config["LMS_ALLOWED_TENANT_ID"] = prev_tenant


@pytest.fixture
def sso_client(sso_app, _seed):
    return sso_app.test_client()


def _make_token(secret=SECRET, tenant_id=ALLOWED_TENANT,
                tenant_status="active", sub=None,
                email="newperson@example.com", name="New Person",
                aud="flask-lms", iss="tracey", exp_offset=60):
    now = int(time.time())
    payload = {
        "iss": iss, "aud": aud,
        "iat": now, "exp": now + exp_offset,
        "jti": str(uuid.uuid4()),
        "sub": sub or str(uuid.uuid4()),
        "email": email, "name": name,
        "tenant_id": tenant_id,
        "tenant_slug": "german-butchery",
        "tenant_status": tenant_status,
        "role": "owner",
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def test_auto_provisions_new_user(sso_client, sso_app):
    sub = str(uuid.uuid4())
    token = _make_token(sub=sub, email="newuser@example.com", name="New User")
    resp = sso_client.post("/sso/callback", data={"token": token})
    assert resp.status_code == 302
    assert "/login" not in resp.headers["Location"]
    with sso_app.app_context():
        u = User.query.filter_by(email="newuser@example.com").first()
        assert u is not None
        assert u.role == "employee"
        assert u.is_active_flag is True
        assert u.tracey_user_id == sub
        assert u.tracey_tenant_id == ALLOWED_TENANT
        assert u.first_name == "New"
        assert u.last_name == "User"


def test_links_existing_user_by_email(sso_client, sso_app):
    """A pre-existing Flask user should be matched by email and linked, not
    duplicated, on first SSO."""
    sub = str(uuid.uuid4())
    with sso_app.app_context():
        existing = User.query.filter_by(email="overdue@test.local").first()
        assert existing is not None
    token = _make_token(sub=sub, email="overdue@test.local", name="Overdue Emp")
    resp = sso_client.post("/sso/callback", data={"token": token})
    assert resp.status_code == 302
    with sso_app.app_context():
        rows = User.query.filter_by(email="overdue@test.local").all()
        assert len(rows) == 1
        assert rows[0].tracey_user_id == sub
        assert rows[0].tracey_tenant_id == ALLOWED_TENANT


def test_returning_user_logs_in(sso_client, sso_app):
    """A user already linked by tracey_user_id takes the fast path."""
    sub = str(uuid.uuid4())
    with sso_app.app_context():
        u = User(email="returning@test.local", name="Returning Emp",
                 first_name="Returning", last_name="Emp",
                 role="employee", is_active_flag=True,
                 tracey_user_id=sub, tracey_tenant_id=ALLOWED_TENANT)
        u.set_password("x")
        db.session.add(u)
        db.session.commit()
    token = _make_token(sub=sub, email="returning@test.local",
                        name="Returning Emp")
    resp = sso_client.post("/sso/callback", data={"token": token})
    assert resp.status_code == 302
    assert "/login" not in resp.headers["Location"]


def test_expired_token_redirects_to_login(sso_client):
    token = _make_token(exp_offset=-3600)
    resp = sso_client.post("/sso/callback", data={"token": token})
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


def test_wrong_audience_redirects_to_login(sso_client):
    token = _make_token(aud="someone-else")
    resp = sso_client.post("/sso/callback", data={"token": token})
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


def test_bad_signature_redirects_to_login(sso_client):
    token = _make_token(secret="not-the-real-secret")
    resp = sso_client.post("/sso/callback", data={"token": token})
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


def test_wrong_tenant_redirects_to_login(sso_client):
    token = _make_token(tenant_id=OTHER_TENANT)
    resp = sso_client.post("/sso/callback", data={"token": token})
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]


def test_canceled_subscription_redirects_to_login(sso_client):
    token = _make_token(tenant_status="canceled",
                        email="canceled@example.com")
    resp = sso_client.post("/sso/callback", data={"token": token})
    assert resp.status_code == 302
    assert "/login" in resp.headers["Location"]
    with sso_client.application.app_context():
        # Must NOT auto-provision when the gate fails.
        assert User.query.filter_by(email="canceled@example.com").first() is None


def test_past_due_subscription_allowed(sso_client, sso_app):
    """Billing hiccups don't cut off training access."""
    token = _make_token(tenant_status="past_due",
                        email="pastdue@example.com",
                        name="Past Due")
    resp = sso_client.post("/sso/callback", data={"token": token})
    assert resp.status_code == 302
    assert "/login" not in resp.headers["Location"]
    with sso_app.app_context():
        assert User.query.filter_by(email="pastdue@example.com").first() is not None


def test_missing_secret_503s(sso_client, sso_app):
    sso_app.config["LMS_SSO_SECRET"] = ""
    token = _make_token()
    resp = sso_client.post("/sso/callback", data={"token": token})
    assert resp.status_code == 503


def test_missing_token_field_400s(sso_client):
    resp = sso_client.post("/sso/callback", data={})
    assert resp.status_code == 400
