// frontend/src/components/PromptModal/index.js
import React, { useEffect, useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Grid, MenuItem
} from "@material-ui/core";
import PromptWizard from "../prompt/PromptWizard";
import api from "../../services/api";

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

  useEffect(() => {
    const load = async () => {
      if (!promptId) return;
      const { data } = await api.get(`/prompt/${promptId}`);
      setValues({
        name: data.name,
        apiKey: data.apiKey || "",
        prompt: data.prompt || "",
        model: data.model || "gpt-3.5-turbo",
        temperature: data.temperature ?? 1,
        maxTokens: data.maxTokens ?? 100,
        historyMessages: data.historyMessages ?? 10,
        queueId: data.queueId || "",
      });
    };
    load();
  }, [promptId]);

  const handleSave = async () => {
    if (promptId) {
      await api.put(`/prompt/${promptId}`, values);
    } else {
      await api.post("/prompt", values);
    }
    await refreshPrompts?.();
    onClose?.();
  };

  const handleGenerated = (data) => {
    // data: { prompt, summary, meta }
    setValues(prev => ({
      ...prev,
      prompt: data.prompt,
      name: prev.name || data.summary, // se não tiver nome, usa o resumo
      // Se quiser guardar meta: metaJson: JSON.stringify(data.meta)
    }));
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
        <DialogTitle>{promptId ? "Editar Prompt" : "Adicionar Prompt"}</DialogTitle>
        <DialogContent dividers>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={8}>
              <TextField label="Nome" fullWidth value={values.name}
                onChange={e=>setValues({ ...values, name:e.target.value })}/>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Button fullWidth variant="outlined" style={{ height: 56, marginTop: 4 }}
                onClick={()=>setWizardOpen(true)}>
                Gerar Prompt Inteligente
              </Button>
            </Grid>

            <Grid item xs={12}>
              <TextField label="API Key" fullWidth type="password" value={values.apiKey}
                onChange={e=>setValues({ ...values, apiKey:e.target.value })}/>
            </Grid>

            <Grid item xs={12}>
              <TextField label="Prompt" fullWidth multiline minRows={10} value={values.prompt}
                onChange={e=>setValues({ ...values, prompt:e.target.value })}/>
            </Grid>

            <Grid item xs={12} sm={6}>
              <TextField select label="Modelo" fullWidth value={values.model}
                onChange={e=>setValues({ ...values, model:e.target.value })}>
                <MenuItem value="gpt-3.5-turbo">GPT-3.5 Turbo</MenuItem>
                <MenuItem value="gpt-4o-mini">GPT-4o mini</MenuItem>
                <MenuItem value="gpt-4o">GPT-4o</MenuItem>
              </TextField>
            </Grid>

            <Grid item xs={12} sm={3}>
              <TextField label="Temperatura" type="number" fullWidth value={values.temperature}
                onChange={e=>setValues({ ...values, temperature:Number(e.target.value) })}/>
            </Grid>
            <Grid item xs={12} sm={3}>
              <TextField label="Máx. Tokens Resposta" type="number" fullWidth value={values.maxTokens}
                onChange={e=>setValues({ ...values, maxTokens:Number(e.target.value) })}/>
            </Grid>

            <Grid item xs={12} sm={3}>
              <TextField label="Máx. mensagens no histórico" type="number" fullWidth value={values.historyMessages}
                onChange={e=>setValues({ ...values, historyMessages:Number(e.target.value) })}/>
            </Grid>
            {/* Se você tem seleção de Fila/Queue, mantenha aqui */}
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancelar</Button>
          <Button color="primary" variant="contained" onClick={handleSave}>
            {promptId ? "Salvar" : "Adicionar"}
          </Button>
        </DialogActions>
      </Dialog>

      <PromptWizard
        open={wizardOpen}
        onClose={()=>setWizardOpen(false)}
        onGenerated={handleGenerated}
      />
    </>
  );
}
