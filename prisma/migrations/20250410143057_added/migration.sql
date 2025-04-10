/*
  Warnings:

  - Changed the type of `comparison` on the `Alert` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "Comparison" AS ENUM ('GREATER_THAN', 'LESS_THAN', 'EQUALS');

-- AlterTable
ALTER TABLE "Alert" DROP COLUMN "comparison",
ADD COLUMN     "comparison" "Comparison" NOT NULL;
