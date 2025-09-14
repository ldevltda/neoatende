import axios from "axios";

const api = axios.create({
  baseURL: process.env.REACT_APP_BACKEND_URL || "/",
  withCredentials: true
});

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
export async function createIntegration(payload, token) {
  const { data } = await api.post("/inventory/integrations", payload, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return data;
}

export async function inferIntegration(id, token) {
  const { data } = await api.post(`/inventory/integrations/${id}/infer`, {}, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return data;
}

export async function guidedFix(id, fixes, token) {
  const { data } = await api.post(`/inventory/integrations/${id}/guided-fix`, fixes, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return data;
}

export async function searchInventory(id, body, token) {
  const { data } = await api.post(`/inventory/integrations/${id}/search`, body, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return data;
}

export default api;
