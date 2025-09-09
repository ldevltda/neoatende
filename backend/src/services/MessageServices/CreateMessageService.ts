import { getIO } from "../../libs/socket";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";

export interface MessageData {
  // chaves mínimas
  id: string;
  ticketId: number;
  body: string;

  // já existentes no seu listener
  contactId?: number;
  fromMe?: boolean;
  read?: boolean;
  mediaType?: string;
  mediaUrl?: string;
  ack?: number;

  // campos adicionais que o listener envia
  remoteJid?: string | null;
  participant?: string | null;
  dataJson?: string | null;
  isEdited?: boolean;
  quotedMsgId?: string | number | null;
  ticketTrakingId?: number | null;

  // opcionalmente o queueId pode vir setado
  queueId?: number | null;
}

interface Request {
  messageData: MessageData;
  companyId: number;
}

const CreateMessageService = async ({
  messageData,
  companyId
}: Request): Promise<Message> => {
  // faz upsert com todos os campos que chegaram
  await Message.upsert({ ...messageData, companyId });

  // busca a mensagem enriquecida para emitir via socket
  const message = await Message.findByPk(messageData.id, {
    include: [
      "contact",
      {
        model: Ticket,
        as: "ticket",
        include: [
          "contact",
          "queue",
          {
            model: Whatsapp,
            as: "whatsapp",
            attributes: ["name"]
          }
        ]
      },
      {
        model: Message,
        as: "quotedMsg",
        include: ["contact"]
      }
    ]
  });

  if (!message) {
    throw new Error("ERR_CREATING_MESSAGE");
  }

  // se a mensagem ainda não tem queueId, herda da queue do ticket
  if (message.ticket?.queueId != null && message.queueId == null) {
    await message.update({ queueId: message.ticket.queueId });
  }

  const io = getIO();

  // rooms podem ser nulos — cuidamos para não passar "undefined"
  const ticketStatus = message.ticket?.status ?? "pending";
  const ticketQueueId = message.ticket?.queueId ?? null;

  const emitter = io
    .to(message.ticketId.toString())
    .to(`company-${companyId}-${ticketStatus}`)
    .to(`company-${companyId}-notification`);

  if (ticketQueueId != null) {
    emitter
      .to(`queue-${ticketQueueId}-${ticketStatus}`)
      .to(`queue-${ticketQueueId}-notification`);
  }

  emitter.emit(`company-${companyId}-appMessage`, {
    action: "create",
    message,
    ticket: message.ticket,
    contact: message.ticket?.contact
  });

  return message;
};

export default CreateMessageService;
