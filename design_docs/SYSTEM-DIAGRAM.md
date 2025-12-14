# KanKyouKen System Architecture Diagram

**Last Updated**: December 2025
**Source**: System design (October 2025) + ongoing development

---

## Visual Overview

```mermaid
flowchart TB  
%% ========= FRONTENDS =========  
subgraph F["Frontends"]  
  F1["Research Dashboard\n(teacher / researcher UI)"]  
  F2["Project Management UI\n(create projects, assign roles)"]  
  F3["Participant Portal\n(signup, login, consent)"]  
end

%% ========= CLIENTS =========  
subgraph C["Kanji Learning Clients (Games, Apps)"]  
  C1["App functions:\n• authenticate with token\n• send events (POST /events)\n• request study schedule (future)"]  
end

%% ========= BACKEND =========  
subgraph B["Backend (Supabase Hosted)"]  
  direction TB

  subgraph AUTH["User & Consent Management"]  
    A1["auth_users\n(researchers, supervisors)"]  
    A2["participants\n(pseudonymised ids)"]  
    A3["consent_records\n(consent form versions, status, timestamp)"]  
    A4["roles & permissions\n(researcher, supervisor, participant)"]  
  end

  subgraph PROJ["Project & Study Management"]  
    P1["projects\n(id, title, owner, funding, partners)"]  
    P2["studies\n(project_id, schema_ref, retention_policy)"]  
    P3["study_roles\n(link auth_users ↔ projects/studies)"]  
  end

  subgraph DATA["Event & Data Storage"]  
    D1["events\n(participant_id, study_id, type, payload, ts)"]  
    D2["metadata\n(app_version, locale, device)"]  
    D3["audit_log\n(immutable access/change records)"]  
  end

  subgraph API["Edge Functions / APIs"]  
    E1["/auth /signup /login"]  
    E2["/consent\n(submit, withdraw)"]  
    E3["/events\n(post event data)"]  
    E4["/projects /studies\n(admin endpoints)"]  
  end

  subgraph SEC["Security & Compliance Services"]  
    S1["Row-Level Security policies"]  
    S2["Encryption at rest & in transit"]  
    S3["PII separation / anonymisation"]  
    S4["Retention & deletion service"]  
    S5["Compliance audit exporter\n(for ethics review)"]  
  end  
end

%% ========= RESEARCH PIPELINE =========  
subgraph R["Research & Analytics Layer"]  
  R1["ETL / Raw Export (Supabase → Local)"]  
  R2["Data Cleaning & Validation"]  
  R3["Anonymisation / Aggregation Jobs"]  
  R4["Processed Data Store\n(analysis-ready, de-identified)"]  
  R5["Dashboards / Reports\n(teacher & researcher views)"]  
  R6["ML & Scheduling Engine\n(optional feedback to app)"]  
end

%% ========= FLOWS =========  
F3 -->|signup / consent| E1 & E2  
F1 -->|view analytics| R5  
F2 -->|manage projects| E4

C1 -->|authenticate via token| E1  
C1 -->|post events| E3

E1 & E2 & E4 --> AUTH  
E4 --> PROJ  
E3 --> DATA  
AUTH -->|checks| SEC  
PROJ -->|defines| DATA  
SEC -->|policies| AUTH & DATA

DATA -->|read-only| R1  
R1 --> R2 --> R3 --> R4 --> R5  
R4 -->|feeds| R6  
R6 -->|future adaptive feedback| E3  
SEC -->|exports compliance logs| S5
```

---

## Component Descriptions

### Frontends (Planned - Phase 6+)

**Research Dashboard**:
- Teacher/researcher UI for viewing analytics
- Access to aggregated learner data
- Study progress visualization
- Status: 📋 Planned

**Project Management UI**:
- Create and configure projects/studies
- Assign roles (researcher, supervisor, participant)
- Manage study schemas and retention policies
- Status: 📋 Planned

**Participant Portal**:
- Participant signup and authentication
- Consent form submission and management
- Withdraw consent functionality
- Status: 📋 Planned

### Game Clients (Integration Target)

**Current**: Radical Fighters (Flutter)
**Future**: Any kanji learning game or study tool

**Client Responsibilities**:
- Authenticate with JWT tokens
- POST events to `/events` endpoint
- Handle offline queueing (Phase 4+)
- Request adaptive study schedules (future)

### Backend (Supabase) - Core Platform

#### User & Consent Management
- **auth_users**: Researchers, supervisors (managed by Supabase Auth)
- **participants**: Pseudonymized participant IDs
- **consent_records**: Versioned consent forms with status tracking
- **roles & permissions**: RBAC system

**Status**: 🚧 Partially implemented (auth_users ✅, others 📋)

#### Project & Study Management
- **projects**: Top-level research projects (funding, partners, etc.)
- **studies**: Sub-entities with `schema_ref`, `retention_policy`
- **study_roles**: Links users ↔ projects/studies

**Status**: ✅ Basic structure implemented, 🚧 management UI pending

#### Event & Data Storage
- **events**: Core telemetry (participant_id, study_id, type, payload, timestamp)
- **metadata**: App version, locale, device info
- **audit_log**: Immutable compliance records

**Status**: ✅ Implemented

#### Edge Functions / APIs

**Implemented** (✅):
- `/auth`, `/signup`, `/login` - Authentication endpoints
- `/events` - Event ingestion with validation

**Planned** (📋):
- `/consent` - Submit/withdraw consent
- `/projects`, `/studies` - Admin CRUD operations
- `/query-events` - Researcher data access (Phase 3)

#### Security & Compliance

**Implemented** (✅):
- Row-Level Security: Tenant separation via RLS policies
- Encryption: At rest and in transit (Supabase default)
- JWT authentication with custom claims

**Planned** (📋):
- PII separation: Enhanced pseudonymization workflows
- Retention & deletion: Automated policy enforcement
- Compliance audit: Export for IRB/ethics review

### Research & Analytics Layer (Future)

**Current State**: Manual Python analysis in Jupyter notebooks

**Planned Pipeline**:
1. **ETL / Raw Export**: Pull events from Supabase to local/research environment
2. **Data Cleaning**: Validation, outlier detection, quality checks
3. **Anonymization**: Remove/pseudonymize identifiers for open data
4. **Processed Store**: Analysis-ready, de-identified datasets
5. **Dashboards**: Teacher/researcher views (Streamlit prototype?)
6. **ML & Scheduling**: BKT, IRT, adaptive feedback (optional, future)

**Status**: 📋 Planned for Epics 5-6

---

## Data Flow Summary

### Event Collection Flow
```
Game Client 
  → [JWT with tenant claims]
  → Edge Function (/events)
  → [validates schema, auth, tenant]
  → Postgres Database (RLS enforced)
  → [stored with audit trail]
```

### Research Flow
```
Database (read-only access)
  → ETL / Export
  → Data Cleaning
  → Anonymization
  → Processed Data Store
  → Analytics / Dashboards
  → Research Outputs
```

### Adaptive Feedback Flow (Future)
```
Analytics / ML Models
  → Scheduling Recommendations
  → Edge Function (/adaptive)
  → Game Client
  → Updated Study Schedule
```

---

## Integration Notes

### Multi-Tenant Isolation
- RLS policies enforce project/study separation at database level
- JWT claims specify which tenant data the client can access
- No cross-contamination even if application code has bugs

### Privacy Architecture
- **Identifiable data**: `auth.users` (researcher-controlled)
- **Pseudonymized data**: `participants`, `events` (research data)
- **Link table**: `study_roles` (controlled access only)
- Supports consent withdrawal with cascade deletion

### Extension Points
1. **New Event Types**: Define in `event_schemas`, validate in Edge Function
2. **New Studies**: Insert in `studies` table, RLS auto-enforces isolation
3. **New Clients**: Authenticate with JWT, POST to `/events`
4. **Custom Analytics**: Query `events` table with filters

---

## Technology Choices

| Layer | Technology | Why |
|-------|------------|-----|
| Database | Postgres 15.1 via Supabase | Mature, RLS support, JSON handling |
| Auth | Supabase Auth | JWT with custom claims, built-in |
| API | Edge Functions (Deno) | Serverless, hot reload, TypeScript |
| Analytics | Python (pandas/scipy) | Research ecosystem, Jupyter notebooks |
| Frontend | TBD (Streamlit prototype?) | Rapid iteration for research |

---

## Current Limitations & Future Work

**Known Gaps**:
- Frontend UIs not implemented (Phase 6+)
- Query API for researchers (Phase 3)
- Consent management workflows (Phase 2-3)
- Automated analytics pipeline (Phase 5)
- ML/adaptive scheduling (future)

**Uncertainties**:
- Frontend framework choice (Streamlit vs custom React)
- Real-time analytics vs batch processing
- Event batching strategy for performance
- Multi-institutional deployment architecture

---

## Related Documentation

- `ARCHITECTURE.md` - Design principles and rationale
- `ROADMAP.md` - Development phases and timeline
- `supabase/migrations/` - Database schema source of truth
- `Makefile` - Development workflows

---

**Note**: This diagram represents the target architecture. See `ROADMAP.md` for implementation status and timeline.
