"""Playwright E2E tests for the result dropdown on /admin/register."""
import pytest


def _visible_results(page):
    return page.evaluate("""
        () => Array.from(document.querySelectorAll('#register-rows tr[data-result]'))
            .filter(tr => tr.style.display !== 'none')
            .map(tr => tr.dataset.result)
    """)


def _empty_state_visible(page):
    return page.evaluate("""
        () => {
            const el = document.getElementById('register-empty');
            if (!el) return false;
            return getComputedStyle(el).display !== 'none';
        }
    """)


def _select_result(page, value):
    page.select_option('select[data-filter="result"]', value=value)


@pytest.mark.e2e
@pytest.mark.smoke
def test_register_page_renders_dropdown(logged_in_page, live_server):
    page = logged_in_page
    page.goto(f"{live_server}/admin/register")
    assert page.is_visible('select[data-filter="result"]')


@pytest.mark.e2e
@pytest.mark.sanity
def test_passed_filter_hides_failed(logged_in_page, live_server):
    page = logged_in_page
    page.goto(f"{live_server}/admin/register")
    _select_result(page, "passed")
    assert _visible_results(page) == ["passed"]
    assert not _empty_state_visible(page)


@pytest.mark.e2e
@pytest.mark.regression
@pytest.mark.parametrize("value,expected", [
    ("", ["passed", "failed"]),
    ("passed", ["passed"]),
    ("failed", ["failed"]),
])
def test_each_result_option_filters_correctly(
    logged_in_page, live_server, value, expected,
):
    page = logged_in_page
    page.goto(f"{live_server}/admin/register")
    _select_result(page, value)
    assert sorted(_visible_results(page)) == sorted(expected)


@pytest.mark.e2e
@pytest.mark.regression
def test_no_match_shows_empty_state(logged_in_page, live_server):
    """Combining result=passed with score=0 (no row matches) must reveal
    the #register-empty placeholder (register.html:119)."""
    page = logged_in_page
    page.goto(f"{live_server}/admin/register")

    _select_result(page, "passed")
    page.fill('input[data-filter="score"]', "0")
    # The score filter listens on input — give the handler a tick.
    page.wait_for_function("""
        () => document.getElementById('register-empty').style.display === 'block'
    """, timeout=2000)
    assert _empty_state_visible(page)
    assert _visible_results(page) == []


@pytest.mark.e2e
@pytest.mark.regression
def test_clear_filters_restores_rows(logged_in_page, live_server):
    page = logged_in_page
    page.goto(f"{live_server}/admin/register")

    _select_result(page, "passed")
    assert _visible_results(page) == ["passed"]

    page.click("#clear-filters")
    assert sorted(_visible_results(page)) == ["failed", "passed"]
    select_value = page.eval_on_selector(
        'select[data-filter="result"]', "el => el.value"
    )
    assert select_value == ""
