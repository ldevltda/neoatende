import Visit from "../../models/Visit";
import Ticket from "../../models/Ticket";
import Contact from "../../models/Contact";
// ✅ usa o serviço nativo de envio de texto do WhatsApp
import SendWhatsAppMessage from "../WbotServices/SendWhatsAppMessage";

type RequestVisitInput = {
  companyId: number;
  ticketId: number;
  contactId: number;
  propertyRef?: string | null; // código/url
  notes?: string | null;
};

const VisitService = {
  async requestVisit(input: RequestVisitInput) {
    const v = await Visit.create({
      companyId: input.companyId,
      ticketId: input.ticketId,
      contactId: input.contactId,
      propertyCode: input.propertyRef || null,
      propertyUrl:
        typeof input.propertyRef === "string" && input.propertyRef.startsWith("http")
          ? input.propertyRef
          : null,
      status: "requested",
      when: null,
      notes: input.notes || null
    });
    return v;
  },

  async proposeTimes(ticketId: number, companyId: number, slots: string[]) {
    const ticket = await Ticket.findOne({
      where: { id: ticketId, companyId },
      include: [{ model: Contact, as: "contact" }]
    });
    if (!ticket) return;

    await Visit.create({
      companyId,
      ticketId,
      contactId: ticket.contactId,
      status: "proposed"
    });

    const body = `Tenho ${slots.join(" ou ")}. Qual te atende melhor?`;
    try {
      await (SendWhatsAppMessage as any)({ body, ticket });
    } catch {
      try {
        await (SendWhatsAppMessage as any)({ body, ticket, quotedMsg: undefined, contactId: ticket?.contactId });
      } catch { /* silencioso */ }
    }
  },

  async confirmVisit(
    ticketId: number,
    companyId: number,
    when: Date,
    opts?: { propertyCode?: string; propertyUrl?: string; notes?: string }
  ) {
    const ticket = await Ticket.findOne({
      where: { id: ticketId, companyId },
      include: [{ model: Contact, as: "contact" }]
    });
    if (!ticket) return;

    const v = await Visit.create({
      companyId,
      ticketId,
      contactId: ticket.contactId,
      status: "confirmed",
      when,
      propertyCode: opts?.propertyCode || null,
      propertyUrl: opts?.propertyUrl || null,
      notes: opts?.notes || null
    });

    const body = `Perfeito! Visita confirmada para ${when.toLocaleString("pt-BR")}. Te mando um lembrete no dia 😉`;
    try {
      await (SendWhatsAppMessage as any)({ body, ticket });
    } catch {
      try {
        await (SendWhatsAppMessage as any)({ body, ticket, quotedMsg: undefined, contactId: ticket?.contactId });
      } catch { /* silencioso */ }
    }

    return v;
  }
};

export default VisitService;
