import type { APIGatewayProxyHandler } from "aws-lambda";
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
  prepareItemForStorage 
} from "../shared";

// Initialize DynamoDB client
const dynamo = createDynamoDbClient();
const DEBRIEF_TABLE = process.env.TABLE_NAME;

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));
  
  const method = event.httpMethod;
  const queryParams = getQueryParams(event.queryStringParameters);

  // Handle OPTIONS requests for CORS
  if (method === "OPTIONS") {
    return optionsResponse();
  }

  // Validate table name environment variable
  if (!DEBRIEF_TABLE) {
    console.error("TABLE_NAME environment variable is not set");
    return serverErrorResponse("Configuration error");
  }

  try {
    if (method === "GET") {
      return await handleGetDebrief(queryParams);
    }
    
    if (method === "POST") {
      console.warn("[DEPRECATED] POST /debrief using legacy userID+simulationLevel key. Migrate to session-based evaluation flow.");
      return await handleSaveDebrief(event.body);
    }

    return methodNotAllowedResponse(["GET", "POST", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

/**
 * Handle GET request to retrieve debrief data
 */
async function handleGetDebrief(queryParams: Record<string, string>) {
  const userId = queryParams.userID;
  const simulationLevel = queryParams.simulationLevel;
  
  if (!userId) {
    return badRequestResponse("Missing query parameter: userID");
  }

  try {
    if (simulationLevel) {
      // Get specific simulation level debrief
      const item = await getItem(DEBRIEF_TABLE, { 
        userID: userId, 
        simulationLevel: parseInt(simulationLevel) 
      }, dynamo);
      
      if (!item) {
        return notFoundResponse("Debrief not found for this user and simulation level");
      }

      return createResponse(HTTP_STATUS.OK, item);
    } else {
      // Get all debrief for user (would need a different query approach)
      // For now, return error suggesting to specify simulation level
      return badRequestResponse("Please specify simulationLevel parameter");
    }
  } catch (error) {
    console.error("Error getting debrief:", error);
    return serverErrorResponse("Failed to retrieve debrief data");
  }
}

/**
 * Handle POST request to save debrief data
 */
async function handleSaveDebrief(body: string | null) {
  try {
    const payload = parseJsonBody(body);
    const { userID: userId, simulationLevel, answers, ...additionalFields } = payload;

    if (!userId || !simulationLevel || !answers) {
      return badRequestResponse("Missing required fields: userID, simulationLevel, and answers");
    }

    if (![1, 2, 3].includes(simulationLevel)) {
      return badRequestResponse("simulationLevel must be 1, 2, or 3");
    }

    // Check if record already exists
    const existingItem = await getItem(DEBRIEF_TABLE, { 
      userID: userId, 
      simulationLevel: parseInt(simulationLevel) 
    }, dynamo);

    const currentTime = new Date().toISOString();

    // Prepare base item with required fields
    const baseItem = {
      simulationLevel,
      answers,
      ...additionalFields // Include any additional fields from payload
    };

    // Prepare item for storage with composite key
    const item = prepareItemForStorage(
      baseItem,
      userId,
      false // Don't include generated ID, use composite key
    );

    // Add composite key for userID + simulationLevel
    item.userID = userId;
    item.simulationLevel = simulationLevel;

    if (existingItem) {
      // Record exists, update updatedAt
      item.updatedAt = currentTime;
      // Keep existing createdAt
      item.createdAt = existingItem.createdAt;
      
      // Log what additional fields are being updated
      if (Object.keys(additionalFields).length > 0) {
        console.log("Updating additional fields:", Object.keys(additionalFields));
      }
    } else {
      // New record, set both createdAt and updatedAt
      item.createdAt = currentTime;
      item.updatedAt = currentTime;
      
      // Log what additional fields are being added
      if (Object.keys(additionalFields).length > 0) {
        console.log("Adding new fields:", Object.keys(additionalFields));
      }
    }

    await putItem(DEBRIEF_TABLE, item, dynamo);

    console.log("Debrief saved successfully");
    console.log("DEBRIEF DATA", item);
    return createResponse(HTTP_STATUS.OK, { 
      message: "Debrief saved successfully",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      additionalFields: Object.keys(additionalFields) // Return info about what additional fields were processed
    });
  } catch (error) {
    console.error("Error saving debrief:", error);
    
    if (error instanceof Error && error.message.includes("Invalid")) {
      return badRequestResponse(error.message);
    }
    
    return serverErrorResponse("Failed to save debrief");
  }
}
