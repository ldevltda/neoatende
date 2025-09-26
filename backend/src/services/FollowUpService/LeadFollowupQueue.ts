// backend/src/services/FollowUpService/LeadFollowupQueue.ts
import Queue, { Queue as BullQueue, QueueOptions } from "bull";
import { getTicketById, sendWhatsAppText, getLastInboundAt } from "./helpers";
import { logger } from "../../utils/logger";

type JobData = { ticketId: number; companyId: number; step: "6h" | "12h" | "24h" };

let leadQueue: BullQueue<JobData> | null = null;

function buildBullOptionsFromUrl(url: string): QueueOptions {
  const u = new URL(url);
  const isTLS = u.protocol === "rediss:";
  // Upstash usa ACL (username/password). ioredis aceita ambos em options.
  const username = u.username ? decodeURIComponent(u.username) : undefined;
  const password = u.password ? decodeURIComponent(u.password) : undefined;

  return {
    // NÃO passe createClient/instances de ioredis — deixe o Bull criar os clientes
    redis: {
      host: u.hostname,
      port: Number(u.port || 6379),
      username,
      password,
      // força IPv4 pra evitar ENOTFOUND em IPv6 no Fly
      family: 4,
      // ativa TLS se a URL for rediss://
      tls: isTLS ? {} : undefined,
      // timeouts mais generosos pra rede do Fly
      connectTimeout: 10000,
      keepAlive: 10000
    }
  };
}

function createBullQueue(): BullQueue<JobData> {
  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  // Se for uma URL, convertemos para options (isso também contorna o bug 1873)
  const opts = buildBullOptionsFromUrl(url);
  return new Queue<JobData>("lead-followups", opts);
}

export function startLeadFollowupQueue() {
  if (leadQueue) return leadQueue;

  leadQueue = createBullQueue();

  leadQueue.process(async job => {
    const { ticketId, companyId, step } = job.data;

    const ticket = await getTicketById(ticketId, companyId);
    if (!ticket) return;

    // se o cliente respondeu depois do agendamento, não envia
    const lastInboundAt = await getLastInboundAt(ticketId, companyId);
    if (lastInboundAt && lastInboundAt > new Date(job.timestamp)) return;

    const nome   = (ticket as any)?.contact?.name || "tudo bem";
    const bairro = (ticket as any)?.lastSuggestedNeighborhood || "";
    const valor  = (ticket as any)?.lastSuggestedPrice || "";

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

  // Se o DNS falhar em algum momento, não derruba a app; só loga e o Bull tenta de novo
  leadQueue.on("error", err => logger.error({ err }, "lead-followups queue error"));
  leadQueue.on("stalled", job => logger.warn({ jobId: job.id }, "lead-followups job stalled"));

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
