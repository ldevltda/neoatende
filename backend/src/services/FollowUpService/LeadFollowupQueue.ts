// backend/src/services/FollowUpService/LeadFollowupQueue.ts
import Queue from "bull";
import IORedis from "ioredis";
import { REDIS_URI_CONNECTION } from "../../config/redis";
import { getTicketById, sendWhatsAppText, getLastInboundAt } from "./helpers";
import { logger } from "../../utils/logger";

type JobData = {
  ticketId: number;
  companyId: number;
  step: "6h" | "12h" | "24h";
};

let leadQueue: Queue.Queue<JobData> | null = null;

/**
 * Constrói as opções de conexão do ioredis a partir da URL (redis:// ou rediss://).
 * Upstash + Bull exigem: enableReadyCheck: false e maxRetriesPerRequest: null
 * Para mitigar ENOTFOUND intermitente, forçamos lookup IPv4 e retryStrategy com backoff.
 */
function makeRedisOptsFromUrl(urlStr: string) {
  const u = new URL(urlStr);
  const useTls = u.protocol === "rediss:" || process.env.REDIS_TLS === "1";

  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: decodeURIComponent(u.username || "default"),
    password: decodeURIComponent(u.password || ""),
    enableReadyCheck: false,
    // Bull reclama se maxRetriesPerRequest não for null para bclient/subscriber
    maxRetriesPerRequest: null as any,
    tls: useTls ? {} : undefined,
    // evita problemas de resolução AAAA
    dnsLookup: (hostname: string, cb: any) =>
      require("dns").lookup(hostname, { family: 4 }, cb),
    // backoff exponencial (máx 30s)
    retryStrategy: (times: number) => Math.min(1000 * 2 ** times, 30000)
  };
}

export function startLeadFollowupQueue() {
  if (leadQueue) return leadQueue;

  const redisOpts = makeRedisOptsFromUrl(REDIS_URI_CONNECTION);

  // Criamos os três clients do Bull com as MESMAS opções (client, subscriber, bclient)
  leadQueue = new Queue<JobData>("lead-followups", {
    createClient: (_type: "client" | "subscriber" | "bclient") =>
      new IORedis(redisOpts)
  });

  // Processador de jobs
  leadQueue.process(async job => {
    const { ticketId, companyId, step } = job.data;

    const ticket = await getTicketById(ticketId, companyId);
    if (!ticket) return;

    // Se o cliente respondeu após o agendamento desse job, não enviar
    const lastInboundAt = await getLastInboundAt(ticketId, companyId);
    if (lastInboundAt && lastInboundAt > new Date(job.timestamp)) return;

    const nome   = (ticket as any)?.contact?.name ?? "tudo bem";
    const bairro = (ticket as any)?.lastSuggestedNeighborhood ?? "";
    const valor  = (ticket as any)?.lastSuggestedPrice ?? "";

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

  // Não derruba a aplicação se der ruim na fila
  leadQueue.on("error", err => logger.error({ err }, "lead-followups queue error"));

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
