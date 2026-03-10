"""
Session Segmentation and Engagement Metrics for KanKyouKen

Standard approach: gap-based segmentation with 30-minute inactivity threshold.
Educational games typically use 15-60 minute thresholds.

Metrics follow mobile game analytics conventions adapted for learning contexts.
"""

from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import List, Dict, Any, Callable, Optional, TypeVar
from collections import defaultdict

T = TypeVar('T')


@dataclass
class Session:
    """A single learning session."""
    session_id: str
    participant_id: str
    start_time: datetime
    end_time: datetime
    events: List[Any] = field(default_factory=list)

    @property
    def duration_seconds(self) -> float:
        """Session duration in seconds."""
        return (self.end_time - self.start_time).total_seconds()

    @property
    def duration_minutes(self) -> float:
        """Session duration in minutes."""
        return self.duration_seconds / 60

    @property
    def event_count(self) -> int:
        """Number of events in session."""
        return len(self.events)

    @property
    def events_per_minute(self) -> float:
        """Event rate (events per minute)."""
        if self.duration_minutes == 0:
            return 0.0
        return self.event_count / self.duration_minutes


@dataclass
class SessionMetrics:
    """Aggregated metrics for a collection of sessions."""
    total_sessions: int
    total_duration_minutes: float
    total_events: int
    mean_session_duration_minutes: float
    median_session_duration_minutes: float
    mean_events_per_session: float
    mean_events_per_minute: float

    # Engagement indicators
    sessions_per_day: float
    days_active: int
    day_span: int  # Days from first to last session

    @property
    def regularity_ratio(self) -> float:
        """Ratio of active days to total day span (0-1)."""
        if self.day_span == 0:
            return 1.0
        return self.days_active / self.day_span


class SessionSegmenter:
    """
    Segment event streams into sessions based on inactivity gaps.

    Args:
        gap_threshold_minutes: Inactivity gap that defines session boundary
        min_session_events: Minimum events for a valid session
        min_session_duration_seconds: Minimum duration for a valid session

    Example:
        >>> segmenter = SessionSegmenter(gap_threshold_minutes=30)
        >>> sessions = segmenter.segment(
        ...     events,
        ...     get_timestamp=lambda e: e['timestamp'],
        ...     get_participant=lambda e: e['participant_id']
        ... )
    """

    def __init__(
        self,
        gap_threshold_minutes: float = 30.0,
        min_session_events: int = 1,
        min_session_duration_seconds: float = 0.0,
    ):
        self.gap_threshold = timedelta(minutes=gap_threshold_minutes)
        self.min_session_events = min_session_events
        self.min_session_duration = timedelta(seconds=min_session_duration_seconds)
        self._session_counter = 0

    def segment(
        self,
        events: List[T],
        get_timestamp: Callable[[T], datetime],
        get_participant: Callable[[T], str],
    ) -> List[Session]:
        """
        Segment events into sessions.

        Args:
            events: List of event objects
            get_timestamp: Function to extract timestamp from event
            get_participant: Function to extract participant ID from event

        Returns:
            List of Session objects
        """
        if not events:
            return []

        # Sort by participant then timestamp
        sorted_events = sorted(
            events,
            key=lambda e: (get_participant(e), get_timestamp(e))
        )

        sessions = []
        current_participant = None
        current_session_events: List[T] = []

        for event in sorted_events:
            participant = get_participant(event)
            timestamp = get_timestamp(event)

            # New participant starts new session
            if participant != current_participant:
                if current_session_events:
                    session = self._create_session(
                        current_session_events,
                        current_participant,
                        get_timestamp,
                    )
                    if session:
                        sessions.append(session)
                current_participant = participant
                current_session_events = [event]
                continue

            # Check gap from last event
            if current_session_events:
                last_timestamp = get_timestamp(current_session_events[-1])
                gap = timestamp - last_timestamp

                if gap > self.gap_threshold:
                    # Gap too large - end current session, start new
                    session = self._create_session(
                        current_session_events,
                        participant,
                        get_timestamp,
                    )
                    if session:
                        sessions.append(session)
                    current_session_events = [event]
                else:
                    current_session_events.append(event)
            else:
                current_session_events.append(event)

        # Don't forget last session
        if current_session_events:
            session = self._create_session(
                current_session_events,
                current_participant,
                get_timestamp,
            )
            if session:
                sessions.append(session)

        return sessions

    def _create_session(
        self,
        events: List[T],
        participant_id: str,
        get_timestamp: Callable[[T], datetime],
    ) -> Optional[Session]:
        """Create a Session object if it meets minimum criteria."""
        if len(events) < self.min_session_events:
            return None

        start_time = get_timestamp(events[0])
        end_time = get_timestamp(events[-1])
        duration = end_time - start_time

        if duration < self.min_session_duration:
            return None

        self._session_counter += 1

        return Session(
            session_id=f"session_{self._session_counter}",
            participant_id=participant_id,
            start_time=start_time,
            end_time=end_time,
            events=list(events),
        )


def compute_session_metrics(sessions: List[Session]) -> SessionMetrics:
    """
    Compute aggregate metrics across sessions.

    Args:
        sessions: List of Session objects

    Returns:
        SessionMetrics with aggregate statistics
    """
    if not sessions:
        return SessionMetrics(
            total_sessions=0,
            total_duration_minutes=0.0,
            total_events=0,
            mean_session_duration_minutes=0.0,
            median_session_duration_minutes=0.0,
            mean_events_per_session=0.0,
            mean_events_per_minute=0.0,
            sessions_per_day=0.0,
            days_active=0,
            day_span=0,
        )

    durations = [s.duration_minutes for s in sessions]
    event_counts = [s.event_count for s in sessions]

    # Compute date statistics
    dates = set()
    for session in sessions:
        dates.add(session.start_time.date())

    all_times = [s.start_time for s in sessions] + [s.end_time for s in sessions]
    min_date = min(all_times).date()
    max_date = max(all_times).date()
    day_span = (max_date - min_date).days + 1

    # Median calculation
    sorted_durations = sorted(durations)
    n = len(sorted_durations)
    if n % 2 == 0:
        median_duration = (sorted_durations[n//2 - 1] + sorted_durations[n//2]) / 2
    else:
        median_duration = sorted_durations[n//2]

    total_duration = sum(durations)
    total_events = sum(event_counts)

    return SessionMetrics(
        total_sessions=len(sessions),
        total_duration_minutes=total_duration,
        total_events=total_events,
        mean_session_duration_minutes=total_duration / len(sessions),
        median_session_duration_minutes=median_duration,
        mean_events_per_session=total_events / len(sessions),
        mean_events_per_minute=total_events / total_duration if total_duration > 0 else 0,
        sessions_per_day=len(sessions) / day_span if day_span > 0 else 0,
        days_active=len(dates),
        day_span=day_span,
    )


def compute_retention(
    sessions: List[Session],
    cohort_date: datetime,
    day_ns: List[int] = [1, 7, 14, 30],
) -> Dict[str, float]:
    """
    Compute Day-N retention rates.

    Args:
        sessions: List of Session objects
        cohort_date: Reference date (usually first session date)
        day_ns: List of day offsets to compute retention for

    Returns:
        Dict mapping "day_N" to retention rate (0-1)

    Example:
        >>> retention = compute_retention(sessions, first_session.start_time)
        >>> print(retention)  # {"day_1": 0.45, "day_7": 0.22, ...}
    """
    # Group sessions by participant
    participant_dates: Dict[str, set] = defaultdict(set)
    for session in sessions:
        participant_dates[session.participant_id].add(session.start_time.date())

    cohort_day = cohort_date.date()
    total_participants = len(participant_dates)

    if total_participants == 0:
        return {f"day_{n}": 0.0 for n in day_ns}

    retention = {}
    for n in day_ns:
        target_date = cohort_day + timedelta(days=n)
        retained = sum(
            1 for dates in participant_dates.values()
            if target_date in dates
        )
        retention[f"day_{n}"] = retained / total_participants

    return retention


def compute_inter_session_intervals(
    sessions: List[Session],
) -> Dict[str, List[float]]:
    """
    Compute intervals between sessions per participant.

    Returns:
        Dict mapping participant_id to list of intervals (in days)
    """
    # Group by participant
    by_participant: Dict[str, List[Session]] = defaultdict(list)
    for session in sessions:
        by_participant[session.participant_id].append(session)

    intervals: Dict[str, List[float]] = {}

    for participant_id, participant_sessions in by_participant.items():
        sorted_sessions = sorted(participant_sessions, key=lambda s: s.start_time)

        participant_intervals = []
        for i in range(1, len(sorted_sessions)):
            gap = sorted_sessions[i].start_time - sorted_sessions[i-1].end_time
            participant_intervals.append(gap.total_seconds() / 86400)  # Convert to days

        intervals[participant_id] = participant_intervals

    return intervals
