import type { Setting } from "../db/schema.js";

// The `setting` columns a user can edit through /config. Excludes the primary
// key (`guildId`) and the `createdAt`/`updatedAt` bookkeeping columns. Every
// member must be a real `setting` column — the `config[column]` reads in the
// command enforce that at compile time.
export type EditableSettingColumn = Extract<
  keyof Setting,
  | "playlistLimit"
  | "secondsToWaitAfterQueueEmpties"
  | "leaveIfNoListeners"
  | "queueAddResponseEphemeral"
  | "autoAnnounceNextSong"
  | "autoplay"
  | "defaultVolume"
  | "defaultQueuePageSize"
  | "turnDownVolumeWhenPeopleSpeak"
  | "turnDownVolumeWhenPeopleSpeakTarget"
>;

interface BaseDefinition {
  // Slug used as the slash-command choice value and in `/config get|set <key>`.
  key: string;
  // Human-friendly name shown in `/config get`.
  label: string;
  // The `setting` column this maps to.
  column: EditableSettingColumn;
  // One-line explanation shown in `/config get <key>`.
  description: string;
}

export interface BooleanDefinition extends BaseDefinition {
  type: "boolean";
}

export interface IntegerDefinition extends BaseDefinition {
  type: "integer";
  min?: number;
  max?: number;
  // Optional custom display (e.g. 0 -> "never leave").
  format?: (value: number) => string;
}

export type SettingDefinition = BooleanDefinition | IntegerDefinition;

// The catalog of editable settings. Drives the slash-command choices, value
// validation, the `/config get` listing, and the `/config get <key>` help — so
// adding a setting is a single entry here plus its `setting` column.
export const CONFIG_SETTINGS: readonly SettingDefinition[] = [
  {
    key: "playlist-limit",
    label: "Playlist limit",
    column: "playlistLimit",
    type: "integer",
    min: 1,
    description: "Maximum number of tracks added from a single playlist.",
  },
  {
    key: "wait-after-queue-empties",
    label: "Wait before leaving after queue empties",
    column: "secondsToWaitAfterQueueEmpties",
    type: "integer",
    min: 0,
    format: (value) => (value === 0 ? "never leave" : `${value}s`),
    description:
      "Seconds to stay in the voice channel after the queue empties (0 = never leave).",
  },
  {
    key: "leave-if-no-listeners",
    label: "Leave if there are no listeners",
    column: "leaveIfNoListeners",
    type: "boolean",
    description: "Leave the voice channel once everyone else has left.",
  },
  {
    key: "queue-add-response-hidden",
    label: "Add-to-queue responses show for requester only",
    column: "queueAddResponseEphemeral",
    type: "boolean",
    description:
      "Only show the requester the confirmation when a track is queued.",
  },
  {
    key: "auto-announce-next-song",
    label: "Auto announce next song in queue",
    column: "autoAnnounceNextSong",
    type: "boolean",
    description: "Announce each track in the channel as it starts playing.",
  },
  {
    key: "autoplay",
    label: "Autoplay similar music when queue ends",
    column: "autoplay",
    type: "boolean",
    description: "Keep playing similar music when the queue runs dry.",
  },
  {
    key: "default-volume",
    label: "Default volume",
    column: "defaultVolume",
    type: "integer",
    min: 0,
    max: 100,
    description:
      "Volume used when Mochi joins a channel (0 is muted, 100 is max).",
  },
  {
    key: "default-queue-page-size",
    label: "Default queue page size",
    column: "defaultQueuePageSize",
    type: "integer",
    min: 1,
    max: 30,
    description: "Number of tracks shown per page of /queue.",
  },
  {
    key: "reduce-vol-when-voice",
    label: "Reduce volume when people speak",
    column: "turnDownVolumeWhenPeopleSpeak",
    type: "boolean",
    description: "Duck the music volume while people are speaking.",
  },
  {
    key: "reduce-vol-when-voice-target",
    label: "Target volume when people speak",
    column: "turnDownVolumeWhenPeopleSpeakTarget",
    type: "integer",
    min: 0,
    max: 100,
    description:
      "Volume to duck to while people speak (0 is muted, 100 is max).",
  },
];

// Slug -> definition lookup for `/config get|set <key>`.
export const CONFIG_SETTINGS_BY_KEY: Record<string, SettingDefinition> =
  Object.fromEntries(
    CONFIG_SETTINGS.map((definition) => [definition.key, definition]),
  );

// Slash-command choices for the `key` option of both `/config get` and `set`.
export const CONFIG_SETTING_CHOICES = CONFIG_SETTINGS.map((definition) => ({
  name: definition.label,
  value: definition.key,
}));

// Accepted spellings for boolean values, mapped to the value they set.
const BOOLEAN_VALUES: Record<string, boolean> = {
  true: true,
  yes: true,
  y: true,
  on: true,
  enable: true,
  enabled: true,
  "1": true,
  false: false,
  no: false,
  n: false,
  off: false,
  disable: false,
  disabled: false,
  "0": false,
};

// Coerce the raw string from `/config set` into the setting's typed value,
// throwing a user-facing error when the input is invalid or out of range.
export const parseSettingValue = (
  definition: SettingDefinition,
  raw: string,
): number | boolean => {
  const trimmed = raw.trim();

  if (definition.type === "boolean") {
    const parsed = BOOLEAN_VALUES[trimmed.toLowerCase()];
    if (parsed === undefined) {
      throw new Error(
        `\`${definition.key}\` must be true or false (got \`${raw}\`)`,
      );
    }
    return parsed;
  }

  if (!/^-?\d+$/.test(trimmed)) {
    throw new Error(
      `\`${definition.key}\` must be a whole number (got \`${raw}\`)`,
    );
  }

  const value = Number(trimmed);
  if (definition.min !== undefined && value < definition.min) {
    throw new Error(
      `\`${definition.key}\` must be at least ${definition.min} (got ${value})`,
    );
  }
  if (definition.max !== undefined && value > definition.max) {
    throw new Error(
      `\`${definition.key}\` must be at most ${definition.max} (got ${value})`,
    );
  }

  return value;
};

// Render a stored value for display in `/config get`.
export const formatSettingValue = (
  definition: SettingDefinition,
  value: number | boolean,
): string => {
  if (definition.type === "boolean") {
    return value ? "yes" : "no";
  }
  if (definition.format) {
    return definition.format(value as number);
  }
  return String(value);
};

// Human-readable summary of what `/config set <key>` accepts, for help output
// and error messages.
export const describeAllowedValues = (
  definition: SettingDefinition,
): string => {
  if (definition.type === "boolean") {
    return "true or false";
  }
  const { min, max } = definition;
  if (min !== undefined && max !== undefined) {
    return `a whole number from ${min} to ${max}`;
  }
  if (min !== undefined) {
    return `a whole number ≥ ${min}`;
  }
  if (max !== undefined) {
    return `a whole number ≤ ${max}`;
  }
  return "a whole number";
};
