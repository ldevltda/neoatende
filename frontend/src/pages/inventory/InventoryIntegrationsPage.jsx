import React, { useEffect, useState, useContext } from "react";
import {
  Container, Grid, Paper, Typography, Divider, Button, CircularProgress
} from "@material-ui/core";
import { makeStyles } from "@material-ui/core/styles";
import IntegrationForm from "../../components/inventory/IntegrationForm";
import IntegrationTestModal from "../../components/inventory/IntegrationTestModal";
import api from "../../services/inventoryApi";
import { AuthContext } from "../../context/Auth/AuthContext";

const useStyles = makeStyles((theme) => ({
  root: { paddingTop: theme.spacing(3), paddingBottom: theme.spacing(3) },
  paper: { padding: theme.spacing(2) },
  listItem: {
    padding: theme.spacing(1.5),
    borderRadius: 12,
    border: "1px solid #e8e8e8",
    marginBottom: theme.spacing(1),
    cursor: "pointer",
    "&:hover": { background: "#fafafa" }
  },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between" }
}));

export default function InventoryIntegrationsPage() {
  const classes = useStyles();
  const { user } = useContext(AuthContext); // supõe que você já tem este contexto no projeto
  const token = user?.token;

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [testOpen, setTestOpen] = useState(false);

  // Carregar lista (se já tiver endpoint de GET você pode usar; aqui, como não criamos GET all,
  // a página controla pelo estado local após criação. Se você quiser, crie um GET /inventory/integrations (opcional))
  // Para o MVP, deixo lista controlada no estado e começando vazia.
  // Dica: se quiser persistência, implemente um GET no backend similar ao create.

  const handleCreated = (created) => {
    setList((prev) => [created, ...prev]);
    setSelected(created);
  };

  const handleInfer = async () => {
    if (!selected?.id) return;
    setLoading(true);
    try {
      const { data } = await api.post(`/inventory/integrations/${selected.id}/infer`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelected(data);
      // substitui na lista
      setList((prev) => prev.map((i) => (i.id === data.id ? data : i)));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Container maxWidth="lg" className={classes.root}>
      <Grid container spacing={3}>
        <Grid item xs={12}>
          <Typography variant="h5"><b>Integração de Estoque (Genérica via API)</b></Typography>
          <Typography variant="body2" color="textSecondary">
            Cadastre a URL e credenciais. Depois clique em <b>Inferir</b> para a IA entender a resposta e, por fim, <b>Testar</b>.
          </Typography>
        </Grid>

        <Grid item xs={12} md={4}>
          <Paper className={classes.paper}>
            <div className={classes.header}>
              <Typography variant="subtitle1"><b>Integrações</b></Typography>
            </div>
            <Divider style={{ margin: "12px 0" }} />
            {list.length === 0 && (
              <Typography variant="body2" color="textSecondary">
                Nenhuma integração cadastrada ainda. Crie ao lado ➜
              </Typography>
            )}
            {list.map((item) => (
              <div
                key={item.id}
                className={classes.listItem}
                onClick={() => setSelected(item)}
                style={{
                  borderColor: selected?.id === item.id ? "#08a0db" : "#e8e8e8",
                  background: selected?.id === item.id ? "#f0fbff" : "#fff"
                }}
              >
                <Typography variant="subtitle2"><b>{item.name}</b></Typography>
                <Typography variant="caption" color="textSecondary">
                  #{item.id} • {item.endpoint?.method} • {item.endpoint?.url}
                </Typography>
              </div>
            ))}
            {selected && (
              <>
                <Divider style={{ margin: "12px 0" }} />
                <div style={{ display: "flex", gap: 8 }}>
                  <Button onClick={handleInfer} color="primary" variant="outlined" disabled={loading}>
                    {loading ? <CircularProgress size={18} /> : "Inferir"}
                  </Button>
                  <Button onClick={() => setTestOpen(true)} color="primary" variant="contained" disabled={loading || !selected?.id}>
                    Testar
                  </Button>
                </div>
              </>
            )}
          </Paper>
        </Grid>

        <Grid item xs={12} md={8}>
          <Paper className={classes.paper}>
            <IntegrationForm onCreated={handleCreated} token={token} selected={selected} setSelected={setSelected} />
          </Paper>
        </Grid>
      </Grid>

      <IntegrationTestModal
        open={testOpen}
        onClose={() => setTestOpen(false)}
        integration={selected}
        token={token}
      />
    </Container>
  );
}
