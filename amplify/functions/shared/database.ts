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
 * @returns Item from database or null if not found
 */
export async function getItem(
  tableName: string | undefined, 
  key: Record<string, any>,
  dynamo: DynamoDBDocumentClient
): Promise<any | null> {
  if (!tableName) {
    throw new Error("Table name is required");
  }
  
  try {
    const result = await dynamo.send(new GetCommand({
      TableName: tableName,
      Key: key
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
 * Execute a transaction write operation with multiple items
 * @param tableName - Name of the DynamoDB table
 * @param transactItems - Array of transaction items to write
 * @param dynamo - DynamoDB client instance
 */
export async function transactWriteItems(
  tableName: string,
  transactItems: any[],
  dynamo: DynamoDBDocumentClient
): Promise<void> {
  if (!tableName) {
    throw new Error("Table name is required");
  }
  
  try {
    await dynamo.send(new TransactWriteCommand({
      TransactItems: transactItems
    }));
  } catch (error) {
    console.error("Error executing transaction write:", error);
    throw new Error("Failed to execute transaction write");
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
