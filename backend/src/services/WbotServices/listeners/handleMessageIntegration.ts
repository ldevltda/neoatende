import { WASocket, proto } from "baileys";
import Ticket from "../../../models/Ticket";

type Session = WASocket & { id?: number };

export const handleMessageIntegration = async (
  msg: proto.IWebMessageInfo,
  wbot: Session,
  ticket: Ticket,
  companyId: number
): Promise<void> => {
  console.log("handleMessageIntegration chamado");
};
