"""Tests for analytics/session.py (KN-174)"""

from datetime import datetime, timedelta
import pytest
from kankyouken.analytics.session import (
    Session,
    SessionMetrics,
    SessionSegmenter,
    compute_session_metrics,
    compute_retention,
    compute_inter_session_intervals,
)


def make_event(participant_id, ts):
    return {"pid": participant_id, "ts": ts}


GET_TS = lambda e: e["ts"]
GET_PID = lambda e: e["pid"]


class TestSessionSegmenter:
    def test_basic_segmentation(self):
        events = [
            make_event("p1", datetime(2024, 1, 1, 10, 0)),
            make_event("p1", datetime(2024, 1, 1, 10, 5)),
            make_event("p1", datetime(2024, 1, 1, 11, 0)),  # 55 min gap
            make_event("p1", datetime(2024, 1, 1, 11, 5)),
        ]
        segmenter = SessionSegmenter(gap_threshold_minutes=30)
        sessions = segmenter.segment(events, GET_TS, GET_PID)
        assert len(sessions) == 2
        assert sessions[0].event_count == 2
        assert sessions[1].event_count == 2

    def test_single_session_no_gap(self):
        events = [
            make_event("p1", datetime(2024, 1, 1, 10, 0)),
            make_event("p1", datetime(2024, 1, 1, 10, 10)),
            make_event("p1", datetime(2024, 1, 1, 10, 20)),
        ]
        segmenter = SessionSegmenter(gap_threshold_minutes=30)
        sessions = segmenter.segment(events, GET_TS, GET_PID)
        assert len(sessions) == 1
        assert sessions[0].event_count == 3

    def test_multiple_participants(self):
        events = [
            make_event("p1", datetime(2024, 1, 1, 10, 0)),
            make_event("p1", datetime(2024, 1, 1, 10, 5)),
            make_event("p2", datetime(2024, 1, 1, 10, 0)),
            make_event("p2", datetime(2024, 1, 1, 10, 10)),
        ]
        segmenter = SessionSegmenter(gap_threshold_minutes=30)
        sessions = segmenter.segment(events, GET_TS, GET_PID)
        assert len(sessions) == 2
        assert {s.participant_id for s in sessions} == {"p1", "p2"}

    def test_empty_events(self):
        segmenter = SessionSegmenter()
        sessions = segmenter.segment([], GET_TS, GET_PID)
        assert sessions == []

    def test_single_event(self):
        events = [make_event("p1", datetime(2024, 1, 1, 10, 0))]
        segmenter = SessionSegmenter()
        sessions = segmenter.segment(events, GET_TS, GET_PID)
        assert len(sessions) == 1

    def test_min_session_events_filter(self):
        # Single-event sessions filtered out
        events = [
            make_event("p1", datetime(2024, 1, 1, 10, 0)),
            make_event("p1", datetime(2024, 1, 1, 12, 0)),  # new session
        ]
        segmenter = SessionSegmenter(gap_threshold_minutes=30, min_session_events=2)
        sessions = segmenter.segment(events, GET_TS, GET_PID)
        assert len(sessions) == 0

    def test_session_ids_are_unique(self):
        events = [
            make_event("p1", datetime(2024, 1, 1, 10, 0)),
            make_event("p1", datetime(2024, 1, 1, 10, 5)),
            make_event("p1", datetime(2024, 1, 1, 12, 0)),
            make_event("p1", datetime(2024, 1, 1, 12, 5)),
        ]
        segmenter = SessionSegmenter(gap_threshold_minutes=30)
        sessions = segmenter.segment(events, GET_TS, GET_PID)
        session_ids = [s.session_id for s in sessions]
        assert len(session_ids) == len(set(session_ids))

    def test_session_duration(self):
        events = [
            make_event("p1", datetime(2024, 1, 1, 10, 0)),
            make_event("p1", datetime(2024, 1, 1, 10, 30)),
        ]
        segmenter = SessionSegmenter(gap_threshold_minutes=60)
        sessions = segmenter.segment(events, GET_TS, GET_PID)
        assert len(sessions) == 1
        assert sessions[0].duration_minutes == 30.0


class TestComputeSessionMetrics:
    def _make_session(self, pid, start, end, n_events=5):
        return Session(
            session_id="s1",
            participant_id=pid,
            start_time=start,
            end_time=end,
            events=[{} for _ in range(n_events)],
        )

    def test_empty_sessions(self):
        metrics = compute_session_metrics([])
        assert metrics.total_sessions == 0
        assert metrics.total_duration_minutes == 0.0
        assert metrics.days_active == 0

    def test_basic_metrics(self):
        sessions = [
            self._make_session(
                "p1",
                datetime(2024, 1, 1, 10, 0),
                datetime(2024, 1, 1, 10, 30),
                n_events=10,
            ),
            self._make_session(
                "p1",
                datetime(2024, 1, 2, 10, 0),
                datetime(2024, 1, 2, 11, 0),
                n_events=20,
            ),
        ]
        metrics = compute_session_metrics(sessions)
        assert metrics.total_sessions == 2
        assert metrics.total_duration_minutes == 90.0
        assert metrics.total_events == 30
        assert metrics.days_active == 2
        assert metrics.day_span == 2

    def test_regularity_ratio(self):
        sessions = [
            self._make_session("p1", datetime(2024, 1, 1, 10, 0), datetime(2024, 1, 1, 10, 30)),
            self._make_session("p1", datetime(2024, 1, 3, 10, 0), datetime(2024, 1, 3, 10, 30)),
        ]
        metrics = compute_session_metrics(sessions)
        # 2 active days out of 3-day span
        assert metrics.days_active == 2
        assert metrics.day_span == 3
        assert abs(metrics.regularity_ratio - 2 / 3) < 0.001


class TestComputeRetention:
    def _make_session(self, pid, date):
        dt = datetime.combine(date, datetime.min.time())
        return Session(
            session_id=f"s_{pid}_{date}",
            participant_id=pid,
            start_time=dt,
            end_time=dt + timedelta(minutes=30),
        )

    def test_day1_retention(self):
        from datetime import date
        cohort_date = datetime(2024, 1, 1)
        sessions = [
            self._make_session("p1", date(2024, 1, 1)),
            self._make_session("p1", date(2024, 1, 2)),  # returned day 1
            self._make_session("p2", date(2024, 1, 1)),
            # p2 does not return
        ]
        retention = compute_retention(sessions, cohort_date, day_ns=[1])
        assert retention["day_1"] == 0.5  # 1 of 2 returned

    def test_empty_sessions(self):
        retention = compute_retention([], datetime(2024, 1, 1), day_ns=[1, 7])
        assert retention == {"day_1": 0.0, "day_7": 0.0}


class TestComputeInterSessionIntervals:
    def test_basic_intervals(self):
        sessions = [
            Session(
                session_id="s1",
                participant_id="p1",
                start_time=datetime(2024, 1, 1, 10, 0),
                end_time=datetime(2024, 1, 1, 10, 30),
            ),
            Session(
                session_id="s2",
                participant_id="p1",
                start_time=datetime(2024, 1, 2, 10, 0),
                end_time=datetime(2024, 1, 2, 10, 30),
            ),
        ]
        intervals = compute_inter_session_intervals(sessions)
        assert "p1" in intervals
        assert len(intervals["p1"]) == 1
        # Gap from end of s1 (10:30) to start of s2 (next day 10:00) = 23.5 hours
        assert abs(intervals["p1"][0] - (23.5 / 24)) < 0.01

    def test_single_session_no_intervals(self):
        sessions = [
            Session(
                session_id="s1",
                participant_id="p1",
                start_time=datetime(2024, 1, 1, 10, 0),
                end_time=datetime(2024, 1, 1, 10, 30),
            ),
        ]
        intervals = compute_inter_session_intervals(sessions)
        assert intervals["p1"] == []
