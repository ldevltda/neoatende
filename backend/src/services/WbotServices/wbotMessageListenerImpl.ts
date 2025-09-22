// backend/src/services/WbotServices/wbotMessageListenerImpl.ts
import { proto, WAMessage } from "baileys";
import Message from "../../models/Message";
import UpdateAckByMessageId from "../MessageServices/UpdateAckByMessageId";
import { getIO } from "../../libs/socket";
import { handleMessage } from "./listeners/handleMessage";
import { logger } from "../../utils/logger";
import Sentry from "@sentry/node";

type Session = any;

interface ImessageUpsert {
  messages: proto.IWebMessageInfo[];
  type: any;
}

const filterMessages = (msg: WAMessage): boolean => {
  if (msg.message?.protocolMessage) return false;

  const { WAMessageStubType } = require("baileys");
  if (
    [
      WAMessageStubType.REVOKE,
      WAMessageStubType.E2E_DEVICE_CHANGED,
      WAMessageStubType.E2E_IDENTITY_CHANGED,
      WAMessageStubType.CIPHERTEXT
    ].includes(msg.messageStubType)
  ) {
    return false;
  }

  return true;
};

export const wbotMessageListener = async (
  wbot: Session,
  companyId: number
): Promise<void> => {
  try {
    wbot.ev.on("messages.upsert", async (messageUpsert: ImessageUpsert) => {
      const messages = messageUpsert.messages.filter(filterMessages);

      if (!messages?.length) return;

      for (const message of messages) {
        const messageExists = await Message.count({
          where: { waId: message.key.id!, companyId }
        });

        if (!messageExists) {
          try {
            await handleMessage(message as any, wbot, companyId);
            await verifyCampaignMessageAndCloseTicket(message as any, companyId);
          } catch (err) {
            console.error("error handling message inside upsert loop", err);
            Sentry.captureException(err);
          }
        }
      }
    });

    // ack updates
    wbot.ev.on("messages.update", (updates: any[]) => {
      try {
        for (const u of updates) {
          const id = u?.key?.id;
          if (!id) continue;

          const userReceipts = (u as any)?.update?.userReceipt || (u as any)?.userReceipt || [];
          for (const r of userReceipts) {
            const type = String(r?.type || "").toLowerCase();
            if (type === "delivery" || type === "delivered") {
              UpdateAckByMessageId({ id, ack: 2 }).catch(() => {});
            } else if (type === "read") {
              UpdateAckByMessageId({ id, ack: 3 }).catch(() => {});
            } else if (type === "played") {
              UpdateAckByMessageId({ id, ack: 4 }).catch(() => {});
            }
          }

          if ((u as any)?.update?.played === true || (u as any)?.played === true) {
            UpdateAckByMessageId({ id, ack: 4 }).catch(() => {});
          }
        }
      } catch (e) {
        console.log("messages.update ack patch error:", e);
      }
    });

    wbot.ev.on("message-receipt.update", (receipts: any[]) => {
      try {
        for (const rec of receipts as any[]) {
          const id = rec?.key?.id || rec?.id;
          if (!id) continue;

          const type = String(rec?.type || rec?.event || "").toLowerCase();

          if (type === "delivery" || type === "delivered") {
            UpdateAckByMessageId({ id, ack: 2 }).catch(() => {});
          } else if (type === "read") {
            UpdateAckByMessageId({ id, ack: 3 }).catch(() => {});
          } else if (type === "played") {
            UpdateAckByMessageId({ id, ack: 4 }).catch(() => {});
          }
        }
      } catch (e) {
        console.log("message-receipt.update ack patch error:", e);
      }
    });
  } catch (error) {
    Sentry.captureException(error);
    logger.error(`Error handling wbot message listener. Err: ${error}`);
  }
};

async function verifyCampaignMessageAndCloseTicket(
  message: proto.IWebMessageInfo,
  companyId: number
) {
  // ✅ corrigido: nada de `.then` em cima do módulo
  const { getBodyMessage } = await import("./listeners/messageHelpers");
  const b = getBodyMessage(message as any);

  const isCampaign = /\u200c/.test(b || "");
  if (message.key.fromMe && isCampaign) {
    const messageRecord = await Message.findOne({
      where: { waId: message.key.id!, companyId }
    });
    if (!messageRecord) return;

    const TicketModel = (await import("../../models/Ticket")).default;
    const ticket = await TicketModel.findByPk(messageRecord.ticketId);
    if (!ticket) return;

    await ticket.update({ status: "closed" });

    const io = getIO();
    io.to(`company-${ticket.companyId}-open`)
      .to(`queue-${ticket.queueId}-open`)
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "delete",
        ticket,
        ticketId: ticket.id
      });

    io.to(`company-${ticket.companyId}-${ticket.status}`)
      .to(`queue-${ticket.queueId}-${ticket.status}`)
      .to(ticket.id.toString())
      .emit(`company-${ticket.companyId}-ticket`, {
        action: "update",
        ticket,
        ticketId: ticket.id
      });
  }
}
