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
    // 1. Try reading from firebase-applet-config.json first to target the actual project
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
      if (config.projectId) {
        admin.initializeApp({
          projectId: config.projectId
        });
        console.log(`Firebase Admin initialized with projectId from config: ${config.projectId}`);
        return;
      }
    }
  } catch (configErr: any) {
    console.warn("Firebase Admin config file read notice:", configErr.message);
  }

  try {
    // 2. Default initialization fallback
    admin.initializeApp();
    console.log("Firebase Admin initialized with default credentials");
  } catch (defaultErr: any) {
    console.error("Firebase Admin initialization failed completely:", defaultErr.message);
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

  // API Route for creating or updating a user in Firebase Auth
  app.post("/api/create-or-update-auth-user", async (req, res) => {
    let { email, password, name, role, phone, educationLevel } = req.body;
    if (!email) {
      return res.status(400).json({ error: "El correo electrónico es requerido." });
    }

    email = email.toLowerCase().trim();
    role = (role || 'TEACHER').toUpperCase();
    const displayName = name?.trim() || email.split('@')[0];
    const userPassword = password && password.length >= 6 ? password : (role === 'ADMIN' ? 'qwerty1' : 'dunor2024');

    let authUid = email;
    let createdInAuth = false;
    let updatedInAuth = false;
    let authError = null;

    if (admin.apps.length) {
      try {
        let userRecord;
        try {
          userRecord = await admin.auth().getUserByEmail(email);
          authUid = userRecord.uid;
          const updatePayload: any = { displayName };
          if (password && password.length >= 6) {
            updatePayload.password = password;
          }
          await admin.auth().updateUser(userRecord.uid, updatePayload);
          updatedInAuth = true;
        } catch (notFoundErr: any) {
          if (notFoundErr.code === 'auth/user-not-found') {
            userRecord = await admin.auth().createUser({
              email,
              password: userPassword,
              displayName,
              emailVerified: true
            });
            authUid = userRecord.uid;
            createdInAuth = true;
          } else {
            throw notFoundErr;
          }
        }

        try {
          await admin.auth().setCustomUserClaims(authUid, {
            role: role,
            admin: role === 'ADMIN'
          });
        } catch (claimsErr) {
          console.warn("Could not set custom claims:", claimsErr);
        }

        try {
          const dbAdmin = admin.firestore();
          const docData: any = {
            uid: authUid,
            email,
            name: displayName,
            role,
            isRegistered: true,
            password: userPassword,
            updatedAt: Date.now()
          };
          if (phone) docData.phone = phone;
          if (educationLevel) docData.educationLevel = educationLevel;
          await dbAdmin.collection('users').doc(email).set(docData, { merge: true });
        } catch (dbErr) {
          console.warn("Firestore sync in create-auth notice:", dbErr);
        }
      } catch (err: any) {
        console.warn("[CREATE-AUTH] Firebase Auth notice:", err?.message);
        authError = err?.message;
      }
    }

    res.json({
      success: true,
      uid: authUid,
      email,
      name: displayName,
      role,
      password: userPassword,
      createdInAuth,
      updatedInAuth,
      authError,
      message: createdInAuth 
        ? `Usuario creado y registrado en Authentication con contraseña: ${userPassword}`
        : `Usuario sincronizado en Authentication`
    });
  });

  // API Route for syncing all Firestore users to Firebase Auth
  app.post("/api/sync-all-users", async (req, res) => {
    const { users } = req.body;
    if (!users || !Array.isArray(users)) {
      return res.status(400).json({ error: "Se requiere un arreglo de usuarios." });
    }

    if (!admin.apps.length) {
      return res.status(500).json({ error: "Firebase Admin no está inicializado." });
    }

    const results: any[] = [];
    for (const u of users) {
      if (!u.email) continue;
      const cleanEmail = u.email.toLowerCase().trim();
      const displayName = u.name?.trim() || cleanEmail.split('@')[0];
      const userRole = (u.role || 'TEACHER').toUpperCase();
      const userPassword = u.password && u.password.length >= 6 ? u.password : (userRole === 'ADMIN' ? 'qwerty1' : 'dunor2024');

      try {
        let userRecord;
        try {
          userRecord = await admin.auth().getUserByEmail(cleanEmail);
          const updateData: any = { displayName };
          if (u.password && u.password.length >= 6) {
            updateData.password = u.password;
          }
          await admin.auth().updateUser(userRecord.uid, updateData);
          results.push({ email: cleanEmail, status: 'updated', uid: userRecord.uid });
        } catch (e: any) {
          if (e.code === 'auth/user-not-found') {
            userRecord = await admin.auth().createUser({
              email: cleanEmail,
              password: userPassword,
              displayName,
              emailVerified: true
            });
            results.push({ email: cleanEmail, status: 'created', uid: userRecord.uid });
          } else {
            results.push({ email: cleanEmail, status: 'error', error: e.message });
          }
        }

        if (userRecord?.uid) {
          await admin.auth().setCustomUserClaims(userRecord.uid, {
            role: userRole,
            admin: userRole === 'ADMIN'
          }).catch(() => {});
        }
      } catch (itemErr: any) {
        results.push({ email: cleanEmail, status: 'error', error: itemErr.message });
      }
    }

    res.json({ success: true, count: results.length, details: results });
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

    const user = process.env.GMAIL_USER || process.env.SMTP_USER;
    const pass = process.env.GMAIL_APP_PASSWORD || process.env.SMTP_PASS;

    if (!user || !pass) {
      console.error("[EMAIL-ERROR] Missing GMAIL_USER or GMAIL_APP_PASSWORD environment variables");
      return res.status(500).json({ error: "Configuración de correo incompleta en el servidor (faltan credenciales GMAIL_USER / GMAIL_APP_PASSWORD)." });
    }

    try {
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST || "smtp.gmail.com",
        port: Number(process.env.SMTP_PORT) || 465,
        secure: process.env.SMTP_SECURE !== "false", // default true for 465
        auth: {
          user: user,
          pass: pass,
        },
        tls: {
          rejectUnauthorized: false
        }
      });

      await transporter.sendMail({
        from: `"${process.env.APP_NAME || 'DUNOR Sistema de Incidencias'}" <${user}>`,
        to,
        subject,
        html,
      });

      console.log(`[EMAIL-SUCCESS] Sent email to ${to} with subject "${subject}"`);
      res.json({ success: true });
    } catch (error: any) {
      console.error("[EMAIL-ERROR] Failed to send email via SMTP:", error);
      res.status(500).json({ error: error?.message || "Error al enviar el correo." });
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
