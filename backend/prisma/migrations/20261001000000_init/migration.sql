CREATE TABLE `Job` (
  `id` VARCHAR(36) NOT NULL,
  `tokenHash` CHAR(64) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `kind` VARCHAR(8) NOT NULL,
  `status` VARCHAR(24) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expiresAt` DATETIME(3) NOT NULL,
  `pages` JSON NOT NULL,
  `config` JSON NULL,
  `revision` INTEGER NOT NULL DEFAULT 0,
  `renderedRevision` INTEGER NULL,
  `error` TEXT NULL,
  INDEX `Job_expiresAt_idx` (`expiresAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
