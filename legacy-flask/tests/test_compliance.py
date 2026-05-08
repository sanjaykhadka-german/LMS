"""Unit tests for the per-(user, module) compliance status helper."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from app import compliance_status_for, module_expiry_for, module_validity_days


def _mod(valid_for_days):
    return SimpleNamespace(valid_for_days=valid_for_days, id=1, title="t")


def test_status_never_passed():
    now = datetime(2026, 1, 1)
    assert compliance_status_for(None, _mod(30), now) == "never_passed"


def test_status_current(app):
    now = datetime(2026, 1, 1)
    with app.app_context():
        # Pass 5 days ago, valid 90 days → expires in 85 days, well outside
        # the 30-day "soon" window → current.
        assert compliance_status_for(now - timedelta(days=5),
                                     _mod(90), now) == "current"


def test_status_expiring_soon(app):
    now = datetime(2026, 1, 1)
    with app.app_context():
        # Pass 15 days ago, valid 30 days → expires in 15 days → within 30-day soon window.
        assert compliance_status_for(now - timedelta(days=15),
                                     _mod(30), now) == "expiring_soon"


def test_status_overdue(app):
    now = datetime(2026, 1, 1)
    with app.app_context():
        assert compliance_status_for(now - timedelta(days=60),
                                     _mod(30), now) == "overdue"


def test_status_zero_days_never_overdue(app):
    """valid_for_days=0 means never expires — even an ancient pass is current."""
    now = datetime(2026, 1, 1)
    with app.app_context():
        assert compliance_status_for(now - timedelta(days=10000),
                                     _mod(0), now) == "current"


def test_module_validity_days_null_uses_global(app):
    with app.app_context():
        app.config["ASSIGNMENT_VALIDITY_DAYS"] = 180
        assert module_validity_days(_mod(None)) == 180


def test_module_validity_days_zero_means_never(app):
    with app.app_context():
        assert module_validity_days(_mod(0)) is None


def test_module_validity_days_positive(app):
    with app.app_context():
        assert module_validity_days(_mod(7)) == 7


def test_module_expiry_for_never_returns_none(app):
    with app.app_context():
        assert module_expiry_for(datetime(2026, 1, 1), _mod(0)) is None


def test_module_expiry_for_positive(app):
    with app.app_context():
        passed = datetime(2026, 1, 1)
        assert module_expiry_for(passed, _mod(7)) == passed + timedelta(days=7)
