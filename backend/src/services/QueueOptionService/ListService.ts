// backend/src/services/QueueOptionService/ListService.ts
import QueueOption from "../../models/QueueOption";

type QueueOptionFilter = {
  queueId?: string | number;
  queueOptionId?: string | number;
  /** -1 => raiz (parentId NULL); >0 => id do pai; boolean/indefinido => ignorado */
  parentId?: string | number | boolean;
};

const ListService = async ({
  queueId,
  queueOptionId,
  parentId
}: QueueOptionFilter) => {
  const whereOptions: Record<string, any> = {};

  if (queueId != null && queueId !== "") {
    whereOptions.queueId = queueId;
  }

  if (queueOptionId != null && queueOptionId !== "") {
    whereOptions.id = queueOptionId;
  }

  // normaliza parentId
  let pid: number | undefined | null = undefined;

  if (typeof parentId === "number") {
    pid = parentId;
  } else if (typeof parentId === "string" && parentId.trim() !== "") {
    const n = Number(parentId);
    if (Number.isFinite(n)) pid = n;
  } else if (typeof parentId === "boolean") {
    pid = undefined; // ignora boolean
  }

  if (pid === -1) {
    whereOptions.parentId = null;      // <- use null (minúsculo)
  } else if (typeof pid === "number" && pid > 0) {
    whereOptions.parentId = pid;
  }

  const queueOptions = await QueueOption.findAll({
    where: whereOptions,
    order: [["id", "ASC"]]
  });

  return queueOptions;
};

export default ListService;
