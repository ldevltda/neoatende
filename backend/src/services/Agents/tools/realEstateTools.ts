// backend/src/services/Agents/tools/realEstateTools.ts
import axios from "axios";

export type SearchCriteria = {
  texto?: string;
  cidade?: string;
  bairro?: string;
  minPrice?: number;
  maxPrice?: number;
  dormitorios?: number;
  vagas?: number;
  areaMin?: number;
  areaMax?: number;
  limit?: number;
};

type RawProperty = {
  codigo: string;
  slug: string;
  url: string;
  title: string;
  description?: string;
  price?: string;
  dormitorios?: string;
  banheiros?: string;
  vagas?: string;
  area?: string; // "63.86"
  cidade?: string;
  bairro?: string;
};

export type PropertyCard = {
  codigo: string;
  title: string;
  bairroCidade: string;
  areaM2?: string;
  dorm?: string;
  vagas?: string;
  preco?: string;
  link: string;
};

// 🔎 Busca via Agent Lookup (rota já existente no seu backend) ou fallback direto
export async function searchProperties(
  companyId: number,
  criteria: SearchCriteria
): Promise<RawProperty[]> {
  // 1) tentar via Inventory Agent (seu endpoint interno)
  try {
    const base =
      process.env.INTERNAL_BASE_URL ||
      process.env.APP_URL ||
      "http://127.0.0.1:8080";
    const { data } = await axios.post(
      `${base}/inventory/agent/lookup`,
      {
        companyId,
        category: "imoveis",
        query: criteria,
        limit: criteria.limit || 5
      },
      { timeout: 8000 }
    );
    if (Array.isArray(data?.items)) return data.items as RawProperty[];
  } catch {
    // ignora e cai no fallback
  }

  // 2) fallback: endpoint público Barbi (mantém compat com tua demo)
  try {
    const url = `https://barbiimoveis.com.br/api/imoveis/listar?per_page=${criteria.limit || 5}&include_photos=1`;
    const { data } = await axios.get(url, { timeout: 8000 });
    if (Array.isArray(data)) return data as RawProperty[];
  } catch {
    // sem resultados
  }
  return [];
}

export function toPtBRDecimal(n: string | number | undefined) {
  if (n === undefined || n === null) return undefined;
  const num = typeof n === "string" ? Number(n) : n;
  if (Number.isNaN(num)) return undefined;
  return num.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function formatCards(list: RawProperty[]): PropertyCard[] {
  return list.map((p) => ({
    codigo: p.codigo,
    title: p.title,
    bairroCidade: [p.bairro, p.cidade].filter(Boolean).join(" / "),
    areaM2: p.area ? `${toPtBRDecimal(p.area)} m²` : undefined,
    dorm: p.dormitorios,
    vagas: p.vagas,
    preco: p.price,
    link: p.url
  }));
}

export function renderWhatsAppList(cards: PropertyCard[]): string {
  if (!cards.length) {
    return "Não encontrei opções com esses critérios agora. Posso ajustar bairro, faixa de preço ou número de quartos para te mostrar alternativas?";
  }

  const bulbs = cards.slice(0, 3).map((c, i) => {
    const parts = [
      `*${i + 1}) ${c.title}*`,
      c.bairroCidade && `• ${c.bairroCidade}`,
      c.areaM2 && `• ${c.areaM2}`,
      (c.dorm || c.vagas) && `• ${c.dorm || "?"} dorm · ${c.vagas || "?"} vaga(s)`,
      c.preco && `• ${c.preco}`,
      c.link && `• ${c.link}`
    ].filter(Boolean);
    return parts.join("\n");
  });

  return `${bulbs.join("\n\n")}\n\n👉 Quer ver por dentro? Agendo sua visita agora.`;
}
