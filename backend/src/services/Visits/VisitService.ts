import Visit from "../../models/Visit";

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
      propertyUrl: input.propertyRef?.startsWith("http") ? input.propertyRef : null,
      status: "requested",
      when: null,
      notes: input.notes || null
    });
    return v;
  }
};

export default VisitService;
