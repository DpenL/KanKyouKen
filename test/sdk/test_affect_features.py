"""Tests for analytics/affect_features.py (KN-175)"""

from datetime import datetime, timedelta
import pytest
from kankyouken.analytics.affect_features import AffectFeatures, AffectFeatureExtractor


def make_event(ts_offset_s, correct, item, rt_ms, help_used=False):
    return {
        "ts": datetime(2024, 1, 1, 10, 0) + timedelta(seconds=ts_offset_s),
        "correct": correct,
        "item": item,
        "rt": rt_ms,
        "help": help_used,
    }


GET_TS = lambda e: e["ts"]
GET_CORRECT = lambda e: e["correct"]
GET_ITEM = lambda e: e["item"]
GET_RT = lambda e: e["rt"]
GET_HELP = lambda e: e["help"]


class TestAffectFeatureExtractor:
    def setup_method(self):
        self.extractor = AffectFeatureExtractor(
            rapid_threshold_ms=3000,
            long_pause_threshold_ms=30000,
            error_streak_threshold=3,
            wheel_spin_attempts=5,
            wheel_spin_minutes=3.0,
        )

    def test_empty_events_returns_empty_features(self):
        features = self.extractor.extract_from_session(
            [], GET_TS, GET_CORRECT, GET_ITEM, GET_RT
        )
        assert features.rapid_attempts == 0
        assert features.error_streak == 0
        assert features.is_wheel_spinning is False

    def test_rapid_incorrect_count(self):
        events = [
            make_event(0, False, "学", 1000),   # rapid + incorrect
            make_event(5, False, "語", 2000),   # rapid + incorrect
            make_event(10, False, "生", 5000),  # slow + incorrect (not rapid)
        ]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT
        )
        assert features.rapid_attempts == 2

    def test_error_streak_detection(self):
        events = [
            make_event(0, False, "学", 5000),
            make_event(10, False, "語", 5000),
            make_event(20, False, "生", 5000),
            make_event(30, True, "力", 5000),
        ]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT
        )
        assert features.error_streak == 3

    def test_repeated_errors_same_item(self):
        events = [
            make_event(0, False, "学", 5000),
            make_event(10, False, "学", 5000),  # same item, second error
            make_event(20, False, "語", 5000),  # different item, first error
        ]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT
        )
        assert features.repeated_errors_same_item == 1  # only 学 has >1 error

    def test_long_pause_detection(self):
        events = [
            make_event(0, True, "学", 40000),  # long pause
            make_event(50, True, "語", 5000),  # normal
        ]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT
        )
        assert features.long_pause_before_response is True

    def test_no_long_pause(self):
        events = [
            make_event(0, True, "学", 5000),
            make_event(10, True, "語", 8000),
        ]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT
        )
        assert features.long_pause_before_response is False

    def test_help_seeking(self):
        events = [
            make_event(0, True, "学", 5000, help_used=True),
            make_event(10, True, "語", 5000, help_used=False),
        ]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT, GET_HELP
        )
        assert features.help_seeking_before_response is True

    def test_help_abuse_detection(self):
        # Help used, then immediately fast correct response
        events = [
            make_event(0, True, "学", 5000, help_used=True),
            make_event(10, True, "語", 500, help_used=False),  # rapid correct after help
        ]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT, GET_HELP
        )
        assert features.help_abuse is True

    def test_wheel_spinning_detection(self):
        # Many wrong answers on same item
        events = [make_event(i * 10, False, "学", 5000) for i in range(6)]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT
        )
        assert features.is_wheel_spinning is True
        assert features.attempts_without_mastery == 6

    def test_mastery_prevents_wheel_spinning(self):
        # 3 consecutive correct = mastery
        events = [
            make_event(0, False, "学", 5000),
            make_event(10, True, "学", 5000),
            make_event(20, True, "学", 5000),
            make_event(30, True, "学", 5000),  # mastered
        ]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT
        )
        assert features.is_wheel_spinning is False

    def test_systematic_guessing_detection(self):
        # Many rapid responses at ~25% accuracy
        events = [
            make_event(i * 5, i % 4 == 0, "学", 500)  # 25% correct, rapid
            for i in range(8)
        ]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT
        )
        assert features.systematic_guessing is True

    def test_abandonment_risk_high_error_streak(self):
        events = [
            make_event(i * 10, False, "学", 5000) for i in range(5)
        ]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT
        )
        assert features.session_abandonment_risk > 0.0

    def test_abandonment_risk_zero_for_good_session(self):
        events = [
            make_event(i * 10, True, f"k{i}", 5000) for i in range(10)
        ]
        features = self.extractor.extract_from_session(
            events, GET_TS, GET_CORRECT, GET_ITEM, GET_RT
        )
        assert features.session_abandonment_risk == 0.0
