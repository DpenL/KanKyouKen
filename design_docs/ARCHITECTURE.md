# KanKyouKen Architecture

**Status**: Active development, preparing for pilot studies
**Last Updated**: December 2025

---

## Design Principles

### 1. Multi-Tenant by Design
Every event is tagged with `institution`, `project`, `study` identifiers. Supabase RLS policies enforce row-level security - researchers only see their own project data, participants only see their own data.

**Why**: Enables multiple universities/research projects to share infrastructure safely while maintaining strict data separation.

**Research backing**: MORF privacy-preserving framework (Gardner et al., 2018)

### 2. Open Game Data Alignment
Follows Open Game Data principles (Gagnon & Swanson, 2023):
- Standardized event format with versioning
- Schema evolution support
- Documentation for reproducibility
- Future open data releases with anonymization

**Why**: Research requires reproducibility across time and studies. Game mechanics evolve during development, but we need to analyze data from different versions together.

### 3. Privacy by Default
- Pseudonymization: Separate tables for identifiable data (`auth.users`) vs. gameplay data (`participants`)
- Link table (`study_roles`) controlled by researcher, not automated
- Supports consent withdrawal with cascade deletion
- GDPR "right to be forgotten" compliance

**Why**: Research ethics boards require de-linkage capability. Open data release is easier without re-identification risk.

**Trade-off**: More complex to link data, but necessary for ethics compliance.

### 4. Local/Remote Parity
Local Supabase setup mirrors production. Schema parity checking validates consistency. CI pipeline ensures everything works identically.

**Why**: Catch environment issues early, reproducible development across team members.

### 5. Extension Over Specification
Platform doesn't force a fixed pedagogical model. Studies can define custom event types, metadata fields, and constructs while sharing core infrastructure.

**Why**: Different researchers have different needs. Core schema + extension points > rigid one-size-fits-all.

---

## Current Architecture (December 2025)

### ✅ Implemented

**Core Infrastructure** (Epic 1 - Complete):
- Supabase local development setup
- Docker-based stack
- Makefile workflows (`make supabase-start`, `make test`, etc.)
- Schema parity checking

**Database Schema**:
- Core tables: `projects`, `studies`, `participants`, `sessions`, `events`
- Supporting: `event_schemas`, `audit_log`
- RLS policies for tenant separation
- JWT authentication

**Edge Functions**:
- `/event-collector` - Event ingestion with validation
- JWT verification with custom claims
- Basic error handling

**Testing Infrastructure**:
- Python test suite (pytest)
- Integration tests for event collection
- Schema parity tests
- CI/CD pipeline (GitHub Actions)

### 🚧 In Progress

**Data Schema & Governance** (Epic 2):
- Schema versioning strategy
- Event validation rules
- Data quality checks

**Identity & Access** (Epic 3):
- Role-based access control
- Consent management
- User registration flows

**API Layer** (Epic 4):
- Query endpoints for researchers
- Filtering and pagination
- Export formats

### 📋 Planned

**Event Pipeline & Analytics** (Epic 5):
- ETL jobs for analysis
- Data cleaning and validation
- Anonymization pipelines

**Research Dashboard** (Epic 6):
- Teacher/researcher UI
- Analytics visualization
- Study progress tracking

**Compliance & Integration** (Epic 7):
- Ethics documentation
- Deployment infrastructure
- Multi-institutional support

---

## Tech Stack

| Component | Technology | Version/Notes |
|-----------|------------|---------------|
| Database | Postgres via Supabase | 15.1 explicitly |
| Auth | Supabase Auth | JWT with custom claims |
| API | Edge Functions (Deno/TypeScript) | Hot reload in development |
| Analytics | Python | pandas, scipy, sklearn |
| Testing | pytest + Deno test | Integration + unit |
| CI/CD | GitHub Actions | Schema parity, test suite |
| Development | WSL + Docker + Makefile | Local Supabase stack |

---

## System Components

See `SYSTEM-DIAGRAM.md` for visual architecture.

**Key Data Flow**:
```
Game Client → JWT Auth → Edge Function → Validation → Postgres (RLS) → Analytics
```

**Security Layers**:
1. JWT validation (tenant claims)
2. Edge Function validation (schema, auth)
3. RLS policies (database-level isolation)
4. Audit logging (compliance trail)

---

## Extension Patterns

### Adding a New Study

1. **Database**: Insert row into `studies` table with `project_id`, `schema_ref`, `retention_policy`
2. **Events**: No code changes needed - event types defined per study
3. **Access**: RLS policies automatically enforce isolation
4. **Analytics**: Query events filtered by `study_id`

### Adding a New Event Type

1. **Schema**: Define in `event_schemas` table with JSON Schema validation
2. **Client**: Send events matching schema
3. **Validation**: Edge Function validates against schema version
4. **Storage**: Events stored with `schema_id` reference

### Adding a New Game Client

1. **Auth**: Obtain JWT with tenant claims (`project_id`, `study_id`)
2. **Events**: POST to `/event-collector` with standardized format
3. **Offline**: Queue events locally, retry on connection
4. **SDK**: Optional - reusable client library (Phase 4+)

---

## Design Rationale

### Why RLS over Application-Layer Filtering?

**Pros**:
- Database enforces security even if application has bugs
- Audit queries benefit from same security guarantees
- Simpler codebase - security logic in one place (Postgres policies)

**Cons**:
- More complex policy design
- Harder to debug permission issues

**Decision**: Security at database level is more robust for research data.

### Why Edge Functions over Client-Side Validation?

**Pros**:
- Untrusted clients (anyone can modify game code)
- Centralized validation logic (update once, affects all clients)
- Rate limiting and abuse prevention
- Standardized error responses

**Cons**:
- Network latency
- Can't log offline events (addressed in Phase 4 SDK with retry queue)

**Decision**: Server-side validation necessary for data integrity.

### Why Separate Participants Table?

**Pros**:
- GDPR compliance (right to be forgotten)
- De-identification for open data release
- Consent withdrawal triggers cascade deletion

**Cons**:
- More complex to link data
- Extra table to manage

**Decision**: Ethics compliance outweighs complexity.

---

## Uncertainties & Future Decisions

**Open Questions**:
- Optimal event batching strategy (latency vs. volume)
- Deep Knowledge Tracing vs. BKT for small samples (N<50)
- Real-time analytics vs. batch processing trade-offs
- Game client SDK language (Python vs. Dart vs. both)
- Frontend framework for research dashboard (Streamlit vs. custom)

**Evolving Areas**:
- Event schema conventions (still being refined)
- Analytics pipeline architecture (ETL patterns TBD)
- Multi-institutional deployment strategy (staging → production path)
- Offline event queueing (retry logic, conflict resolution)

**Timeline Constraints**:
- Platform must be study-ready by December 29, 2025
- Feature scope limited by solo development + research responsibilities
- Ethics approval timeline ~6 weeks (may extend past deadline)

---

## Key Constraints

### Performance
- Makefile operations should be fast (< 1 min for full stack start)
- CI should complete in < 5 minutes
- Event ingestion should handle bursts from multiple clients

### Compatibility
- WSL development environment support
- Postgres version consistency (15.1)
- Supabase CLI version alignment

### Security
- Never commit secrets (`.env` gitignored)
- JWT secrets managed via Supabase dashboard or environment
- RLS policies enforced at database level

### Research Ethics
- Pseudonymization by default
- Consent withdrawal mechanisms
- Audit trail for compliance
- Multi-tenant isolation

---

## References

**Core Methodology**:
- Gagnon & Swanson (2023) - Open Game Data infrastructure
- Mislevy et al. (2003) - Evidence-Centered Design
- Gardner et al. (2018) - MORF privacy framework

**Related Docs**:
- `SYSTEM-DIAGRAM.md` - Visual architecture
- `ROADMAP.md` - Development phases
- `supabase/migrations/` - Source of truth for database schema
- `Makefile` - Development workflows

---

**For Questions**: See project documentation or reach out to research team.
