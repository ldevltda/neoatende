// backend/src/services/WbotServices/wbotMonitor.ts
import {
  WASocket,
  BinaryNode,
  Contact as BContact,
} from "baileys";
import * as Sentry from "@sentry/node";
import { Op } from "sequelize";
// import { getIO } from "../../libs/socket";
import { Store } from "../../libs/store";
import Contact from "../../models/Contact";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import createOrUpdateBaileysService from "../BaileysServices/CreateOrUpdateBaileysService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import Company from "../../models/Company";

type Session = WASocket & {
  id?: number;
  store?: Store;
};

interface IContact {
  contacts: BContact[];
}

const wbotMonitor = async (
  wbot: Session,
  whatsapp: Whatsapp,
  companyId: number
): Promise<void> => {
  try {
    // Monitor de chamadas (Baileys)
    wbot.ws.on("CB:call", async (node: BinaryNode) => {
      const content: any = node.content?.[0];
      if (!content) return;

      if (content.tag === "offer") {
        // ponto de extensão p/ tratar ofertas de chamada (ringing)
        const { from, id } = node.attrs;
        // noop
      }

      if (content.tag === "terminate") {
        // Verifica configuração para resposta automática de chamadas
        const sendMsgCall = await Setting.findOne({
          where: { key: "call", companyId },
        });

        // Se não houver setting ou não estiver "disabled", não envia texto automático
        if (!sendMsgCall || sendMsgCall.value !== "disabled") return;

        // Idioma da empresa (default pt)
        const company = await Company.findByPk(companyId);
        const lang = (company?.language as "pt" | "en" | "es") ?? "pt";

        const translatedMessage: Record<"pt" | "en" | "es", string> = {
          pt: "*Mensagem Automática:*\n\nAs chamadas de voz e vídeo estão desabilitadas para este WhatsApp. Por favor, envie uma mensagem de texto. Obrigado!",
          en: "*Automatic Message:*\n\nVoice and video calls are disabled for this WhatsApp. Please send a text message. Thank you!",
          es: "*Mensaje Automático:*\n\nLas llamadas de voz y video están deshabilitadas para este WhatsApp. Por favor, envía un mensaje de texto. ¡Gracias!"
        };

        // Envia o aviso para quem ligou
        const toJid = node.attrs.from;
        await wbot.sendMessage(toJid, { text: translatedMessage[lang] });

        // Normaliza número e busca contato
        const number = toJid.replace(/\D/g, "");
        const contact = await Contact.findOne({ where: { companyId, number } });
        if (!contact) return;

        // Busca ticket (se não existir, não registra log de chamada)
        const ticket = await Ticket.findOne({
          where: {
            contactId: contact.id,
            whatsappId: wbot.id,
            companyId
            // status: { [Op.or]: ["close"] },
          },
        });
        if (!ticket) return;

        // Horário estilo HH:MM
        const now = new Date();
        const hh = String(now.getHours()).padStart(2, "0");
        const mm = String(now.getMinutes()).padStart(2, "0");

        const body = `Chamada de voz/vídeo perdida às ${hh}:${mm}`;

        // Monta dados da mensagem (log da chamada)
        const messageData = {
          id: content.attrs?.["call-id"],   // id da chamada
          waId: content.attrs?.["call-id"], // opcionalmente já preenche waId = id
          ticketId: ticket.id,
          contactId: contact.id,
          body,
          fromMe: false,
          mediaType: "call_log" as const,
          read: true,
          quotedMsgId: null as any,
          ack: 1 as const,
          // remoteJid/participant não são essenciais aqui, mas poderiam ser adicionados se desejar:
          // remoteJid: toJid,
          // participant: undefined
        };

        // Atualiza último texto do ticket
        await ticket.update({ lastMessage: body });

        // Reabre se necessário
        if (ticket.status === "closed") {
          await ticket.update({ status: "pending" });
        }

        // >>> CHAMADA CORRETA (alinhada ao mediaHelpers.ts e à interface MessageData):
        await CreateMessageService({ ...messageData, companyId });
      }
    });

    // Upsert de contatos
    wbot.ev.on("contacts.upsert", async (contacts: BContact[]) => {
      await createOrUpdateBaileysService({
        whatsappId: whatsapp.id,
        contacts,
      });
    });

  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }
};

export default wbotMonitor;
