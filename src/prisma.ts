import { PrismaClient } from "@prisma/client";
export const getPrisma = (url: string) =>
    new PrismaClient({
        datasources: {
            db: { url },
        },
    });
