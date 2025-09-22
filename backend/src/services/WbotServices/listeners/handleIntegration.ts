// backend/src/services/WbotServices/listeners/handleIntegration.ts
import request from "request";
import typebotListener from "../../TypebotServices/typebotListener";
import { FlowBuilderModel } from "../../../models/FlowBuilder";
import { FlowCampaignModel } from "../../../models/FlowCampaign";
import { WebhookModel } from "../../../models/Webhook";
import { ActionsWebhookService } from "../../WebhookService/ActionsWebhookService";
import { differenceInMilliseconds } from "date-fns";
import Ticket from "../../../models/Ticket";
import Whatsapp from "../../../models/Whatsapp";
import { IConnections, INodes } from "../../WebhookService/DispatchWebHookService";
import { getBodyMessage } from "./messageHelpers";

export const flowbuilderIntegration = async (
  msg: any,
  wbot: any,
  companyId: number,
  queueIntegration: any,
  ticket: Ticket,
  contact: any,
  isFirstMsg?: Ticket,
  isTranfered?: boolean
) => {
  const quotedMsg = null;

  const bodyStr = getBodyMessage(msg) || "";

  if (!msg.key.fromMe && ticket.status === "closed") {
    await ticket.update({ status: "pending" });
    await ticket.reload({ include: [] });

    await (await import("../../TicketServices/UpdateTicketService")).default({
      ticketData: { status: "pending", integrationId: ticket.integrationId },
      ticketId: ticket.id,
      companyId
    });
  }

  if (msg.key.fromMe) return;

  const whatsapp = await (await import("../../WhatsappService/ShowWhatsAppService")).default(
    wbot.id!,
    companyId
  );

  const listPhrase = await FlowCampaignModel.findAll({
    where: { whatsappId: whatsapp.id }
  });

  // Welcome flow
  if (
    !isFirstMsg &&
    listPhrase.filter(item => item.phrase.toLowerCase() === bodyStr.toLowerCase()).length === 0
  ) {
    const flow = await FlowBuilderModel.findOne({ where: { id: whatsapp.flowIdWelcome } });
    if (flow) {
      const nodes: INodes[] = flow.flow["nodes"];
      const connections: IConnections[] = flow.flow["connections"];

      const mountDataContact = {
        number: contact.number,
        name: contact.name,
        email: contact.email
      };

      await ActionsWebhookService(
        whatsapp.id,
        whatsapp.flowIdWelcome,
        ticket.companyId,
        nodes,
        connections,
        flow.flow["nodes"][0].id,
        null,
        "",
        "",
        null,
        ticket.id,
        mountDataContact,
        msg
      );
    }
  }

  const dateTicket = new Date(isFirstMsg?.updatedAt ? isFirstMsg.updatedAt : "");
  const dateNow = new Date();
  const diferencaEmMilissegundos = Math.abs(differenceInMilliseconds(dateTicket, dateNow));
  const seisHorasEmMilissegundos = 21600000;

  // Not-found phrase flow
  if (
    listPhrase.filter(item => item.phrase.toLowerCase() === bodyStr.toLowerCase()).length === 0 &&
    diferencaEmMilissegundos >= seisHorasEmMilissegundos &&
    isFirstMsg
  ) {
    const flow = await FlowBuilderModel.findOne({ where: { id: whatsapp.flowIdNotPhrase } });
    if (flow) {
      const nodes: INodes[] = flow.flow["nodes"];
      const connections: IConnections[] = flow.flow["connections"];
      const mountDataContact = {
        number: contact.number,
        name: contact.name,
        email: contact.email
      };
      await ActionsWebhookService(
        whatsapp.id,
        whatsapp.flowIdNotPhrase,
        ticket.companyId,
        nodes,
        connections,
        flow.flow["nodes"][0].id,
        null,
        "",
        "",
        null,
        ticket.id,
        mountDataContact,
        msg
      );
    }
  }

  // Campaign trigger by phrase
  if (listPhrase.filter(item => item.phrase.toLowerCase() === bodyStr.toLowerCase()).length !== 0) {
    const flowDispar = listPhrase.filter(
      item => item.phrase.toLowerCase() === bodyStr.toLowerCase()
    )[0];
    const flow = await FlowBuilderModel.findOne({ where: { id: flowDispar.flowId } });
    const nodes: INodes[] = flow.flow["nodes"];
    const connections: IConnections[] = flow.flow["connections"];
    const mountDataContact = {
      number: contact.number,
      name: contact.name,
      email: contact.email
    };
    await ActionsWebhookService(
      whatsapp.id,
      flowDispar.flowId,
      ticket.companyId,
      nodes,
      connections,
      flow.flow["nodes"][0].id,
      null,
      "",
      "",
      null,
      ticket.id,
      mountDataContact
    );
    return;
  }

  // Flow Webhook
  if (ticket.flowWebhook) {
    const webhook = await WebhookModel.findOne({
      where: { company_id: ticket.companyId, hash_id: ticket.hashFlowId }
    });

    if (webhook && webhook.config["details"]) {
      const flow = await FlowBuilderModel.findOne({
        where: { id: webhook.config["details"].idFlow }
      });
      const nodes: INodes[] = flow.flow["nodes"];
      const connections: IConnections[] = flow.flow["connections"];

      await ActionsWebhookService(
        whatsapp.id,
        webhook.config["details"].idFlow,
        ticket.companyId,
        nodes,
        connections,
        ticket.lastFlowId,
        ticket.dataWebhook,
        webhook.config["details"],
        ticket.hashFlowId,
        bodyStr,
        ticket.id
      );
    } else {
      const flow = await FlowBuilderModel.findOne({ where: { id: ticket.flowStopped } });
      const nodes: INodes[] = flow.flow["nodes"];
      const connections: IConnections[] = flow.flow["connections"];
      if (!ticket.lastFlowId) return;

      const mountDataContact = {
        number: contact.number,
        name: contact.name,
        email: contact.email
      };

      await ActionsWebhookService(
        whatsapp.id,
        parseInt(ticket.flowStopped),
        ticket.companyId,
        nodes,
        connections,
        ticket.lastFlowId,
        null,
        "",
        "",
        bodyStr,
        ticket.id,
        mountDataContact,
        msg
      );
    }
  }
};

export const handleMessageIntegration = async (
  msg: any,
  wbot: any,
  queueIntegration: any,
  ticket: any,
  companyId: number,
  isMenu: boolean = null,
  whatsapp: any = null,
  contact: any = null,
  isFirstMsg: any = null
): Promise<void> => {
  if (queueIntegration.type === "n8n" || queueIntegration.type === "webhook") {
    if (queueIntegration?.urlN8N) {
      const options = {
        method: "POST",
        url: queueIntegration?.urlN8N,
        headers: { "Content-Type": "application/json" },
        json: msg
      };
      try {
        request(options, function (error, response) {
          if (error) {
            throw new Error(error as any);
          } else {
            console.log(response.body);
          }
        });
      } catch (error) {
        throw new Error(error as any);
      }
    }
  } else if (queueIntegration.type === "typebot") {
    await typebotListener({ ticket, msg, wbot, typebot: queueIntegration });
  } else if (queueIntegration.type === "flowbuilder") {
    if (!isMenu) {
      await flowbuilderIntegration(msg, wbot, companyId, queueIntegration, ticket, contact, isFirstMsg);
    } else {
      if (!isNaN(parseInt(ticket.lastMessage)) && ticket.status !== "open" && ticket.status !== "closed") {
        await (await import("./handleIntegration")).flowBuilderQueue(
          ticket,
          msg,
          wbot,
          whatsapp,
          companyId,
          contact,
          isFirstMsg
        );
      }
    }
  }
};

export const flowBuilderQueue = async (
  ticket: any,
  msg: any,
  wbot: any,
  whatsapp: any,
  companyId: number,
  contact: any,
  isFirstMsg: any
) => {
  const bodyStr = getBodyMessage(msg) || "";

  const flow = await FlowBuilderModel.findOne({ where: { id: ticket.flowStopped } });
  const mountDataContact = { number: contact.number, name: contact.name, email: contact.email };

  const nodes: INodes[] = flow.flow["nodes"];
  const connections: IConnections[] = flow.flow["connections"];

  if (!ticket.lastFlowId) return;

  if (ticket.status === "closed" || ticket.status === "interrupted" || ticket.status === "open") return;

  await ActionsWebhookService(
    whatsapp.id,
    parseInt(ticket.flowStopped),
    ticket.companyId,
    nodes,
    connections,
    ticket.lastFlowId,
    null,
    "",
    "",
    bodyStr,
    ticket.id,
    mountDataContact,
    msg
  );
};
