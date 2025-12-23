import jwt from "jsonwebtoken"
import User from "../models/User.js"

const crearTokenJWT = (id, rol) => {

    return jwt.sign({ id, rol }, process.env.JWT_SECRET, { expiresIn: "2m" })
}

const verificarTokenJWT = async (req, res, next) => {

	const { authorization } = req.headers
    if (!authorization) return res.status(401).json({ msg: "Acceso denegado: token no proporcionado" })
    try {
        const token = authorization.split(" ")[1]
        const { id, rol } = jwt.verify(token,process.env.JWT_SECRET)
        req.userBDD = await User.findById(id).lean().select("-password")
        if (!req.userBDD) return res.status(401).json({ msg: "Usuario no encontrado" })
        next()
    } catch (error) {
        console.log(error)
        return res.status(401).json({ msg: `Token inválido o expirado - ${error}` })
    }
}



// Middlewares de roles
const isAdmin = (req, res, next) => {
    if (req.userBDD?.rol !== 'administrador') {
        return res.status(403).json({ msg: 'Acceso denegado: solo administradores' });
    }
    next();
};

const isStudent = (req, res, next) => {
    if (req.userBDD?.rol !== 'estudiante') {
        return res.status(403).json({ msg: 'Acceso denegado: solo estudiantes' });
    }
    next();
};

const isIntern = (req, res, next) => {
    if (req.userBDD?.rol !== 'pasante') {
        return res.status(403).json({ msg: 'Acceso denegado: solo pasantes' });
    }
    next();
};

export {
    crearTokenJWT,
    verificarTokenJWT,
    isAdmin,
    isStudent,
    isIntern
}

