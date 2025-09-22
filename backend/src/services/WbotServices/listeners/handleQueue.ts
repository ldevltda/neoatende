// backend/src/services/WbotServices/listeners/handleQueue.ts
import ShowWhatsAppService from "../../WhatsappService/ShowWhatsAppService";
import Setting from "../../../models/Setting";
import Queue from "../../../models/Queue";
import QueueOption from "../../../models/QueueOption";
import UpdateTicketService from "../../TicketServices/UpdateTicketService";
import formatBody from "../../../helpers/Mustache";
import SendWhatsAppMessage from "../SendWhatsAppMessage";
import FindOrCreateATicketTrakingService from "../../TicketServices/FindOrCreateATicketTrakingService";
import { debounce } from "../../../helpers/Debounce";
import ShowQueueIntegrationService from "../../QueueIntegrationServices/ShowQueueIntegrationService";
import { getIO } from "../../../libs/socket";
import User from "../../../models/User";
import { isNil } from "lodash";
import { handleMessageIntegration } from "./handleIntegration";
import { getBodyMessage } from "./messageHelpers";
import { verifyMessage } from "./mediaHelpers";

export const verifyQueue = async (
  wbot: any,
  msg: any,
  ticket: any,
  contact: any,
  mediaSent?: any
) => {
  const companyId = ticket.companyId;

  const { queues, greetingMessage, maxUseBotQueues, timeUseBotQueues } =
    await ShowWhatsAppService(wbot.id!, ticket.companyId);

  // ====== ÚNICA FILA ======
  if (queues.length === 1) {
    const sendGreetingMessageOneQueues = await Setting.findOne({
      where: {
        key: "sendGreetingMessageOneQueues",
        companyId: ticket.companyId
      }
    });

    if (greetingMessage.length > 1 && sendGreetingMessageOneQueues?.value === "enabled") {
      const body = formatBody(`${greetingMessage}`, contact);
      await wbot.sendMessage(
        `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
        { text: body }
      );
    }

    const firstQueue = queues[0];
    const chatbot = Array.isArray(firstQueue?.options) && firstQueue.options.length > 0;

    // integração na conexão (fila única)
    if (!msg.key.fromMe && !ticket.isGroup && !isNil(queues[0]?.integrationId)) {
      const integrations = await ShowQueueIntegrationService(
        queues[0].integrationId,
        companyId
      );

      await handleMessageIntegration(msg, wbot, integrations, ticket, companyId);

      await ticket.update({
        useIntegration: true,
        integrationId: integrations.id
      });
    }

    // prompt/OpenAI por fila
    if (!msg.key.fromMe && !ticket.isGroup && !isNil(queues[0]?.promptId)) {
      await ticket.update({
        useIntegration: true,
        promptId: queues[0]?.promptId
      });
    }

    await UpdateTicketService({
      ticketData: { queueId: firstQueue.id, chatbot, status: "pending" },
      ticketId: ticket.id,
      companyId: ticket.companyId
    });

    return;
  }

  // ====== MENU DE FILAS ======
  // texto da mensagem recebido
  const bodyStr = (getBodyMessage(msg) || "").toString().trim();
  // tenta interpretá-lo como número de opção
  const idx = Number(bodyStr) || 0;
  const choosenQueue = queues[idx - 1];

  const buttonActive = await Setting.findOne({
    where: { key: "chatBotType", companyId }
  });

  const botText = async () => {
    let options = "";
    queues.forEach((queue, index) => {
      options += `*[ ${index + 1} ]* - ${queue.name}\n`;
    });

    const textMessage = {
      text: formatBody(`\u200e${greetingMessage}\n\n${options}`, contact)
    };

    const sendMsg = await wbot.sendMessage(
      `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
      textMessage
    );

    // registra mensagem no sistema
    if (verifyMessage) {
      await verifyMessage(sendMsg, ticket, ticket.contact);
    }
  };

  if (choosenQueue) {
    const chatbot = Array.isArray(choosenQueue?.options) && choosenQueue.options.length > 0;

    await UpdateTicketService({
      ticketData: { queueId: choosenQueue.id, chatbot },
      ticketId: ticket.id,
      companyId: ticket.companyId
    });

    // fila sem opções => só cumprimenta/integração/horário
    if (choosenQueue.options.length === 0) {
      const queue = await Queue.findByPk(choosenQueue.id);
      const { schedules }: any = queue;
      const now = new Date();
      const weekday = (now as any).toLocaleString("en-US", { weekday: "long" }).toLowerCase();

      let schedule: any = null;
      if (Array.isArray(schedules) && schedules.length > 0) {
        schedule = schedules.find(
          (s: any) =>
            s.weekdayEn === weekday &&
            s.startTime &&
            s.endTime
        );
      }

      // fora de horário
      if (queue.outOfHoursMessage && !isNil(schedule)) {
        const body = formatBody(
          `\u200e ${queue.outOfHoursMessage}\n\n*[ # ]* - Voltar ao Menu Principal`,
          ticket.contact
        );
        const sentMessage = await wbot.sendMessage(
          `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          { text: body }
        );
        if (verifyMessage) await verifyMessage(sentMessage, ticket, contact);

        await UpdateTicketService({
          ticketData: { queueId: null, chatbot },
          ticketId: ticket.id,
          companyId: ticket.companyId
        });
        return;
      }

      // integração por fila
      if (!msg.key.fromMe && !ticket.isGroup && choosenQueue.integrationId) {
        const integrations = await ShowQueueIntegrationService(
          choosenQueue.integrationId,
          companyId
        );

        await handleMessageIntegration(msg, wbot, integrations, ticket, companyId);

        await ticket.update({
          useIntegration: true,
          integrationId: integrations.id
        });
      }

      // prompt/OpenAI por fila
      if (!msg.key.fromMe && !ticket.isGroup && !isNil(choosenQueue?.promptId)) {
        await ticket.update({
          useIntegration: true,
          promptId: choosenQueue?.promptId
        });
      }

      // mensagem de saudação da fila
      if (choosenQueue.greetingMessage) {
        const body = formatBody(`\u200e${choosenQueue.greetingMessage}`, ticket.contact);
        const sentMessage = await wbot.sendMessage(
          `${contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`,
          { text: body }
        );
        if (verifyMessage) await verifyMessage(sentMessage, ticket, contact);
      }
    }
  } else {
    // nenhuma fila escolhida => mostra o menu (com limites/tempo)
    if (
      maxUseBotQueues &&
      maxUseBotQueues !== 0 &&
      ticket.amountUsedBotQueues >= maxUseBotQueues
    ) {
      return;
    }

    const ticketTraking = await FindOrCreateATicketTrakingService({
      ticketId: ticket.id,
      companyId
    });

    let dataLimite = new Date();
    const Agora = new Date();

    if (ticketTraking.chatbotAt !== null) {
      dataLimite.setMinutes(
        ticketTraking.chatbotAt.getMinutes() + Number(timeUseBotQueues)
      );

      if (
        ticketTraking.chatbotAt !== null &&
        Agora < dataLimite &&
        timeUseBotQueues !== "0" &&
        ticket.amountUsedBotQueues !== 0
      ) {
        return;
      }
    }

    await ticketTraking.update({ chatbotAt: null });

    if (buttonActive?.value === "text") {
      return botText();
    }
  }
};
