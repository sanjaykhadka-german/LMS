"""Playwright E2E tests for #statusFilter on /admin/assignments.

These exercise the real JS — change-event listener, DOM mutation,
display:none toggling — that the backend tests cannot cover.
"""
import pytest


def _visible_statuses(page):
    """Return the data-status of every row whose display is not 'none'."""
    return page.evaluate("""
        () => Array.from(document.querySelectorAll('#assignRows tr[data-status]'))
            .filter(tr => tr.style.display !== 'none')
            .map(tr => tr.dataset.status)
    """)


def _select_status(page, value):
    page.select_option("#statusFilter", value=value)


@pytest.mark.e2e
@pytest.mark.smoke
def test_assignments_page_renders_dropdown(logged_in_page, live_server):
    page = logged_in_page
    page.goto(f"{live_server}/admin/assignments")
    assert page.is_visible("#statusFilter")


@pytest.mark.e2e
@pytest.mark.sanity
def test_completed_filter_hides_other_rows(logged_in_page, live_server):
    page = logged_in_page
    page.goto(f"{live_server}/admin/assignments")
    _select_status(page, "Completed")
    assert _visible_statuses(page) == ["Completed"]


@pytest.mark.e2e
@pytest.mark.regression
@pytest.mark.parametrize("value,expected", [
    ("", ["Overdue", "In progress", "Completed"]),
    ("Overdue", ["Overdue"]),
    ("In progress", ["In progress"]),
    ("Completed", ["Completed"]),
])
def test_each_status_option_filters_correctly(
    logged_in_page, live_server, value, expected,
):
    page = logged_in_page
    page.goto(f"{live_server}/admin/assignments")
    _select_status(page, value)
    visible = _visible_statuses(page)
    assert sorted(visible) == sorted(expected)


@pytest.mark.e2e
@pytest.mark.regression
def test_filter_then_reset_restores_all_rows(logged_in_page, live_server):
    """Selecting a value then 'All' must re-show previously hidden rows.
    Catches a buggy filter that mutates rows instead of toggling display."""
    page = logged_in_page
    page.goto(f"{live_server}/admin/assignments")

    _select_status(page, "Overdue")
    assert _visible_statuses(page) == ["Overdue"]

    _select_status(page, "")
    assert sorted(_visible_statuses(page)) == [
        "Completed", "In progress", "Overdue",
    ]
