# VOICE API Handbook

## Overview
This document provides API interface specifications for the Unity development team working with the Nurse Town application, including authentication and simulation data management functionality.

## Environment Configuration

### Sandbox (Development Environment)
- **Base URL**: `https://f0kk74qeyf.execute-api.us-west-2.amazonaws.com/dev`
- **Purpose**: Development and testing, data will not affect production environment

### Production (Production Environment)
- **Base URL**: `https://bhyalmu7i1.execute-api.us-east-1.amazonaws.com/prod`
- **Purpose**: Production user access, data will be permanently stored

## API Endpoints

### 1. User Authentication API

#### 1.1 User Login
- **Endpoint**: `/auth/login`
- **Method**: `POST`
- **Description**: Validates user credentials and current simulation level

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

### 2. Simulation Data Management API

#### 2.1 Save Simulation Data
- **Endpoint**: `/simulation-data`
- **Method**: `POST`
- **Description**: Saves user's simulation session data

**Request Headers**:
```
Content-Type: application/json
```

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

**Field Descriptions**:
- `userID`:  UUID（Universally Unique Identifier） - e.g. 7811e3a0-a061-70d2-c7d6-315cd36795c4
- `simulationLevel`: Simulation level 1, 2, or 3 (required)
- `simulationData`: Simulation data object (required)
-  all the other additional attributes in any type


**Success Response** (200):
```json
{
  "message": "Simulation data saved successfully",
  "createdAt": "2025-08-19T18:30:00.000Z",
  "updatedAt": "2025-08-19T18:30:00.000Z",
  "additionalFields": [.......]
}
```

**Failure Response** (400):
```json
{
  "error": "Missing required fields: userID, simulationLevel, and simulationData"
}
```

**Failure Response** (400):
```json
{
  "error": "simulationLevel must be 1, 2, or 3"
}
```

#### 2.2 Get Simulation Data
- **Endpoint**: `/simulation-data`
- **Method**: `GET`
- **Description**: Retrieves simulation data for a specific user

**Query Parameters**:
```
?userID=7811e3a0-a061-70d2-c7d6-315cd36795c4&simulationLevel=1
```

**Success Response** (200):
```json
{
  "userID": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "simulationLevel": 1,
  "chatHistory": {
    "conversation": [...]
  },

  "createdAt": "2025-08-19T18:00:00.000Z",
  "updatedAt": "2025-08-19T18:30:00.000Z"
}
```

**Failure Response** (400):
```json
{
  "error": "Missing query parameter: userID"
}
```

**Failure Response** (400):
```json
{
  "error": "Please specify simulationLevel parameter"
}
```

**Failure Response** (404):
```json
{
  "error": "Simulation data not found for this user and simulation level"
}
```

### 3. LLM APIs

Two endpoints for LLM-powered patient simulation: dialogue generation and session scoring.
System prompts are managed server-side; clients only send conversation turns.
Model: `gpt-4o` for both endpoints.

#### 3.1 LLM Dialogue
- **Endpoint**: `/llm-dialogue`
- **Method**: `POST`
- **Health Check**: `GET /llm-dialogue/health`
- **Description**: Generates a simulated patient response. The backend resolves the system prompt from `simulationLevel` (1→task1, 2→task2, 3→task3).

**Request Headers**:
```
Content-Type: application/json
X-Request-ID: <optional, for tracing>
```

**Request Body**:
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
- `simulationLevel`: integer (1, 2, or 3)
- `messages`: non-empty array
- `messages[].role`: `"user"` or `"assistant"` (do NOT send `"system"`)
- `messages[].content`: non-empty string

**Optional Fields**:
- `options.temperature`: number (default: `0.7`)
- `options.maxOutputTokens`: number (default: `220`)
- `metadata.sessionId`: string
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
  "model": "gpt-4o",
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

#### 3.2 LLM Scoring
- **Endpoint**: `/llm-scoring`
- **Method**: `POST`
- **Health Check**: `GET /llm-scoring/health`
- **Description**: Scores a completed simulation session against a rubric and returns a structured evaluation report. Call once at session end.

**Request Headers**:
```
Content-Type: application/json
X-Request-ID: <optional, for tracing>
```

**Request Body**:
```json
{
  "userID": "7811e3a0-a061-70d2-c7d6-315cd36795c4",
  "simulationLevel": 1,
  "conversationTurns": [
    { "patient": "I... uh... fine...", "nurse": "Hi Karen, how are you today?" },
    { "patient": "Talk... hard...", "nurse": "Take your time. I'm here to help." },
    { "patient": "Head... hurt...", "nurse": "I understand. Can you point to where it hurts?" },
    { "patient": "C-c-cat...", "nurse": "Very good! Now can you say 'dog'?" },
    { "patient": "D... dog.", "nurse": "Excellent! You're doing great." }
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
- `simulationLevel`: integer (1, 2, or 3)
- `conversationTurns`: non-empty array of turn objects
- `conversationTurns[].patient`: non-empty string
- `conversationTurns[].nurse`: non-empty string

**Optional Fields**:
- `metadata.sessionId`: string
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
  "model": "gpt-4o",
  "latencyMs": 10773,
  "createdAt": "2026-02-17T01:27:39.070Z"
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

**Failure Responses**: Same error envelope and status codes as dialogue endpoint.

#### 3.3 Error Response Contract

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

#### 3.4 Latency Expectations

- **Dialogue**: 1–3s typical, ~5s p95
- **Scoring**: 8–15s typical, ~20s p95 (full rubric generation)
