import { PrismaClient } from "@prisma/client/edge";
import { withAccelerate } from "@prisma/extension-accelerate";
export const getPrisma = (url: string) =>
  new PrismaClient({
    datasources: {
      db: { url },
    },
  }).$extends(withAccelerate());
