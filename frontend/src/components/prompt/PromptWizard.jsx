// frontend/src/components/prompt/PromptWizard.jsx
import React, { useState } from "react";
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Grid, Chip, IconButton, Tooltip,
  Typography, Box
} from "@material-ui/core";
import { Add, Close } from "@material-ui/icons";
import api from "../../services/api";

const tones = [
  { value: "acolhedor", label: "Acolhedor" },
  { value: "consultivo", label: "Consultivo" },
  { value: "vendas-diretas", label: "Vendas (direto)" },
  { value: "formal", label: "Formal" },
];

const StepHeader = ({ title, subtitle }) => (
  <Box mb={2}>
    <Typography variant="h6" style={{ fontWeight: 700 }}>{title}</Typography>
    {subtitle ? <Typography variant="body2" color="textSecondary">{subtitle}</Typography> : null}
  </Box>
);

export default function PromptWizard({ open, onClose, onGenerated }) {
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);

  const [form, setForm] = useState({
    businessName: "",
    segment: "",              // << campo aberto
    mainGoal: "",
    tone: "consultivo",
    siteUrl: "",
    socialsInput: "",
    socials: [],
    knowledgeNotes: "",
    doNotsInput: "",
    doNots: [],
    typicalQuestionInput: "",
    typicalQuestions: [],
    goodAnswerInput: "",
    goodAnswersExamples: [],
    language: "pt-BR",
    compliance: {
      collectPII: false,
      allowPricing: true,
      allowMedical: false,
      allowLegalAdvice: false,
    },
  });

  const addChip = (listKey, inputKey) => {
    const v = (form[inputKey] || "").trim();
    if (!v) return;
    setForm(prev => ({ ...prev, [listKey]: [...prev[listKey], v], [inputKey]: "" }));
  };
  const removeChip = (listKey, idx) => {
    setForm(prev => ({ ...prev, [listKey]: prev[listKey].filter((_, i) => i !== idx) }));
  };

  const steps = [
    {
      title: "Sobre o negócio",
      content: (
        <Grid container spacing={2}>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Nome do negócio"
              fullWidth
              value={form.businessName}
              onChange={e => setForm({ ...form, businessName: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              label="Segmento / Ramo"
              placeholder="Ex.: Imobiliária, Estética, Clínica, Loja de Veículos..."
              fullWidth
              value={form.segment}
              onChange={e => setForm({ ...form, segment: e.target.value })}
            />
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Objetivo principal do agente"
              placeholder="Ex.: Atender leads e qualificar para visita/WhatsApp"
              fullWidth
              value={form.mainGoal}
              onChange={e => setForm({ ...form, mainGoal: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={8}>
            <TextField
              label="Site (opcional)"
              fullWidth
              value={form.siteUrl}
              onChange={e => setForm({ ...form, siteUrl: e.target.value })}
            />
          </Grid>
          <Grid item xs={12} sm={4}>
            <TextField
              select
              label="Tom de voz"
              fullWidth
              value={form.tone}
              onChange={e => setForm({ ...form, tone: e.target.value })}
            >
              {tones.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </TextField>
          </Grid>
        </Grid>
      ),
    },

    // REMOVIDO o bloco de "Canais"
    {
      title: "Conformidade",
      content: (
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <StepHeader title="Regras de segurança e limites" />
            <Box display="flex" style={{ gap: 8 }} flexWrap="wrap">
              <Button
                variant={form.compliance.allowPricing ? "contained" : "outlined"}
                onClick={() => setForm(p => ({ ...p, compliance: { ...p.compliance, allowPricing: !p.compliance.allowPricing } }))}
              >Pode falar de preço</Button>
              <Button
                variant={form.compliance.allowLegalAdvice ? "contained" : "outlined"}
                onClick={() => setForm(p => ({ ...p, compliance: { ...p.compliance, allowLegalAdvice: !p.compliance.allowLegalAdvice } }))}
              >Pode aconselhar juridicamente</Button>
              <Button
                variant={form.compliance.allowMedical ? "contained" : "outlined"}
                onClick={() => setForm(p => ({ ...p, compliance: { ...p.compliance, allowMedical: !p.compliance.allowMedical } }))}
              >Pode aconselhar saúde</Button>
              <Button
                variant={form.compliance.collectPII ? "contained" : "outlined"}
                onClick={() => setForm(p => ({ ...p, compliance: { ...p.compliance, collectPII: !p.compliance.collectPII } }))}
              >Pode coletar dados pessoais</Button>
            </Box>
          </Grid>
        </Grid>
      ),
    },

    {
      title: "Fontes & Observações",
      content: (
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              label="Redes sociais (adicione uma por vez)"
              placeholder="https://instagram.com/minhaempresa"
              fullWidth
              value={form.socialsInput}
              onChange={e => setForm({ ...form, socialsInput: e.target.value })}
              InputProps={{
                endAdornment: (
                  <Tooltip title="Adicionar"><IconButton onClick={() => addChip("socials", "socialsInput")}><Add/></IconButton></Tooltip>
                ),
              }}
            />
            <Box mt={1}>
              {form.socials.map((s, i) => (
                <Chip key={i} label={s} onDelete={() => removeChip("socials", i)} style={{ marginRight: 6, marginBottom: 6 }} />
              ))}
            </Box>
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Observações/Conhecimento adicional do negócio"
              fullWidth
              multiline
              minRows={4}
              value={form.knowledgeNotes}
              onChange={e => setForm({ ...form, knowledgeNotes: e.target.value })}
            />
          </Grid>
        </Grid>
      ),
    },

    {
      title: "Limites & Perguntas típicas",
      content: (
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              label="Coisas que NÃO deve responder (uma por vez)"
              fullWidth
              value={form.doNotsInput}
              onChange={e => setForm({ ...form, doNotsInput: e.target.value })}
              InputProps={{ endAdornment: (<IconButton onClick={() => addChip("doNots", "doNotsInput")}><Add/></IconButton>) }}
            />
            <Box mt={1}>
              {form.doNots.map((s, i) => (
                <Chip key={i} label={s} onDelete={() => removeChip("doNots", i)} style={{ marginRight: 6, marginBottom: 6 }} />
              ))}
            </Box>
          </Grid>
          <Grid item xs={12}>
            <TextField
              label="Perguntas típicas dos clientes (uma por vez)"
              fullWidth
              value={form.typicalQuestionInput}
              onChange={e => setForm({ ...form, typicalQuestionInput: e.target.value })}
              InputProps={{ endAdornment: (<IconButton onClick={() => addChip("typicalQuestions", "typicalQuestionInput")}><Add/></IconButton>) }}
            />
            <Box mt={1}>
              {form.typicalQuestions.map((s, i) => (
                <Chip key={i} label={s} onDelete={() => removeChip("typicalQuestions", i)} style={{ marginRight: 6, marginBottom: 6 }} />
              ))}
            </Box>
          </Grid>
        </Grid>
      ),
    },

    {
      title: "Exemplos de boas respostas",
      content: (
        <Grid container spacing={2}>
          <Grid item xs={12}>
            <TextField
              label="Cole um exemplo (uma por vez)"
              fullWidth
              value={form.goodAnswerInput}
              onChange={e => setForm({ ...form, goodAnswerInput: e.target.value })}
              InputProps={{ endAdornment: (<IconButton onClick={() => addChip("goodAnswersExamples", "goodAnswerInput")}><Add/></IconButton>) }}
            />
            <Box mt={1}>
              {form.goodAnswersExamples.map((s, i) => (
                <Chip key={i} label={s} onDelete={() => removeChip("goodAnswersExamples", i)} style={{ marginRight: 6, marginBottom: 6 }} />
              ))}
            </Box>
          </Grid>
        </Grid>
      ),
    },
  ];

  const handleNext = () => setStep(s => Math.min(s + 1, steps.length - 1));
  const handlePrev = () => setStep(s => Math.max(s - 1, 0));

  const handleGenerate = async () => {
    setLoading(true);
    try {
      const payload = {
        businessName: form.businessName,
        segment: form.segment,
        mainGoal: form.mainGoal,
        tone: form.tone,
        siteUrl: form.siteUrl || null,
        socials: form.socials,
        knowledgeNotes: form.knowledgeNotes,
        doNots: form.doNots,
        typicalQuestions: form.typicalQuestions,
        goodAnswersExamples: form.goodAnswersExamples,
        language: "pt-BR",
        compliance: form.compliance,
        // sem channelHints
      };
      const { data } = await api.post("/openai/prompts/generate", payload);
      if (onGenerated) onGenerated(data);
      if (onClose) onClose();
    } finally {
      setLoading(false);
    }
  };

  const isLast = step >= steps.length - 1;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>
        Gerar Prompt Inteligente
        <IconButton onClick={onClose} style={{ position: "absolute", right: 8, top: 8 }}>
          <Close/>
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <StepHeader
          title={`${step + 1}/${steps.length} — ${steps[step].title}`}
          subtitle="Preencha rapidamente; você pode pular itens e editar depois."
        />
        {steps[step].content}
      </DialogContent>
      <DialogActions>
        <Button onClick={handlePrev} disabled={step === 0}>Voltar</Button>
        {!isLast ? (
          <Button color="primary" variant="contained" onClick={handleNext}>Continuar</Button>
        ) : (
          <Button color="primary" variant="contained" onClick={handleGenerate} disabled={loading}>
            {loading ? "Gerando..." : "Gerar Prompt"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
