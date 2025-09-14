// Suporta: a.b.c, arr[].x, arr[0].y
export function getByPath(obj: any, path?: string | null): any {
  if (!path) return undefined;
  const parts = path.split("."); // ex: data.items[].photos[].url
  let current: any[] | any = obj;

  for (const raw of parts) {
    if (current == null) return undefined;

    // array wildcard
    const mArr = raw.match(/(.+)\[\]/);
    const mIdx = raw.match(/(.+)\[(\d+)\]/);

    if (mArr) {
      const key = mArr[1];
      const arr = current?.[key];
      if (!Array.isArray(arr)) return undefined;
      current = arr.flatMap((item) => item);
      // quando for wildcard, deixamos "array atual" e seguimos para próximo passo
      continue;
    }

    if (mIdx) {
      const key = mIdx[1];
      const idx = Number(mIdx[2]);
      const arr = current?.[key];
      if (!Array.isArray(arr)) return undefined;
      current = arr[idx];
      continue;
    }

    // acesso simples
    current = current?.[raw];
  }
  return current;
}

// extrai lista principal do payload baseado em um path
export function getListByPath(obj: any, listPath?: string | null): any[] {
  if (!listPath) {
    // heurística: pega primeiro array "grande" do payload
    const queue = [obj];
    while (queue.length) {
      const cur = queue.shift();
      if (Array.isArray(cur)) return cur;
      if (cur && typeof cur === "object") {
        for (const k of Object.keys(cur)) queue.push(cur[k]);
      }
    }
    return [];
  }
  const val = getByPath(obj, listPath);
  if (Array.isArray(val)) return val;
  return [];
}
