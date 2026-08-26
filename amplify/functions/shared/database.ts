/**
 * Database utilities for Lambda functions
 * Contains common DynamoDB operations and helpers
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand, DeleteCommand, TransactWriteCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { randomUUID } from "crypto";

/**
 * Create a DynamoDB document client instance
 * @returns Configured DynamoDB document client
 */
export function createDynamoDbClient(): DynamoDBDocumentClient {
  const client = new DynamoDBClient({});
  return DynamoDBDocumentClient.from(client);
}

/**
 * Get an item from DynamoDB table
 * @param tableName - Name of the DynamoDB table
 * @param key - Primary key object
 * @param dynamo - DynamoDB client instance
 * @param options - Optional read options
 *   - consistentRead: when true, issues a strongly-consistent read by setting
 *     the GetCommand `ConsistentRead` flag. Default is omitted (DynamoDB's
 *     default eventually-consistent read), which preserves prior behavior for
 *     every existing caller.
 * @returns Item from database or null if not found
 */
export async function getItem(
  tableName: string | undefined,
  key: Record<string, any>,
  dynamo: DynamoDBDocumentClient,
  options?: { consistentRead?: boolean }
): Promise<any | null> {
  if (!tableName) {
    throw new Error("Table name is required");
  }

  try {
    const result = await dynamo.send(new GetCommand({
      TableName: tableName,
      Key: key,
      ...(options?.consistentRead ? { ConsistentRead: true } : {}),
    }));

    return result.Item || null;
  } catch (error) {
    console.error("Error getting item from DynamoDB:", error);
    throw new Error("Failed to retrieve item from database");
  }
}

/**
 * Put an item into DynamoDB table
 * @param tableName - Name of the DynamoDB table
 * @param item - Item to store
 * @param dynamo - DynamoDB client instance
 */
export async function putItem(
  tableName: string | undefined,
  item: Record<string, any>,
  dynamo: DynamoDBDocumentClient
): Promise<void> {
  if (!tableName) {
    throw new Error("Table name is required");
  }
  
  try {
    await dynamo.send(new PutCommand({
      TableName: tableName,
      Item: item
    }));
  } catch (error) {
    console.error("Error putting item to DynamoDB:", error);
    throw new Error("Failed to save item to database");
  }
}

/**
 * Update an item in DynamoDB table
 * @param tableName - Name of the DynamoDB table
 * @param key - Primary key object
 * @param updates - Object with fields to update
 * @param dynamo - DynamoDB client instance
 */
export async function updateItem(
  tableName: string,
  key: Record<string, any>,
  updates: Record<string, any>,
  dynamo: DynamoDBDocumentClient
): Promise<void> {
  const updateExpression = Object.keys(updates)
    .map((_, index) => `#attr${index} = :val${index}`)
    .join(", ");
  
  const expressionAttributeNames = Object.keys(updates).reduce((acc, key, index) => {
    acc[`#attr${index}`] = key;
    return acc;
  }, {} as Record<string, string>);
  
  const expressionAttributeValues = Object.values(updates).reduce((acc, value, index) => {
    acc[`:val${index}`] = value;
    return acc;
  }, {} as Record<string, any>);

  try {
    await dynamo.send(new UpdateCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: `SET ${updateExpression}`,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues
    }));
  } catch (error) {
    console.error("Error updating item in DynamoDB:", error);
    throw new Error("Failed to update item in database");
  }
}

/**
 * Delete an item from DynamoDB table
 * @param tableName - Name of the DynamoDB table
 * @param key - Primary key object
 * @param dynamo - DynamoDB client instance
 */
export async function deleteItem(
  tableName: string,
  key: Record<string, any>,
  dynamo: DynamoDBDocumentClient
): Promise<void> {
  try {
    await dynamo.send(new DeleteCommand({
      TableName: tableName,
      Key: key
    }));
  } catch (error) {
    console.error("Error deleting item from DynamoDB:", error);
    throw new Error("Failed to delete item from database");
  }
}

/**
 * Error thrown when a TransactWriteItems call is cancelled by DynamoDB.
 *
 * `cancellationReasons` is the ONLY signal that says which item's condition
 * failed, so it is preserved rather than collapsed into a generic message —
 * callers that rely on conditional writes need it to tell the operator exactly
 * what conflicted.
 */
export class TransactionWriteError extends Error {
  readonly cancellationReasons?: unknown;
  readonly originalError?: unknown;

  constructor(
    message: string,
    options?: { cancellationReasons?: unknown; originalError?: unknown }
  ) {
    super(message);
    this.name = "TransactionWriteError";
    this.cancellationReasons = options?.cancellationReasons;
    this.originalError = options?.originalError;
  }
}

/**
 * Execute an all-or-nothing transaction write.
 *
 * Each transact item carries its own TableName (a transaction may span tables),
 * so no table name argument is needed.
 *
 * @param transactItems - Array of transaction items to write
 * @param dynamo - DynamoDB client instance
 * @param options.clientRequestToken - Idempotency token (<=36 chars). Guards the
 *   "request succeeded but the response was lost" retry within a 10-minute window.
 */
export async function transactWriteItems(
  transactItems: any[],
  dynamo: DynamoDBDocumentClient,
  options?: { clientRequestToken?: string }
): Promise<void> {
  if (!Array.isArray(transactItems) || transactItems.length === 0) {
    throw new Error("transactItems must be a non-empty array");
  }

  try {
    await dynamo.send(new TransactWriteCommand({
      TransactItems: transactItems,
      ...(options?.clientRequestToken
        ? { ClientRequestToken: options.clientRequestToken }
        : {}),
    }));
  } catch (error) {
    const reasons = (error as { CancellationReasons?: unknown })?.CancellationReasons;
    console.error("Error executing transaction write:", {
      name: (error as Error)?.name,
      message: (error as Error)?.message,
      cancellationReasons: reasons,
    });
    throw new TransactionWriteError(
      (error as Error)?.name === "TransactionCanceledException"
        ? "The transaction was cancelled; nothing was written."
        : "Failed to execute transaction write",
      { cancellationReasons: reasons, originalError: error }
    );
  }
}

/**
 * Generate a new UUID for use as a primary key
 * @returns Random UUID string
 */
export function generateId(): string {
  return randomUUID();
}

/**
 * Generate an ISO timestamp string
 * @returns Current timestamp in ISO format
 */
export function generateTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Prepare item for storage in DynamoDB with common fields
 * @param data - The main data object
 * @param userId - User ID for the record
 * @param includeId - Whether to include a generated ID
 * @returns Object ready for DynamoDB storage
 */
export function prepareItemForStorage(
  data: Record<string, any>,
  userId: string,
  includeId: boolean = true
): Record<string, any> {
  const item: Record<string, any> = {
    userID: userId,
    timestamp: generateTimestamp(),
    ...data
  };
  
  if (includeId) {
    item.id = generateId();
  }
  
  return item;
}

/**
 * Query items from a DynamoDB table using a key condition expression.
 * Useful for tables with composite keys or GSI queries.
 */
export async function queryItems(
  tableName: string,
  keyConditionExpression: string,
  expressionAttributeValues: Record<string, any>,
  dynamo: DynamoDBDocumentClient,
  options?: {
    indexName?: string;
    expressionAttributeNames?: Record<string, string>;
    scanIndexForward?: boolean;
    limit?: number;
  }
): Promise<any[]> {
  if (!tableName) {
    throw new Error("Table name is required");
  }

  try {
    const result = await dynamo.send(new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ...(options?.indexName && { IndexName: options.indexName }),
      ...(options?.expressionAttributeNames && { ExpressionAttributeNames: options.expressionAttributeNames }),
      ...(options?.scanIndexForward !== undefined && { ScanIndexForward: options.scanIndexForward }),
      ...(options?.limit && { Limit: options.limit }),
    }));

    return result.Items || [];
  } catch (error) {
    console.error("Error querying items from DynamoDB:", error);
    throw new Error("Failed to query items from database");
  }
}
