import { configureStore } from '@reduxjs/toolkit';
import stepReducer from './reducer';
import authReducer from './slices/authSlice';
import assignmentReducer from './slices/assignmentSlice';
import sessionReducer from './slices/sessionSlice';
import courseReducer from './slices/courseSlice';
import moduleReducer from './slices/moduleSlice';
import moduleItemReducer from './slices/moduleItemSlice';
import surveyTemplateReducer from './slices/surveyTemplateSlice';
import surveyInstanceReducer from './slices/surveyInstanceSlice';
import eventLogReducer from './slices/eventLogSlice';
import studentProgressReducer from './slices/studentProgressSlice';
import groupAssignmentReducer from './slices/groupAssignmentSlice';
import consentReducer from './slices/consentSlice';
import { setStoreRef } from './storeRef';

export const store = configureStore({
  reducer: {
    steps: stepReducer,
    auth: authReducer,
    assignments: assignmentReducer,
    sessions: sessionReducer,
    courses: courseReducer,
    modules: moduleReducer,
    moduleItems: moduleItemReducer,
    surveyTemplates: surveyTemplateReducer,
    surveyInstances: surveyInstanceReducer,
    events: eventLogReducer,
    progress: studentProgressReducer,
    groupAssignment: groupAssignmentReducer,
    consent: consentReducer,
  },
});

setStoreRef(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;