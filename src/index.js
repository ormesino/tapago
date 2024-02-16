import { makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import { writeFileSync } from "fs";
import pino from "pino";
import process from "process";

// Data storage
const db = [];

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

  // Register a user to the data storage
  const registerUser = async (jid, userName, ...args) => {
    if (db.some((user) => user.jid === jid)) {
      await sendMessage(jid, { text: "Você já está registrado!" }, ...args);
      return;
    }
    db.push({
      jid,
      userName,
      score: 0,
    });
    writeFileSync(process.cwd() + "/data.json", JSON.stringify(db));
    await sendMessage(jid, { text: "Registrado com sucesso!" }, ...args);
  };

  // Show scores of all users
  const showScores = async (jid, ...args) => {
    const scores = db
      .map((user) => `${user.userName}: ${user.score}`)
      .join("\n");
    
    const today = new Date();
    const date = `${today.getDate()}/${today.getMonth() + 1}`;
    await sendMessage(jid, { text: `Pontuação Atualizada (${date})\n\n${scores}` }, ...args);
  };

  // Function to respond to messages
  const sendMessage = async (jid, message, ...args) => {
    try {
      await socket.sendMessage(jid, message, ...args);
    } catch (error) {
      console.error("Error sending message: ", error);
    }
  };

  // Function to handle messages
  const handleReply = async (msg) => {
    const { key, message } = msg;
    const text = message?.conversation;
    const jid = key.remoteJid;

    const firstWord = text.split(" ")[0];
    switch (firstWord) {
      case "$pago":
        await sendMessage(jid, {
          poll: {
            name: `O de hoje do(a) ${msg.pushName} ta pago? 🤔`,
            values: ["Sim 🔥", "Não 🐔"],
            selectableCount: 1,
          },
        });
        break;
      case "$ping":
        await sendMessage(jid, { text: "Pong! 🏓" }, { quoted: msg });
        break;
      case "$join":
        await registerUser(jid, msg.pushName, { quoted: msg });
        break;
      case "$scores":
        await showScores(jid, { quoted: msg });
        break;
      default:
        break;
    }
  };

  // Listen for messages in group
  socket.ev.on("messages.upsert", async ({ messages }) => {
    if (!messages[0].message) return;
    handleReply(messages[0]);
    console.log(messages[0]);
  });
}

connectWhatsApp();
