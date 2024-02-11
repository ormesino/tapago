import { makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import pino from "pino";

async function connectWhatsApp() {
  const auth = await useMultiFileAuthState("session");

  // Create a new socket
  const socket = makeWASocket({
    auth: auth.state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: true,
    browser: ["TaPago", "", ""],
  });

  // Save the credentials to the file
  socket.ev.on("creds.update", auth.saveCreds);

  // Connect to WhatsApp
  socket.ev.on("connection.update", async ({ connection }) => {
    if (connection === "open") {
      console.log("Connected to WhatsApp ✅");
    } else if (connection === "close") {
      console.log("Reconnecting to WhatsApp... ⏳");
      connectWhatsApp();
    }
  });

  // Function to respond to messages
  const sendMessage = async (jid, message, ...args) => {
    try {
      await socket.sendMessage(jid, message, { ...args });
    } catch (error) {
      console.error("Error sending message: ", error);
    }
  };

  const handleReply = async (msg) => {
    const { key, message } = msg;
    const text = message?.conversation;
    const jid = key.remoteJid;
    const prefix = "/pago";

    if (!text.startsWith(prefix)) return;
    const reply = "O de hoje ta pago! 💪";
    await sendMessage(jid, { text: reply }, { quoted: msg });
  };

  // Listen for messages in group
  socket.ev.on("messages.upsert", async ({ messages }) => {
    if (!messages[0].message) return;
    handleReply(messages[0]);
    console.log(messages[0]);
  });
}

connectWhatsApp();
