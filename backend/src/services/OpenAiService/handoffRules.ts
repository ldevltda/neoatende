export type HandoffSignals = {
  plannerConfidence?: number;
  consecutiveLowConfidence?: number;
  consecutiveNoResults?: number;
  explicitFrustration?: boolean;
  legalAccountingRisk?: boolean;
  humanRequested?: boolean;
};

export function shouldHandoff(sig: HandoffSignals) {
  if (sig.humanRequested) return true;
  if (sig.legalAccountingRisk) return true;
  if ((sig.consecutiveLowConfidence || 0) >= 2) return true;
  if ((sig.consecutiveNoResults || 0) >= 2) return true;
  if (sig.explicitFrustration) return true;
  return false;
}
