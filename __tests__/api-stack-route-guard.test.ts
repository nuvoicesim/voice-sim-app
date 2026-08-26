/**
 * Guard: the main NurseTownAPI stack must not grow.
 *
 * `api-stack` is at CloudFormation's 500-resource limit. Adding a route there
 * previously broke `backend synth` outright (the abandoned
 * GET /sessions/{sessionId}/evidence attempt), so every new capability has to
 * reuse an existing route — Phase 3 setup and the Phase 3 feedback data import
 * both ride on POST /modules/{moduleId}/items via ?operation=...
 *
 * ── How the baseline was established ──────────────────────────────────────────
 * Every number below was read from the MERGE-BASE blob, not from the working
 * tree:
 *
 *     git show <BASELINE_COMMIT>:amplify/backend.ts | grep -c '...'
 *
 * That distinction is the whole point. A baseline captured from the tree you are
 * editing passes by construction and cannot detect the change it exists to
 * detect. `baselineSource()` below re-derives the counts from the base blob at
 * run time, so if these constants ever drift away from the base commit the test
 * says so instead of quietly agreeing with whatever the tree currently holds.
 *
 * Each `.addResource()` becomes an AWS::ApiGateway::Resource; each
 * `.addMethod()` becomes an AWS::ApiGateway::Method plus (for a Lambda
 * integration) an AWS::Lambda::Permission; `defaultCorsPreflightOptions` adds an
 * OPTIONS method per resource. `addToRolePolicy()` / `new PolicyStatement()`
 * extend an EXISTING role's default policy rather than creating a new IAM
 * resource, but a change in their count still means new permissions were
 * granted, which the feature constraints forbid.
 *
 * If a change genuinely needs to move these numbers, that needs research-team
 * approval and the 500-resource budget record must be updated at the same time.
 * This test failing is the intended signal, not an inconvenience.
 *
 * The authoritative check remains a CloudFormation template diff of
 * `*api-stack*.template.json` between the base and the branch build.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(here, "..");
const BACKEND = resolve(REPO, "amplify", "backend.ts");
const DATA_SCHEMA = resolve(REPO, "amplify", "data", "resource.ts");

/**
 * `git merge-base HEAD origin/main` for
 * feature/phase3-feedback-data-import-17-students. Pinning the sha is what makes
 * the numbers below auditable: anyone can re-derive them with
 * `git show dd2ac9d…:amplify/backend.ts`.
 */
const BASELINE_COMMIT = "dd2ac9d33da5a9161f46ece6051dcd8ac1746f60";

/** Measured at BASELINE_COMMIT, not in the working tree. */
const BASELINE = {
  addResource: 82,
  addMethod: 108,
  addGatewayResponse: 0,
  restApi: 1,
  cognitoAuthorizer: 1,
  lambdaIntegration: 22,
  createStack: 4,
  addToRolePolicy: 5,
  policyStatement: 5,
};

const API_STACK_START = 'const apiStack = backend.createStack("api-stack")';
const API_STACK_END = "// ─── ModuleAssetAPI";

function apiStackBlock(src: string): string {
  const start = src.indexOf(API_STACK_START);
  const end = src.indexOf(API_STACK_END);
  expect(start, "api-stack marker moved; update this guard deliberately").toBeGreaterThan(-1);
  expect(end, "ModuleAssetAPI marker moved; update this guard deliberately").toBeGreaterThan(start);
  return src.slice(start, end);
}

function measure(src: string) {
  const block = apiStackBlock(src);
  const c = (re: RegExp, text = block) => (text.match(re) || []).length;
  return {
    addResource: c(/\.addResource\(/g),
    addMethod: c(/\.addMethod\(/g),
    addGatewayResponse: c(/\.addGatewayResponse\(/g),
    restApi: c(/new RestApi\(/g),
    cognitoAuthorizer: c(/new CognitoUserPoolsAuthorizer\(/g),
    lambdaIntegration: c(/new LambdaIntegration\(/g),
    createStack: c(/backend\.createStack\(/g, src),
    addToRolePolicy: c(/addToRolePolicy\(/g, src),
    policyStatement: c(/new PolicyStatement\(/g, src),
  };
}

/** The file as it exists at BASELINE_COMMIT, or null when git cannot reach it. */
function baselineSource(path: string): string | null {
  try {
    return execFileSync("git", ["show", `${BASELINE_COMMIT}:${path}`], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    // Shallow clone, detached export, or no git: fall back to the pinned
    // constants rather than failing spuriously.
    return null;
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("baseline provenance", () => {
  it("the pinned constants describe the merge-base, not the working tree", () => {
    const base = baselineSource("amplify/backend.ts");
    if (!base) {
      console.warn(
        `[api-stack guard] ${BASELINE_COMMIT} unreachable; provenance check skipped.`
      );
      return;
    }
    // If this fails, the constants were calibrated against an edited tree and
    // every assertion below is worthless.
    expect(measure(base)).toEqual(BASELINE);
  });
});

describe("main api-stack resource budget", () => {
  const current = measure(readFileSync(BACKEND, "utf8"));

  it("declares no additional API Gateway resources", () => {
    expect(current.addResource).toBe(BASELINE.addResource);
  });

  it("declares no additional API Gateway methods", () => {
    expect(current.addMethod).toBe(BASELINE.addMethod);
  });

  it("declares no additional gateway responses", () => {
    expect(current.addGatewayResponse).toBe(BASELINE.addGatewayResponse);
  });

  it("declares no additional Lambda integrations", () => {
    expect(current.lambdaIntegration).toBe(BASELINE.lambdaIntegration);
  });

  it("declares exactly one RestApi and one Cognito authorizer", () => {
    expect(current.restApi).toBe(BASELINE.restApi);
    expect(current.cognitoAuthorizer).toBe(BASELINE.cognitoAuthorizer);
  });

  it("does not create a new CloudFormation stack", () => {
    // unity-storage-stack, api-stack, module-asset-api-stack, export-api-stack
    expect(current.createStack).toBe(BASELINE.createStack);
  });

  it("grants no additional IAM permissions", () => {
    // The import reuses module-item-function's existing grants: ReviewerFeedback,
    // SurveyInstance, StudentItemProgress, EventLog and ModuleItem are already
    // grantReadWriteData, which covers PutItem/DeleteItem/UpdateItem/
    // ConditionCheckItem/BatchGetItem. Nothing new is needed.
    expect(current.addToRolePolicy).toBe(BASELINE.addToRolePolicy);
    expect(current.policyStatement).toBe(BASELINE.policyStatement);
  });

  it("creates no IAM roles or policies of its own", () => {
    const src = readFileSync(BACKEND, "utf8");
    for (const ctor of ["new Role(", "new Policy(", "new ManagedPolicy("]) {
      expect(src, `${ctor} must not appear`).not.toContain(ctor);
    }
  });
});

describe("infrastructure files are untouched on this branch", () => {
  // The binding constraint for this feature is stronger than "the counts did not
  // move": amplify/backend.ts and amplify/data/resource.ts must not be edited at
  // all. Compare content digests against the base blob so an edit that happens to
  // preserve every count still fails.
  it.each([
    ["amplify/backend.ts", BACKEND],
    ["amplify/data/resource.ts", DATA_SCHEMA],
  ])("%s is byte-identical to the merge-base", (repoPath, absPath) => {
    const base = baselineSource(repoPath);
    if (!base) {
      console.warn(
        `[api-stack guard] ${BASELINE_COMMIT} unreachable; ${repoPath} digest check skipped.`
      );
      return;
    }
    expect(sha256(readFileSync(absPath, "utf8"))).toBe(sha256(base));
  });
});

describe("the Phase 3 import stays on the shared items route", () => {
  it("every Phase 3 client call targets /modules/{moduleId}/items", () => {
    const api = readFileSync(resolve(REPO, "src", "api", "moduleItemApi.ts"), "utf8");
    for (const op of [
      "phase3-setup",
      "phase3-status",
      "phase3-import-preview",
      "phase3-import-commit",
      "phase3-purge-tester",
    ]) {
      expect(api).toContain(`/modules/\${moduleId}/items?operation=${op}`);
    }
    expect(api).not.toMatch(/apiPost\(\s*`\/phase3/);
    expect(api).not.toMatch(/apiGet\(\s*`\/phase3/);
  });

  it("does not modify the Amplify Data schema for the import's audit columns", () => {
    const schema = readFileSync(DATA_SCHEMA, "utf8");
    // Audit and flow-state attributes are plain DynamoDB non-key attributes,
    // exactly like ModuleItem's `_balanced*` counters. Declaring them here would
    // redeploy the data stack for no benefit — nothing reads ReviewerFeedback or
    // these attributes over AppSync.
    for (const attr of [
      "_importKind",
      "_importBatchId",
      "_assignmentVersion",
      "_randomSeed",
      "_phase3TesterGeneration",
      "_phase3FormalImportedAt",
      "_phase3FormalBatchId",
    ]) {
      expect(schema).not.toContain(attr);
    }
  });
});
