// src/services/api.js
import axios from "axios";

const isDev = process.env.NODE_ENV === "development";

// DEV: usa REACT_APP_DEV_API_URL ou localhost:8080
// PROD: usa REACT_APP_API_URL ou a própria origem (caso haja reverse proxy)
const baseURL = isDev
  ? (process.env.REACT_APP_DEV_API_URL || "http://localhost:8080")
  : (process.env.REACT_APP_API_URL || window.location.origin);

export const api = axios.create({
  baseURL,
  withCredentials: true,
});

export const openApi = axios.create({ baseURL });

export async function listIntegrations() {
  const { data } = await api.get("/inventory/integrations");
  return data;
}

export default api;
