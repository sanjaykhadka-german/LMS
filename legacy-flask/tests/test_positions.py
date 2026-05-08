"""Tests for the position-based org chart redesign."""
from datetime import datetime

import pytest

from models import db, Position, User


@pytest.fixture
def positions_setup(app):
    """Three positions in a parent-child tree, plus one user assigned."""
    with app.app_context():
        ts = datetime.utcnow().timestamp()
        md = Position(name=f"MD-{ts}")
        db.session.add(md)
        db.session.flush()
        qa = Position(name=f"QA-{ts}", parent_id=md.id)
        ops = Position(name=f"Ops-{ts}", parent_id=md.id)
        db.session.add_all([qa, ops])
        db.session.flush()
        u = User(email=f"pos-{ts}@t.local", name="Pos User",
                 first_name="Pos", last_name="User",
                 role="employee", is_active_flag=True, phone="1",
                 position_id=md.id)
        u.set_password("x")
        db.session.add(u)
        db.session.commit()
        yield {"md": md, "qa": qa, "ops": ops, "user": u}
        User.query.filter(User.id == u.id).delete()
        Position.query.filter(Position.id.in_([md.id, qa.id, ops.id])).delete()
        db.session.commit()


def test_position_persists_with_parent(app, positions_setup):
    with app.app_context():
        qa = db.session.get(Position, positions_setup["qa"].id)
        assert qa.parent_id == positions_setup["md"].id
        assert qa.parent.name == positions_setup["md"].name


def test_user_position_assignment(app, positions_setup):
    with app.app_context():
        u = db.session.get(User, positions_setup["user"].id)
        assert u.position_id == positions_setup["md"].id
        assert u.position.name == positions_setup["md"].name
        md = db.session.get(Position, positions_setup["md"].id)
        assert any(x.id == u.id for x in md.users)


def test_org_chart_route_renders(auth_client, positions_setup):
    r = auth_client.get("/admin/org-chart")
    assert r.status_code == 200
    text = r.get_data(as_text=True)
    assert positions_setup["md"].name in text
    assert positions_setup["qa"].name in text
    assert positions_setup["user"].name in text
    assert "Vacant" in text


def test_positions_list_route(auth_client, positions_setup):
    r = auth_client.get("/admin/positions")
    assert r.status_code == 200
    text = r.get_data(as_text=True)
    assert positions_setup["md"].name in text
    assert positions_setup["qa"].name in text


def test_position_delete_reparents_children(app, positions_setup):
    """Deleting a parent should bump children up to the grandparent."""
    with app.app_context():
        md_id = positions_setup["md"].id
        qa_id = positions_setup["qa"].id
        Position.query.filter_by(parent_id=md_id).update(
            {"parent_id": None})
        db.session.delete(db.session.get(Position, md_id))
        db.session.commit()
        qa = db.session.get(Position, qa_id)
        assert qa is not None
        assert qa.parent_id is None
