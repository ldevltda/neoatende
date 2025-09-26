import Queue from "bull";
import { getTicketById, sendWhatsAppText, getLastInboundAt } from "./helpers";
import { logger } from "../../utils/logger";

type JobData = { ticketId: number; companyId: number; step: "6h" | "12h" | "24h" };

let leadQueue: Queue.Queue<JobData> | null = null;

export function startLeadFollowupQueue() {
  if (leadQueue) return leadQueue;

  const redis = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  leadQueue = new Queue<JobData>("lead-followups", redis);

  leadQueue.process(async job => {
    const { ticketId, companyId, step } = job.data;
    const ticket = await getTicketById(ticketId, companyId);
    if (!ticket) return;

    // se o cliente respondeu depois do agendamento, não manda
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

  leadQueue.on("error", err => logger.error({ err }, "lead-followups queue error"));
  return leadQueue;
}

export async function scheduleLeadFollowups(ticket: any) {
  const q = startLeadFollowupQueue();
  const base = { ticketId: ticket.id, companyId: ticket.companyId };
  await q.add({ ...base, step: "6h"  }, { delay: 6  * 60 * 60 * 1000, removeOnComplete: true, removeOnFail: true });
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
