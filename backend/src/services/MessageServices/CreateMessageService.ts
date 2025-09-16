import { UniqueConstraintError } from "sequelize";
import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";

export interface MessageData {
  id: string;                 // ainda chega (compat), mas a dedupe será por waId
  waId?: string | null;       // <- novo
  ticketId: number;
  body: string | null;
  contactId?: number | null;
  fromMe?: boolean;
  read?: boolean;
  mediaType?: string | null;
  mediaUrl?: string | null;
  ack?: number | null;
  queueId?: number | null;
  quotedMsgId?: string | null;
  companyId: number;
  isDeleted?: boolean;
  isEdited?: boolean;
  remoteJid?: string | null;
  participant?: string | null;
  dataJson?: string | null;
  ticketTrakingId?: number | null;
}

const CreateMessageService = async (input: MessageData): Promise<Message> => {
  // garante waId (usa key.id por padrão)
  const data = { ...input, waId: input.waId ?? input.id };

  try {
    const msg = await (Message as any).create(data);
    await emitSocket(msg, data.companyId);
    return msg;
  } catch (err: any) {
    if (err instanceof UniqueConstraintError) {
      // idempotência por waId
      const existing = await Message.findOne({ where: { waId: data.waId } });
      if (existing) return existing as Message;
    }
    throw err;
  }
};

async function emitSocket(message: any, companyId: number) {
  const ticket = await Ticket.findByPk(message.ticketId, {
    include: ["contact", "queue", "user"]
  });

  const io = getIO();
  io.to(String(message.ticketId))
    .to(`company-${companyId}-appMessage`)
    .emit(`company-${companyId}-appMessage`, {
      action: "create",
      message,
      ticket,
      contact: ticket?.contact
    });
}

export default CreateMessageService;
