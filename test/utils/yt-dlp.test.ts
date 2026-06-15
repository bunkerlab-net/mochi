import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// execa is yt-dlp.ts's only heavy dependency. Replace it with a per-test
// dispatcher so we drive every branch without spawning a real process.
type ExecaResult = { stdout: string };
let execaHandler: (file: string, args: string[]) => Promise<ExecaResult>;

mock.module("execa", () => ({
  execa: (file: string, args: string[]) => execaHandler(file, args),
}));

const ytdlp = await import("../../src/utils/yt-dlp.js");
const { default: prepareYtDlp } = await import(
  "../../src/utils/prepare-yt-dlp.js"
);

let root: string;
let withPython: string;
let withoutPython: string;

const savedEnv = {
  ytDlpPath: process.env["YT_DLP_PATH"],
  bundled: process.env["MOCHI_BUNDLED_YT_DLP_PATH"],
};

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "mochi-ytdlp-"));
  // A "bin" dir that has a python sibling next to the yt-dlp executable.
  const binA = path.join(root, "withpy");
  mkdirSync(binA, { recursive: true });
  withPython = path.join(binA, "yt-dlp");
  writeFileSync(withPython, "#!/bin/sh\n");
  chmodSync(withPython, 0o755);
  writeFileSync(path.join(binA, "python"), "#!/bin/sh\n");
  // A "bin" dir with no python sibling.
  const binB = path.join(root, "nopy");
  mkdirSync(binB, { recursive: true });
  withoutPython = path.join(binB, "yt-dlp");
  writeFileSync(withoutPython, "#!/bin/sh\n");
  chmodSync(withoutPython, 0o755);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  for (const [key, value] of [
    ["YT_DLP_PATH", savedEnv.ytDlpPath],
    ["MOCHI_BUNDLED_YT_DLP_PATH", savedEnv.bundled],
  ] as const) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

const execaError = (fields: { stderr?: string; shortMessage?: string }) =>
  fields;

test("getExecutable: defaults to the bare binary name", () => {
  delete process.env["YT_DLP_PATH"];
  delete process.env["MOCHI_BUNDLED_YT_DLP_PATH"];
  expect(ytdlp.getExecutable()).toBe("yt-dlp");
});

test("getExecutable: prefers YT_DLP_PATH, trimming whitespace", () => {
  process.env["YT_DLP_PATH"] = "  /usr/bin/yt-dlp  ";
  expect(ytdlp.getExecutable()).toBe("/usr/bin/yt-dlp");
});

test("getExecutable: falls back to the bundled path", () => {
  delete process.env["YT_DLP_PATH"];
  process.env["MOCHI_BUNDLED_YT_DLP_PATH"] = "/opt/yt-dlp";
  expect(ytdlp.getExecutable()).toBe("/opt/yt-dlp");
});

test("getYtDlpVersion: returns the trimmed version string", async () => {
  execaHandler = async () => ({ stdout: "2024.04.09\n" });
  expect(await ytdlp.getYtDlpVersion()).toBe("2024.04.09");
});

test("getYouTubeMediaSource: resolves a playable url from requested_downloads", async () => {
  execaHandler = async () => ({
    stdout: JSON.stringify({
      requested_downloads: [
        {
          url: "https://media.example/audio",
          http_headers: { "User-Agent": "ua", Empty: "", Nullish: null },
        },
      ],
      is_live: false,
    }),
  });

  const result = await ytdlp.getYouTubeMediaSource("abcdefghijk");
  expect(result.url).toBe("https://media.example/audio");
  expect(result.headers).toEqual({ "User-Agent": "ua" });
  expect(result.isLive).toBe(false);
});

test("getYouTubeMediaSource: falls back to the top-level download object", async () => {
  execaHandler = async () => ({
    stdout: JSON.stringify({
      url: "https://media.example/top",
      http_headers: { Cookie: "c" },
      live_status: "is_live",
    }),
  });

  const result = await ytdlp.getYouTubeMediaSource(
    "https://www.youtube.com/watch?v=abcdefghijk",
  );
  expect(result.url).toBe("https://media.example/top");
  expect(result.isLive).toBe(true);
});

test("getYouTubeMediaSource: throws when no url is returned", async () => {
  execaHandler = async () => ({ stdout: JSON.stringify({ is_live: false }) });
  expect(ytdlp.getYouTubeMediaSource("abcdefghijk")).rejects.toThrow(
    "did not return a playable media URL",
  );
});

test("getYouTubeMediaSource: surfaces an execa stderr error", async () => {
  execaHandler = async () => {
    throw execaError({ stderr: "Video unavailable" });
  };
  expect(ytdlp.getYouTubeMediaSource("abcdefghijk")).rejects.toThrow(
    "yt-dlp failed to extract media: Video unavailable",
  );
});

test("getYouTubeMediaSource: throws a clean error on invalid JSON", async () => {
  execaHandler = async () => ({ stdout: "not json" });
  expect(ytdlp.getYouTubeMediaSource("abcdefghijk")).rejects.toThrow(
    "invalid response",
  );
});

test("getYouTubeMediaSource: rethrows unexpected non-execa errors", async () => {
  execaHandler = async () => {
    throw new RangeError("weird");
  };
  expect(ytdlp.getYouTubeMediaSource("abcdefghijk")).rejects.toThrow("weird");
});

test("getYouTubeMixEntries: filters, dedupes, and defaults entries", async () => {
  execaHandler = async () => ({
    stdout: JSON.stringify({
      entries: [
        { id: "AAAAAAAAAAA", title: "Song A", uploader: "Up A", duration: 200 },
        { id: "SEEDVIDEO01" },
        { id: "AAAAAAAAAAA" },
        { id: "short" },
        { id: "BBBBBBBBBBB", channel: "Chan B" },
        { id: "CCCCCCCCCCC", title: "C", uploader: "U", duration: "nope" },
      ],
    }),
  });

  const result = await ytdlp.getYouTubeMixEntries("SEEDVIDEO01", 10);
  expect(result).toEqual([
    { id: "AAAAAAAAAAA", title: "Song A", uploader: "Up A", duration: 200 },
    {
      id: "BBBBBBBBBBB",
      title: "BBBBBBBBBBB",
      uploader: "Chan B",
      duration: 0,
    },
    { id: "CCCCCCCCCCC", title: "C", uploader: "U", duration: 0 },
  ]);
});

test("getYouTubeMixEntries: returns an empty list when there are no entries", async () => {
  execaHandler = async () => ({ stdout: JSON.stringify({}) });
  expect(await ytdlp.getYouTubeMixEntries("SEEDVIDEO01", 5)).toEqual([]);
});

test("getYouTubeMixEntries: returns an empty list on failure", async () => {
  execaHandler = async () => {
    throw execaError({ shortMessage: "timed out" });
  };
  expect(await ytdlp.getYouTubeMixEntries("SEEDVIDEO01", 5)).toEqual([]);
});

test("updateYtDlp: updates via pip when python is available", async () => {
  process.env["YT_DLP_PATH"] = withPython;
  let versionCalls = 0;
  execaHandler = async (_file, args) => {
    if (args.includes("--version")) {
      versionCalls++;
      return { stdout: versionCalls === 1 ? "2024.01.01" : "2024.02.02" };
    }
    return { stdout: "" }; // pip install succeeds
  };

  const result = await ytdlp.updateYtDlp();
  expect(result.updateSucceeded).toBe(true);
  expect(result.updated).toBe(true);
  expect(result.beforeVersion).toBe("2024.01.01");
  expect(result.afterVersion).toBe("2024.02.02");
});

test("updateYtDlp: falls back to self-update when there is no python", async () => {
  process.env["YT_DLP_PATH"] = withoutPython;
  execaHandler = async (_file, args) => {
    if (args.includes("--version")) {
      return { stdout: "2024.03.03" };
    }
    return { stdout: "" }; // -U self-update succeeds
  };

  const result = await ytdlp.updateYtDlp();
  expect(result.updateSucceeded).toBe(true);
  expect(result.updated).toBe(false);
});

test("updateYtDlp: recovers via self-update when pip fails", async () => {
  process.env["YT_DLP_PATH"] = withPython;
  execaHandler = async (_file, args) => {
    if (args.includes("--version")) {
      return { stdout: "2024.01.01" };
    }
    if (args.includes("pip")) {
      throw execaError({ stderr: "pip exploded" });
    }
    return { stdout: "" }; // -U succeeds
  };

  const result = await ytdlp.updateYtDlp();
  expect(result.updateSucceeded).toBe(true);
});

test("updateYtDlp: reports an error when every strategy fails", async () => {
  process.env["YT_DLP_PATH"] = withoutPython;
  execaHandler = async (_file, args) => {
    if (args.includes("--version")) {
      return { stdout: "2024.01.01" };
    }
    throw execaError({ stderr: "self-update down" });
  };

  const result = await ytdlp.updateYtDlp();
  expect(result.updateSucceeded).toBe(false);
  expect(result.error).toContain("self-update down");
});

test("updateYtDlp: handles a failing version probe after updating", async () => {
  process.env["YT_DLP_PATH"] = withPython;
  let versionCalls = 0;
  execaHandler = async (_file, args) => {
    if (args.includes("--version")) {
      versionCalls++;
      if (versionCalls === 1) {
        return { stdout: "2024.01.01" };
      }
      throw execaError({ shortMessage: "probe failed" });
    }
    return { stdout: "" };
  };

  const result = await ytdlp.updateYtDlp();
  expect(result.afterVersion).toBeNull();
  expect(result.updated).toBe(false);
});

test("updateYtDlp: tolerates a failing initial version probe", async () => {
  process.env["YT_DLP_PATH"] = withoutPython;
  let versionCalls = 0;
  execaHandler = async (_file, args) => {
    if (args.includes("--version")) {
      versionCalls++;
      if (versionCalls === 1) {
        throw execaError({ shortMessage: "no version" });
      }
      return { stdout: "2024.05.05" };
    }
    return { stdout: "" };
  };

  const result = await ytdlp.updateYtDlp();
  expect(result.beforeVersion).toBeNull();
  expect(result.afterVersion).toBe("2024.05.05");
});

// prepare-yt-dlp drives the real yt-dlp helpers, so it shares this file's execa
// mock rather than mocking the yt-dlp module (which would break the tests above).
test("prepareYtDlp: logs the version when auto-update is off", async () => {
  process.env["YT_DLP_PATH"] = withoutPython;
  execaHandler = async () => ({ stdout: "2024.01.01" });
  await expect(
    prepareYtDlp({ YT_DLP_AUTO_UPDATE: false } as never),
  ).resolves.toBeUndefined();
});

test("prepareYtDlp: tolerates a failing probe when auto-update is off", async () => {
  process.env["YT_DLP_PATH"] = withoutPython;
  execaHandler = async () => {
    throw execaError({ shortMessage: "missing" });
  };
  await expect(
    prepareYtDlp({ YT_DLP_AUTO_UPDATE: false } as never),
  ).resolves.toBeUndefined();
});

test("prepareYtDlp: reports an updated version", async () => {
  process.env["YT_DLP_PATH"] = withPython;
  let v = 0;
  execaHandler = async (_f, args) => {
    if (args.includes("--version")) {
      v++;
      return { stdout: v === 1 ? "2024.01.01" : "2024.02.02" };
    }
    return { stdout: "" };
  };
  await expect(
    prepareYtDlp({ YT_DLP_AUTO_UPDATE: true } as never),
  ).resolves.toBeUndefined();
});

test("prepareYtDlp: notes when already on the current version", async () => {
  process.env["YT_DLP_PATH"] = withoutPython;
  execaHandler = async (_f, args) => {
    if (args.includes("--version")) {
      return { stdout: "2024.01.01" };
    }
    return { stdout: "" };
  };
  await expect(
    prepareYtDlp({ YT_DLP_AUTO_UPDATE: true } as never),
  ).resolves.toBeUndefined();
});

test("prepareYtDlp: warns when no version is available after an update", async () => {
  process.env["YT_DLP_PATH"] = withoutPython;
  let v = 0;
  execaHandler = async (_f, args) => {
    if (args.includes("--version")) {
      v++;
      if (v === 1) {
        return { stdout: "2024.01.01" };
      }
      throw execaError({ shortMessage: "gone" });
    }
    throw execaError({ stderr: "self-update failed" });
  };
  await expect(
    prepareYtDlp({ YT_DLP_AUTO_UPDATE: true } as never),
  ).resolves.toBeUndefined();
});

test("prepareYtDlp: continues when the update failed but a version remains", async () => {
  process.env["YT_DLP_PATH"] = withoutPython;
  execaHandler = async (_f, args) => {
    if (args.includes("--version")) {
      return { stdout: "2024.01.01" };
    }
    throw execaError({ stderr: "self-update failed" });
  };
  await expect(
    prepareYtDlp({ YT_DLP_AUTO_UPDATE: true } as never),
  ).resolves.toBeUndefined();
});
