import { apiGet } from "./apiClient";

interface CognitoUser {
  username: string;
  attributes?: Record<string, string>;
}

export const cognitoUserApi = {
  list: (params?: Record<string, string>) =>
    apiGet<{ users: CognitoUser[]; paginationToken: string | null }>(
      "/cognito-user",
      { list: "true", limit: "60", ...params }
    ),
};
