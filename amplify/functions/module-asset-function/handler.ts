import type { APIGatewayProxyHandler } from "aws-lambda";
import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  createResponse,
  optionsResponse,
  badRequestResponse,
  methodNotAllowedResponse,
  serverErrorResponse,
  parseJsonBody,
  HTTP_STATUS,
} from "../shared";
import { extractCallerIdentity, requireRole } from "../shared/auth-middleware";

const ALLOWED_CONTENT_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_SIZE_BYTES = 5 * 1024 * 1024;
const URL_TTL_SECONDS = 300;

const s3 = new S3Client({ region: process.env.AWS_REGION || "us-east-1" });

export const handler: APIGatewayProxyHandler = async (event) => {
  if (event.httpMethod === "OPTIONS") return optionsResponse();
  if (event.httpMethod !== "POST") return methodNotAllowedResponse(["POST"]);

  try {
    const caller = await extractCallerIdentity(event);
    const authError = requireRole(caller, [
      "student",
      "faculty",
      "simulation_designer",
      "admin",
    ]);
    if (authError) return authError;

    const body = parseJsonBody(event.body);
    const contentType = typeof body?.contentType === "string" ? body.contentType.trim() : "";
    const sizeBytes = typeof body?.sizeBytes === "number" ? body.sizeBytes : NaN;
    const purpose =
      typeof body?.purpose === "string" ? body.purpose.trim() : "module-asset";

    if (!contentType || !(contentType in ALLOWED_CONTENT_TYPES)) {
      return badRequestResponse(
        `contentType must be one of: ${Object.keys(ALLOWED_CONTENT_TYPES).join(", ")}`
      );
    }
    if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
      return badRequestResponse("sizeBytes must be a positive number");
    }
    if (sizeBytes > MAX_SIZE_BYTES) {
      return badRequestResponse(`sizeBytes exceeds limit of ${MAX_SIZE_BYTES} bytes`);
    }

    const bucketName = process.env.S3_BUCKET_NAME;
    const publicBaseUrl = process.env.UNITY_BUILD_PUBLIC_BASE_URL;
    if (!bucketName || !publicBaseUrl) {
      console.error("module-asset-function missing env", {
        hasBucket: Boolean(bucketName),
        hasPublicBase: Boolean(publicBaseUrl),
      });
      return serverErrorResponse("storage misconfigured");
    }

    const ext = ALLOWED_CONTENT_TYPES[contentType];
    const now = new Date();
    const yyyymm = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
    const isStudentSubmission =
      caller!.role === "student" || purpose === "submission";
    if (purpose === "submission" && caller!.role !== "student") {
      return badRequestResponse("purpose 'submission' is only valid for students");
    }
    if (caller!.role === "student" && purpose !== "submission") {
      return badRequestResponse(
        "students must request uploads with purpose 'submission'"
      );
    }
    const prefix = isStudentSubmission ? "module-submissions" : "module-assets";
    const key = `${prefix}/${caller!.userId}/${yyyymm}/${randomUUID()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: URL_TTL_SECONDS });
    const publicUrl = `${publicBaseUrl.replace(/\/$/, "")}/${key}`;

    return createResponse(HTTP_STATUS.OK, {
      uploadUrl,
      publicUrl,
      key,
      expiresIn: URL_TTL_SECONDS,
    });
  } catch (error) {
    console.error("module-asset-function error", error);
    return serverErrorResponse(
      error instanceof Error ? error.message : "Internal server error"
    );
  }
};
