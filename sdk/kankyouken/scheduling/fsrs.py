"""
FSRS (Free Spaced Repetition Scheduler) Integration for KanKyouKen

FSRS is a modern spaced repetition algorithm with academic backing (KDD 2022).
It models memory stability and retrievability to optimize review intervals.

Requires: pip install fsrs>=1.0.0

References:
- https://github.com/open-spaced-repetition/fsrs4anki
- Ye et al. (2022): A Modern Approach to Spaced Repetition
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import IntEnum
from typing import Optional, List, Dict, Any, Tuple


class ReviewRating(IntEnum):
    """
    FSRS uses a 4-point rating scale.

    AGAIN = Complete blackout, need to relearn
    HARD = Significant difficulty recalling
    GOOD = Correct with some effort
    EASY = Perfect recall, effortless
    """
    AGAIN = 1
    HARD = 2
    GOOD = 3
    EASY = 4


@dataclass
class KanjiCard:
    """
    A kanji learning card with FSRS scheduling state.

    Attributes:
        kanji: The kanji character
        skill_type: 'recognition' or 'production' (separate KCs)
        state: 'new', 'learning', 'review', 'relearning'
        due: When the card is due for review
        stability: How long until 90% forgetting probability (days)
        difficulty: Item difficulty (1-10 scale)
        elapsed_days: Days since last review
        scheduled_days: Days until next review
        reps: Total number of reviews
        lapses: Number of times forgotten (rated AGAIN)
        last_review: Timestamp of last review
    """
    kanji: str
    skill_type: str = "recognition"  # or "production"

    # Card state
    state: str = "new"
    due: datetime = field(default_factory=datetime.now)

    # FSRS parameters
    stability: float = 0.0
    difficulty: float = 5.0  # Default mid-range
    elapsed_days: int = 0
    scheduled_days: int = 0
    reps: int = 0
    lapses: int = 0
    last_review: Optional[datetime] = None

    # Metadata (from ResourceHub)
    jlpt_level: Optional[int] = None
    stroke_count: Optional[int] = None
    radicals: List[str] = field(default_factory=list)

    @property
    def is_due(self) -> bool:
        """Check if card is due for review."""
        return datetime.now() >= self.due

    @property
    def retrievability(self) -> float:
        """
        Estimate current probability of successful recall.

        Based on FSRS forgetting curve: R = 0.9 ^ (t / S)
        where t = elapsed time, S = stability
        """
        if self.stability <= 0:
            return 0.0

        if self.last_review is None:
            return 0.0

        elapsed = (datetime.now() - self.last_review).days
        return 0.9 ** (elapsed / self.stability)


class KanKyouKenScheduler:
    """
    FSRS-based scheduler for kanji learning.

    Wraps the py-fsrs library with KanKyouKen-specific conveniences.

    Args:
        desired_retention: Target retention rate (default 0.9 = 90%)
        parameters: Optional custom FSRS parameters (21 weights)

    Example:
        >>> scheduler = KanKyouKenScheduler()
        >>> card = create_new_card('学', 'reading')
        >>> updated_card, interval = scheduler.review(card, ReviewRating.GOOD)
        >>> print(f"Review again in {interval.days} days")
    """

    def __init__(
        self,
        desired_retention: float = 0.9,
        parameters: Optional[List[float]] = None,
    ):
        self.desired_retention = desired_retention
        self._parameters = parameters
        self._fsrs = None
        self._ensure_fsrs()

    def _ensure_fsrs(self) -> None:
        """Initialize FSRS library (supports fsrs >= 6.0)."""
        if self._fsrs is not None:
            return

        try:
            from fsrs import Scheduler, Card as FSRSCard, Rating

            self._fsrs = Scheduler()
            self._FSRSCard = FSRSCard
            self._Rating = Rating

        except ImportError:
            raise ImportError(
                "FSRS library not installed. "
                "Install with: pip install fsrs>=1.0.0"
            )

    def review(
        self,
        card: KanjiCard,
        rating: ReviewRating,
        review_time: Optional[datetime] = None,
    ) -> Tuple[KanjiCard, timedelta]:
        """
        Process a review and update card scheduling.

        Args:
            card: The card being reviewed
            rating: User's self-assessment (AGAIN/HARD/GOOD/EASY)
            review_time: When the review occurred (default: now)

        Returns:
            Tuple of (updated_card, interval_until_next_review)
        """
        from datetime import timezone
        now_utc = datetime.now(timezone.utc)
        review_time = review_time or now_utc

        fsrs_card = self._to_fsrs_card(card)
        fsrs_rating = self._Rating(rating.value)
        updated_fsrs_card, _log = self._fsrs.review_card(fsrs_card, fsrs_rating)

        new_card = self._from_fsrs_card(card, updated_fsrs_card, review_time, rating)

        due = new_card.due
        # Compute interval; both due and reference must be comparable
        if due.tzinfo is not None and review_time.tzinfo is None:
            interval = due - review_time.replace(tzinfo=timezone.utc)
        elif due.tzinfo is None and review_time.tzinfo is not None:
            interval = due.replace(tzinfo=timezone.utc) - review_time
        else:
            interval = due - review_time

        return new_card, interval

    def preview_intervals(
        self,
        card: KanjiCard,
        review_time: Optional[datetime] = None,
    ) -> Dict[ReviewRating, timedelta]:
        """
        Preview intervals for each possible rating.

        Useful for showing user what each button will do.
        """
        from datetime import timezone
        now_utc = datetime.now(timezone.utc)
        review_time = review_time or now_utc

        intervals = {}
        for rating in ReviewRating:
            fsrs_card = self._to_fsrs_card(card)
            fsrs_rating = self._Rating(rating.value)
            updated_card, _ = self._fsrs.review_card(fsrs_card, fsrs_rating)
            due = updated_card.due
            if due.tzinfo is not None and review_time.tzinfo is None:
                intervals[rating] = due - review_time.replace(tzinfo=timezone.utc)
            elif due.tzinfo is None and review_time.tzinfo is not None:
                intervals[rating] = due.replace(tzinfo=timezone.utc) - review_time
            else:
                intervals[rating] = due - review_time

        return intervals

    def _to_fsrs_card(self, card: KanjiCard) -> Any:
        """Convert KanjiCard to FSRS Card (fsrs v6).

        fsrs v6 uses None for stability/difficulty on new cards.
        Only set them if the card has been reviewed before.
        """
        from datetime import timezone
        fsrs_card = self._FSRSCard()
        if card.stability > 0:
            fsrs_card.stability = card.stability
        if card.difficulty != 5.0 or card.reps > 0:
            fsrs_card.difficulty = card.difficulty
        if card.last_review:
            last_review = card.last_review
            if last_review.tzinfo is None:
                last_review = last_review.replace(tzinfo=timezone.utc)
            fsrs_card.last_review = last_review
        return fsrs_card

    def _from_fsrs_card(
        self,
        original: KanjiCard,
        fsrs_card: Any,
        review_time: datetime,
        rating: ReviewRating,
    ) -> KanjiCard:
        """Convert FSRS Card (v6) back to KanjiCard."""
        return KanjiCard(
            kanji=original.kanji,
            skill_type=original.skill_type,
            state=self._map_state(fsrs_card.state),
            due=fsrs_card.due,
            stability=fsrs_card.stability,
            difficulty=fsrs_card.difficulty,
            elapsed_days=original.elapsed_days,
            scheduled_days=original.scheduled_days,
            reps=original.reps + 1,
            lapses=original.lapses + (1 if rating == ReviewRating.AGAIN else 0),
            last_review=review_time,
            jlpt_level=original.jlpt_level,
            stroke_count=original.stroke_count,
            radicals=original.radicals,
        )

    def _map_state(self, fsrs_state: Any) -> str:
        """Map FSRS v6 state enum to string."""
        state_map = {1: "learning", 2: "review", 3: "relearning"}
        try:
            return state_map.get(int(fsrs_state), "learning")
        except (TypeError, ValueError):
            return "learning"

    def optimize_parameters(
        self,
        review_logs: List[Dict[str, Any]],
    ) -> List[float]:
        """
        Optimize FSRS parameters from historical review data.

        This is computationally expensive; run offline.

        Args:
            review_logs: List of dicts with 'rating', 'review_time', etc.

        Returns:
            Optimized 21-parameter weight list
        """
        try:
            from fsrs import Optimizer  # noqa: F401
        except ImportError:
            raise ImportError(
                "FSRS optimizer not available. "
                "Install with: pip install fsrs[optimizer]"
            )

        # Convert to FSRS format and optimize
        # Implementation depends on fsrs version
        raise NotImplementedError(
            "Parameter optimization requires custom implementation. "
            "See: https://github.com/open-spaced-repetition/fsrs-optimizer"
        )


# Convenience functions

def create_new_card(
    kanji: str,
    skill_type: str = "recognition",
    **metadata,
) -> KanjiCard:
    """Create a new card ready for first review."""
    return KanjiCard(
        kanji=kanji,
        skill_type=skill_type,
        state="new",
        due=datetime.now(),
        **metadata,
    )


def rating_from_response(
    correct: bool,
    response_time_ms: int,
    expected_rt_ms: int = 5000,
) -> ReviewRating:
    """
    Infer FSRS rating from response correctness and speed.

    This heuristic converts binary correct/incorrect + RT
    to FSRS's 4-point scale.

    Args:
        correct: Whether the response was correct
        response_time_ms: Actual response time
        expected_rt_ms: Expected RT for this item difficulty

    Returns:
        Inferred ReviewRating
    """
    if not correct:
        return ReviewRating.AGAIN

    # Correct response - differentiate by speed
    rt_ratio = response_time_ms / expected_rt_ms

    if rt_ratio < 0.5:
        return ReviewRating.EASY  # Very fast correct
    elif rt_ratio < 1.0:
        return ReviewRating.GOOD  # Normal speed correct
    else:
        return ReviewRating.HARD  # Slow but correct


def batch_create_cards(
    kanji_list: List[str],
    include_production: bool = True,
    resource_hub: Optional[Any] = None,
) -> List[KanjiCard]:
    """
    Create cards for a list of kanji.

    If resource_hub provided, enriches with JLPT level, radicals, etc.

    Args:
        kanji_list: List of kanji characters
        include_production: Create both recognition and production cards
        resource_hub: Optional ResourceHub for metadata enrichment
    """
    cards = []

    for kanji in kanji_list:
        # Get metadata from ResourceHub if available
        metadata = {}
        if resource_hub:
            try:
                kanjidic = resource_hub.load("kanjidic2_core")
                if kanji in kanjidic.get("data", {}):
                    entry = kanjidic["data"][kanji]
                    metadata["jlpt_level"] = entry.get("jlpt")
                    metadata["stroke_count"] = entry.get("stroke_count")

                kradfile = resource_hub.load("kradfile_u")
                if kanji in kradfile.get("data", {}).get("kanji_to_radicals", {}):
                    metadata["radicals"] = kradfile["data"]["kanji_to_radicals"][kanji]
            except Exception:
                pass  # Continue without metadata

        # Recognition card
        cards.append(create_new_card(kanji, "recognition", **metadata))

        # Production card (separate KC)
        if include_production:
            cards.append(create_new_card(kanji, "production", **metadata))

    return cards
