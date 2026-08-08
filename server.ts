import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import admin from "firebase-admin";
import fs from "fs";

dotenv.config();

// Initialize Firebase Admin dynamically from config
const initializeAdmin = () => {
  if (admin.apps.length) return;

  try {
    // 1. Try default initialization (best for Cloud Run)
    admin.initializeApp();
    console.log("Firebase Admin initialized with default credentials");
  } catch (defaultErr) {
    console.log("Default initialization failed, trying with config file...");
    try {
      // 2. Try reading from firebase-applet-config.json
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
        admin.initializeApp({
          projectId: config.projectId
        });
        console.log(`Firebase Admin initialized with projectId from config: ${config.projectId}`);
      } else {
        throw new Error("Config file not found");
      }
    } catch (configErr: any) {
      console.error("Firebase Admin initialization failed completely:", configErr.message);
    }
  }
};

initializeAdmin();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Route for testing Firebase Admin
  app.get("/api/test-admin", async (req, res) => {
    try {
      if (!admin.apps.length) {
        return res.status(500).json({ error: "Firebase Admin not initialized" });
      }
      const listUsersResult = await admin.auth().listUsers(1);
      res.json({ 
        success: true, 
        message: "Firebase Admin is working", 
        userCount: listUsersResult.users.length,
        projectId: admin.app().options.projectId
      });
    } catch (error: any) {
      console.error("Test Admin error:", error);
      res.status(500).json({ error: error.message, code: error.code });
    }
  });

  // API Route for deleting a user from Firebase Auth
  app.post("/api/delete-auth-user", async (req, res) => {
    let { email, uid } = req.body;
    if (!email) {
      return res.status(400).json({ error: "El correo electrónico es requerido." });
    }

    email = email.toLowerCase().trim();
    console.log(`[DELETE-AUTH] Request received for: ${email} (UID: ${uid})`);

    if (!admin.apps.length) {
      console.error("[DELETE-AUTH] Firebase Admin not initialized");
      return res.status(500).json({ error: "El servidor de administración no está inicializado." });
    }

    try {
      let deleted = false;
      let method = '';

      // 1. Try deleting by UID first if it looks like a real UID
      if (uid && uid.length > 20 && !uid.includes('@')) {
        try {
          console.log(`[DELETE-AUTH] Attempting deletion by UID: ${uid}`);
          await admin.auth().deleteUser(uid);
          console.log(`[DELETE-AUTH] Successfully deleted by UID: ${uid}`);
          deleted = true;
          method = 'uid';
        } catch (uidErr: any) {
          console.log(`[DELETE-AUTH] Failed to delete by UID ${uid}: ${uidErr.message} (${uidErr.code})`);
        }
      }

      // 2. Try to find user by email if not deleted yet
      if (!deleted) {
        console.log(`[DELETE-AUTH] Searching for user by email: ${email}`);
        try {
          const userRecord = await admin.auth().getUserByEmail(email);
          console.log(`[DELETE-AUTH] Found user with UID: ${userRecord.uid}. Deleting...`);
          await admin.auth().deleteUser(userRecord.uid);
          console.log(`[DELETE-AUTH] Successfully deleted user by email: ${email}`);
          deleted = true;
          method = 'email';
        } catch (emailErr: any) {
          if (emailErr.code === 'auth/user-not-found') {
            console.log(`[DELETE-AUTH] User not found in Auth by email: ${email}.`);
            return res.json({ success: true, message: "El usuario no existía en Auth.", deleted: false });
          }
          console.warn(`[DELETE-AUTH] Identity/Auth lookup notice: ${emailErr.message}`);
          return res.json({ success: true, message: "El perfil de Firestore fue eliminado correctamente.", deleted: false, notice: emailErr.message });
        }
      }

      return res.json({ success: true, deleted: true, method });
    } catch (error: any) {
      console.warn("[DELETE-AUTH] Handled Auth API error gracefully:", error.message);
      res.json({ 
        success: true, 
        deleted: false,
        message: "El perfil en la base de datos fue eliminado.",
        notice: error.message 
      });
    }
  });

  // API Route for sending emails via Gmail SMTP
  app.post("/api/send-email", async (req, res) => {
    const { to, subject, html } = req.body;

    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_APP_PASSWORD;

    if (!user || !pass) {
      console.error("Missing GMAIL_USER or GMAIL_APP_PASSWORD");
      return res.status(500).json({ error: "Configuración de correo incompleta en el servidor." });
    }

    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: user,
        pass: pass,
      },
    });

    try {
      await transporter.sendMail({
        from: `"DUNOR Sistema de Incidencias" <${user}>`,
        to,
        subject,
        html,
      });
      res.json({ success: true });
    } catch (error) {
      console.error("Error sending email:", error);
      res.status(500).json({ error: "Error al enviar el correo." });
    }
  });

  // API Route for forgot password (custom email)
  app.post("/api/forgot-password", async (req, res) => {
    const { email, origin } = req.body;
    if (!email) return res.status(400).json({ error: "El correo es requerido." });

    try {
      // Generate the standard Firebase reset link
      const link = await admin.auth().generatePasswordResetLink(email, {
        url: origin || "http://localhost:3000",
        handleCodeInApp: true
      });

      const user = process.env.GMAIL_USER;
      const pass = process.env.GMAIL_APP_PASSWORD;

      if (!user || !pass) {
        throw new Error("Configuración de correo incompleta.");
      }

      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user, pass },
      });

      await transporter.sendMail({
        from: `"DUNOR Sistema de Incidencias" <${user}>`,
        to: email,
        subject: "Recuperación de Contraseña - Diario del Docente",
        html: `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
            <div style="background-color: #4f46e5; padding: 20px; text-align: center;">
              <h2 style="color: white; margin: 0;">Recuperación de Contraseña</h2>
            </div>
            <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
              <p>Hola,</p>
              <p>Has solicitado restablecer tu contraseña para el <strong>Diario del Docente</strong>.</p>
              <p>Haz clic en el siguiente botón para elegir una nueva contraseña:</p>
              <div style="text-align: center; margin: 35px 0;">
                <a href="${link}" style="background-color: #4f46e5; color: white; padding: 14px 28px; text-decoration: none; border-radius: 10px; font-weight: bold; display: inline-block;">Restablecer Contraseña</a>
              </div>
              <p style="font-size: 14px; color: #64748b;">Si no solicitaste este cambio, puedes ignorar este correo de forma segura. Tu contraseña actual no cambiará.</p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
              <p style="color: #94a3b8; font-size: 12px; text-align: center;">Este es un mensaje automático del sistema DUNOR.</p>
            </div>
          </div>
        `,
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error in forgot-password API:", error);
      if (error.code === 'auth/user-not-found') {
        return res.status(404).json({ error: "No se encontró una cuenta con este correo electrónico." });
      }
      res.status(500).json({ 
        error: "Error al procesar la solicitud de recuperación.",
        details: error.message,
        code: error.code
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
