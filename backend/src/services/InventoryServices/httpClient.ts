import axios, { AxiosRequestConfig } from "axios";

export async function httpRequest(config: AxiosRequestConfig) {
  const client = axios.create({
    timeout: (config.timeout as number) || 8000,
    validateStatus: () => true
  });
  const res = await client.request(config);
  return {
    status: res.status,
    headers: res.headers,
    data: res.data
  };
}
