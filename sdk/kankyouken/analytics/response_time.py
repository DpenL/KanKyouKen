"""
Response Time Analysis Utilities for KanKyouKen

Based on:
- Van der Linden (2006): Log-normal model for response times
- Pelánek (2023): Leveraging response times in learning environments
- De Boeck & Jeon (2019): Overview of RT models in cognitive tests

Response times in learning environments follow log-normal distributions.
Raw RTs are not comparable across items of different difficulty.
"""

from dataclasses import dataclass
from typing import Optional, List, Dict, Tuple
import math


@dataclass
class RTAnalysisResult:
    """Result of response time analysis for a single response."""
    raw_rt_ms: int
    log_rt: float
    z_score: Optional[float]
    is_rapid_guess: bool
    is_disengaged: bool
    is_valid: bool

    @property
    def behavior_flag(self) -> str:
        """Categorize the response behavior."""
        if self.is_rapid_guess:
            return "rapid_guess"
        elif self.is_disengaged:
            return "disengaged"
        elif self.is_valid:
            return "valid"
        else:
            return "unknown"


class ResponseTimeAnalyzer:
    """
    Analyze and normalize response times for learning analytics.

    Default thresholds calibrated for kanji recognition tasks:
    - Rapid guess: <3000ms (can't read and process kanji that fast)
    - Disengagement: >60000ms (attention has wandered)

    Args:
        rapid_threshold_ms: Responses faster than this are flagged as guesses
        disengagement_threshold_ms: Responses slower than this are flagged
        log_base: Base for logarithmic transformation (default: natural log)

    Example:
        >>> analyzer = ResponseTimeAnalyzer()
        >>> result = analyzer.analyze(rt_ms=4500)
        >>> print(result.behavior_flag)  # "valid"
        >>> print(result.log_rt)  # ~8.41
    """

    def __init__(
        self,
        rapid_threshold_ms: int = 3000,
        disengagement_threshold_ms: int = 60000,
        log_base: Optional[float] = None,  # None = natural log
    ):
        self.rapid_threshold_ms = rapid_threshold_ms
        self.disengagement_threshold_ms = disengagement_threshold_ms
        self.log_base = log_base

        # Running statistics for z-score calculation
        self._log_rts: List[float] = []
        self._mean: Optional[float] = None
        self._std: Optional[float] = None

    def analyze(
        self,
        rt_ms: int,
        item_median_rt_ms: Optional[int] = None,
    ) -> RTAnalysisResult:
        """
        Analyze a single response time.

        Args:
            rt_ms: Response time in milliseconds
            item_median_rt_ms: Optional item-specific median for normalization

        Returns:
            RTAnalysisResult with normalized values and behavior flags
        """
        # Log transform (add 1 to handle edge case of 0ms)
        log_rt = self._log_transform(rt_ms + 1)

        # Behavior detection
        is_rapid = rt_ms < self.rapid_threshold_ms
        is_disengaged = rt_ms > self.disengagement_threshold_ms
        is_valid = not is_rapid and not is_disengaged

        # Z-score (if we have population stats)
        z_score = None
        if self._mean is not None and self._std is not None and self._std > 0:
            z_score = (log_rt - self._mean) / self._std

        return RTAnalysisResult(
            raw_rt_ms=rt_ms,
            log_rt=log_rt,
            z_score=z_score,
            is_rapid_guess=is_rapid,
            is_disengaged=is_disengaged,
            is_valid=is_valid,
        )

    def analyze_batch(
        self,
        response_times_ms: List[int],
        update_stats: bool = True,
    ) -> List[RTAnalysisResult]:
        """
        Analyze a batch of response times.

        If update_stats=True, computes population statistics for z-scoring.
        """
        if update_stats:
            self._update_statistics(response_times_ms)

        return [self.analyze(rt) for rt in response_times_ms]

    def _log_transform(self, value: float) -> float:
        """Apply logarithmic transformation."""
        if self.log_base is None:
            return math.log(value)
        else:
            return math.log(value, self.log_base)

    def _update_statistics(self, response_times_ms: List[int]) -> None:
        """Update running mean and std from new data."""
        log_rts = [self._log_transform(rt + 1) for rt in response_times_ms]
        self._log_rts.extend(log_rts)

        n = len(self._log_rts)
        if n > 1:
            self._mean = sum(self._log_rts) / n
            variance = sum((x - self._mean) ** 2 for x in self._log_rts) / (n - 1)
            self._std = math.sqrt(variance)

    def get_statistics(self) -> Dict[str, Optional[float]]:
        """Return current population statistics."""
        return {
            "mean_log_rt": self._mean,
            "std_log_rt": self._std,
            "n_observations": len(self._log_rts),
        }


def normalize_rt_by_item(
    rt_ms: int,
    item_median_rt_ms: int,
) -> float:
    """
    Normalize RT relative to item difficulty (median RT).

    Returns ratio of log(RT) to log(median RT).
    Values >1 indicate slower than typical; <1 indicate faster.

    Based on Pelánek (2023) recommendation for item-relative normalization.
    """
    log_rt = math.log(rt_ms + 1)
    log_median = math.log(item_median_rt_ms + 1)

    if log_median == 0:
        return 1.0

    return log_rt / log_median


def detect_rapid_guess(
    rt_ms: int,
    threshold_ms: int = 3000,
) -> bool:
    """
    Flag responses faster than reading/processing threshold.

    3 seconds is standard threshold for kanji recognition tasks.
    Adjust for task complexity (simpler tasks → lower threshold).
    """
    return rt_ms < threshold_ms


def detect_disengagement(
    rt_ms: int,
    threshold_ms: int = 60000,
) -> bool:
    """
    Flag responses slower than reasonable attention span.

    60 seconds indicates the learner likely left the task.
    """
    return rt_ms > threshold_ms


def filter_valid_responses(
    response_times_ms: List[int],
    rapid_threshold_ms: int = 3000,
    disengagement_threshold_ms: int = 60000,
) -> Tuple[List[int], Dict[str, int]]:
    """
    Filter out aberrant responses and return valid subset.

    Returns:
        Tuple of (valid_rts, counts_dict) where counts_dict has
        keys 'valid', 'rapid_guess', 'disengaged'
    """
    valid = []
    counts = {"valid": 0, "rapid_guess": 0, "disengaged": 0}

    for rt in response_times_ms:
        if rt < rapid_threshold_ms:
            counts["rapid_guess"] += 1
        elif rt > disengagement_threshold_ms:
            counts["disengaged"] += 1
        else:
            valid.append(rt)
            counts["valid"] += 1

    return valid, counts
