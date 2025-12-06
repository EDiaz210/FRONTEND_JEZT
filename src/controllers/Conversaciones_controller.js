// controller_conversaciones.js
import dotenv from "dotenv";
import Conversacion from "../models/Conversaciones.js";

dotenv.config();

// URL de tu backend Python
const PYTHON_BACKEND_URL = process.env.PYTHON_SERVICE_URL;

export const crearConversacion = async (req, res) => {
  try {
    const usuario = req.userBDD;
    const tipoUsuario = req.userBDD?.rol;
    if (!usuario || !tipoUsuario) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    const nueva = await Conversacion.create({
      usuarioId: usuario._id,
      usuarioTipo: tipoUsuario,
      pregunta: [],
      respuesta: [],
    });

    res.json({
      ok: true,
      id: nueva._id,
      message: "Conversación creada correctamente",
    });
  } catch (error) {
    console.error("Error al crear conversación:", error);
    res.status(500).json({ error: "Error al crear conversación" });
  }
};

export const enviarPregunta = async (req, res) => {
  try {
    const { id } = req.params;
    const { question } = req.body;

    if (!question?.trim()) {
      return res.status(400).json({ error: "La pregunta no puede estar vacía" });
    }

    const usuario = req.userBDD;
    const tipoUsuario = req.userBDD?.rol;
    if (!usuario || !tipoUsuario) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    console.log(` Enviando pregunta: "${question}" - Rol: ${tipoUsuario}`);

    const conversacion = await Conversacion.findById(id);
    if (!conversacion) {
      return res.status(404).json({ error: "Conversación no encontrada" });
    }

    // Guardar pregunta inmediatamente
    conversacion.pregunta.push(question);
    await conversacion.save();

    //  CONFIGURAR STREAMING PARA EL FRONTEND
    res.writeHead(200, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Transfer-Encoding': 'chunked'
    });

    try {
      console.log(`Llamando a Python: ${PYTHON_BACKEND_URL}/api/chat`);
      
      // 🔑 OBTENER TOKEN DEL REQUEST ACTUAL
      const authHeader = req.headers.authorization;
      console.log(`[DEBUG] Authorization header recibido: ${authHeader ? 'SÍ' : 'NO'}`);
      
      const token = authHeader?.split(' ')[1];
      console.log(`[DEBUG] Token extraído: ${token ? token.substring(0, 20) + '...' : 'VACÍO'}`);
      
      if (!token) {
        console.warn("⚠️  No se encontró token JWT en el request");
      }
      
      //  LLAMAR A PYTHON CON STREAMING (INCLUYENDO TOKEN)
      const headers = {
        'Content-Type': 'application/json'
      };
      
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
        console.log(`[DEBUG] Token agregado al header de Python`);
      } else {
        console.warn(`[WARNING] Sin token - llamada a Python sin autenticación`);
      }
      
      console.log(`[DEBUG] Headers enviados a Python:`, Object.keys(headers));
      
      const pythonResponse = await fetch(`${PYTHON_BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          pregunta: question,
          streaming: true,
          rol: tipoUsuario,
          usuario_id: usuario._id.toString()
        })
      });

      if (!pythonResponse.ok) {
        throw new Error(`Error del Python API: ${pythonResponse.status}`);
      }

      const reader = pythonResponse.body.getReader();
      const decoder = new TextDecoder();
      let respuestaFinal = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            
            if (data === '[DONE]') {
              break;
            }

            try {
              const parsed = JSON.parse(data);
              console.log("Datos de Python:", parsed);

              //  REENVIAR STREAM AL FRONTEND
              if (parsed.etapa === 'completado') {
                respuestaFinal = parsed.respuesta;
                
                // Enviar respuesta completa al frontend con el formato esperado
                res.write(`data: ${JSON.stringify({
                  etapa: 'completado',
                  respuesta: respuestaFinal,
                  confianza: parsed.confianza || 'media',
                  fuentes: parsed.fuentes || [],
                  id_respuesta_python: parsed.id_respuesta_python || null,
                  calificacion_actual: parsed.calificacion_actual || 0,
                  necesita_calificacion: parsed.necesita_calificacion || true
                })}\n\n`);
                
                // Guardar respuesta en MongoDB
                if (respuestaFinal) {
                  conversacion.respuesta.push(respuestaFinal);
                  await conversacion.save();
                  console.log(`Respuesta guardada para conversación ${id}`);
                }
                
              } else if (parsed.etapa && parsed.etapa !== 'completado') {
                // Reenviar progreso al frontend con el mismo formato
                res.write(`data: ${JSON.stringify({
                  etapa: parsed.etapa,
                  mensaje: parsed.mensaje || 'Procesando...'
                })}\n\n`);
              }
            } catch (e) {
              console.log('Chunk no JSON:', data);
            }
          }
        }
      }

    } catch (error) {
      console.error("Error en comunicación con Python:", error);
      
      //  ENVIAR RESPUESTA DE FALLBACK SI PYTHON FALLA
      const respuestaFallback = "Lo siento, el servicio de IA no está disponible en este momento. Por favor intenta más tarde.";
      
      res.write(`data: ${JSON.stringify({
        etapa: 'completado',
        respuesta: respuestaFallback,
        confianza: 'baja',
        fuentes: [],
        id_respuesta_python: null,
        calificacion_actual: 0,
        necesita_calificacion: false
      })}\n\n`);
      
      // Guardar respuesta de fallback
      conversacion.respuesta.push(respuestaFallback);
      await conversacion.save();
    }

    res.end();

  } catch (error) {
    console.error(" ERROR en enviarPregunta:", error);
    
    // Enviar error como streaming
    res.write(`data: ${JSON.stringify({
      etapa: 'error',
      respuesta: 'Lo siento, hubo un error al procesar tu pregunta.'
    })}\n\n`);
    res.end();
  }
};

export const calificarRespuesta = async (req, res) => {
  try {
    const { id_respuesta_python, calificacion, conversacion_id } = req.body;

    if (!id_respuesta_python || !calificacion) {
      return res.status(400).json({ 
        error: "Se requiere id_respuesta_python y calificacion" 
      });
    }

    //  VERIFICAR AUTENTICACIÓN
    const usuario = req.userBDD;
    const tipoUsuario = req.userBDD?.rol;
    if (!usuario || !tipoUsuario) {
      return res.status(401).json({ error: "Usuario no autenticado" });
    }

    console.log(` Calificando respuesta ${id_respuesta_python} con ${calificacion} estrellas`);

    // 🔍 OBTENER ÚLTIMA PREGUNTA Y RESPUESTA DE LA CONVERSACIÓN
    let ultima_pregunta = null;
    let ultima_respuesta = null;
    
    if (conversacion_id) {
      const conversacion = await Conversacion.findById(conversacion_id);
      if (conversacion && conversacion.pregunta.length > 0 && conversacion.respuesta.length > 0) {
        ultima_pregunta = conversacion.pregunta[conversacion.pregunta.length - 1];
        ultima_respuesta = conversacion.respuesta[conversacion.respuesta.length - 1];
        console.log(` Última pregunta capturada: "${ultima_pregunta}"`);
        console.log(` Última respuesta capturada: "${ultima_respuesta.substring(0, 100)}..."`);
      }
    }

    // 🔑 OBTENER TOKEN DEL REQUEST ACTUAL
    const authHeader = req.headers.authorization;
    console.log(`[DEBUG] Authorization header recibido: ${authHeader ? 'SÍ' : 'NO'}`);
    
    const token = authHeader?.split(' ')[1];
    console.log(`[DEBUG] Token extraído: ${token ? token.substring(0, 20) + '...' : 'VACÍO'}`);
    
    if (!token) {
      console.warn("⚠️  No se encontró token JWT en el request");
    }

    //  ENVIAR CALIFICACIÓN AL BACKEND PYTHON (INCLUYENDO TOKEN)
    const headersCalificar = {
      'Content-Type': 'application/json'
    };
    
    if (token) {
      headersCalificar['Authorization'] = `Bearer ${token}`;
      console.log(`[DEBUG] Token agregado al header de Python`);
    } else {
      console.warn(`[WARNING] Sin token - llamada a Python sin autenticación`);
    }
    
    const response = await fetch(`${PYTHON_BACKEND_URL}/api/calificar-respuesta`, {
      method: 'POST',
      headers: headersCalificar,
      body: JSON.stringify({
        id_respuesta: id_respuesta_python,
        calificacion: parseInt(calificacion),
        usuario_id: usuario._id.toString(),
        rol: tipoUsuario,
        //  ENVIAR PREGUNTA Y RESPUESTA PARA PROCESAMIENTO AUTOMÁTICO
        pregunta_usuario: ultima_pregunta,
        respuesta_dada: ultima_respuesta
      })
    });

    if (!response.ok) {
      throw new Error(`Error del Python API: ${response.status}`);
    }

    const resultado = await response.json();

    if (resultado.success) {
      //  VERIFICAR SI SE ENVIÓ AUTOMÁTICAMENTE AL MÓDULO DE CORRECCIÓN
      let mensaje_respuesta = 'Calificación registrada exitosamente';
      console.log();
      
      if (resultado.enviado_a_correccion) {
        mensaje_respuesta = 'Calificación registrada. La pregunta fue enviada al módulo de corrección automáticamente.';
      }

      res.json({
        ok: true,
        message: mensaje_respuesta,
        calificacion_promedio: resultado.calificacion_promedio,
        total_calificaciones: resultado.total_calificaciones,
        enviado_a_correccion: resultado.enviado_a_correccion || false
      });
    } else {
      res.status(400).json({
        ok: false,
        error: resultado.error || 'Error al calificar la respuesta'
      });
    }

  } catch (error) {
    console.error("Error en calificarRespuesta:", error);
    res.status(500).json({ 
      error: "Error al calificar la respuesta",
      detalle: error.message 
    });
  }
};

//  ELIMINADA COMPLETAMENTE LA FUNCIÓN reportarProblema

export const historialUsuario = async (req, res) => {
  try {
    const usuario = req.userBDD;
    if (!usuario) return res.status(401).json({ error: "Usuario no autenticado" });

    const chats = await Conversacion.find({ usuarioId: usuario._id })
      .sort({ updatedAt: -1 })
      .limit(50);

    const historialFormateado = chats.map(chat => ({
      _id: chat._id,
      pregunta: chat.pregunta.length > 0 ? chat.pregunta[chat.pregunta.length - 1] : "",
      respuesta: chat.respuesta.length > 0 ? chat.respuesta[chat.respuesta.length - 1] : "",
      preguntas: chat.pregunta,
      respuestas: chat.respuesta,
      usuarioId: chat.usuarioId,
      usuarioTipo: chat.usuarioTipo,
      fecha: chat.updatedAt,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt
    }));

    res.json(historialFormateado);
  } catch (e) {
    console.error("Error al obtener historial:", e);
    res.status(500).json({ error: "Error al obtener historial" });
  }
};

export const eliminarConversacion = async (req, res) => {
  try {
    const { id } = req.params;

    const usuario = req.userBDD;
    if (!usuario) return res.status(401).json({ error: "Usuario no autenticado" });

    const conversacion = await Conversacion.findById(id);
    if (!conversacion) {
      return res.status(404).json({ error: "Conversación no encontrada" });
    }

    if (conversacion.usuarioId.toString() !== usuario._id.toString()) {
      return res.status(403).json({ error: "No tienes permiso para eliminar esta conversación" });
    }

    await Conversacion.findByIdAndDelete(id);

    res.json({ ok: true, message: "Conversación eliminada correctamente" });
  } catch (error) {
    console.error("Error al eliminar conversación:", error);
    res.status(500).json({ error: "Error al eliminar conversación" });
  }

};

