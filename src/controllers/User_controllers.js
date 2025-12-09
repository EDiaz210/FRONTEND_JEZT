
import User from "../models/User.js";
import { esNumeroEcuador } from "../utils/normalize.js";
import { crearTokenJWT } from "../middlewares/JWT.js";
import { sendMailToRegister, sendMailToRecoveryPassword } from "../config/nodemailer.js";
import { v2 as cloudinary } from 'cloudinary';
import fs from "fs-extra";
import mongoose from "mongoose";

// Registro de usuario estudiante
const registro = async (req, res) => {
  try {
    const { email, password, username, rol, numero } = req.body;
    if (Object.values(req.body).includes(""))
      return res.status(400).json({ msg: "Debes llenar todos los campos" });

    // Validar que el email pertenezca al dominio @epn.edu.ec
    const emailLower = (email || '').toString().toLowerCase();
    if (!emailLower.endsWith("@epn.edu.ec")) {
      return res.status(400).json({ msg: "El correo debe pertenecer al dominio @epn.edu.ec" });
    }

    // Validar que la contraseña tenga al menos 14 caracteres
    if (password && password.length < 14) {
      return res.status(400).json({ msg: "La contraseña debe tener al menos 14 caracteres" });
    }

    // Validar email único
    const verificarEmailBDD = await User.findOne({ email: new RegExp(`^${emailLower}$`, 'i') });
    if (verificarEmailBDD) {
      return res.status(400).json({ msg: "El email ya se encuentra registrado" });
    }

    // Validar username único
    if (username) {
      const verificarUsername = await User.findOne({ username });
      if (verificarUsername) {
        return res.status(400).json({ msg: "El nombre de usuario ya está en uso" });
      }
    }

    // Validar que el número sea de Ecuador
    if (numero && !esNumeroEcuador(numero)) {
      return res.status(400).json({ msg: "El número debe ser de Ecuador" });
    }
    // Validar número único
    if (numero) {
      const existeNumero = await User.findOne({ numero });
      if (existeNumero) return res.status(400).json({ msg: "El número ya está registrado" });
    }

    const nuevoUsuario = new User(req.body);
    if (req.files?.imagen) {
      const { secure_url, public_id } = await cloudinary.uploader.upload(req.files.imagen.tempFilePath, { folder: 'Usuarios' });
      nuevoUsuario.avatarUsuario = secure_url;
      nuevoUsuario.avatarUsuarioID = public_id;
      await fs.unlink(req.files.imagen.tempFilePath);
    }
    nuevoUsuario.password = await nuevoUsuario.encryptPassword(password);
    const token = nuevoUsuario.crearToken();
    await sendMailToRegister(email, token);
    await nuevoUsuario.save();
    return res.status(200).json({ msg: "Revisa tu correo electrónico para confirmar tu cuenta" });
  } catch (err) {
    const dupCode = err?.code || err?.errorResponse?.code;
    if (dupCode === 11000) {
      const key = err.keyValue ? Object.keys(err.keyValue)[0] : 'campo';
      return res.status(400).json({ msg: `El ${key} ya está registrado` });
    }
    return res.status(500).json({ msg: 'Ocurrió un error en el servidor' });
  }
};

// Confirmar email
const confirmarEmail = async (req, res) => {
  if (!req.params.token)
    return res.status(400).json({ msg: "No se puede validar la cuenta" });
  const userBDD = await User.findOne({ token: req.params.token });
  if (!userBDD?.token)
    return res.status(404).json({ msg: "La cuenta ya ha sido confirmada" });
  userBDD.token = null;
  userBDD.confirmEmail = true;
  await userBDD.save();
  res.status(200).json({ msg: "Token confirmado, ya puedes iniciar sesión" });
};

// Login
const login = async (req, res) => {
  const { email, password } = req.body;
  if (Object.values(req.body).includes(""))
    return res.status(400).json({ msg: "Debes llenar todos los campos" });
  
  // Validar que el email pertenezca al dominio @epn.edu.ec
  const emailLower = (email || '').toString().toLowerCase();
  if (!emailLower.endsWith("@epn.edu.ec")) {
    return res.status(400).json({ msg: "El correo debe pertenecer al dominio @epn.edu.ec" });
  }

  // Validar que la contraseña tenga al menos 14 caracteres
  if (password && password.length < 14) {
    return res.status(400).json({ msg: "La contraseña debe tener al menos 14 caracteres" });
  }
  const userBDD = await User.findOne({ email }).select("-status -__v -token -updatedAt -createdAt");
  if (!userBDD) return res.status(404).json({ msg: "Usuario no existe" });
  const verificarPassword = await userBDD.matchPassword(password);
  if (!verificarPassword) return res.status(401).json({ msg: "Contraseña incorrecta" });
  const { nombre, apellido, username, _id, rol } = userBDD;
  const token = crearTokenJWT(userBDD._id, userBDD.rol);
  res.status(200).json({ token, nombre, apellido, username, _id, rol, email: userBDD.email });
};

// Perfil
const perfil = (req, res) => {
  const { token, confirmEmail, createdAt, updatedAt, __v, ...datosPerfil } = req.userBDD;
  res.status(200).json(datosPerfil);
};

// Recuperar password
const recuperarPassword = async (req, res) => {
  const { email } = req.body;
  if (!email || email.trim() === "") {
    return res.status(400).json({ msg: "Debes llenar todos los campos" });
  }
  const userBDD = await User.findOne({ email: new RegExp(`^${email.trim()}$`, "i") });
  if (!userBDD) {
    return res.status(404).json({ msg: "Usuario no registrado" });
  }
  const token = userBDD.crearToken();
  userBDD.token = token;
  await sendMailToRecoveryPassword(userBDD.email, token);
  await userBDD.save();
  res.status(200).json({ msg: "Revisa tu correo electrónico para reestablecer tu cuenta" });
};

// Comprobar token de password
const comprobarTokenPassword = async (req, res) => {
  const { token } = req.params;
  const userBDD = await User.findOne({ token });
  if (userBDD?.token !== token) {
    return res.status(404).json({ msg: "No se puede validar la cuenta" });
  }
  await userBDD.save();
  res.status(200).json({ msg: "Token confirmado, ya puedes crear tu nuevo password" });
};

// Crear nueva password
const crearNuevaPassword = async (req, res) => {
  const { password, confirmpassword } = req.body;
  if (Object.values(req.body).includes("")) {
    return res.status(404).json({ msg: "Debes llenar todos los campos" });
  }
  // Validar que la contraseña tenga al menos 14 caracteres
  if (password && password.length < 14) {
    return res.status(400).json({ msg: "La contraseña debe tener al menos 14 caracteres" });
  }
  if (password !== confirmpassword) {
    return res.status(404).json({ msg: "Los passwords no coinciden" });
  }
  const userBDD = await User.findOne({ token: req.params.token });
  if (userBDD?.token !== req.params.token) {
    return res.status(404).json({ msg: "Error de validación" });
  }
  userBDD.token = null;
  userBDD.password = await userBDD.encryptPassword(password);
  await userBDD.save();
  res.status(200).json({ msg: "Contraseña actualizada con éxito" });
};

// Actualizar perfil 
const updatePerfil = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ msg: "ID inválido" });
    }
    const usuario = await User.findById(id);
    if (!usuario) {
      return res.status(404).json({ msg: "Usuario no encontrado" });
    }
    if (req.userBDD._id.toString() !== id) return res.status(403).json({ msg: 'No autorizado' });
    const { email, username, numero } = req.body;

    // Validar email único (ignorando el propio usuario)
    if (email) {
      const emailLower = email.toString().toLowerCase();
      const existeEmail = await User.findOne({ email: new RegExp(`^${emailLower}$`, 'i'), _id: { $ne: id } });
      if (existeEmail) return res.status(400).json({ msg: "El email ya se encuentra registrado" });
    }
    // Validar username único
    if (username) {
      const existeUsername = await User.findOne({ username, _id: { $ne: id } });
      if (existeUsername) return res.status(400).json({ msg: "El nombre de usuario ya está en uso" });
    }
    // Validar que el número sea de Ecuador
    if (numero && !esNumeroEcuador(numero)) {
      return res.status(400).json({ msg: "El número debe ser de Ecuador" });
    }
    // Validar número único
    if (numero) {
      const existeNumero = await User.findOne({ numero, _id: { $ne: id } });
      if (existeNumero) return res.status(400).json({ msg: "El número ya está registrado" });
    }

    const campos = ["nombre", "apellido", "username", "email", "numero", "carrera"];
    campos.forEach((campo) => {
      if (req.body[campo] !== undefined) usuario[campo] = req.body[campo];
    });
    await usuario.save();
    res.status(200).json(usuario);
  } catch (error) {
    res.status(500).json({ msg: 'Error al actualizar perfil', error });
  }
};

// Cambiar contraseña 
const updatePassword = async (req, res) => {
  try {
    const { id } = req.params;
    const usuario = await User.findById(id);
    if (!usuario) return res.status(404).json({ msg: 'Lo sentimos, no existe el usuario' });
    const { presentpassword, newpassword } = req.body;
    if (Object.values(req.body).includes("")) {
      return res.status(400).json({ msg: "Lo sentimos, debes llenar todos los campos" });
    }
    // Validar que la nueva contraseña tenga al menos 14 caracteres
    if (newpassword && newpassword.length < 14) {
      return res.status(400).json({ msg: "La contraseña debe tener al menos 14 caracteres" });
    }
    const verificarPassword = await usuario.matchPassword(presentpassword);
    if (!verificarPassword) return res.status(404).json({ msg: "Lo sentimos, la contraseña actual no es correcta" });
    usuario.password = await usuario.encryptPassword(newpassword);
    await usuario.save();
    res.status(200).json({ msg: "Contraseña actualizada correctamente" });
  } catch (error) {
    res.status(500).json({ msg: 'Error al actualizar contraseña', error });
  }
};

// Eliminar cuenta 
const deletePerfil = async (req, res) => {
  try {
    const { id } = req.params;
    if (req.userBDD._id.toString() !== id) return res.status(403).json({ msg: 'No autorizado' });
    await User.findByIdAndDelete(id);
    res.status(200).json({ msg: 'Cuenta eliminada correctamente' });
  } catch (error) {
    res.status(500).json({ msg: 'Error al eliminar cuenta', error });
  }
};

// Actualizar imagen
const updateAvatar = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(404).json({ msg: "ID inválido" });
    }
    const usuario = await User.findById(id);
    if (!usuario) {
      return res.status(404).json({ msg: "Usuario no encontrado" });
    }
    if (req.userBDD._id.toString() !== id) return res.status(403).json({ msg: 'No autorizado' });
    // Eliminar imagen anterior si existe
    if (usuario.avatarUsuarioID) {
      await cloudinary.uploader.destroy(usuario.avatarUsuarioID);
    }
    let secure_url, public_id;
    // Caso 1: Imagen subida como archivo (buffer)
    if (req.file) {
      ({ secure_url, public_id } = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "Usuarios", resource_type: "auto" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.file.buffer);
      }));
      usuario.avatarUsuario = secure_url;
      usuario.avatarUsuarioID = public_id;
    } else {
      return res.status(400).json({ msg: "No se envió ninguna imagen" });
    }
    await usuario.save();
    res.status(200).json({
      msg: "Imagen actualizada correctamente",
      avatar: secure_url
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ msg: "Error al subir imagen" });
  }
};

//FUNCIONES DEL ADMINISTRADOR

// Cambiar rol de estudiante a pasante
const cambiarRolPasante = async (req, res) => {
  try {
    // Solo administradores pueden cambiar el rol
    if (!req.userBDD || req.userBDD.rol !== "administrador") {
      return res.status(403).json({ msg: "Acceso denegado: solo administradores pueden cambiar el rol" });
    }
    const { id } = req.params;
    const usuario = await User.findById(id);
    if (!usuario) return res.status(404).json({ msg: "Usuario no encontrado" });
    if (usuario.rol === "pasante") {
      return res.status(400).json({ msg: "El usuario ya es pasante" });
    }
    usuario.rol = "pasante";
    await usuario.save();
    res.status(200).json({ msg: "Rol actualizado a pasante", usuario });
  } catch (error) {
    res.status(500).json({ msg: `Error al cambiar el rol - ${error.message || error}` });
  }
};


// Banear pasante
const baneoPasante = async (req, res) => {
  const { id } = req.params;
  // Validar que el usuario autenticado sea administrador
  if (!req.userBDD || req.userBDD.rol !== "administrador") {
    return res.status(403).json({ msg: "Acceso denegado: solo administradores pueden banear jugadores" });
  }
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ msg: "Lo sentimos, debe ser un id válido" });
  }
  const pasanteBDD = await User.findOne({ _id: id, rol: "pasante" });
  if (!pasanteBDD) {
    return res.status(404).json({ msg: "Jugador no encontrado" });
  }
  if (pasanteBDD.status === false) {
    return res.status(404).json({ msg: "Este Jugador ya se encuentra Baneado por comportamiento inapropiado" });
  }
  pasanteBDD.status = false;
  await pasanteBDD.save();
  res.status(200).json({ msg: `El jugador ${pasanteBDD.username} ha sido baneado por comportamiento inapropiado` });
};

// Listar pasantes
const listarPasantes = async (req, res) => {
  // Validar que el usuario autenticado sea administrador
  if (!req.userBDD || req.userBDD.rol !== "administrador") {
    return res.status(403).json({ msg: "Acceso denegado: solo administradores pueden listar pasantes" });
  }
  const pasantes = await User.find({ rol: "pasante", status: true }).select("-createdAt -updatedAt -__v");
  res.status(200).json(pasantes);
};

//detalle de  cada pasante
const detallePasante = async (req, res) => {
  const { id } = req.params;
  // Validar que el usuario autenticado sea administrador
  if (!req.userBDD || req.userBDD.rol !== "administrador") {
    return res.status(403).json({ msg: "Acceso denegado: solo administradores pueden ver detalles de pasantes" });
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ msg: `Lo sentimos, no existe el pasante ${id}` });
  const pasante = await User.findOne({ _id: id, rol: "pasante" }).select("-createdAt -updatedAt -__v -password");
  res.status(200).json(pasante);
};


// Banear estudiante
const baneoEstudiante = async (req, res) => {
  const { id } = req.params;
  // Validar que el usuario autenticado sea administrador
  if (!req.userBDD || req.userBDD.rol !== "administrador") {
    return res.status(403).json({ msg: "Acceso denegado: solo administradores pueden banear jugadores" });
  }
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ msg: "Lo sentimos, debe ser un id válido" });
  }
  const estudianteBDD = await User.findOne({ _id: id, rol: "estudiante" });
  if (!estudianteBDD) {
    return res.status(404).json({ msg: "Jugador no encontrado" });
  }
  if (estudianteBDD.status === false) {
    return res.status(404).json({ msg: "Este Jugador ya se encuentra Baneado por comportamiento inapropiado" });
  }
  estudianteBDD.status = false;
  await estudianteBDD.save();
  res.status(200).json({ msg: `El estudiante ${estudianteBDD.username} ha sido baneado por comportamiento inapropiado` });
};

// Listar estudiantes
const listarEstudiantes = async (req, res) => {
  try {
    // Validar que el usuario autenticado sea administrador o pasante
    if (!req.userBDD || (req.userBDD.rol !== "administrador" && req.userBDD.rol !== "pasante")) {
      return res.status(403).json({ msg: "Acceso denegado: solo administradores y pasantes pueden listar estudiantes" });
    }
    const { carrera } = req.query;
    const filtro = { rol: "estudiante", status: true };
    if (carrera && carrera !== "Todos") filtro.carrera = carrera;
    const estudiantes = await User.find(filtro)
      .select("nombre apellido username email numero carrera status _id")
      .sort({ carrera: 1, nombre: 1 });
    res.status(200).json(estudiantes);
  } catch (error) {
    console.error("Error al listar estudiantes:", error);
    res.status(500).json({ msg: "Error al listar estudiantes" });
  }
};

//detalle de  cada estudiante
const detalleEstudiante = async (req, res) => {
  const { id } = req.params;
  // Validar que el usuario autenticado sea administrador
  if (!req.userBDD || req.userBDD.rol !== "administrador") {
    return res.status(403).json({ msg: "Acceso denegado: solo administradores pueden ver detalles de estudiantes" });
  }
  if (!mongoose.Types.ObjectId.isValid(id)) return res.status(404).json({ msg: `Lo sentimos, no existe el jugador ${id}` });
  const estudiante = await User.findOne({ _id: id, rol: "estudiante" }).select("-createdAt -updatedAt -__v -password");
  res.status(200).json(estudiante);
};

export {
    registro,
    confirmarEmail,
    login,
    perfil,
    recuperarPassword,
    comprobarTokenPassword,
    crearNuevaPassword,
    updatePerfil,
    updatePassword,
    deletePerfil,
    updateAvatar,

    
    //Funciones del administrador
    cambiarRolPasante,
    baneoPasante,
    listarPasantes,
    detallePasante,
    baneoEstudiante,
    listarEstudiantes,
    detalleEstudiante
};
