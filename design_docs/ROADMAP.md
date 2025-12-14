# KanKyouKen Development Roadmap

**Timeline**: Short-term (8 weeks) → Medium-term (2026) → Long-term (2027+)
**Critical Milestone**: December 29, 2025 - Platform study-ready for pilot research
**Current Status**: Week 5-6 (mid-December 2025)
**Living Document**: This roadmap evolves as the project develops

---

## Development Philosophy

**Core Priorities**:
1. **Research-driven**: Every feature supports answerable research questions
2. **Ethics-first**: Privacy, consent, and compliance from day one
3. **Extensible architecture**: Build for multiple games, studies, institutions
4. **Testable > Comprehensive**: Validation and iteration over perfection
5. **Study-ready > Feature-complete**: Pilot deployment is the goal

**Timeline Reality**: Solo developer + research responsibilities = ruthless prioritization

---

## Short-Term: 8-Week Foundation (Nov-Dec 2025)

### Phase 1 (Weeks 1-2): Core Infrastructure ✅ COMPLETE

**Goal**: Stable local development environment with event collection

**Completed**:
- ✅ Database schema (participants, projects, events, sessions)
- ✅ Supabase integration (Edge Functions → Postgres pipeline)
- ✅ Logging and monitoring (function_logs, audit_log tables)
- ✅ Local development setup (Docker + Makefile workflows)
- ✅ CI/CD pipeline (GitHub Actions, schema parity checks)
- ✅ Basic test suite (pytest, integration tests)

**Deliverables**:
- Reproducible local setup (`make supabase-start`)
- Event collection endpoint (`/events`)
- Test infrastructure
- Schema parity validation

**Status**: Complete (November 2025)

---

### Phase 2 (Weeks 3-4): Event Processing Pipeline 🚧 IN PROGRESS

**Goal**: Robust event validation and schema evolution support

**Tasks**:
- 🚧 Event schema conventions (standardized format)
- 🚧 JSON Schema validation rules
- 📋 Schema versioning strategy
- 📋 Validator module with comprehensive tests
- 📋 Error handling (400 Bad Request for malformed events)
- 📋 Schema evolution documentation

**Deliverables**:
- Standardized event format specification
- JSON Schema validator (TypeScript)
- Validation test suite
- Schema versioning documentation
- Error response patterns

**Current Blockers/Decisions Needed**:
- Validation strictness level (strict vs. permissive approach)
- Schema versioning mechanism (in event vs. separate table)
- Backward compatibility requirements (how far back to support?)

---

### Phase 3 (Weeks 5-6): Data Access & Analytics API 📋 PLANNED

**Goal**: Researchers can query and export their study data

**Tasks**:
- 📋 New Edge Function: `/query-events`
- 📋 Query filters: project_id, study_id, date_range, event_type, participant_id
- 📋 Pagination and result limiting
- 📋 Export formats (JSON, CSV for analysis)
- 📋 Analytics module (event summaries, participant stats)
- 📋 API documentation with examples
- 📋 RLS enforcement for multi-tenant queries

**Deliverables**:
- Query API with tenant isolation
- Export utilities for research workflows
- Basic analytics module (counts, summaries)
- API reference documentation

**Technical Risks**:
- RLS complexity with filtered queries
- Performance with large event volumes (N>10k events)
- Export format requirements still evolving

---

### Phase 4 (Weeks 7-8): Research & Deployment Prep 📋 PLANNED

**Goal**: Platform ready for pilot studies, deployable to staging

**Tasks**:
- 📋 Game client SDK prototype (Python or Dart)
- 📋 SDK features: auth, event posting, retry logic, offline queue
- 📋 Dockerized deployment (docker-compose.yml for staging)
- 📋 Analytics dashboard draft (Streamlit or Supabase Studio)
- 📋 Expanded documentation (setup guides, API reference, extension patterns)
- 📋 Ethics compliance validation (review against Waseda requirements)
- 📋 Staging environment setup (Supabase project)

**Deliverables**:
- Reusable client SDK (one language initially)
- Deployment-ready infrastructure
- Basic researcher dashboard
- Complete developer documentation
- Ethics application support materials

**Milestone Success Criteria** (End of 8 weeks):
- ✅ Event logging API with full test coverage
- ✅ Consistent schema for game telemetry
- ✅ Query/export interface for researchers
- ✅ Deployable to staging environment
- ✅ Documentation for extension and integration
- ✅ Research-ready platform for pilot studies

---

## Medium-Term: Research Validation (2026)

### Q1 2026: Evaluation & Iteration

**Researcher Usability Evaluation** (No IRB required):
- **Participants**: 3-5 Japanese language education researchers
- **Method**: Hands-on testing + structured questionnaire
- **Focus Areas**:
  - Event log interpretation and clarity
  - Query and export functionality
  - Documentation completeness
  - Integration effort for new studies
- **Deliverable**: Questionnaire results + prioritized iteration plan

**Platform Refinement**:
- Iterate based on usability feedback
- Fix critical bugs and usability issues
- Enhance documentation and examples
- Prepare for ethics-approved pilot

---

### Q2 2026: Pilot Study (IRB Required)

**Ethics Approval Timeline**:
- Application submission (Jan 2026)
- CJL administrative review (~2 weeks)
- Ethics Committee review (~4 weeks)
- Total: ~6 weeks from submission to approval

**Pilot Study Design**:
- **Participants**: 10-15 Waseda students (exchange students, convenience sampling)
- **Duration**: Multi-day intervention (minimum 3 days, ideally 1 week)
- **Design**: Pre-test (JLPT-style) → Production vs Recognition tasks → Event logging → Post-test
- **Primary RQ**: Do production tasks yield different learning outcomes than recognition tasks?
- **Variables**: Accuracy (pre/post), reaction time, error patterns, task completion
- **Goal**: Validate event-based stealth assessment correlates with traditional testing (r>0.6 target)

**Deliverables**:
- Platform validation data
- Pilot feasibility results
- Methodological refinements
- Ethics compliance demonstration

---

### Q3-Q4 2026: Primary Study & Publications

**Primary Study** (N=30-50):
- RadicalFighters vs traditional textbook methods
- Multi-week intervention (4-6 weeks)
- Pre/post/delayed testing
- Full event logging and analysis
- Expected effect size: d=0.4-0.6 (based on Rose 2017 + Clark 2016 meta-analysis)

**Publications**:
1. **System Paper**: KanKyouKen architecture and Open Game Data implementation
   - Target: Journal of Computer Supported Collaborative Learning (JCSCL) or similar
   - Focus: Multi-tenant architecture, privacy-preserving analytics, extensibility
2. **Game Paper**: RadicalFighters design and pilot results
   - Target: JALT CALL Journal or Learning Analytics & Knowledge (LAK) conference
   - Focus: Radical-based mechanics, stealth assessment, learning outcomes
3. **MSc Thesis**: Complete thesis at TUM
   - Integration of game design, learning analytics, kanji pedagogy
   - Empirical validation of radical-focused approach

**Platform Milestones**:
- Add second game to KanKyouKen (validate multi-game architecture)
- Open-source release of KanKyouKen core
- Documentation for researchers to add their own games
- First external researcher using platform

---

## Long-Term: Scaling & Ecosystem (2027+)

### RadicalFighters: Commercial Product

**Product Development**:
- Full feature set (adaptive scheduling, leaderboards, social features)
- Multi-platform deployment (iOS, Android, Web)
- Polished UI/UX (professional design, animations, feedback)
- Content expansion (JLPT N5-N3 coverage, 1000+ kanji)

**Business Model**:
- Freemium or subscription ($5-10/month)
- Educational licensing for schools/universities
- Research partnership tier (data sharing agreements)

**Go-to-Market**:
- App Store / Google Play launch
- Marketing to Japanese language learners (Reddit, Discord, language learning communities)
- Partnerships with language schools
- Academic endorsements from research outcomes

**Success Metrics**:
- 1,000+ active users (Year 1)
- 10,000+ active users (Year 2-3)
- Profitability or VC funding round
- Continued research integration

---

### KanKyouKen: Multi-Institutional Research Hub

**Ecosystem Growth**:
- **Multiple Games**: 3-5 kanji learning games using platform
- **Multiple Institutions**: 5-10 universities across countries
- **Longitudinal Studies**: Multi-year datasets (largest kanji learning corpus)
- **Cross-L1 Research**: Chinese L1 vs non-kanji background comparisons

**Platform Maturity**:
- Advanced analytics pipeline (automated ETL, quality checks)
- Real-time dashboards for teachers and researchers
- Researcher onboarding toolkit (templates, examples, support)
- Annual Open Game Data releases (anonymized, IRB-approved)

**Community Building**:
- Workshops at conferences (LAK, AIED, JALT)
- Research collaborative network
- Grant funding for platform maintenance and development
- Open-source contributor community

**Funding Model**:
- Research grants (NSF, JSPS, EU Horizon)
- Institutional subscriptions (universities pay for hosting/support)
- Conference workshop fees
- Consulting/customization services

---

### Academic & Research Trajectory

**PhD Pathway** (2026-2030):
- Focus: Learning analytics, adaptive serious games, cross-linguistic transfer
- Potential institutions: TUM, Waseda, Carnegie Mellon, Stanford
- Dissertation: Longitudinal kanji acquisition modeling using multi-game data

**Postdoc** (2030-2032):
- Focus: Computational modeling of L2 writing system acquisition
- Potential labs: Field Day Lab (Wisconsin), CMU HCII, Waseda CJL
- Research output: Cross-L1 learning models, validated instructional interventions

**Academic Position** (2032+):
- Target: Tenure-track position combining games, learning analytics, language education
- Potential departments: Educational Technology, Learning Sciences, Applied Linguistics
- Research program: Data-driven serious games for language learning

**Research Contributions**:
- Largest longitudinal kanji learning dataset
- Validated radical-based pedagogy with empirical evidence
- Cross-L1 learning models (Chinese vs non-kanji background)
- Open-source replication package for educational game research

---

## Scaling Considerations

### User Growth Projections

**Phase 1** (2026): 10-50 users (pilot studies)
- Infrastructure: Single Supabase project
- Hosting: Supabase free tier or Pro ($25/month)
- Monitoring: Basic logs, manual review

**Phase 2** (2027): 50-500 users (primary studies + early commercial)
- Infrastructure: Staging + Production Supabase projects
- Hosting: Supabase Pro + custom Postgres if needed
- Monitoring: Automated alerts, error tracking (Sentry)
- Analytics: Basic dashboards (Streamlit)

**Phase 3** (2028-2029): 500-5,000 users (commercial growth)
- Infrastructure: Load-balanced Edge Functions, read replicas
- Hosting: Supabase Pro + custom infrastructure
- Monitoring: Full observability stack (DataDog, Grafana)
- Analytics: Production dashboards (React + D3.js)

**Phase 4** (2030+): 5,000-100,000+ users (multi-institutional scale)
- Infrastructure: Distributed architecture, multi-region deployment
- Hosting: Cloud-native (AWS/GCP) with Supabase migration strategy
- Monitoring: Enterprise observability, SRE team
- Analytics: Real-time analytics pipeline, ML inference

---

### Stack Evolution

**Current Stack** (2025-2026):
- **Backend**: Supabase (Postgres 15.1, Auth, Edge Functions)
- **API**: Deno/TypeScript Edge Functions
- **Analytics**: Python (pandas, scipy, sklearn, Jupyter)
- **Frontend**: None yet (research tools CLI/notebooks)
- **Testing**: pytest, Deno test, GitHub Actions

**Medium-Term Stack** (2027-2028):
- **Backend**: Supabase + custom services (as needed)
- **API**: Edge Functions + dedicated API servers (FastAPI/Express) for complex queries
- **Analytics**: Python + PostgreSQL analytics DB (read replica)
- **Frontend**: Research dashboard (React or Streamlit), Admin panel
- **Game Clients**: Flutter (RadicalFighters) + SDK support for other frameworks
- **Testing**: Full E2E suite, performance testing, load testing

**Long-Term Stack** (2029+):
- **Backend**: Hybrid (Supabase + Kubernetes for custom services)
- **API**: Microservices architecture (API gateway, separate services)
  - Auth service (maintains Supabase)
  - Event ingestion service (high-throughput, message queue)
  - Query service (optimized read replicas)
  - Analytics service (batch + streaming)
- **Analytics**: Data warehouse (BigQuery/Redshift), Spark for large-scale processing
- **Frontend**: Production-grade React apps (researcher portal, teacher dashboard, admin)
- **ML Pipeline**: TensorFlow/PyTorch for adaptive scheduling, real-time inference
- **Infrastructure**: Terraform/Kubernetes, multi-cloud deployment
- **Observability**: Full stack monitoring, distributed tracing

**Key Architecture Decisions Ahead**:
1. **Event ingestion scaling**: Message queue (RabbitMQ/Kafka) vs Edge Functions
2. **Analytics architecture**: Batch (nightly jobs) vs streaming (real-time)
3. **Frontend framework**: React ecosystem vs Vue vs Svelte
4. **ML deployment**: Cloud ML services vs self-hosted inference
5. **Multi-tenancy**: Shared tables + RLS vs separate schemas vs separate databases

**Technology Exploration Areas**:
- Real-time collaboration (WebSockets for live dashboards)
- Edge computing (CloudFlare Workers for global low-latency)
- GraphQL (flexible queries vs REST)
- Serverless ML (AWS SageMaker, GCP AI Platform)

---

## Feature Roadmap

### Research Features (Priority)

**2026 H1**:
- ✅ Event collection with schema validation
- ✅ Query API for researchers
- ✅ Export utilities (CSV, JSON)
- 📋 Basic analytics dashboard
- 📋 Consent management workflow

**2026 H2**:
- Researcher portal (study management, participant tracking)
- Advanced filtering and aggregation
- Data quality reports (missing data, outliers)
- Batch anonymization jobs for open data release

**2027+**:
- Real-time dashboards (live participant progress)
- Automated report generation (weekly summaries)
- Cross-study analytics (compare interventions)
- ML-powered insights (pattern detection, anomaly alerts)

---

### Platform Features (Extensibility)

**2026**:
- Multi-game support (2+ games on platform)
- Custom event type registration
- Schema versioning and migration tools
- Developer documentation and SDK

**2027**:
- Multi-institutional deployment (5+ universities)
- Institutional admin panel
- Bulk participant management
- API rate limiting and quotas

**2028+**:
- Marketplace (researchers discover games)
- Plugin system (custom analytics modules)
- White-label deployments (universities run own instances)
- Federation (multiple KanKyouKen instances share data)

---

### Game Client Features (RadicalFighters)

**2026** (Research focus):
- Radical-based battle system
- Handwriting recognition (basic)
- Offline mode (play without network)
- Event logging integration

**2027** (Commercial polish):
- Adaptive difficulty (BKT-driven)
- Social features (leaderboards, friends)
- Content expansion (JLPT N5-N3)
- Polished UI/UX

**2028+**:
- Cross-platform sync (play on multiple devices)
- Teacher tools (assign exercises, track class)
- Advanced handwriting (stroke order feedback)
- Personalized learning paths

---

## Risk Management

### Technical Risks

**Scalability**:
- **Risk**: Platform can't handle 1000+ concurrent users
- **Mitigation**: Load testing, incremental scaling, horizontal scaling architecture
- **Fallback**: Limit user growth, queue-based registration

**Data Quality**:
- **Risk**: Event data incomplete or inconsistent
- **Mitigation**: Schema validation, data quality dashboards, automated checks
- **Fallback**: Manual data cleaning, participant re-testing

**Privacy Breach**:
- **Risk**: Accidental exposure of participant data
- **Mitigation**: RLS testing, security audits, compliance reviews
- **Fallback**: Incident response plan, ethics board notification

---

### Research Risks

**IRB Delays**:
- **Risk**: Ethics approval takes longer than expected
- **Mitigation**: Early application, proactive communication, alternative study designs
- **Fallback**: Researcher usability evaluation only (no IRB needed)

**Null Results**:
- **Risk**: RadicalFighters shows no advantage over traditional methods
- **Mitigation**: Multiple outcome measures, process analysis, iterative refinement
- **Fallback**: Platform validation still valuable, pivot to different intervention

**Participant Recruitment**:
- **Risk**: Can't recruit enough participants
- **Mitigation**: Multiple recruitment channels, incentives, partnership with language schools
- **Fallback**: Smaller N, descriptive study, qualitative focus

---

### Business Risks

**Market Fit**:
- **Risk**: Commercial product doesn't attract users
- **Mitigation**: User research, beta testing, iterative design, marketing
- **Fallback**: Open-source community version, focus on research platform

**Funding**:
- **Risk**: Can't sustain development without revenue or grants
- **Mitigation**: Diversified funding (grants + subscriptions + consulting)
- **Fallback**: Volunteer maintenance, institutional partnerships

---

## Success Metrics

### Short-Term (2025-2026)

**Platform**:
- ✅ 100% test coverage for core event pipeline
- ✅ <5 min CI/CD pipeline duration
- ✅ Schema parity maintained between local and remote
- 📋 10+ researchers can onboard without help
- 📋 2+ games successfully integrated

**Research**:
- Pilot study completed (N=10-15)
- r>0.6 correlation between stealth assessment and traditional testing
- Ethics approval obtained
- 2+ publications submitted

---

### Medium-Term (2027-2029)

**Platform**:
- 5+ institutions using KanKyouKen
- 100,000+ events collected across studies
- 99.9% uptime for production environment
- 10+ games on platform
- 1+ open data release

**Research**:
- Primary study completed (N=50+)
- Cross-L1 study initiated
- 5+ publications in top-tier venues
- PhD program enrollment

**Commercial**:
- RadicalFighters: 1,000+ active users
- Revenue: $5,000+/month or VC funding

---

### Long-Term (2030+)

**Platform**:
- 20+ institutions, 10+ countries
- Multi-year longitudinal datasets
- Annual research collaborative meetings
- 50+ published studies using KanKyouKen data

**Research**:
- PhD completion
- Postdoc position at top lab
- Tenure-track job offers
- Recognized expert in learning analytics + serious games

**Commercial**:
- RadicalFighters: 10,000+ active users
- Sustainable business or successful exit
- Industry-standard kanji learning tool

---

## Open Questions & Future Decisions

**Technical**:
- Optimal event batching strategy (latency vs volume trade-offs)
- Real-time analytics vs batch processing (cost-benefit analysis)
- Frontend framework choice (React ecosystem vs alternatives)
- Deep Knowledge Tracing viability for small samples (N<100)
- Message queue necessity (when to introduce Kafka/RabbitMQ)

**Research**:
- Cross-L1 study design (Chinese L1 vs others)
- Longitudinal study timeline (how many years?)
- Multi-game intervention comparisons
- Transfer studies (kanji → Chinese characters)

**Business**:
- Freemium vs subscription pricing
- Open-core vs fully open-source
- Institutional licensing model
- VC funding vs bootstrapped growth

**Organizational**:
- Team expansion timeline (when to hire?)
- Contributor onboarding (when to accept external contributions?)
- Governance model (benevolent dictator vs committee?)

---

## Conclusion

This roadmap represents the current vision for KanKyouKen and RadicalFighters, spanning immediate technical goals (8 weeks), research validation (2026), and long-term scaling to a multi-institutional ecosystem supporting thousands of users.

**Key Principles**:
- Start small, scale thoughtfully
- Research validation before commercial growth
- Extensible architecture from day one
- Ethics and privacy by design
- Open science and reproducibility

**Next Review**: After December 29, 2025 milestone completion

**Living Document**: This roadmap will evolve based on research outcomes, technical constraints, and community feedback. Updates will be tracked in version control.

---

**For questions, contributions, or collaboration**: See project documentation or contact the research team.
