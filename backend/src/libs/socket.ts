import { Server as SocketIO } from "socket.io";
import { Server } from "http";
import AppError from "../errors/AppError";
import { logger } from "../utils/logger";
import User from "../models/User";
import Queue from "../models/Queue";
import Ticket from "../models/Ticket";
import { verify } from "jsonwebtoken";
import authConfig from "../config/auth";
import { CounterManager } from "./counter";

let io: SocketIO;

function getAllowedOrigins() {
  const fromEnv = (process.env.FRONTEND_URL || "").split(",").map(s => s.trim()).filter(Boolean);
  // Em dev, permita localhost
  const devOrigins = ["http://localhost:3000", "http://127.0.0.1:3000"];
  if (process.env.NODE_ENV === "production") return fromEnv.length ? fromEnv : ["*"];
  return [...new Set([...fromEnv, ...devOrigins])];
}

export const initIO = (httpServer: Server): SocketIO => {
  io = new SocketIO(httpServer, {
    cors: {
      origin: "*",
      credentials: true,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
    },
    transports: ["websocket"],   // foca só em WebSocket
    allowUpgrades: false,         // não tenta “subir” de polling -> ws
    allowEIO3: true               // mantém compatibilidade com seu cliente atual
  });

  /**
   * Middleware de autenticação do Socket.IO
   * Lê o token em:
   *  - socket.handshake.auth.token  (recomendado)
   *  - socket.handshake.query.token (retrocompat)
   *  - Authorization: Bearer <token> (header)
   */
  io.use((socket, next) => {
    try {
      const auth = (socket.handshake as any).auth || {};
      const queryToken = socket.handshake.query?.token as string | undefined;
      const headerAuth = socket.handshake.headers?.authorization as string | undefined;

      let rawToken: string | undefined =
        auth.token ||
        queryToken ||
        (headerAuth?.startsWith("Bearer ") ? headerAuth.slice(7) : undefined);

      if (!rawToken) {
        logger.warn("[socket.io] missing token");
        return next(new Error("unauthorized"));
      }

      const payload = verify(rawToken, authConfig.secret) as any;
      if (!payload?.id) {
        logger.warn("[socket.io] invalid token payload");
        return next(new Error("unauthorized"));
      }

      // guarda para usar no "connection"
      (socket.data as any).userId = payload.id;
      return next();
    } catch (e: any) {
      logger.warn(`[socket.io] token error: ${e?.message}`);
      return next(new Error("unauthorized"));
    }
  });

  io.on("connection", async socket => {
    logger.info("Client Connected");

    const counters = new CounterManager();

    // userId vem do middleware acima
    const userId = (socket.data as any).userId as number | string | undefined;
    if (!userId || userId === "undefined" || userId === "null") {
      logger.info("onConnect: Missing userId");
      socket.disconnect();
      return io;
    }

    let user: User | null = null;
    try {
      user = await User.findByPk(userId as any, { include: [Queue] });
    } catch (e) {
      logger.error(e, `onConnect: error fetching user ${userId}`);
    }

    if (!user) {
      logger.info(`onConnect: User ${userId} not found`);
      socket.disconnect();
      return io;
    }

    // marca online
    try {
      user.online = true as any;
      await user.save();
    } catch (e) {
      logger.warn(e, `onConnect: could not set user ${user.id} online`);
    }

    socket.join(`company-${user.companyId}-mainchannel`);
    socket.join(`user-${user.id}`);

    socket.on("joinChatBox", async (ticketId: string) => {
      if (!ticketId || ticketId === "undefined") return;
      try {
        const ticket = await Ticket.findByPk(ticketId);
        if (
          ticket &&
          ticket.companyId === user!.companyId &&
          (ticket.userId === user!.id || user!.profile === "admin")
        ) {
          const c = counters.incrementCounter(`ticket-${ticketId}`);
          if (c === 1) socket.join(ticketId);
          logger.debug(`joinChatbox[${c}]: Channel: ${ticketId} by user ${user!.id}`);
        } else {
          logger.info(`Invalid attempt to join channel of ticket ${ticketId} by user ${user!.id}`);
        }
      } catch (error) {
        logger.error(error, `Error fetching ticket ${ticketId}`);
      }
    });

    socket.on("leaveChatBox", async (ticketId: string) => {
      if (!ticketId || ticketId === "undefined") return;
      const c = counters.decrementCounter(`ticket-${ticketId}`);
      if (c === 0) socket.leave(ticketId);
      logger.debug(`leaveChatbox[${c}]: Channel: ${ticketId} by user ${user!.id}`);
    });

    socket.on("joinNotification", async () => {
      const c = counters.incrementCounter("notification");
      if (c === 1) {
        if (user!.profile === "admin") {
          socket.join(`company-${user!.companyId}-notification`);
        } else {
          user!.queues.forEach(queue => {
            logger.debug(`User ${user!.id} of company ${user!.companyId} joined queue ${queue.id} channel.`);
            socket.join(`queue-${queue.id}-notification`);
          });
          if (user!.allTicket === "enabled") socket.join("queue-null-notification");
        }
      }
      logger.debug(`joinNotification[${c}]: User: ${user!.id}`);
    });

    socket.on("leaveNotification", async () => {
      const c = counters.decrementCounter("notification");
      if (c === 0) {
        if (user!.profile === "admin") {
          socket.leave(`company-${user!.companyId}-notification`);
        } else {
          user!.queues.forEach(queue => {
            logger.debug(`User ${user!.id} of company ${user!.companyId} leaved queue ${queue.id} channel.`);
            socket.leave(`queue-${queue.id}-notification`);
          });
          if (user!.allTicket === "enabled") socket.leave("queue-null-notification");
        }
      }
      logger.debug(`leaveNotification[${c}]: User: ${user!.id}`);
    });

    socket.on("joinTickets", (status: string) => {
      const c = counters.incrementCounter(`status-${status}`);
      if (c === 1) {
        if (user!.profile === "admin") {
          logger.debug(`Admin ${user!.id} of company ${user!.companyId} joined ${status} tickets channel.`);
          socket.join(`company-${user!.companyId}-${status}`);
        } else if (status === "pending") {
          user!.queues.forEach(queue => {
            logger.debug(`User ${user!.id} of company ${user!.companyId} joined queue ${queue.id} pending tickets channel.`);
            socket.join(`queue-${queue.id}-pending`);
          });
          if (user!.allTicket === "enabled") socket.join("queue-null-pending");
        } else {
          logger.debug(`User ${user!.id} cannot subscribe to ${status}`);
        }
      }
    });

    socket.on("leaveTickets", (status: string) => {
      const c = counters.decrementCounter(`status-${status}`);
      if (c === 0) {
        if (user!.profile === "admin") {
          logger.debug(`Admin ${user!.id} of company ${user!.companyId} leaved ${status} tickets channel.`);
          socket.leave(`company-${user!.companyId}-${status}`);
        } else if (status === "pending") {
          user!.queues.forEach(queue => {
            logger.debug(`User ${user!.id} of company ${user!.companyId} leaved queue ${queue.id} pending tickets channel.`);
            socket.leave(`queue-${queue.id}-pending`);
          });
          if (user!.allTicket === "enabled") socket.leave("queue-null-pending");
        }
      }
    });

    socket.emit("ready");
  });

  return io;
};

export const getIO = (): SocketIO => {
  if (!io) throw new AppError("Socket IO not initialized");
  return io;
};
