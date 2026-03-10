# Event Management Sprint - Foundation for Real-Time Analytics

> **Date**: 2026-02-19
> **Sprint**: Event Management Foundation
> **Timeline**: 2 weeks
> **Next Sprint**: Real-Time Analytics & ML Pipeline

---

## Context: Where We're Going

### The Vision: Real-Time Learning Analytics Platform

**End State** (after multiple sprints):
```
Game Events (continuous stream)
    ↓
Ingestion Layer (high-throughput)
    ↓
Event Store (Postgres)
    ↓
    ├─→ Real-Time Analytics Engine
    │   ├─ Learning curves (by participant, by kanji, by cohort)
    │   ├─ Retention analysis (spaced repetition effectiveness)
    │   ├─ Error pattern detection (common mistakes)
    │   └─ Session analytics (engagement, flow state)
    │
    ├─→ ML Pipeline
    │   ├─ Bayesian Knowledge Tracing (skill mastery estimation)
    │   ├─ Adaptive difficulty (personalized task selection)
    │   ├─ Predictive models (which kanji to review next)
    │   └─ Deep Knowledge Tracing (if N > 1000)
    │
    ├─→ Live Dashboards
    │   ├─ Teacher monitoring (real-time student progress)
    │   ├─ Researcher view (study health, data quality)
    │   └─ Game feedback (adaptive parameters)
    │
    └─→ Historical Queries (researchers export for offline analysis)
```

### Why This Matters for THIS Sprint

**We're building the foundation layer**: Event storage + querying
- Must handle high throughput (thousands of events/minute)
- Must support complex queries (by-kanji, by-participant, cross-study)
- Must be schema-flexible (different studies have different event types)
- Must NOT lock us into batch-only patterns

**Design Decisions Now Impact Later**:
- Index strategy → Query performance for analytics
- Schema flexibility → Can we add new event types without refactoring?
- Export patterns → What formats do researchers need?
- Event structure → Can we aggregate efficiently?

---

## This Sprint: Event Management Foundation

### Scope (Option B)

**What we're building**:
1. **Event Browser**: Browse, filter, paginate events
2. **Export System**: CSV/JSON for offline analysis
3. **Schema Management**: Researchers define event types for studies
4. **Health Monitoring**: Simple check that data is flowing

**What we're NOT building** (next sprint):
- ❌ Real-time analytics dashboards
- ❌ Learning curves or visualizations
- ❌ ML models or predictions
- ❌ Live-updating charts

**Why this order**:
- Need to browse events BEFORE we can build analytics
- Need schema definitions BEFORE ML models know what fields mean
- Need export working BEFORE researchers can validate data
- Foundation must be solid BEFORE we add real-time complexity

---

## Architectural Considerations

### Design for Real-Time Future

**Database Indexes** (already exist, but verify):
```sql
-- Critical for analytics queries
CREATE INDEX events_study_id_ts_idx ON events(study_id, ts DESC);
CREATE INDEX events_participant_id_ts_idx ON events(participant_id, ts);
CREATE INDEX events_item_id_idx ON events(item_id);  -- by-kanji queries
CREATE INDEX events_event_type_idx ON events(event_type);

-- For aggregations
CREATE INDEX events_study_participant_idx ON events(study_id, participant_id);
```

**Query Patterns to Support**:
```sql
-- By-kanji queries (for learning curves)
SELECT item_id, COUNT(*), AVG((payload->>'response_time_ms')::int)
FROM events
WHERE study_id = $1 AND event_type = 'answer_submitted'
GROUP BY item_id;

-- Participant timeline (for session analytics)
SELECT ts, event_type, payload
FROM events
WHERE participant_id = $1
ORDER BY ts;

-- Cross-participant aggregations (for cohort analysis)
SELECT participant_id, COUNT(*), 
       AVG((payload->>'correct')::boolean::int) as accuracy
FROM events
WHERE study_id = $1 AND event_type = 'answer_submitted'
GROUP BY participant_id;
```

**Schema Flexibility**:
- Events table: Generic (any event type, any payload structure)
- Schemas table: Documentation (researchers define meaning)
- Analytics layer: Interprets schemas to know what to aggregate

---

## Implementation Plan

### Week 1: Event Browser

#### KN-151: Event Browser Page Setup
**Description**: Create `/events` page with study selector and basic table

**Tasks**:
- [ ] Create `app/(app)/events/page.tsx` server component
- [ ] Fetch accessible studies with RLS
- [ ] Create `app/(app)/events/events-content.tsx` client component
- [ ] Create `components/events/study-selector.tsx`
- [ ] Basic event table (just show events, no filters yet)
- [ ] Wire up to existing `/query-events` Edge Function

**Acceptance Criteria**:
- User can select a study
- Events display in table (timestamp, type, participant)
- Pagination works (50 events per page)
- RLS enforced (can't see other researchers' studies)

**Deliverable**: `/events` page functional

---

#### KN-152: Event Filters
**Description**: Filter events by common fields

**Tasks**:
- [ ] Create `components/events/event-filters.tsx`
- [ ] Date range picker (start/end)
- [ ] Event type multi-select (populated dynamically from study)
- [ ] Participant ID filter
- [ ] Item ID filter (for by-kanji filtering)
- [ ] Task ID filter
- [ ] Apply filters to query
- [ ] URL state management (filters persist in query params)
- [ ] Reset filters button

**Query Pattern**:
```typescript
const params = {
  study_id: selectedStudy,
  date_from: filters.dateFrom?.toISOString(),
  date_to: filters.dateTo?.toISOString(),
  event_type: filters.eventType,
  participant_id: filters.participantId,
  item_id: filters.itemId,  // Critical for by-kanji queries later
  limit: 50,
  offset: page * 50
};
```

**Acceptance Criteria**:
- All filters apply correctly
- Filters combine (AND logic)
- URL reflects current filters
- Refresh preserves filters
- "No results" state when filters return empty

**Deliverable**: Fully functional filtering

---

#### KN-153: Payload Inspector
**Description**: View event payload as expandable JSON tree

**Tasks**:
- [ ] Create `components/events/payload-inspector.tsx`
- [ ] Expandable/collapsible JSON tree
- [ ] Syntax highlighting
- [ ] Copy to clipboard button
- [ ] Handle null/undefined payloads gracefully
- [ ] Nested object support

**Why Important**: 
- Researchers need to inspect payloads to understand data
- Debugging integration issues
- Validates schema definitions

**Acceptance Criteria**:
- Payloads display as tree
- Can expand/collapse nested objects
- Copy button works
- Handles edge cases (null, empty, deeply nested)

**Deliverable**: Payload inspector component

---

#### KN-154: Export Functionality
**Description**: Export events to CSV/JSON

**Tasks**:
- [ ] Create `components/events/export-events.tsx`
- [ ] CSV export (flatten payload fields)
- [ ] JSON export (preserve structure)
- [ ] Respect current filters
- [ ] Include metadata in filename (`events-{study}-{date}.csv`)
- [ ] Handle large exports (show progress or limit)

**Export Format** (CSV):
```csv
timestamp,event_type,participant_id,item_id,task_id,payload_answer,payload_correct,payload_response_time_ms
2026-02-19T10:15:30Z,answer_submitted,uuid,kanji_日,task_1,ひ,true,1234
```

**Why Critical**:
- Researchers need offline analysis (Python/R)
- Validates data collection is working
- Enables exploratory analysis before we build dashboards

**Acceptance Criteria**:
- Export button visible
- CSV format correct
- JSON format preserves structure
- Exports respect filters
- Works with 1000+ events

**Deliverable**: Working export system

---

#### KN-155: Health Check Component
**Description**: Simple indicator that events are flowing

**Tasks**:
- [ ] Create `components/events/health-check.tsx`
- [ ] Poll aggregate query every 10 seconds
- [ ] Show: connection status, last event time, events in last minute
- [ ] Manual refresh button
- [ ] Error handling (disconnected, no events)

**Implementation**:
```typescript
// Simple aggregate queries
SELECT COUNT(*) FROM events 
WHERE study_id = $1 AND ts > NOW() - INTERVAL '1 minute';

SELECT ts FROM events 
WHERE study_id = $1 
ORDER BY ts DESC LIMIT 1;
```

**Why NOT Real-Time Streaming**:
- This sprint: Foundation layer (management)
- Next sprint: Real-time analytics layer
- Keep it simple now, avoid premature optimization

**Acceptance Criteria**:
- Shows recent activity (last minute count)
- Shows last event timestamp
- Polls every 10 seconds
- Manual refresh reloads table
- Error states clear

**Deliverable**: Health check component

---

### Week 2: Schema Management

#### KN-156: Schema List Page
**Description**: View all event schemas for a study

**Tasks**:
- [ ] Create `app/(app)/studies/[id]/schemas/page.tsx`
- [ ] Fetch schemas from `event_schemas` table
- [ ] Display as cards (name, version, event count, date)
- [ ] Indicate active schema
- [ ] Link to create/edit
- [ ] Delete schema (with confirmation)

**Acceptance Criteria**:
- Lists all schemas for study
- Shows which is active
- Can navigate to create/edit
- Delete works (with confirmation)

**Deliverable**: Schema list page

---

#### KN-157: Schema Editor
**Description**: Create/edit event schemas with JSON Schema

**Tasks**:
- [ ] Create `app/(app)/studies/[id]/schemas/new/page.tsx`
- [ ] Create `app/(app)/studies/[id]/schemas/[schemaId]/edit/page.tsx`
- [ ] Create `components/schemas/schema-editor.tsx`
- [ ] Form fields: name, version, description
- [ ] Event type definitions (add/remove)
- [ ] JSON Schema editor (Monaco or textarea with validation)
- [ ] Validate JSON Schema format
- [ ] Save to database
- [ ] Version management (semver)

**Schema Structure**:
```json
{
  "version": "1.0.0",
  "name": "Kanji Learning Events",
  "description": "Event types for kanji acquisition study",
  "events": {
    "answer_submitted": {
      "description": "Learner submitted answer",
      "payload_schema": {
        "type": "object",
        "properties": {
          "answer": { "type": "string" },
          "correct": { "type": "boolean" },
          "response_time_ms": { "type": "number" }
        },
        "required": ["answer", "correct"]
      },
      "examples": [{ "answer": "ひ", "correct": true, "response_time_ms": 1234 }]
    }
  }
}
```

**Why Critical**:
- Researchers need to document what events mean
- ML models need to know field types/meanings
- Validation catches integration errors
- Future analytics know what to aggregate

**Acceptance Criteria**:
- Can create new schema
- Can edit existing schema
- JSON Schema validates
- Versions track changes
- Saves to database

**Deliverable**: Schema editor

---

#### KN-158: Schema Templates
**Description**: Pre-built templates to accelerate setup

**Tasks**:
- [ ] Create `lib/schemas/templates.ts`
- [ ] Define templates:
  - Kanji learning (kanji_presented, answer_submitted, hint_requested)
  - Generic game (game_started, level_completed, item_collected)
  - Video learning (video_started, video_paused, quiz_completed)
- [ ] "Start from template" selector in editor
- [ ] Load template into editor (researcher can modify)

**Template Example**:
```typescript
export const KANJI_LEARNING_TEMPLATE = {
  name: "Kanji Learning Events",
  version: "1.0.0",
  events: {
    kanji_presented: {
      description: "Kanji displayed to learner",
      payload_schema: {
        type: "object",
        properties: {
          kanji: { type: "string", description: "The kanji character" },
          jlpt_level: { type: "integer", enum: [5,4,3,2,1] },
          radicals: { type: "array", items: { type: "string" } }
        },
        required: ["kanji"]
      }
    },
    answer_submitted: { /* ... */ }
  }
};
```

**Acceptance Criteria**:
- Templates available in editor
- Can select template
- Loads into form
- Researcher can modify
- 3+ templates available

**Deliverable**: Template library

---

#### KN-159: Schema-Aware Event Display
**Description**: Event Explorer uses schemas for enhanced display

**Tasks**:
- [ ] Fetch active schema for study
- [ ] Update `payload-inspector.tsx`:
  - Show field descriptions from schema
  - Type hints (string, number, boolean)
  - Mark required fields
- [ ] Validation badge in event table:
  - ✓ Valid (matches schema)
  - ⚠ Invalid (doesn't match)
  - No Schema (none defined)
- [ ] Graceful fallback (always works without schema)

**Enhanced Inspector**:
```typescript
// WITH schema:
answer: "ひ"
  ↳ User's submitted answer (string, required)
correct: true
  ↳ Whether answer was correct (boolean, required)
response_time_ms: 1234
  ↳ Response time in milliseconds (number)

// WITHOUT schema:
answer: "ひ"
correct: true
response_time_ms: 1234
```

**Acceptance Criteria**:
- Field descriptions show when schema exists
- Validation badge accurate
- Works without schema
- Doesn't break on invalid payloads

**Deliverable**: Schema-aware display

---

#### KN-160: Polish & Testing
**Description**: Production-ready event management

**Tasks**:
- [ ] Loading states (skeletons for table, filters)
- [ ] Error boundaries (component errors don't crash page)
- [ ] Empty states ("No events yet", "No schemas defined")
- [ ] Mobile responsive (works on tablet/phone)
- [ ] Keyboard navigation (tab through filters, enter to apply)
- [ ] Performance test (10k+ events in table)
- [ ] Accessibility audit (WCAG 2.1 AA)
- [ ] Error messages clear and actionable

**Acceptance Criteria**:
- No crashes on error
- Clear empty states
- Works on mobile
- Keyboard navigable
- Handles large datasets
- Accessible

**Deliverable**: Production-ready sprint

---

## API Reference

### Existing: Query Events

**Endpoint**: `GET /functions/v1/query-events`

**Parameters**:
- `study_id` (required)
- `event_type` (optional)
- `participant_id` (optional)
- `item_id` (optional) ← Critical for by-kanji queries
- `task_id` (optional)
- `date_from` (optional, ISO datetime)
- `date_to` (optional, ISO datetime)
- `limit` (default 100, max 1000)
- `offset` (default 0)

**Response**:
```json
{
  "events": [...],
  "pagination": { "total": 1247, "limit": 100, "offset": 0, "returned": 100 },
  "filters": { /* applied filters */ }
}
```

### New: Schema Management

**Direct Supabase Queries** (no Edge Function needed):

```typescript
// List schemas
const { data } = await supabase
  .from('event_schemas')
  .select('*')
  .eq('study_id', studyId)
  .order('created_at', { ascending: false });

// Create schema
const { data } = await supabase
  .from('event_schemas')
  .insert({ study_id, version, name, definition })
  .select()
  .single();

// Update schema
const { data } = await supabase
  .from('event_schemas')
  .update({ definition })
  .eq('id', schemaId)
  .select()
  .single();

// Delete schema
const { error } = await supabase
  .from('event_schemas')
  .delete()
  .eq('id', schemaId);
```

---

## Database Schema

### events table (exists)
```sql
CREATE TABLE events (
  id uuid PRIMARY KEY,
  participant_id uuid REFERENCES participants(id),
  study_id uuid REFERENCES studies(id),
  session_id uuid REFERENCES sessions(id),
  event_type text NOT NULL,
  payload jsonb,                         -- Flexible structure
  ts timestamptz NOT NULL,
  item_id text,                          -- For by-kanji queries
  task_id text,
  app_version text,
  platform text,
  schema_id uuid REFERENCES event_schemas(id),
  created_at timestamptz DEFAULT now()
);

-- Critical indexes for analytics
CREATE INDEX events_study_id_ts_idx ON events(study_id, ts DESC);
CREATE INDEX events_participant_id_ts_idx ON events(participant_id, ts);
CREATE INDEX events_item_id_idx ON events(item_id);
CREATE INDEX events_event_type_idx ON events(event_type);
```

### event_schemas table (exists)
```sql
CREATE TABLE event_schemas (
  id uuid PRIMARY KEY,
  study_id uuid REFERENCES studies(id),
  version text NOT NULL,
  name text NOT NULL,
  definition jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (study_id, version)
);
```

---

## Dependencies

### Packages
```bash
cd frontend
npm install date-fns          # Date formatting
npm install react-json-tree    # Or build custom JSON tree
```

### Environment
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

---

## Success Criteria

### Week 1 Complete
- ✅ Browse events from any study
- ✅ Filter by date, type, participant, item_id
- ✅ Export to CSV/JSON
- ✅ Health check shows activity
- ✅ Pagination works

### Week 2 Complete (Sprint Done)
- ✅ Define event schemas
- ✅ Template library available
- ✅ Schema-aware display
- ✅ Validation indicators
- ✅ Production polish complete

---

## Looking Ahead: Next Sprint

**What this sprint enables**:
- Event browser → Can verify data before building analytics
- Schema definitions → ML models know what fields mean
- Export working → Researchers can validate data quality
- Solid foundation → Analytics layer can build on top

**Next sprint will add**:
- Real-time analytics dashboards
- Learning curve calculations
- By-kanji aggregations
- Cross-participant comparisons
- ML model integration (BKT, adaptive difficulty)

**Why wait**:
- Need clean data first (this sprint validates)
- Need schema definitions (ML needs to know field meanings)
- Need foundation solid (analytics layer is complex)

---

## Jira Tasks Summary

**Week 1**:
- KN-151: Event Browser Page Setup
- KN-152: Event Filters
- KN-153: Payload Inspector
- KN-154: Export Functionality
- KN-155: Health Check Component

**Week 2**:
- KN-156: Schema List Page
- KN-157: Schema Editor
- KN-158: Schema Templates
- KN-159: Schema-Aware Event Display
- KN-160: Polish & Testing

**Total**: 10 tasks, 2 weeks

---

Ready for implementation! 🚀

This foundation enables the real-time analytics platform we're building toward.