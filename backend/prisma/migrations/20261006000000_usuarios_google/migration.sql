-- Los trabajos anteriores eran temporales (24 h) y sin dueño: se descartan.
DELETE FROM `Job`;

-- DropIndex
DROP INDEX `Job_expiresAt_idx` ON `Job`;

-- AlterTable
ALTER TABLE `Job` DROP COLUMN `expiresAt`,
    DROP COLUMN `tokenHash`,
    ADD COLUMN `title` VARCHAR(255) NOT NULL,
    ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    ADD COLUMN `userId` VARCHAR(36) NOT NULL;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(36) NOT NULL,
    `googleSub` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `picture` VARCHAR(1024) NULL,
    `role` VARCHAR(16) NOT NULL DEFAULT 'user',
    `status` VARCHAR(16) NOT NULL DEFAULT 'active',
    `maxFileMb` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastLoginAt` DATETIME(3) NULL,

    UNIQUE INDEX `User_googleSub_key`(`googleSub`),
    INDEX `User_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Setting` (
    `key` VARCHAR(64) NOT NULL,
    `value` TEXT NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE INDEX `Job_userId_updatedAt_idx` ON `Job`(`userId`, `updatedAt`);

-- AddForeignKey
ALTER TABLE `Job` ADD CONSTRAINT `Job_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
