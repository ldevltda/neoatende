import Message from "../../models/Message";

type UpdateAckParams = { id: string; ack: number };

const UpdateAckByMessageId = async ({ id, ack }: UpdateAckParams) => {
  const msg = await Message.findOne({ where: { id } });
  if (!msg) return;

  // Só sobe (1 -> 2 -> 3 -> 4)
  if ((msg.ack ?? 0) >= ack) return;

  await msg.update({ ack });
  // NÃO altere "read" aqui; esse campo costuma ser "mensagem foi lida pelo atendente",
  // e para mensagens fromMe não faz sentido marcá-lo.
};

export default UpdateAckByMessageId;
