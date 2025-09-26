import Queue from "bull";
import { getTicketById, sendWhatsAppText, getLastInboundAt } from "./helpers";
import { logger } from "../../utils/logger";

type JobData = {
  ticketId: number;
  companyId: number;
  step: "6h" | "12h" | "24h";
};

/**
 * Cria a fila Bull lendo REDIS_URL (suporta rediss:// com TLS).
 * Ex.: rediss://default:senha@host.upstash.io:6379
 */
function createBullQueue(): Queue.Queue<JobData> {
  const envUrl = process.env.REDIS_URL;
  // fallback local para dev
  if (!envUrl) {
    logger.warn("REDIS_URL não definido — usando redis://127.0.0.1:6379 (dev)");
    return new Queue<JobData>("lead-followups", "redis://127.0.0.1:6379");
  }

  let parsed: URL | null = null;
  try {
    parsed = new URL(envUrl);
  } catch {
    // se por algum motivo for uma URL inválida, tenta direto como string
    logger.warn({ envUrl }, "REDIS_URL inválido; tentando passar como string para o Bull");
    return new Queue<JobData>("lead-followups", envUrl);
  }

  const isTLS = parsed.protocol === "rediss:";
  const host = parsed.hostname;
  const port = parsed.port ? Number(parsed.port) : (isTLS ? 6380 : 6379);
  const password = parsed.password || undefined;

  const opts: any = {
    redis: {
      host,
      port,
      password,
      // Upstash/managed Redis geralmente pede TLS quando usa rediss://
      tls: isTLS ? { rejectUnauthorized: false } : undefined,
      retryStrategy: (times: number) => Math.min(times * 1000, 15000),
      maxRetriesPerRequest: 3,
      enableReadyCheck: true
    },
    defaultJobOptions: { removeOnComplete: true, removeOnFail: true }
  };

  logger.info({
    host,
    port,
    tls: !!opts.redis.tls
  }, "Inicializando Bull para lead-followups");

  return new Queue<JobData>("lead-followups", opts);
}

let leadQueue: Queue.Queue<JobData> | null = null;

export function startLeadFollowupQueue() {
  if (leadQueue) return leadQueue;

  leadQueue = createBullQueue();

  leadQueue.process(async job => {
    const { ticketId, companyId, step } = job.data;

    const ticket = await getTicketById(ticketId, companyId);
    if (!ticket) return;

    // Se o cliente respondeu após o agendamento do job, não dispara follow-up
    const lastInboundAt = await getLastInboundAt(ticketId, companyId);
    if (lastInboundAt && lastInboundAt > new Date(job.timestamp)) return;

    const nome = (ticket as any)?.contact?.name || "tudo bem";
    const bairro = (ticket as any)?.lastSuggestedNeighborhood || "";
    const valor = (ticket as any)?.lastSuggestedPrice || "";

    let msg = "";
    if (step === "6h") {
      msg = `Oi ${nome}, tudo bem? Separei mais 2 opções na faixa que conversamos. Quer que eu te mande agora?`;
    } else if (step === "12h") {
      msg = `Ainda tenho disponível aquele apê em ${bairro || "sua região"} por R$ ${valor || "valor combinado"}. Posso já reservar um horário de visita?`;
    } else {
      msg = `Percebi que você não conseguiu responder. Fico à disposição, e enquanto isso vou separando novidades na sua faixa 😉.`;
    }

    await sendWhatsAppText(ticket, msg);
  });

  leadQueue.on("error", err => {
    logger.error(
      {
        err,
        host: process.env.REDIS_URL
      },
      "lead-followups queue error"
    );
  });

  leadQueue.on("stalled", job => {
    logger.warn({ jobId: job.id }, "lead-followups job stalled");
  });

  return leadQueue;
}

export async function scheduleLeadFollowups(ticket: any) {
  const q = startLeadFollowupQueue();
  const base = { ticketId: ticket.id, companyId: ticket.companyId };

  await q.add({ ...base, step: "6h"  }, { delay:  6 * 60 * 60 * 1000, removeOnComplete: true, removeOnFail: true });
  await q.add({ ...base, step: "12h" }, { delay: 12 * 60 * 60 * 1000, removeOnComplete: true, removeOnFail: true });
  await q.add({ ...base, step: "24h" }, { delay: 24 * 60 * 60 * 1000, removeOnComplete: true, removeOnFail: true });
}

export async function cancelLeadFollowups(ticket: any) {
  const q = startLeadFollowupQueue();
  const jobs = await q.getDelayed();
  await Promise.all(
    jobs
      .filter(j => j.data.ticketId === ticket.id && j.data.companyId === ticket.companyId)
      .map(j => j.remove())
  );
}
