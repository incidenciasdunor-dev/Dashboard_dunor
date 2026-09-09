import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';

// Initialize Firebase Admin if credentials are present
function initAdmin() {
  if (!admin.apps.length) {
    try {
      if (process.env.FIREBASE_CONFIG || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        admin.initializeApp();
      } else {
        admin.initializeApp({
          projectId: process.env.VITE_FIREBASE_PROJECT_ID || "ai-studio-dashboarddunor-1c41b12b-3330-4217-b423-64dc4df16dd5"
        });
      }
    } catch (e) {
      console.warn("Firebase Admin init notice in Vercel function:", e);
    }
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.query;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email query param required' });
  }

  const cleanEmail = email.toLowerCase().trim();

  try {
    initAdmin();

    let foundInAuth = false;
    let foundInDb = false;

    if (admin.apps.length) {
      try {
        await admin.auth().getUserByEmail(cleanEmail);
        foundInAuth = true;
      } catch (authErr: any) {
        // user not found is expected
      }

      try {
        const dbAdmin = admin.firestore();
        const docSnap = await dbAdmin.collection('users').doc(cleanEmail).get();
        if (docSnap.exists) {
          foundInDb = true;
        } else {
          const querySnap = await dbAdmin.collection('users').where('email', '==', cleanEmail).limit(1).get();
          if (!querySnap.empty) {
            foundInDb = true;
          }
        }
      } catch (dbErr: any) {
        console.warn("Firestore check notice in Vercel function:", dbErr?.message);
      }
    }

    return res.json({ exists: foundInAuth || foundInDb, foundInAuth, foundInDb });
  } catch (error: any) {
    console.error("Error in check-user-email handler:", error);
    return res.json({ exists: false });
  }
}
