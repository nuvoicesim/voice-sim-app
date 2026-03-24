import { defineAuth } from '@aws-amplify/backend';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: {
    email: true,
  },

  userAttributes: {
    "custom:currentCompletedStep": {
      dataType: "String",
      mutable: true,
      maxLen: 50,
      minLen: 1,
    },
    "custom:role": {
      dataType: "String",
      mutable: true,
      maxLen: 20,
      minLen: 1,
    },
  }
});
