import React, { useEffect, useState } from "react";
import {
  TextField, Grid, MenuItem, Button, Typography, Divider
} from "@material-ui/core";
import { createIntegration, safeParse, safeStringify } from "../../services/inventoryApi";

const METHODS = ["GET", "POST"];
const AUTH_TYPES = ["none", "api_key", "bearer", "basic"];
const AUTH_IN = ["header", "query"];
const PAG_STRAT = ["none", "page", "offset", "cursor"];

const initialState = {
  name: "",
  categoryHint: "",
  endpoint: {
    method: "GET",
    url: "",
    default_query: {},
    default_body: {},
    headers: {},
    timeout_s: 8
  },
  auth: {
    type: "none",
    in: "header",
    name: "",
    prefix: "",
    key: "",
    username: "",
    password: ""
  },
  pagination: {
    strategy: "page",
    page_param: "page",
    size_param: "limit",
    offset_param: "offset",
    cursor_param: "",
    page_size_default: 20
  }
};

export default function IntegrationForm({ onCreated, selected, setSelected }) {
  const [form, setForm] = useState(initialState);
  const [jsonQuery, setJsonQuery] = useState("{}");
  const [jsonBody, setJsonBody] = useState("{}");
  const [jsonHeaders, setJsonHeaders] = useState("{}");

  useEffect(() => {
    if (selected) {
      const f = {
        name: selected.name || "",
        categoryHint: selected.categoryHint || "",
        endpoint: {
          method: selected.endpoint?.method || "GET",
          url: selected.endpoint?.url || "",
          default_query: selected.endpoint?.default_query || {},
          default_body: selected.endpoint?.default_body || {},
          headers: selected.endpoint?.headers || {},
          timeout_s: selected.endpoint?.timeout_s || 8
        },
        auth: {
          type: selected.auth?.type || "none",
          in: selected.auth?.in || "header",
          name: selected.auth?.name || "",
          prefix: selected.auth?.prefix || "",
          key: selected.auth?.key || "",
          username: selected.auth?.username || "",
          password: selected.auth?.password || ""
        },
        pagination: {
          strategy: selected.pagination?.strategy || "page",
          page_param: selected.pagination?.page_param || "page",
          size_param: selected.pagination?.size_param || "limit",
          offset_param: selected.pagination?.offset_param || "offset",
          cursor_param: selected.pagination?.cursor_param || "",
          page_size_default: selected.pagination?.page_size_default || 20
        }
      };
      setForm(f);
      setJsonQuery(safeStringify(f.endpoint.default_query));
      setJsonBody(safeStringify(f.endpoint.default_body));
      setJsonHeaders(safeStringify(f.endpoint.headers));
    } else {
      setForm(initialState);
      setJsonQuery("{}");
      setJsonBody("{}");
      setJsonHeaders("{}");
    }
  }, [selected]);

  const handleChange = (path) => (e) => {
    const value = e.target.value;
    setForm((prev) => {
      const copy = { ...prev };
      const segs = path.split(".");
      let cur = copy;
      for (let i = 0; i < segs.length - 1; i++) cur = cur[segs[i]];
      cur[segs[segs.length - 1]] = value;
      return copy;
    });
  };

  const handleCreate = async () => {
    const payload = {
      ...form,
      endpoint: {
        ...form.endpoint,
        default_query: safeParse(jsonQuery, {}),
        default_body: safeParse(jsonBody, {}),
        headers: safeParse(jsonHeaders, {})
      }
    };
    const created = await createIntegration(payload);
    onCreated(created);
    setSelected(created);
  };

  return (
    <>
      <Typography variant="subtitle1"><b>Nova/Editar Integração</b></Typography>
      <Divider style={{ margin: "12px 0" }} />

      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <TextField label="Nome" value={form.name} onChange={handleChange("name")} fullWidth />
        </Grid>
        <Grid item xs={12} md={3}>
          <TextField label="Dica de Categoria" placeholder="imovel|carro|produto"
            value={form.categoryHint} onChange={handleChange("categoryHint")} fullWidth />
        </Grid>

        <Grid item xs={12} md={3}>
          <TextField select label="Método" value={form.endpoint.method} onChange={handleChange("endpoint.method")} fullWidth>
            {METHODS.map(m => <MenuItem key={m} value={m}>{m}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid item xs={12} md={9}>
          <TextField label="URL do Endpoint" value={form.endpoint.url} onChange={handleChange("endpoint.url")} fullWidth />
        </Grid>

        <Grid item xs={12} md={4}>
          <TextField label="Timeout (s)" type="number" value={form.endpoint.timeout_s} onChange={handleChange("endpoint.timeout_s")} fullWidth />
        </Grid>

        <Grid item xs={12} md={4}>
          <TextField select label="Auth Type" value={form.auth.type} onChange={handleChange("auth.type")} fullWidth>
            {AUTH_TYPES.map(a => <MenuItem key={a} value={a}>{a}</MenuItem>)}
          </TextField>
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField select label="Auth In" value={form.auth.in} onChange={handleChange("auth.in")} fullWidth disabled={form.auth.type==="none" || form.auth.type==="bearer" || form.auth.type==="basic"}>
            {AUTH_IN.map(a => <MenuItem key={a} value={a}>{a}</MenuItem>)}
          </TextField>
        </Grid>

        {form.auth.type === "api_key" && (
          <>
            <Grid item xs={12} md={6}>
              <TextField label="Nome do Header/Query (ex: key)" value={form.auth.name} onChange={handleChange("auth.name")} fullWidth />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField label="Valor da Chave" value={form.auth.key} onChange={handleChange("auth.key")} fullWidth />
            </Grid>
          </>
        )}

        {form.auth.type === "bearer" && (
          <>
            <Grid item xs={12} md={6}>
              <TextField label="Prefixo (opcional)" placeholder="Bearer " value={form.auth.prefix} onChange={handleChange("auth.prefix")} fullWidth />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField label="Token" value={form.auth.key} onChange={handleChange("auth.key")} fullWidth />
            </Grid>
          </>
        )}

        {form.auth.type === "basic" && (
          <>
            <Grid item xs={12} md={6}>
              <TextField label="Username" value={form.auth.username} onChange={handleChange("auth.username")} fullWidth />
            </Grid>
            <Grid item xs={12} md={6}>
              <TextField label="Password" type="password" value={form.auth.password} onChange={handleChange("auth.password")} fullWidth />
            </Grid>
          </>
        )}

        <Grid item xs={12} md={4}>
          <TextField select label="Paginação" value={form.pagination.strategy} onChange={handleChange("pagination.strategy")} fullWidth>
            {PAG_STRAT.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
          </TextField>
        </Grid>
        {form.pagination.strategy === "page" && (
          <>
            <Grid item xs={12} md={4}>
              <TextField label="Param Página" value={form.pagination.page_param} onChange={handleChange("pagination.page_param")} fullWidth />
            </Grid>
            <Grid item xs={12} md={4}>
              <TextField label="Param Tamanho" value={form.pagination.size_param} onChange={handleChange("pagination.size_param")} fullWidth />
            </Grid>
          </>
        )}
        {form.pagination.strategy === "offset" && (
          <Grid item xs={12} md={4}>
            <TextField label="Param Offset" value={form.pagination.offset_param} onChange={handleChange("pagination.offset_param")} fullWidth />
          </Grid>
        )}
        <Grid item xs={12} md={4}>
          <TextField label="Page Size Padrão" type="number" value={form.pagination.page_size_default} onChange={handleChange("pagination.page_size_default")} fullWidth />
        </Grid>

        <Grid item xs={12} md={4}>
          <TextField label="Default Query (JSON)" value={jsonQuery} onChange={(e)=>setJsonQuery(e.target.value)} fullWidth multiline rows={4} />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField label="Default Body (JSON)" value={jsonBody} onChange={(e)=>setJsonBody(e.target.value)} fullWidth multiline rows={4} />
        </Grid>
        <Grid item xs={12} md={4}>
          <TextField label="Headers (JSON)" value={jsonHeaders} onChange={(e)=>setJsonHeaders(e.target.value)} fullWidth multiline rows={4} />
        </Grid>

        <Grid item xs={12}>
          <Divider style={{ margin: "12px 0" }} />
          <div style={{ display: "flex", gap: 12 }}>
            <Button color="primary" variant="contained" onClick={handleCreate}>
              {selected ? "Salvar como nova integração" : "Criar integração"}
            </Button>
          </div>
        </Grid>
      </Grid>
    </>
  );
}
