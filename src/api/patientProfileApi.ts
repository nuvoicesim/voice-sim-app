import { apiGet, apiPost, apiPut } from "./apiClient";

export interface PatientProfilePayload {
  displayName: string;
  profileKey: string;
  status: "draft" | "published" | "archived";
  dialogueConfig: {
    systemPrompt: string;
    version?: string;
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
  };
  scoringConfig: {
    systemPrompt: string;
    version?: string;
    model?: string;
    temperature?: number;
    maxOutputTokens?: number;
  };
  ttsConfig: {
    profileId?: string;
    version?: string;
    voiceId: string;
    modelId: string;
    stability?: number;
    similarityBoost?: number;
    styleExaggeration?: number;
    speed?: number;
  };
}

export const patientProfileApi = {
  list: () => apiGet("/patient-profiles"),

  get: (patientProfileId: string) =>
    apiGet(`/patient-profiles/${patientProfileId}`),

  create: (data: PatientProfilePayload) =>
    apiPost("/patient-profiles", data),

  update: (patientProfileId: string, data: PatientProfilePayload) =>
    apiPut(`/patient-profiles/${patientProfileId}`, data),

  archive: (patientProfileId: string) =>
    apiPost(`/patient-profiles/${patientProfileId}/archive`, {}),
};
