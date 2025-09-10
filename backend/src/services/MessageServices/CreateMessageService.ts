import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";

export interface MessageData {
  id: string;
  ticketId: number;
  body: string;
  contactId?: number | null;
  fromMe?: boolean;
  read?: boolean;
  mediaType?: string | null;
  mediaUrl?: string | null;
  ack?: number;
  queueId?: number | null;
  quotedMsgId?: string | null;
  remoteJid?: string | null;
  dataJson?: string | null;
  isDeleted?: boolean;
  isEdited?: boolean;
}

interface Request {
  companyId: number;
  messageData: MessageData;
}

const CreateMessageService = async ({
  companyId,
  messageData
}: Request): Promise<Message> => {
  // 1) cria “seco” + defaults
  const payload: any = {
    ...messageData,
    companyId,                          // <- garante sempre
    fromMe: messageData.fromMe ?? false,
    read: messageData.read ?? false,
    ack: messageData.ack ?? 0,
    mediaType: messageData.mediaType ?? "chat",
    isDeleted: messageData.isDeleted ?? false,
    isEdited: messageData.isEdited ?? false
  };

  const message = await Message.create(payload);

  // 2) pega o ticket separadamente (com o que a UI precisa)
  const ticket = await Ticket.findByPk(message.ticketId, {
    include: ["contact", "whatsapp", "queue"] as any
  });

  // 3) emite sockets esperados pela UI
  const io = getIO();
  io.to(message.ticketId.toString())
    .to(`company-${companyId}-appMessage`)
    .emit(`company-${companyId}-appMessage`, {
      action: "create",
      message,              // Sequelize instance serializa ok
      ticket,               // a UI usa em alguns pontos
      contact: ticket?.contact
    });

  return message;
};

export default CreateMessageService;
