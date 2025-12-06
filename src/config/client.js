// client.js
import pkg from "whatsapp-web.js";
const { Client, MessageMedia } = pkg;
import qrcode from "qrcode";
import { MongoDBAuth, saveQRToMongo, markAsReadyInMongo, getQRFromMongo } from "./mongoDBAuth.js";

let lastQR = null;
let readyAt = null;
let mongoDBAuthInstance = null;  // 🔑 Guardar referencia a la instancia

const mongoDBAuth = new MongoDBAuth("default");
mongoDBAuthInstance = mongoDBAuth;

const client = new Client({
  authStrategy: mongoDBAuth, // 🔄 Usar MongoDB en lugar de LocalAuth
  puppeteer: {
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--disable-blink-features=AutomationControlled",
    ],
  },
});

// ---------------------- EVENTOS ----------------------
client.on("qr", async (qr) => {
  lastQR = await qrcode.toDataURL(qr);
  // 💾 Guardar QR en MongoDB para persistencia
  await saveQRToMongo("default", lastQR);
  console.log("📌 QR generado y guardado en MongoDB. Escanea en /qr");
});

client.on("authenticated", async () => {
  console.log("✅ Sesión autenticada correctamente");
  // Esperar unos segundos y luego inicializar
  setTimeout(() => {
    client.emit("ready");
  }, 5000); // 5 segundos de espera
});


client.on("ready", async () => {
  readyAt = Date.now();
  // 💾 Marcar como listo en MongoDB
  await markAsReadyInMongo("default");
  console.log("✅ Cliente listo y conectado (MongoDB)");
});

client.on("auth_failure", (err) => {
  console.error("❌ Fallo de autenticación:", err);
});

client.on("disconnected", (reason) => {
  console.warn("⚠️ Cliente desconectado:", reason);
  readyAt = null; // Reset estado
});

client.on("change_state", async (state) => {
  console.log("➡️ Estado del cliente:", state);
  if (state === "CONNECTED" && !readyAt) {
    readyAt = Date.now();
    await markAsReadyInMongo("default");
    console.log("✅ Cliente listo y conectado (desde change_state)");
  }
});


// ---------------------- POLLER ----------------------
let pollerId = null;
let autoSaveSessionId = null;

const startPoller = () => {
  if (pollerId) return;
  
  // ✅ NUNCA hacer getState() si no estamos listos
  // El poller SOLO guarda la sesión periódicamente
  autoSaveSessionId = setInterval(async () => {
    try {
      // Solo guardar si estamos COMPLETAMENTE listos
      if (getIsReady() && mongoDBAuthInstance) {
        console.log("[Auto-Save] Guardando sesión en MongoDB...");
        await mongoDBAuthInstance.saveSessionToMongo();
      }
    } catch (err) {
      console.error("[Auto-Save] Error:", err.message);
    }
  }, 30000); // Cada 30 segundos

  console.log("[Poller] Iniciado - guardará sesión cada 30s");
};

// Iniciar poller DESPUÉS de autenticación, no antes
client.on("authenticated", async () => {
  console.log("✅ Sesión autenticada correctamente");
  
  // Iniciar poller SOLO después de autenticar
  setTimeout(() => {
    if (!pollerId && !autoSaveSessionId) {
      startPoller();
    }
    client.emit("ready");
  }, 5000);
});


// ---------------------- FUNCIONES ----------------------

// Verificar si el cliente está listo
const getIsReady = () => !!readyAt;

// Última hora de ready
const getReadyAt = () => readyAt;

// Último QR generado (con fallback a MongoDB)
const getLastQR = async () => {
  if (lastQR) return lastQR;
  // Si no está en memoria, intentar recuperar de MongoDB
  return await getQRFromMongo("default");
};

// Inicializar cliente
client.initialize();

export { client, getIsReady, getReadyAt, getLastQR };
