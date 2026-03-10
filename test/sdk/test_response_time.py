"""Tests for analytics/response_time.py (KN-173)"""

import math

import pytest
from kankyouken.analytics.response_time import (
    ResponseTimeAnalyzer,
    RTAnalysisResult,
    detect_disengagement,
    detect_rapid_guess,
    filter_valid_responses,
    normalize_rt_by_item,
)


class TestResponseTimeAnalyzer:
    def test_rapid_guess_detection(self):
        analyzer = ResponseTimeAnalyzer(rapid_threshold_ms=3000)
        result = analyzer.analyze(rt_ms=1500)
        assert result.is_rapid_guess is True
        assert result.is_valid is False
        assert result.behavior_flag == "rapid_guess"

    def test_log_normalization(self):
        analyzer = ResponseTimeAnalyzer()
        result = analyzer.analyze(rt_ms=5000)
        assert result.log_rt > 0
        assert 8.0 < result.log_rt < 9.0  # log(5001) ≈ 8.52

    def test_disengagement_detection(self):
        analyzer = ResponseTimeAnalyzer(disengagement_threshold_ms=60000)
        result = analyzer.analyze(rt_ms=90000)
        assert result.is_disengaged is True
        assert result.is_valid is False
        assert result.behavior_flag == "disengaged"

    def test_valid_response(self):
        analyzer = ResponseTimeAnalyzer(rapid_threshold_ms=3000, disengagement_threshold_ms=60000)
        result = analyzer.analyze(rt_ms=10000)
        assert result.is_rapid_guess is False
        assert result.is_disengaged is False
        assert result.is_valid is True
        assert result.behavior_flag == "valid"

    def test_boundary_rapid_threshold(self):
        analyzer = ResponseTimeAnalyzer(rapid_threshold_ms=3000)
        # Exactly at threshold is NOT rapid (strictly less than)
        result = analyzer.analyze(rt_ms=3000)
        assert result.is_rapid_guess is False
        assert result.is_valid is True

    def test_boundary_disengagement_threshold(self):
        analyzer = ResponseTimeAnalyzer(disengagement_threshold_ms=60000)
        # Exactly at threshold is NOT disengaged (strictly greater than)
        result = analyzer.analyze(rt_ms=60000)
        assert result.is_disengaged is False
        assert result.is_valid is True

    def test_z_score_none_without_stats(self):
        analyzer = ResponseTimeAnalyzer()
        result = analyzer.analyze(rt_ms=5000)
        assert result.z_score is None

    def test_z_score_computed_after_batch(self):
        analyzer = ResponseTimeAnalyzer()
        rts = [4000, 5000, 6000, 7000, 8000]
        analyzer.analyze_batch(rts)
        # After batch, stats are available
        stats = analyzer.get_statistics()
        assert stats["mean_log_rt"] is not None
        assert stats["std_log_rt"] is not None
        assert stats["n_observations"] == 5

    def test_z_score_for_subsequent_analysis(self):
        analyzer = ResponseTimeAnalyzer()
        analyzer.analyze_batch([4000, 5000, 6000, 7000, 8000])
        # Single analysis after batch has population stats
        result = analyzer.analyze(rt_ms=6000)
        assert result.z_score is not None

    def test_log_base_10(self):
        analyzer = ResponseTimeAnalyzer(log_base=10)
        result = analyzer.analyze(rt_ms=999)  # log10(1000) ≈ 3.0
        assert abs(result.log_rt - math.log(1000, 10)) < 0.01

    def test_natural_log_default(self):
        analyzer = ResponseTimeAnalyzer()
        result = analyzer.analyze(rt_ms=4)  # log(5) ≈ 1.609
        assert abs(result.log_rt - math.log(5)) < 0.001

    def test_zero_rt_handled(self):
        analyzer = ResponseTimeAnalyzer(rapid_threshold_ms=3000)
        result = analyzer.analyze(rt_ms=0)
        assert result.log_rt == math.log(1)
        assert result.is_rapid_guess is True

    def test_get_statistics_empty(self):
        analyzer = ResponseTimeAnalyzer()
        stats = analyzer.get_statistics()
        assert stats["mean_log_rt"] is None
        assert stats["std_log_rt"] is None
        assert stats["n_observations"] == 0


class TestStandaloneFunctions:
    def test_normalize_rt_by_item(self):
        # RT equal to median should return ~1.0
        ratio = normalize_rt_by_item(rt_ms=5000, item_median_rt_ms=5000)
        assert abs(ratio - 1.0) < 0.001

    def test_normalize_rt_faster_than_median(self):
        ratio = normalize_rt_by_item(rt_ms=2000, item_median_rt_ms=5000)
        assert ratio < 1.0

    def test_normalize_rt_slower_than_median(self):
        ratio = normalize_rt_by_item(rt_ms=10000, item_median_rt_ms=5000)
        assert ratio > 1.0

    def test_normalize_rt_zero_median(self):
        # Should return 1.0 gracefully
        ratio = normalize_rt_by_item(rt_ms=5000, item_median_rt_ms=0)
        assert ratio == 1.0

    def test_detect_rapid_guess_true(self):
        assert detect_rapid_guess(rt_ms=1000, threshold_ms=3000) is True

    def test_detect_rapid_guess_false(self):
        assert detect_rapid_guess(rt_ms=5000, threshold_ms=3000) is False

    def test_detect_disengagement_true(self):
        assert detect_disengagement(rt_ms=90000, threshold_ms=60000) is True

    def test_detect_disengagement_false(self):
        assert detect_disengagement(rt_ms=30000, threshold_ms=60000) is False

    def test_filter_valid_responses(self):
        rts = [500, 5000, 10000, 90000, 1000]
        valid, counts = filter_valid_responses(
            rts, rapid_threshold_ms=3000, disengagement_threshold_ms=60000
        )
        assert valid == [5000, 10000]
        assert counts["valid"] == 2
        assert counts["rapid_guess"] == 2
        assert counts["disengaged"] == 1

    def test_filter_all_valid(self):
        rts = [5000, 10000, 20000]
        valid, counts = filter_valid_responses(rts)
        assert len(valid) == 3
        assert counts["rapid_guess"] == 0
        assert counts["disengaged"] == 0
