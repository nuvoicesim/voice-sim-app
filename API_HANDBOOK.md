# VOICE API Handbook

## Overview
This document provides API interface specifications for the VOICE (Speech-Language Pathology Simulation) platform, including authentication, user management, simulation session lifecycle, AI services, and analytics endpoints.

## Environment Configuration

### Sandbox (Development Environment)
- **Base URL**: `https://f0kk74qeyf.execute-api.us-west-2.amazonaws.com/dev`
- **Purpose**: Development and testing, data will not affect production environment

### Production (Production Environment)
- **Base URL**: `https://bhyalmu7i1.execute-api.us-east-1.amazonaws.com/prod`
- **Purpose**: Production user access, data will be permanently stored

## Authentication Headers

Many endpoints require caller identity via request headers. These headers are set by the frontend after Cognito login and are used for role-based access control.

| Header | Description | Required |
|--------|-------------|----------|
| `x-user-id` | The Cognito `sub` (UUID) of the calling user | Yes (for protected endpoints) |
| `x-user-role` | The user's role: `student`, `faculty`, or `admin` | Yes (for protected endpoints) |
| `x-user-email` | The user's email address | Optional |

When a protected endpoint is called without valid headers, the response is:

**401 — Missing headers**:
```json
{
  "error": "Missing authentication headers (x-user-id, x-user-role)"
}
```

**403 — Insufficient role**:
```json
{
  "error": "Role 'student' is not authorized. Required: faculty, admin"
}
```

---

## API Endpoints

### 1. User Authentication API

#### 1.1 User Login
- **Endpoint**: `/auth/login`
- **Method**: `POST`
- **Description**: Validates user credentials and returns user identity

**Request Body**:
```json
{
  "username": "user001@nursetown.com",
  "password": "user_password"
}
```

**Success Response** (200):
```json
{
  "message": "Login successful",
  "userID": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "simulationLevel": 1
}
```

**Failure Response** (400 - Invalid Credentials):
```json
{
  "error": "Invalid username or password"
}
```

**Failure Response** (403 - All Simulations Completed):
```json
{
  "error": "You have completed all simulations. Please head to post survey.",
  "currentStep": "level-3-simulation",
  "simulationLevel": null
}
```

**Error Code Descriptions**:
- `400`: Request parameter error (missing username/password)
- `401`: User account not confirmed
- `403`: User has completed all simulations, cannot continue
- `404`: User not found
- `500`: Server internal error

#### 1.2 User Signout
- **Endpoint**: `/auth/signout`
- **Method**: `POST`
- **Description**: Simple signout confirmation

**Request Body**: None (empty JSON object is fine)
```json
{}
```

**Success Response** (200):
```json
{
  "message": "Sign out successful",
  "timestamp": "2025-08-19T18:30:00.000Z"
}
```

---

### 2. Cognito User Management API

#### 2.1 Create User
- **Endpoint**: `/cognito-user`
- **Method**: `POST`
- **Description**: Creates a new Cognito user with an auto-generated email (`<username>@voice-sim.org`) and password. Default role is `student`.

**Request Body**:
```json
{
  "username": "john_doe"
}
```

Any additional fields are stored as `custom:<key>` attributes in Cognito.

**Success Response** (200):
```json
{
  "message": "User created successfully",
  "username": "john_doe@voice-sim.org",
  "password": "aB3$xYz9!mN",
  "createdAt": "2026-03-25T10:00:00.000Z",
  "updatedAt": "2026-03-25T10:00:00.000Z",
  "customAttributes": []
}
```

**Error Responses**:
- `400`: Missing `username`
- `409`: Username already exists
- `500`: Server error

#### 2.2 Get User
- **Endpoint**: `/cognito-user`
- **Method**: `GET`
- **Description**: Retrieves a single user's information by Cognito username

**Query Parameters**:
```
?username=john_doe@voice-sim.org
```

**Success Response** (200):
```json
{
  "username": "john_doe@voice-sim.org",
  "userStatus": "CONFIRMED",
  "attributes": {
    "email": "john_doe@voice-sim.org",
    "email_verified": "true",
    "custom:role": "student",
    "sub": "7811e3a0-a061-70d2-c7d6-315cd36795c4"
  }
}
```

**Error Responses**:
- `400`: Missing `username` / user not found
- `500`: Server error

#### 2.3 List Users
- **Endpoint**: `/cognito-user`
- **Method**: `GET`
- **Description**: Lists all Cognito users with pagination and optional filtering

**Query Parameters**:
```
?list=true&limit=20&paginationToken=xxx&role=student&search=john
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `list` | Yes | Must be `"true"` |
| `limit` | No | Max results per page (default 20, max 60) |
| `paginationToken` | No | Token for next page |
| `role` | No | Filter by role: `student`, `faculty`, `admin` |
| `search` | No | Prefix search on email or username |

**Success Response** (200):
```json
{
  "users": [
    {
      "username": "john_doe@voice-sim.org",
      "userStatus": "CONFIRMED",
      "enabled": true,
      "createdAt": "2026-03-20T10:00:00.000Z",
      "attributes": {
        "email": "john_doe@voice-sim.org",
        "custom:role": "student"
      }
    }
  ],
  "paginationToken": null
}
```

> **Note**: When `search` is provided, `paginationToken` is always `null` (full results returned).

#### 2.4 Batch Resolve User IDs
- **Endpoint**: `/cognito-user/resolve`
- **Method**: `POST`
- **Description**: Resolves an array of Cognito `sub` UUIDs to their email addresses (max 50)

**Request Body**:
```json
{
  "userIds": [
    "7811e3a0-a061-70d2-c7d6-315cd36795c4",
    "a2b3c4d5-e6f7-8901-2345-678901234567"
  ]
}
```

**Success Response** (200):
```json
{
  "users": [
    { "userId": "7811e3a0-a061-70d2-c7d6-315cd36795c4", "email": "john_doe@voice-sim.org" },
    { "userId": "a2b3c4d5-e6f7-8901-2345-678901234567", "email": null }
  ]
}
```

**Error Responses**:
- `400`: Missing or empty `userIds` array
- `500`: Server error

#### 2.5 Update User Role
- **Endpoint**: `/cognito-user/{userId}/role`
- **Method**: `PUT`
- **Description**: Updates a user's role (admin-only operation)

**Request Body**:
```json
{
  "role": "faculty",
  "callerRole": "admin"
}
```

**Success Response** (200):
```json
{
  "message": "Role updated successfully",
  "userId": "john_doe@voice-sim.org",
  "role": "faculty"
}
```

**Error Responses**:
- `400`: Invalid role (must be `student`, `faculty`, or `admin`)
- `403`: `callerRole` is not `admin`
- `404`: User not found
- `500`: Server error

---

### 3. Scene Catalog API

Manages clinical simulation scene definitions. Write operations require `faculty` or `admin` role via auth headers.

#### 3.1 List Scenes
- **Endpoint**: `/scene-catalog`
- **Method**: `GET`
- **Description**: Lists all active scenes

**Success Response** (200):
```json
{
  "scenes": [
    {
      "sceneId": "sc-abc123",
      "scenarioKey": "task1",
      "title": "Aphasia Patient - Basic Assessment",
      "description": "A basic SLP assessment scenario",
      "difficulty": "medium",
      "tags": ["aphasia", "assessment"],
      "unityBuildFolder": "scene_task1",
      "isActive": true,
      "createdAt": "2026-03-20T10:00:00.000Z",
      "updatedAt": "2026-03-20T10:00:00.000Z"
    }
  ]
}
```

#### 3.2 Get Scene
- **Endpoint**: `/scene-catalog?sceneId={sceneId}`
- **Method**: `GET`
- **Description**: Retrieves a single scene by ID

**Query Parameters**:
```
?sceneId=sc-abc123
```

**Success Response** (200): Single scene object (same shape as list items)

**Error Responses**:
- `404`: Scene not found

#### 3.3 Create Scene
- **Endpoint**: `/scene-catalog`
- **Method**: `POST`
- **Auth**: `faculty` or `admin`

**Request Body**:
```json
{
  "scenarioKey": "task1",
  "title": "Aphasia Patient - Basic Assessment",
  "description": "A basic SLP assessment scenario",
  "difficulty": "medium",
  "tags": ["aphasia", "assessment"],
  "unityBuildFolder": "scene_task1"
}
```

**Required Fields**:
- `scenarioKey`: string — maps to the LLM/TTS prompt set
- `title`: string

**Optional Fields**:
- `description`: string (default `""`)
- `difficulty`: string (default `"medium"`)
- `tags`: string array (default `[]`)
- `unityBuildFolder`: string (default `""`)

**Success Response** (201): The created scene object with auto-generated `sceneId`

**Error Responses**:
- `400`: Missing `scenarioKey` or `title`
- `401`/`403`: Auth error

#### 3.4 Update Scene
- **Endpoint**: `/scene-catalog/{sceneId}`
- **Method**: `PUT`
- **Auth**: `faculty` or `admin`

**Request Body**: Partial object with fields to update (e.g., `{ "title": "New Title" }`)

**Success Response** (200): The updated scene object

**Error Responses**:
- `404`: Scene not found
- `401`/`403`: Auth error

#### 3.5 Delete Scene (Soft Delete)
- **Endpoint**: `/scene-catalog/{sceneId}`
- **Method**: `DELETE`
- **Auth**: `faculty` or `admin`
- **Description**: Sets `isActive` to `false` (scene is hidden from listing, not physically deleted)

**Success Response** (200):
```json
{
  "message": "Scene deactivated",
  "sceneId": "sc-abc123"
}
```

**Error Responses**:
- `404`: Scene not found
- `401`/`403`: Auth error

---

### 4. Assignment API

Manages assignments that link scenes to student activities. Write operations require `faculty` or `admin` role.

#### 4.1 List Assignments
- **Endpoint**: `/assignments`
- **Method**: `GET`
- **Description**: Lists assignments. Students only see `published` assignments; faculty/admin see all.

**Query Parameters** (optional):
```
?status=published
```

**Success Response** (200):
```json
{
  "assignments": [
    {
      "assignmentId": "asgn-xyz789",
      "sceneId": "sc-abc123",
      "title": "Week 3 - Aphasia Assessment",
      "description": "Practice basic assessment techniques",
      "mode": "practice",
      "attemptPolicy": { "maxAttempts": -1 },
      "surveyPolicy": { "enabled": false, "required": false, "templateId": null, "displayTiming": "post-session" },
      "dueDate": "2026-04-01T23:59:59.000Z",
      "targetType": "cohort",
      "targetId": null,
      "status": "published",
      "createdBy": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
      "createdAt": "2026-03-20T10:00:00.000Z",
      "updatedAt": "2026-03-20T10:00:00.000Z"
    }
  ]
}
```

#### 4.2 Get Assignment
- **Endpoint**: `/assignments/{assignmentId}`
- **Method**: `GET`

**Success Response** (200): Single assignment object

**Error Responses**:
- `404`: Assignment not found

#### 4.3 Create Assignment
- **Endpoint**: `/assignments`
- **Method**: `POST`
- **Auth**: `faculty` or `admin`

**Request Body**:
```json
{
  "sceneId": "sc-abc123",
  "title": "Week 3 - Aphasia Assessment",
  "description": "Practice basic assessment techniques",
  "mode": "practice",
  "attemptPolicy": { "maxAttempts": 3 },
  "surveyPolicy": { "enabled": true, "required": false, "templateId": "tpl-001", "displayTiming": "post-session" },
  "dueDate": "2026-04-01T23:59:59.000Z",
  "targetType": "cohort",
  "targetId": null
}
```

**Required Fields**:
- `sceneId`: string
- `title`: string
- `mode`: `"practice"` or `"assessment"`

**Optional Fields**:
- `description`: string (default `""`)
- `attemptPolicy`: object (default: unlimited for practice, 1 for assessment)
- `surveyPolicy`: object (default: disabled)
- `dueDate`: ISO 8601 string or `null`
- `targetType`: string (default `"cohort"`)
- `targetId`: string or `null`

**Success Response** (201): The created assignment object (initial `status` is `"draft"`)

**Error Responses**:
- `400`: Missing required fields or invalid `mode`
- `401`/`403`: Auth error

#### 4.4 Update Assignment
- **Endpoint**: `/assignments/{assignmentId}`
- **Method**: `PUT`
- **Auth**: `faculty` or `admin`

**Request Body**: Partial object with fields to update. Fields `assignmentId`, `createdBy`, and `createdAt` are protected and cannot be overwritten.

**Success Response** (200): The updated assignment object

**Error Responses**:
- `404`: Assignment not found
- `401`/`403`: Auth error

#### 4.5 Update Assignment Status
- **Endpoint**: `/assignments/{assignmentId}/status`
- **Method**: `PUT`
- **Auth**: `faculty` or `admin`

**Request Body**:
```json
{
  "status": "published"
}
```

**Valid status values**: `"draft"`, `"published"`, `"archived"`

**Success Response** (200): The updated assignment object

**Error Responses**:
- `400`: Invalid status value
- `404`: Assignment not found
- `401`/`403`: Auth error

---

### 5. Session API

Manages simulation session lifecycle. Sessions are created when a student launches an assignment simulation.

#### 5.1 Start Session
- **Endpoint**: `/sessions`
- **Method**: `POST`
- **Auth**: `student` only
- **Description**: Creates a new simulation session attempt. If the student already has an active (uncompleted) session for the same assignment, the existing session is returned instead.

**Request Body**:
```json
{
  "assignmentId": "asgn-xyz789"
}
```

**Success Response — new session** (201):
```json
{
  "session": {
    "sessionId": "sess-abc123",
    "assignmentId": "asgn-xyz789",
    "studentUserId": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
    "attemptNo": 1,
    "mode": "practice",
    "status": "active",
    "startedAt": "2026-03-25T10:00:00.000Z",
    "endedAt": null,
    "createdAt": "2026-03-25T10:00:00.000Z"
  }
}
```

**Success Response — resuming existing session** (200):
```json
{
  "message": "Resuming existing active session",
  "session": { ... }
}
```

**Error Responses**:
- `400`: Missing `assignmentId` / assignment not published
- `404`: Assignment not found
- `409`: Maximum attempts reached
- `401`/`403`: Auth error

#### 5.2 Get Session Detail
- **Endpoint**: `/sessions/{sessionId}`
- **Method**: `GET`
- **Description**: Returns session info along with all conversation turns and evaluation (if completed)

**Success Response** (200):
```json
{
  "session": {
    "sessionId": "sess-abc123",
    "assignmentId": "asgn-xyz789",
    "studentUserId": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
    "attemptNo": 1,
    "mode": "practice",
    "status": "completed",
    "startedAt": "2026-03-25T10:00:00.000Z",
    "endedAt": "2026-03-25T10:15:00.000Z",
    "createdAt": "2026-03-25T10:00:00.000Z"
  },
  "turns": [
    {
      "sessionId": "sess-abc123",
      "turnIndex": 1,
      "userText": "Hello, how are you today?",
      "modelText": "um... okay...",
      "emotionCode": 0,
      "motionCode": 5,
      "latencyMs": 1500,
      "timestamp": "2026-03-25T10:01:00.000Z"
    }
  ],
  "evaluation": {
    "sessionId": "sess-abc123",
    "totalScore": 18,
    "performanceLevel": "Proficient",
    "rubric": [ ... ],
    "overallExplanation": "Your session demonstrated several strengths...",
    "createdAt": "2026-03-25T10:15:05.000Z"
  }
}
```

> `turns` and `evaluation` may be empty arrays / `null` if the session is still active.

**Error Responses**:
- `404`: Session not found

#### 5.3 Complete Session
- **Endpoint**: `/sessions/{sessionId}/complete`
- **Method**: `PUT`
- **Auth**: `student` only (must be the session owner)

**Request Body**: None

**Success Response** (200):
```json
{
  "session": {
    "sessionId": "sess-abc123",
    "status": "completed",
    "endedAt": "2026-03-25T10:15:00.000Z"
  }
}
```

**Error Responses**:
- `403`: Cannot complete another student's session
- `404`: Session not found
- `409`: Session is already completed
- `401`/`403`: Auth error

#### 5.4 List Sessions by Assignment
- **Endpoint**: `/assignments/{assignmentId}/sessions`
- **Method**: `GET`
- **Description**: Lists sessions for a specific assignment. Students are automatically filtered to their own sessions. Faculty/admin can optionally filter by `studentUserId` or view all.

**Query Parameters** (optional):
```
?studentUserId=7811e3a0-a061-70d2-c7d6-315cd36795c4
```

**Success Response** (200):
```json
{
  "sessions": [ ... ]
}
```

#### 5.5 List My Sessions
- **Endpoint**: `/sessions`
- **Method**: `GET`
- **Auth**: Requires `x-user-id` header
- **Description**: Lists all sessions for the authenticated user

**Success Response** (200):
```json
{
  "sessions": [ ... ]
}
```

**Error Responses**:
- `401`: Authentication required (missing `x-user-id`)

---

### 6. LLM APIs

Two endpoints for LLM-powered patient simulation: dialogue generation and session scoring.
System prompts are managed server-side; clients only send conversation turns.

Both endpoints support two context resolution modes:
- **Context-based** (recommended): Provide `context.assignmentId` + `context.sessionId` — the backend resolves the scenario from Assignment → Scene → `scenarioKey`.
- **Legacy**: Provide `simulationLevel` (1, 2, or 3) — maps directly to `task1`, `task2`, `task3`.

#### 6.1 LLM Dialogue
- **Endpoint**: `/llm-dialogue`
- **Method**: `POST`
- **Health Check**: `GET /llm-dialogue/health`
- **Default Model**: `gpt-4o-mini`
- **Description**: Generates a simulated patient response.

**Request Headers**:
```
Content-Type: application/json
X-Request-ID: <optional, for tracing>
```

**Request Body (context-based)**:
```json
{
  "userID": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "context": {
    "assignmentId": "asgn-xyz789",
    "sessionId": "sess-abc123"
  },
  "messages": [
    { "role": "user", "content": "Hello, how are you feeling today?" }
  ],
  "metadata": {
    "turnIndex": 1,
    "client": "unity"
  }
}
```

**Request Body (legacy)**:
```json
{
  "userID": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "simulationLevel": 1,
  "messages": [
    { "role": "user", "content": "Hello, how are you feeling today?" }
  ],
  "metadata": {
    "sessionId": "session-20260217-001",
    "turnIndex": 1,
    "client": "unity"
  }
}
```

**Required Fields**:
- `userID`: string (UUID)
- One of:
  - `context.assignmentId` (string) + `context.sessionId` (string)
  - `simulationLevel`: integer (1, 2, or 3)
- `messages`: non-empty array
- `messages[].role`: `"user"` or `"assistant"` (do NOT send `"system"`)
- `messages[].content`: non-empty string

**Optional Fields**:
- `scenario`: string (for client traceability)
- `options.temperature`: number (default: `0.2`)
- `options.maxOutputTokens`: number (default: `220`)
- `metadata.sessionId`: string (auto-filled from `context.sessionId` when using context-based flow)
- `metadata.turnIndex`: number
- `metadata.client`: string

**Success Response** (200):
```json
{
  "requestId": "9d7f4f4f-bc81-4c37-99a8-25de0a8f8f44",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "{\"responseText\":\"um... okay... little... tired...\",\"emotionCode\":0,\"motionCode\":5}"
      }
    }
  ],
  "model": "gpt-4o-mini",
  "usage": {
    "inputTokens": 3361,
    "outputTokens": 23,
    "totalTokens": 3384
  },
  "latencyMs": 1627,
  "createdAt": "2026-02-17T01:27:22.781Z",
  "metadata": {
    "scenario": "task1",
    "promptVersion": "task1-dialogue-v1",
    "sessionId": "sess-abc123",
    "turnIndex": 1,
    "fallbackUsed": false,
    "malformedRetryTriggered": false
  }
}
```

The `choices[0].message.content` field is a **JSON string**. When parsed:

```json
{
  "responseText": "um... okay... little... tired...",
  "emotionCode": 0,
  "motionCode": 5
}
```

- `responseText` (string): patient's spoken dialogue
- `emotionCode` (integer, 0–9): facial emotion animation index
- `motionCode` (integer, 0–9): body motion animation index

If the backend cannot produce a valid response after retrying, it returns a safe fallback (`metadata.fallbackUsed: true`):
```json
{
  "responseText": "I.. I don't k-know...",
  "emotionCode": 7,
  "motionCode": 1
}
```

**Multi-turn Usage**: Send the full conversation history each turn. The backend caps at the most recent 20 messages.

**Failure Responses**:

- `400`: Missing or invalid required fields
```json
{
  "error": "messages must be a non-empty array",
  "requestId": "...",
  "retryable": false
}
```

- `413`: Prompt exceeds allowed size
- `429`: Rate limit exceeded (`retryable: true`)
- `502`: LLM provider timeout or unavailable (`retryable: true`)
- `500`: Internal server error

#### 6.2 LLM Scoring
- **Endpoint**: `/llm-scoring`
- **Method**: `POST`
- **Health Check**: `GET /llm-scoring/health`
- **Default Model**: `gpt-4o-2024-08-06`
- **Description**: Scores a completed simulation session against a rubric and returns a structured evaluation report. Call once at session end. When using context-based flow, the evaluation is automatically persisted to the `SessionEvaluation` table.

**Request Headers**:
```
Content-Type: application/json
X-Request-ID: <optional, for tracing>
```

**Request Body (context-based)**:
```json
{
  "userID": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "context": {
    "assignmentId": "asgn-xyz789",
    "sessionId": "sess-abc123"
  },
  "conversationTurns": [
    { "patient": "I... uh... fine...", "nurse": "Hi Karen, how are you today?" },
    { "patient": "Talk... hard...", "nurse": "Take your time. I'm here to help." }
  ],
  "metadata": {
    "turnIndex": 10,
    "client": "unity"
  }
}
```

**Request Body (legacy)**:
```json
{
  "userID": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "simulationLevel": 1,
  "conversationTurns": [
    { "patient": "I... uh... fine...", "nurse": "Hi Karen, how are you today?" },
    { "patient": "Talk... hard...", "nurse": "Take your time. I'm here to help." }
  ],
  "metadata": {
    "sessionId": "session-20260217-001",
    "turnIndex": 10,
    "client": "unity"
  }
}
```

**Required Fields**:
- `userID`: string (UUID)
- One of:
  - `context.assignmentId` (string) + `context.sessionId` (string)
  - `simulationLevel`: integer (1, 2, or 3)
- `conversationTurns`: non-empty array of turn objects
- `conversationTurns[].patient`: non-empty string
- `conversationTurns[].nurse`: non-empty string

**Optional Fields**:
- `metadata.sessionId`: string (auto-filled from `context.sessionId` when using context-based flow)
- `metadata.turnIndex`: number
- `metadata.client`: string

**Success Response** (200):
```json
{
  "requestId": "9d7f4f4f-bc81-4c37-99a8-25de0a8f8f44",
  "report": {
    "criteria": [
      {
        "name": "Greeting and Professional Introduction",
        "score": 2,
        "maxScore": 3,
        "explanation": "You began by greeting the patient by name, which is a good start..."
      },
      {
        "name": "Use of Supported Conversation Techniques",
        "score": 2,
        "maxScore": 3,
        "explanation": "You provided encouragement and reassurance..."
      }
    ],
    "totalScore": 17,
    "performanceLevel": "Developing",
    "overallExplanation": "Your session demonstrated several strengths..."
  },
  "model": "gpt-4o-2024-08-06",
  "usage": {
    "inputTokens": 5200,
    "outputTokens": 1800,
    "totalTokens": 7000
  },
  "latencyMs": 10773,
  "createdAt": "2026-02-17T01:27:39.070Z",
  "metadata": {
    "scenario": "task1",
    "promptVersion": "task1-scoring-v1",
    "sessionId": "sess-abc123",
    "turnIndex": 10,
    "fallbackUsed": false,
    "malformedRetryTriggered": false
  }
}
```

**Report Fields**:
- `report.criteria`: array of 8 rubric criteria, each with `name`, `score` (1–3), `maxScore` (3), and `explanation`
- `report.totalScore`: integer (sum of all scores, range 8–24)
- `report.performanceLevel`: `"Outstanding"` (22–24) | `"Proficient"` (18–21) | `"Developing"` (14–17) | `"Needs Improvement"` (8–13)
- `report.overallExplanation`: summary feedback paragraph

**Rubric Criteria** (8 total):
1. Greeting and Professional Introduction
2. Use of Supported Conversation Techniques
3. Case History Questions
4. Automatic Speech Tasks
5. Repetition Tasks
6. Responsive Naming Tasks
7. Word Filling or Sentence Completion Tasks
8. Session Closure

**Automatic Persistence** (context-based flow only):
When `context.sessionId` is provided, the scoring result is automatically saved to the `SessionEvaluation` table with fields: `sessionId`, `totalScore`, `performanceLevel`, `rubric`, `overallExplanation`, `createdAt`.

**Failure Responses**: Same error envelope and status codes as dialogue endpoint.

#### 6.3 Error Response Contract

All LLM error responses use the same envelope:
```json
{
  "error": "Human-readable message",
  "requestId": "9d7f4f4f-bc81-4c37-99a8-25de0a8f8f44",
  "retryable": false
}
```

**Error Code Descriptions**:
- `400`: Invalid payload or missing required fields
- `413`: Prompt exceeds allowed size
- `429`: Rate limit exceeded (`retryable: true`)
- `502`: LLM provider timeout or unavailable (`retryable: true`)
- `500`: Internal server error

#### 6.4 Latency Expectations

- **Dialogue**: 1–3s typical, ~5s p95
- **Scoring**: 8–15s typical, ~20s p95 (full rubric generation)

---

### 7. TTS API

Text-to-Speech endpoint for Unity voice playback and character timing alignment.
Provider details are managed server-side.

Supports the same two context resolution modes as LLM APIs (context-based and legacy).

#### 7.1 TTS Synthesis
- **Endpoint**: `/tts`
- **Method**: `POST`
- **Health Check**: `GET /tts/health`
- **Description**: Converts input text to PCM audio and returns optional character-level alignment.

**Request Headers**:
```
Content-Type: application/json
X-Request-ID: <optional, for tracing>
```

**Request Body (context-based)**:
```json
{
  "userID": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "context": {
    "assignmentId": "asgn-xyz789",
    "sessionId": "sess-abc123"
  },
  "text": "I... need help speaking.",
  "voiceProfile": {
    "profileId": "patient_task2_primary",
    "voiceId": "VOICE_ID_FROM_TEAM_CONFIG",
    "modelId": "eleven_multilingual_v2",
    "stability": 0.4,
    "similarityBoost": 0.75,
    "styleExaggeration": 0.3,
    "speed": 1.0
  },
  "options": {
    "format": "pcm_16000",
    "includeAlignment": true
  },
  "metadata": {
    "turnIndex": 12,
    "client": "unity"
  }
}
```

**Request Body (legacy)**:
```json
{
  "userID": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "simulationLevel": 2,
  "scenario": "task2",
  "text": "I... need help speaking.",
  "voiceProfile": {
    "profileId": "patient_task2_primary",
    "voiceId": "VOICE_ID_FROM_TEAM_CONFIG",
    "modelId": "eleven_multilingual_v2",
    "stability": 0.4,
    "similarityBoost": 0.75,
    "styleExaggeration": 0.3,
    "speed": 1.0
  },
  "options": {
    "format": "pcm_16000",
    "includeAlignment": true
  },
  "metadata": {
    "sessionId": "session-20260217-001",
    "turnIndex": 12,
    "client": "unity"
  }
}
```

**Required Fields**:
- `userID`: string (UUID)
- One of:
  - `context.assignmentId` (string) + `context.sessionId` (string)
  - `simulationLevel`: integer (1, 2, or 3)
- `text`: non-empty string (max 800 characters)
- `voiceProfile.voiceId`: non-empty string
- `voiceProfile.modelId`: non-empty string

**Optional Fields**:
- `scenario`: string (for client traceability)
- `voiceProfile.profileId`: string
- `voiceProfile.stability`: number (0.0–1.0)
- `voiceProfile.similarityBoost`: number (0.0–1.0)
- `voiceProfile.styleExaggeration`: number (0.0–1.0)
- `voiceProfile.speed`: number (0.7–1.2)
- `options.format`: string (default `pcm_16000`)
- `options.includeAlignment`: boolean (default `true`)
- `metadata.sessionId`: string (auto-filled from `context.sessionId` when using context-based flow)
- `metadata.turnIndex`: number
- `metadata.client`: string

**Voice Selection Policy**:
- Backend resolves the effective `voiceId` from the scenario/level for consistency across clients.
- Client-provided `voiceProfile.voiceId` is accepted but may be overridden by server policy.
- In `strict` validation mode, any server-adjusted fields cause a `400` error instead of silent override.

**Success Response** (200):
```json
{
  "audio_base64": "BASE64_PCM_BYTES",
  "alignment": {
    "characters": ["H", "e", "l", "l", "o"],
    "character_start_times_seconds": [0.01, 0.08, 0.12, 0.17, 0.24],
    "character_end_times_seconds": [0.07, 0.11, 0.16, 0.23, 0.31]
  },
  "provider": "elevenlabs",
  "requestId": "9d7f4f4f-bc81-4c37-99a8-25de0a8f8f44"
}
```

**Response Notes**:
- `audio_base64` decodes to PCM 16-bit mono @ 16kHz (`pcm_16000`).
- When `includeAlignment=true`, `alignment` includes character arrays and matching timing arrays.

**Failure Response** (4xx/5xx):
```json
{
  "error": "Invalid voice settings: speed out of range",
  "requestId": "9d7f4f4f-bc81-4c37-99a8-25de0a8f8f44",
  "retryable": false
}
```

**Error Code Descriptions**:
- `400`: Invalid payload or missing required fields
- `429`: Rate limit exceeded (`retryable: true`)
- `502`: TTS provider timeout, authentication failure, or unavailable (`retryable` varies)
- `500`: Internal server error (e.g. missing API key)

---

### 8. Survey Template API

Manages post-session survey templates and student survey submissions.

#### 8.1 List Survey Templates
- **Endpoint**: `/survey-templates`
- **Method**: `GET`
- **Auth**: `faculty` or `admin`
- **Description**: Lists all active survey templates

**Success Response** (200):
```json
{
  "templates": [
    {
      "surveyTemplateId": "tpl-001",
      "name": "Post-Session Feedback",
      "questions": [
        { "id": "q1", "text": "How helpful was this simulation?", "type": "likert" }
      ],
      "ownerRole": "faculty",
      "isActive": true,
      "createdAt": "2026-03-20T10:00:00.000Z",
      "updatedAt": "2026-03-20T10:00:00.000Z"
    }
  ]
}
```

#### 8.2 Get Survey Template
- **Endpoint**: `/survey-templates/{surveyTemplateId}`
- **Method**: `GET`

**Success Response** (200): Single template object

**Error Responses**:
- `404`: Template not found

#### 8.3 Create Survey Template
- **Endpoint**: `/survey-templates`
- **Method**: `POST`
- **Auth**: `faculty` or `admin`

**Request Body**:
```json
{
  "name": "Post-Session Feedback",
  "questions": [
    { "id": "q1", "text": "How helpful was this simulation?", "type": "likert" },
    { "id": "q2", "text": "Any additional comments?", "type": "text" }
  ]
}
```

**Required Fields**:
- `name`: string
- `questions`: array

**Success Response** (201): The created template object

**Error Responses**:
- `400`: Missing `name` or `questions`
- `401`/`403`: Auth error

#### 8.4 Submit Survey Response
- **Endpoint**: `/sessions/{sessionId}/survey-response`
- **Method**: `POST`
- **Auth**: `student` only
- **Description**: Submits a post-session survey response tied to a specific session

**Request Body**:
```json
{
  "assignmentId": "asgn-xyz789",
  "surveyTemplateId": "tpl-001",
  "answers": {
    "q1": 4,
    "q2": "Very helpful simulation experience"
  }
}
```

**Required Fields**:
- `assignmentId`: string
- `surveyTemplateId`: string
- `answers`: object

**Success Response** (201):
```json
{
  "assignmentId": "asgn-xyz789",
  "responseKey": "sess-abc123#7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "sessionId": "sess-abc123",
  "studentUserId": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "surveyTemplateId": "tpl-001",
  "answers": { "q1": 4, "q2": "Very helpful simulation experience" },
  "submittedAt": "2026-03-25T10:20:00.000Z",
  "completionStatus": "completed"
}
```

**Error Responses**:
- `400`: Missing required fields
- `401`/`403`: Auth error

---

### 9. Analytics API

Read-only aggregation endpoints for dashboards. All endpoints accept only `GET`.

#### 9.1 Student Analytics
- **Endpoint**: `/analytics/student/{studentUserId}`
- **Method**: `GET`
- **Auth**: Students can only view their own analytics. Faculty/admin can view any student.
- **Description**: Returns aggregated performance data for a specific student

**Success Response** (200):
```json
{
  "totalSessions": 12,
  "completedSessions": 10,
  "activeSessions": 1,
  "averageScore": 18.5,
  "recentScores": [17, 19, 20, 18, 19, 21, 17, 18, 19, 17],
  "sessionsByAssignment": {
    "asgn-xyz789": 5,
    "asgn-abc456": 7
  }
}
```

**Error Responses**:
- `403`: Student trying to view another student's analytics

#### 9.2 Cohort Analytics
- **Endpoint**: `/analytics/cohort`
- **Method**: `GET`
- **Auth**: `faculty` or `admin`

**Query Parameters** (optional):
```
?assignmentId=asgn-xyz789
```

**Success Response** (200):
```json
{
  "totalSessions": 150,
  "completedSessions": 120,
  "uniqueStudents": 30,
  "completionRate": "80.0",
  "sessionsByAssignment": {
    "asgn-xyz789": 80,
    "asgn-abc456": 70
  }
}
```

#### 9.3 Platform Analytics
- **Endpoint**: `/analytics/platform`
- **Method**: `GET`
- **Auth**: `admin` only

**Success Response** (200):
```json
{
  "totalAssignments": 15,
  "publishedAssignments": 10,
  "totalSessions": 500,
  "completedSessions": 420,
  "uniqueStudents": 85
}
```

#### 9.4 Survey Analytics
- **Endpoint**: `/analytics/surveys`
- **Method**: `GET`
- **Auth**: `faculty` or `admin`

**Query Parameters** (optional):
```
?assignmentId=asgn-xyz789
```

**Success Response** (200):
```json
{
  "totalResponses": 100,
  "completedResponses": 95,
  "responsesByAssignment": {
    "asgn-xyz789": 50,
    "asgn-abc456": 50
  }
}
```

---

### 10. Download URL API

#### 10.1 Get Desktop App Download URL
- **Endpoint**: `/download-url`
- **Method**: `POST`
- **Description**: Generates a pre-signed S3 URL (1 hour expiry) for downloading the Unity desktop client

**Request Body**:
```json
{
  "os": "windows"
}
```

**Valid values for `os`**: `"windows"` or `"mac"`

**Success Response** (200):
```json
{
  "message": "Download URL generated for windows",
  "downloadUrl": "https://s3.amazonaws.com/..."
}
```

**Error Responses**:
- `400`: Missing or invalid `os`
- `500`: S3 bucket/file not found or configuration error

---

### 11. Legacy Simulation Data API

> **Deprecation Notice**: These endpoints are maintained for backward compatibility. New integrations should use the Session API (Section 5) and LLM APIs (Section 6) instead.

#### 11.1 Save Simulation Data
- **Endpoint**: `/simulation-data`
- **Method**: `POST`
- **Description**: Saves user's simulation session data

**Request Body**:
```json
{
  "userID": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "simulationLevel": 1,
  "chatHistory": {
    "conversation": [
      {
        "speaker": "therapist",
        "message": "Hello, how are you feeling today?",
        "timestamp": "2025-08-19T18:00:00.000Z"
      },
      {
        "speaker": "patient",
        "message": "I'm feeling a bit nervous about the session.",
        "timestamp": "2025-08-19T18:00:05.000Z"
      }
    ]
  }
}
```

**Required Fields**:
- `userID`: UUID string
- `simulationLevel`: 1, 2, or 3
- `chatHistory`: object

**Success Response** (200):
```json
{
  "message": "Simulation data saved successfully",
  "createdAt": "2025-08-19T18:30:00.000Z",
  "updatedAt": "2025-08-19T18:30:00.000Z",
  "additionalFields": [...]
}
```

#### 11.2 Get Simulation Data
- **Endpoint**: `/simulation-data`
- **Method**: `GET`

**Query Parameters**:
```
?userID=7811e3a0-a061-70d2-c7d6-315cd36795c4&simulationLevel=1
```

**Success Response** (200):
```json
{
  "userID": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "simulationLevel": 1,
  "chatHistory": { "conversation": [...] },
  "createdAt": "2025-08-19T18:00:00.000Z",
  "updatedAt": "2025-08-19T18:30:00.000Z"
}
```

#### 11.3 Pre-Survey / Post-Survey / Debrief

These legacy survey endpoints follow the same GET/POST pattern:

| Endpoint | GET Query | POST Required Fields |
|----------|-----------|---------------------|
| `/pre-survey` | `?userID=...` | `userID`, `answers` |
| `/post-survey` | `?userID=...` | `userID`, `answers` |
| `/debrief` | `?userID=...&simulationLevel=1` | `userID`, `simulationLevel`, `answers` |
