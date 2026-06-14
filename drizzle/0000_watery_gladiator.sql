CREATE TABLE `FavoriteQuery` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`guildId` text NOT NULL,
	`authorId` text NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`createdAt` DATETIME NOT NULL,
	`updatedAt` DATETIME NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `FavoriteQuery_guildId_name_key` ON `FavoriteQuery` (`guildId`,`name`);--> statement-breakpoint
CREATE TABLE `FileCache` (
	`hash` text PRIMARY KEY NOT NULL,
	`bytes` integer NOT NULL,
	`accessedAt` DATETIME NOT NULL,
	`createdAt` DATETIME NOT NULL,
	`updatedAt` DATETIME NOT NULL
);
--> statement-breakpoint
CREATE TABLE `KeyValueCache` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`expiresAt` DATETIME NOT NULL,
	`createdAt` DATETIME NOT NULL,
	`updatedAt` DATETIME NOT NULL
);
--> statement-breakpoint
CREATE TABLE `Setting` (
	`guildId` text PRIMARY KEY NOT NULL,
	`playlistLimit` integer DEFAULT 50 NOT NULL,
	`secondsToWaitAfterQueueEmpties` integer DEFAULT 30 NOT NULL,
	`leaveIfNoListeners` integer DEFAULT true NOT NULL,
	`queueAddResponseEphemeral` integer DEFAULT false NOT NULL,
	`autoAnnounceNextSong` integer DEFAULT false NOT NULL,
	`defaultVolume` integer DEFAULT 100 NOT NULL,
	`defaultQueuePageSize` integer DEFAULT 10 NOT NULL,
	`turnDownVolumeWhenPeopleSpeak` integer DEFAULT false NOT NULL,
	`turnDownVolumeWhenPeopleSpeakTarget` integer DEFAULT 20 NOT NULL,
	`createdAt` DATETIME NOT NULL,
	`updatedAt` DATETIME NOT NULL
);
