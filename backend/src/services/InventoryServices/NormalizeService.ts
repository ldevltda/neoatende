import InventoryIntegration from "../../models/InventoryIntegration";
import { getByPath, getListByPath } from "./jsonPath";

export function normalizeItems(payload: any, integ: InventoryIntegration, page: number, pageSize: number) {
  const rolemap = integ.rolemap || { list_path: null, fields: { location: {} as any } };
  const list = getListByPath(payload, rolemap.list_path);

  const items = list.map((x: any) => {
    const f = rolemap.fields || ({} as any);
    const id = f.id ? getByPath(x, f.id) : (x?.id ?? x?.uuid ?? x?.codigo);
    const titulo = f.title ? getByPath(x, f.title) : (x?.title ?? x?.titulo ?? x?.name);
    const preco = f.price ? getByPath(x, f.price) : (x?.price ?? x?.preco ?? x?.valor ?? null);
    const url   = f.url ? getByPath(x, f.url) : (x?.url ?? x?.link ?? null);
    const status= f.status ? getByPath(x, f.status) : (x?.status ?? x?.available ?? x?.ativo ?? null);
    const desc  = f.description ? getByPath(x, f.description) : (x?.description ?? x?.descricao ?? null);
    const images = f.images ? getByPath(x, f.images) : (x?.photos ?? x?.images ?? null);
    const loc = f.location || {};
    const cidade = loc.cidade ? getByPath(x, loc.cidade) : (x?.cidade ?? x?.city ?? null);
    const uf     = loc.uf ? getByPath(x, loc.uf) : (x?.uf ?? x?.estado ?? x?.state ?? null);
    const bairro = loc.bairro ? getByPath(x, loc.bairro) : (x?.bairro ?? x?.district ?? x?.neighborhood ?? null);

    const midias = Array.isArray(images)
      ? images.map((u: any) => (typeof u === "string" ? { url: u, tipo: "image" } : { url: u?.url || u?.src, tipo: "image" }))
          .filter((m: any) => m?.url)
      : [];

    return {
      id: String(id ?? ""),
      titulo: titulo ?? "",
      descricao: desc,
      preco: preco ?? null,
      moeda: "BRL",
      status: normalizeStatus(status),
      categoria: integ.categoryHint || "produto",
      midias,
      localizacao: { cidade, uf, bairro },
      atributos: {}, // livre, pode evoluir
      externo: { raw: x }
    };
  });

  // total – tenta detectar no topo ou pelo comprimento
  const total = detectTotal(payload, items.length, page, pageSize);

  return {
    items,
    total,
    pagina: page,
    pageSize,
    hasNext: page * pageSize < total
  };
}

function normalizeStatus(s: any) {
  const txt = String(s ?? "").toLowerCase();
  if (["true", "1", "at", "sim", "available", "disponivel", "ativo"].some(w => txt.includes(w))) return "disponivel";
  if (["false", "0", "nao", "vendido", "indisponivel"].some(w => txt.includes(w))) return "indisponivel";
  return "sob_consulta";
}

function detectTotal(payload: any, len: number, page: number, pageSize: number) {
  const maybe = ["total", "count", "totalCount", "meta.total", "pagination.total"];
  for (const key of maybe) {
    const val = key.includes(".")
      ? key.split(".").reduce((acc: any, k: string) => (acc ? acc[k] : undefined), payload)
      : payload?.[key];
    if (typeof val === "number") return val;
  }
  // fallback
  if (len < pageSize) return (page - 1) * pageSize + len;
  return page * pageSize + pageSize; // estimativa
}
