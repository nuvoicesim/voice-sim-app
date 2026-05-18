import { notifications } from "@mantine/notifications";

const AUTO_CLOSE_MS = 3000;

/**
 * Thin wrappers around Mantine notifications so call sites stay terse.
 * All notification kinds auto-close after 3 seconds.
 */
export const notify = {
  success(message: string, title = "Success") {
    notifications.show({
      title,
      message,
      color: "green",
      autoClose: AUTO_CLOSE_MS,
      withBorder: true,
    });
  },
  error(message: string, title = "Error") {
    notifications.show({
      title,
      message,
      color: "red",
      autoClose: AUTO_CLOSE_MS,
      withBorder: true,
    });
  },
  info(message: string, title?: string) {
    notifications.show({
      title,
      message,
      color: "blue",
      autoClose: AUTO_CLOSE_MS,
      withBorder: true,
    });
  },
  warn(message: string, title = "Warning") {
    notifications.show({
      title,
      message,
      color: "yellow",
      autoClose: AUTO_CLOSE_MS,
      withBorder: true,
    });
  },
};
