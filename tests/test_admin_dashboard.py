"""Smoke tests for the analytics-rich admin dashboard."""
from datetime import datetime, timedelta


def test_dashboard_renders_default(auth_client):
    resp = auth_client.get("/admin")
    assert resp.status_code == 200
    body = resp.data.decode()
    assert 'id="chartTimeseries"' in body
    assert 'id="chartStatus"' in body
    assert 'id="chartByModule"' in body
    assert 'id="chartByDept"' in body
    assert "Top 5 learners" in body
    assert "Modules needing attention" in body


def test_dashboard_filter_by_dept(auth_client):
    # Butchery is the only seeded department
    resp = auth_client.get("/admin?dept=1")
    assert resp.status_code == 200


def test_dashboard_filter_by_module(auth_client):
    resp = auth_client.get("/admin?module=1")
    assert resp.status_code == 200


def test_dashboard_empty_window(auth_client):
    # No attempts existed in 2010 — dashboard must still render
    resp = auth_client.get("/admin?from=2010-01-01&to=2010-12-31")
    assert resp.status_code == 200
    body = resp.data.decode()
    # KPI section should still render with zero values
    assert "Pass rate" in body
    assert "Active learners" in body


def test_dashboard_invalid_dates_fall_back(auth_client):
    resp = auth_client.get("/admin?from=not-a-date&to=also-not")
    assert resp.status_code == 200


def test_dashboard_swapped_dates_swap_back(auth_client):
    today = datetime.utcnow().date()
    earlier = (today - timedelta(days=10)).isoformat()
    later = today.isoformat()
    # User accidentally puts later in 'from' and earlier in 'to' — handler
    # swaps them rather than returning an empty window.
    resp = auth_client.get(f"/admin?from={later}&to={earlier}")
    assert resp.status_code == 200


def test_dashboard_blocks_employee(employee_client):
    resp = employee_client.get("/admin", follow_redirects=False)
    # @admin_required should 403 (or redirect) for non-admins
    assert resp.status_code in (302, 303, 403)
