/**
 * MongoDB Auth Strategy para WhatsApp Web.js
 * Almacena y recupera sesiones de WhatsApp desde MongoDB en lugar de archivos
 */
import WhatsAppSession from '../models/WhatsAppSession.js';
import pkg from 'whatsapp-web.js';
const { AuthStrategy } = pkg;

export class MongoDBAuth extends AuthStrategy {
  constructor(clientId = 'default') {
    super();
    this.clientId = clientId;
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
        console.log(`[MongoDB Auth] ⚠️ No hay sesión en MongoDB`);
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
        await WhatsAppSession.updateOne(
          { clientId: this.clientId },
          {
            sessionData: this.session,
            isReady: true,
            readyAt: new Date(),
            updatedAt: new Date()
          },
          { upsert: true }
        );
        console.log(`[MongoDB Auth] ✅ Sesión guardada en MongoDB`);
      }
    } catch (err) {
      console.error(`[MongoDB Auth] Error guardando sesión:`, err);
    }
  }

  async afterBrowserClose() {
    console.log(`[MongoDB Auth] Navegador cerrado para ${this.clientId}`);
    // La sesión se mantiene en MongoDB para la próxima inicialización
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
