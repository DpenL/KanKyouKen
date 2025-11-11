# KanKyouKen
Open Game Data Platform for Kanji Learning Research

KanKyouKen is an open-source backend and data platform for collecting, storing, and processing gameplay and study events from kanji learning games.
It is designed for research on learning analytics, adaptive scheduling, and knowledge modeling in serious games.

## Overview

This repository contains the local backend setup used to:
- Collect and store structured gameplay events (via Supabase Edge Functions)
- Authenticate and verify clients using JWT tokens
- Support integration tests and reproducible local research pipelines
- Prepare a foundation for large-scale open game data studies

KanKyouKen aims to provide a transparent, reproducible, and extensible infrastructure for analyzing player learning processes — supporting research on kanji acquisition, memory modeling, and serious game design.

## Local Development Setup

### Prerequisites
| Tool | Version | Notes |
|------|----------|-------|
| Python | 3.11+ |  |
| Docker | Latest | Required for local Supabase stack |
| Supabase CLI | ≥ 1.179.4 | [Install guide](https://supabase.com/docs/guides/cli/getting-started) |
| Make | any |  |

### Setup Steps

```bash
# Clone the repository
git clone https://github.com/<your-username>/kankyouken.git
cd kankyouken

# Create a Python environment
python3 -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
```

### Environment Setup

Supabase automatically loads your local JWT secret from `.env`, as declared in `supabase/config.toml`.

Create a `.env` file at the project root (or copy the example):

```bash
cp .env.example .env
```

Your `.env` must contain at least:

```bash
JWT_SECRET=sb_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SUPABASE_ANON_KEY=sb_publishable_xxxxxxxxxxxxxxxxxxxx
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxxxxxxxxxxxxxxxxxx
```

> **Note for CI and teammates**  
> When running in CI or on another machine, simply export the same `JWT_SECRET` before starting Supabase:  
> ```bash
> export JWT_SECRET=sb_secret_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
> supabase start
> ```  
> The stack will initialize correctly without any manual edits to `keys.json`.

### Quick Start

```bash
# Install dependencies and start the local stack
make setup

# Run all tests
make test
```

This will:
- Load the `.env` file
- Start a fully configured Supabase stack
- Launch integration tests for all edge functions

You should see:
```
All tests passed!
```

### Manual Function Testing

To serve the function manually:
```bash
supabase functions serve event-collector --env-file .env
```

Then send a test request:
```bash
curl -X POST "http://127.0.0.1:54321/functions/v1/event-collector"   -H "Content-Type: application/json"   -H "Authorization: Bearer <JWT>"   -d '{"participant_id":"demo01","project_id":"projA","event_type":"start_session"}'
```

## Project Structure

```
kankyouken/
├── Makefile               # Common developer tasks
├── requirements.txt       # Python dependencies
├── supabase/              # Supabase config and Edge Functions
│   ├── config.toml
│   └── functions/
├── test/                  # Unit and integration test suites
│   ├── setup_tests.py
│   ├── functions/
│   ├── utils/
│   └── integration/
├── scripts/               # Helper scripts (e.g., run_tests.py)
└── venv/                  # Local Python environment (excluded from Git)
```

## Research Context

KanKyouKen is meant to support research in:
- Learning Analytics: capturing real-time study and gameplay events  
- Adaptive Learning: scheduling based on BKT or deep learner models  
- Serious Game Design: evaluating learning outcomes through game telemetry  

The platform is developed in collaboration with academic institutions to facilitate open, data-driven kanji learning research.

## Future Roadmap

Upcoming milestones focus on expanding the data pipeline, improving interoperability, and preparing the platform for deployment and collaborative analytics.

### Core Expansion

- Schema Design: Normalize event storage for scalable querying (PostgreSQL / Supabase).

- API Layer: Define REST and WebSocket endpoints for ingesting structured gameplay data.

- Analytics Hooks: Integrate pipelines for BKT and deep learning–based learner modeling.

### Research & Visualization

- Dashboard Prototypes: Interactive interfaces for researchers and teachers to explore learner data.

- Event Taxonomy: Standardized format for gameplay and study events across kanji-learning projects.

- Reproducible Studies: Dockerized experiment templates for learning-analytics publications.

### Deployment & Integration

- Staging Deployment: Deploy Supabase and Edge Functions on cloud infrastructure (e.g., Supabase Cloud or Fly.io).

- Auth Integration: Connect with real user authentication and API keys for live client testing.

- Data Export APIs: Enable secure anonymized export for research and open datasets.

- Continuous Testing: Expand CI/CD pipeline to automatically verify function and database integrity

## Contributing

Contributions, feedback, and extensions are welcome.  
Please:
1. Fork this repository  
2. Create a feature branch  
3. Submit a pull request describing your changes and rationale  

## License

This project is released under the MIT License.  
You are free to use, modify, and distribute it for academic or commercial research.

Author: David Stiftl  
Affiliation: Waseda University / Technical University of Munich  
Contact: [GitHub Issues](https://github.com/DpenL/kankyouken/issues)
