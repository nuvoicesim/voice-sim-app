/**
 * Routing tests for POST /modules/{moduleId}/items.
 *
 * The Phase 3 setup shares this route via ?operation=phase3-setup (a dedicated
 * API Gateway route would push api-stack past CloudFormation's 500-resource
 * limit). These tests pin the dispatch contract:
 *   - operation=phase3-setup → executePhase3Setup
 *   - no operation           → plain handleCreateItem (unchanged behavior)
 *   - unknown operation      → 400, never falls into either path
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";

const mocks = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  templates: new Map<string, Record<string, unknown>>(),
  dynamoSend: vi.fn(),
  getItem: vi.fn(),
  putItem: vi.fn(),
}));

vi.mock("../shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../shared")>();
  return {
    ...actual,
    createDynamoDbClient: () => ({ send: mocks.dynamoSend }),
    getItem: mocks.getItem,
    putItem: mocks.putItem,
    resolveModuleCourseId: vi.fn(async () => ({
      courseId: "course-1",
      mod: { moduleId: "mod-1", courseId: "course-1" },
    })),
    requireCourseInstructor: vi.fn(async () => null),
  };
});

vi.mock("../shared/auth-middleware", () => ({
  extractCallerIdentity: vi.fn(async () => ({
    role: "faculty",
    userId: "fac-1",
  })),
  requireRole: vi.fn(() => null),
}));

// Must be set before the handler module loads its env-derived constants.
process.env.MODULE_ITEM_TABLE_NAME = "ModuleItemTable";
process.env.SURVEY_TEMPLATE_TABLE_NAME = "SurveyTemplateTable";

const { handler } = await import("./handler");

function template(id: string, count: number) {
  return {
    surveyTemplateId: id,
    name: `Template ${id}`,
    isActive: true,
    questions: Array.from({ length: count }, (_, i) => ({ id: `q${i + 1}` })),
  };
}

function makeEvent(overrides: Record<string, unknown>): APIGatewayProxyEvent {
  return {
    httpMethod: "POST",
    resource: "/modules/{moduleId}/items",
    pathParameters: { moduleId: "mod-1" },
    queryStringParameters: null,
    body: null,
    ...overrides,
  } as unknown as APIGatewayProxyEvent;
}

async function invoke(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  return (await handler(event, {} as Context, () => {})) as APIGatewayProxyResult;
}

beforeEach(() => {
  mocks.dynamoSend.mockClear();
  mocks.getItem.mockClear();
  mocks.putItem.mockClear();
  mocks.rows.clear();
  mocks.templates.clear();
  mocks.templates.set("tpl-ac", template("tpl-ac", 25));
  mocks.templates.set("tpl-d", template("tpl-d", 9));

  mocks.dynamoSend.mockImplementation(async (cmd: { input?: Record<string, unknown> }) => {
    const input = cmd.input || {};
    const item = input.Item as Record<string, unknown> | undefined;
    if (item) {
      // Conditional put from createItemIfAbsent.
      const id = item.moduleItemId as string;
      if (input.ConditionExpression && mocks.rows.has(id)) {
        const err = new Error("conditional failed");
        err.name = "ConditionalCheckFailedException";
        throw err;
      }
      mocks.rows.set(id, item);
      return {};
    }
    // Scan filtered by moduleId (item listing / position computation).
    const values = input.ExpressionAttributeValues as
      | Record<string, unknown>
      | undefined;
    const moduleId = values?.[":m"];
    return {
      Items: [...mocks.rows.values()].filter((r) => r.moduleId === moduleId),
    };
  });
  mocks.getItem.mockImplementation(async (_table: string, key: Record<string, string>) => {
    if (key.surveyTemplateId) return mocks.templates.get(key.surveyTemplateId) || null;
    if (key.moduleItemId) return mocks.rows.get(key.moduleItemId) || null;
    return null;
  });
  mocks.putItem.mockImplementation(
    async (_table: string, item: Record<string, unknown>) => {
      mocks.rows.set(item.moduleItemId as string, item);
    }
  );
});

describe("POST /modules/{moduleId}/items routing", () => {
  it("?operation=phase3-setup dispatches to the Phase 3 setup", async () => {
    const response = await invoke(
      makeEvent({
        queryStringParameters: { operation: "phase3-setup" },
        body: JSON.stringify({
          partsACTemplateId: "tpl-ac",
          partDTemplateId: "tpl-d",
        }),
      })
    );

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.partsAC.moduleItemId).toBe("p3ac-mod-1");
    expect(body.partD.moduleItemId).toBe("p3d-mod-1");
    expect(body.created).toEqual({ partsAC: true, partD: true });
    // Both deterministic rows persisted; nothing else created.
    expect([...mocks.rows.keys()].sort()).toEqual(["p3ac-mod-1", "p3d-mod-1"]);
  });

  it("without an operation param, plain item creation is unchanged", async () => {
    const response = await invoke(
      makeEvent({
        body: JSON.stringify({
          itemType: "instruction",
          title: "Read me first",
          payload: { markdown: "hello" },
        }),
      })
    );

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.body);
    expect(body.itemType).toBe("instruction");
    expect(body.title).toBe("Read me first");
    expect(body.payload).toEqual({ markdown: "hello" });
    // A regular random-id item — no Phase 3 rows appeared.
    expect(mocks.rows.size).toBe(1);
    expect(mocks.rows.has("p3ac-mod-1")).toBe(false);
    expect(mocks.rows.has("p3d-mod-1")).toBe(false);
  });

  it("an unknown operation is rejected and triggers neither path", async () => {
    const response = await invoke(
      makeEvent({
        queryStringParameters: { operation: "phase3setup" }, // typo
        body: JSON.stringify({
          partsACTemplateId: "tpl-ac",
          partDTemplateId: "tpl-d",
        }),
      })
    );

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body).error).toMatch(/Unknown operation "phase3setup"/);
    // No Phase 3 rows, no plain item — nothing written at all.
    expect(mocks.rows.size).toBe(0);
    expect(mocks.putItem).not.toHaveBeenCalled();
  });

  it("a second phase3-setup call through the route stays idempotent", async () => {
    const event = makeEvent({
      queryStringParameters: { operation: "phase3-setup" },
      body: JSON.stringify({
        partsACTemplateId: "tpl-ac",
        partDTemplateId: "tpl-d",
      }),
    });
    const first = await invoke(event);
    expect(first.statusCode).toBe(200);

    const second = await invoke(event);
    expect(second.statusCode).toBe(200);
    expect(JSON.parse(second.body).created).toEqual({
      partsAC: false,
      partD: false,
    });
    expect(mocks.rows.size).toBe(2);
  });
});
