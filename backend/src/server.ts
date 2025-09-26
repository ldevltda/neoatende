import dotenv from "dotenv";
dotenv.config();

import gracefulShutdown from "http-graceful-shutdown";
import app from "./app";
import { initIO } from "./libs/socket";
import { logger } from "./utils/logger";
import { StartAllWhatsAppsSessions } from "./services/WbotServices/StartAllWhatsAppsSessions";
import Company from "./models/Company";
import { startQueueProcess } from "./queues";
import { TransferTicketQueue } from "./wbotTransferTicketQueue";
import cron from "node-cron";
import { startLeadFollowupQueue } from "./services/FollowUpService/LeadFollowupQueue";

const port = parseInt(process.env.PORT || "3000", 10);

const server = app.listen(port, "0.0.0.0", async () => {
  try {
    const companies = await Company.findAll();
    const allPromises: any[] = [];

    for (const c of companies) {
      const promise = StartAllWhatsAppsSessions(c.id);
      allPromises.push(promise);
    }

    await Promise.all(allPromises);
    startQueueProcess();
    startLeadFollowupQueue();

    logger.info(`✅ Server started on http://0.0.0.0:${port}`);
  } catch (error) {
    logger.error("❌ Erro ao iniciar servidor:", error);
  }
});

cron.schedule("* * * * *", async () => {
  try {
    logger.info(`⏰ Serviço de transferência de tickets iniciado`);
    await TransferTicketQueue();
  } catch (error) {
    logger.error(error);
  }
});

initIO(server);
gracefulShutdown(server);
