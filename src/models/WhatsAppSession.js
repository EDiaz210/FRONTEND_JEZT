import mongoose, { Schema, model } from 'mongoose';

const whatsappSessionSchema = new Schema({
  clientId: {
    type: String,
    required: true,
    unique: true,
    default: 'default'
  },
  // Datos serializados de la sesión de WhatsApp
  sessionData: {
    type: Schema.Types.Mixed,
    default: null  // ✅ NO es requerido para permitir guardado gradual
  },
  // Metadata
  qrCode: {
    type: String, // QR en formato DataURL
    default: null
  },
  isReady: {
    type: Boolean,
    default: false
  },
  readyAt: {
    type: Date,
    default: null
  },
  lastQRGenerated: {
    type: Date,
    default: null
  },
  // Control
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Índice para búsquedas rápidas
whatsappSessionSchema.index({ clientId: 1 });

export default model('WhatsAppSession', whatsappSessionSchema);
