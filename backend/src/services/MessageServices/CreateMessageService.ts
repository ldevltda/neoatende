import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";

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
  // defaults seguros
  const payload: any = {
    ...messageData,
    companyId,                   // <-- CRÍTICO: sempre gravar companyId
    fromMe: messageData.fromMe ?? false,
    read: messageData.read ?? false,
    ack: messageData.ack ?? 0,
    mediaType: messageData.mediaType ?? "chat",
    isDeleted: messageData.isDeleted ?? false,
    isEdited: messageData.isEdited ?? false
  };

  // cria e inclui relações necessárias pro socket emitir corretamente
  const message = await Message.create(payload, {
    include: [
      { model: Ticket, as: "ticket" },
      { model: Whatsapp, as: "whatsapp" }
    ]
  });

  // se o ticket tem queue e a msg não veio com queueId, herda
  if (message.ticket?.queueId && !message.queueId) {
    await message.update({ queueId: message.ticket.queueId });
  }

  // emite para a tela de tickets
  const io = getIO();
  io.to(message.ticketId.toString())
    .to(`company-${companyId}-${message.ticket.status}`)
    .to(`company-${companyId}-notification`)
    .to(`queue-${message.ticket.queueId}-${message.ticket.status}`)
    .to(`queue-${message.ticket.queueId}-notification`)
    .emit(`company-${companyId}-appMessage`, {
      action: "create",
      message,
      ticket: message.ticket,
      contact: message.ticket.contact
    });

  return message;
};

export default CreateMessageService;
