import { createContext, useContext, type ReactNode } from "react";

export interface CourseContextValue {
  courseId?: string;
  moduleId?: string;
  moduleItemId?: string;
}

const CourseContext = createContext<CourseContextValue>({});

export function CourseContextProvider({
  value,
  children,
}: {
  value: CourseContextValue;
  children: ReactNode;
}) {
  return <CourseContext.Provider value={value}>{children}</CourseContext.Provider>;
}

export function useCourseContext(): CourseContextValue {
  return useContext(CourseContext);
}
