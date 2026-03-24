/**
 * Shared utilities for Lambda functions
 * This file provides a centralized export of all shared utilities
 */

// Export all HTTP utilities
export * from './http';

// Export all database utilities  
export * from './database';

// Export all general utilities
export * from './utils';

// Export CORS helpers
export * from './cors';

// Export OpenAI helpers
export * from './openai';

// Export context resolver
export * from './context-resolver';

// Export auth middleware
export * from './auth-middleware';

// Re-export commonly used types for convenience
export type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
export type { APIGatewayProxyHandler, APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
