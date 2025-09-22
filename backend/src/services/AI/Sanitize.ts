export function maskPII(text: string): string {
  if (!text) return text;
  let out = text;
  out = out.replace(/\b\d{3}\.?\d{3}\.?\d{3}\-?\d{2}\b/g, "CPF(oculto)");
  out = out.replace(/\b\d{2}\.?\d{3}\.?\d{3}\/\d{4}\-\d{2}\b/g, "CNPJ(oculto)");
  out = out.replace(/\b\d{4,5}\-?\d{4}\b/g, "TEL(oculto)");
  out = out.replace(/\b[\w\.\-]+@[\w\.\-]+\.\w+\b/g, "EMAIL(oculto)");
  return out;
}
