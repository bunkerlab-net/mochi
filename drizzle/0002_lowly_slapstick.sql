CREATE TABLE `PlayerState` (
	`guildId` text PRIMARY KEY NOT NULL,
	`voiceChannelId` text,
	`queue` text NOT NULL,
	`queuePosition` integer DEFAULT 0 NOT NULL,
	`positionInSeconds` integer DEFAULT 0 NOT NULL,
	`status` integer NOT NULL,
	`loopCurrentSong` integer DEFAULT false NOT NULL,
	`loopCurrentQueue` integer DEFAULT false NOT NULL,
	`volume` integer,
	`createdAt` DATETIME NOT NULL,
	`updatedAt` DATETIME NOT NULL
);
