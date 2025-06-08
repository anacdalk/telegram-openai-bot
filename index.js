const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;
const SENHA_SECRETA = "eloseducacionalcruzce"; // 🔐 Defina aqui sua senha

const app = express();
app.use(bodyParser.json());

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;
const OPENAI_BASE_URL = "https://api.openai.com/v1";

const HEADERS = {
  Authorization: `Bearer ${OPENAI_API_KEY}`,
  "OpenAI-Beta": "assistants=v2",
  "Content-Type": "application/json",
};

// Delay auxiliar
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Lista de chat_ids autorizados (em memória)
const chatIdsAutorizados = new Set();

app.post("/webhook", async (req, res) => {
  const message = req.body?.message;
  const chatId = message?.chat?.id;
  const userMessage = message?.text;

  if (!chatId || !userMessage) {
    return res.sendStatus(400);
  }

  // Verifica se o chat está autorizado
  if (!chatIdsAutorizados.has(chatId)) {
    if (userMessage === SENHA_SECRETA) {
      chatIdsAutorizados.add(chatId);
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "✅ Acesso autorizado! Pode enviar suas perguntas.",
      });
    } else {
      await axios.post(`${TELEGRAM_API}/sendMessage`, {
        chat_id: chatId,
        text: "🔒 Este bot é restrito. Envie a senha de acesso.",
      });
    }
    return res.sendStatus(200);
  }

  try {
    // Cria thread
    const threadRes = await axios.post(`${OPENAI_BASE_URL}/threads`, {}, { headers: HEADERS });
    const threadId = threadRes.data.id;

    // Envia mensagem do usuário
    await axios.post(
      `${OPENAI_BASE_URL}/threads/${threadId}/messages`,
      { role: "user", content: userMessage },
      { headers: HEADERS }
    );

    // Inicia o assistente
    const runRes = await axios.post(
      `${OPENAI_BASE_URL}/threads/${threadId}/runs`,
      { assistant_id: OPENAI_ASSISTANT_ID },
      { headers: HEADERS }
    );

    const runId = runRes.data.id;

    // Aguarda conclusão
    let status = "queued";
    while (status !== "completed" && status !== "failed") {
      await delay(2000);
      const statusRes = await axios.get(`${OPENAI_BASE_URL}/threads/${threadId}/runs/${runId}`, {
        headers: HEADERS,
      });
      status = statusRes.data.status;
    }

    if (status === "failed") {
      throw new Error("Falha na execução da Assistant");
    }

    // Resposta
    const messagesRes = await axios.get(`${OPENAI_BASE_URL}/threads/${threadId}/messages`, {
      headers: HEADERS,
    });

    const reply =
      messagesRes.data?.data?.[0]?.content?.[0]?.text?.value || "Desculpe, não consegui responder.";

    // Envia no Telegram
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: reply,
    });

    res.sendStatus(200);
  } catch (error) {
    console.error("Erro:", error.response?.data || error.message);
    await axios.post(`${TELEGRAM_API}/sendMessage`, {
      chat_id: chatId,
      text: "Erro ao responder 😕",
    });
    res.sendStatus(500);
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bot rodando na porta ${port}`);
});
