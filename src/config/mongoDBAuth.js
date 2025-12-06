/**
 * MongoDB Auth Strategy para WhatsApp Web.js
 * Almacena y recupera sesiones de WhatsApp desde MongoDB en lugar de archivos
 * ✅ SIN crear carpetas en el disco - TODO en MongoDB
 */
import WhatsAppSession from '../models/WhatsAppSession.js';

// Importar correctamente desde whatsapp-web.js
import pkg from 'whatsapp-web.js';
const { LocalAuth } = pkg;

// Extender LocalAuth y sobrescribir COMPLETAMENTE el almacenamiento
export class MongoDBAuth extends LocalAuth {
  constructor(clientId = 'default') {
    // ✅ NO crear carpeta: no pasar dataPath
    super({ clientId, dataPath: null });
    this.clientId = clientId;
    this.lastSaveTime = 0;
  }

  async beforeBrowserInitialize() {
    // Recuperar sesión existente de MongoDB
    console.log(`[MongoDB Auth] Buscando sesión para clientId: ${this.clientId}`);
    
    try {
      const sessionDoc = await WhatsAppSession.findOne({ clientId: this.clientId });
      
      if (sessionDoc && sessionDoc.sessionData) {
        console.log(`[MongoDB Auth] ✅ Sesión encontrada en MongoDB`);
        this.session = sessionDoc.sessionData;
        return this.session;
      } else {
        console.log(`[MongoDB Auth] ⚠️ No hay sesión en MongoDB, será creada al autenticar`);
        return null;
      }
    } catch (err) {
      console.error(`[MongoDB Auth] Error recuperando sesión:`, err);
      return null;
    }
  }

  async afterAuthRestore() {
    console.log(`[MongoDB Auth] Sesión restaurada para ${this.clientId}`);
    
    try {
      // Guardar/actualizar sesión en MongoDB
      if (this.session) {
        console.log(`[MongoDB Auth] Guardando sesión... tamaño: ${JSON.stringify(this.session).length} bytes`);
        
        const result = await WhatsAppSession.updateOne(
          { clientId: this.clientId },
          {
            $set: {
              sessionData: this.session,
              isReady: true,
              readyAt: new Date(),
              updatedAt: new Date()
            }
          },
          { upsert: true }
        );
        
        console.log(`[MongoDB Auth] ✅ Sesión guardada en MongoDB - Modified: ${result.modifiedCount}, Upserted: ${result.upsertedCount}`);
      } else {
        console.warn(`[MongoDB Auth] ⚠️ No hay sessionData para guardar`);
      }
    } catch (err) {
      console.error(`[MongoDB Auth] Error guardando sesión:`, err.message);
    }
  }

  async afterBrowserClose() {
    console.log(`[MongoDB Auth] Navegador cerrado para ${this.clientId}`);
    // Guardar sesión final antes de cerrar
    if (this.session) {
      await this.saveSessionToMongo();
    }
  }

  // Método para guardar sesión en cualquier momento
  async saveSessionToMongo() {
    try {
      const now = Date.now();
      // No guardar más de una vez cada 5 segundos para no saturar BD
      if (now - this.lastSaveTime < 5000) return;
      
      this.lastSaveTime = now;
      
      // 🔑 IMPORTANTE: Obtener sesión del objeto LocalAuth
      // this.session podría estar en diferentes lugares
      const sessionToSave = this.session || this.sessionData || {};
      
      if (!sessionToSave || Object.keys(sessionToSave).length === 0) {
        console.warn(`[MongoDB Auth] ⚠️ No hay sesión para guardar (objeto vacío)`);
        return;
      }

      console.log(`[MongoDB Auth] Guardando sesión - Datos: ${Object.keys(sessionToSave).length} claves`);

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
      
      console.log(`[MongoDB Auth] ✅ Sesión guardada manualmente en MongoDB`);
    } catch (err) {
      console.error(`[MongoDB Auth] Error guardando sesión manualmente:`, err.message);
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
