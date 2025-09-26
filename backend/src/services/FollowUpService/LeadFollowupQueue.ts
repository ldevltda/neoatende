// backend/src/services/FollowUpService/LeadFollowupQueue.ts
import Queue from "bull";
import IORedis from "ioredis";
import { getRedisUrl, getIORedisOptions } from "../../config/redis";
import { getTicketById, sendWhatsAppText, getLastInboundAt } from "./helpers";
import { logger } from "../../utils/logger";

// Mantemos a tipagem do job
export type JobData = {
  ticketId: number;
  companyId: number;
  step: "6h" | "12h" | "24h";
};

let leadQueue: Queue.Queue<JobData> | null = null;

/**
 * Cria (ou retorna) a fila Bull compartilhando a MESMA conexão Redis
 * usada no restante do backend (Upstash-ready: TLS, readyCheck off,
 * maxRetriesPerRequest=null, dnsLookup IPv4 etc.).
 */
export function startLeadFollowupQueue() {
  if (leadQueue) return leadQueue;

  const redisUrl = getRedisUrl();
  const redisOpts = getIORedisOptions();

  // Usa createClient para que Bull crie client/subscriber/bclient com as MESMAS opções
  leadQueue = new Queue<JobData>("lead-followups", {
    createClient: (_type: "client" | "subscriber" | "bclient") =>
      new IORedis(redisUrl, redisOpts)
  });

  // Processador de jobs
  leadQueue.process(async job => {
    try {
      const { ticketId, companyId, step } = job.data;

      const ticket = await getTicketById(ticketId, companyId);
      if (!ticket) return;

      // Se o cliente respondeu após o agendamento desse job, não enviar
      const lastInboundAt = await getLastInboundAt(ticketId, companyId);
      if (lastInboundAt && lastInboundAt > new Date(job.timestamp)) return;

      const nome = (ticket as any)?.contact?.name ?? "tudo bem";
      const bairro = (ticket as any)?.lastSuggestedNeighborhood ?? "";
      const valor = (ticket as any)?.lastSuggestedPrice ?? "";

      let msg = "";
      if (step === "6h") {
        msg = `Oi ${nome}, tudo bem? Separei mais 2 opções na faixa que conversamos. Quer que eu te mande agora?`;
      } else if (step === "12h") {
        msg = `Ainda tenho disponível aquele apê em ${bairro || "sua região"} por R$ ${valor || "valor combinado"}. Posso já reservar um horário de visita?`;
      } else {
        msg = `Percebi que você não conseguiu responder. Fico à disposição, e enquanto isso vou separando novidades na sua faixa 😉.`;
      }

      await sendWhatsAppText(ticket, msg);
    } catch (err) {
      logger.error({ err }, "lead-followups job error");
      throw err; // deixa o Bull fazer retry/backoff padrão se configurado
    }
  });

  // Observabilidade básica / não derruba a aplicação
  leadQueue.on("error", err => logger.error({ err }, "lead-followups queue error"));
  leadQueue.on("stalled", job => logger.warn({ jobId: job.id }, "lead-followups job stalled"));

  return leadQueue;
}

export async function scheduleLeadFollowups(ticket: any) {
  const q = startLeadFollowupQueue();
  const base = { ticketId: ticket.id, companyId: ticket.companyId };

  await q.add({ ...base, step: "6h" }, {
    delay: 6 * 60 * 60 * 1000,
    removeOnComplete: true,
    removeOnFail: true
  });

  await q.add({ ...base, step: "12h" }, {
    delay: 12 * 60 * 60 * 1000,
    removeOnComplete: true,
    removeOnFail: true
  });

  await q.add({ ...base, step: "24h" }, {
    delay: 24 * 60 * 60 * 1000,
    removeOnComplete: true,
    removeOnFail: true
  });
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
