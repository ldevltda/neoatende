// backend/src/services/IntegrationsServices/AgentToolbox.ts
import axios from "axios";

export async function buscarDadosExternos({
  baseURL,
  token,
  text,
  filtros = {},
  page = 1,
  pageSize = 10,
}: {
  baseURL: string;
  token: string;
  text: string;
  filtros?: Record<string, any>;
  page?: number;
  pageSize?: number;
}) {
  const { data } = await axios.post(
    `${baseURL.replace(/\/$/, "")}/inventory/agent/lookup`,
    { text, filtros, page, pageSize },
    { headers: { Authorization: `Bearer ${token}` } }
  );
  return data;
}
