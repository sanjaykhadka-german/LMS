"""Backend tests for the #statusFilter dropdown on /admin/assignments.

These verify the *server-rendered* HTML — the actual hide/show JS is
exercised by the e2e suite. Backend tests run fast (no browser) and catch
template-data regressions like a missing `data-status` attribute or a
renamed option value.
"""
import re

import pytest
from bs4 import BeautifulSoup

EXPECTED_STATUS_OPTIONS = ["", "Overdue", "In progress", "Completed"]


@pytest.mark.backend
@pytest.mark.smoke
def test_assignments_page_loads(auth_client):
    resp = auth_client.get("/admin/assignments")
    assert resp.status_code == 200


@pytest.mark.backend
@pytest.mark.smoke
def test_status_filter_dropdown_present(auth_client):
    resp = auth_client.get("/admin/assignments")
    html = resp.data.decode()
    soup = BeautifulSoup(html, "html.parser")

    select = soup.find("select", id="statusFilter")
    assert select is not None, "missing <select id='statusFilter'>"

    option_values = [opt.get("value", "") for opt in select.find_all("option")]
    assert option_values == EXPECTED_STATUS_OPTIONS, (
        f"option values changed: got {option_values}, "
        f"expected {EXPECTED_STATUS_OPTIONS}"
    )


@pytest.mark.backend
@pytest.mark.sanity
def test_seed_renders_one_row_per_status(auth_client):
    resp = auth_client.get("/admin/assignments")
    soup = BeautifulSoup(resp.data, "html.parser")
    rows = soup.select("#assignRows tr[data-status]")
    statuses = [r.get("data-status") for r in rows]

    assert statuses.count("Overdue") == 1
    assert statuses.count("In progress") == 1
    assert statuses.count("Completed") == 1


@pytest.mark.backend
@pytest.mark.regression
def test_unauthenticated_redirects_to_login(client):
    resp = client.get("/admin/assignments", follow_redirects=False)
    assert resp.status_code in (301, 302, 303)
    assert "/login" in resp.headers.get("Location", "")


@pytest.mark.backend
@pytest.mark.regression
def test_employee_role_is_forbidden(employee_client):
    resp = employee_client.get("/admin/assignments", follow_redirects=False)
    # author_required raises 403 for authenticated non-author users.
    assert resp.status_code == 403


@pytest.mark.backend
@pytest.mark.regression
def test_status_filter_js_handler_wired(auth_client):
    """Guards against accidental removal of the change listener."""
    resp = auth_client.get("/admin/assignments")
    html = resp.data.decode()
    assert "statusFilter.addEventListener('change'" in html, (
        "JS handler that drives the filter is missing — "
        "the dropdown would render but do nothing."
    )
    # The handler reads tr[data-status]. If that selector changes,
    # the filter silently breaks.
    assert re.search(r"tr\[data-status\]", html), (
        "JS no longer reads tr[data-status]"
    )
