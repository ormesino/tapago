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

  // Listen for messages
  socket.ev.on("messages.upsert", async ({ messages }) => {
    messages.forEach((message) => {
      console.log(message);
    });
  });
}

connectWhatsApp();
