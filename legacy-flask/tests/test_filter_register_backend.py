"""Backend tests for the result-filter dropdown on /admin/register."""
import pytest
from bs4 import BeautifulSoup

EXPECTED_RESULT_OPTIONS = ["", "passed", "failed"]
EXPECTED_DATA_ATTRS = [
    "data-date", "data-employee", "data-department",
    "data-machine", "data-module", "data-score", "data-result",
]


@pytest.mark.backend
@pytest.mark.smoke
def test_register_page_loads(auth_client):
    resp = auth_client.get("/admin/register")
    assert resp.status_code == 200


@pytest.mark.backend
@pytest.mark.smoke
def test_result_dropdown_present(auth_client):
    resp = auth_client.get("/admin/register")
    soup = BeautifulSoup(resp.data, "html.parser")

    select = soup.find("select", attrs={"data-filter": "result"})
    assert select is not None, "missing <select data-filter='result'>"

    values = [opt.get("value", "") for opt in select.find_all("option")]
    assert values == EXPECTED_RESULT_OPTIONS, (
        f"option values changed: got {values}, "
        f"expected {EXPECTED_RESULT_OPTIONS}"
    )


@pytest.mark.backend
@pytest.mark.sanity
def test_seed_renders_passed_and_failed_rows(auth_client):
    resp = auth_client.get("/admin/register")
    soup = BeautifulSoup(resp.data, "html.parser")
    rows = soup.select("#register-rows tr[data-result]")
    results = [r.get("data-result") for r in rows]

    assert results.count("passed") == 1
    assert results.count("failed") == 1


@pytest.mark.backend
@pytest.mark.regression
def test_every_row_carries_all_filter_attributes(auth_client):
    """The JS reads tr.dataset[k] for each filter key. If any data-* attr
    is renamed in the template, that filter silently stops working."""
    resp = auth_client.get("/admin/register")
    soup = BeautifulSoup(resp.data, "html.parser")
    rows = soup.select("#register-rows tr[data-date]")
    assert rows, "no rendered attempt rows — seed data missing?"

    for row in rows:
        for attr in EXPECTED_DATA_ATTRS:
            assert row.has_attr(attr), (
                f"row missing {attr}: {row}"
            )


@pytest.mark.backend
@pytest.mark.regression
def test_unauthenticated_redirects_to_login(client):
    resp = client.get("/admin/register", follow_redirects=False)
    assert resp.status_code in (301, 302, 303)
    assert "/login" in resp.headers.get("Location", "")


@pytest.mark.backend
@pytest.mark.regression
def test_employee_role_is_forbidden(employee_client):
    resp = employee_client.get("/admin/register", follow_redirects=False)
    assert resp.status_code == 403


@pytest.mark.backend
@pytest.mark.regression
def test_clear_filters_button_and_empty_state_present(auth_client):
    """The empty-state branch and Clear-filters button are referenced by
    the JS — assert both elements are rendered."""
    resp = auth_client.get("/admin/register")
    html = resp.data.decode()
    soup = BeautifulSoup(html, "html.parser")

    assert soup.find(id="clear-filters") is not None
    assert soup.find(id="register-empty") is not None
    # The exact-vs-substring branch in JS hinges on the "result" key.
    assert "k === 'result'" in html, (
        "result-filter exact-match branch removed in JS"
    )
