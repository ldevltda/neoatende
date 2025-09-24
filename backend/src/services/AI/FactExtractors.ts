// backend/src/services/AI/FactExtractors.ts
// Converte texto/reply em fatos normalizados para a LTM
export type Fact = { key: string; value: string };

export function extractStructuredFactsPtBR(text: string, reply: string): Fact[] {
  const all = `${text}\n${reply}`.toLowerCase();

  const facts: Fact[] = [];

  // e-mail
  const email = (all.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) || [])[0];
  if (email) facts.push({ key: "email", value: email.toLowerCase() });

  // telefone BR
  const phone = (all.match(/\+?55?\s*\(?\d{2}\)?\s*\d{4,5}[-\s]?\d{4}/g) || [])[0];
  if (phone) facts.push({ key: "telefone", value: phone.replace(/\D/g, "") });

  // preferências
  const dorm = all.match(/(\d)\s*(dormit[óo]rios?|quartos?)/i);
  if (dorm) facts.push({ key: "dormitorios", value: dorm[1] });

  const vagas = all.match(/(\d)\s*(vagas?|garagem)/i);
  if (vagas) facts.push({ key: "vagas", value: vagas[1] });

  const cidade = all.match(/\b(em|na)\s+([a-z\u00C0-\u017F\s]+?)(?:\s|,|\.|$)(?:sc|santa catarina)?/i);
  if (cidade && cidade[2] && cidade[2].length <= 30) {
    facts.push({ key: "cidade_interesse", value: capitalize(cidade[2].trim()) });
  }

  const bairro = all.match(/bairro\s+([a-z\u00C0-\u017F\s\-]+)/i);
  if (bairro && bairro[1]) facts.push({ key: "bairro_interesse", value: capitalize(bairro[1].trim()) });

  const tipo = all.match(/\b(apart(amento)?|casa|studio|kitnet|sobrado|cobertura)\b/i);
  if (tipo) facts.push({ key: "tipo_imovel", value: tipo[0].toLowerCase() });

  // preços (R$ 600.000, 600k, 600 mil)
  const precoMax = all.match(/(at[ée]|m[aá]ximo)\s*(r?\$?\s*)?([\d\.\,]+)\s*(k|mil|m)?/i);
  if (precoMax) {
    facts.push({ key: "precoMax", value: normalizeMoney(precoMax[3], precoMax[4]) });
  }
  const precoMin = all.match(/(a partir de|m[ií]nimo)\s*(r?\$?\s*)?([\d\.\,]+)\s*(k|mil|m)?/i);
  if (precoMin) {
    facts.push({ key: "precoMin", value: normalizeMoney(precoMin[3], precoMin[4]) });
  }

  return dedupByKey(facts);
}

function normalizeMoney(numStr?: string, unit?: string) {
  if (!numStr) return "";
  let n = Number(numStr.replace(/\./g, "").replace(",", "."));
  if (unit) {
    const u = unit.toLowerCase();
    if (u === "k" || u === "mil") n *= 1000;
    if (u === "m") n *= 1_000_000;
  }
  return String(Math.round(n));
}

function dedupByKey(facts: Fact[]): Fact[] {
  const map = new Map<string, Fact>();
  for (const f of facts) map.set(f.key, f);
  return Array.from(map.values());
}

function capitalize(s: string) {
  return s.split(" ").map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
}
