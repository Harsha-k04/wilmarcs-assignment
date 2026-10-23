from datetime import datetime, timezone, timedelta

from app.models import iso_utc


def test_naive_sqlite_datetime_is_serialized_as_utc():
    value = datetime(2026, 10, 23, 0, 45, 6)
    assert iso_utc(value) == "2026-10-23T00:45:06Z"


def test_aware_datetime_is_converted_to_utc():
    value = datetime(2026, 10, 23, 6, 15, 6, tzinfo=timezone(timedelta(hours=5, minutes=30)))
    assert iso_utc(value) == "2026-10-23T00:45:06Z"


def test_none_datetime_is_preserved():
    assert iso_utc(None) is None
