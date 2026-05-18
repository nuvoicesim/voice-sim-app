# VOICE - Speech-Language Pathology Simulation Platform

A clinical simulation training platform for Speech-Language Pathology (SLP) students. Students interact with AI-powered 3D virtual patients in Unity WebGL, receive real-time dialogue responses via OpenAI, and get automated rubric-based scoring after each session. Faculty can create scenes and assignments, while admins manage users and view platform-wide analytics.

## Features

- **AI Virtual Patient Dialogue**: OpenAI-powered patient responses with emotion and motion animation codes for Unity 3D characters
- **Text-to-Speech**: ElevenLabs TTS with character-level alignment for lip-sync in Unity
- **Automated Scoring**: 8-criteria rubric-based evaluation of student clinical performance
- **Role-Based Portals**: Separate dashboards and workflows for students, faculty, and admins
- **Assignment System**: Faculty create assignments linked to scenes with configurable attempt policies and modes (practice / assessment)
- **Session Lifecycle**: Full session tracking with conversation turns, evaluation persistence, and history
- **Survey System**: Configurable post-session survey templates with analytics
- **Unity 3D Simulation**: WebGL-embedded 3D patient simulation with microphone input
- **User Management**: AWS Cognito-based authentication with role management

## Architecture

- **Frontend**: React 18 + TypeScript + Vite + Mantine UI
- **3D Simulation**: Unity WebGL (embedded via iframe)
- **Backend**: AWS Amplify Gen 2 + API Gateway REST + Lambda
- **AI Services**: OpenAI (dialogue + scoring), ElevenLabs (TTS)
- **State Management**: Redux Toolkit
- **Authentication**: AWS Cognito User Pool
- **Database**: Amazon DynamoDB
- **Storage**: Amazon S3 (Unity desktop client downloads)

## Project Structure

```
voice-sim-app/
├── amplify/                              # Backend infrastructure
│   ├── backend.ts                       # Main backend config, API Gateway routes, permissions
│   ├── auth/
│   │   └── resource.ts                  # Cognito User Pool setup
│   ├── data/
│   │   └── resource.ts                  # DynamoDB table definitions
│   └── functions/
│       ├── shared/                      # Shared Lambda utilities
│       │   ├── index.ts                 # Centralized exports
│       │   ├── http.ts                  # HTTP response helpers, CORS
│       │   ├── database.ts              # DynamoDB operations (getItem, putItem, queryItems)
│       │   ├── auth-middleware.ts        # Role-based auth (x-user-id, x-user-role headers)
│       │   ├── context-resolver.ts      # Assignment → Scene → scenarioKey resolution
│       │   ├── cors.ts                  # CORS header builder
│       │   ├── openai.ts               # OpenAI API client wrapper
│       │   └── utils.ts                 # ID generation, timestamps
│       ├── auth-function/               # Cognito login / signout
│       ├── cognito-user-function/       # User CRUD, role updates, batch resolve
│       ├── scene-catalog-function/      # Scene CRUD (faculty/admin)
│       ├── assignment-function/         # Assignment CRUD + status management
│       ├── session-function/            # Session lifecycle (start, complete, list)
│       ├── llm-dialogue-function/       # OpenAI patient dialogue generation
│       │   ├── handler.ts
│       │   ├── promptStrings.ts         # Compiled prompt templates
│       │   └── prompts/                 # Raw prompt text files per scenario
│       ├── llm-scoring-function/        # OpenAI rubric-based scoring
│       │   ├── handler.ts
│       │   ├── promptStrings.ts
│       │   └── prompts/
│       ├── tts-function/                # ElevenLabs text-to-speech
│       │   ├── handler.ts
│       │   ├── validation.ts            # Request validation
│       │   ├── voicePolicy.ts           # Voice selection policy per scenario
│       │   └── providers/elevenlabs.ts  # ElevenLabs API client
│       ├── survey-template-function/    # Survey templates + student responses
│       ├── analytics-function/          # Student, cohort, platform, survey analytics
│       ├── download-url-function/       # S3 presigned URL for desktop client
│       ├── simulation-data-function/    # [Legacy] Simulation data storage
│       ├── pre-survey-function/         # [Legacy] Pre-survey
│       ├── post-survey-function/        # [Legacy] Post-survey
│       └── debrief-function/            # [Legacy] Debrief
│
├── src/                                  # Frontend React application
│   ├── main.tsx                         # Entry point, Amplify config, Authenticator
│   ├── App.tsx                          # Route definitions, role-based navigation
│   ├── TopBar.tsx                       # Brand header, role badge, sign out
│   ├── store.ts                         # Redux store configuration
│   ├── api/                             # REST API client modules
│   │   ├── apiClient.ts                 # Base Amplify REST client with auth headers
│   │   ├── assignmentApi.ts
│   │   ├── sessionApi.ts
│   │   ├── sceneCatalogApi.ts
│   │   ├── cognitoUserApi.ts
│   │   └── analyticsApi.ts
│   ├── components/                      # Shared UI components
│   │   ├── PortalLayout.tsx             # Sidebar + content layout per role
│   │   └── RoleGuard.tsx                # Route-level role access control
│   ├── slices/                          # Redux Toolkit slices
│   │   ├── authSlice.ts
│   │   ├── assignmentSlice.ts
│   │   └── sessionSlice.ts
│   └── portals/                         # Role-based page components
│       ├── student/
│       │   ├── StudentDashboard.tsx      # Stats, deadlines, recent sessions
│       │   ├── AssignmentsPage.tsx       # Browse and launch assignments
│       │   ├── SessionRunner.tsx         # Unity iframe (mic + autoplay)
│       │   ├── SessionDetailPage.tsx     # Score ring, transcript, evaluation
│       │   └── HistoryPage.tsx           # Past session history
│       ├── faculty/
│       │   ├── FacultyDashboard.tsx      # Cohort analytics overview
│       │   ├── SceneManagement.tsx       # Scene CRUD
│       │   ├── CreateAssignment.tsx      # Assignment creation form
│       │   ├── AssignmentManagement.tsx  # Assignment list + status control
│       │   ├── StudentsDataPage.tsx      # Per-student drill-down
│       │   └── AnalysisPage.tsx          # Completion funnels, survey charts
│       └── admin/
│           ├── AdminDashboard.tsx        # Platform-wide metrics
│           ├── UsersRolesPage.tsx        # User listing + role management
│           └── GlobalAnalyticsPage.tsx   # Aggregate analytics
│
├── public/
│   └── unity/                           # Unity WebGL builds
│       └── broca-aphasia-webgl/         # Default simulation build
│
├── scripts/
│   ├── prompts-to-ts.mjs               # Compiles .txt prompts → promptStrings.ts
│   └── seed-scene-catalog.ts           # Seeds initial scene catalog data
│
├── docs/
│   └── design_doc.md
├── API_HANDBOOK.md                      # Full API reference documentation
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Prerequisites

- **Node.js** v18 or higher
- **npm**
- **Git**
- **AWS CLI** (optional, for production deployment)

## Quick Start

### 1. Clone the Repository

```bash
git clone <repository-url>
cd voice-sim-app
```

### 2. Install Dependencies

```bash
npm install

cd amplify
npm install
cd ..
```

### 3. Create `.env.local` (Runtime Token Secret)

The backend signs short-lived JWTs that the Unity WebGL client uses to call the LLM / TTS / session-completion endpoints. The HMAC secret for those JWTs is **not** committed to the repo — every developer keeps it in their own `.env.local` at the repo root.

`.env.local` is already covered by `.gitignore` (`.env.*`). [`amplify/backend.ts`](amplify/backend.ts) reads it at synth time and injects every key into `process.env` before the Lambda env vars are wired up. Explicit shell env vars (CI, Amplify Hosting) still win — `.env.local` only fills in keys you haven't set elsewhere.

Create the file at the repo root:

```
voice-sim-app/.env.local
```

with at minimum:

```ini
# Shared HMAC secret used to sign and verify the Unity runtime JWT.
# Use any high-entropy string (>= 32 chars). Rotate by replacing and redeploying.
RUNTIME_TOKEN_SECRET=<paste-a-random-64+-char-string-here>

# OpenAI API key — used by llm-dialogue and llm-scoring.
OPENAI_API_KEY=<your-openai-api-key>

# ElevenLabs API key — used by the tts function.
ELEVENLABS_API_KEY=<your-elevenlabs-api-key>

# Optional overrides:
# RUNTIME_TOKEN_TTL_SECONDS=1800
# UNITY_DEV_BOOTSTRAP_ENABLED=true
# UNITY_DEV_BOOTSTRAP_KEY=<dev-only-bootstrap-key>
# LLM_ALLOWED_ORIGINS=http://localhost:5173,https://www.voice-sim.org
# LLM_UPSTREAM_RETRIES=1
```

Any key left blank causes the matching endpoint to return HTTP 500 `{ "error": "Configuration error" }`:

| Missing key | Endpoint(s) that 500 |
|-------------|----------------------|
| `OPENAI_API_KEY` | `POST /llm-dialogue`, `POST /llm-scoring` |
| `ELEVENLABS_API_KEY` | `POST /tts` |
| `RUNTIME_TOKEN_SECRET` | `POST /sessions/{id}/runtime-token`, plus any endpoint that verifies a runtime JWT |

Generate a strong secret (pick one):

```powershell
# PowerShell (Windows)
$bytes = New-Object byte[] 48
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
([System.BitConverter]::ToString($bytes)) -replace '-',''
```

```bash
# Bash / macOS / Linux
openssl rand -hex 48
# or
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Notes:
- The same secret must be valid for the entire token lifetime. If you rotate it, any sessions holding in-flight tokens will start failing — pick something stable.
- All five token-using Lambdas (`session`, `llm-dialogue`, `llm-scoring`, `tts`, `survey-template`) share the same value — they're wired up together in `amplify/backend.ts`, so a normal `npx ampx sandbox` redeploy handles distribution.
- If `RUNTIME_TOKEN_SECRET` is missing at deploy time, the runtime-token endpoint will return HTTP 500 with `Runtime token configuration is missing` and the session page will show `Unable to initialize the Unity runtime session: Runtime token configuration is missing`.

### 4. Start Local Development Environment

Start Amplify Sandbox (backend) in one terminal:

```bash
npx ampx sandbox
```

Start the frontend dev server in another terminal:

```bash
npm run dev
```

The frontend will be available at `http://localhost:5173`.

## User Roles and Portals

### Student Portal (`/student/*`)

| Route | Page | Description |
|-------|------|-------------|
| `/student/dashboard` | StudentDashboard | Stats, upcoming deadlines, recent sessions, quick actions |
| `/student/assignments` | AssignmentsPage | Browse published assignments, filter by mode, launch simulation |
| `/student/session/:id` | SessionRunner | Unity 3D iframe with mic + autoplay permissions |
| `/student/session/:id/detail` | SessionDetailPage | Score ring, performance level, conversation transcript |
| `/student/history` | HistoryPage | All past simulation sessions |

### Faculty Portal (`/faculty/*`)

| Route | Page | Description |
|-------|------|-------------|
| `/faculty/dashboard` | FacultyDashboard | Cohort analytics (sessions, completion rate, students) |
| `/faculty/scenes` | SceneManagement | Create/edit clinical simulation scenes |
| `/faculty/assignments/new` | CreateAssignment | Create assignment with scene, mode, attempts, due date |
| `/faculty/assignments` | AssignmentManagement | List assignments, publish/archive/draft status control |
| `/faculty/students` | StudentsDataPage | Per-student session and analytics drill-down |
| `/faculty/analysis` | AnalysisPage | Completion funnels, survey participation charts |

### Admin Portal (`/admin/*`)

| Route | Page | Description |
|-------|------|-------------|
| `/admin/dashboard` | AdminDashboard | Platform-wide metrics |
| `/admin/users` | UsersRolesPage | List Cognito users, search, change roles |
| `/admin/analytics` | GlobalAnalyticsPage | Aggregate platform + survey analytics |

Admins can also switch to the Faculty portal via the top bar.

## Database Schema

### Assignment-Centric Tables

| Table | Partition Key | Sort Key | Description |
|-------|---------------|----------|-------------|
| SceneCatalog | `sceneId` | — | Clinical simulation scene definitions |
| Assignment | `assignmentId` | — | Assignments linking scenes to student activities |
| AssignmentEnrollment | `assignmentId` | `studentUserId` | Per-student enrollment and delivery status |
| SimulationSession | `sessionId` | — | Individual simulation attempt records |
| SessionTurn | `sessionId` | `turnIndex` | Conversation turns within a session |
| SessionEvaluation | `sessionId` | — | AI-generated scoring results |
| SurveyTemplate | `surveyTemplateId` | — | Configurable survey question templates |
| AssignmentSurveyResponse | `assignmentId` | `responseKey` | Student survey submissions |

### Legacy Tables

| Table | Partition Key | Sort Key | Description |
|-------|---------------|----------|-------------|
| PreSurveyAnswers | `userID` | — | Pre-simulation survey responses |
| PostSurveyAnswers | `userID` | — | Post-simulation survey responses |
| SimulationData | `userID` | `simulationLevel` | Simulation chat history |
| DebriefAnswers | `userID` | `simulationLevel` | Debrief responses |

## API Documentation

Full API reference is available in [API_HANDBOOK.md](API_HANDBOOK.md), covering:

- **Auth**: Login, signout
- **User Management**: Create, list, search, role updates, batch resolve
- **Scene Catalog**: CRUD for simulation scenes
- **Assignments**: CRUD with status lifecycle (draft → published → archived)
- **Sessions**: Start, complete, list, get detail (with turns + evaluation)
- **LLM Dialogue**: OpenAI patient response generation with emotion/motion codes
- **LLM Scoring**: 8-criteria rubric evaluation with auto-persistence
- **TTS**: ElevenLabs text-to-speech with alignment data
- **Surveys**: Template management and student response submission
- **Analytics**: Student, cohort, platform, and survey aggregations
- **Download**: Presigned S3 URLs for Unity desktop client

## Authentication

The platform uses AWS Cognito for authentication:

- **Login**: Email/password authentication via Cognito `USER_PASSWORD_AUTH` flow
- **Role Management**: Custom attribute `custom:role` (`student` | `faculty` | `admin`)
- **API Authorization**: Auth headers (`x-user-id`, `x-user-role`) set by the frontend after login
- **Admin User Creation**: Admin-controlled user registration with auto-generated credentials

## Development Guide

### Adding a New Lambda Function

1. Create a new directory under `amplify/functions/` with `handler.ts` and `resource.ts`
2. Import and register the function in `amplify/backend.ts`
3. Grant DynamoDB table permissions
4. Set environment variables
5. Add API Gateway routes if needed
6. Restart sandbox: `npx ampx sandbox`

### Shared Utilities

All Lambda functions share utilities from `amplify/functions/shared/`:

| Module | Purpose |
|--------|---------|
| `http.ts` | `createResponse`, `badRequestResponse`, `notFoundResponse`, `serverErrorResponse`, etc. |
| `database.ts` | `createDynamoDbClient`, `getItem`, `putItem`, `queryItems` |
| `auth-middleware.ts` | `extractCallerIdentity`, `requireRole` |
| `context-resolver.ts` | `resolveScenarioKey` — resolves Assignment → Scene → `scenarioKey` |
| `openai.ts` | `callOpenAIChat` — OpenAI API wrapper with retry and timeout |
| `cors.ts` | `buildCorsHeaders` — dynamic CORS header builder |
| `utils.ts` | `generateId`, `generateTimestamp` |

### Prompt Management

LLM prompt text files live under each function's `prompts/` directory, organized by scenario (`task1`, `task2`, `task3`). To update prompts:

1. Edit the `.txt` files under `amplify/functions/llm-dialogue-function/prompts/` or `llm-scoring-function/prompts/`
2. Run the compiler script: `node scripts/prompts-to-ts.mjs`
3. This regenerates `promptStrings.ts` which is imported by the handler

## Troubleshooting

### Sandbox Not Starting

```bash
npx ampx sandbox status
npx ampx sandbox restart
```

### Frontend Build Issues

```bash
rm -rf node_modules package-lock.json
npm install
```

### Environment Variables

Key environment variables configured in `amplify/backend.ts`:

| Variable | Function(s) | Description |
|----------|-------------|-------------|
| `OPENAI_API_KEY` | llm-dialogue, llm-scoring | OpenAI API key |
| `ELEVENLABS_API_KEY` | tts | ElevenLabs API key |
| `USER_POOL_ID` | auth, cognito-user | Cognito User Pool ID |
| `CLIENT_ID` | auth | Cognito app client ID |
| `S3_BUCKET_NAME` | download-url | Unity client download bucket |
| `RUNTIME_TOKEN_SECRET` | session, llm-dialogue, llm-scoring, tts, survey-template | HMAC secret for the Unity runtime JWT — see [step 3](#3-create-envlocal-runtime-token-secret) |
| `RUNTIME_TOKEN_TTL_SECONDS` | session, llm-dialogue, llm-scoring, tts, survey-template | Runtime JWT lifetime in seconds (default `1800`) |
| `UNITY_DEV_BOOTSTRAP_ENABLED` | session | Enables the dev-only `/sessions/dev-bootstrap` endpoint (defaults to `true` outside `prod`) |
| `UNITY_DEV_BOOTSTRAP_KEY` | session | Shared key required to call `/sessions/dev-bootstrap` |

Local development reads these from `.env.local` at the repo root (loaded by `amplify/backend.ts`). CI / Amplify Hosting should inject them via the build environment — explicit shell env vars override `.env.local`.

## References

- [AWS Amplify Gen 2 Documentation](https://docs.amplify.aws/gen2/)
- [Mantine UI](https://mantine.dev/)
- [OpenAI API](https://platform.openai.com/docs/)
- [ElevenLabs API](https://elevenlabs.io/docs/)
