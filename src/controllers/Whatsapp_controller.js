// Whatsapp_controller.js
import { client, getIsReady, getReadyAt,getLastQR } from "../config/client.js";
import pkg from "whatsapp-web.js";
const { MessageMedia } = pkg;
import { normalizeNumber } from "../utils/normalize.js";
import Mensaje from "../models/Mensaje.js";

/**
 * Función que espera que el cliente esté listo
 */
const waitClientReady = async () => {
  while (!getIsReady()) {
    console.log("[WHATSAPP] Esperando cliente listo...");
    await new Promise(r => setTimeout(r, 1000));
  }
  const elapsed = Date.now() - getReadyAt();
  if (elapsed < 15000) await new Promise(r => setTimeout(r, 15000 - elapsed));
};

/**
 * Enviar un solo mensaje (texto o multimedia) de forma segura
 */
const sendMessageSafe = async (number, message, files = []) => {
  try {
    await waitClientReady();

    const media = (files || []).map(f => new MessageMedia(f.mimetype, f.buffer.toString("base64"), f.originalname));

    // Enviar texto
    if (message) await client.sendMessage(number, message);

    // Enviar archivos
    for (const m of media) await client.sendMessage(number, m);

    console.log(`[WHATSAPP] Enviado a ${number}`);
    return { to: number, sent: true };
  } catch (err) {
    console.error(`[WHATSAPP] Error enviando a ${number}:`, err.message);
    return { to: number, sent: false, error: err.message };
  }
};

/**
 * Controlador POST /send-message
 */
const sendMessage = async (req, res) => {
  try {
    // Validar que sea administrador o pasante
    if (!req.userBDD || (req.userBDD.rol !== "administrador" && req.userBDD.rol !== "pasante")) {
      return res.status(403).json({ 
        error: "Acceso denegado: solo administradores y pasantes pueden enviar mensajes"
      });
    }

    const ALLOWED_TIPOS = ["Administrativas", "Académicas", "Extracurriculares"];
    
    // Validar categoría
    const tipo = req.body.tipo?.trim();
    if (!tipo || !ALLOWED_TIPOS.includes(tipo)) {
      return res.status(400).json({ 
        error: `La categoría debe ser una de: ${ALLOWED_TIPOS.join(", ")}`
      });
    }

    let numbers = req.body.numbers || req.body["numbers[]"] || [];
    if (!Array.isArray(numbers)) numbers = [numbers];
    numbers = numbers.map(normalizeNumber).filter(Boolean);

    if (!numbers.length && !req.files?.length) return res.status(400).json({ error: "No hay números válidos o archivos" });

    const message = req.body.message || "";

    const results = [];
    for (const n of numbers) {
      const result = await sendMessageSafe(n, message, req.files);
      results.push(result);
      await new Promise(r => setTimeout(r, 500)); // evitar saturar WhatsApp
    }

    // Guardar en MongoDB
    const nuevoMensaje = new Mensaje({
      numbers,
      message,
      hasMedia: !!req.files?.length,
      files: req.files?.map(f => ({ fileName: f.originalname, fileMime: f.mimetype })),
      tipo: tipo,
      date: new Date(),
    });
    await nuevoMensaje.save();

    res.json({ ok: true, results });
  } catch (err) {
    console.error("Error sendMessage:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /qr
 */
const getQR = async (req, res) => {
  try {
    // Validar que sea administrador o pasante
    if (!req.userBDD || (req.userBDD.rol !== "administrador" && req.userBDD.rol !== "pasante")) {
      return res.status(403).json({ 
        error: "Acceso denegado: solo administradores y pasantes pueden acceder al QR"
      });
    }

    if (getIsReady()) return res.json({ ready: true, qr: null });
    
    // getLastQR ahora es async
    const qr = await getLastQR();
    res.json({ ready: false, qr });
  } catch (err) {
    console.error("Error en getQR:", err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /status
 */
const getStatus = async (req, res) => {
  try {
    // Validar que sea administrador o pasante
    if (!req.userBDD || (req.userBDD.rol !== "administrador" && req.userBDD.rol !== "pasante")) {
      return res.status(403).json({ 
        error: "Acceso denegado: solo administradores y pasantes pueden ver el estado"
      });
    }

    const state = await client.getState().catch(() => "ERROR");
    res.json({ ready: getIsReady(), state });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};


const listaMensajes = async (req, res) => {
  try {
    // Validar que sea administrador o pasante
    if (!req.userBDD || (req.userBDD.rol !== "administrador" && req.userBDD.rol !== "pasante")) {
      return res.status(403).json({ 
        error: "Acceso denegado: solo administradores y pasantes pueden listar mensajes"
      });
    }

    const { tipo, fechaInicio, fechaFin } = req.query;

    const condiciones = [
      { $or: [{ status: { $exists: false } }, { status: true }] },
    ];

    if (tipo) {
      condiciones.push({ tipo });
    }

    if (fechaInicio || fechaFin) {
      const rangoFechas = {};
      if (fechaInicio) rangoFechas.$gte = new Date(fechaInicio);
      if (fechaFin) rangoFechas.$lte = new Date(fechaFin);
      condiciones.push({ date: rangoFechas });
    }

    const mensajes = await Mensaje.find({ $and: condiciones })
      .select("-__v") 
      .sort({ date: -1 });

    res.status(200).json(mensajes);
  } catch (error) {
    console.error("Error al listar mensajes:", error);
    res.status(500).json({ error: "Error al listar mensajes" });
  }
};

const deleteMessage = async (req, res) => {
  try {
    // Validar que sea administrador o pasante
    if (!req.userBDD || (req.userBDD.rol !== "administrador" && req.userBDD.rol !== "pasante")) {
      return res.status(403).json({ 
        error: "Acceso denegado: solo administradores y pasantes pueden eliminar mensajes"
      });
    }

    const { id } = req.params;

    if (!id) {
      return res.status(400).json({ error: "Se requiere el ID del mensaje" });
    }

    const mensaje = await Mensaje.findByIdAndUpdate(
      id,
      { status: false },
      { new: true }
    );

    if (!mensaje) {
      return res.status(404).json({ error: "Mensaje no encontrado" });
    }

    res.status(200).json({ 
      ok: true, 
      message: "Mensaje eliminado correctamente",
      mensaje 
    });
  } catch (error) {
    console.error("Error al eliminar mensaje:", error);
    res.status(500).json({ error: "Error al eliminar el mensaje" });
  }
};

const sendMessageN8N = async (req, res) => {
  try {
    // Validar que sea administrador o pasante
    if (!req.userBDD || (req.userBDD.rol !== "administrador" && req.userBDD.rol !== "pasante")) {
      return res.status(403).json({ 
        error: "Acceso denegado: solo administradores y pasantes pueden enviar mensajes"
      });
    }

    const ALLOWED_TIPOS = ["Administrativas", "Académicas", "Extracurriculares"];
    
    // Validar categoría
    const tipo = req.body.tipo?.trim();
    if (!tipo || !ALLOWED_TIPOS.includes(tipo)) {
      return res.status(400).json({ 
        error: `La categoría debe ser una de: ${ALLOWED_TIPOS.join(", ")}`
      });
    }

    let numbers = req.body.numbers || req.body["numbers[]"] || [];
    if (!Array.isArray(numbers)) numbers = [numbers];
    numbers = numbers.map(normalizeNumber).filter(Boolean);

    if (!numbers.length && !req.files?.length) return res.status(400).json({ error: "No hay números válidos o archivos" });

    const message = req.body.message || "";

    const results = [];
    for (const n of numbers) {
      const result = await sendMessageSafe(n, message, req.files);
      results.push(result);
      await new Promise(r => setTimeout(r, 500)); // evitar saturar WhatsApp
    }

  } catch (err) {
    console.error("Error sendMessage:", err);
    res.status(500).json({ error: err.message });
  }
};


/**
 * GET /logout
 */
const logout = async (req, res) => {
  try {
    // Validar que sea administrador o pasante
    if (!req.userBDD || (req.userBDD.rol !== "administrador" && req.userBDD.rol !== "pasante")) {
      return res.status(403).json({ 
        error: "Acceso denegado: solo administradores y pasantes pueden cerrar sesión"
      });
    }

    // Importar la función para eliminar sesión de MongoDB
    const { deleteSessionFromMongo } = await import('../config/mongoDBAuth.js');
    
    // Cerrar sesión del cliente WhatsApp
    await client.logout();
    console.log("[WHATSAPP] Sesión cerrada");
    
    // Eliminar sesión de MongoDB
    await deleteSessionFromMongo("default");
    console.log("[WHATSAPP] Sesión eliminada de MongoDB");
    
    res.json({ ok: true, message: "Sesión de WhatsApp cerrada y eliminada" });
  } catch (err) {
    console.error("[WHATSAPP] Error en logout:", err.message);
    res.status(500).json({ error: err.message });
  }
};

export { sendMessage, getQR, getStatus, logout, listaMensajes, deleteMessage, sendMessageN8N };
