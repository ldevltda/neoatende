import Message from "../../models/Message";

type UpdateAckParams = { id: string; ack: number };

const UpdateAckByMessageId = async ({ id, ack }: UpdateAckParams) => {
  let msg = await Message.findOne({ where: { waId: id } });
    if (!msg) msg = await Message.findOne({ where: { id } }); // fallback enquanto coexistirem
    if (!msg) return;
    if ((msg.ack ?? 0) >= ack) return;
    await msg.update({ ack });
};

export default UpdateAckByMessageId;
