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

// 🔑 Interceptor para garantir token válido (ou nenhum)
api.interceptors.request.use(
  async config => {
    const token = localStorage.getItem("token") || window?.token;

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    } else {
      // remove Authorization se não existir token
      if (config.headers && "Authorization" in config.headers) {
        delete config.headers.Authorization;
      }
    }

    config.withCredentials = true;
    return config;
  },
  error => Promise.reject(error)
);

export default api;
