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
import { toast } from "react-toastify";
import toastError from "../../errors/toastError";
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

  const [queues, setQueues] = useState([]);
  const [wizardOpen, setWizardOpen] = useState(false);

  // Carrega filas para permitir escolher uma (e já sugerir a primeira)
  useEffect(() => {
    async function loadQueues() {
      try {
        // ajuste a rota se no seu backend for /queues em vez de /queue
        const { data } = await api.get("/queue");
        const list = data?.queues || data || [];
        setQueues(list);
        // se estamos criando e não há fila definida, seta a primeira
        if (open && !promptId && list.length && !values.queueId) {
          setValues((prev) => ({ ...prev, queueId: list[0].id }));
        }
      } catch (e) {
        // sem filas ou rota diferente — segue sem quebrar
      }
    }
    if (open) loadQueues();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, promptId]);

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
             typeof data.maxMessages === "number"
               ? data.maxMessages
               : (typeof data.historyMessages === "number" ? data.historyMessages : 10),
          // backend costuma mandar queueId direto; se vier dentro de queue, usa queue.id
          queueId: data.queueId || data.queue?.id || "",
        });
      } catch (e) {
        // modal pode ser de criação
      }
    }

    if (open && promptId) {
      load();
    }
    if (open && !promptId) {
      // reset quando abrir para criar
      setValues({
        name: "",
        apiKey: "",
        prompt: "",
        model: "gpt-3.5-turbo",
        temperature: 1,
        maxTokens: 100,
        historyMessages: 10,
        queueId: "", // será preenchido pelo loadQueues se houver
      });
    }
  }, [open, promptId]);

  async function handleSave() {
    try {
      if (!values.name?.trim()) {
        toast.error("Informe o nome do prompt");
        return;
      }
      if (!values.queueId) {
        toast.error("Selecione uma fila para o prompt");
        return;
      }
      const payload = {
        ...values,
        maxMessages: Number(values.historyMessages), // << exigido pelo backend
        maxTokens: Number(values.maxTokens),
        temperature: Number(values.temperature),
        queueId: Number(values.queueId),
      };
      delete payload.historyMessages; // não enviar a chave antiga
      if (promptId) {
        await api.put(`/prompt/${promptId}`, payload);
        toast.success("Prompt atualizado!");
      } else {
        await api.post("/prompt", payload);
        toast.success("Prompt criado!");
      }

      if (typeof refreshPrompts === "function") {
        await refreshPrompts();
      }
      if (typeof onClose === "function") {
        onClose();
      }
    } catch (err) {
      // agora você vê o erro real (ex.: queueId obrigatório, validação, etc.)
      toastError(err);
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

            {/* Seleção de fila (requerido pelo backend na maioria dos casos) */}
            {queues.length > 0 && (
              <Grid item xs={12} sm={6}>
                <TextField
                  select
                  label="Fila"
                  fullWidth
                  value={values.queueId}
                  onChange={(e) => setValues({ ...values, queueId: e.target.value })}
                >
                  {queues.map((q) => (
                    <MenuItem key={q.id} value={q.id}>
                      {q.name}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
            )}

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
