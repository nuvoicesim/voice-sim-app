import { configureStore } from '@reduxjs/toolkit';
import stepReducer from './reducer';
import authReducer from './slices/authSlice';
import assignmentReducer from './slices/assignmentSlice';
import sessionReducer from './slices/sessionSlice';
import { setStoreRef } from './storeRef';

export const store = configureStore({
  reducer: {
    steps: stepReducer,
    auth: authReducer,
    assignments: assignmentReducer,
    sessions: sessionReducer,
  },
});

setStoreRef(store);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

export default store;