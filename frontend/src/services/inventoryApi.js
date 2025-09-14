// frontend/src/services/inventoryApi.js
import api from "./api"; // usa o axios global JÁ autenticado

// Helpers
export const safeParse = (txt, fallback = {}) => {
  try {
    if (typeof txt === "object") return txt;
    if (!txt || !String(txt).trim()) return fallback;
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
};
export const safeStringify = (obj) => {
  try {
    return JSON.stringify(obj ?? {}, null, 2);
  } catch {
    return "{}";
  }
};

// CRUD
export async function createIntegration(payload) {
  const { data } = await api.post("/inventory/integrations", payload);
  return data;
}

export async function inferIntegration(id) {
  const { data } = await api.post(`/inventory/integrations/${id}/infer`, {});
  return data;
}

export async function guidedFix(id, fixes) {
  const { data } = await api.post(`/inventory/integrations/${id}/guided-fix`, fixes);
  return data;
}

export async function searchInventory(id, body) {
  const { data } = await api.post(`/inventory/integrations/${id}/search`, body);
  return data;
}

export default api;
