import express from "express";
import {
    registro,
    confirmarEmail,
    login,
    perfil,
    updatePerfil,
    updatePassword,
    deletePerfil,
    updateAvatar,
    recuperarPassword,
    comprobarTokenPassword,
    crearNuevaPassword,
    cambiarRolPasante,
    baneoPasante,
    listarPasantes,
    detallePasante,
    baneoEstudiante,
    listarEstudiantes,
    detalleEstudiante

} from "../controllers/User_controllers.js";
import { verificarTokenJWT } from '../middlewares/JWT.js'
import upload from '../middlewares/Upload.js'

const router = express.Router();

// Registro y login
router.post("/register", registro);
router.post("/login", login);
router.get("/confirmar/:token", confirmarEmail);


//Recuperar y crear nueva password
router.post("/recuperarpassword", recuperarPassword);
router.get("/recuperarpassword/:token", comprobarTokenPassword);
router.post("/nuevopassword/:token", crearNuevaPassword);

// Perfil
router.get("/perfil",verificarTokenJWT, perfil);
router.put("/perfil/:id", verificarTokenJWT, updatePerfil);
router.put("/perfil/actualizarpassword/:id", verificarTokenJWT, updatePassword);
router.delete("/perfil/eliminar/:id", verificarTokenJWT, deletePerfil);
router.put("/perfil/imagen/:id", verificarTokenJWT, upload.single('imagen'), updateAvatar);

//FUNCIONES DEL ADMINISTRADOR
//Rol pasante
router.put("/cambiar-rol-pasante/:id", verificarTokenJWT, cambiarRolPasante)
router.delete('/pasante/banear/:id',verificarTokenJWT,baneoPasante)
router.get('/pasantes',verificarTokenJWT, listarPasantes)
router.get('/pasante/detalle/:id',verificarTokenJWT, detallePasante)


//Rol estudiante
router.delete('/estudiante/banear/:id',verificarTokenJWT,baneoEstudiante)
router.get('/estudiantes',verificarTokenJWT, listarEstudiantes)
router.get('/estudiante/detalle/:id',verificarTokenJWT, detalleEstudiante)


export default router;
