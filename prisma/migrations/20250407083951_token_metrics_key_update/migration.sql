/*
  Warnings:

  - The primary key for the `Token_Metrics` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- AlterTable
ALTER TABLE "Token_Metrics" DROP CONSTRAINT "Token_Metrics_pkey",
ADD CONSTRAINT "Token_Metrics_pkey" PRIMARY KEY ("timestamp", "mint");
