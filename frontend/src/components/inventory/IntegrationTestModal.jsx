import React, { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Grid, Typography, CircularProgress
} from "@material-ui/core";
import { searchInventory, safeParse, safeStringify } from "../../services/inventoryApi";

export default function IntegrationTestModal({ open, onClose, integration}) {
  const [text, setText] = useState("");
  const [filters, setFilters] = useState("{}");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  if (!integration) return null;

  const run = async () => {
    setLoading(true);
    try {
      const body = {
        text: text || undefined,
        filtros: safeParse(filters, {}),
        paginacao: { page: Number(page), pageSize: Number(pageSize) }
      };
      const data = await searchInventory(integration.id, body);
      setResult(data);
    } finally {
      setLoading(false);
    }
  };

  const clear = () => setResult(null);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Testar Integração: {integration?.name}</DialogTitle>
      <DialogContent dividers>
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <Typography variant="body2" color="textSecondary">
              Informe um texto (busca livre) e/ou filtros (JSON) e rode o teste. A resposta já vem <b>normalizada</b>.
            </Typography>
          </Grid>

          <Grid item xs={12} md={6}>
            <TextField label="Texto (opcional)" value={text} onChange={(e)=>setText(e.target.value)} fullWidth />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField label="Página" type="number" value={page} onChange={(e)=>setPage(e.target.value)} fullWidth />
          </Grid>
          <Grid item xs={6} md={3}>
            <TextField label="Page Size" type="number" value={pageSize} onChange={(e)=>setPageSize(e.target.value)} fullWidth />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Filtros (JSON)"
              value={filters}
              onChange={(e)=>setFilters(e.target.value)}
              fullWidth multiline rows={4}
              placeholder='{"precoMax":250000,"bairro":"Kobrasol"}'
            />
          </Grid>

          <Grid item xs={12}>
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={run} color="primary" variant="contained" disabled={loading}>
                {loading ? <CircularProgress size={18} /> : "Executar"}
              </Button>
              <Button onClick={clear} disabled={loading}>Limpar</Button>
            </div>
          </Grid>

          {result && (
            <Grid item xs={12}>
              <Typography variant="subtitle2" style={{ marginTop: 8 }}><b>Resultado</b></Typography>
              <pre style={{
                background: "#0f172a", color: "#e5e7eb", padding: 12,
                borderRadius: 8, overflow: "auto", maxHeight: 320
              }}>
{safeStringify(result)}
              </pre>

              {/* Preview simples de cards */}
              {/* <Typography variant="subtitle2" style={{ marginTop: 8 }}><b>Preview</b></Typography> */}
              {/* <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px,1fr))", gap: 12 }}>
                {(result.items || []).map((it) => (
                  <div key={it.id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 8 }}>
                    {it.midias?.[0]?.url && (
                      <div style={{ width: "100%", aspectRatio: "4/3", overflow: "hidden", borderRadius: 8, marginBottom: 8 }}>
                        <img src={it.midias[0].url} alt={it.titulo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                      </div>
                    )}
                    <Typography variant="body2" style={{ fontWeight: 600 }}>{it.titulo || "(sem título)"}</Typography>
                    {it.preco != null && <Typography variant="caption">R$ {Number(it.preco).toLocaleString()}</Typography>}
                    {it.localizacao && (
                      <Typography variant="caption" display="block" color="textSecondary">
                        {[
                          it.localizacao?.bairro,
                          it.localizacao?.cidade,
                          it.localizacao?.uf
                        ].filter(Boolean).join(" • ")}
                      </Typography>
                    )}
                  </div>
                ))}
              </div> */}
            </Grid>
          )}
        </Grid>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
