// Ready-made settings for OpenAI-compatible servers. Customers bring their own key (or none, for local servers).
export type AiPreset = {
  id: string;
  label: string;
  baseUrl: string;
  needsKey: boolean;
  keyUrl?: string;
  note?: string;
};

export const AI_PRESETS: AiPreset[] = [
  {
    id: "lmstudio",
    label: "LM Studio on this computer",
    baseUrl: "http://localhost:1234/v1",
    needsKey: false,
    note: "Start the server in LM Studio's Developer tab first.",
  },
  {
    id: "ollama",
    label: "Ollama on this computer",
    baseUrl: "http://localhost:11434/v1",
    needsKey: false,
    note: "Ollama must be running.",
  },
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", needsKey: true, keyUrl: "https://platform.openai.com/api-keys" },
  {
    id: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    needsKey: true,
    keyUrl: "https://aistudio.google.com/apikey",
  },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", needsKey: true, keyUrl: "https://openrouter.ai/keys" },
  { id: "groq", label: "Groq", baseUrl: "https://api.groq.com/openai/v1", needsKey: true, keyUrl: "https://console.groq.com/keys" },
  { id: "custom", label: "Other OpenAI-compatible server", baseUrl: "", needsKey: false },
];

export function findPreset(id: string) {
  return AI_PRESETS.find((p) => p.id === id) ?? AI_PRESETS[AI_PRESETS.length - 1];
}
