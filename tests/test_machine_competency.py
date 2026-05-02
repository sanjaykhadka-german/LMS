"""Tests for Wave 4.3 — Machine ↔ Module competency."""
from datetime import datetime, timedelta

import pytest

from app import user_machine_competencies
from models import db, User, Module, Machine, Attempt


@pytest.fixture
def comp_setup(app):
    """Create a user with one machine linked to two modules. Cleanup after."""
    with app.app_context():
        ts = datetime.utcnow().timestamp()
        u = User(email=f"comp-{ts}@t.local", name="Comp User",
                 first_name="Comp", last_name="User",
                 role="employee", is_active_flag=True, phone="1")
        u.set_password("x")
        m1 = Module(title=f"CompModA-{ts}", is_published=True,
                    valid_for_days=180)
        m2 = Module(title=f"CompModB-{ts}", is_published=True,
                    valid_for_days=180)
        db.session.add_all([u, m1, m2])
        db.session.flush()
        machine = Machine(name=f"CompMachine-{ts}")
        machine.modules = [m1, m2]
        u.machines = [machine]
        db.session.add(machine)
        db.session.commit()
        yield {"user": u, "machine": machine, "m1": m1, "m2": m2}
        Attempt.query.filter_by(user_id=u.id).delete()
        u.machines = []
        machine.modules = []
        db.session.commit()
        db.session.delete(machine)
        db.session.delete(u)
        db.session.delete(m1)
        db.session.delete(m2)
        db.session.commit()


def test_pending_when_no_passes(app, comp_setup):
    with app.app_context():
        u = db.session.get(User, comp_setup["user"].id)
        comps = user_machine_competencies(u)
        assert len(comps) == 1
        assert comps[0]["overall"] == "pending"


def test_partial_when_some_passes(app, comp_setup):
    with app.app_context():
        u = db.session.get(User, comp_setup["user"].id)
        m1 = comp_setup["m1"]
        db.session.add(Attempt(user_id=u.id, module_id=m1.id,
                               score=95, correct=19, total=20, passed=True))
        db.session.commit()
        comps = user_machine_competencies(u)
        assert comps[0]["overall"] == "partial"


def test_qualified_when_all_passes(app, comp_setup):
    with app.app_context():
        u = db.session.get(User, comp_setup["user"].id)
        for mod_key in ("m1", "m2"):
            db.session.add(Attempt(user_id=u.id,
                                   module_id=comp_setup[mod_key].id,
                                   score=95, correct=19, total=20, passed=True))
        db.session.commit()
        comps = user_machine_competencies(u)
        assert comps[0]["overall"] == "qualified"


def test_qualified_degrades_when_pass_expires(app, comp_setup):
    """A pass older than module.valid_for_days should no longer count as
    'current', dropping qualified -> partial."""
    with app.app_context():
        u = db.session.get(User, comp_setup["user"].id)
        # m1 was passed long ago (valid_for_days=180; pass 200 days back)
        old = datetime.utcnow() - timedelta(days=200)
        db.session.add(Attempt(user_id=u.id, module_id=comp_setup["m1"].id,
                               score=95, correct=19, total=20, passed=True,
                               created_at=old))
        # m2 passed recently
        db.session.add(Attempt(user_id=u.id, module_id=comp_setup["m2"].id,
                               score=95, correct=19, total=20, passed=True))
        db.session.commit()
        comps = user_machine_competencies(u)
        # m1 expired -> partial, not qualified
        assert comps[0]["overall"] == "partial"


def test_no_modules_means_no_training_required(app, comp_setup):
    """A machine with no linked modules is automatically 'no_training_required'."""
    with app.app_context():
        # Re-fetch inside this session so relationship writes get tracked.
        machine = db.session.get(Machine, comp_setup["machine"].id)
        machine.modules = []
        db.session.commit()
        u = db.session.get(User, comp_setup["user"].id)
        comps = user_machine_competencies(u)
        assert comps[0]["overall"] == "no_training_required"
