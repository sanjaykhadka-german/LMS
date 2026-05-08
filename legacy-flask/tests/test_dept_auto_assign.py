"""Tests for Wave 2.2 — DepartmentModulePolicy and auto_assign_for_department.

Covers:
- Helper is a no-op when the user has no department.
- Helper is a no-op when the user's department has no policy.
- Helper creates Assignment rows for policy modules the user lacks.
- Helper is idempotent (running it twice doesn't duplicate).
- Unpublished modules are skipped.
"""
from datetime import datetime

import pytest

from app import auto_assign_for_department
from models import (
    db, User, Module, Department, Employer, Assignment,
    DepartmentModulePolicy,
)


@pytest.fixture
def fresh_dept(app):
    """Create a fresh department and user for each test, isolated from the
    session-scoped seed fixture."""
    with app.app_context():
        d = Department(name=f"AutoAssignTest-{datetime.utcnow().timestamp()}")
        db.session.add(d)
        db.session.flush()

        u = User(email=f"auto-{datetime.utcnow().timestamp()}@t.local",
                 name="Auto Test", first_name="Auto", last_name="Test",
                 role="employee", is_active_flag=True,
                 department_id=d.id, phone="123")
        u.set_password("x")
        db.session.add(u)
        db.session.commit()
        yield {"dept": d, "user": u}
        # Cleanup: remove the rows we created
        Assignment.query.filter_by(user_id=u.id).delete()
        DepartmentModulePolicy.query.filter_by(department_id=d.id).delete()
        db.session.delete(u)
        db.session.delete(d)
        db.session.commit()


def test_no_department_returns_zero(app):
    with app.app_context():
        u = User(email=f"nodept-{datetime.utcnow().timestamp()}@t.local",
                 name="No Dept", first_name="No", last_name="Dept",
                 role="employee", is_active_flag=True,
                 department_id=None, phone="1")
        u.set_password("x")
        db.session.add(u)
        db.session.commit()
        try:
            assert auto_assign_for_department(u) == 0
        finally:
            db.session.delete(u)
            db.session.commit()


def test_no_policy_returns_zero(app, fresh_dept):
    with app.app_context():
        u = fresh_dept["user"]
        assert auto_assign_for_department(u) == 0
        assert Assignment.query.filter_by(user_id=u.id).count() == 0


def test_assigns_policy_modules(app, fresh_dept):
    with app.app_context():
        d = fresh_dept["dept"]
        u = fresh_dept["user"]
        m1 = Module(title=f"AutoMod1-{d.id}", is_published=True,
                    valid_for_days=180)
        m2 = Module(title=f"AutoMod2-{d.id}", is_published=True,
                    valid_for_days=180)
        db.session.add_all([m1, m2])
        db.session.flush()
        db.session.add_all([
            DepartmentModulePolicy(department_id=d.id, module_id=m1.id),
            DepartmentModulePolicy(department_id=d.id, module_id=m2.id),
        ])
        db.session.commit()

        n = auto_assign_for_department(u, send_email=False)
        assert n == 2
        assigned = {a.module_id for a in
                    Assignment.query.filter_by(user_id=u.id).all()}
        assert assigned == {m1.id, m2.id}

        # Cleanup
        Assignment.query.filter_by(user_id=u.id).delete()
        DepartmentModulePolicy.query.filter_by(department_id=d.id).delete()
        db.session.delete(m1)
        db.session.delete(m2)
        db.session.commit()


def test_idempotent(app, fresh_dept):
    with app.app_context():
        d = fresh_dept["dept"]
        u = fresh_dept["user"]
        m = Module(title=f"AutoIdem-{d.id}", is_published=True,
                   valid_for_days=180)
        db.session.add(m)
        db.session.flush()
        db.session.add(DepartmentModulePolicy(department_id=d.id,
                                              module_id=m.id))
        db.session.commit()

        first = auto_assign_for_department(u, send_email=False)
        second = auto_assign_for_department(u, send_email=False)
        assert first == 1
        assert second == 0
        assert Assignment.query.filter_by(user_id=u.id).count() == 1

        # Cleanup
        Assignment.query.filter_by(user_id=u.id).delete()
        DepartmentModulePolicy.query.filter_by(department_id=d.id).delete()
        db.session.delete(m)
        db.session.commit()


def test_skips_unpublished_modules(app, fresh_dept):
    with app.app_context():
        d = fresh_dept["dept"]
        u = fresh_dept["user"]
        m_pub = Module(title=f"Pub-{d.id}", is_published=True,
                       valid_for_days=180)
        m_draft = Module(title=f"Draft-{d.id}", is_published=False,
                         valid_for_days=180)
        db.session.add_all([m_pub, m_draft])
        db.session.flush()
        db.session.add_all([
            DepartmentModulePolicy(department_id=d.id, module_id=m_pub.id),
            DepartmentModulePolicy(department_id=d.id, module_id=m_draft.id),
        ])
        db.session.commit()

        n = auto_assign_for_department(u, send_email=False)
        assert n == 1
        assigned = {a.module_id for a in
                    Assignment.query.filter_by(user_id=u.id).all()}
        assert assigned == {m_pub.id}

        # Cleanup
        Assignment.query.filter_by(user_id=u.id).delete()
        DepartmentModulePolicy.query.filter_by(department_id=d.id).delete()
        db.session.delete(m_pub)
        db.session.delete(m_draft)
        db.session.commit()
