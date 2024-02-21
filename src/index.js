import {
  DisconnectReason,
  getAggregateVotesInPollMessage,
  makeInMemoryStore,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { readFileSync, writeFileSync } from "fs";
import pino from "pino";

// Load the database
const db = JSON.parse(readFileSync(process.cwd() + "/data.json"));

let currentPoll = null;
let currentMonth = new Date().getMonth();

async function WhatsAppBot() {
  const auth = await useMultiFileAuthState("session");

  // Create a new socket
  const socket = makeWASocket({
    auth: auth.state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: true,
    browser: ["TaPago", "", ""],
    getMessage,
  });

  const store = makeInMemoryStore({});

  store.readFromFile(process.cwd() + "/baileys_store.json");
  setInterval(() => {
    store.writeToFile(process.cwd() + "/baileys_store.json");
  }, 10_000);

  store.bind(socket.ev);

  // Register a user to the data storage
  const registerUser = async (key, userName, ...args) => {
    if (db.some((user) => user.id === key.participant)) {
      await sendMessage(
        key.remoteJid,
        { text: "Você já está registrado!" },
        ...args
      );
      return;
    }
    db.push({
      jid: key.remoteJid,
      userName,
      score: 0,
      id: key.participant,
    });
    writeFileSync(process.cwd() + "/data.json", JSON.stringify(db));
    await sendMessage(
      key.remoteJid,
      { text: "Registrado com sucesso! 💪" },
      ...args
    );
  };

  // Unregister a user from the data storage
  const unregisterUser = async (key, ...args) => {
    if (!db.some((user) => user.id === key.participant)) return;

    db.splice(
      db.findIndex((user) => user.id === key.participant),
      1
    );
    writeFileSync(process.cwd() + "/data.json", JSON.stringify(db));
    await sendMessage(
      key.remoteJid,
      { text: "Desregistrado com sucesso 👋🐔" },
      ...args
    );
  };

  // Show scores of all users
  const showScores = async (jid, ...args) => {
    const scores = db
      .map((user) => `${user.userName}: ${user.score}`)
      .join("\n");

    if (!scores) {
      await sendMessage(jid, { text: "Nenhum usuário registrado!" }, ...args);
      return;
    }

    const today = new Date();
    const date = `${today.getDate()}/${today.getMonth() + 1}`;
    await sendMessage(
      jid,
      { text: `Pontuação Atualizada (${date})\n\n${scores}` },
      ...args
    );
  };

  // Function to reset the scores
  const resetScores = () => {
    db.forEach((user) => (user.score = 0));
    writeFileSync(process.cwd() + "/data.json", JSON.stringify(db));
  };

  // Function to get a message from the store
  async function getMessage(key) {
    if (store) {
      const msg = await store.loadMessage(key.remoteJid, key.id);
      return msg?.message || undefined;
    }
    return;
  }

  // Function to update the score based on the poll result
  const createPoll = async (jid, msg) => {
    if (!db.some((user) => user.id === msg.key.participant)) return;

    if (currentPoll) {
      await sendMessage(
        jid,
        { text: " Já existe uma poll ativa! ⚠️" },
        { quoted: msg }
      );
      return;
    }
    await sendMessage(jid, {
      poll: {
        name: `O de hoje do(a) ${msg.pushName} ta pago? 🤔`,
        values: ["Sim 🔥", "Não 🐔"],
        selectableCount: 1,
      },
    });
    currentPoll = {
      createdBy: msg.key.participant,
    };
  };

  // Function to respond to messages
  const sendMessage = async (jid, message, ...args) => {
    try {
      await socket.sendMessage(jid, message, ...args);
    } catch (error) {
      console.error("Error sending message: ", error);
    }
  };

  // Function to handle poll results
  const handlePoll = async (msg) => {
    if (currentPoll.createdBy === msg.from)
      return console.log("Can't vote on your own poll!");

    const registered = db.find((user) => user.id === msg.from);
    if (!registered) return console.log("User not registered!");

    if (msg.answer === "Sim 🔥") {
      currentPoll.options.y.push(msg.from);
      currentPoll.options.n = currentPoll.options.n.filter(
        (voter) => voter !== msg.from
      );
    } else if (msg.answer === "Não 🐔") {
      currentPoll.options.n.push(msg.from);
      currentPoll.options.y = currentPoll.options.y.filter(
        (voter) => voter !== msg.from
      );
    }

    const yVotes = currentPoll.options.y.length;
    const nVotes = currentPoll.options.n.length;
    if (
      yVotes + nVotes === db.length - 1 ||
      yVotes > (db.length - 1) / 2 ||
      nVotes > (db.length - 1) / 2
    ) {
      const pollCreator = db.find((user) => user.id === currentPoll.createdBy);
      if (yVotes > nVotes) {
        pollCreator.score += 1;
        writeFileSync(process.cwd() + "/data.json", JSON.stringify(db));
        await sendMessage(msg.key.remoteJid, {
          text: `⚡ O de hoje do(a) ${pollCreator.userName} ta pago ⚡`,
        });
      } else {
        await sendMessage(msg.key.remoteJid, {
          text: `🛑 ${pollCreator.userName} sua imagem não foi aprovada 🛑 `,
        });
      }
      currentPoll = null;
    }
    return;
  };

  // Function to handle messages
  const handleReply = async (msg) => {
    const { key, message } = msg;
    const text = message?.conversation;
    const jid = key.remoteJid;

    const firstWord = text.split(" ")[0];
    switch (firstWord) {
      case "$pago":
        await createPoll(jid, msg);
        break;
      case "$ping":
        await sendMessage(jid, { text: "Pong! 🏓" }, { quoted: msg });
        break;
      case "$entrar":
        await registerUser(key, msg.pushName, { quoted: msg });
        break;
      case "$sair":
        await unregisterUser(key, { quoted: msg });
        break;
      case "$tabela":
        await showScores(jid, { quoted: msg });
        break;
      default:
        break;
    }
  };

  // Listen to events
  socket.ev.process(async (events) => {
    if (events["creds.update"]) {
      auth.saveCreds();
    }

    if (events["connection.update"]) {
      const { connection, lastDisconnect } = events["connection.update"];
      if (connection === "close") {
        if (
          lastDisconnect?.error?.output?.statusCode !==
          DisconnectReason.loggedOut
        ) {
          console.log("Reconnecting to WhatsApp... ⏳");
          WhatsAppBot();
        } else {
          console.log("Logged out from WhatsApp ❌");
        }
      } else {
        console.log("Connected to WhatsApp ✅");
      }
    }

    // Listening to new messages
    if (events["messages.upsert"]) {
      const upsert = events["messages.upsert"];
      const { messages } = upsert;
      if (!messages[0].message) return;

      handleReply(messages[0]);

      if (messages[0].message.pollCreationMessage && messages[0].key.fromMe) {
        currentPoll = { ...currentPoll, ...messages[0] };
        currentPoll.options = {
          y: [],
          n: [],
        };
      }

      if (
        new Date().getDate() === 1 &&
        new Date().getMonth() !== currentMonth
      ) {
        resetScores();
        currentMonth = new Date().getMonth();
      }
    }

    // Listening to poll updates
    if (events["messages.update"]) {
      const { key, update } = events["messages.update"][0];

      if (update.pollUpdates) {
        const pollCreation = await getMessage(key);
        if (pollCreation) {
          const pollMessage = await getAggregateVotesInPollMessage({
            message: pollCreation,
            pollUpdates: update.pollUpdates,
          });
          const [messageCtx] = events["messages.update"];

          let payload = {
            ...messageCtx,
            answer:
              pollMessage.find((poll) => poll.voters.length > 0)?.name || "",
            from: events["messages.update"][0].update.pollUpdates[0]
              .pollUpdateMessageKey.participant,
            voters: pollCreation,
            type: "poll",
          };

          if (currentPoll) handlePoll(payload);
        }
      }
    }
  });
}

WhatsAppBot();
