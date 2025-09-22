// backend/src/services/WbotServices/listeners/helpers.ts
import fs from "fs";
import path from "path";

/** Espera N ms */
export function timeout(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
export async function sleep(time: number): Promise<void> {
  await timeout(time);
}

/** Gera um ID aleatório alfanumérico */
export function makeid(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/** Mantém somente letras, números, acentos comuns e pontuação básica */
export function keepOnlySpecifiedChars(str: string): string {
  return String(str).replace(
    /[^a-zA-Z0-9áéíóúÁÉÍÓÚâêîôûÂÊÎÔÛãõÃÕçÇ!?.,;:\s]/g,
    ""
  );
}

/** Limpa nome para uso em arquivo/campo: primeira palavra, sem símbolos, máx 60 chars */
export function sanitizeName(name: string): string {
  const first = String(name || "").trim().split(/\s+/)[0] ?? "";
  const sanitized = first.replace(/[^a-zA-Z0-9]/g, "");
  return sanitized.substring(0, 60);
}

/** Garante a existência da pasta /public no backend */
export function ensurePublicFolder(): string {
  const publicFolder = path.resolve(__dirname, "..", "..", "..", "public");
  if (!fs.existsSync(publicFolder)) {
    fs.mkdirSync(publicFolder, { recursive: true });
  }
  return publicFolder;
}

/** Remove arquivo (se existir) com tratamento de erro */
export function deleteFileSync(filePath: string): void {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error("Erro ao deletar o arquivo:", error);
  }
}

/** Verifica se o nome do arquivo já contém o título como legenda */
export function hasCaption(title: string, fileName: string): boolean {
  const t = String(title || "").trim();
  const f = String(fileName || "").trim();
  if (!t || !f) return false;

  const lastDot = f.lastIndexOf(".");
  const ext = lastDot >= 0 ? f.substring(lastDot + 1) : "";
  // true => ainda precisa legenda (não contém "titulo.ext" dentro do nome)
  return !f.toLowerCase().includes(`${t}.${ext}`.toLowerCase());
}

/* =========================
   CPF / CNPJ VALIDATORS
   ========================= */

/** Remove tudo que não é dígito */
function onlyDigits(v: string): string {
  return String(v || "").replace(/\D+/g, "");
}

function toIntArray(digits: string): number[] {
  // garante números para operações aritméticas (evita “number vs string”)
  return digits.split("").map((c) => parseInt(c, 10));
}

function validateCPF(raw: string): boolean {
  const digits = onlyDigits(raw);
  if (digits.length !== 11) return false;

  // rejeita sequências
  if (/^(\d)\1{10}$/.test(digits)) return false;

  const n = toIntArray(digits);

  // d1
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += n[i] * (10 - i);
  let d1 = (sum * 10) % 11;
  if (d1 === 10) d1 = 0;
  if (d1 !== n[9]) return false;

  // d2
  sum = 0;
  for (let i = 0; i < 10; i++) sum += n[i] * (11 - i);
  let d2 = (sum * 10) % 11;
  if (d2 === 10) d2 = 0;
  return d2 === n[10];
}

function validateCNPJ(raw: string): boolean {
  const digits = onlyDigits(raw);
  if (digits.length !== 14) return false;

  // rejeita sequências
  if (/^(\d)\1{13}$/.test(digits)) return false;

  const n = toIntArray(digits);
  const calc = (base: number[]) => {
    let i = 0;
    let p1 = 5, p2 = 13;
    let s = 0;
    while (i < base.length) {
      if (p1 >= 2) s += base[i] * p1--;
      else s += base[i] * p2--;
      i++;
    }
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };

  const d1 = calc(n.slice(0, 12));
  if (d1 !== n[12]) return false;

  // para o segundo dígito muda o início
  let i = 0;
  let p1 = 6, p2 = 14, s = 0;
  while (i < 13) {
    if (p1 >= 2) s += n[i] * p1--;
    else s += n[i] * p2--;
    i++;
  }
  const r = s % 11;
  const d2 = r < 2 ? 0 : 11 - r;

  return d2 === n[13];
}

/** Valida CPF (11) ou CNPJ (14) */
export function validaCpfCnpj(val: string): boolean {
  const digits = onlyDigits(val);
  if (digits.length === 11) return validateCPF(digits);
  if (digits.length === 14) return validateCNPJ(digits);
  return false;
}
