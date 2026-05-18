import { defineAuth } from '@aws-amplify/backend';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 *
 * Self-signups via Amplify Authenticator do NOT receive `custom:role` by
 * default. We rely on fallbacks instead of a Cognito PreSignUp trigger:
 *  - Frontend: App.tsx defaults to "student" if attrs['custom:role'] is absent.
 *  - Backend: course-function/handler.ts → findStudentByEmail() treats an
 *    empty/missing custom:role as student-eligible for course enrollment.
 *
 * The PreSignUp-trigger approach was rejected because @aws-amplify/backend
 * 1.5 lacks `resourceGroupName` on defineFunction, which is required to
 * pin a trigger Lambda into the auth stack and avoid a synth-time circular
 * dependency: auth → function → data → auth. Re-evaluate after upgrading.
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
  },
});
