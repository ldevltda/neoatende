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

type IndexQuery = {
  pageNumber: string;
};

type MessageData = {
  body: string;
  fromMe: boolean;
  read: boolean;
  quotedMsg?: Message;
  number?: string;
  closeTicket?: true;
};

export const index = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { pageNumber } = req.query as IndexQuery;
  const { companyId, profile } = req.user;
  const queues: number[] = [];

  if (profile !== "admin") {
    const user = await User.findByPk(req.user.id, {
      include: [{ model: Queue, as: "queues" }]
    });
    user.queues.forEach(queue => {
      queues.push(queue.id);
    });
  }

  const { count, messages, ticket, hasMore } = await ListMessagesService({
    pageNumber,
    ticketId,
    companyId,
    queues
  });

  SetTicketMessagesAsRead(ticket);

  return res.json({ count, messages, ticket, hasMore });
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { ticketId } = req.params;
  const { body, quotedMsg }: MessageData = req.body;
  const medias = req.files as Express.Multer.File[];
  const { companyId, id: userId } = req.user as any; // <- vamos usar no placeholder

  const ticket = await ShowTicketService(ticketId, companyId);
  SetTicketMessagesAsRead(ticket);

  const io = getIO();
  const room = ticket.id.toString();
  const now = new Date();

  const inferMediaType = (mimetype?: string | null): string | null => {
    if (!mimetype) return "document";
    if (mimetype.startsWith("image/")) return "image";
    if (mimetype.startsWith("video/")) return "video";
    if (mimetype.startsWith("audio/")) return "audio";
    return "document";
    };

  const emitCreate = (msgLike: any) => {
    io.to(room).emit(`company-${companyId}-appMessage`, {
      action: "create",
      message: msgLike
    });
  };

  // === MÍDIAS: placeholder(s) + envio ===
  if (medias && medias.length) {
    for (let index = 0; index < medias.length; index++) {
      const media = medias[index];
      const captionIn = Array.isArray(body) ? body[index] : body;
      const renderedCaption = captionIn ? formatBody(captionIn, ticket.contact) : "";

      const tempMsg = {
        id: `temp-${Date.now()}-${index}`,
        ticketId: ticket.id,
        contactId: (ticket as any).contactId ?? ticket.contact?.id ?? null,
        userId,               // <- adicionado
        body: renderedCaption || media.originalname,
        fromMe: true,
        read: true,
        ack: 0,
        mediaType: inferMediaType(media.mimetype),
        mediaUrl: null,
        companyId,
        createdAt: now,
        updatedAt: now
      };
      emitCreate(tempMsg);

      await SendWhatsAppMedia({
        media,
        ticket,
        body: renderedCaption || undefined
      });

      await ticket.update({
        lastMessage: renderedCaption || media.originalname
      });
    }

    return res.status(200).json({ message: "Mídia(s) enviada(s)" });
  }

  // === TEXTO: eco imediato + envio real ===
  const renderedBody = formatBody(body, ticket.contact);

  const tempMsg = {
    id: `temp-${Date.now()}`,
    ticketId: ticket.id,
    contactId: (ticket as any).contactId ?? ticket.contact?.id ?? null,
    userId,                 // <- adicionado
    body: renderedBody,
    fromMe: true,
    read: true,
    ack: 0,
    mediaType: null,
    mediaUrl: null,
    companyId,
    createdAt: now,
    updatedAt: now
  };
  emitCreate(tempMsg);

  await SendWhatsAppMessage({ body: renderedBody, ticket, quotedMsg });

  await ticket.update({ lastMessage: renderedBody });

  return res.status(200).json({ message: "Mensagem enviada" });
};

export const remove = async (
  req: Request,
  res: Response
): Promise<Response> => {
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

export const send = async (req: Request, res: Response): Promise<Response> => {
  const { whatsappId } = req.params as unknown as { whatsappId: number };
  const messageData: MessageData = req.body;
  const medias = req.files as Express.Multer.File[];

  try {
    const whatsapp = await Whatsapp.findByPk(whatsappId);

    if (!whatsapp) {
      throw new Error("Não foi possível realizar a operação");
    }

    if (messageData.number === undefined) {
      throw new Error("O número é obrigatório");
    }

    const numberToTest = messageData.number;
    const body = messageData.body;

    const companyId = whatsapp.companyId;

    const CheckValidNumber = await CheckContactNumber(numberToTest, companyId);
    const number = CheckValidNumber.jid.replace(/\D/g, "");
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

    if (medias && medias.length) {
      await Promise.all(
        medias.map(async (media: Express.Multer.File) => {
          await req.app.get("queues").messageQueue.add(
            "SendMessage",
            {
              whatsappId,
              data: {
                number,
                body: body ? formatBody(body, contact) : media.originalname,
                mediaPath: media.path,
                fileName: media.originalname
              }
            },
            { removeOnComplete: true, attempts: 3 }
          );
        })
      );
    } else {
      const rendered = formatBody(body, contact);
      await SendWhatsAppMessage({ body: rendered, ticket });
      await ticket.update({ lastMessage: rendered });
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

    SetTicketMessagesAsRead(ticket);

    return res.send({ mensagem: "Mensagem enviada" });
  } catch (err: any) {
    if (Object.keys(err).length === 0) {
      throw new AppError(
        "Não foi possível enviar a mensagem, tente novamente em alguns instantes"
      );
    } else {
      throw new AppError(err.message);
    }
  }
};

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

    if (messageData.number === undefined) {
      throw new Error("O número é obrigatório");
    }

    const numberToTest = messageData.number;
    const text = messageData.body;

    const companyId = messageData.companyId;

    await CheckContactNumber(numberToTest, companyId);
    const number = numberToTest.replace(/\D/g, "");

    if (medias && medias.length) {
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
    if (Object.keys(err).length === 0) {
      throw new AppError(
        "Não foi possível enviar a mensagem, tente novamente em alguns instantes"
      );
    } else {
      throw new AppError(err.message);
    }
  }
};
