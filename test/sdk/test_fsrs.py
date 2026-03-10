"""Tests for scheduling/fsrs.py (KN-177, KN-178)"""

import pytest
from kankyouken.scheduling.fsrs import (
    KanKyouKenScheduler,
    KanjiCard,
    ReviewRating,
    create_new_card,
    rating_from_response,
    batch_create_cards,
)


class TestReviewRating:
    def test_rating_values(self):
        assert ReviewRating.AGAIN == 1
        assert ReviewRating.HARD == 2
        assert ReviewRating.GOOD == 3
        assert ReviewRating.EASY == 4


class TestKanjiCard:
    def test_new_card_defaults(self):
        card = create_new_card("学")
        assert card.kanji == "学"
        assert card.skill_type == "recognition"
        assert card.state == "new"
        assert card.reps == 0
        assert card.lapses == 0

    def test_production_card(self):
        card = create_new_card("語", skill_type="production")
        assert card.skill_type == "production"

    def test_retrievability_new_card(self):
        card = create_new_card("学")
        assert card.retrievability == 0.0  # No last_review yet

    def test_is_due_new_card(self):
        card = create_new_card("学")
        assert card.is_due is True  # New cards are always due


class TestKanKyouKenScheduler:
    @pytest.fixture
    def scheduler(self):
        try:
            return KanKyouKenScheduler()
        except ImportError:
            pytest.skip("fsrs library not installed")

    def test_good_review_increments_reps(self, scheduler):
        card = create_new_card("学")
        updated, interval = scheduler.review(card, ReviewRating.GOOD)
        assert updated.reps == 1
        assert interval.total_seconds() > 0
        assert updated.stability > 0

    def test_again_increments_lapses(self, scheduler):
        # First review to get out of new state
        card = create_new_card("学")
        card, _ = scheduler.review(card, ReviewRating.GOOD)
        card, _ = scheduler.review(card, ReviewRating.GOOD)

        # Now review with AGAIN
        updated, interval = scheduler.review(card, ReviewRating.AGAIN)
        assert updated.lapses > 0

    def test_easy_gives_longer_interval_than_good(self, scheduler):
        card = create_new_card("学")
        _, good_interval = scheduler.review(card, ReviewRating.GOOD)

        card2 = create_new_card("学")
        _, easy_interval = scheduler.review(card2, ReviewRating.EASY)

        assert easy_interval >= good_interval

    def test_hard_gives_shorter_interval_than_good(self, scheduler):
        card = create_new_card("学")
        _, good_interval = scheduler.review(card, ReviewRating.GOOD)

        card2 = create_new_card("学")
        _, hard_interval = scheduler.review(card2, ReviewRating.HARD)

        assert hard_interval <= good_interval

    def test_preview_intervals_returns_all_ratings(self, scheduler):
        card = create_new_card("学")
        intervals = scheduler.preview_intervals(card)
        assert ReviewRating.AGAIN in intervals
        assert ReviewRating.HARD in intervals
        assert ReviewRating.GOOD in intervals
        assert ReviewRating.EASY in intervals

    def test_card_state_updated_after_review(self, scheduler):
        card = create_new_card("学")
        assert card.state == "new"
        updated, _ = scheduler.review(card, ReviewRating.GOOD)
        assert updated.state != "new"  # Should transition to learning or review

    def test_metadata_preserved_after_review(self, scheduler):
        card = create_new_card("学", jlpt_level=5, stroke_count=8)
        updated, _ = scheduler.review(card, ReviewRating.GOOD)
        assert updated.jlpt_level == 5
        assert updated.stroke_count == 8
        assert updated.kanji == "学"

    def test_import_error_without_fsrs(self, monkeypatch):
        import sys
        # Temporarily hide fsrs module
        original = sys.modules.get("fsrs")
        sys.modules["fsrs"] = None  # type: ignore
        try:
            with pytest.raises(ImportError, match="fsrs"):
                KanKyouKenScheduler()
        finally:
            if original is not None:
                sys.modules["fsrs"] = original
            else:
                del sys.modules["fsrs"]


class TestRatingFromResponse:
    def test_incorrect_gives_again(self):
        assert rating_from_response(False, 5000) == ReviewRating.AGAIN

    def test_fast_correct_gives_easy(self):
        # rt_ratio < 0.5 → EASY (2000 / 5000 = 0.4)
        assert rating_from_response(True, 2000, expected_rt_ms=5000) == ReviewRating.EASY

    def test_normal_speed_gives_good(self):
        # rt_ratio 0.5 <= x < 1.0 → GOOD (4000 / 5000 = 0.8)
        assert rating_from_response(True, 4000, expected_rt_ms=5000) == ReviewRating.GOOD

    def test_slow_correct_gives_hard(self):
        # rt_ratio >= 1.0 → HARD (8000 / 5000 = 1.6)
        assert rating_from_response(True, 8000, expected_rt_ms=5000) == ReviewRating.HARD

    def test_exactly_at_boundary_easy_good(self):
        # rt_ratio = 0.5 exactly → GOOD (boundary is exclusive for EASY)
        result = rating_from_response(True, 2500, expected_rt_ms=5000)
        assert result == ReviewRating.GOOD

    def test_exactly_at_boundary_good_hard(self):
        # rt_ratio = 1.0 exactly → HARD (boundary is exclusive for GOOD)
        result = rating_from_response(True, 5000, expected_rt_ms=5000)
        assert result == ReviewRating.HARD


class TestBatchCreateCards:
    def test_creates_recognition_and_production(self):
        cards = batch_create_cards(["学", "語"], include_production=True)
        assert len(cards) == 4  # 2 kanji × 2 modalities
        skill_types = [c.skill_type for c in cards]
        assert skill_types.count("recognition") == 2
        assert skill_types.count("production") == 2

    def test_recognition_only(self):
        cards = batch_create_cards(["学", "語"], include_production=False)
        assert len(cards) == 2
        assert all(c.skill_type == "recognition" for c in cards)

    def test_empty_list(self):
        cards = batch_create_cards([])
        assert cards == []

    def test_kanji_preserved(self):
        cards = batch_create_cards(["学"])
        assert all(c.kanji == "学" for c in cards)

    def test_without_resource_hub(self):
        cards = batch_create_cards(["学", "語"], resource_hub=None)
        # Should work without metadata
        assert len(cards) == 4
        assert all(c.jlpt_level is None for c in cards)
