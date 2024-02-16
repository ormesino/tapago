import {
  getAggregateVotesInPollMessage,
  makeInMemoryStore,
  makeWASocket,
  useMultiFileAuthState,
} from "@whiskeysockets/baileys";
import { readFileSync, writeFileSync } from "fs";
import pino from "pino";

export const auth = await useMultiFileAuthState("session");

// Create a new socket
export const socket = makeWASocket({
  auth: auth.state,
  logger: pino({ level: "silent" }),
  printQRInTerminal: true,
  browser: ["TaPago", "", ""],
  getMessage,
});

const store = makeInMemoryStore({});

store.readFromFile("../baileys_store.json");
setInterval(() => {
  store.writeToFile("../baileys_store.json");
}, 10_000);

store.bind(socket.ev);

// Load the database
const db = JSON.parse(readFileSync(process.cwd() + "/data.json"));

let currentPoll = null;

// Register a user to the data storage
const registerUser = async (key, userName, ...args) => {
  if (db.some((user) => user.jid === key.remoteJid)) {
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
    { text: "Registrado com sucesso!" },
    ...args
  );
};

// Show scores of all users
const showScores = async (jid, ...args) => {
  const scores = db.map((user) => `${user.userName}: ${user.score}`).join("\n");

  const today = new Date();
  const date = `${today.getDate()}/${today.getMonth() + 1}`;
  await sendMessage(
    jid,
    { text: `Pontuação Atualizada (${date})\n\n${scores}` },
    ...args
  );
};

async function getMessage(key) {
  if (store) {
    const msg = await store.loadMessage(key.remoteJid, key.id);
    return msg?.message || undefined;
  }
  return;
}

// Function to update the score based on the poll result
const createPoll = async (jid, msg) => {
  if (currentPoll) {
    await sendMessage(
      jid,
      { text: " ⚠️ Já existe uma poll ativa!" },
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
    createdBy: jid,
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
  /* const group = await socket.groupMetadata(
    msg.key.remoteJid
  );
  const members = group.participants.map((member) => member.id); */

  const registered = db.find((user) => user.jid === msg.from);
  if (registered) {
    if (msg.body === "Sim 🔥") {
      currentPoll.options.y.push(msg.from);
      currentPoll.options.n = currentPoll.options.n.filter(
        (voter) => voter !== msg.from
      );
    } else if (msg.body === "Não 🐔") {
      currentPoll.options.n.push(msg.from);
      currentPoll.options.y = currentPoll.options.y.filter(
        (voter) => voter !== msg.from
      );
    }
  }

  console.log(currentPoll);

  // count the votes
  const yVotes = currentPoll.options.y.length;
  const nVotes = currentPoll.options.n.length;
  if (yVotes + nVotes === db.length - 1 && currentPoll.createdBy !== msg.from) {
    const pollCreator = db.find((user) => user.jid === currentPoll.createdBy);
    if (yVotes > nVotes) {
      pollCreator.score += 1;
      writeFileSync(process.cwd() + "/data.json", JSON.stringify(db));
      await sendMessage(
        msg.key.remoteJid,
        { text: `⚡ O de hoje do(a) ${pollCreator.userName} ta pago ⚡` }
      );
    } else {
      await sendMessage(
        msg.key.remoteJid,
        { text: `🛑 ${pollCreator.userName} sua imagem não foi aprovada 🛑 ` }
      );
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
    case "$join":
      await registerUser(key, msg.pushName, { quoted: msg });
      break;
    case "$scores":
      await showScores(jid, { quoted: msg });
      break;
    default:
      break;
  }
};

socket.ev.process(async (events) => {
  if (events["creds.update"]) {
    auth.saveCreds();
  }

  if (events["connection.update"]) {
    const update = events["connection.update"];
    const { connection } = update;
    if (connection === "open") {
      console.log("Connected to WhatsApp ✅");
    } else if (connection === "close") {
      console.log("Reconnecting to WhatsApp... ⏳");
    }
  }

  if (events["messages.upsert"]) {
    const upsert = events["messages.upsert"];
    const { messages } = upsert;
    if (!messages[0].message) return;

    handleReply(messages[0]);
    console.log(messages[0]);

    if (messages[0].message.pollCreationMessage && messages[0].key.fromMe) {
      currentPoll = { ...currentPoll, ...messages[0] };
      currentPoll.options = {
        y: [],
        n: [],
      };
      console.log(currentPoll);
    }
  }

  if (events["messages.update"]) {
    for (const { key, update } of events["messages.update"]) {
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
            body:
              pollMessage.find((poll) => poll.voters.length > 0)?.name || "",
            from: key.remoteJid,
            voters: pollCreation,
            type: "poll",
          };

          handlePoll(payload);
        }
      }
    }
  }
});
