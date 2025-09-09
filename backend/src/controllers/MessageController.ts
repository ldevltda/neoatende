import { Request, Response } from "express";
import AppError from "../errors/AppError";

import SetTicketMessagesAsRead from "../helpers/SetTicketMessagesAsRead";
import { getIO } from "../libs/socket";
import Message from "../models/Message";
import Queue from "../models/Queue";
import User from "../models/User";
import Whatsapp from "../models/Whatsapp";
import formatBody from "../helpers/Mustache";

import ListMessagesService from "../services/MessageServices/ListMessagesService";
import ShowTicketService from "../services/TicketServices/ShowTicketService";
import FindOrCreateTicketService from "../services/TicketServices/FindOrCreateTicketService";
import UpdateTicketService from "../services/TicketServices/UpdateTicketService";
import DeleteWhatsAppMessage from "../services/WbotServices/DeleteWhatsAppMessage";
import SendWhatsAppMedia from "../services/WbotServices/SendWhatsAppMedia";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";
import CheckContactNumber from "../services/WbotServices/CheckNumber";
import CheckIsValidContact from "../services/WbotServices/CheckIsValidContact";
import GetProfilePicUrl from "../services/WbotServices/GetProfilePicUrl";
import CreateOrUpdateContactService from "../services/ContactServices/CreateOrUpdateContactService";

/**
 * Tipos auxiliares
 */
type IndexQuery = {
  pageNumber: string;
};

type MessageData = {
  body: string | string[];     // pode ser array quando subir várias mídias
  fromMe?: boolean;
  read?: boolean;
  quotedMsg?: Message;
  number?: string;             // utilizado no /send por whatsappId
  closeTicket?: true;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { pageNumber } = req.query as IndexQuery;
  const { companyId, profile } = req.user;

  const queues: number[] = [];

  // se não for admin filtra pelas filas do usuário
  if (profile !== "admin") {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Queue, as: "queues" }]
    });
    user?.queues?.forEach(queue => {
      queues.push(queue.id);
    });
  }

  const { count, messages, ticket, hasMore } = await ListMessagesService({
    pageNumber,
    ticketId,
    companyId,
    queues
  });

  await SetTicketMessagesAsRead(ticket);

  return res.json({ count, messages, ticket, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { body, quotedMsg }: MessageData = req.body;
  const medias = req.files as Express.Multer.File[] | undefined;
  const { companyId } = req.user;

  const ticket = await ShowTicketService(ticketId, companyId);

  await SetTicketMessagesAsRead(ticket);

  // Envio de mídia (suporta múltiplas mídias e body em array alinhado)
  if (medias && medias.length > 0) {
    const bodies = Array.isArray(body) ? body : medias.map(() => (body as string) ?? "");

    await Promise.all(
      medias.map(async (media: Express.Multer.File, index) => {
        const thisBody = bodies[index] ?? "";
        await SendWhatsAppMedia({
          media,
          ticket,
          body: thisBody
        });
      })
    );
  } else {
    // Envio de texto
    await SendWhatsAppMessage({
      body: typeof body === "string" ? body : (body?.[0] ?? ""),
      ticket,
      quotedMsg
    });
  }

  return res.send();
};

export const remove = async (req: Request, res: Response): Promise<Response> => {
  const { messageId } = req.params;
  const { companyId } = req.user;

  const message = await DeleteWhatsAppMessage(messageId);

  const io = getIO();
  io.to(message.ticketId.toString()).emit(`company-${companyId}-appMessage`, {
    action: "update",
    message
  });

  return res.send();
};

/**
 * Envio avulso por whatsappId (sem ticket prévio)
 * body pode ser texto simples ou subir mídias (multer)
 */
export const send = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params as unknown as { whatsappId: number };
  const messageData: MessageData = req.body;
  const medias = req.files as Express.Multer.File[] | undefined;

  try {
    const whatsapp = await Whatsapp.findByPk(whatsappId);
    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (!messageData.number) {
      throw new Error("O número é obrigatório");
    }

    const rawNumber = messageData.number;
    const companyId = whatsapp.companyId;

    // normaliza número usando rotina existente
    const check = await CheckContactNumber(rawNumber, companyId);
    const number = (check?.jid || rawNumber).replace(/\D/g, "");

    // opcionalmente valida contato (mantido por compatibilidade)
    await CheckIsValidContact(number, companyId).catch(() => {
      // se quiser, trate como erro:
      // throw new Error("Número inválido no WhatsApp");
    });

    const profilePicUrl = await GetProfilePicUrl(number, companyId);

    const contactData = {
      name: `${number}`,
      number,
      profilePicUrl,
      isGroup: false,
      companyId
    };

    const contact = await CreateOrUpdateContactService(contactData);

    const ticket = await FindOrCreateTicketService(
      contact,
      whatsapp.id!,
      0,
      companyId
    );

    if (medias && medias.length > 0) {
      const bodies = Array.isArray(messageData.body)
        ? messageData.body
        : medias.map(() => (messageData.body as string) ?? "");

      await Promise.all(
        medias.map(async (media: Express.Multer.File, index) => {
          await req.app.get("queues").messageQueue.add(
            "SendMessage",
            {
              whatsappId,
              data: {
                number,
                body: bodies[index] || media.originalname,
                mediaPath: media.path,
                fileName: media.originalname
              }
            },
            { removeOnComplete: true, attempts: 3 }
          );
        })
      );
    } else {
      const bodyText =
        typeof messageData.body === "string"
          ? messageData.body
          : (messageData.body?.[0] ?? "");

      await SendWhatsAppMessage({
        body: formatBody(bodyText, contact),
        ticket
      });

      await ticket.update({
        lastMessage: bodyText
      });
    }

    if (messageData.closeTicket) {
      setTimeout(async () => {
        await UpdateTicketService({
          ticketId: ticket.id,
          ticketData: { status: "closed" },
          companyId
        });
      }, 1000);
    }

    await SetTicketMessagesAsRead(ticket);

    return res.send({ mensagem: "Mensagem enviada" });
  } catch (err: any) {
    if (!err || Object.keys(err).length === 0) {
      throw new AppError(
        "Não foi possível enviar a mensagem, tente novamente em alguns instantes"
      );
    } else {
      throw new AppError(err.message);
    }
  }
};

/**
 * Utilitário usado por fluxos (mantido compatível, sem req.user)
 */
export const sendMessageFlow = async (
  whatsappId: number,
  body: any,
  req: Request,
  files?: Express.Multer.File[]
): Promise<string> => {
  const messageData = body;
  const medias = files;

  try {
    const whatsapp = await Whatsapp.findByPk(whatsappId);
    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (!messageData.number) {
      throw new Error("O número é obrigatório");
    }

    const numberToTest = messageData.number as string;
    const companyId = messageData.companyId as number;

    // normaliza, mas mantemos o próprio número para envio (como já acontecia)
    await CheckContactNumber(numberToTest, companyId);
    const number = numberToTest.replace(/\D/g, "");

    if (medias && medias.length > 0) {
      await Promise.all(
        medias.map(async (media: Express.Multer.File) => {
          await req.app.get("queues").messageQueue.add(
            "SendMessage",
            {
              whatsappId,
              data: {
                number,
                body: media.originalname,
                mediaPath: media.path
              }
            },
            { removeOnComplete: true, attempts: 3 }
          );
        })
      );
    } else {
      const text =
        typeof messageData.body === "string"
          ? messageData.body
          : (messageData.body?.[0] ?? "");

      await req.app.get("queues").messageQueue.add(
        "SendMessage",
        {
          whatsappId,
          data: {
            number,
            body: text
          }
        },
        { removeOnComplete: false, attempts: 3 }
      );
    }

    return "Mensagem enviada";
  } catch (err: any) {
    if (!err || Object.keys(err).length === 0) {
      throw new AppError(
        "Não foi possível enviar a mensagem, tente novamente em alguns instantes"
      );
    } else {
      throw new AppError(err.message);
    }
  }
};
