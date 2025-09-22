const RED_FLAGS = [
  "assunto jurídico", "aconselhar juridicamente",
  "aconselhar financeiramente", "médico",
  "erro crítico", "não consigo resolver",
  "falar com humano", "atendente humano"
];

export function shouldTransferToHuman(aiText: string): boolean {
  const t = (aiText || "").toLowerCase();
  return RED_FLAGS.some(flag => t.includes(flag));
}
