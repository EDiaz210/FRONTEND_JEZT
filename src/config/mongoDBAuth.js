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
    this._session = null; // Variable interna para el getter/setter
  }

  async beforeBrowserInitialize() {
    console.log(`[MongoDB Auth] Buscando sesión para clientId: ${this.clientId}`);
    
    try {
      const sessionDoc = await WhatsAppSession.findOne({ clientId: this.clientId });
      
      if (sessionDoc && sessionDoc.sessionData && Object.keys(sessionDoc.sessionData).length > 0) {
        console.log(`[MongoDB Auth] Sesión encontrada en MongoDB - restaurando...`);
        
        // Usar el setter para activar la sincronización
        this.session = sessionDoc.sessionData;
        
        console.log(`[MongoDB Auth] Sesión restaurada con éxito (${Object.keys(this.session).length} propiedades)`);
        return this.session;
      } else {
        console.log(`[MongoDB Auth] No hay sesión válida en MongoDB`);
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

  // Sobrescribir saveCreds - se llama cuando LocalAuth quiere guardar
  async saveCreds(creds) {
    try {
      console.log(`[MongoDB Auth] saveCreds llamado`);
      
      if (!creds || Object.keys(creds).length === 0) {
        console.warn(`[MongoDB Auth] saveCreds: credenciales vacías`);
        return;
      }
      
      console.log(`[MongoDB Auth] Capturando credenciales (${Object.keys(creds).length} claves)`);
      this.capturedSessionData = creds;
      this.session = creds; // Usar el setter para sincronizar
      
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
      
      console.log(`[MongoDB Auth] Credenciales guardadas en MongoDB desde saveCreds`);
    } catch (err) {
      console.error(`[MongoDB Auth] Error en saveCreds:`, err.message);
    }
  }

  // Nuevo: Interceptar cuando se intenta actualizar la sesión
  async saveSession(session) {
    try {
      console.log(`[MongoDB Auth] saveSession interceptado (${Object.keys(session).length} claves)`);
      this.session = session; // Usar el setter
      await this.saveSessionToMongo(session);
    } catch (err) {
      console.error(`[MongoDB Auth] Error en saveSession:`, err.message);
    }
  }

  // Sobrescribir loadCreds - se llama cuando LocalAuth quiere cargar
  async loadCreds() {
    try {
      console.log(`[MongoDB Auth] loadCreds llamado`);
      
      const sessionDoc = await WhatsAppSession.findOne({ clientId: this.clientId });
      
      if (sessionDoc && sessionDoc.sessionData && Object.keys(sessionDoc.sessionData).length > 0) {
        console.log(`[MongoDB Auth] loadCreds: Credenciales encontradas en MongoDB`);
        this.session = sessionDoc.sessionData;
        this.capturedSessionData = sessionDoc.sessionData; // Mantener en sincronización
        return sessionDoc.sessionData;
      } else {
        console.log(`[MongoDB Auth] loadCreds: No hay credenciales en MongoDB`);
        return null;
      }
    } catch (err) {
      console.error(`[MongoDB Auth] Error en loadCreds:`, err);
      return null;
    }
  }

  // Getter para session - interceptar accesos a this.session
  get session() {
    return this._session;
  }

  // Setter para session - interceptar asignaciones a this.session
  set session(value) {
    if (value && typeof value === 'object') {
      this._session = value;
      this.capturedSessionData = value; // Mantener en sincronización
      console.log(`[MongoDB Auth] Session actualizada (${Object.keys(value).length} claves)`);
    }
  }

  // Método para guardar sesión en cualquier momento
  async saveSessionToMongo(sessionData = null) {
    try {
      const now = Date.now();
      if (now - this.lastSaveTime < 5000) return;
      
      this.lastSaveTime = now;
      
      // Obtener sesión en este orden de prioridad
      const sessionToSave = sessionData || this.capturedSessionData || this.session;
      
      if (!sessionToSave || Object.keys(sessionToSave).length === 0) {
        // Si no hay sesión pero ya existe una en MongoDB, confiar en ella
        const existingDoc = await WhatsAppSession.findOne({ clientId: this.clientId });
        
        if (existingDoc && existingDoc.sessionData && Object.keys(existingDoc.sessionData).length > 0) {
          // Ya hay sesión persistida, no sobreescribir con vacío
          console.log(`[MongoDB Auth] Sesión ya existe en MongoDB, nada que actualizar`);
          return;
        }
        
        console.warn(`[MongoDB Auth] No hay sesión para guardar`);
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
      
      console.log(`[MongoDB Auth] Sesión guardada en MongoDB`);
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

// Limpiar carpetas de cache y sesión (para Render con límite de almacenamiento)
export async function cleanupLocalCache() {
  try {
    const fs = await import('fs').then(m => m.default);
    const path = await import('path').then(m => m.default);
    const os = await import('os').then(m => m.default);
    
    // Carpetas a limpiar
    const foldersToClean = [
      '.wwebjs_cache',
      '.chromium-browser-snapshots',
      path.join(os.tmpdir(), 'whatsapp-sessions'),
      path.join(os.tmpdir(), 'puppeteer')
    ];
    
    for (const folder of foldersToClean) {
      const folderPath = path.resolve(folder);
      
      if (fs.existsSync(folderPath)) {
        console.log(`[Cache] Limpiando: ${folderPath}`);
        
        try {
          fs.rmSync(folderPath, { recursive: true, force: true });
          console.log(`[Cache] Eliminada: ${folderPath}`);
        } catch (err) {
          console.warn(`[Cache] No se pudo eliminar ${folderPath}:`, err.message);
        }
      }
    }
    
    console.log(`[Cache] Limpieza completada`);
  } catch (err) {
    console.error(`[Cache] Error en limpieza:`, err.message);
  }
}
