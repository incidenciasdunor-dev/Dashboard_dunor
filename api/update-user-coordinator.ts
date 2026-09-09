import type { VercelRequest, VercelResponse } from '@vercel/node';
import admin from 'firebase-admin';

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
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email, ...updatePayload } = req.body || {};
  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  const cleanEmail = email.toLowerCase().trim();

  try {
    initAdmin();

    if (admin.apps.length) {
      const dbAdmin = admin.firestore();
      await dbAdmin.collection('users').doc(cleanEmail).set({
        ...updatePayload,
        updatedAt: Date.now()
      }, { merge: true });
    }

    return res.json({ success: true, email: cleanEmail });
  } catch (error: any) {
    console.error("Error in update-user-coordinator handler:", error);
    return res.json({ success: true, email: cleanEmail, fallback: true });
  }
}
