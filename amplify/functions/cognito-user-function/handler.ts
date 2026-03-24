import type { APIGatewayProxyHandler } from "aws-lambda";
import { 
  createResponse, 
  optionsResponse, 
  badRequestResponse, 
  conflictResponse,
  notFoundResponse, 
  methodNotAllowedResponse, 
  serverErrorResponse,
  parseJsonBody,
  getQueryParams,
  HTTP_STATUS
} from "../shared";
import { CognitoIdentityProviderClient, AdminCreateUserCommand, AdminGetUserCommand, AdminSetUserPasswordCommand, AdminUpdateUserAttributesCommand, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";

const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });
const USER_POOL_ID = process.env.USER_POOL_ID;
const VALID_ROLES = ["student", "faculty", "admin"] as const;

export const handler: APIGatewayProxyHandler = async (event) => {
  console.log('Event received:', JSON.stringify(event, null, 2));
  
  const method = event.httpMethod;
  const queryParams = getQueryParams(event.queryStringParameters);
  const pathParams = event.pathParameters;

  if (method === "OPTIONS") {
    return optionsResponse();
  }

  if (!USER_POOL_ID) {
    console.error("USER_POOL_ID environment variable is not set");
    return serverErrorResponse("Configuration error");
  }

  try {
    // PUT /cognito-user/{userId}/role — update user role (admin only)
    if (method === "PUT" && pathParams?.userId && event.resource?.includes("/role")) {
      return await handleUpdateRole(pathParams.userId, event.body);
    }

    // GET /cognito-user?list=true — list all users
    if (method === "GET" && queryParams.list === "true") {
      return await handleListUsers(queryParams);
    }

    if (method === "GET") {
      return await handleGetUser(queryParams);
    }
    
    if (method === "POST") {
      return await handleCreateUser(event.body);
    }

    return methodNotAllowedResponse(["GET", "POST", "PUT", "OPTIONS"]);
  } catch (error) {
    console.error("Unhandled error:", error);
    return serverErrorResponse("Internal server error");
  }
};

/**
 * Generate password satisfying Cognito default policy
 * At least 1 letter + 1 digit + 1 symbol
 */
function generatePassword(length: number = 12): string {
  const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digits = '0123456789';
  const symbols = '!@#$%^&*()_-+=';
  
  // Guarantee at least one of each required character type
  const guaranteedLetter = letters[Math.floor(Math.random() * letters.length)];
  const guaranteedDigit = digits[Math.floor(Math.random() * digits.length)];
  const guaranteedSymbol = symbols[Math.floor(Math.random() * symbols.length)];
  
  // Generate remaining characters
  const allChars = letters + digits + symbols;
  const remainingLength = length - 3;
  let remaining = '';
  
  for (let i = 0; i < remainingLength; i++) {
    remaining += allChars[Math.floor(Math.random() * allChars.length)];
  }
  
  // Combine and shuffle
  const password = guaranteedLetter + guaranteedDigit + guaranteedSymbol + remaining;
  const passwordArray = password.split('');
  
  // Fisher-Yates shuffle
  for (let i = passwordArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [passwordArray[i], passwordArray[j]] = [passwordArray[j], passwordArray[i]];
  }
  
  return passwordArray.join('');
}

/**
 * Handle POST request to create a new Cognito user
 */
async function handleCreateUser(body: string | null) {
  try {
    const payload = parseJsonBody(body);
    const { username, ...additionalFields } = payload;

    if (!username) {
      return badRequestResponse("Missing required field: username");
    }

    // Generate email from username
    const email = `${username}@voice-sim.org`;
    
    // Check if user already exists
    try {
      const checkUserCommand = new AdminGetUserCommand({
        UserPoolId: USER_POOL_ID,
        Username: email
      });
      await cognitoClient.send(checkUserCommand);
      
      // If we reach here, user already exists
      return conflictResponse("Username already exists");
    } catch (error: any) {
      console.log("User doesn't exist, proceeding with creation");
    }
    
    // Generate password using the specified method
    const password = generatePassword(12);

    const baseUserAttributes = [
      {
        Name: "email",
        Value: email
      },
      {
        Name: "email_verified",
        Value: "true"
      },
      {
        Name: "custom:role",
        Value: "student"
      }
    ];

    // Add any additional fields as custom attributes
    const additionalAttributes = Object.entries(additionalFields).map(([key, value]) => ({
      Name: `custom:${key}`,
      Value: String(value)
    }));

    // Combine base and additional attributes
    const userAttributes = [...baseUserAttributes, ...additionalAttributes];

    // Log what additional fields are being added
    if (Object.keys(additionalFields).length > 0) {
      console.log("Adding custom attributes:", Object.keys(additionalFields));
    }

    // Create user in Cognito
    const createUserCommand = new AdminCreateUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: userAttributes,
      MessageAction: "SUPPRESS" // Suppress welcome email
    });

    const result = await cognitoClient.send(createUserCommand);

    console.log("User created successfully:", result);

    // Set the password as permanent
    const setPasswordCommand = new AdminSetUserPasswordCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      Password: password,
      Permanent: true
    });
    await cognitoClient.send(setPasswordCommand);

    return createResponse(HTTP_STATUS.OK, { 
      message: "User created successfully",
      username: email,
      password: password,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      customAttributes: Object.keys(additionalFields) // Return info about what custom attributes were added
    });
  } catch (error) {
    console.error("Error creating user:", error);
    return serverErrorResponse("Failed to create user");
  }
}

/**
 * Handle GET request to retrieve user information
 */
async function handleGetUser(queryParams: Record<string, string>) {
  const username = queryParams.username;
  
  if (!username) {
    return badRequestResponse("Missing query parameter: username");
  }

  try {
    const getUserCommand = new AdminGetUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: username
    });
    
    const result = await cognitoClient.send(getUserCommand);
    
    if (!result.Username) {
      return badRequestResponse("User not found");
    }

    const userInfo = {
      username: result.Username,
      userStatus: result.UserStatus,
      attributes: result.UserAttributes?.reduce((acc: any, attr: any) => {
        if (attr.Name && attr.Value) {
          acc[attr.Name] = attr.Value;
        }
        return acc;
      }, {}),
    };

    return createResponse(HTTP_STATUS.OK, userInfo);
  } catch (error) {
    console.error("Error getting user:", error);
    return serverErrorResponse("Failed to retrieve user information");
  }
}

/**
 * Handle PUT request to update a user's role (admin-only operation)
 */
async function handleUpdateRole(userId: string, body: string | null) {
  try {
    const payload = parseJsonBody(body);
    const { role, callerRole } = payload;

    if (callerRole !== "admin") {
      return createResponse(HTTP_STATUS.FORBIDDEN, { error: "Only admins can update user roles" });
    }

    if (!role || !VALID_ROLES.includes(role)) {
      return badRequestResponse(`Invalid role. Must be one of: ${VALID_ROLES.join(", ")}`);
    }

    const command = new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: userId,
      UserAttributes: [{ Name: "custom:role", Value: role }],
    });

    await cognitoClient.send(command);

    return createResponse(HTTP_STATUS.OK, {
      message: "Role updated successfully",
      userId,
      role,
    });
  } catch (error: any) {
    if (error.name === "UserNotFoundException") {
      return notFoundResponse("User not found");
    }
    console.error("Error updating role:", error);
    return serverErrorResponse("Failed to update user role");
  }
}

/**
 * Handle GET request to list all users with pagination
 */
async function handleListUsers(queryParams: Record<string, string>) {
  try {
    const limit = parseInt(queryParams.limit || "20", 10);
    const paginationToken = queryParams.paginationToken || undefined;
    const roleFilter = queryParams.role;
    const search = queryParams.search?.trim();

    const mapUsers = (cognitoUsers: any[]) =>
      cognitoUsers.map((u) => ({
        username: u.Username,
        userStatus: u.UserStatus,
        enabled: u.Enabled,
        createdAt: u.UserCreateDate?.toISOString(),
        attributes: u.Attributes?.reduce((acc: any, attr: any) => {
          if (attr.Name && attr.Value) acc[attr.Name] = attr.Value;
          return acc;
        }, {}),
      }));

    if (search) {
      const cognitoLimit = Math.min(limit, 60);

      const [emailResult, usernameResult] = await Promise.all([
        cognitoClient.send(new ListUsersCommand({
          UserPoolId: USER_POOL_ID,
          Limit: cognitoLimit,
          Filter: `email ^= "${search}"`,
        })),
        cognitoClient.send(new ListUsersCommand({
          UserPoolId: USER_POOL_ID,
          Limit: cognitoLimit,
          Filter: `username ^= "${search}"`,
        })),
      ]);

      const merged = [...(emailResult.Users || []), ...(usernameResult.Users || [])];
      const seen = new Set<string>();
      const deduped = merged.filter((u) => {
        if (!u.Username || seen.has(u.Username)) return false;
        seen.add(u.Username);
        return true;
      });

      let users = mapUsers(deduped);

      if (roleFilter) {
        users = users.filter((u) => u.attributes?.["custom:role"] === roleFilter);
      }

      return createResponse(HTTP_STATUS.OK, { users, paginationToken: null });
    }

    const command = new ListUsersCommand({
      UserPoolId: USER_POOL_ID,
      Limit: Math.min(limit, 60),
      PaginationToken: paginationToken,
      ...(roleFilter ? { Filter: `"custom:role" = "${roleFilter}"` } : {}),
    });

    const result = await cognitoClient.send(command);

    return createResponse(HTTP_STATUS.OK, {
      users: mapUsers(result.Users || []),
      paginationToken: result.PaginationToken || null,
    });
  } catch (error) {
    console.error("Error listing users:", error);
    return serverErrorResponse("Failed to list users");
  }
}
