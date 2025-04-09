import { Context } from "hono";
import { getPrisma } from "./prisma";

export async function makeAlert(
  c: Context<{ Bindings: { DATABASE_URL: string } }>,
) {
  // mint is the mint address
  // type is the type of alert
  // threshold is the threshold of the alert
  const { mint, type, comparison, threshold, userEmail } = await c.req.json();
  const prisma = getPrisma(c.env.DATABASE_URL);
  // check  is the  user alredy has an alert
  const existeing_alert = await prisma.alert.findFirst({
    where: {
      userEmail,
    },
  });

  if (existeing_alert) {
    return c.json({ error: "User already has an alert" }, 400);
  }

  await prisma.alert.create({
    data: {
      mint,
      parameter: type,
      comparison,
      userEmail,
      threshold,
    },
  });

  return c.json({ message: "alert created succesfully" });
}

export async function getAlerts(
  c: Context<{ Bindings: { DATABASE_URL: string } }>,
) {
  const prisma = getPrisma(c.env.DATABASE_URL);
  const alerts = await prisma.alert.findMany();
  return c.json(alerts);
}

export async function deleteAlert(
  c: Context<{ Bindings: { DATABASE_URL: string } }>,
) {
  const prisma = getPrisma(c.env.DATABASE_URL);
  const { userEmail } = await c.req.json();
  await prisma.alert.delete({ where: { userEmail } });
  return c.json({ message: "Alert deleted successfully" });
}

export async function updateAlert(
  c: Context<{ Bindings: { DATABASE_URL: string } }>,
) {
  const prisma = getPrisma(c.env.DATABASE_URL);
  const { userEmail, mint, type, comparison, threshold } = await c.req.json();
  await prisma.alert.update({
    where: { userEmail },
    data: { mint, parameter: type, comparison, threshold },
  });
  return c.json({ message: "Alert updated successfully" });
}

export async function getAlertByUserEmail(
  c: Context<{ Bindings: { DATABASE_URL: string } }>,
) {
  const prisma = getPrisma(c.env.DATABASE_URL);
  const { userEmail } = await c.req.json();
  const alert = await prisma.alert.findFirst({ where: { userEmail } });
  return c.json(alert);
}

export async function getAlertByMint(
  c: Context<{ Bindings: { DATABASE_URL: string } }>,
) {
  const prisma = getPrisma(c.env.DATABASE_URL);
  const { mint } = await c.req.json();
  const alert = await prisma.alert.findFirst({ where: { mint } });
  return c.json(alert);
}

// model Alert {
//     id          String    @id @default(cuid()) // Unique ID for the alert
//     userEmail   String // Email address to send notification to
//     mint        String    @db.Text // The specific token mint address the alert monitors
//     parameter   String // The field to monitor (e.g., "totalMarketLiquidity", "price")
//     comparison  String // How to compare? e.g., "GREATER_THAN", "LESS_THAN", "EQUALS"
//     threshold   Float // The value to compare against
//     isActive    Boolean   @default(true) // Is the alert currently active?
//     triggeredAt DateTime? // Timestamp when the alert condition was last met and notification sent
//     createdAt   DateTime  @default(now())
//     updatedAt   DateTime  @updatedAt

//     // Constraint: Enforce only one active alert per userEmail for the MVP
//     @@unique([userEmail], name: "unique_active_alert_per_user")
//     // Index to efficiently find active, untriggered alerts for a specific mint and parameter
//     @@index([mint, parameter, isActive, triggeredAt])
// }

