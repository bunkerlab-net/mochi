import { URL } from "node:url";

export const cleanUrl = (url: string) => {
  try {
    // Clean URL
    const u = new URL(url);

    // Snapshot the keys first: deleting from a live URLSearchParams while
    // iterating it skips the next entry, leaving some params behind.
    for (const name of [...u.searchParams.keys()]) {
      if (name !== "v") {
        u.searchParams.delete(name);
      }
    }

    return u.toString();
  } catch (_: unknown) {
    return url;
  }
};
