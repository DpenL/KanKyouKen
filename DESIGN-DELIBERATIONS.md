# Design Deliberations Summary - Analytics Sprint Evolution

> **Date**: 2026-02-19
> **Context**: Planning analytics/ML pipeline sprint after understanding validation sequence
> **Outcome**: Three sequential sprints aligned with Path 1 → Path 2 validation

---

## Evolution of Understanding

### Initial Misunderstanding (My First Attempt)

**What I Proposed**:
- 4-week analytics sprint with full ML pipeline
- 13 tasks covering ETL, dashboards, custom viz, ML hooks
- Built everything before any testing
- Focus on sophisticated features (sandboxed execution, BKT models, adaptive recommendations)

**Problems**:
1. ❌ Too ambitious (4 weeks for production ML platform)
2. ❌ Wrong sequence (building analytics before validation)
3. ❌ Misaligned with pilot study needs (technology probe, not ML demo)
4. ❌ Ignored Path 1 evaluation timeline

---

### Second Iteration (After Timeline Check)

**What I Proposed**:
- 2-week "pilot study support" sprint
- Week 1: Platform health, data quality, study progress monitoring
- Week 2: Analytics schema creation, manual aggregation functions, documentation
- Deferred complex analytics to "next sprint"

**Problems**:
1. ✅ Right scope for immediate needs
2. ❌ Still missed Path 1 evaluation with dummy data
3. ❌ Didn't account for time between Path 1 and Path 2
4. ❌ Positioned analytics as "future work" instead of essential

---

### Final Understanding (After Clarification)

**Actual Sequence**:
```
Sprint 1 (NOW)           Sprint 2 (NEXT)         Sprint 3 (BEFORE Path 2)
Event Management  →      Path 1 Support   →      Analytics Pipeline
2 weeks                  2 weeks                 3-4 weeks

                 Path 1 Evaluation       Path 2 Pilot Study
                 (5-8 researchers,       (10-15 students,
                  dummy data,             real study,
                  Jan-Feb 2026)           Feb-Mar 2026)
```

**Key Insights**:
1. ✅ Path 1 tests with DUMMY DATA (no IRB needed)
2. ✅ Time between Path 1 and Path 2 for iteration
3. ✅ Analytics needed BEFORE Path 2 (not after)
4. ✅ Path 1 feedback informs Sprint 3 design

---

## Key Design Decisions

### Decision 1: Three Sequential Sprints

**Question**: Why not build everything in one big sprint?

**Options Considered**:
A) Single 6-week sprint with all features
B) Two sprints: Foundation + Analytics
C) Three sprints: Foundation → Path 1 Support → Analytics

**Chosen**: Option C

**Rationale**:
- Foundation must exist before anyone can test (Sprint 1)
- Researchers validate usability with dummy data (Sprint 2)
- Analytics built with real feedback (Sprint 3)
- Sequential dependencies ensure quality

**Trade-offs**:
- 👍 De-risks development (validate before building complex features)
- 👍 Incorporates user feedback early
- 👎 Longer total timeline (7-8 weeks vs 4-6 weeks)
- 👎 More planning overhead

---

### Decision 2: Dummy Data for Path 1

**Question**: Should Path 1 use real student data or dummy data?

**Options Considered**:
A) Wait for Path 2 pilot, no Path 1 evaluation
B) Real student data from previous studies
C) Generated dummy/sample data

**Chosen**: Option C

**Rationale**:
- Path 1 tests researcher workflow, NOT student learning
- No IRB needed for dummy data
- Can create realistic scenarios without privacy concerns
- Faster to generate than collecting real data

**Implementation**:
```python
generate_pilot_data():
  - 15 dummy participants (P001-P015)
  - 2,000-3,000 events over 2 weeks
  - Realistic accuracy patterns (80% ± 15%)
  - Multiple event types
  - Some dropouts (realistic)
```

**Trade-offs**:
- 👍 No IRB delays
- 👍 Control event patterns for testing
- 👍 Can test edge cases (dropouts, errors)
- 👎 Not real student behavior
- 👎 May miss unexpected patterns

---

### Decision 3: Full Analytics Before Path 2

**Question**: How much analytics to build before Path 2?

**Options Considered**:
A) Basic monitoring only (health checks)
B) Simple aggregations (manually triggered)
C) Full pipeline (continuous, real-time, ML hooks)

**Chosen**: Option C

**Rationale**:
- Path 2 validates "measurement capability"
- Need to demonstrate what platform CAN do
- Gap between Path 1 and Path 2 provides time (3-4 weeks)
- Research contribution includes extensibility (RQ5)

**What "Full Pipeline" Means**:
1. Continuous aggregation (auto-compute as events arrive)
2. Real-time dashboards (WebSocket updates)
3. Custom visualization hooks (researcher-defined)
4. ML pipeline framework (BKT example)

**Trade-offs**:
- 👍 Demonstrates platform capabilities
- 👍 Path 2 pilot gets full experience
- 👍 Research contribution clear (extension points)
- 👎 3-4 weeks of work
- 👎 Complexity risk (may have bugs)

---

### Decision 4: Technology Probes Methodology

**Question**: How to evaluate platform with researchers?

**Options Considered**:
A) Standard usability testing (SUS, task completion time)
B) EFLA framework (Educational Feed for Learning Analytics)
C) Technology Probes (Hutchinson et al., 2003)

**Chosen**: Option C (Technology Probes)

**Rationale**:
- Designed for incomplete prototypes
- Focuses on "what do users need" not "does it work perfectly"
- Deployed in authentic context (researcher workflow)
- Inspires iteration (formative, not summative)

**Why NOT EFLA**:
- EFLA designed for polished end-user dashboards
- Assumes complete product ready for learners
- KanKyouKen is research infrastructure, not student-facing

**Implementation**:
- 5-8 JLE researchers
- Structured tasks (browse, export, schema)
- Think-aloud protocol
- Semi-structured interviews
- Heuristic evaluation (Nielsen)

**Trade-offs**:
- 👍 Appropriate for prototype stage
- 👍 Generates qualitative insights
- 👍 Methodologically sound (published framework)
- 👎 Subjective feedback (not quantitative metrics)
- 👎 Small sample (5-8 researchers)

---

### Decision 5: ML Hooks in Sprint 3

**Question**: Are ML hooks essential or nice-to-have?

**Options Considered**:
A) Skip ML hooks, focus on dashboards
B) Document ML architecture, don't implement
C) Build ML framework with BKT example

**Chosen**: Option C

**Rationale**:
- RQ5 asks about extensibility
- Research contribution is "infrastructure for learning analytics"
- ML hooks demonstrate what's possible
- BKT is expected in kanji learning research
- Time available (week 3 of Sprint 3)

**Scope**:
- NOT: Production ML platform
- YES: Extension point demonstration
- YES: BKT working example
- YES: API for games to query predictions

**Trade-offs**:
- 👍 Demonstrates research vision
- 👍 Positions platform as ML-ready
- 👍 Addresses future RQs (RQ-A, RQ-D)
- 👎 Adds complexity
- 👎 May not be used in Path 2 pilot

---

## Validation Alignment

### Path 1: Researcher Workflow Evaluation

**What Sprint 2 Enables**:
- Sample study with realistic data ✓
- Event browser tested ✓
- Export functionality validated ✓
- Schema documentation assessed ✓

**Research Questions Addressed**:
- RQ3: Researcher usability
- RQ4: Construct flexibility
- RQ5: Cross-study extensibility

---

### Path 2: Pilot Learning Study

**What Sprint 3 Enables**:
- Real-time monitoring during pilot ✓
- Continuous data collection ✓
- Live analytics (learning curves) ✓
- Platform stability validation ✓
- Measurement capability demonstration ✓

**Research Questions Addressed**:
- RQ6: Pilot feasibility
- RQ1: Data schema adequacy (validated with real use)
- RQ2: Ethics compliance (tested in real study)

---

## Risk Mitigations

### Risk 1: Path 1 Reveals Platform Broken

**Mitigation**:
- Sprint 2 Week 2 dedicated to fixes
- Prioritization framework (P0/P1/P2)
- Can delay Sprint 3 if needed

**Contingency**:
- If major refactor needed, extend timeline
- Paths 0-1 still sufficient for thesis

---

### Risk 2: Analytics Too Complex to Build

**Mitigation**:
- Start simple (participant/item aggregations)
- Incremental complexity (basic → custom viz → ML)
- Custom hooks optional (core analytics required)

**Contingency**:
- Ship basic analytics, document extension points
- Demonstrate architecture even if not fully implemented

---

### Risk 3: IRB Delays Path 2

**Mitigation**:
- Path 2 not required for thesis
- Technology probe reframing (capability, not efficacy)
- Can defer to post-graduation

**Contingency**:
- Paths 0-1 validate platform
- Sprint 3 still valuable (demonstrates capabilities)

---

### Risk 4: Researchers Don't Provide Feedback

**Mitigation**:
- Structured tasks (clear expectations)
- Compensation/acknowledgment
- Multiple recruitment tiers (Tier 1-3)

**Contingency**:
- Expert heuristic evaluation (Nielsen)
- Fewer participants still valid (qualitative)

---

## Timeline Justification

### Why 2 Weeks for Sprint 1?

**Tasks**:
- Event browser (3-4 days)
- Filters + pagination (2-3 days)
- Schema management (3-4 days)
- Export + payload inspector (2-3 days)

**Total**: 10-14 task-days = ~2 weeks with buffer

---

### Why 2 Weeks for Sprint 2?

**Week 1**:
- Generate dummy data (2 days)
- Study overview dashboard (2 days)
- Path 1 testing guide (1 day)

**Week 2**:
- Conduct Path 1 evaluation (5-8 sessions, 1-2 days)
- Analyze feedback (1 day)
- Fix P0/P1 issues (2-3 days)
- Update docs (1 day)

**Total**: 10 task-days = 2 weeks

---

### Why 3-4 Weeks for Sprint 3?

**Week 1-2**: Core analytics
- Continuous aggregation (3 days)
- Live dashboards (4 days)
- WebSocket integration (1 day)

**Week 3**: Extension hooks
- Custom viz framework (3 days)
- ML pipeline (2 days)

**Week 4**: Path 2 prep
- Monitoring (2 days)
- Study setup (2 days)
- Testing (1 day)

**Total**: 18-20 task-days = 3-4 weeks

---

## Alternative Approaches Rejected

### Alternative 1: Build Analytics First, Validate Later

**Why Rejected**:
- Risk building wrong features
- No user feedback to guide design
- Technology probe methodology requires deployment before iteration

---

### Alternative 2: Skip Path 1, Go Straight to Path 2

**Why Rejected**:
- Too risky with real students
- No iteration opportunity
- Ethics concerns (deploying unvalidated platform)
- Wastes IRB time if platform unusable

---

### Alternative 3: Minimal Analytics, Defer ML

**Why Rejected**:
- Missing research contribution (RQ5: extensibility)
- Can't demonstrate full capabilities in Path 2
- Gap time available (why not use it?)

---

### Alternative 4: Build Everything in Parallel

**Why Rejected**:
- Can't incorporate Path 1 feedback
- High coordination overhead
- Risk of wasted work

---

## Success Metrics

### Sprint 1 Success
- ✅ Event browser functional
- ✅ Export works
- ✅ Schema management works
- ✅ Ready for Path 1 testing

### Sprint 2 Success
- ✅ 5+ researchers complete evaluation
- ✅ Feedback collected and categorized
- ✅ P0/P1 issues fixed
- ✅ Documentation updated

### Sprint 3 Success
- ✅ Analytics run continuously
- ✅ Dashboards update in real-time
- ✅ Custom viz working (at least one example)
- ✅ BKT model demonstrates ML hooks

### Path 2 Ready
- ✅ Platform >99% uptime
- ✅ Monitoring in place
- ✅ Real study configured
- ✅ IRB approved

---

## Conclusion

**Final Approach**:
- Three sequential sprints (7-8 weeks total)
- Path 1 validation with dummy data (de-risks Path 2)
- Full analytics pipeline before Path 2 (demonstrates capabilities)
- Technology probe methodology (appropriate for prototype)

**Key Trade-off**:
- Longer timeline BUT higher quality and lower risk
- Sequential validation ensures each layer solid
- User feedback incorporated before complex features

**Research Contribution**:
- Platform validated by researchers (Path 1)
- Capabilities demonstrated in real study (Path 2)
- Extension points show future potential (custom viz, ML hooks)
- Methodologically sound (FAIR, Technology Probes, Expert Heuristics)

---

**Ready for handoff to Claude Code!** 🚀

All deliberations documented, decisions justified, risks mitigated.
