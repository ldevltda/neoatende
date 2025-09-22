import TicketTraking from "../../../models/TicketTraking";
import Ticket from "../../../models/Ticket";

export const verifyRating = (ticketTraking: TicketTraking) => {
  console.log("verifyRating chamado");
  return false;
};

export const handleRating = async (
  rate: number,
  ticket: Ticket,
  ticketTraking: TicketTraking
) => {
  console.log("handleRating chamado");
};
