// backend/src/services/MessageServices/CreateMessageService.ts
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
import { getIO } from "../../libs/socket";

interface CreateMessageDTO {
  messageData: {
    id: string;
    ticketId: number;
    contactId?: number;
    body: string | null;
    fromMe: boolean;
    read: boolean;
    mediaType?: string | null;
    mediaUrl?: string | null;      // <== garantimos que existe
    quotedMsgId?: string | null;
    ack?: number | null;
    remoteJid?: string | null;
    participant?: string | null;
    dataJson?: string | null;
    isEdited?: boolean | null;
    ticketTrakingId?: number | null;
  };
  companyId: number;               // <== garantimos que vai para o DB
}

const CreateMessageService = async ({
  messageData,
  companyId
}: CreateMessageDTO) => {
  const io = getIO();

  // LOGS de diagnóstico (remova depois)
  console.log("[CreateMessageService] about to insert", {
    ...messageData,
    companyId
  });

  try {
    // Campos obrigatórios que costumam causar rollback se vierem undefined
    const payload = {
      id: messageData.id,
      ticketId: messageData.ticketId,
      companyId, // <== não esqueça de persistir
      contactId: messageData.contactId ?? null,
      body: messageData.body ?? null,
      fromMe: !!messageData.fromMe,
      read: !!messageData.read,
      mediaType: messageData.mediaType ?? null,
      mediaUrl: messageData.mediaUrl ?? null, // <== se usa media, precisa existir no modelo
      quotedMsgId: messageData.quotedMsgId ?? null,
      ack: messageData.ack ?? 0,
      remoteJid: messageData.remoteJid ?? null,
      participant: messageData.participant ?? null,
      dataJson: messageData.dataJson ?? null,
      isEdited: messageData.isEdited ?? false,
      ticketTrakingId: messageData.ticketTrakingId ?? null
    };

    const message = await Message.create(payload);

    // carrega relacionamentos que o front usa
    await message.reload({
      include: [
        { model: Ticket, as: "ticket" },
        { model: Message, as: "quotedMsg", include: [{ model: Contact, as: "contact" }] },
        { model: Contact, as: "contact" }
      ]
    });

    // Emite no mesmo padrão que o front escuta
    io.to(message.ticketId.toString()).emit(
      `company-${companyId}-appMessage`,
      { action: "create", message }
    );

    console.log("[CreateMessageService] inserted id:", message.id);
    return message;
  } catch (err) {
    console.error("[CreateMessageService] INSERT FAILED:", err);
    throw err; // não silencie — deixe estourar 500 se der ruim
  }
};

export default CreateMessageService;
