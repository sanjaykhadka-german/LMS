"""Pytest fixtures for LMS dropdown-filter tests.

Test DB: a file-based SQLite at a temp path (not :memory: — the live-server
thread needs to read the same data the seed fixture wrote, and per-connection
in-memory SQLite would not share state).

Env vars are set BEFORE `app` is imported because Config reads them at class
definition time.
"""
import os
import tempfile
import threading
from datetime import datetime, timedelta

import pytest

_TEST_DB_PATH = os.path.join(
    tempfile.gettempdir(), f"lms_test_{os.getpid()}.db"
)
if os.path.exists(_TEST_DB_PATH):
    os.remove(_TEST_DB_PATH)

os.environ["DATABASE_URL"] = f"sqlite:///{_TEST_DB_PATH}"
os.environ["SECRET_KEY"] = "test-secret"
os.environ["RESEND_API_KEY"] = ""
os.environ["ADMIN_EMAIL"] = ""
os.environ["APP_BASE_URL"] = "http://127.0.0.1"

import email_service  # noqa: E402
from app import create_app  # noqa: E402
from models import (  # noqa: E402
    db, User, Module, Assignment, Attempt, Department,
)

ADMIN_EMAIL = "admin@test.local"
ADMIN_PASSWORD = "admin-pw-1234"


def _silence_emails(monkeypatch):
    for name in ("notify_invite", "notify_assignment", "notify_attempt",
                 "notify_reminder", "notify_password_reset", "send_email"):
        monkeypatch.setattr(email_service, name, lambda *a, **kw: True,
                            raising=False)


@pytest.fixture(scope="session")
def app():
    app = create_app()
    app.config["TESTING"] = True
    app.config["WTF_CSRF_ENABLED"] = False
    app.config["RESEND_API_KEY"] = ""
    yield app
    if os.path.exists(_TEST_DB_PATH):
        try:
            os.remove(_TEST_DB_PATH)
        except OSError:
            pass


@pytest.fixture(autouse=True)
def _no_emails(monkeypatch):
    _silence_emails(monkeypatch)


@pytest.fixture(scope="session")
def _seed(app):
    """Populate the DB once per session with deterministic rows.

    - 1 admin (logs in)
    - 3 employees
    - 2 modules
    - 3 assignments covering all three statuses (Overdue / In progress / Completed)
    - 2 attempts (one passed, one failed)
    """
    with app.app_context():
        existing_admin = User.query.filter_by(email=ADMIN_EMAIL).first()
        if existing_admin:
            return

        dept = Department(name="Butchery")
        db.session.add(dept)
        db.session.flush()

        admin = User(email=ADMIN_EMAIL, name="Test Admin", role="admin",
                     is_active_flag=True)
        admin.set_password(ADMIN_PASSWORD)

        emp_overdue = User(email="overdue@test.local", name="Overdue Emp",
                           role="employee", is_active_flag=True,
                           department_id=dept.id)
        emp_overdue.set_password("x")

        emp_inprog = User(email="inprog@test.local", name="InProgress Emp",
                          role="employee", is_active_flag=True,
                          department_id=dept.id)
        emp_inprog.set_password("x")

        emp_done = User(email="done@test.local", name="Completed Emp",
                        role="employee", is_active_flag=True,
                        department_id=dept.id)
        emp_done.set_password("x")

        emp_employee_login = User(
            email="employee@test.local", name="Plain Employee",
            role="employee", is_active_flag=True, department_id=dept.id,
        )
        emp_employee_login.set_password(ADMIN_PASSWORD)

        db.session.add_all([admin, emp_overdue, emp_inprog, emp_done,
                            emp_employee_login])
        db.session.flush()

        mod_a = Module(title="Knife safety", description="Sharp things",
                       is_published=True)
        mod_b = Module(title="Hand hygiene", description="Wash hands",
                       is_published=True)
        db.session.add_all([mod_a, mod_b])
        db.session.flush()

        now = datetime.utcnow()

        # Overdue: due_at in the past, no completed_at.
        a_overdue = Assignment(
            user_id=emp_overdue.id, module_id=mod_a.id,
            assigned_at=now - timedelta(days=200),
            due_at=now - timedelta(days=20),
            completed_at=None,
        )
        # In progress: due_at in the future, no completed_at.
        a_inprog = Assignment(
            user_id=emp_inprog.id, module_id=mod_a.id,
            assigned_at=now - timedelta(days=10),
            due_at=now + timedelta(days=170),
            completed_at=None,
        )
        # Completed: completed_at recent (so process_expired_completions
        # does not reset it on the GET).
        a_done = Assignment(
            user_id=emp_done.id, module_id=mod_b.id,
            assigned_at=now - timedelta(days=30),
            due_at=now + timedelta(days=150),
            completed_at=now - timedelta(days=5),
        )
        db.session.add_all([a_overdue, a_inprog, a_done])

        att_pass = Attempt(
            user_id=emp_done.id, module_id=mod_b.id,
            score=95, correct=19, total=20, passed=True,
            created_at=now - timedelta(days=5),
        )
        att_fail = Attempt(
            user_id=emp_inprog.id, module_id=mod_a.id,
            score=40, correct=8, total=20, passed=False,
            created_at=now - timedelta(days=2),
        )
        db.session.add_all([att_pass, att_fail])
        db.session.commit()


@pytest.fixture
def client(app, _seed):
    return app.test_client()


@pytest.fixture
def auth_client(client):
    """Test client logged in as the admin."""
    resp = client.post("/login", data={
        "email": ADMIN_EMAIL,
        "password": ADMIN_PASSWORD,
    }, follow_redirects=False)
    assert resp.status_code in (302, 303), (
        f"login failed: {resp.status_code} {resp.data[:200]!r}"
    )
    return client


@pytest.fixture
def employee_client(app, _seed):
    """Test client logged in as a non-admin employee (for 403 checks)."""
    c = app.test_client()
    resp = c.post("/login", data={
        "email": "employee@test.local",
        "password": ADMIN_PASSWORD,
    }, follow_redirects=False)
    assert resp.status_code in (302, 303)
    return c


# ----- Live server + Playwright fixtures (used only by e2e tests) -----

@pytest.fixture(scope="session")
def live_server(app, _seed):
    """Boot the Flask app on a random localhost port in a daemon thread."""
    from werkzeug.serving import make_server
    server = make_server("127.0.0.1", 0, app, threaded=True)
    port = server.server_port
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{port}"
    server.shutdown()
    thread.join(timeout=5)


@pytest.fixture(scope="session")
def browser():
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        b = p.chromium.launch(headless=True)
        yield b
        b.close()


@pytest.fixture
def logged_in_page(browser, live_server):
    """Fresh browser context, logged in as admin, navigated to /admin."""
    context = browser.new_context(base_url=live_server)
    page = context.new_page()
    page.goto(f"{live_server}/login")
    page.fill('input[name="email"]', ADMIN_EMAIL)
    page.fill('input[name="password"]', ADMIN_PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_load_state("networkidle")
    yield page
    context.close()
