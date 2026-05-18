/// <reference path="./unzipper.d.ts" />
import type { APIGatewayProxyHandler } from "aws-lambda";
import { basename, posix as pathPosix } from "node:path";
import {
  S3Client,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import unzipper from "unzipper";

import {
  createResponse,
  optionsResponse,
  badRequestResponse,
  notFoundResponse,
  methodNotAllowedResponse,
  serverErrorResponse,
  parseJsonBody,
  getQueryParams,
  HTTP_STATUS,
  createDynamoDbClient,
  getItem,
  putItem,
  generateId,
  generateTimestamp,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";

const TABLE_NAME = process.env.TABLE_NAME;
const S3_BUCKET_NAME = process.env.S3_BUCKET_NAME;
const UNITY_BUILD_PUBLIC_BASE_URL = (process.env.UNITY_BUILD_PUBLIC_BASE_URL ?? "").replace(/\/$/, "");
const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
  // SDK v3 >= 3.729 injects a CRC32 checksum into PutObject by default. For
  // browser presigned PUTs the checksum gets baked into the signed URL with a
  // placeholder value, causing S3 to reject the upload with BadDigest.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});
const dynamo = createDynamoDbClient();

type UnityBuildStatus = "uploaded" | "published" | "archived" | "failed";

interface UnityBuildRecord {
  unityBuildId: string;
  displayName: string;
  buildKey: string;
  sourceZipKey: string;
  sourceFileName: string;
  entryHtml: string;
  publishedPrefix?: string;
  publicBaseUrl?: string;
  launchUrl?: string;
  status: UnityBuildStatus;
  publishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

function sanitizeBuildKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  const sanitized = trimmed
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || undefined;
}

function sanitizeFileName(fileName: unknown): string | undefined {
  if (typeof fileName !== "string") return undefined;
  const trimmed = basename(fileName.trim());
  return trimmed || undefined;
}

function sanitizeEntryHtml(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    return "index.html";
  }
  return value.trim().replace(/^\/+/, "");
}

function sanitizeZipEntryPath(entryPath: string): string | null {
  const normalized = pathPosix.normalize(entryPath).replace(/^\/+/, "");
  if (!normalized || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    return null;
  }
  return normalized;
}

function inferContentType(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js") || lower.endsWith(".loader.js") || lower.endsWith(".framework.js") || lower.endsWith(".js.unityweb")) {
    return "application/javascript; charset=utf-8";
  }
  if (lower.endsWith(".json") || lower.endsWith(".symbols.json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".wasm") || lower.endsWith(".wasm.unityweb")) return "application/wasm";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

async function readStreamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      continue;
    }

    if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk));
      continue;
    }

    chunks.push(Buffer.from(chunk as Uint8Array));
  }

  return Buffer.concat(chunks);
}

async function deleteObjectIfPresent(key: string | undefined) {
  if (!S3_BUCKET_NAME || !key) return;

  await s3.send(new DeleteObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: key,
  }));
}

async function deletePrefixObjects(prefix: string | undefined) {
  if (!S3_BUCKET_NAME || !prefix) return;

  while (true) {
    const listed = await s3.send(new ListObjectsV2Command({
      Bucket: S3_BUCKET_NAME,
      Prefix: `${prefix.replace(/\/$/, "")}/`,
      MaxKeys: 1000,
    }));

    const objects = (listed.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => typeof key === "string" && key.length > 0);

    if (objects.length === 0) {
      return;
    }

    await s3.send(new DeleteObjectsCommand({
      Bucket: S3_BUCKET_NAME,
      Delete: {
        Objects: objects.map((Key) => ({ Key })),
        Quiet: true,
      },
    }));
  }
}

function toUnityBuildRecord(item: Record<string, unknown> | undefined): UnityBuildRecord | null {
  if (!item) return null;
  const {
    unityBuildId,
    displayName,
    buildKey,
    sourceZipKey,
    sourceFileName,
    entryHtml,
    publishedPrefix,
    publicBaseUrl,
    launchUrl,
    status,
    publishedAt,
    createdAt,
    updatedAt,
  } = item;

  if (
    typeof unityBuildId !== "string" ||
    typeof displayName !== "string" ||
    typeof buildKey !== "string" ||
    typeof sourceZipKey !== "string" ||
    typeof sourceFileName !== "string" ||
    typeof entryHtml !== "string" ||
    (status !== "uploaded" && status !== "published" && status !== "archived" && status !== "failed") ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string"
  ) {
    return null;
  }

  return {
    unityBuildId,
    displayName,
    buildKey,
    sourceZipKey,
    sourceFileName,
    entryHtml,
    publishedPrefix: typeof publishedPrefix === "string" ? publishedPrefix : undefined,
    publicBaseUrl: typeof publicBaseUrl === "string" ? publicBaseUrl : undefined,
    launchUrl: typeof launchUrl === "string" ? launchUrl : undefined,
    status,
    publishedAt: typeof publishedAt === "string" ? publishedAt : null,
    createdAt,
    updatedAt,
  };
}

async function listUnityBuilds(role?: string) {
  const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");
  const isFaculty = role === "faculty";
  const result = await dynamo.send(new ScanCommand({
    TableName: TABLE_NAME,
    FilterExpression: isFaculty ? "#status = :published" : "#status <> :archived",
    ExpressionAttributeNames: { "#status": "status" },
    ExpressionAttributeValues: isFaculty
      ? { ":published": "published" }
      : { ":archived": "archived" },
  }));

  const unityBuilds = (result.Items || [])
    .map((item) => toUnityBuildRecord(item as Record<string, unknown>))
    .filter((item): item is UnityBuildRecord => item !== null);

  return createResponse(HTTP_STATUS.OK, { unityBuilds });
}

function buildUploadResponse(record: UnityBuildRecord, uploadUrl: string) {
  return createResponse(HTTP_STATUS.OK, {
    unityBuild: record,
    uploadUrl,
    uploadBucketName: S3_BUCKET_NAME ?? null,
    uploadMethod: "PUT",
    uploadHeaders: {
      "Content-Type": "application/zip",
    },
  });
}

async function issueUploadUrl(
  record: UnityBuildRecord,
  contentType: string
) {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET_NAME,
    Key: record.sourceZipKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 900 });
  return buildUploadResponse(record, uploadUrl);
}

async function handleCreateUploadUrl(body: string | null) {
  const payload = parseJsonBody(body);
  const displayName = typeof payload.displayName === "string" ? payload.displayName.trim() : "";
  const buildKey = sanitizeBuildKey(payload.buildKey);
  const sourceFileName = sanitizeFileName(payload.fileName);
  const entryHtml = sanitizeEntryHtml(payload.entryHtml);
  const contentType = typeof payload.contentType === "string" && payload.contentType.trim() !== ""
    ? payload.contentType.trim()
    : "application/zip";

  if (!displayName || !buildKey || !sourceFileName) {
    return badRequestResponse("Missing required fields: displayName, buildKey, fileName");
  }

  if (!sourceFileName.toLowerCase().endsWith(".zip")) {
    return badRequestResponse("Unity WebGL builds must be uploaded as a .zip file");
  }

  const unityBuildId = generateId();
  const now = generateTimestamp();
  const sourceZipKey = `unity-builds/uploads/${buildKey}-${unityBuildId}/${sourceFileName}`;

  const record: UnityBuildRecord = {
    unityBuildId,
    displayName,
    buildKey,
    sourceZipKey,
    sourceFileName,
    entryHtml,
    status: "uploaded",
    createdAt: now,
    updatedAt: now,
  };

  await putItem(TABLE_NAME, record, dynamo);
  return issueUploadUrl(record, contentType);
}

async function handleReplaceUploadUrl(unityBuildId: string, body: string | null) {
  const existing = toUnityBuildRecord(await getItem(TABLE_NAME, { unityBuildId }, dynamo));
  if (!existing) return notFoundResponse("Unity build not found");

  const payload = parseJsonBody(body);
  const sourceFileName = sanitizeFileName(payload.fileName);
  const contentType = typeof payload.contentType === "string" && payload.contentType.trim() !== ""
    ? payload.contentType.trim()
    : "application/zip";
  const entryHtml = sanitizeEntryHtml(payload.entryHtml ?? existing.entryHtml);
  const displayName = typeof payload.displayName === "string" && payload.displayName.trim() !== ""
    ? payload.displayName.trim()
    : existing.displayName;

  if (!sourceFileName || !sourceFileName.toLowerCase().endsWith(".zip")) {
    return badRequestResponse("Unity WebGL builds must be uploaded as a .zip file");
  }

  const updated: UnityBuildRecord = {
    ...existing,
    displayName,
    sourceFileName,
    entryHtml,
    sourceZipKey: `unity-builds/uploads/${existing.buildKey}-${unityBuildId}/${sourceFileName}`,
    status: "uploaded",
    publishedPrefix: undefined,
    publicBaseUrl: undefined,
    launchUrl: undefined,
    publishedAt: null,
    updatedAt: generateTimestamp(),
  };

  await putItem(TABLE_NAME, updated, dynamo);
  return issueUploadUrl(updated, contentType);
}

async function handlePublishBuild(unityBuildId: string) {
  const existing = toUnityBuildRecord(await getItem(TABLE_NAME, { unityBuildId }, dynamo));
  if (!existing) return notFoundResponse("Unity build not found");

  if (!S3_BUCKET_NAME) {
    return serverErrorResponse("S3 bucket is not configured");
  }

  if (!UNITY_BUILD_PUBLIC_BASE_URL) {
    return serverErrorResponse("UNITY_BUILD_PUBLIC_BASE_URL is not configured");
  }

  try {
    const object = await s3.send(new GetObjectCommand({
      Bucket: S3_BUCKET_NAME,
      Key: existing.sourceZipKey,
    }));

    if (!object.Body || typeof (object.Body as { pipe?: unknown }).pipe !== "function") {
      return serverErrorResponse("Uploaded build zip is unavailable");
    }

    const publishedPrefix = `unity-builds/published/${existing.buildKey}-${unityBuildId}`;
    const expectedEntry = sanitizeZipEntryPath(existing.entryHtml) ?? "index.html";
    let detectedEntryPath: string | null = null;
    let wrappedEntryCandidate: string | null = null;
    let wrappedEntryAmbiguous = false;
    const htmlEntries: string[] = [];

    const parser = (object.Body as NodeJS.ReadableStream).pipe(unzipper.Parse({ forceStream: true }));
    for await (const entry of parser) {
      const normalizedPath = sanitizeZipEntryPath(entry.path);
      if (!normalizedPath || entry.type === "Directory") {
        entry.autodrain();
        continue;
      }

      if (normalizedPath.toLowerCase().endsWith(".html") && htmlEntries.length < 5) {
        htmlEntries.push(normalizedPath);
      }

      if (normalizedPath === expectedEntry) {
        detectedEntryPath = expectedEntry;
      } else if (!detectedEntryPath && normalizedPath.endsWith(`/${expectedEntry}`)) {
        if (!wrappedEntryCandidate) {
          wrappedEntryCandidate = normalizedPath;
        } else if (wrappedEntryCandidate !== normalizedPath) {
          wrappedEntryAmbiguous = true;
        }
      }

      const body = await readStreamToBuffer(entry);
      await s3.send(new PutObjectCommand({
        Bucket: S3_BUCKET_NAME,
        Key: `${publishedPrefix}/${normalizedPath}`,
        Body: body,
        ContentLength: body.length,
        ContentType: inferContentType(normalizedPath),
        CacheControl: normalizedPath.toLowerCase().endsWith(".html")
          ? "no-cache"
          : "public, max-age=31536000, immutable",
      }));
    }

    if (!detectedEntryPath && wrappedEntryCandidate && !wrappedEntryAmbiguous) {
      detectedEntryPath = wrappedEntryCandidate;
      console.info("Unity build publish detected wrapped entry HTML", {
        unityBuildId,
        expectedEntry,
        detectedEntryPath,
      });
    }

    if (!detectedEntryPath) {
      await deletePrefixObjects(publishedPrefix);

      const failedRecord: UnityBuildRecord = {
        ...existing,
        status: "failed",
        updatedAt: generateTimestamp(),
      };
      await putItem(TABLE_NAME, failedRecord, dynamo);
      const discoveredHtml = htmlEntries.length > 0 ? ` Found HTML files: ${htmlEntries.join(", ")}` : "";
      return badRequestResponse(
        wrappedEntryAmbiguous
          ? `Uploaded zip contains multiple possible entry files ending in ${expectedEntry}. Set Entry HTML to the correct path.${discoveredHtml}`
          : `Uploaded zip does not contain ${expectedEntry} at the root.${discoveredHtml}`
      );
    }

    const publicBaseUrl = `${UNITY_BUILD_PUBLIC_BASE_URL}/${publishedPrefix}`;
    const launchUrl = `${publicBaseUrl}/${detectedEntryPath}`;
    const now = generateTimestamp();
    const publishedRecord: UnityBuildRecord = {
      ...existing,
      publishedPrefix,
      publicBaseUrl,
      launchUrl,
      status: "published",
      publishedAt: now,
      updatedAt: now,
    };

    await putItem(TABLE_NAME, publishedRecord, dynamo);
    console.info("Unity build published", {
      unityBuildId,
      publishedPrefix,
      launchUrl,
    });
    return createResponse(HTTP_STATUS.OK, { unityBuild: publishedRecord });
  } catch (error) {
    console.error("Unity build publish failed:", error);
    const failedRecord: UnityBuildRecord = {
      ...existing,
      status: "failed",
      updatedAt: generateTimestamp(),
    };
    await putItem(TABLE_NAME, failedRecord, dynamo);
    return serverErrorResponse("Failed to publish Unity build");
  }
}

async function handleUpdateBuild(unityBuildId: string, body: string | null) {
  const existing = toUnityBuildRecord(await getItem(TABLE_NAME, { unityBuildId }, dynamo));
  if (!existing) return notFoundResponse("Unity build not found");

  const payload = parseJsonBody(body);
  const displayName = typeof payload.displayName === "string" && payload.displayName.trim() !== ""
    ? payload.displayName.trim()
    : existing.displayName;
  const entryHtml = sanitizeEntryHtml(payload.entryHtml ?? existing.entryHtml);

  const updated: UnityBuildRecord = {
    ...existing,
    displayName,
    entryHtml,
    updatedAt: generateTimestamp(),
  };

  await putItem(TABLE_NAME, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, updated);
}

async function handleArchiveBuild(unityBuildId: string) {
  const existing = toUnityBuildRecord(await getItem(TABLE_NAME, { unityBuildId }, dynamo));
  if (!existing) return notFoundResponse("Unity build not found");

  if (!S3_BUCKET_NAME) {
    return serverErrorResponse("S3 bucket is not configured");
  }

  try {
    await deleteObjectIfPresent(existing.sourceZipKey);
    await deletePrefixObjects(existing.publishedPrefix);
  } catch (error) {
    console.error("Unity build cleanup failed:", error);
    return serverErrorResponse("Failed to delete Unity build files from storage");
  }

  const updated: UnityBuildRecord = {
    ...existing,
    status: "archived",
    updatedAt: generateTimestamp(),
  };

  await putItem(TABLE_NAME, updated, dynamo);
  return createResponse(HTTP_STATUS.OK, { message: "Unity build archived", unityBuildId });
}

export const handler: APIGatewayProxyHandler = async (event) => {
  if (event.httpMethod === "OPTIONS") return optionsResponse();

  try {
    const method = event.httpMethod;
    const pathParams = event.pathParameters;
    const caller = await extractCallerIdentity(event);

    if (method === "GET") {
      const authError = requireRole(caller, ["faculty", "simulation_designer", "admin"]);
      if (authError) return authError;
      if (pathParams?.unityBuildId) {
        const item = toUnityBuildRecord(await getItem(TABLE_NAME, { unityBuildId: pathParams.unityBuildId }, dynamo));
        if (!item) return notFoundResponse("Unity build not found");
        if (caller?.role === "faculty" && item.status !== "published") {
          return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Access denied" });
        }
        return createResponse(HTTP_STATUS.OK, item);
      }

      const params = getQueryParams(event.queryStringParameters);
      if (params.unityBuildId) {
        const item = toUnityBuildRecord(await getItem(TABLE_NAME, { unityBuildId: params.unityBuildId }, dynamo));
        if (!item) return notFoundResponse("Unity build not found");
        if (caller?.role === "faculty" && item.status !== "published") {
          return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Access denied" });
        }
        return createResponse(HTTP_STATUS.OK, item);
      }

      return await listUnityBuilds(caller?.role);
    }

    if (method === "POST" && event.resource?.includes("/upload-url")) {
      const authError = requireRole(caller, ["simulation_designer", "admin"]);
      if (authError) return authError;
      if (pathParams?.unityBuildId) {
        return await handleReplaceUploadUrl(pathParams.unityBuildId, event.body);
      }
      return await handleCreateUploadUrl(event.body);
    }

    if (method === "POST" && pathParams?.unityBuildId && event.resource?.includes("/publish")) {
      const authError = requireRole(caller, ["simulation_designer", "admin"]);
      if (authError) return authError;
      return await handlePublishBuild(pathParams.unityBuildId);
    }

    if (method === "POST" && pathParams?.unityBuildId && event.resource?.includes("/archive")) {
      const authError = requireRole(caller, ["simulation_designer", "admin"]);
      if (authError) return authError;
      return await handleArchiveBuild(pathParams.unityBuildId);
    }

    if (method === "PUT" && pathParams?.unityBuildId) {
      const authError = requireRole(caller, ["simulation_designer", "admin"]);
      if (authError) return authError;
      return await handleUpdateBuild(pathParams.unityBuildId, event.body);
    }

    return methodNotAllowedResponse(["GET", "POST", "PUT", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};
