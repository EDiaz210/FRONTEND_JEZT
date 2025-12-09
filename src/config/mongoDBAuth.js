/**
 * MongoDB Auth Strategy para WhatsApp Web.js
 * Almacena y recupera sesiones de WhatsApp desde MongoDB en lugar de archivos
 * ✅ SIN crear carpetas en el disco - TODO en MongoDB
 */
import WhatsAppSession from '../models/WhatsAppSession.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

// Importar correctamente desde whatsapp-web.js
import pkg from 'whatsapp-web.js';
const { LocalAuth, AuthenticationTicketKind } = pkg;

// Extender LocalAuth y sobrescribir COMPLETAMENTE el almacenamiento
export class MongoDBAuth extends LocalAuth {
  constructor(clientId = 'default') {
    // Usar directorio temporal para LocalAuth (será ignorado, usamos MongoDB)
    const tempDir = path.join(os.tmpdir(), 'whatsapp-sessions', clientId);
    super({ clientId, dataPath: tempDir });
    this.clientId = clientId;
    this.lastSaveTime = 0;
    this.capturedSessionData = null;
    this._session = null; // 🔑 Variable interna para el getter/setter
  }

  async beforeBrowserInitialize() {
    console.log(`[MongoDB Auth] Buscando sesión para clientId: ${this.clientId}`);
    
    try {
      const sessionDoc = await WhatsAppSession.findOne({ clientId: this.clientId });
      
      if (sessionDoc && sessionDoc.sessionData && Object.keys(sessionDoc.sessionData).length > 0) {
        console.log(`[MongoDB Auth] ✅ Sesión encontrada en MongoDB - restaurando...`);
        
        // 🔑 USAR EL SETTER para activar la sincronización
        this.session = sessionDoc.sessionData;
        
        console.log(`[MongoDB Auth] ✅ Sesión restaurada con éxito (${Object.keys(this.session).length} propiedades)`);
        return this.session;
      } else {
        console.log(`[MongoDB Auth] ⚠️ No hay sesión válida en MongoDB`);
        return null;
      }
    } catch (err) {
      console.error(`[MongoDB Auth] Error recuperando sesión:`, err);
      return null;
    }
  }

  async afterAuthRestore() {
    console.log(`[MongoDB Auth] afterAuthRestore llamado`);
    
    try {
      if (this.session && Object.keys(this.session).length > 0) {
        console.log(`[MongoDB Auth] Guardando sesión desde afterAuthRestore...`);
        await this.saveSessionToMongo(this.session);
      }
    } catch (err) {
      console.error(`[MongoDB Auth] Error en afterAuthRestore:`, err.message);
    }
  }

  async afterBrowserClose() {
    console.log(`[MongoDB Auth] Navegador cerrado para ${this.clientId}`);
    if (this.session && Object.keys(this.session).length > 0) {
      await this.saveSessionToMongo(this.session);
    }
  }

  // 🔑 SOBRESCRIBIR saveCreds - se llama cuando LocalAuth quiere guardar
  async saveCreds(creds) {
    try {
      console.log(`[MongoDB Auth] saveCreds llamado`);
      
      if (!creds || Object.keys(creds).length === 0) {
        console.warn(`[MongoDB Auth] saveCreds: credenciales vacías`);
        return;
      }
      
      console.log(`[MongoDB Auth] Capturando credenciales (${Object.keys(creds).length} claves)`);
      this.capturedSessionData = creds;
      this.session = creds;
      
      // Guardar inmediatamente a MongoDB
      await WhatsAppSession.updateOne(
        { clientId: this.clientId },
        {
          $set: {
            sessionData: creds,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
      
      console.log(`[MongoDB Auth] ✅ Credenciales guardadas en MongoDB desde saveCreds`);
    } catch (err) {
      console.error(`[MongoDB Auth] Error en saveCreds:`, err.message);
    }
  }

  // 🔑 SOBRESCRIBIR loadCreds - se llama cuando LocalAuth quiere cargar
  async loadCreds() {
    try {
      console.log(`[MongoDB Auth] loadCreds llamado`);
      
      const sessionDoc = await WhatsAppSession.findOne({ clientId: this.clientId });
      
      if (sessionDoc && sessionDoc.sessionData && Object.keys(sessionDoc.sessionData).length > 0) {
        console.log(`[MongoDB Auth] ✅ loadCreds: Credenciales encontradas en MongoDB`);
        this.session = sessionDoc.sessionData;
        this.capturedSessionData = sessionDoc.sessionData; // ✅ MANTENER EN SYNC
        return sessionDoc.sessionData;
      } else {
        console.log(`[MongoDB Auth] ⚠️ loadCreds: No hay credenciales en MongoDB`);
        return null;
      }
    } catch (err) {
      console.error(`[MongoDB Auth] Error en loadCreds:`, err);
      return null;
    }
  }

  // 🔑 GETTER PARA SESSION - interceptar accesos a this.session
  get session() {
    return this._session;
  }

  // 🔑 SETTER PARA SESSION - interceptar asignaciones a this.session
  set session(value) {
    if (value && typeof value === 'object') {
      this._session = value;
      this.capturedSessionData = value; // ✅ MANTENER EN SYNC
      console.log(`[MongoDB Auth] 🔄 Session actualizada (${Object.keys(value).length} claves)`);
    }
  }

  // Método para guardar sesión en cualquier momento
  async saveSessionToMongo(sessionData = null) {
    try {
      const now = Date.now();
      if (now - this.lastSaveTime < 5000) return;
      
      this.lastSaveTime = now;
      
      // 🔑 IMPORTANTE: Intentar obtener sesión en este orden
      const sessionToSave = sessionData || this.capturedSessionData || this.session;
      
      if (!sessionToSave || Object.keys(sessionToSave).length === 0) {
        // ⚠️ Si no hay sesión pero el cliente está listo, usar un marcador
        // para que sepa que TIENE que estar autenticado
        const existingDoc = await WhatsAppSession.findOne({ clientId: this.clientId });
        
        if (existingDoc && existingDoc.sessionData && Object.keys(existingDoc.sessionData).length > 0) {
          // ✅ Ya hay sesión en MongoDB, no hacer nada en esta ocasión
          console.log(`[MongoDB Auth] ℹ️ Sesión ya existe en MongoDB, saltando`);
          return;
        }
        
        console.warn(`[MongoDB Auth] ⚠️ No hay sesión para guardar`);
        return;
      }

      console.log(`[MongoDB Auth] Guardando sesión - ${Object.keys(sessionToSave).length} claves`);

      await WhatsAppSession.updateOne(
        { clientId: this.clientId },
        {
          $set: {
            sessionData: sessionToSave,
            updatedAt: new Date()
          }
        },
        { upsert: true }
      );
      
      console.log(`[MongoDB Auth] ✅ Sesión guardada en MongoDB`);
    } catch (err) {
      console.error(`[MongoDB Auth] Error guardando sesión:`, err.message);
    }
  }
}

// Función auxiliar para guardar QR
export async function saveQRToMongo(clientId, qrDataURL) {
  try {
    await WhatsAppSession.updateOne(
      { clientId },
      {
        qrCode: qrDataURL,
        lastQRGenerated: new Date(),
        updatedAt: new Date()
      },
      { upsert: true }
    );
    console.log(`[MongoDB Auth] QR guardado para ${clientId}`);
  } catch (err) {
    console.error(`[MongoDB Auth] Error guardando QR:`, err);
  }
}

// Función auxiliar para obtener QR
export async function getQRFromMongo(clientId) {
  try {
    const sessionDoc = await WhatsAppSession.findOne({ clientId });
    return sessionDoc?.qrCode || null;
  } catch (err) {
    console.error(`[MongoDB Auth] Error obteniendo QR:`, err);
    return null;
  }
}

// Función auxiliar para marcar como listo
export async function markAsReadyInMongo(clientId) {
  try {
    await WhatsAppSession.updateOne(
      { clientId },
      {
        isReady: true,
        readyAt: new Date(),
        updatedAt: new Date()
      },
      { upsert: true }
    );
    console.log(`[MongoDB Auth] Marcado como listo: ${clientId}`);
  } catch (err) {
    console.error(`[MongoDB Auth] Error marcando como listo:`, err);
  }
}

// Función auxiliar para limpiar sesión
export async function deleteSessionFromMongo(clientId) {
  try {
    await WhatsAppSession.deleteOne({ clientId });
    console.log(`[MongoDB Auth] Sesión eliminada: ${clientId}`);
  } catch (err) {
    console.error(`[MongoDB Auth] Error eliminando sesión:`, err);
  }
}

// ✅ NUEVA: Limpiar carpeta .wwebjs_cache si existe (para Render)
export async function cleanupLocalCache() {
  try {
    const fs = await import('fs').then(m => m.default);
    const path = await import('path').then(m => m.default);
    
    const cacheDir = path.resolve('.wwebjs_cache');
    
    // Verificar si la carpeta existe
    if (fs.existsSync(cacheDir)) {
      console.log(`[Cache] Eliminando carpeta local .wwebjs_cache...`);
      
      // Eliminar recursivamente
      fs.rmSync(cacheDir, { recursive: true, force: true });
      console.log(`[Cache] ✅ .wwebjs_cache eliminada`);
    } else {
      console.log(`[Cache] No hay carpeta .wwebjs_cache`);
    }
  } catch (err) {
    console.error(`[Cache] Error limpiando .wwebjs_cache:`, err.message);
  }
}
