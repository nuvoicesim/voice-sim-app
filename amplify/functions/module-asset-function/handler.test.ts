import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEvent } from 'aws-lambda';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://signed.example/upload?sig=x'),
}));

vi.mock('../shared/auth-middleware', () => ({
  extractCallerIdentity: vi.fn(),
  requireRole: vi.fn(),
}));

import { extractCallerIdentity, requireRole } from '../shared/auth-middleware';
import { createResponse, HTTP_STATUS } from '../shared/http';
import { handler } from './handler';

function makeEvent(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: 'POST',
    path: '/module-assets/upload-url',
    resource: '/module-assets/upload-url',
    body: JSON.stringify({ contentType: 'image/png', sizeBytes: 1024 }),
    headers: {},
    multiValueHeaders: {},
    isBase64Encoded: false,
    pathParameters: null,
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: { authorizer: { claims: {} } } as any,
    ...overrides,
  } as APIGatewayProxyEvent;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.S3_BUCKET_NAME = 'voice-sim-bucket';
  process.env.UNITY_BUILD_PUBLIC_BASE_URL = 'https://cdn.example.test';
  (extractCallerIdentity as any).mockResolvedValue({ userId: 'sub-1', role: 'faculty' });
  (requireRole as any).mockReturnValue(null);
});

describe('module-asset-function handler', () => {
  it('returns 400 when contentType is missing', async () => {
    const res = await handler(
      makeEvent({ body: JSON.stringify({ sizeBytes: 1024 }) }),
      {} as any,
      () => {}
    );
    expect((res as any).statusCode).toBe(400);
  });

  it('returns 400 for unsupported contentType', async () => {
    const res = await handler(
      makeEvent({ body: JSON.stringify({ contentType: 'image/bmp', sizeBytes: 1024 }) }),
      {} as any,
      () => {}
    );
    expect((res as any).statusCode).toBe(400);
  });

  it('returns 400 for sizeBytes above 5 MB', async () => {
    const res = await handler(
      makeEvent({
        body: JSON.stringify({ contentType: 'image/png', sizeBytes: 6 * 1024 * 1024 }),
      }),
      {} as any,
      () => {}
    );
    expect((res as any).statusCode).toBe(400);
  });

  it('returns 400 for zero or negative sizeBytes', async () => {
    const res = await handler(
      makeEvent({
        body: JSON.stringify({ contentType: 'image/png', sizeBytes: 0 }),
      }),
      {} as any,
      () => {}
    );
    expect((res as any).statusCode).toBe(400);
  });

  it('returns the auth error when requireRole rejects (student role)', async () => {
    (requireRole as any).mockReturnValue(
      createResponse(HTTP_STATUS.FORBIDDEN, { error: "Role 'student' not authorized" })
    );
    const res = await handler(makeEvent(), {} as any, () => {});
    expect((res as any).statusCode).toBe(403);
  });

  it('returns 405 for non-POST methods', async () => {
    const res = await handler(makeEvent({ httpMethod: 'GET' }), {} as any, () => {});
    expect((res as any).statusCode).toBe(405);
  });

  it('returns 200 + OPTIONS for CORS preflight', async () => {
    const res = await handler(makeEvent({ httpMethod: 'OPTIONS' }), {} as any, () => {});
    expect([200, 204]).toContain((res as any).statusCode);
  });

  it('returns 200 with uploadUrl, publicUrl, key, expiresIn=300', async () => {
    const res = (await handler(makeEvent(), {} as any, () => {})) as any;
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.uploadUrl).toBe('https://signed.example/upload?sig=x');
    expect(body.publicUrl).toMatch(
      /^https:\/\/cdn\.example\.test\/module-assets\/sub-1\/\d{6}\/[0-9a-f-]{36}\.png$/
    );
    expect(body.key).toMatch(
      /^module-assets\/sub-1\/\d{6}\/[0-9a-f-]{36}\.png$/
    );
    expect(body.expiresIn).toBe(300);
  });

  it('uses correct extension for jpeg', async () => {
    const res = (await handler(
      makeEvent({
        body: JSON.stringify({ contentType: 'image/jpeg', sizeBytes: 2048 }),
      }),
      {} as any,
      () => {}
    )) as any;
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).key).toMatch(/\.jpg$/);
  });
});
