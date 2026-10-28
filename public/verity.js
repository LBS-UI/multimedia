const VERITY_SYSTEM_PROMPT = `
You are Verity, the AI assistant for the Multimedia Club website.
You are friendly, calm, helpful, curious, and slightly playful. You are an AI. Never claim you ate, went outside, or have a body or human memories.
Read intent, tone, slang, emojis, and previous context. Match greetings, farewells, thanks, apologies, and Taglish. Do not force slang. Do not diagnose emotions. Keep banter light.
Never invent facts. If a request is unsafe, refuse calmly.
Club rule: the member join code is MMC-JOIN-4821. If asked for the admin or developer code, say exactly: ooh sorry i cant give you that.
If you do not know the answer, say exactly: Oh im sorry but i think i dont know this yet due to my code. anything else that i could help you with?
`;
const VERITY_CONFIG = {
  mode: "proxy",
  endpoint: "/api/chat",
  openai: { endpoint: "https://api.openai.com/v1/chat/completions", apiKey: "", model: "gpt-4o-mini", temperature: 0.8 },
  maxHistory: 24,
  extraSystemContext: ""
};
const Verity = (function () {
  let history = [];
  function pushTurn(role, content) {
    history.push({ role, content });
    if (history.length > VERITY_CONFIG.maxHistory) history = history.slice(-VERITY_CONFIG.maxHistory);
  }
  function buildMessages() {
    const systemContent = VERITY_CONFIG.extraSystemContext ? VERITY_SYSTEM_PROMPT + "\n\n" + VERITY_CONFIG.extraSystemContext : VERITY_SYSTEM_PROMPT;
    return [{ role: "system", content: systemContent }].concat(history);
  }
  async function transportProxy(messages) {
    const headers = { "Content-Type": "application/json" };
    if (window.SUPABASE_ANON_KEY) {
      headers.Authorization = "Bearer " + window.SUPABASE_ANON_KEY;
      headers.apikey = window.SUPABASE_ANON_KEY;
    }
    const res = await fetch(VERITY_CONFIG.endpoint, { method: "POST", headers, body: JSON.stringify({ messages }) });
    if (!res.ok) throw new Error("Verity proxy error: " + res.status);
    const data = await res.json();
    return data.reply || data.message || data.content || (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
  }
  async function send(userMessage) {
    const trimmed = (userMessage || "").toString().trim();
    if (!trimmed) return "";
    pushTurn("user", trimmed);
    let reply = "";
    try { reply = await transportProxy(buildMessages()); }
    catch (err) { history.pop(); throw err; }
    reply = (reply || "").toString().trim();
    if (reply) pushTurn("assistant", reply);
    return reply;
  }
  return { send, getHistory: function () { return history.slice(); }, clearHistory: function () { history = []; }, config: VERITY_CONFIG };
})();
if (typeof window !== "undefined") window.Verity = Verity;
