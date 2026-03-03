export interface PortalTemplate {
  id: string;
  name: string;
  description: string;
  preview: {
    bg: string;
    card: string;
    accent: string;
  };
  styles: {
    background: string;
    orb1: string;
    orb2: string;
    cardBg: string;
    cardShadow: string;
    cardTopLine: string;
    titleColor: string;
    subtitleColor: string;
    labelColor: string;
    inputBg: string;
    inputColor: string;
    inputBorder: string;
    buttonBg: string;
    buttonColor: string;
    buttonShadow: string;
    buttonBgLoading: string;
    successBg: string;
    successColor: string;
    errorBg: string;
    errorBorder: string;
    errorColor: string;
    footerBorder: string;
    footerColor: string;
    footerSecondary: string;
    statusColor: string;
    statusLabel: string;
    timeColor: string;
    dateColor: string;
  };
}

export const portalTemplates: PortalTemplate[] = [
  {
    id: "midnight",
    name: "Midnight Blue",
    description: "Diseño oscuro elegante con acentos azules. El clásico.",
    preview: { bg: "hsl(220 25% 10%)", card: "hsl(220 20% 14%)", accent: "hsl(217 91% 60%)" },
    styles: {
      background: "linear-gradient(135deg, hsl(220 25% 8%) 0%, hsl(217 40% 12%) 30%, hsl(220 30% 10%) 60%, hsl(217 35% 15%) 100%)",
      orb1: "radial-gradient(circle, hsl(217 91% 60% / 0.4), transparent 70%)",
      orb2: "radial-gradient(circle, hsl(190 85% 45% / 0.3), transparent 70%)",
      cardBg: "linear-gradient(180deg, hsl(220 20% 14% / 0.95), hsl(220 25% 10% / 0.98))",
      cardShadow: "0 25px 60px -12px hsl(217 91% 60% / 0.15), 0 0 0 1px hsl(220 15% 20% / 0.5)",
      cardTopLine: "linear-gradient(90deg, transparent, hsl(217 91% 60% / 0.5), transparent)",
      titleColor: "hsl(0 0% 95%)",
      subtitleColor: "hsl(220 10% 50%)",
      labelColor: "hsl(220 10% 55%)",
      inputBg: "hsl(220 20% 8% / 0.8)",
      inputColor: "hsl(0 0% 95%)",
      inputBorder: "inset 0 0 0 1px hsl(220 15% 22%)",
      buttonBg: "linear-gradient(135deg, hsl(217 91% 55%), hsl(217 91% 45%))",
      buttonColor: "hsl(0 0% 100%)",
      buttonShadow: "0 4px 14px 0 hsl(217 91% 60% / 0.35)",
      buttonBgLoading: "hsl(217 91% 50% / 0.5)",
      successBg: "hsl(142 76% 45% / 0.15)",
      successColor: "hsl(142 76% 45%)",
      errorBg: "hsl(0 84% 60% / 0.1)",
      errorBorder: "1px solid hsl(0 84% 60% / 0.2)",
      errorColor: "hsl(0 84% 70%)",
      footerBorder: "hsl(220 15% 18%)",
      footerColor: "hsl(220 10% 40%)",
      footerSecondary: "hsl(220 10% 35%)",
      statusColor: "hsl(142 76% 45%)",
      statusLabel: "hsl(220 10% 60%)",
      timeColor: "hsl(220 10% 50%)",
      dateColor: "hsl(220 10% 45%)",
    },
  },
  {
    id: "emerald",
    name: "Emerald Forest",
    description: "Tonos verdes naturales con sensación de frescura.",
    preview: { bg: "hsl(160 30% 8%)", card: "hsl(160 20% 13%)", accent: "hsl(152 76% 45%)" },
    styles: {
      background: "linear-gradient(135deg, hsl(160 30% 6%) 0%, hsl(155 35% 10%) 30%, hsl(160 25% 8%) 60%, hsl(150 30% 12%) 100%)",
      orb1: "radial-gradient(circle, hsl(152 76% 45% / 0.35), transparent 70%)",
      orb2: "radial-gradient(circle, hsl(170 65% 40% / 0.25), transparent 70%)",
      cardBg: "linear-gradient(180deg, hsl(160 18% 13% / 0.95), hsl(160 22% 9% / 0.98))",
      cardShadow: "0 25px 60px -12px hsl(152 76% 45% / 0.12), 0 0 0 1px hsl(160 15% 18% / 0.5)",
      cardTopLine: "linear-gradient(90deg, transparent, hsl(152 76% 45% / 0.5), transparent)",
      titleColor: "hsl(0 0% 95%)",
      subtitleColor: "hsl(160 10% 50%)",
      labelColor: "hsl(160 10% 55%)",
      inputBg: "hsl(160 20% 6% / 0.8)",
      inputColor: "hsl(0 0% 95%)",
      inputBorder: "inset 0 0 0 1px hsl(160 15% 20%)",
      buttonBg: "linear-gradient(135deg, hsl(152 76% 42%), hsl(152 76% 34%))",
      buttonColor: "hsl(0 0% 100%)",
      buttonShadow: "0 4px 14px 0 hsl(152 76% 45% / 0.35)",
      buttonBgLoading: "hsl(152 76% 40% / 0.5)",
      successBg: "hsl(152 76% 45% / 0.15)",
      successColor: "hsl(152 76% 50%)",
      errorBg: "hsl(0 84% 60% / 0.1)",
      errorBorder: "1px solid hsl(0 84% 60% / 0.2)",
      errorColor: "hsl(0 84% 70%)",
      footerBorder: "hsl(160 15% 16%)",
      footerColor: "hsl(160 10% 40%)",
      footerSecondary: "hsl(160 10% 35%)",
      statusColor: "hsl(152 76% 50%)",
      statusLabel: "hsl(160 10% 60%)",
      timeColor: "hsl(160 10% 50%)",
      dateColor: "hsl(160 10% 45%)",
    },
  },
  {
    id: "sunset",
    name: "Sunset Glow",
    description: "Cálidos tonos naranjas y rojos con energía.",
    preview: { bg: "hsl(15 30% 8%)", card: "hsl(15 20% 13%)", accent: "hsl(25 95% 55%)" },
    styles: {
      background: "linear-gradient(135deg, hsl(15 25% 6%) 0%, hsl(20 35% 10%) 30%, hsl(10 28% 8%) 60%, hsl(25 30% 12%) 100%)",
      orb1: "radial-gradient(circle, hsl(25 95% 55% / 0.35), transparent 70%)",
      orb2: "radial-gradient(circle, hsl(350 70% 50% / 0.2), transparent 70%)",
      cardBg: "linear-gradient(180deg, hsl(15 18% 13% / 0.95), hsl(15 22% 9% / 0.98))",
      cardShadow: "0 25px 60px -12px hsl(25 95% 55% / 0.12), 0 0 0 1px hsl(15 15% 18% / 0.5)",
      cardTopLine: "linear-gradient(90deg, transparent, hsl(25 95% 55% / 0.5), transparent)",
      titleColor: "hsl(0 0% 95%)",
      subtitleColor: "hsl(15 10% 50%)",
      labelColor: "hsl(15 10% 55%)",
      inputBg: "hsl(15 20% 6% / 0.8)",
      inputColor: "hsl(0 0% 95%)",
      inputBorder: "inset 0 0 0 1px hsl(15 15% 20%)",
      buttonBg: "linear-gradient(135deg, hsl(25 95% 55%), hsl(15 85% 45%))",
      buttonColor: "hsl(0 0% 100%)",
      buttonShadow: "0 4px 14px 0 hsl(25 95% 55% / 0.35)",
      buttonBgLoading: "hsl(25 95% 50% / 0.5)",
      successBg: "hsl(142 76% 45% / 0.15)",
      successColor: "hsl(142 76% 45%)",
      errorBg: "hsl(0 84% 60% / 0.1)",
      errorBorder: "1px solid hsl(0 84% 60% / 0.2)",
      errorColor: "hsl(0 84% 70%)",
      footerBorder: "hsl(15 15% 16%)",
      footerColor: "hsl(15 10% 40%)",
      footerSecondary: "hsl(15 10% 35%)",
      statusColor: "hsl(142 76% 45%)",
      statusLabel: "hsl(15 10% 60%)",
      timeColor: "hsl(15 10% 50%)",
      dateColor: "hsl(15 10% 45%)",
    },
  },
  {
    id: "aurora",
    name: "Aurora Boreal",
    description: "Gradientes púrpura y cian inspirados en la aurora.",
    preview: { bg: "hsl(270 25% 8%)", card: "hsl(270 18% 14%)", accent: "hsl(280 70% 60%)" },
    styles: {
      background: "linear-gradient(135deg, hsl(270 25% 6%) 0%, hsl(260 35% 10%) 30%, hsl(280 28% 8%) 60%, hsl(250 30% 13%) 100%)",
      orb1: "radial-gradient(circle, hsl(280 70% 60% / 0.35), transparent 70%)",
      orb2: "radial-gradient(circle, hsl(190 80% 50% / 0.25), transparent 70%)",
      cardBg: "linear-gradient(180deg, hsl(270 18% 14% / 0.95), hsl(270 22% 10% / 0.98))",
      cardShadow: "0 25px 60px -12px hsl(280 70% 60% / 0.15), 0 0 0 1px hsl(270 15% 20% / 0.5)",
      cardTopLine: "linear-gradient(90deg, transparent, hsl(280 70% 60% / 0.5), transparent)",
      titleColor: "hsl(0 0% 95%)",
      subtitleColor: "hsl(270 10% 55%)",
      labelColor: "hsl(270 10% 58%)",
      inputBg: "hsl(270 20% 7% / 0.8)",
      inputColor: "hsl(0 0% 95%)",
      inputBorder: "inset 0 0 0 1px hsl(270 15% 22%)",
      buttonBg: "linear-gradient(135deg, hsl(280 70% 55%), hsl(260 65% 45%))",
      buttonColor: "hsl(0 0% 100%)",
      buttonShadow: "0 4px 14px 0 hsl(280 70% 60% / 0.35)",
      buttonBgLoading: "hsl(280 70% 50% / 0.5)",
      successBg: "hsl(142 76% 45% / 0.15)",
      successColor: "hsl(142 76% 45%)",
      errorBg: "hsl(0 84% 60% / 0.1)",
      errorBorder: "1px solid hsl(0 84% 60% / 0.2)",
      errorColor: "hsl(0 84% 70%)",
      footerBorder: "hsl(270 15% 18%)",
      footerColor: "hsl(270 10% 42%)",
      footerSecondary: "hsl(270 10% 36%)",
      statusColor: "hsl(142 76% 45%)",
      statusLabel: "hsl(270 10% 60%)",
      timeColor: "hsl(270 10% 52%)",
      dateColor: "hsl(270 10% 46%)",
    },
  },
  {
    id: "clean-light",
    name: "Clean White",
    description: "Diseño claro y limpio, ideal para ambientes corporativos.",
    preview: { bg: "hsl(220 15% 96%)", card: "hsl(0 0% 100%)", accent: "hsl(217 91% 55%)" },
    styles: {
      background: "linear-gradient(135deg, hsl(220 15% 95%) 0%, hsl(220 20% 92%) 50%, hsl(215 18% 94%) 100%)",
      orb1: "radial-gradient(circle, hsl(217 91% 60% / 0.12), transparent 70%)",
      orb2: "radial-gradient(circle, hsl(190 85% 45% / 0.08), transparent 70%)",
      cardBg: "linear-gradient(180deg, hsl(0 0% 100% / 0.98), hsl(220 15% 98% / 0.95))",
      cardShadow: "0 25px 60px -12px hsl(220 30% 20% / 0.08), 0 0 0 1px hsl(220 15% 88%)",
      cardTopLine: "linear-gradient(90deg, transparent, hsl(217 91% 55% / 0.4), transparent)",
      titleColor: "hsl(220 25% 15%)",
      subtitleColor: "hsl(220 10% 45%)",
      labelColor: "hsl(220 10% 40%)",
      inputBg: "hsl(220 15% 96%)",
      inputColor: "hsl(220 25% 15%)",
      inputBorder: "inset 0 0 0 1px hsl(220 15% 85%)",
      buttonBg: "linear-gradient(135deg, hsl(217 91% 55%), hsl(217 91% 48%))",
      buttonColor: "hsl(0 0% 100%)",
      buttonShadow: "0 4px 14px 0 hsl(217 91% 55% / 0.25)",
      buttonBgLoading: "hsl(217 91% 55% / 0.6)",
      successBg: "hsl(142 76% 45% / 0.1)",
      successColor: "hsl(142 55% 35%)",
      errorBg: "hsl(0 84% 60% / 0.06)",
      errorBorder: "1px solid hsl(0 84% 60% / 0.15)",
      errorColor: "hsl(0 60% 45%)",
      footerBorder: "hsl(220 15% 90%)",
      footerColor: "hsl(220 10% 55%)",
      footerSecondary: "hsl(220 10% 65%)",
      statusColor: "hsl(142 55% 40%)",
      statusLabel: "hsl(220 10% 50%)",
      timeColor: "hsl(220 10% 45%)",
      dateColor: "hsl(220 10% 50%)",
    },
  },
  {
    id: "neon-cyber",
    name: "Neon Cyber",
    description: "Estilo cyberpunk con neones vibrantes.",
    preview: { bg: "hsl(240 20% 5%)", card: "hsl(240 15% 10%)", accent: "hsl(170 100% 50%)" },
    styles: {
      background: "linear-gradient(135deg, hsl(240 20% 4%) 0%, hsl(260 25% 7%) 30%, hsl(240 18% 5%) 60%, hsl(250 22% 8%) 100%)",
      orb1: "radial-gradient(circle, hsl(170 100% 50% / 0.3), transparent 70%)",
      orb2: "radial-gradient(circle, hsl(300 100% 60% / 0.2), transparent 70%)",
      cardBg: "linear-gradient(180deg, hsl(240 15% 10% / 0.95), hsl(240 18% 7% / 0.98))",
      cardShadow: "0 25px 60px -12px hsl(170 100% 50% / 0.12), 0 0 0 1px hsl(170 100% 50% / 0.15)",
      cardTopLine: "linear-gradient(90deg, transparent, hsl(170 100% 50% / 0.7), transparent)",
      titleColor: "hsl(170 100% 85%)",
      subtitleColor: "hsl(240 10% 55%)",
      labelColor: "hsl(170 50% 60%)",
      inputBg: "hsl(240 18% 5% / 0.9)",
      inputColor: "hsl(170 100% 85%)",
      inputBorder: "inset 0 0 0 1px hsl(170 100% 50% / 0.2)",
      buttonBg: "linear-gradient(135deg, hsl(170 100% 45%), hsl(190 100% 40%))",
      buttonColor: "hsl(240 20% 5%)",
      buttonShadow: "0 4px 20px 0 hsl(170 100% 50% / 0.4), 0 0 40px hsl(170 100% 50% / 0.1)",
      buttonBgLoading: "hsl(170 100% 45% / 0.5)",
      successBg: "hsl(170 100% 50% / 0.1)",
      successColor: "hsl(170 100% 55%)",
      errorBg: "hsl(350 100% 55% / 0.1)",
      errorBorder: "1px solid hsl(350 100% 55% / 0.3)",
      errorColor: "hsl(350 100% 70%)",
      footerBorder: "hsl(170 100% 50% / 0.1)",
      footerColor: "hsl(240 10% 45%)",
      footerSecondary: "hsl(240 10% 35%)",
      statusColor: "hsl(170 100% 55%)",
      statusLabel: "hsl(240 10% 60%)",
      timeColor: "hsl(170 80% 55%)",
      dateColor: "hsl(240 10% 50%)",
    },
  },
];

const PORTAL_TEMPLATE_KEY = "portal_template_id";
const PORTAL_LOGO_KEY = "portal_custom_logo";
const PORTAL_TITLE_KEY = "portal_custom_title";

export const getSelectedTemplateId = (): string => {
  return localStorage.getItem(PORTAL_TEMPLATE_KEY) || "midnight";
};

export const setSelectedTemplateId = (id: string) => {
  localStorage.setItem(PORTAL_TEMPLATE_KEY, id);
};

export const getSelectedTemplate = (): PortalTemplate => {
  const id = getSelectedTemplateId();
  return portalTemplates.find((t) => t.id === id) || portalTemplates[0];
};

export const getCustomLogo = (): string | null => {
  return localStorage.getItem(PORTAL_LOGO_KEY);
};

export const setCustomLogo = (dataUrl: string | null) => {
  if (dataUrl) {
    localStorage.setItem(PORTAL_LOGO_KEY, dataUrl);
  } else {
    localStorage.removeItem(PORTAL_LOGO_KEY);
  }
};

export const getCustomTitle = (): string => {
  return localStorage.getItem(PORTAL_TITLE_KEY) || "Portal de Acceso";
};

export const setCustomTitle = (title: string) => {
  localStorage.setItem(PORTAL_TITLE_KEY, title);
};
