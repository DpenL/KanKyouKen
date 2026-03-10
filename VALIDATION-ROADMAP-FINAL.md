# KanKyouKen Development Roadmap - Validation Sequence

> **Timeline**: Feb-Mar 2026 (3 validation-focused sprints)
> **Context**: Path 1 (researcher testing with dummy data) → Iterate → Path 2 (live pilot)
> **Date**: 2026-02-19

---

## Overview: Three Sequential Sprints

```
Sprint 1 (2 weeks)          Sprint 2 (2 weeks)          Sprint 3 (3-4 weeks)
Event Management     →      Path 1 Support       →      Analytics Pipeline
----------------            ----------------            ------------------
- Event browser             - Dummy data loaded         - Continuous aggregation
- Schema management         - Study dashboards          - Custom viz hooks
- Filters + export          - Path 1 testing            - ML pipeline
- Foundation                - Iteration feedback        - Path 2 ready

                    Path 1 Evaluation              Path 2 Pilot Study
                    (5-8 researchers)              (10-15 students)
                    Jan-Feb 2026                   Feb-Mar 2026
```

---

## Sprint 1: Event Management Foundation (2 weeks) - CURRENT

**Goal**: Core platform ready for researchers to test

**Deliverables**:
- ✅ Event browser (browse, filter, paginate)
- ✅ Export to CSV/JSON
- ✅ Schema management (define event types)
- ✅ Payload inspector
- ✅ Health check (basic)

**Status**: See `EVENT-MANAGEMENT-SPRINT.md` for details

**Why This First**: Foundation must exist before anyone can test anything

---

## Sprint 2: Path 1 Support (2 weeks) - AFTER Sprint 1

### Context: Path 1 Researcher Evaluation

**Who**: 5-8 Japanese language education researchers
**What**: Test platform with dummy data (NO real students yet)
**Method**: Technology probes + think-aloud + heuristic evaluation
**Timeline**: Jan-Feb 2026
**Goal**: Validate researcher workflow and usability

**Tasks Researchers Will Do**:
1. View sample study with pre-loaded events
2. Filter and export event data
3. Understand event schemas
4. Assess documentation
5. Provide usability feedback

### What We Need to Build

#### Week 1: Dummy Data + Study Context

**KN-180: Sample Study Creation**
- Create realistic "Kanji Pilot 2026" dummy study
- Pre-load 2,000-3,000 realistic events
- Multiple dummy participants (P001-P015)
- Variety of event types (kanji_presented, answer_submitted, hint_requested)
- Temporal spread (looks like 2 weeks of study data)

**Implementation**:
```python
# scripts/generate_dummy_data.py
import random
from datetime import datetime, timedelta

def generate_pilot_data():
    """
    Generate realistic dummy data for Path 1 evaluation
    """
    study_id = create_study("Kanji Pilot 2026", "Sample kanji learning study")
    
    participants = [create_participant(f"P{i:03d}") for i in range(1, 16)]
    
    # Event types based on schema
    kanji_list = ["日", "月", "火", "水", "木", "金", "土", "人", "大", "小"]
    
    events = []
    start_date = datetime.now() - timedelta(days=14)
    
    for participant in participants:
        # Simulate 2 weeks of learning
        for day in range(14):
            session_time = start_date + timedelta(days=day, hours=random.randint(9, 18))
            
            # 10-20 events per session
            for _ in range(random.randint(10, 20)):
                kanji = random.choice(kanji_list)
                
                # Kanji presented
                events.append({
                    'participant_id': participant,
                    'study_id': study_id,
                    'event_type': 'kanji_presented',
                    'payload': {
                        'kanji': kanji,
                        'jlpt_level': get_jlpt_level(kanji),
                        'presentation_mode': random.choice(['recognition', 'production'])
                    },
                    'item_id': f'kanji_{kanji}',
                    'ts': session_time
                })
                
                # Answer submitted (80% accuracy with variation)
                session_time += timedelta(seconds=random.randint(2, 15))
                accuracy = 0.8 + random.gauss(0, 0.15)  # Mean 80%, some variance
                correct = random.random() < accuracy
                
                events.append({
                    'participant_id': participant,
                    'study_id': study_id,
                    'event_type': 'answer_submitted',
                    'payload': {
                        'answer': get_reading(kanji) if correct else 'wrong_answer',
                        'correct': correct,
                        'response_time_ms': random.randint(1500, 8000)
                    },
                    'item_id': f'kanji_{kanji}',
                    'ts': session_time
                })
    
    # Bulk insert
    insert_events(events)
    
    return {
        'study_id': study_id,
        'participants': len(participants),
        'events': len(events)
    }
```

**Why**: Researchers need realistic data to evaluate platform

---

**KN-181: Study Overview Dashboard**
- Summary stats for study (active participants, total events, accuracy)
- Participant list with activity indicators
- Date range of data collection
- Quick export button

**UI**:
```typescript
<StudyOverview studyId={dummyStudyId}>
  Study: Kanji Pilot 2026 (Sample)
  
  Summary:
  - 15 participants
  - 2,847 events
  - Date range: Jan 1 - Jan 14, 2026
  - Average accuracy: 79%
  
  Participant Activity:
  ┌──────┬────────┬──────────┬─────────┐
  │ ID   │ Events │ Accuracy │ Last    │
  ├──────┼────────┼──────────┼─────────┤
  │ P001 │ 187    │ 82%      │ Jan 14  │
  │ P002 │ 194    │ 76%      │ Jan 14  │
  │ P003 │ 0      │ -        │ Never   │ (dropout)
  └──────┴────────┴──────────┴─────────┘
  
  [View Events] [Export CSV] [View Schema]
</StudyOverview>
```

**Why**: Gives researchers context before diving into events

---

**KN-182: Path 1 Testing Guide**
- Documentation for researchers
- Task walkthrough (5 tasks)
- Expected outcomes for each task
- Feedback collection form

**Tasks for Researchers**:
```markdown
# Path 1 Evaluation Tasks

## Task 1: Explore Event Data (10 min)
1. Navigate to "Kanji Pilot 2026" study
2. Browse recent events
3. Filter by event type "answer_submitted"
4. Identify participant with highest accuracy

**Expected Outcome**: Can navigate event browser, understand basic filters

## Task 2: Export for Analysis (5 min)
1. Export all events to CSV
2. Open in Excel/Google Sheets
3. Verify data structure makes sense

**Expected Outcome**: Export works, data is usable

## Task 3: Schema Understanding (10 min)
1. View event schemas for this study
2. Understand "answer_submitted" payload structure
3. Identify required vs optional fields

**Expected Outcome**: Schema documentation is clear

## Task 4: Multi-Tenant Isolation (5 min)
1. Try to access another study (should fail)
2. Verify only your assigned studies visible

**Expected Outcome**: RLS working, security understood

## Task 5: Research Workflow Assessment (15 min)
1. Think aloud: "How would you use this for your research?"
2. Identify pain points
3. Suggest improvements

**Expected Outcome**: Qualitative feedback on researcher needs
```

**Why**: Structured evaluation, consistent feedback

---

#### Week 2: Iteration + Documentation

**KN-183: Path 1 Feedback Integration**
- Collect usability feedback
- Prioritize issues (P0: blockers, P1: major, P2: minor)
- Quick fixes before Path 2
- Document iteration roadmap

**Process**:
1. Conduct Path 1 sessions (5-8 researchers)
2. Categorize feedback:
   - P0 (Blockers): Fix immediately
   - P1 (Major usability): Fix before Path 2
   - P2 (Nice-to-have): Backlog
3. Implement P0 and P1 fixes
4. Update documentation

**Deliverable**: Iteration report + updated platform

---

**KN-184: Documentation Polish**
- User guide for researchers
- API documentation
- Schema definition guide
- Troubleshooting FAQ

**Sections**:
1. Getting Started (create study, load data)
2. Event Browser Guide (filters, export)
3. Schema Management (define event types)
4. Data Export Formats
5. Privacy & Ethics (RLS, consent, anonymization)

**Why**: Path 1 tests documentation completeness

---

### Sprint 2 Deliverables

**Week 1**:
- ✅ Realistic dummy data loaded
- ✅ Study overview dashboard
- ✅ Path 1 testing guide ready

**Week 2**:
- ✅ Path 1 evaluation completed
- ✅ Feedback categorized and prioritized
- ✅ P0/P1 issues fixed
- ✅ Documentation updated

**Outcome**: Platform validated by researchers, ready to build analytics

---

## Sprint 3: Analytics Pipeline + Hooks (3-4 weeks) - BEFORE Path 2

### Context: Gap Between Path 1 and Path 2

**What We Know Now**:
- Researcher feedback from Path 1
- What features are actually needed
- What documentation is missing
- Platform stability validated

**What We Build**: Full analytics infrastructure for Path 2

### Week 1-2: Core Analytics Pipeline

**KN-185: Continuous Aggregation Engine**
- Auto-compute analytics as events arrive
- Micro-batch processing (every 10-30 seconds)
- Populate `participant_analytics` and `item_analytics` tables
- Real-time dashboard updates via WebSocket

**Implementation**:
```typescript
// supabase/functions/process-events-continuous/index.ts

Deno.cron("Process events", "*/30 * * * * *", async () => {
  // Every 30 seconds
  const lastProcessed = await getLastProcessedTimestamp();
  
  const { data: newEvents } = await supabase
    .from('events')
    .select('*')
    .gt('created_at', lastProcessed)
    .order('created_at');
  
  if (!newEvents || newEvents.length === 0) return;
  
  // Update participant aggregations
  await updateParticipantStats(newEvents);
  
  // Update item (kanji) aggregations
  await updateItemStats(newEvents);
  
  // Trigger ML hooks if configured
  await triggerMLHooks(newEvents);
  
  // Update last processed timestamp
  await setLastProcessedTimestamp(newEvents[newEvents.length - 1].created_at);
});
```

**Deliverable**: Real-time analytics running

---

**KN-186: Live Analytics Dashboard**
- Learning curves (accuracy over time, by kanji)
- Session analytics (engagement, duration)
- Participant progress tracking
- WebSocket updates (no refresh needed)

**UI Components**:
```typescript
<AnalyticsDashboard studyId={studyId}>
  <LiveStatsCard>
    🟢 Live - 47 events/min
    12 active participants
    Last event: 5s ago
  </LiveStatsCard>
  
  <LearningCurvesChart>
    {/* Accuracy by exposure for each kanji */}
    {/* Updates automatically as new data arrives */}
  </LearningCurvesChart>
  
  <ParticipantProgressTable>
    {/* Live-updating participant stats */}
  </ParticipantProgressTable>
  
  <SessionAnalytics>
    {/* Engagement metrics, completion rates */}
  </SessionAnalytics>
</AnalyticsDashboard>
```

**Why**: Path 2 needs live monitoring during pilot

---

### Week 3: Extension Hooks

**KN-187: Custom Visualization Framework**
- Upload Python/JS visualization scripts
- Execute in sandbox
- Render Plotly/D3 output
- Save and share custom viz

**Researcher Workflow**:
```python
# Upload this script
def visualize(data, params):
    import pandas as pd
    import plotly.express as px
    
    # Data provided by platform
    df = pd.DataFrame(data['item_analytics'])
    
    # Custom analysis
    fig = px.scatter(
        df,
        x='estimated_difficulty',
        y='avg_accuracy',
        size='total_attempts',
        color='jlpt_level',
        hover_data=['item_id']
    )
    
    return {'type': 'plotly', 'spec': fig.to_json()}
```

**Database**:
```sql
CREATE TABLE custom_visualizations (
  id uuid PRIMARY KEY,
  study_id uuid REFERENCES studies(id),
  name text,
  script_code text,
  language text,
  required_data text[],  -- Which aggregations needed
  created_by uuid REFERENCES auth.users(id)
);
```

**Deliverable**: Researchers can add custom analytics

---

**KN-188: ML Pipeline Hooks**
- Upload ML model scripts (BKT, IRT, adaptive difficulty)
- Trigger: on_event, scheduled, on_demand
- Save predictions to database
- API for games to query predictions

**Researcher Workflow**:
```python
# BKT model example
def train(historical_events, params):
    """Train Bayesian Knowledge Tracing model"""
    from pyBKT.models import Model
    
    # Convert events to BKT format
    data = prepare_bkt_data(historical_events)
    
    # Train model
    model = Model(seed=params.get('seed', 42))
    model.fit(data=data)
    
    return {
        'model': model.serialize(),
        'metrics': {'log_likelihood': model.evaluate(data)}
    }

def predict(model_state, participant_events, context):
    """Estimate skill mastery"""
    model = Model.deserialize(model_state['model'])
    
    # Estimate current knowledge
    mastery = model.predict(participant_events)
    
    # Recommend next items (adaptive difficulty)
    recommendations = select_items_by_mastery(mastery, context)
    
    return {
        'skill_estimates': mastery,  # {item_id: P(mastery)}
        'recommended_items': recommendations
    }
```

**Database**:
```sql
CREATE TABLE ml_models (
  id uuid PRIMARY KEY,
  study_id uuid REFERENCES studies(id),
  name text,
  model_type text,
  script_code text,
  trigger_config jsonb,
  model_state jsonb,
  last_trained_at timestamptz
);

CREATE TABLE ml_predictions (
  id uuid PRIMARY KEY,
  model_id uuid REFERENCES ml_models(id),
  participant_id uuid REFERENCES participants(id),
  prediction_type text,
  prediction_value jsonb,
  confidence numeric,
  created_at timestamptz
);
```

**API for Games**:
```typescript
// Game client requests next item
GET /functions/v1/adaptive-recommendations?participant_id=P001

Response:
{
  "recommended_items": ["kanji_火", "kanji_水", "kanji_木"],
  "reasoning": {
    "kanji_火": { "mastery_estimate": 0.45, "optimal_difficulty": 0.6 },
    "kanji_水": { "mastery_estimate": 0.38, "optimal_difficulty": 0.5 }
  }
}
```

**Deliverable**: ML models can run and inform games

---

### Week 4: Path 2 Preparation

**KN-189: Platform Stability Monitoring**
- Automated health checks
- Error rate monitoring
- Performance metrics (response times, DB load)
- Alert system (email/Slack if issues)

**Metrics**:
- API uptime (target: 99.5%)
- Average response time (target: <500ms)
- Error rate (target: <1%)
- Database CPU/memory usage
- Event ingestion rate

**Deliverable**: Monitoring for live pilot

---

**KN-190: Path 2 Study Setup**
- Create real pilot study (not dummy)
- IRB approval documentation ready
- Consent forms integrated
- Participant onboarding flow
- Data collection protocols

**Deliverable**: Platform ready for real students

---

### Sprint 3 Deliverables

**Week 1-2**:
- ✅ Continuous aggregation engine
- ✅ Live analytics dashboards
- ✅ Real-time updates working

**Week 3**:
- ✅ Custom visualization framework
- ✅ ML pipeline hooks
- ✅ BKT example model

**Week 4**:
- ✅ Stability monitoring
- ✅ Path 2 study ready
- ✅ Platform production-ready

**Outcome**: Full analytics platform ready for Path 2 pilot

---

## Timeline Summary

| Sprint | Duration | Focus | Validation |
|--------|----------|-------|------------|
| Sprint 1 | 2 weeks | Event Management | Foundation exists |
| Sprint 2 | 2 weeks | Path 1 Support | Researchers validate usability |
| Sprint 3 | 3-4 weeks | Analytics Pipeline | Platform ready for Path 2 |

**Total**: 7-8 weeks to full analytics platform

---

## Deliberations & Design Decisions

### Decision 1: Why Three Sprints?

**Rationale**:
- Sprint 1: Core must exist before testing
- Sprint 2: Validate with researchers BEFORE building complex analytics
- Sprint 3: Build analytics informed by real feedback

**Alternative Considered**: Build everything upfront
- **Rejected**: Risk building wrong things without user feedback

---

### Decision 2: Dummy Data First, Real Pilot Second

**Rationale**:
- Path 1 tests usability without IRB
- Get feedback early
- Iterate before real students involved
- De-risks Path 2

**Alternative Considered**: Skip dummy data, go straight to pilot
- **Rejected**: Too risky, no iteration opportunity

---

### Decision 3: Full Analytics Before Path 2

**Rationale**:
- Path 2 validates measurement capability
- Need live dashboards during pilot
- ML hooks demonstrate adaptive potential
- Gap between Path 1 and Path 2 provides time

**Alternative Considered**: Basic monitoring only, add analytics later
- **Rejected**: Path 2 should demonstrate full capabilities

---

### Decision 4: Custom Viz/ML Hooks in Sprint 3

**Rationale**:
- Path 1 feedback might reveal needs
- Time available between validations
- Demonstrates extensibility (RQ5)
- Positions platform as research infrastructure

**Alternative Considered**: Defer to post-thesis
- **Rejected**: Missing key research contribution (extension points)

---

### Decision 5: Technology Probes Methodology

**Rationale**:
- Appropriate for incomplete prototypes
- Focus on "what do users need" not "does it work"
- Matches Path 1 goals
- EFLA inappropriate (designed for polished dashboards)

**Reference**: Hutchinson et al., CHI 2003

---

## Risks & Mitigations

### Risk 1: Path 1 Reveals Major Issues

**Mitigation**: 
- 2-week Sprint 2 allows fixes
- Prioritization framework (P0/P1/P2)
- Can extend Sprint 3 if needed

### Risk 2: Analytics Too Complex

**Mitigation**:
- Start simple (participant/item aggregations)
- Add complexity incrementally
- Custom hooks optional (not required)

### Risk 3: IRB Delays Path 2

**Mitigation**:
- Paths 0-1 sufficient for thesis
- Path 2 demonstrates capability, not efficacy
- Can defer to post-thesis

### Risk 4: Researchers Don't Provide Feedback

**Mitigation**:
- Structured tasks (guided evaluation)
- Compensation/acknowledgment
- Tier 1-3 recruitment strategy

---

## Success Criteria

### Sprint 1 (Event Management)
- ✅ Researchers can browse events
- ✅ Export works
- ✅ Schema management functional

### Sprint 2 (Path 1 Support)
- ✅ 5+ researchers complete evaluation
- ✅ Usability feedback collected
- ✅ P0/P1 issues addressed

### Sprint 3 (Analytics Pipeline)
- ✅ Real-time aggregations working
- ✅ Live dashboards update automatically
- ✅ Custom viz framework functional
- ✅ BKT model demonstrates ML hooks

### Path 2 Ready
- ✅ Platform stable (>99% uptime)
- ✅ Monitoring in place
- ✅ IRB approval obtained
- ✅ Analytics running continuously

---

## Handoff Notes

**Current State**: Sprint 1 in progress (event management)

**Next Steps**:
1. Complete Sprint 1 (event browser + schema management)
2. Generate realistic dummy data
3. Recruit Path 1 researchers (5-8 JLE experts)
4. Conduct Path 1 evaluation
5. Iterate based on feedback
6. Build analytics pipeline (Sprint 3)
7. Deploy for Path 2 pilot

**Key Files**:
- Sprint 1 plan: `EVENT-MANAGEMENT-SPRINT.md`
- This document: Overall roadmap
- Architecture diagram: `/uploads/scetchdiagram_ultra.png`

**Ready for Claude Code handoff!** 🚀
