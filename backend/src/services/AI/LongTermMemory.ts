import OpenAI from "openai";
import AiMemory from "../../models/AiMemory";

type MemoryItem = {
  key: string;           // ex.: "nome_preferido", "bairro_interesse", "orcamento_max"
  value: string;         // ex.: "Leo", "Campinas", "450000"
  confidence?: number;   // 0.0 - 1.0
  metadata?: any;        // opcional
};

export class LongTermMemory {
  private client: OpenAI;
  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  /** Lê memórias úteis (por prioridade) para injetar no contexto da conversa */
  async read(companyId: number, contactId: number): Promise<MemoryItem[]> {
    const rows = await AiMemory.findAll({
      where: { companyId, contactId },
      order: [["updatedAt", "DESC"]],
      limit: 50
    });
    return rows.map(r => ({ key: r.key, value: r.value, confidence: Number(r.confidence), metadata: r.metadata }));
  }

  /** Upsert de memórias (mantém última versão por key) */
  async upsert(companyId: number, contactId: number, items: MemoryItem[]) {
    for (const it of items) {
      const [row, created] = await AiMemory.findOrCreate({
        where: { companyId, contactId, key: it.key },
        defaults: {
          companyId, contactId, key: it.key, value: String(it.value),
          confidence: (it.confidence ?? 0.8), metadata: it.metadata
        }
      });
      if (!created) {
        row.value = String(it.value);
        row.confidence = (it.confidence ?? row.confidence);
        row.metadata = it.metadata ?? row.metadata;
        await row.save();
      }
    }
  }

  /**
   * Extrai "fatos" da conversa com LLM (controle forte no output).
   * Entrada: última mensagem do usuário + resposta do assistente (ou histórico curto)
   */
  async extractFactsPtBR(text: string, assistantReply?: string): Promise<MemoryItem[]> {
    // Modelo leve já resolve — pode parametrizar via .env
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    const sys = [
      "Extraia fatos úteis e persistentes de uma conversa de atendimento em português (pt-BR).",
      "Retorne um JSON com um array chamado 'memories'.",
      "Cada item deve conter: key, value e confidence (0..1).",
      "Exemplos de keys: nome_preferido, bairro_interesse, cidade_interesse, orcamento_max, orcamento_min, tipo_imovel, preferencia_contato, produto_interesse, prazo_compra, problema_relatado.",
      "Não inclua dados sensíveis (CPF, RG, endereço completo, informações de saúde).",
      "Não invente fatos; extraia apenas o que estiver explícito."
    ].join("\n");

    const user = [
      "Conversa:",
      `Usuário: ${text}`,
      assistantReply ? `Assistente: ${assistantReply}` : ""
    ].join("\n");

    const out = await this.client.chat.completions.create({
      model,
      temperature: 0.2,
      max_tokens: 300,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: sys },
        { role: "user", content: user }
      ]
    });

    const raw = out.choices?.[0]?.message?.content || "{}";
    try {
      const parsed = JSON.parse(raw);
      const mems: MemoryItem[] = Array.isArray(parsed?.memories) ? parsed.memories : [];
      // sanity & whitelist simples
      const allowed = new Set([
        "nome_preferido","bairro_interesse","cidade_interesse","orcamento_max","orcamento_min",
        "tipo_imovel","preferencia_contato","produto_interesse","prazo_compra","problema_relatado"
      ]);
      return mems
        .filter((m) => m && typeof m.key === "string" && allowed.has(m.key))
        .map((m) => ({ key: m.key, value: String(m.value), confidence: Number(m.confidence || 0.8) }));
    } catch {
      return [];
    }
  }
}
