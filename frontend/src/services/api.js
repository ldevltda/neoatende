import axios from "axios";

const baseURL =
  process.env.REACT_APP_BACKEND_URL || window.location.origin;

const api = axios.create({
  baseURL,
  withCredentials: true,
});

export const openApi = axios.create({
  baseURL,
});

export default api;
