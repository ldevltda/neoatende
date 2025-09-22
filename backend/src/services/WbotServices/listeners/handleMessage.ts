// handleMessage.ts
import { proto, WAMessage } from "baileys";
import { isNil, head } from "lodash";
import { getBodyMessage, getTypeMessage } from "./messageHelpers"
import { downloadMedia, verifyMediaMessage, verifyMessage } from "./mediaHelpers";
import { verifyQueue } from "./handleQueue";
import { handleChartbot } from "./handleChartbot";
import { handleMessageIntegration } from "./handleIntegration";
import { handleOpenAi } from "./handleOpenAi";
import { verifyRating, handleRating } from "./handleRating";
import { ActionsWebhookService } from "../../WebhookService/ActionsWebhookService";
import { getIO } from "../../../libs/socket";
import FindOrCreateTicketService from "../../TicketServices/FindOrCreateTicketService";
import ShowWhatsAppService from "../../WhatsappService/ShowWhatsAppService";
import CreateOrUpdateContactService from "../../ContactServices/CreateOrUpdateContactService";
import Setting from "../../../models/Setting";
import Message from "../../../models/Message";
import Ticket from "../../../models/Ticket";
import Queue from "../../../models/Queue";
import User from "../../../models/User";
import TicketTraking from "../../../models/TicketTraking";
import FindOrCreateATicketTrakingService from "../../TicketServices/FindOrCreateATicketTrakingService";
import UpdateTicketService from "../../TicketServices/UpdateTicketService";
import { provider } from "../providers";
import { cacheLayer } from "../../../libs/cache";
import { debounce } from "../../../helpers/Debounce";
import { FlowBuilderModel } from "../../../models/FlowBuilder";
import VerifyCurrentSchedule from "../../CompanyService/VerifyCurrentSchedule";
import { logger } from "../../../utils/logger";
import formatBody from "../../../helpers/Mustache";

export const handleMessage = async (
  msg: proto.IWebMessageInfo,
  wbot: any,
  companyId: number
): Promise<void> => {
  let mediaSent: Message | undefined;

  try {
    const bodyPreview = (getBodyMessage(msg) || "").toString().slice(0, 160);
    const waId = msg?.key?.id;
    const remote = msg?.key?.remoteJid;
    logger.info({ ctx: "MsgRouter", step: "incoming", waId, remote, bodyPreview }, "WA message received");

    let msgContact: any;
    let groupContact: any;

    const isGroup = msg.key.remoteJid?.endsWith("@g.us");

    const msgIsGroupBlock = await Setting.findOne({
      where: {
        companyId,
        key: "CheckMsgIsGroup"
      }
    });

    const bodyMessage = getBodyMessage(msg);
    const msgType = getTypeMessage(msg);

    const hasMedia =
      msg.message?.audioMessage ||
      msg.message?.imageMessage ||
      msg.message?.videoMessage ||
      msg.message?.documentMessage ||
      msg.message?.documentWithCaptionMessage ||
      msg.message.stickerMessage;

    const getContactMessage = async () => {
      const isGroup = msg.key.remoteJid.includes("g.us");
      const rawNumber = msg.key.remoteJid.replace(/\D/g, "");
      if (isGroup) {
        const contacto = { id: (msg.participant || msg.key.participant || msg.key.remoteJid), name: msg.pushName };
        return { id: contacto.id, name: contacto.name };
      } else {
        return { id: msg.key.remoteJid, name: msg.key.fromMe ? rawNumber : msg.pushName };
      }
    };

    if (msg.key.fromMe) {
      if (/\u200e/.test(bodyMessage)) return;
      if (!hasMedia && msgType !== "conversation" && msgType !== "extendedTextMessage" && msgType !== "vcard") return;
      msgContact = await getContactMessage();
    } else {
      msgContact = await getContactMessage();
    }

    if (msgIsGroupBlock?.value === "enabled" && isGroup) return;

    if (isGroup) {
      const grupoMeta = await wbot.groupMetadata(msg.key.remoteJid);

      // monte o payload no formato que o service espera
      const groupReq = {
        name: grupoMeta.subject,
        number: (grupoMeta.id || msg.key.remoteJid).replace(/\D/g, ""), // qualquer número está ok para identificar o grupo
        isGroup: true,
        companyId,
        whatsappId: wbot.id
      };

      groupContact = await CreateOrUpdateContactService(groupReq);
    }

    const whatsapp = await ShowWhatsAppService(wbot.id!, companyId);
    const contact = await CreateOrUpdateContactService({
      name: msgContact?.name || msgContact.id.replace(/\D/g, ""),
      number: msgContact.id.replace(/\D/g, ""),
      profilePicUrl: await wbot.profilePictureUrl(msgContact.id).catch(()=>process.env.FRONTEND_URL + "/nopicture.png"),
      isGroup: msgContact.id.includes("g.us"),
      companyId,
      whatsappId: wbot.id
    });

    let unreadMessages = 0;

    if (msg.key.fromMe) {
      await cacheLayer.set(`contacts:${contact.id}:unreads`, "0");
    } else {
      const unreads = await cacheLayer.get(`contacts:${contact.id}:unreads`);
      unreadMessages = +unreads + 1;
      await cacheLayer.set(`contacts:${contact.id}:unreads`, `${unreadMessages}`);
    }

    const lastMessage = await Message.findOne({
      where: { contactId: contact.id, companyId },
      order: [["createdAt", "DESC"]]
    });

    if (
      unreadMessages === 0 &&
      whatsapp.complationMessage &&
      formatBody(whatsapp.complationMessage, contact).trim().toLowerCase() ===
        lastMessage?.body.trim().toLowerCase()
    ) {
      return;
    }

    const ticket = await FindOrCreateTicketService(
      contact,
      wbot.id!,
      unreadMessages,
      companyId,
      groupContact
    );

    await provider(ticket, msg, companyId, contact, wbot as any);

    if (bodyMessage == "#") {
      await ticket.update({
        queueOptionId: null,
        chatbot: false,
        queueId: null
      });
      await verifyQueue(wbot, msg, ticket, ticket.contact);
      return;
    }

    const ticketTraking = await FindOrCreateATicketTrakingService({
      ticketId: ticket.id,
      companyId,
      whatsappId: whatsapp?.id
    });

    try {
      if (!msg.key.fromMe) {
        if (ticketTraking !== null && verifyRating(ticketTraking)) {
          await handleRating(parseFloat(bodyMessage || "0"), ticket, ticketTraking);
          return;
        }
      }
    } catch (e) {
      console.error(e);
    }

    try {
      await ticket.update({ fromMe: msg.key.fromMe });
    } catch (e) {
      console.error(e);
    }

    if (hasMedia) {
      mediaSent = await verifyMediaMessage(msg as any, ticket, contact);
    } else {
      await verifyMessage(msg as any, ticket, contact);
    }

    const currentSchedule = await VerifyCurrentSchedule(companyId);
    const scheduleType = await Setting.findOne({ where: { companyId, key: "scheduleType" } });

    try {
      if (!msg.key.fromMe && scheduleType) {
        if (
          scheduleType.value === "company" &&
          !isNil(currentSchedule) &&
          (!currentSchedule || currentSchedule.inActivity === false)
        ) {
          const body = `\u200e ${whatsapp.outOfHoursMessage}`;

          const debouncedSentMessage = debounce(
            async () => {
              await wbot.sendMessage(`${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, { text: body });
            },
            3000,
            ticket.id
          );
          debouncedSentMessage();
          return;
        }

        if (scheduleType.value === "queue" && ticket.queueId !== null) {
          const queue = await Queue.findByPk(ticket.queueId);
          const { schedules }: any = queue;
          const now = new Date();
          const weekday = (now as any).toLocaleString("en-US", { weekday: "long" }).toLowerCase();
          let schedule = null;

          if (Array.isArray(schedules) && schedules.length > 0) {
            schedule = schedules.find(
              (s: any) =>
                s.weekdayEn === weekday &&
                s.startTime !== "" &&
                s.startTime !== null &&
                s.endTime !== "" &&
                s.endTime !== null
            );
          }

          if (
            scheduleType.value === "queue" &&
            queue.outOfHoursMessage !== null &&
            queue.outOfHoursMessage !== "" &&
            !isNil(schedule)
          ) {
            const startTime = schedule.startTime;
            const endTime = schedule.endTime;

            if (now < new Date(startTime) || now > new Date(endTime)) {
              const body = `${queue.outOfHoursMessage}`;
              const debouncedSentMessage = debounce(
                async () => {
                  await wbot.sendMessage(`${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, { text: body });
                },
                3000,
                ticket.id
              );
              debouncedSentMessage();
              return;
            }
          }
        }
      }
    } catch (e) {
      console.error(e);
    }

    const flow = await FlowBuilderModel.findOne({
      where: { id: ticket.flowStopped }
    });

    let isMenu = false;
    let isOpenai = false;
    let isQuestion = false;

    if (flow) {
      const node = (flow.flow["nodes"] || []).find((node: any) => node.id === ticket.lastFlowId);
      isMenu = node?.type === "menu";
      isOpenai = node?.type === "openai";
      isQuestion = node?.type === "question";
    }

    if (!isNil(flow) && isQuestion && !msg.key.fromMe) {
      const body = getBodyMessage(msg);
      if (body) {
        const nodes: any[] = flow.flow["nodes"];
        const nodeSelected = flow.flow["nodes"].find((node: any) => node.id === ticket.lastFlowId);
        const connections: any[] = flow.flow["connections"];

        const { message, answerKey } = nodeSelected.data.typebotIntegration;
        const nodeIndex = nodes.findIndex(node => node.id === nodeSelected.id);
        const lastFlowId = nodes[nodeIndex + 1].id;
        await ticket.update({
          lastFlowId: lastFlowId,
          dataWebhook: { variables: { [answerKey]: body } }
        });
        await ticket.save();

        const mountDataContact = { number: contact.number, name: contact.name, email: contact.email };
        await ActionsWebhookService(
          whatsapp.id,
          parseInt(ticket.flowStopped),
          ticket.companyId,
          nodes,
          connections,
          lastFlowId,
          null,
          "",
          "",
          "",
          ticket.id,
          mountDataContact,
          msg
        );
      }
      return;
    }

    if (isOpenai && !isNil(flow) && !ticket.queue) {
      const nodeSelected = flow.flow["nodes"].find((node: any) => node.id === ticket.lastFlowId);
      let {
        name,
        prompt,
        voice,
        voiceKey,
        voiceRegion,
        maxTokens,
        temperature,
        apiKey,
        queueId,
        maxMessages
      } = nodeSelected.data.typebotIntegration;

      let openAiSettings = {
        name,
        prompt,
        voice,
        voiceKey,
        voiceRegion,
        maxTokens: parseInt(maxTokens),
        temperature: parseInt(temperature),
        apiKey,
        queueId: parseInt(queueId),
        maxMessages: parseInt(maxMessages)
      };

      await handleOpenAi(msg, wbot, ticket, ticket.contact, mediaSent, ticketTraking, openAiSettings);
      return;
    }

    // openai connection-level
    if (!ticket.queue && !isGroup && !msg.key.fromMe && !ticket.userId && !isNil(whatsapp.promptId)) {
      await handleOpenAi(msg, wbot, ticket, ticket.contact, mediaSent, ticketTraking, undefined);
    }

    // integration at connection
    if (!msg.key.fromMe && !ticket.isGroup && !ticket.queue && !ticket.user && ticket.chatbot && !isNil(whatsapp.integrationId) && !ticket.useIntegration) {
      const integrations = await (await import("../../QueueIntegrationServices/ShowQueueIntegrationService")).default(whatsapp.integrationId, companyId);
      await handleMessageIntegration(msg, wbot, integrations, ticket, companyId, isMenu);
      return;
    }

    if (!isGroup && !msg.key.fromMe && !ticket.userId && !isNil(ticket.promptId) && ticket.useIntegration && ticket.queueId) {
      await handleOpenAi(msg, wbot, ticket, ticket.contact, mediaSent, ticketTraking, undefined);
    }

    if (!msg.key.fromMe && !ticket.isGroup && !ticket.userId && ticket.integrationId && ticket.useIntegration && ticket.queue) {
      const integrations = await (await import("../../QueueIntegrationServices/ShowQueueIntegrationService")).default(ticket.integrationId, companyId);
      const isFirstMsg = await Ticket.findOne({
        where: {
          contactId: groupContact ? groupContact.id : contact.id,
          companyId,
          whatsappId: whatsapp.id
        },
        order: [["id", "DESC"]]
      });

      await handleMessageIntegration(msg, wbot, integrations, ticket, companyId, isMenu, whatsapp, contact, isFirstMsg);
    }

    if (!ticket.queue && !ticket.isGroup && !msg.key.fromMe && !ticket.userId && whatsapp.queues.length >= 1 && !ticket.useIntegration) {
      await verifyQueue(wbot, msg, ticket, contact);

      if (ticketTraking && ticketTraking.chatbotAt === null) {
        await ticketTraking.update({ chatbotAt: new Date() });
      }
    }

    const isFirstMsg = await Ticket.findOne({
      where: {
        contactId: groupContact ? groupContact.id : contact.id,
        companyId,
        whatsappId: whatsapp.id
      },
      order: [["id", "DESC"]]
    });

    if (!msg.key.fromMe && !ticket.isGroup && !ticket.queue && !ticket.user && !isNil(whatsapp.integrationId) && !ticket.useIntegration) {
      const integrations = await (await import("../../QueueIntegrationServices/ShowQueueIntegrationService")).default(whatsapp.integrationId, companyId);
      await handleMessageIntegration(msg, wbot, integrations, ticket, companyId, isMenu, whatsapp, contact, isFirstMsg);
    }

    const dontReadTheFirstQuestion = ticket.queue === null;

    await ticket.reload();

    try {
      if (!msg.key.fromMe && scheduleType && ticket.queueId !== null) {
        const queue = await Queue.findByPk(ticket.queueId);
        const { schedules }: any = queue;
        const now = new Date();
        const weekday = (now as any).toLocaleString("en-US", { weekday: "long" }).toLowerCase();
        let schedule = null;

        if (Array.isArray(schedules) && schedules.length > 0) {
          schedule = schedules.find(
            (s: any) =>
              s.weekdayEn === weekday &&
              s.startTime !== "" &&
              s.startTime !== null &&
              s.endTime !== "" &&
              s.endTime !== null
          );
        }

        if (
          scheduleType.value === "queue" &&
          queue.outOfHoursMessage !== null &&
          queue.outOfHoursMessage !== "" &&
          !isNil(schedule)
        ) {
          const body = queue.outOfHoursMessage;
          const debouncedSentMessage = debounce(
            async () => {
              await wbot.sendMessage(`${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, { text: body });
            },
            3000,
            ticket.id
          );
          debouncedSentMessage();
          return;
        }
      }
    } catch (e) {
      console.error(e);
    }

    if (!whatsapp?.queues?.length && !ticket.userId && !isGroup && !msg.key.fromMe) {
      const lastMessage = await Message.findOne({
        where: { ticketId: ticket.id, fromMe: true },
        order: [["createdAt", "DESC"]]
      });

      if (lastMessage && lastMessage.body.includes(whatsapp.greetingMessage)) {
        return;
      }

      if (whatsapp.greetingMessage) {
        const debouncedSentMessage = debounce(
          async () => {
            await wbot.sendMessage(`${ticket.contact.number}@${ticket.isGroup ? "g.us" : "s.whatsapp.net"}`, { text: whatsapp.greetingMessage });
          },
          1000,
          ticket.id
        );
        debouncedSentMessage();
        return;
      }
    }

    if (whatsapp.queues.length == 1 && ticket.queue) {
      if (ticket.chatbot && !msg.key.fromMe) {
        await handleChartbot(ticket, msg, wbot);
      }
    }

    if (whatsapp.queues.length > 1 && ticket.queue) {
      if (ticket.chatbot && !msg.key.fromMe) {
        await handleChartbot(ticket, msg, wbot, dontReadTheFirstQuestion);
      }
    }

  } catch (err) {
    console.error(err);
  }
};
