import parse from "parse-duration";

/**
 * Parse duration strings to seconds.
 * @param str any common duration format, like 1m or 1hr 30s. If the input is a number it's assumed to be in seconds.
 * @returns seconds
 */
const durationStringToSeconds = (str: string) => {
  let seconds: number;
  // Only treat a *pure* integer string as seconds. Anchoring both ends avoids
  // the old `/\d+$/` trap, where a unit-prefixed value like "1m30" matched
  // "ends in a digit" and was then truncated by parseInt (→ 1) instead of parsed.
  const isInputSeconds = Boolean(/^\d+$/.exec(str));

  if (isInputSeconds) {
    seconds = Number.parseInt(str, 10);
  } else {
    seconds = (parse(str) ?? 0) / 1000;
  }

  return seconds;
};

export default durationStringToSeconds;
