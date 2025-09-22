// Detectores simples e rápidos usados pelo listener (saudação, agradecimento e “cara de inventário”)

export function isGreeting(text: string): boolean {
  const t = norm(text);
  return /\b(oi|ol[aá]|opa|bom\s+dia|boa\s+tarde|boa\s+noite|e\s*a[ií]|fala|tudo\s*bem|td\s*bem)\b/.test(t);
}

export function isThanks(text: string): boolean {
  const t = norm(text);
  return /\b(obrigad[oa]|vlw|valeu|thanks|agrade[cç]o)\b/.test(t);
}

/**
 * Heurística leve para reconhecer intenção de “inventário” (listar/filtrar itens)
 * sem amarrar a um domínio específico.
 */
export function likelyInventory(text: string): boolean {
  const t = norm(text);
  const kw = [
    // termos gerais
    "produto","produtos","item","itens","cat[aá]logo","catalogo","servi[cç]o","op[cç][oõ]es","opcoes",
    "dispon[ií]vel","disponiveis","estoque","listar","mostrar","ver",
    // filtros comuns
    "pre[cç]o","valor","or[cç]amento","entre","at[eé]","no m[aá]ximo","marca","modelo","tamanho","cor","bairro","cidade"
  ];
  const hasKW = kw.some(k => new RegExp(`\\b${k}\\b`).test(t));
  const hasNumber = /\d/.test(t);
  const hasCurrency = /(r\$|\$|€|£)/.test(t);
  const rangeish = /\b(entre|at[eé]|no\s*m[aá]x|m[aá]ximo|min[ií]mo|a partir)\b/.test(t);
  return hasKW || (hasNumber && (hasCurrency || rangeish));
}

function norm(s?: string) {
  return (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}
export default { isGreeting, isThanks, likelyInventory };
