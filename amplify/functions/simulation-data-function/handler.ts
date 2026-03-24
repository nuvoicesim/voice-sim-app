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
const SIMULATION_DATA_TABLE = process.env.TABLE_NAME;

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));
  
  const method = event.httpMethod;
  const queryParams = getQueryParams(event.queryStringParameters);

  // Handle OPTIONS requests for CORS
  if (method === "OPTIONS") {
    return optionsResponse();
  }

  // Validate table name environment variable
  if (!SIMULATION_DATA_TABLE) {
    console.error("TABLE_NAME environment variable is not set");
    return serverErrorResponse("Configuration error");
  }

  try {
    if (method === "GET") {
      return await handleGetSimulationData(queryParams);
    }
    
    if (method === "POST") {
      console.warn("[DEPRECATED] POST /simulation-data using legacy userID+simulationLevel key. Migrate to POST /sessions flow.");
      return await handleSaveSimulationData(event.body);
    }

    return methodNotAllowedResponse(["GET", "POST", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

/**
 * Handle GET request to retrieve simulation data
 */
async function handleGetSimulationData(queryParams: Record<string, string>) {
  const userId = queryParams.userID;
  const simulationLevel = queryParams.simulationLevel;
  
  if (!userId) {
    return badRequestResponse("Missing query parameter: userID");
  }

  try {
    if (simulationLevel) {
      // Get specific simulation level data
      const item = await getItem(SIMULATION_DATA_TABLE, { 
        userID: userId, 
        simulationLevel: parseInt(simulationLevel) 
      }, dynamo);
      
      if (!item) {
        return notFoundResponse("Simulation data not found for this user and simulation level");
      }

      return createResponse(HTTP_STATUS.OK, item);
    } else {
      // Get all simulation data for user (would need a different query approach)
      // For now, return error suggesting to specify simulation level
      return badRequestResponse("Please specify simulationLevel parameter");
    }
  } catch (error) {
    console.error("Error getting simulation data:", error);
    return serverErrorResponse("Failed to retrieve simulation data");
  }
}

/**
 * Handle POST request to save new simulation data
 */
async function handleSaveSimulationData(body: string | null) {
  try {
    const payload = parseJsonBody(body);
    const { userID: userId, simulationLevel, chatHistory, ...additionalFields } = payload;

    if (!userId || !simulationLevel || !chatHistory) {
      return badRequestResponse("Missing required fields: userID, simulationLevel, and chatHistory");
    }

    if (![1, 2, 3].includes(simulationLevel)) {
      return badRequestResponse("simulationLevel must be 1, 2, or 3");
    }

    // Check if record already exists
    const existingItem = await getItem(SIMULATION_DATA_TABLE, { 
      userID: userId, 
      simulationLevel: parseInt(simulationLevel) 
    }, dynamo);

    const currentTime = new Date().toISOString();
    
    // Prepare base item with required fields
    const baseItem = {
      simulationLevel,
      chatHistory,
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

    await putItem(SIMULATION_DATA_TABLE, item, dynamo);

    console.log("Simulation data saved successfully");
    console.log("SIMULATION DATA", item);
    return createResponse(HTTP_STATUS.OK, { 
      message: "Simulation data saved successfully",
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      additionalFields: Object.keys(additionalFields) // Return info about what additional fields were processed
    });
  } catch (error) {
    console.error("Error saving simulation data:", error);
    
    if (error instanceof Error && error.message.includes("Invalid")) {
      return serverErrorResponse("Failed to save simulation data");
    }
    
    return serverErrorResponse("Failed to save simulation data");
  }
}
