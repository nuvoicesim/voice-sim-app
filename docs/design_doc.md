# VOICE-SIM Design Doc 

## Title
AI-Powered Virtual Patient Simulation Platform for Speech Pathology Student

## Status
Draft for discussion

## Last Updated
2026-02-27

## Design Doc Type
Product + Architecture + API Contract Migration

---

## 1. Summary
We are evolving from a linear, level-driven simulation app to a role-based full-stack platform with Student, Faculty, and Admin portals.

Current runtime decisions are coupled to `simulationLevel` and Cognito step progress. We will decouple this by making assignment/session context the source of truth:
- frontend selects assignment,
- backend resolves scene/scenario from assignment,
- session/evaluation data is stored by `sessionId` (not `userID + simulationLevel`).

This enables scalable assignment workflows, retries in practice mode, controlled assessment attempts, and robust analytics.

---

## 2. Background and Current State

### 2.1 Product and UX (Current)
- Existing app is step-based (`informed-consent -> survey -> level1/2/3 -> post-survey`).
- Progress is tied to Cognito `custom:currentCompletedStep`.
- Admin panel exists for user management, but no full faculty/student portal IA.

### 2.2 API and Runtime (Current)
- `/auth/login` returns `simulationLevel` inferred from backend state.
- `/simulation-data` and `/debrief` require `simulationLevel` and store by `userID + simulationLevel`.
- `/llm-dialogue`, `/llm-scoring`, `/tts` are level-centric in request contracts.
- Unity integration currently depends on `simulationLevel -> task1/task2/task3` mapping.

### 2.3 Technical Stack (Current)
- Frontend: React 18, TypeScript, Vite, Mantine, Redux Toolkit, React Router
- Auth: AWS Cognito (Amplify Gen 2)
- Backend: AWS Amplify Gen 2 + Lambda + API Gateway REST
- Data: DynamoDB models via Amplify Data
- AI runtime: OpenAI-backed dialogue/scoring Lambda functions, Elevenlabs generated voices for TTS

---

## 3. Problem Statement
The current level-centric model cannot scale to assignment-centric learning because:
- multiple assignments can share the same old level,
- attempts/retries overwrite or collide under `userID + simulationLevel`,
- faculty needs explicit assignment targeting and cohort analytics,
- admin needs cross-portal/system analysis not tied to a single linear step flow.

---

## 4. Goals and Non-Goals

### 4.1 Goals
- Deliver full-stack role-based portals: Student, Faculty, Admin.
- Introduce assignment/session-centered runtime and storage.
- Keep compatibility during migration from level-based clients.
- Align API handbook and Unity contract to the new source of truth.
- Support optional assignment-level surveys configurable by faculty/admin.

### 4.2 Non-Goals
- Rewriting simulation narrative prompts or rubric content.
- Replacing existing cloud stack (Amplify/Lambda/Cognito/DynamoDB).
- External LMS integration in this phase.
- Add a new portal for patients' family members and friends and also general public to understand how to interact with the people suffering from communication disorders.

---

## 5. High-Level Architecture (Target)

### 5.1 Frontend Applications (single web app, role-based routes)
- Student Portal: assignment execution + personal performance.
- Faculty Portal: assignment authoring + student monitoring + analysis.
- Admin Portal: users/roles + platform analytics.

### 5.2 Backend Services
- Assignment Service: create/publish/list assignments.
- Session Service: start attempt, append turns/events, complete session.
- Runtime Service: dialogue/scoring/tts using assignment-derived context.
- Analytics Service: cohort/platform aggregations.
- Auth Service: login/profile/role context.

### 5.3 Data Layer
- Canonical entities: SceneCatalog, Assignment, Enrollment, Session, Evaluation.
- Event/turn-level data linked by `sessionId`.
- Legacy level-key tables supported during migration only.

---

## 6. Frontend Portal Design (Detailed)

## 6.1 Student Portal
### Current State
- Step pages exist; no assignment dashboard.

### Target State (Pages)
1. Student Dashboard
- Active assignments count
- Upcoming due dates
- Performance summary (rolling score, trend)

2. Assignments Page
- Assignment list with status, mode, due date
- Launch action (starts/continues session)
- Scene label and scenario objective

3. Session Runner Page
- Live conversation (Unity Webgl) [Currently the students can choose finish inside unity]

4. History & Performance Page
- Past attempts by assignment
- Score/rubric history
- Practice-vs-assessment comparison

5. Session Detail Page
- Conversation history
- Evaluation report and rubric explanations

### Why
Students need assignment-first access and attempt history, not step-level progression.

## 6.2 Faculty Portal
### Current State
Didn't develop before

### Target State (Pages)
1. Faculty Dashboard
- Cohort completion summary
- At-risk student count
- Recent assignment activity

2. Create/Edit Assignment
- Select hardcoded `sceneId` from catalog
- Define mode (`practice` or `assessment`) [or both?]
- Attempt policy (unlimited/capped)
- Optional survey policy (enabled/disabled, required/optional, survey template)
- Due dates and target audience (cohort/group/student)

3. Assignment Management
- Draft/published/archive states
- Enrollment/assignment-level status

4. Students Data Page
- Filterable table (cohort, assignment, date)
- Attempt counts, average score, pace metrics, trend

5. Analysis Pages
- Completion funnel
- Score distribution by assignment/scene
- Rubric area heatmap
- Intervention queue (below threshold)
- Survey response/completion metrics

### Why
Faculty needs both operational control (assignment lifecycle) and outcomes analysis.

## 6.3 Admin Portal
### Current State
- Didn't develop before

### Target State (Pages)
1. Admin Dashboard
- Active users by role
- Assignment volume
- Platform completion density

2. Users & Roles
- Role assignment and activation controls
- Cohort mappings

3. Global Analytics
- Cross-cohort performance
- Reliability metrics (API error rates, scoring latency)
- Utilization trends
- Survey participation and completion trends

4. Audit & Operations (optional in phase 2)
- Role changes
- Assignment publish history
- Incident signals

### Why
Admin scope includes governance and system-level observability.

---

## 7. Runtime Context: Current vs Target

### 7.1 Current
- `simulationLevel` is required in major runtime requests.
- Backend infers task/prompt and sometimes voice from level.

### 7.2 Target
- Canonical runtime context:
```json
{
  "context": {
    "assignmentId": "asg_123",
    "sessionId": "sess_456"
  }
}
```
- Backend resolves `sceneId`, `scenarioKey`, prompt profile, voice policy from assignment metadata.
- Optional client trace fields (`sceneId`, `scenarioKey`) are validation-only, not authoritative.

### 7.3 Why
- Best scalability with many assignments and mixed modes.
- Stronger integrity and reduced client/backend drift.

---

## 8. Attempts, Modes, and Session Policy

### Current
- No explicit mode model; level flow implies limited linear progression.

### Target
- Practice mode: retries allowed (configurable, default unlimited).
- Assessment mode: capped attempts (default 1, optional policy override).
- Every attempt = new session record with `attemptNo`.
- Optional post-assignment survey shown based on assignment survey policy.

### Why
- Supports pedagogical repetition in practice.
- Preserves evaluation fairness in assessment.

---

## 9. Data Model Evolution

### 9.1 Current Entities (observed)
- `SimulationData(userID, simulationLevel)`
- `DebriefAnswers(userID, simulationLevel)`
- Survey tables by user

### 9.2 Target Entities
1. `SceneCatalog`
- `sceneId` (PK), `scenarioKey`, `difficulty`, `tags`, `isActive`

2. `Assignment`
- `assignmentId` (PK), `sceneId`, `mode`, `attemptPolicy`, `surveyPolicy`, `dueDate`, `targetType`, `targetId`, `status`, `createdBy`

3. `AssignmentEnrollment`
- `assignmentId + studentUserId`, `deliveryStatus`, `startedAt`, `completedAt`

4. `SimulationSession`
- `sessionId` (PK), `assignmentId`, `studentUserId`, `attemptNo`, `mode`, `status`, `startedAt`, `endedAt`

5. `SessionTurn`
- `sessionId + turnIndex`, `userText`, `modelText`, `emotionCode`, `motionCode`, `latencyMs`

6. `SessionEvaluation`
- `sessionId` (PK/FK), `totalScore`, `performanceLevel`, `rubric[]`, `responseTimeAvgSec`

7. `SurveyTemplate`
- `surveyTemplateId` (PK), `name`, `questions[]`, `ownerRole`, `isActive`

8. `AssignmentSurveyResponse`
- `assignmentId + sessionId + studentUserId`, `surveyTemplateId`, `answers`, `submittedAt`, `completionStatus`

### 9.3 Migration Direction
- Keep legacy tables readable during transition.
- New writes go to session-centric tables.
- Legacy removal after migration window and validation.

---

## 10. API Contract Evolution (Aligned with Existing Docs)

## 10.1 Auth
### Current
- Login returns `simulationLevel` as primary runtime field.

### Target
- Login returns identity + role + assignment summary.
- Keep `simulationLevel` under `deprecated` block during transition.

## 10.2 Runtime APIs (`/llm-dialogue`, `/llm-scoring`, `/tts`)
### Current
- `simulationLevel` required and used for routing.

### Target
- `context.assignmentId + context.sessionId` required in v2.
- Level accepted as temporary fallback only.
- Add `409` for context mismatch/session state conflicts.

## 10.3 Data APIs (`/simulation-data`, `/debrief`)
### Current
- keyed by user+level.

### Target
- session-based payloads and queries (`sessionId`, `assignmentId`).

### Why
- Aligns API handbook with actual portal and assignment workflows.

## 10.4 Survey APIs (Assignment-Optional)
### Target
- `GET /survey-templates` (faculty/admin)
- `POST /survey-templates` (faculty/admin)
- `POST /assignments/{assignmentId}/survey-config` (faculty/admin)
- `GET /assignments/{assignmentId}/survey-config`
- `POST /sessions/{sessionId}/survey-response` (student)
- `GET /analytics/surveys` (faculty/admin)

### Survey Policy Model
- `surveyPolicy.enabled: boolean`
- `surveyPolicy.required: boolean`
- `surveyPolicy.templateId: string`
- `surveyPolicy.displayTiming: \"post-session\" | \"post-assignment\"`

---

## 11. Tech Stack (Target, explicitly based on current stack)

We keep the existing stack and extend it:

### Frontend
- React + TypeScript + Vite
- React Router (role and portal routing)
- Redux Toolkit (session, assignment, analytics slices)
- Mantine UI (continue existing component system)
- JSON-driven survey rendering for optional assignment surveys

### Backend
- AWS Amplify Gen 2 orchestration
- AWS Lambda handlers per domain service
- API Gateway REST routes
- Shared validation and auth middleware

### Data and Auth
- DynamoDB tables via Amplify Data models
- Cognito user pool for auth and role claims

### AI and Media
- OpenAI dialogue/scoring (existing handlers)
- Elevenlabs for TTS (existing handler path)

### Observability
- CloudWatch logs and alarms
- requestId-based tracing through runtime APIs

---

## 12. Migration Plan

### Phase 0: Schema + Endpoint Introduction
- Add assignment/session models.
- Add v2 context-aware runtime validation.

### Phase 1: Dual Support
- Frontend starts sending context.
- Backend still accepts `simulationLevel` fallback.
- Add deprecation telemetry in responses/logs.
- Introduce survey templates and assignment survey policy endpoints.

### Phase 2: Portal Cutover
- Student/faculty/admin pages consume assignment/session APIs only.
- Analytics derived from session/evaluation tables.
- Student portal includes optional post-assignment survey surfaces.

### Phase 3: Deprecation Enforcement
- Disable level-based routing for web portal clients.
- Keep minimal compatibility path for legacy Unity if needed.

### Phase 4: Legacy Cleanup
- Remove level-key write paths after verification window.

---

## 13. Risks and Mitigations
- Risk: dual-write mismatch during migration
  - Mitigation: parity checks + reconciliation scripts
- Risk: unauthorized cohort data access
  - Mitigation: centralized scope checks in backend
- Risk: handbook and code drift
  - Mitigation: release checklist requiring handbook updates with endpoint changes
- Risk: attempt-policy confusion across courses
  - Mitigation: explicit assignment policy fields + UI labels
- Risk: low completion for optional surveys
  - Mitigation: configurable required/optional survey policy + reminder UX

---

## 14. Success Metrics
- more than 95% runtime calls use assignment/session context by end of phase 2
- No prompt/voice routing from inferred login level after phase 3
- Correct practice/assessment attempt enforcement
- Faculty/admin analytics match session/evaluation source data
- Survey response rates are measurable per assignment/cohort

---

## 15. Open Discussion Points
- Practice mode retry cap default: unlimited or high fixed cap?
- Assessment mode default: one attempt or configurable 1-2?
- Admin assignment write privileges at launch?
- Deprecation timeline for removing `simulationLevel` from login payload?
- Default survey policy for new assignments (off by default vs template default)?

---

## Appendix A: Concrete Current Couplings (Code Reality)
- Auth infers level from Cognito step state.
- Dialogue validates/maps by `simulationLevel`.
- TTS scenario fallback is level-based.
- Simulation/debrief persistence keys use `userID + simulationLevel`.
- Data schema identifiers currently include `simulationLevel` composite keys.

---

## Appendix B: SceneCatalog Parameters — Unity Binding & Gaps

> **Status**: Open / Needs team alignment  
> **Context**: Each scene in `SceneCatalog` will ultimately drive a Unity WebGL simulation. The current schema only stores metadata for the web platform (`sceneId`, `scenarioKey`, `title`, `description`, `difficulty`, `tags`, `isActive`). These fields are **not sufficient** for Unity to fully resolve which 3D environment, avatar, animation set, and voice to use at runtime. Since scenes are tightly bound to the Unity project, the parameter contract between this backend and the Unity client must be explicitly defined.

### B.1 Current SceneCatalog Schema (as implemented)

| Field | Type | Purpose |
|---|---|---|
| `sceneId` | string (PK) | Unique identifier |
| `scenarioKey` | string | Maps to prompt set (`task1`, `task2`, `task3`) |
| `title` | string | Display name |
| `description` | string | Short summary |
| `difficulty` | string | `beginner` / `intermediate` / `advanced` |
| `tags` | json (string[]) | Searchable labels |
| `isActive` | boolean | Soft-delete flag |

### B.2 Known Gaps — Parameters Needed but Not Yet Defined

The following categories of parameters are currently either hardcoded in Lambda functions or completely absent. They need to be formally added to `SceneCatalog` (or a related config entity) so that both the web frontend and Unity client can resolve a complete scene at runtime.

#### 1. Unity Scene / Environment Binding

| Proposed Field | Type | Purpose |
|---|---|---|
| `unitySceneKey` | string | The scene identifier Unity uses to load the correct 3D environment (e.g. `"clinic_room_01"`, `"hospital_bedside"`) |
| `environmentType` | enum | High-level environment category: `clinic_room`, `hospital_room`, `home_visit`, `rehab_center` |
| `cameraPreset` | string | Default camera angle/layout Unity should use (e.g. `"seated_face_to_face"`, `"bedside"`) |

#### 2. Virtual Patient / Avatar Configuration

| Proposed Field | Type | Purpose |
|---|---|---|
| `patientName` | string | Patient display name (currently hardcoded in prompts: Karen Harris / Sarah / Maria) |
| `patientAge` | integer | Age of the virtual patient |
| `patientGender` | enum | `female` / `male` / `other` |
| `avatarModelId` | string | Which 3D avatar model Unity should load (e.g. `"avatar_karen"`, `"avatar_maria"`) |
| `avatarAnimationSetId` | string | Which animation mapping set to use — defines how `emotionCode` (0-9) and `motionCode` (0-9) translate to Unity animations |

#### 3. Voice Configuration (currently hardcoded in `voicePolicy.ts`)

| Proposed Field | Type | Purpose |
|---|---|---|
| `voiceId` | string | ElevenLabs voice ID (currently mapped by `simulationLevel` in `SIMULATION_LEVEL_VOICE_ID_MAP`) |
| `voiceModelId` | string | TTS model, e.g. `"eleven_multilingual_v2"` |
| `voiceSettings` | json | Default `{ stability, similarityBoost, styleExaggeration, speed }` per scene |

#### 4. Clinical / Disorder Profile

| Proposed Field | Type | Purpose |
|---|---|---|
| `disorderType` | string | Primary diagnosis, e.g. `"broca_aphasia"`, `"wernicke_aphasia"`, `"tbi_cognitive"` |
| `severityLevel` | enum | `mild` / `moderate` / `severe` — more clinically precise than `difficulty` |
| `patientCooperationProfile` | enum | Expected patient behavior: `cooperative`, `initially_cooperative_then_resistant`, `uncooperative_unless_encouraged` |
| `clinicalBackgroundSummary` | string | Brief medical/social history for UI display and prompt context |
| `therapeuticGoals` | json (string[]) | Learning objectives for this scene, e.g. `["confrontation_naming", "repetition_tasks", "emotional_support"]` |

#### 5. LLM / Prompt Binding

| Proposed Field | Type | Purpose |
|---|---|---|
| `promptTemplateId` | string | Reference to the prompt version/template to use (replaces implicit `scenarioKey -> DIALOGUE_PROMPTS` lookup) |
| `scoringRubricId` | string | Reference to which scoring rubric applies to this scene |
| `maxTurns` | integer | Optional turn limit for the conversation |
| `targetSkills` | json (string[]) | Skills being evaluated, e.g. `["scaffolding", "encouragement", "simplification", "cueing"]` |

#### 6. Runtime Behavior Hints (for Unity)

| Proposed Field | Type | Purpose |
|---|---|---|
| `emotionCodeRange` | json | Subset or weighting of emotion codes (0-9) most relevant to this scene |
| `motionCodeRange` | json | Subset or weighting of motion codes (0-9) most relevant to this scene |
| `ambientAudioKey` | string | Background audio Unity should play (e.g. `"hospital_ambient"`, `"quiet_clinic"`) |
| `sessionTimeLimitSec` | integer | Optional hard time limit for the simulation session |

### B.3 Why This Matters

1. **Unity cannot resolve scenes from `scenarioKey` alone.** Today `task1/task2/task3` is mapped by convention, but as scenes grow beyond three, Unity needs explicit binding fields (`unitySceneKey`, `avatarModelId`, etc.).
2. **Voice is hardcoded by simulation level.** The `SIMULATION_LEVEL_VOICE_ID_MAP` in `voicePolicy.ts` must be replaced with a per-scene `voiceId` so new scenes don't require code changes.
3. **Prompt selection is implicit.** The `scenarioKey -> DIALOGUE_PROMPTS` mapping in the dialogue handler should be driven by a `promptTemplateId` on the scene, enabling faculty to manage prompt versions without redeployment.
4. **Clinical metadata is buried in prompts.** Patient name, age, disorder severity, and cooperation style are only in the prompt text. Extracting them to structured fields enables better filtering, analytics, and UI display.

### B.4 Recommended Next Steps

- [ ] Align with Unity team on which fields they need to resolve a scene (minimum: `unitySceneKey`, `avatarModelId`, `avatarAnimationSetId`)
- [ ] Decide whether voice/prompt/rubric configs live directly on `SceneCatalog` or in separate linked entities (e.g. `VoiceProfile`, `PromptTemplate`, `ScoringRubric`)
- [ ] Add clinical metadata fields so the faculty Scene Management UI can display meaningful patient info without parsing prompt text
- [ ] Update seed script (`seed-scene-catalog.ts`) and Scene Management frontend (`SceneManagement.tsx`) to include new fields once finalized
