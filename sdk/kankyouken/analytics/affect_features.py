"""
Sensor-Free Affect Feature Engineering for KanKyouKen

Based on:
- Baker et al. (2008): Gaming the system detection
- Baker & de Carvalho (2008): Confusion detection
- Beck (2005): Wheel-spinning identification

These features are computed from event patterns, no sensors required.
"""

from dataclasses import dataclass
from datetime import datetime
from typing import List, Dict, Any, Optional, Callable, TypeVar
import math

T = TypeVar('T')


@dataclass
class AffectFeatures:
    """
    Affect-related features extracted from a response or session.

    Higher values generally indicate more problematic states.
    """
    # Frustration indicators
    rapid_attempts: int  # Fast incorrect responses in sequence
    repeated_errors_same_item: int  # Same item wrong multiple times
    error_streak: int  # Consecutive errors

    # Confusion indicators
    long_pause_before_response: bool  # Extended thinking time
    help_seeking_before_response: bool  # Requested hint/help
    response_time_variance: float  # Inconsistent timing

    # Gaming indicators
    systematic_guessing: bool  # Pattern suggesting elimination strategy
    rapid_correct_after_errors: bool  # Suddenly fast after slow
    help_abuse: bool  # Using help to get answers without thinking

    # Disengagement indicators
    declining_accuracy_trend: float  # Accuracy dropping over time
    increasing_rt_trend: float  # Getting slower (fatigue/boredom)
    session_abandonment_risk: float  # Likelihood of leaving soon

    # Wheel-spinning (stuck without learning)
    attempts_without_mastery: int
    time_on_skill_without_progress: float  # Minutes
    is_wheel_spinning: bool


class AffectFeatureExtractor:
    """
    Extract affect-related features from learning event sequences.

    Args:
        rapid_threshold_ms: RT below this indicates possible gaming
        long_pause_threshold_ms: RT above this indicates confusion
        error_streak_threshold: Consecutive errors indicating frustration
        wheel_spin_attempts: Attempts without mastery indicating wheel-spinning

    Example:
        >>> extractor = AffectFeatureExtractor()
        >>> features = extractor.extract_from_session(
        ...     events,
        ...     get_timestamp=lambda e: e['ts'],
        ...     get_correct=lambda e: e['correct'],
        ...     get_item=lambda e: e['kanji'],
        ...     get_rt=lambda e: e['response_time_ms'],
        ... )
    """

    def __init__(
        self,
        rapid_threshold_ms: int = 3000,
        long_pause_threshold_ms: int = 30000,
        error_streak_threshold: int = 3,
        wheel_spin_attempts: int = 10,
        wheel_spin_minutes: float = 5.0,
    ):
        self.rapid_threshold_ms = rapid_threshold_ms
        self.long_pause_threshold_ms = long_pause_threshold_ms
        self.error_streak_threshold = error_streak_threshold
        self.wheel_spin_attempts = wheel_spin_attempts
        self.wheel_spin_minutes = wheel_spin_minutes

    def extract_from_session(
        self,
        events: List[T],
        get_timestamp: Callable[[T], datetime],
        get_correct: Callable[[T], bool],
        get_item: Callable[[T], str],
        get_rt: Callable[[T], int],
        get_help_used: Optional[Callable[[T], bool]] = None,
    ) -> AffectFeatures:
        """
        Extract affect features from a session's events.

        Events should be sorted by timestamp.
        """
        if not events:
            return self._empty_features()

        # Sort by timestamp
        sorted_events = sorted(events, key=get_timestamp)

        # Compute individual features
        rapid_attempts = self._count_rapid_incorrect(sorted_events, get_correct, get_rt)
        repeated_errors = self._count_repeated_errors(sorted_events, get_correct, get_item)
        error_streak = self._max_error_streak(sorted_events, get_correct)

        long_pauses = self._count_long_pauses(sorted_events, get_rt)
        rt_variance = self._compute_rt_variance(sorted_events, get_rt)

        systematic_guessing = self._detect_systematic_guessing(sorted_events, get_correct, get_rt)
        rapid_after_errors = self._detect_rapid_after_errors(sorted_events, get_correct, get_rt)

        accuracy_trend = self._compute_accuracy_trend(sorted_events, get_correct)
        rt_trend = self._compute_rt_trend(sorted_events, get_rt)

        # Wheel-spinning detection per item
        wheel_spin_data = self._detect_wheel_spinning(
            sorted_events, get_timestamp, get_correct, get_item
        )

        # Help-related features (if help data available)
        help_seeking = False
        help_abuse = False
        if get_help_used:
            help_seeking = any(get_help_used(e) for e in sorted_events)
            help_abuse = self._detect_help_abuse(sorted_events, get_help_used, get_correct, get_rt)

        return AffectFeatures(
            rapid_attempts=rapid_attempts,
            repeated_errors_same_item=repeated_errors,
            error_streak=error_streak,
            long_pause_before_response=long_pauses > 0,
            help_seeking_before_response=help_seeking,
            response_time_variance=rt_variance,
            systematic_guessing=systematic_guessing,
            rapid_correct_after_errors=rapid_after_errors,
            help_abuse=help_abuse,
            declining_accuracy_trend=accuracy_trend,
            increasing_rt_trend=rt_trend,
            session_abandonment_risk=self._compute_abandonment_risk(
                error_streak, accuracy_trend, rt_trend
            ),
            attempts_without_mastery=wheel_spin_data["max_attempts"],
            time_on_skill_without_progress=wheel_spin_data["max_time_minutes"],
            is_wheel_spinning=wheel_spin_data["is_spinning"],
        )

    def _empty_features(self) -> AffectFeatures:
        """Return empty features for empty event list."""
        return AffectFeatures(
            rapid_attempts=0,
            repeated_errors_same_item=0,
            error_streak=0,
            long_pause_before_response=False,
            help_seeking_before_response=False,
            response_time_variance=0.0,
            systematic_guessing=False,
            rapid_correct_after_errors=False,
            help_abuse=False,
            declining_accuracy_trend=0.0,
            increasing_rt_trend=0.0,
            session_abandonment_risk=0.0,
            attempts_without_mastery=0,
            time_on_skill_without_progress=0.0,
            is_wheel_spinning=False,
        )

    def _count_rapid_incorrect(
        self,
        events: List[T],
        get_correct: Callable[[T], bool],
        get_rt: Callable[[T], int],
    ) -> int:
        """Count rapid incorrect responses (gaming indicator)."""
        return sum(
            1 for e in events
            if not get_correct(e) and get_rt(e) < self.rapid_threshold_ms
        )

    def _count_repeated_errors(
        self,
        events: List[T],
        get_correct: Callable[[T], bool],
        get_item: Callable[[T], str],
    ) -> int:
        """Count items with multiple errors (frustration indicator)."""
        item_errors: Dict[str, int] = {}
        for e in events:
            if not get_correct(e):
                item = get_item(e)
                item_errors[item] = item_errors.get(item, 0) + 1

        return sum(1 for count in item_errors.values() if count > 1)

    def _max_error_streak(
        self,
        events: List[T],
        get_correct: Callable[[T], bool],
    ) -> int:
        """Find maximum consecutive error streak."""
        max_streak = 0
        current_streak = 0

        for e in events:
            if not get_correct(e):
                current_streak += 1
                max_streak = max(max_streak, current_streak)
            else:
                current_streak = 0

        return max_streak

    def _count_long_pauses(
        self,
        events: List[T],
        get_rt: Callable[[T], int],
    ) -> int:
        """Count responses with long thinking time (confusion indicator)."""
        return sum(
            1 for e in events
            if get_rt(e) > self.long_pause_threshold_ms
        )

    def _compute_rt_variance(
        self,
        events: List[T],
        get_rt: Callable[[T], int],
    ) -> float:
        """Compute response time variance (confusion indicator)."""
        rts = [get_rt(e) for e in events]
        if len(rts) < 2:
            return 0.0

        mean_rt = sum(rts) / len(rts)
        variance = sum((rt - mean_rt) ** 2 for rt in rts) / (len(rts) - 1)
        return math.sqrt(variance)  # Return std dev

    def _detect_systematic_guessing(
        self,
        events: List[T],
        get_correct: Callable[[T], bool],
        get_rt: Callable[[T], int],
    ) -> bool:
        """
        Detect systematic guessing pattern.

        Pattern: Multiple rapid responses with ~25% accuracy (random 4-choice).
        """
        rapid_events = [e for e in events if get_rt(e) < self.rapid_threshold_ms]

        if len(rapid_events) < 4:
            return False

        accuracy = sum(1 for e in rapid_events if get_correct(e)) / len(rapid_events)
        return 0.15 <= accuracy <= 0.35  # Around chance level

    def _detect_rapid_after_errors(
        self,
        events: List[T],
        get_correct: Callable[[T], bool],
        get_rt: Callable[[T], int],
    ) -> bool:
        """
        Detect sudden speed-up after errors (gaming indicator).

        Pattern: Multiple errors, then suddenly fast correct responses.
        """
        if len(events) < 5:
            return False

        # Look for error streak followed by rapid correct
        for i in range(len(events) - 3):
            # Check for error streak
            if all(not get_correct(events[j]) for j in range(i, i + 3)):
                # Check next responses
                remaining = events[i + 3:]
                if remaining:
                    rapid_correct = sum(
                        1 for e in remaining[:3]
                        if get_correct(e) and get_rt(e) < self.rapid_threshold_ms
                    )
                    if rapid_correct >= 2:
                        return True

        return False

    def _detect_help_abuse(
        self,
        events: List[T],
        get_help_used: Callable[[T], bool],
        get_correct: Callable[[T], bool],
        get_rt: Callable[[T], int],
    ) -> bool:
        """
        Detect help abuse pattern.

        Pattern: Using help followed immediately by fast correct response
        (copying answer rather than learning).
        """
        help_events = [i for i, e in enumerate(events) if get_help_used(e)]

        for i in help_events:
            if i + 1 < len(events):
                next_event = events[i + 1]
                if get_correct(next_event) and get_rt(next_event) < self.rapid_threshold_ms:
                    return True

        return False

    def _compute_accuracy_trend(
        self,
        events: List[T],
        get_correct: Callable[[T], bool],
    ) -> float:
        """
        Compute accuracy trend over session.

        Returns slope: negative = declining, positive = improving.
        """
        if len(events) < 4:
            return 0.0

        # Split into quartiles
        quarter = len(events) // 4
        if quarter == 0:
            return 0.0

        first_quarter = events[:quarter]
        last_quarter = events[-quarter:]

        first_acc = sum(1 for e in first_quarter if get_correct(e)) / len(first_quarter)
        last_acc = sum(1 for e in last_quarter if get_correct(e)) / len(last_quarter)

        return last_acc - first_acc  # Negative = declining

    def _compute_rt_trend(
        self,
        events: List[T],
        get_rt: Callable[[T], int],
    ) -> float:
        """
        Compute RT trend over session.

        Returns slope: positive = getting slower (fatigue).
        """
        if len(events) < 4:
            return 0.0

        quarter = len(events) // 4
        if quarter == 0:
            return 0.0

        first_quarter = events[:quarter]
        last_quarter = events[-quarter:]

        first_rt = sum(get_rt(e) for e in first_quarter) / len(first_quarter)
        last_rt = sum(get_rt(e) for e in last_quarter) / len(last_quarter)

        # Normalize by first RT to get relative change
        if first_rt > 0:
            return (last_rt - first_rt) / first_rt
        return 0.0

    def _compute_abandonment_risk(
        self,
        error_streak: int,
        accuracy_trend: float,
        rt_trend: float,
    ) -> float:
        """
        Estimate probability of session abandonment.

        Heuristic combining multiple risk factors.
        """
        risk = 0.0

        # High error streak
        if error_streak >= self.error_streak_threshold:
            risk += 0.3

        # Declining accuracy
        if accuracy_trend < -0.2:
            risk += 0.3

        # Increasing RT (fatigue)
        if rt_trend > 0.5:
            risk += 0.2

        return min(risk, 1.0)

    def _detect_wheel_spinning(
        self,
        events: List[T],
        get_timestamp: Callable[[T], datetime],
        get_correct: Callable[[T], bool],
        get_item: Callable[[T], str],
    ) -> Dict[str, Any]:
        """
        Detect wheel-spinning (stuck without learning).

        Based on Beck (2005): many attempts on same skill without mastery.
        """
        # Track per-item attempts and time
        item_data: Dict[str, Dict] = {}

        for e in events:
            item = get_item(e)
            ts = get_timestamp(e)
            correct = get_correct(e)

            if item not in item_data:
                item_data[item] = {
                    "first_attempt": ts,
                    "attempts": 0,
                    "correct_streak": 0,
                    "mastered": False,
                }

            data = item_data[item]
            data["attempts"] += 1
            data["last_attempt"] = ts

            if correct:
                data["correct_streak"] += 1
                if data["correct_streak"] >= 3:  # 3 correct = mastery
                    data["mastered"] = True
            else:
                data["correct_streak"] = 0

        # Find worst case
        max_attempts = 0
        max_time = 0.0
        is_spinning = False

        for item, data in item_data.items():
            if not data["mastered"]:
                attempts = data["attempts"]
                time_minutes = (
                    data["last_attempt"] - data["first_attempt"]
                ).total_seconds() / 60

                if attempts > max_attempts:
                    max_attempts = attempts

                if time_minutes > max_time:
                    max_time = time_minutes

                if (attempts >= self.wheel_spin_attempts or
                        time_minutes >= self.wheel_spin_minutes):
                    is_spinning = True

        return {
            "max_attempts": max_attempts,
            "max_time_minutes": max_time,
            "is_spinning": is_spinning,
        }
