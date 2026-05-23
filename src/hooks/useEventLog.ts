import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import {
  enqueueForBatch,
  flushBatch,
  flushPending,
  isCriticalEvent,
  logEventThunk,
} from "../slices/eventLogSlice";
import type { AppDispatch } from "../store";
import { useCourseContext } from "./useCourseContext";

const BATCH_INTERVAL_MS = 2000;

let timer: ReturnType<typeof setInterval> | null = null;
let flushDispatchRef: AppDispatch | null = null;

function ensureBatchTimer(dispatch: AppDispatch) {
  flushDispatchRef = dispatch;
  if (timer) return;
  timer = setInterval(() => {
    if (flushDispatchRef) {
      flushDispatchRef(flushBatch());
    }
  }, BATCH_INTERVAL_MS);
}

/**
 * Returns a function `logEvent(type, payload?)` that fires either immediately
 * (for critical events) or batches into a 2s window for high-frequency UI events.
 *
 * Course/module/item context is auto-injected from the nearest CourseContextProvider.
 */
export function useEventLog() {
  const dispatch = useDispatch<AppDispatch>();
  const ctx = useCourseContext();
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;

  useEffect(() => {
    ensureBatchTimer(dispatch);
    // Also flush pending on mount and when coming back online.
    dispatch(flushPending());
    const onlineHandler = () => dispatch(flushPending());
    window.addEventListener("online", onlineHandler);
    return () => {
      window.removeEventListener("online", onlineHandler);
    };
  }, [dispatch]);

  return (type: string, payload: Record<string, any> = {}) => {
    const ev = {
      eventType: type,
      occurredAt: new Date().toISOString(),
      courseId: ctxRef.current.courseId,
      moduleId: ctxRef.current.moduleId,
      moduleItemId: ctxRef.current.moduleItemId,
      payload,
    };
    if (isCriticalEvent(type)) {
      dispatch(logEventThunk(ev));
    } else {
      dispatch(enqueueForBatch(ev));
    }
  };
}
