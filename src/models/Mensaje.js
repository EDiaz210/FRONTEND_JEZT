import mongoose, { Schema, model } from 'mongoose';
import { encryptText, decryptText, isEncrypted } from '../utils/crypto.js';

const mensajeSchema = new Schema({
  numbers: {
    type: [String],
    required: true, 
  },
  message: {
    type: String,
    default: '',
  },
  hasMedia: {
    type: Boolean,
    default: false,
  },
  files: [
    {
      fileName: { type: String },
      mimeType: { type: String },
    },
  ],
  date: {
    type: Date,
    default: Date.now,
  },
  tipo: {
    type: String,
    enum: ['Administrativas', 'Académicas', 'Extracurriculares'],
    required: true,
  },
  status: {
    type: Boolean,
    default: true,
  },
});

// Encrypt message antes de guardar ( si modificado y no ya encriptado)
mensajeSchema.pre('save', function (next) {
  try {
    if (this.isModified('message') && this.message && !isEncrypted(this.message)) {
      this.message = encryptText(this.message);
    }
  } catch (err) {
    console.error('Mensaje pre-save encrypt error', err);
    // no bloquear guardado en errores de encriptación
  }
  next();
});

// Decrypt cuando el documento es inicializado (cargado desde la BD)
mensajeSchema.post('init', function (doc) {
  try {
    if (doc && doc.message && isEncrypted(doc.message)) {
      doc.message = decryptText(doc.message);
    }
  } catch (err) {
    console.error('Mensaje post-init decrypt error', err);
  }
});

// Decrypt resultados para consultas find/findOne
mensajeSchema.post('find', function (docs) {
  docs.forEach((doc) => {
    try {
      if (doc && doc.message && isEncrypted(doc.message)) {
        doc.message = decryptText(doc.message);
      }
    } catch (err) {
      console.error('Mensaje post-find decrypt error', err);
    }
  });
});

mensajeSchema.post('findOne', function (doc) {
  if (!doc) return;
  try {
    if (doc.message && isEncrypted(doc.message)) {
      doc.message = decryptText(doc.message);
    }
  } catch (err) {
    console.error('Mensaje post-findOne decrypt error', err);
  }
});

export default model('Mensaje', mensajeSchema);
