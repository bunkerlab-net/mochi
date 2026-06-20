export default (error?: string | Error): string => {
  let str = "unknown error";

  if (error) {
    if (typeof error === "string") {
      str = `🚫 aiya: ${error}`;
    } else if (error instanceof Error) {
      str = `🚫 aiya: ${error.message}`;
    }
  }

  return str;
};
