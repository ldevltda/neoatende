// backend/src/services/MessageServices/UpdateAckByMessageId.ts
import Message from "../../models/Message";

type UpdateAckParams = {
  id: string;
  ack: number; // 1..4
};

const UpdateAckByMessageId = async ({ id, ack }: UpdateAckParams) => {
  const msg = await Message.findOne({ where: { id } });
  if (!msg) return; // pode acontecer se o listener chegar antes do persist

  // só atualiza se o novo estado for "maior" que o atual
  if (ack > (msg.ack ?? 0)) {
    const update: any = { ack };
    if (ack >= 3 && msg.read !== true) update.read = true;

    await msg.update(update);
  }
};

export default UpdateAckByMessageId;
