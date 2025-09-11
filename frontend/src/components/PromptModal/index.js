// frontend/src/components/PromptModal/index.js
import React, { useEffect, useState } from "react";
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Grid,
  MenuItem,
} from "@material-ui/core";
import api from "../../services/api";
import PromptWizard from "../prompt/PromptWizard";

export default function PromptModal({ open, onClose, promptId, refreshPrompts }) {
  const [values, setValues] = useState({
    name: "",
    apiKey: "",
    prompt: "",
    model: "gpt-3.5-turbo",
    temperature: 1,
    maxTokens: 100,
    historyMessages: 10,
    queueId: "",
  });

  const [wizardOpen, setWizardOpen] = useState(false);

  // Carrega prompt para edição
  useEffect(() => {
    async function load() {
      try {
        const { data } = await api.get(`/prompt/${promptId}`);
        setValues({
          name: data.name || "",
          apiKey: data.apiKey || "",
          prompt: data.prompt || "",
          model: data.model || "gpt-3.5-turbo",
          temperature: typeof data.temperature === "number" ? data.temperature : 1,
          maxTokens: typeof data.maxTokens === "number" ? data.maxTokens : 100,
          historyMessages:
            typeof data.historyMessages === "number" ? data.historyMessages : 10,
          queueId: data.queueId || "",
        });
      } catch (e) {
        // silencioso; o modal pode ser de criação
      }
    }

    if (open && promptId) {
      load();
    }
    // ao abrir para criar, zera os campos
    if (open && !promptId) {
      setValues({
        name: "",
        apiKey: "",
        prompt: "",
        model: "gpt-3.5-turbo",
        temperature: 1,
        maxTokens: 100,
        historyMessages: 10,
        queueId: "",
      });
    }
  }, [open, promptId]);

  async function handleSave() {
    if (promptId) {
      await api.put(`/prompt/${promptId}`, values);
    } else {
      await api.post("/prompt", values);
    }
    if (typeof refreshPrompts === "function") {
      await refreshPrompts();
    }
    if (typeof onClose === "function") {
      onClose();
    }
  }

  // callback do wizard
  function handleGenerated(data) {
    setValues((prev) => {
      const next = { ...prev, prompt: data.prompt };
      if (!prev.name || prev.name.trim() === "") {
        next.name = data.summary;
      }
      return next;
    });
  }

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
        <DialogTitle>{promptId ? "Editar Prompt" : "Adicionar Prompt"}</DialogTitle>

        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={8}>
              <TextField
                label="Nome"
                fullWidth
                value={values.name}
                onChange={(e) => setValues({ ...values, name: e.target.value })}
              />
            </Grid>
            <Grid item xs={12} sm={4}>
              <Button
                fullWidth
                variant="outlined"
                style={{ height: 56, marginTop: 4 }}
                onClick={() => setWizardOpen(true)}
              >
                Gerar Prompt Inteligente
              </Button>
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="API Key"
                type="password"
                fullWidth
                value={values.apiKey}
                onChange={(e) => setValues({ ...values, apiKey: e.target.value })}
              />
            </Grid>

            <Grid item xs={12}>
              <TextField
                label="Prompt"
                fullWidth
                multiline
                minRows={10}
                value={values.prompt}
                onChange={(e) => setValues({ ...values, prompt: e.target.value })}
              />
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField
                select
                label="Modelo"
                fullWidth
                value={values.model}
                onChange={(e) => setValues({ ...values, model: e.target.value })}
              >
                <MenuItem value="gpt-3.5-turbo">GPT-3.5 Turbo</MenuItem>
                <MenuItem value="gpt-4o-mini">GPT-4o mini</MenuItem>
                <MenuItem value="gpt-4o">GPT-4o</MenuItem>
              </TextField>
            </Grid>

            <Grid item xs={12} sm={3}>
              <TextField
                label="Temperatura"
                type="number"
                fullWidth
                value={values.temperature}
                onChange={(e) =>
                  setValues({ ...values, temperature: Number(e.target.value) })
                }
              />
            </Grid>

            <Grid item xs={12} sm={3}>
              <TextField
                label="Máx. Tokens Resposta"
                type="number"
                fullWidth
                value={values.maxTokens}
                onChange={(e) =>
                  setValues({ ...values, maxTokens: Number(e.target.value) })
                }
              />
            </Grid>

            <Grid item xs={12} sm={3}>
              <TextField
                label="Máx. mensagens no histórico"
                type="number"
                fullWidth
                value={values.historyMessages}
                onChange={(e) =>
                  setValues({ ...values, historyMessages: Number(e.target.value) })
                }
              />
            </Grid>
            {/* se existir seleção de fila/queue no seu modal original, mantenha aqui */}
          </Grid>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose}>Cancelar</Button>
          <Button color="primary" variant="contained" onClick={handleSave}>
            {promptId ? "Salvar" : "Adicionar"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Wizard */}
      <PromptWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        onGenerated={handleGenerated}
      />
    </>
  );
}
