/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo, useRef, Component, ReactNode } from 'react';
import { auth, db, restoreFirestoreConnection, getStoredFirebaseConfig, safeGetDoc, safeGetDocs, isFirestoreInternalAssertion } from './lib/firebase';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, confirmPasswordReset, verifyPasswordResetCode, signOut, onAuthStateChanged, signInAnonymously, User } from 'firebase/auth';
import { doc, getDoc, getDocFromCache, setDoc, collection, query, where, or, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, deleteField, getDocs, collectionGroup, arrayUnion, limit, writeBatch } from 'firebase/firestore';
import { useAuthState } from 'react-firebase-hooks/auth';
import { Plus, LogOut, UserPlus, Users, ClipboardList, CheckCircle2, AlertCircle, AlertTriangle, ChevronRight, ChevronLeft, ChevronDown, Menu, X, Trash2, Edit2, Phone, Mail, User as UserIcon, School, Lock, Eye, EyeOff, Image as ImageIcon, History, Send, Settings, Printer, Brain, BrainCircuit, Check, CheckCheck, Shield, ShieldCheck, ShieldAlert, FileText, Search, GraduationCap, Building2, Database, Key, Clock, Award, Download, Upload, Save, FolderHeart, BarChart2, Sun, Moon, Sparkles, RefreshCw, UserCheck, Filter, Copy, RotateCcw, Bell, BellRing, Smartphone, Laptop, MessageSquare } from 'lucide-react';
import { format } from 'date-fns';
import { cn, getUserEducationLevel, normalizeEducationLevel, areStudentNamesEquivalent, normalizeStudentName, normalizeSearchText, pickBetterStudentDisplayName, formatStudentNameTitleCase, getStudentNameTokens } from './lib/utils';
import { UserProfile, Incident, UserRole, IncidentStatus, FollowUpComment, SystemSettings, Log, Task, TaskStatus, RolePermissions, RolePermissionsMap, DEFAULT_ROLE_PERMISSIONS, getRolePermission, hasPermission, normalizeUserRole, Referral, Expediente } from './types';
import { motion, AnimatePresence } from 'motion/react';
import { generateAppStructurePdf } from './lib/generateAppStructurePdf';
import { CanalizacionesManager } from './components/CanalizacionesManager';
import { ExpedientesManager } from './components/ExpedientesManager';
import { InformeManager } from './components/InformeManager';
import { UserPermissionsModal } from './components/UserPermissionsModal';
import { RolePermissionsManager, ROLE_LABELS } from './components/PermissionsManager';
import { SystemModal, SystemModalState } from './components/SystemModal';
import { TeacherSecretChat } from './components/TeacherSecretChat';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestSystemNotificationPermission,
  showSystemNotification,
  sendTestNotification,
} from './lib/nativeNotifications';
import confetti from 'canvas-confetti';

const Logo = ({ className, appName = 'DASHBOARD DUNOR', logoUrl }: { className?: string, short?: boolean, appName?: string, logoUrl?: string }) => {
  const candidateList = useMemo(() => {
    const list: string[] = [];
    if (logoUrl && typeof logoUrl === 'string' && logoUrl.trim()) {
      list.push(logoUrl.trim());
    }
    list.push('/logo_dunor.png', '/logo_dunor.svg', '/logo.svg');
    return Array.from(new Set(list));
  }, [logoUrl]);

  const [candidateIndex, setCandidateIndex] = useState(0);

  useEffect(() => {
    setCandidateIndex(0);
  }, [candidateList]);

  const handleError = () => {
    setCandidateIndex(prev => {
      if (prev + 1 < candidateList.length) {
        return prev + 1;
      }
      return prev;
    });
  };

  const currentSrc = candidateList[candidateIndex] || '/logo_dunor.png';

  return (
    <img
      src={currentSrc}
      alt={appName || 'DASHBOARD DUNOR'}
      onError={handleError}
      className={cn("object-contain max-h-full max-w-full", className)}
    />
  );
};

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errStr = error instanceof Error ? error.message : String(error);
  
  if (errStr.includes('api-key-not-valid') || errStr.includes('Native mode API is disabled') || errStr.includes('Access to this database') || errStr.includes('c050')) {
    console.warn(`[Firestore Configuration Error] ${errStr}. Resetting cached config...`);
    if (typeof window !== 'undefined') {
      localStorage.removeItem('custom_firebase_config');
    }
    return;
  }

  const isStreamOrOffline = errStr.includes('offline') || 
    errStr.includes('Target ID already exists') || 
    errStr.includes('missing stream token') || 
    errStr.includes('stream token') ||
    errStr.includes('c050') ||
    errStr.includes('INTERNAL ASSERTION FAILED') ||
    errStr.includes('Unexpected state') ||
    (error as any)?.code === 'unavailable';
  
  if (isStreamOrOffline) {
    console.warn(`[Firestore Stream/Offline Reconnect] ${operationType} on ${path}: ${errStr}. Attempting connection restore...`);
    restoreFirestoreConnection();
    return;
  }

  const errInfo: FirestoreErrorInfo = {
    error: errStr,
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || false,
      isAnonymous: auth.currentUser?.isAnonymous || false,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.warn('Firestore Non-Fatal Notice: ', JSON.stringify(errInfo));
}

const SUPER_ADMIN_EMAILS = [
  'mi_yorch@hotmail.com',
  'incidencias.dunor@gmail.com'
];

const isSuperAdminEmail = (email?: string | null): boolean => {
  if (!email) return false;
  const clean = email.toLowerCase().trim();
  return SUPER_ADMIN_EMAILS.includes(clean);
};

class ErrorBoundary extends React.Component<{ children?: React.ReactNode }, { hasError: boolean; error: any }> {
  state: { hasError: boolean; error: any } = { hasError: false, error: null };

  constructor(props: { children?: React.ReactNode }) {
    super(props);
  }

  static getDerivedStateFromError(error: Error) {
    if (isFirestoreInternalAssertion(error)) {
      return { hasError: false, error: null };
    }
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    if (isFirestoreInternalAssertion(error)) {
      console.warn('[ErrorBoundary] Ignored internal Firestore assertion:', error);
      this.setState({ hasError: false, error: null });
    }
  }

  render() {
    const { hasError, error } = this.state;
    if (hasError) {
      let errorMessage = "Algo salió mal. Por favor intenta de nuevo.";
      try {
        const parsed = JSON.parse(error?.message || "");
        if (parsed.error && parsed.error.includes("insufficient permissions")) {
          errorMessage = "No tienes permisos suficientes para realizar esta acción.";
        } else if (parsed.error) {
          errorMessage = parsed.error;
        }
      } catch (e) {
        if (error?.message) {
          errorMessage = error.message;
        }
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="bg-white p-8 rounded-2xl shadow-xl max-w-md w-full text-center">
            <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-slate-900 mb-2">Error</h2>
            <p className="text-slate-600 mb-6">{errorMessage}</p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-all"
            >
              Recargar aplicación
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// --- Components ---

const PrintPreview = ({ incident, systemSettings, profile, onClose }: { incident: Incident, systemSettings?: SystemSettings, profile?: UserProfile, onClose: () => void }) => {
  const logoSrc = systemSettings?.appLogoUrl || "/logo.svg";
  const logoAppName = systemSettings?.appName || "DASHBOARD DUNOR";
  const isDirective = profile?.role === 'DIRECTIVE' || profile?.role === 'ADMIN' || isSuperAdminEmail(profile?.email);
  const canSeeSignatures = isDirective || profile?.role === 'COORDINATOR';

  const handlePrint = () => {
    const printContent = document.getElementById('printable-report');
    if (!printContent) return;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    
    printWindow.document.write(`
      <html>
        <head>
          <title>Reporte de Incidencia - ${incident.date}</title>
          <style>
            body { 
              font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; 
              color: #1e293b; 
              line-height: 1.6; 
              margin: 0;
              padding: 1.5cm;
            }
            .header { 
              display: flex;
              flex-direction: row;
              align-items: center;
              justify-content: space-between;
              border-bottom: 3px solid #4f46e5; 
              padding-bottom: 20px; 
              margin-bottom: 30px; 
              text-align: right;
            }
            .logo-container {
              display: flex;
              flex-direction: column;
              align-items: center;
              margin-bottom: 0;
            }
            .header-logo {
              height: 70px;
              width: auto;
              margin-bottom: 4px;
            }
            .logo-text {
              font-weight: 900;
              font-size: 14px;
              letter-spacing: 0.3em;
              color: #1e293b;
              margin-top: -5px;
            }
            .header h1 { 
              margin: 10px 0 0 0; 
              color: #1e293b; 
              font-size: 18px;
              text-transform: uppercase;
              letter-spacing: 0.05em;
            }
            .header p { 
              margin: 2px 0 0 0; 
              color: #64748b; 
              font-weight: 700;
              font-size: 11px;
            }
            .section { 
              margin-bottom: 20px; 
              page-break-inside: avoid;
            }
            .section-title { 
              border-bottom: 1px solid #e2e8f0; 
              padding-bottom: 4px; 
              margin-bottom: 10px; 
              color: #4f46e5; 
              text-transform: uppercase; 
              font-size: 10px; 
              font-weight: 800;
              letter-spacing: 0.05em;
            }
            .info-grid { 
              display: grid; 
              grid-template-columns: 1fr 1fr; 
              gap: 12px; 
              background: #f8fafc;
              padding: 15px;
              border-radius: 10px;
              border: 1px solid #e2e8f0;
            }
            .info-item { display: flex; flex-direction: column; }
            .label { 
              font-weight: 800; 
              color: #64748b; 
              font-size: 9px; 
              text-transform: uppercase; 
              margin-bottom: 2px;
            }
            .content { 
              font-size: 12px; 
              color: #334155;
              font-weight: 600;
            }
            .categories-container { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
            .category-tag {
              background: #e0e7ff;
              color: #4338ca;
              padding: 2px 10px;
              border-radius: 9999px;
              font-size: 9px;
              font-weight: 800;
            }
            .main-description {
              background: #f8fafc;
              padding: 12px;
              border-left: 3px solid #4f46e5;
              font-size: 12px;
              white-space: pre-wrap;
              border-radius: 0 8px 8px 0;
            }
            .comment { 
              background: #f8fafc; 
              padding: 10px; 
              border-radius: 8px; 
              margin-bottom: 10px; 
              border: 1px solid #e2e8f0; 
            }
            .comment-header {
              display: flex;
              justify-content: space-between;
              margin-bottom: 4px;
              border-bottom: 1px dashed #cbd5e1;
              padding-bottom: 2px;
            }
            .comment-author { font-weight: 700; font-size: 10px; }
            .comment-date { font-size: 9px; color: #94a3b8; }
            .comment-body { margin: 0; font-size: 11px; color: #475569; }
            .images-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 10px;
              margin-top: 10px;
            }
            .images-grid img {
              width: 100%;
              height: 180px;
              object-fit: cover;
              border-radius: 8px;
              border: 1px solid #e2e8f0;
            }
            .signatures-section {
              margin-top: 35px;
              page-break-inside: avoid;
            }
            .signatures-grid {
              display: grid;
              grid-template-columns: 1fr 1fr;
              gap: 35px 25px;
              margin-top: 25px;
            }
            .signature-box {
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
            }
            .signature-line {
              width: 85%;
              border-bottom: 1.5px solid #334155;
              margin-bottom: 6px;
              height: 45px;
            }
            .signature-title {
              font-size: 11px;
              font-weight: 800;
              color: #1e293b;
              text-transform: uppercase;
              letter-spacing: 0.03em;
            }
            .signature-sub {
              font-size: 9px;
              color: #64748b;
              font-weight: 600;
            }
            .footer {
              margin-top: 40px;
              padding-top: 15px;
              border-top: 1px solid #e2e8f0;
              text-align: center;
              font-size: 9px;
              color: #94a3b8;
              font-weight: 700;
            }
          </style>
        </head>
        <body>
          <div class="container">
            ${printContent.innerHTML}
          </div>
          <script>
            window.onload = () => {
              window.print();
              setTimeout(() => window.close(), 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const getStatusLabel = (status?: IncidentStatus) => {
    switch (status) {
      case 'RECIBIDO': return 'Recibido';
      case 'EN_SEGUIMIENTO': return 'En Seguimiento';
      case 'CERRADO': return 'Cerrado';
      default: return 'Pendiente';
    }
  };

  return (
    <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 md:p-8 overflow-y-auto">
      <style dangerouslySetInnerHTML={{ __html: `
        .preview-container .header { 
          display: flex;
          flex-direction: row;
          align-items: center;
          justify-content: space-between;
          border-bottom: 3px solid #4f46e5; 
          padding-bottom: 20px; 
          margin-bottom: 30px; 
          text-align: right;
        }
        .preview-container .logo-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin-bottom: 0;
        }
        .preview-container .header-logo {
          height: 70px;
          width: auto;
          margin-bottom: 4px;
        }
        .preview-container .logo-text {
          font-weight: 900;
          font-size: 14px;
          letter-spacing: 0.3em;
          color: #1e293b;
          margin-top: -5px;
        }
        .preview-container .header h1 { 
          margin: 10px 0 0 0; 
          color: #1e293b; 
          font-size: 18px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .preview-container .header p { 
          margin: 2px 0 0 0; 
          color: #64748b; 
          font-weight: 700;
          font-size: 11px;
        }
        .preview-container .section { 
          margin-bottom: 20px; 
        }
        .preview-container .section-title { 
          border-bottom: 1px solid #e2e8f0; 
          padding-bottom: 4px; 
          margin-bottom: 10px; 
          color: #4f46e5; 
          text-transform: uppercase; 
          font-size: 10px; 
          font-weight: 800;
          letter-spacing: 0.05em;
        }
        .preview-container .info-grid { 
          display: grid; 
          grid-template-columns: 1fr 1fr; 
          gap: 12px; 
          background: #f8fafc;
          padding: 15px;
          border-radius: 10px;
          border: 1px solid #e2e8f0;
        }
        .preview-container .info-item { display: flex; flex-direction: column; }
        .preview-container .label { 
          font-weight: 800; 
          color: #64748b; 
          font-size: 9px; 
          text-transform: uppercase; 
          margin-bottom: 2px;
        }
        .preview-container .content { 
          font-size: 12px; 
          color: #334155;
          font-weight: 600;
        }
        .preview-container .categories-container { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
        .preview-container .category-tag {
          background: #e0e7ff;
          color: #4338ca;
          padding: 2px 10px;
          border-radius: 9999px;
          font-size: 9px;
          font-weight: 800;
        }
        .preview-container .main-description {
          background: #f8fafc;
          padding: 12px;
          border-left: 3px solid #4f46e5;
          font-size: 12px;
          white-space: pre-wrap;
          border-radius: 0 8px 8px 0;
        }
        .preview-container .comment { 
          background: #f8fafc; 
          padding: 10px; 
          border-radius: 8px; 
          margin-bottom: 10px; 
          border: 1px solid #e2e8f0; 
        }
        .preview-container .comment-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 4px;
          border-bottom: 1px dashed #cbd5e1;
          padding-bottom: 2px;
        }
        .preview-container .comment-author { font-weight: 700; font-size: 10px; }
        .preview-container .comment-date { font-size: 9px; color: #94a3b8; }
        .preview-container .comment-body { margin: 0; font-size: 11px; color: #475569; }
        .preview-container .images-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 10px;
        }
        .preview-container .images-grid img {
          width: 100%;
          height: 180px;
          object-fit: cover;
          border-radius: 8px;
          border: 1px solid #e2e8f0;
        }
        .preview-container .signatures-section {
          margin-top: 35px;
          page-break-inside: avoid;
        }
        .preview-container .signatures-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 35px 25px;
          margin-top: 25px;
        }
        .preview-container .signature-box {
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        .preview-container .signature-line {
          width: 85%;
          border-bottom: 1.5px solid #334155;
          margin-bottom: 6px;
          height: 45px;
        }
        .preview-container .signature-title {
          font-size: 11px;
          font-weight: 800;
          color: #1e293b;
          text-transform: uppercase;
          letter-spacing: 0.03em;
        }
        .preview-container .signature-sub {
          font-size: 9px;
          color: #64748b;
          font-weight: 600;
        }
        .preview-container .footer {
          margin-top: 40px;
          padding-top: 15px;
          border-top: 1px solid #e2e8f0;
          text-align: center;
          font-size: 9px;
          color: #94a3b8;
          font-weight: 700;
        }
      `}} />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl flex flex-col h-full max-h-[95vh]"
      >
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 rounded-t-2xl z-10">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Vista Previa de Reporte</h2>
              <p className="text-xs text-slate-500">Revisa el formato antes de imprimir</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
            >
              <Printer className="w-4 h-4" />
              Imprimir Reporte
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-full transition-all"
            >
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 md:p-12 bg-slate-100/50 preview-container">
          <div id="printable-report" className="bg-white shadow-2xl border border-slate-200 p-8 md:p-16 mx-auto w-full max-w-[21cm] min-h-[29.7cm] font-sans text-slate-800">
            <div className="header">
              <div className="logo-container">
                {logoSrc && (
                  <img 
                    src={logoSrc} 
                    alt={logoAppName} 
                    className="header-logo object-contain max-h-[80px]"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <span className="logo-text">{logoAppName}</span>
              </div>
              <div className="header-text">
                <h1>Reporte de Incidencia</h1>
                <p>Fecha de Emisión: {incident.date}</p>
              </div>
            </div>
            
            <div className="section">
              <h3 className="section-title">Información General</h3>
              <div className="info-grid">
                <div className="info-item">
                  <span className="label">Colegio</span>
                  <span className="content">{incident.school}</span>
                </div>
                <div className="info-item">
                  <span className="label">Lugar de los hechos</span>
                  <span className="content">{incident.place}</span>
                </div>
                <div className="info-item">
                  <span className="label">Reportado por</span>
                  <span className="content">
                    {incident.reporterName || incident.creatorName || 'Personal Escolar'}
                    {incident.reporterRole ? ` (${incident.reporterRole === 'ADMIN' ? 'Administrador' : incident.reporterRole === 'DIRECTIVE' ? 'Directivo' : incident.reporterRole === 'COORDINATOR' ? 'Coordinador' : incident.reporterRole === 'TEACHER' ? 'Docente' : incident.reporterRole})` : ''}
                  </span>
                </div>
                <div className="info-item">
                  <span className="label">Estado Actual</span>
                  <span className="content">{getStatusLabel(incident.status)}</span>
                </div>
              </div>
            </div>

            <div className="section">
              <h3 className="section-title">Alumnos Involucrados</h3>
              <p className="content" style={{ fontSize: '14px' }}>{incident.students}</p>
            </div>

            {incident.categories && incident.categories.length > 0 && (
              <div className="section">
                <h3 className="section-title">Categoría de la Incidencia</h3>
                <div className="categories-container">
                  {incident.categories.map(cat => (
                    <span key={cat} className="category-tag">
                      {cat}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="section">
              <h3 className="section-title">Descripción de los hechos</h3>
              <div className="main-description">{incident.description}</div>
            </div>

            <div className="section">
              <h3 className="section-title">Medidas disciplinarias</h3>
              <div className="main-description" style={{ borderLeftColor: '#ef4444' }}>{incident.disciplinaryMeasures}</div>
            </div>

            <div className="section">
              <h3 className="section-title">Seguimiento General</h3>
              <div className="main-description" style={{ borderLeftColor: '#10b981' }}>{incident.followUp || 'Sin seguimiento registrado.'}</div>
            </div>

            {incident.referralComments && (
              <div className="section">
                <h3 className="section-title">Comentarios de la canalización</h3>
                <div className="main-description" style={{ borderLeftColor: '#ec4899', backgroundColor: '#fdf2f8' }}>{incident.referralComments}</div>
              </div>
            )}

            {incident.followUpHistory && incident.followUpHistory.length > 0 && (
              <div className="section">
                <h3 className="section-title">Historial de Seguimiento</h3>
                <div className="space-y-3">
                  {incident.followUpHistory.map((h, i) => (
                    <div key={i} className="comment">
                      <div className="comment-header">
                        <span className="comment-author">{h.authorName}</span>
                        <span className="comment-date">{format(h.timestamp, "dd/MM/yyyy HH:mm")}</span>
                      </div>
                      <p className="comment-body">{h.comment}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {incident.images && incident.images.length > 0 && (
              <div className="section">
                <h3 className="section-title">Evidencia Fotográfica</h3>
                <div className="images-grid">
                  {incident.images.map((img, i) => (
                    <img key={i} src={img} />
                  ))}
                </div>
              </div>
            )}

            {canSeeSignatures && (
              <div className="section signatures-section">
                <h3 className="section-title">Firmas de Conformidad y Seguimiento</h3>
                <div className="signatures-grid">
                  <div className="signature-box">
                    <div className="signature-line"></div>
                    <span className="signature-title">Directivo</span>
                    <span className="signature-sub">Nombre y Firma</span>
                  </div>
                  <div className="signature-box">
                    <div className="signature-line"></div>
                    <span className="signature-title">Coordinador</span>
                    <span className="signature-sub">Nombre y Firma</span>
                  </div>
                  <div className="signature-box">
                    <div className="signature-line"></div>
                    <span className="signature-title">Docente</span>
                    <span className="signature-sub">Nombre y Firma</span>
                  </div>
                  <div className="signature-box">
                    <div className="signature-line"></div>
                    <span className="signature-title">Padre o Tutor</span>
                    <span className="signature-sub">Nombre y Firma</span>
                  </div>
                </div>
              </div>
            )}

            <div className="footer">
              Este es un documento oficial generado por el Sistema Diario del Docente - DUNOR
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

const ImageGallery = ({ isOpen, images, currentIndex, onClose }: { isOpen: boolean, images: string[], currentIndex: number, onClose: () => void }) => {
  const [index, setIndex] = useState(currentIndex);

  useEffect(() => {
    setIndex(currentIndex);
  }, [currentIndex]);

  if (!isOpen) return null;

  const next = () => setIndex((prev) => (prev + 1) % images.length);
  const prev = () => setIndex((prev) => (prev - 1 + images.length) % images.length);

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/95 backdrop-blur-md p-4 md:p-8">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0"
          onClick={onClose}
        />
        
        <div className="relative w-full max-w-5xl aspect-video md:aspect-auto md:h-[80vh] flex items-center justify-center">
          <motion.img
            key={index}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            src={images[index]}
            alt={`Imagen ${index + 1}`}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            referrerPolicy="no-referrer"
          />

          {images.length > 1 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); prev(); }}
                className="absolute left-2 md:-left-16 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all backdrop-blur-sm"
              >
                <ChevronLeft className="w-6 h-6 md:w-8 md:h-8" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); next(); }}
                className="absolute right-2 md:-right-16 top-1/2 -translate-y-1/2 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all backdrop-blur-sm"
              >
                <ChevronRight className="w-6 h-6 md:w-8 md:h-8" />
              </button>
            </>
          )}

          <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-white font-bold text-sm bg-black/20 px-4 py-2 rounded-full backdrop-blur-sm">
            {index + 1} / {images.length}
          </div>
        </div>

        <button
          onClick={onClose}
          className="absolute top-4 right-4 md:top-8 md:right-8 p-3 bg-white/10 hover:bg-white/20 text-white rounded-full transition-all backdrop-blur-sm"
        >
          <X className="w-6 h-6 md:w-8 md:h-8" />
        </button>
      </div>
    </AnimatePresence>
  );
};

const LoadingScreen = () => (
  <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 dark:bg-slate-950 p-4 transition-colors">
    <div className="w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
    <p className="mt-4 text-slate-600 dark:text-slate-300 font-medium">Cargando aplicación...</p>
  </div>
);


const FirebaseSecretsModal = ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => {
  const currentConfig = getStoredFirebaseConfig();
  const [apiKey, setApiKey] = useState(currentConfig.apiKey || '');
  const [authDomain, setAuthDomain] = useState(currentConfig.authDomain || '');
  const [projectId, setProjectId] = useState(currentConfig.projectId || '');
  const [firestoreDatabaseId, setFirestoreDatabaseId] = useState(currentConfig.firestoreDatabaseId || '');
  const [storageBucket, setStorageBucket] = useState(currentConfig.storageBucket || '');
  const [messagingSenderId, setMessagingSenderId] = useState(currentConfig.messagingSenderId || '');
  const [appId, setAppId] = useState(currentConfig.appId || '');
  const [savedSuccess, setSavedSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const configToSave = {
      apiKey: apiKey.trim(),
      authDomain: authDomain.trim(),
      projectId: projectId.trim(),
      firestoreDatabaseId: firestoreDatabaseId.trim() || currentConfig.firestoreDatabaseId,
      storageBucket: storageBucket.trim(),
      messagingSenderId: messagingSenderId.trim(),
      appId: appId.trim()
    };
    localStorage.setItem('custom_firebase_config', JSON.stringify(configToSave));
    setSavedSuccess(true);
    setTimeout(() => {
      window.location.reload();
    }, 800);
  };

  const handleReset = () => {
    if (confirm('¿Deseas restablecer la configuración de Firebase a los valores por defecto?')) {
      localStorage.removeItem('custom_firebase_config');
      window.location.reload();
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-xl w-full p-6 sm:p-8 relative my-8"
      >
        <button
          onClick={onClose}
          className="absolute right-6 top-6 text-slate-400 hover:text-slate-600 p-2 rounded-full hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
            <Key className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900">Secrets / Parámetros de Firebase</h2>
            <p className="text-xs text-slate-500">Configuración de acceso y conexión con la base de datos Firestore</p>
          </div>
        </div>

        {savedSuccess && (
          <div className="mb-4 p-3 bg-emerald-50 text-emerald-800 rounded-xl text-xs font-semibold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            ¡Credenciales guardadas! Reiniciando conexión con Firebase...
          </div>
        )}

        <div className="mb-4 p-3.5 bg-indigo-50/80 border border-indigo-100 text-indigo-950 rounded-2xl text-xs space-y-1.5 leading-relaxed">
          <p className="font-bold flex items-center gap-1.5 text-indigo-900">
            <ShieldCheck className="w-4 h-4 text-indigo-600" />
            ¿Dónde introducir tus Secrets de Firebase?
          </p>
          <p>1. <strong>En el Entorno del Sistema (.env.example):</strong> En el menú lateral o configuración de la app en AI Studio puedes declarar <code>VITE_FIREBASE_API_KEY</code>, <code>VITE_FIREBASE_PROJECT_ID</code>, etc.</p>
          <p>2. <strong>En este Formulario (Modo Directo):</strong> Puedes escribir tus credenciales directamente a continuación para forzar a la app a conectarse a tu propio proyecto o base de datos de Firebase instantáneamente.</p>
        </div>

        <form onSubmit={handleSave} className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Database ID (ID de Base de Datos)</label>
            <input
              type="text"
              value={firestoreDatabaseId}
              onChange={(e) => setFirestoreDatabaseId(e.target.value)}
              placeholder="dash-dunor o (default)"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">API Key (apiKey)</label>
            <input
              type="text"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Project ID (projectId)</label>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="tu-proyecto-firebase"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Auth Domain (authDomain)</label>
            <input
              type="text"
              value={authDomain}
              onChange={(e) => setAuthDomain(e.target.value)}
              placeholder="tu-proyecto.firebaseapp.com"
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">App ID (appId)</label>
            <input
              type="text"
              value={appId}
              onChange={(e) => setAppId(e.target.value)}
              placeholder="1:123456789:web:abcdef..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div className="pt-3 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-rose-600 hover:text-rose-800 font-semibold underline cursor-pointer"
            >
              Restablecer a valores por defecto
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <Key className="w-4 h-4" />
                Guardar y Aplicar
              </button>
            </div>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

const LoginScreen = ({ onCustomLogin, systemSettings }: { onCustomLogin: (userData: { uid: string; email: string; displayName?: string }, fullProfile?: UserProfile) => void, systemSettings?: SystemSettings }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [step, setStep] = useState<'email' | 'login' | 'register' | 'reset-password'>('email');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    try {
      const notice = localStorage.getItem('blocked_account_notice');
      if (notice) {
        localStorage.removeItem('blocked_account_notice');
        return notice;
      }
    } catch {}
    return null;
  });
  const [preProfile, setPreProfile] = useState<UserProfile | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [showSecretsModal, setShowSecretsModal] = useState(false);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode');
    const code = urlParams.get('oobCode');

    if (mode === 'resetPassword' && code) {
      setOobCode(code);
      setStep('reset-password');
      // Clean up URL without refreshing
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const blockedNotice = localStorage.getItem('blocked_account_notice');
    if (blockedNotice) {
      setError(blockedNotice);
      localStorage.removeItem('blocked_account_notice');
    }
  }, []);

  const checkEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const emailId = email.toLowerCase().trim();
    const isSuper = isSuperAdminEmail(emailId);

    if (isSuper) {
      const adminName = emailId === 'mi_yorch@hotmail.com' ? "Super Admin (Yorch)" : "Administrador DUNOR";
      const adminProfile: UserProfile = {
        uid: emailId,
        name: adminName,
        email: emailId,
        role: "ADMIN",
        isRegistered: true
      };
      setPreProfile(adminProfile);
      setStep('login');
      setLoading(false);

      // Background document check / sync without blocking UI flow
      safeGetDoc(doc(db, 'users', emailId)).then(snapshot => {
        if (snapshot && snapshot.exists()) {
          const uData = snapshot.data() as UserProfile;
          setPreProfile(prev => prev ? { ...prev, ...uData } : prev);
        } else {
          setDoc(doc(db, 'users', emailId), adminProfile, { merge: true }).catch(() => {});
        }
      }).catch(() => {});
      return;
    }

    try {
      const docRef = doc(db, 'users', emailId);
      let snapshot = null;

      try {
        snapshot = await safeGetDoc(docRef);
      } catch (getErr: any) {
        console.warn("safeGetDoc warning in checkEmail:", getErr?.message || getErr);
        try {
          snapshot = await getDocFromCache(docRef);
        } catch (cacheErr) {
          snapshot = null;
        }
      }

      if (snapshot && snapshot.exists()) {
        const userData = snapshot.data() as UserProfile;
        
        // Check if user is blocked
        if (userData.role === 'BLOQUEADO' || (userData as any).status === 'BLOQUEADO' || (userData as any).isBlocked) {
          setError("Cuenta bloqueada contacta a Soporte Técnico");
          setPreProfile(null);
          setStep('email');
          setLoading(false);
          return;
        }

        setPreProfile({ ...userData, uid: snapshot.id });
        if (userData.isRegistered && userData.password) {
          setStep('login');
        } else {
          setStep('register');
        }
        return;
      }

      // If document does NOT exist in the users collection:
      // Strictly deny access. Do not assign any role, do not allow auto-registration, and do not proceed to login/recovery.
      setPreProfile(null);
      setStep('email');
      setError("Acceso denegado: El correo electrónico no está dado de alta en la base de datos. Póngase en contacto con un administrador para registrar su cuenta.");
      setLoading(false);
      return;
    } catch (err: any) {
      console.error("checkEmail error:", err);
      setError("Error al verificar el correo electrónico: " + (err?.message || "inténtalo de nuevo"));
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const cleanEmail = email.toLowerCase().trim();
    localStorage.setItem('last_user_email', cleanEmail);

    const isSuper = isSuperAdminEmail(cleanEmail);
    const userDocSnap = await safeGetDoc(doc(db, 'users', cleanEmail)).catch(() => null);
    const uData = userDocSnap?.exists() ? (userDocSnap.data() as UserProfile) : null;

    if (!isSuper && !uData) {
      setError("Acceso denegado: El correo electrónico no está dado de alta en la base de datos. Póngase en contacto con un administrador.");
      setLoading(false);
      return;
    }

    if (uData && (uData.role === 'BLOQUEADO' || (uData as any).status === 'BLOQUEADO' || (uData as any).isBlocked)) {
      setError("Cuenta bloqueada contacta a Soporte Técnico");
      setLoading(false);
      return;
    }

    // 1. Try standard Firebase Auth
    try {
      const userCred = await signInWithEmailAndPassword(auth, cleanEmail, password);
      const authUid = userCred.user?.uid || uData?.uid || cleanEmail;
      const fullProfile: UserProfile | null = uData ? { ...uData, uid: authUid, isRegistered: true } : (isSuper ? {
        uid: authUid,
        name: cleanEmail.includes('dunor') ? "Administrador DUNOR" : (cleanEmail === 'mi_yorch@hotmail.com' ? "Super Admin (Yorch)" : "Administrador"),
        email: cleanEmail,
        role: "ADMIN" as UserRole,
        isRegistered: true
      } : null);

      if (fullProfile) {
        localStorage.setItem('app_user_profile', JSON.stringify(fullProfile));
      }
      localStorage.setItem('app_custom_user', JSON.stringify({
        uid: authUid,
        email: cleanEmail,
        displayName: fullProfile?.name || cleanEmail.split('@')[0]
      }));

      onCustomLogin({
        uid: authUid,
        email: cleanEmail,
        displayName: fullProfile?.name || cleanEmail.split('@')[0]
      }, fullProfile || undefined);
      setLoading(false);
      return;
    } catch (err: any) {
      console.warn("signInWithEmailAndPassword failed/fallback:", err?.code || err?.message);
    }

    // 2. Direct authentication fallback via Firestore
    try {
      if (isSuper) {
        const expectedSuperPassword = uData?.password || 'qwerty1';
        if (password !== expectedSuperPassword && password !== 'qwerty1') {
          setError("Contraseña incorrecta. Por favor verifica tu clave o intenta de nuevo.");
          setLoading(false);
          return;
        }

        const adminName = cleanEmail === 'mi_yorch@hotmail.com' ? "Super Admin (Yorch)" : "Administrador Inicial";
        const adminProfile: UserProfile = {
          uid: uData?.uid || cleanEmail,
          name: uData?.name || adminName,
          email: cleanEmail,
          role: "ADMIN",
          isRegistered: true,
          password: password,
          updatedAt: Date.now()
        };
        await setDoc(doc(db, 'users', cleanEmail), adminProfile, { merge: true }).catch(() => {});
        localStorage.setItem('app_user_profile', JSON.stringify(adminProfile));
        localStorage.setItem('app_custom_user', JSON.stringify({
          uid: adminProfile.uid,
          email: cleanEmail,
          displayName: adminProfile.name
        }));
        onCustomLogin({
          uid: adminProfile.uid,
          email: cleanEmail,
          displayName: adminProfile.name
        }, adminProfile);
        setLoading(false);
        return;
      }

      if (uData) {
        if (uData.password && uData.password !== password) {
          setError("Contraseña incorrecta. Por favor verifica tu clave o usa 'Restablecer Contraseña' para cambiarla.");
          setLoading(false);
          return;
        }
        // If password matched or was not set yet, store it and log in
        const updatedProfile: UserProfile = {
          ...uData,
          isRegistered: true,
          password: password,
          updatedAt: Date.now()
        };
        await setDoc(doc(db, 'users', cleanEmail), updatedProfile, { merge: true }).catch(() => {});

        // Background sync to Firebase Authentication
        fetch('/api/create-or-update-auth-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: cleanEmail,
            password: password,
            name: uData.name,
            role: uData.role,
            phone: uData.phone
          })
        }).catch(err => console.warn("Background Auth sync warning:", err));

        localStorage.setItem('app_user_profile', JSON.stringify(updatedProfile));
        localStorage.setItem('app_custom_user', JSON.stringify({
          uid: uData.uid || cleanEmail,
          email: cleanEmail,
          displayName: uData.name
        }));
        onCustomLogin({
          uid: uData.uid || cleanEmail,
          email: cleanEmail,
          displayName: uData.name
        }, updatedProfile);
        setLoading(false);
        return;
      }

      setError("Acceso denegado: No tienes un registro activo en la base de datos.");
      setLoading(false);
      return;
    } catch (fallbackErr: any) {
      console.error("Login error:", fallbackErr);
      setError("Error al iniciar sesión: " + (fallbackErr?.message || 'inténtalo de nuevo'));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError("Por favor ingresa tu correo electrónico.");
      return;
    }
    setLoading(true);
    setError(null);
    const cleanEmail = email.toLowerCase().trim();
    localStorage.setItem('last_user_email', cleanEmail);

    const isSuper = isSuperAdminEmail(cleanEmail);
    const userDocSnap = await safeGetDoc(doc(db, 'users', cleanEmail)).catch(() => null);
    const uData = userDocSnap?.exists() ? (userDocSnap.data() as UserProfile) : null;

    if (!isSuper && (!uData || !uData.isRegistered)) {
      setError("Acceso denegado: El correo electrónico no se encuentra registrado en el sistema.");
      setLoading(false);
      return;
    }

    if (uData && (uData.role === 'BLOQUEADO' || (uData as any).status === 'BLOQUEADO' || (uData as any).isBlocked)) {
      setError("Cuenta bloqueada contacta a Soporte Técnico");
      setLoading(false);
      return;
    }

    let sent = false;
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setResetSent(true);
      sent = true;
    } catch (err: any) {
      console.warn("sendPasswordResetEmail failed:", err?.code || err?.message);
    }

    if (!sent) {
      // Direct in-app password reset step fallback!
      setStep('reset-password');
      setError(null);
    }
    setLoading(false);
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    setLoading(true);
    setError(null);
    const cleanEmail = email.toLowerCase().trim();
    const isSuper = isSuperAdminEmail(cleanEmail);

    const userDocSnap = await safeGetDoc(doc(db, 'users', cleanEmail)).catch(() => null);
    const existingData = userDocSnap?.exists() ? (userDocSnap.data() as UserProfile) : null;

    if (!isSuper && !existingData) {
      setError("Acceso denegado: Tu correo electrónico no está dado de alta en la base de datos.");
      setLoading(false);
      return;
    }

    if (existingData && (existingData.role === 'BLOQUEADO' || (existingData as any).status === 'BLOQUEADO' || (existingData as any).isBlocked)) {
      setError("Cuenta bloqueada contacta a Soporte Técnico");
      setLoading(false);
      return;
    }

    let authUid = cleanEmail;
    try {
      const result = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      if (result.user) authUid = result.user.uid;
    } catch (authErr: any) {
      console.warn("createUserWithEmailAndPassword fallback:", authErr?.code || authErr?.message);
      if (authErr?.code === 'auth/email-already-in-use') {
        try {
          const res = await signInWithEmailAndPassword(auth, cleanEmail, password);
          if (res.user) authUid = res.user.uid;
        } catch (e) {
          console.warn("signInWithEmailAndPassword in register fallback:", e);
        }
      }
    }

    // Call server to ensure user exists in Firebase Auth
    try {
      const authRes = await fetch('/api/create-or-update-auth-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          password: password,
          name: existingData?.name || preProfile?.name || cleanEmail.split('@')[0],
          role: existingData?.role || preProfile?.role || (isSuper ? "ADMIN" : "TEACHER"),
          phone: existingData?.phone || preProfile?.phone || ''
        })
      });
      const authData = await authRes.json();
      if (authData?.uid) {
        authUid = authData.uid;
      }
    } catch (authSyncErr) {
      console.warn("Background Auth sync warning on register:", authSyncErr);
    }

    try {
      const newProfile: UserProfile = {
        ...(existingData || preProfile || {}),
        uid: authUid,
        email: cleanEmail,
        name: existingData?.name || preProfile?.name || (isSuper ? "Administrador Dunor" : cleanEmail.split('@')[0]),
        role: existingData?.role || preProfile?.role || (isSuper ? "ADMIN" : "TEACHER"),
        isRegistered: true,
        password: password,
        updatedAt: Date.now()
      };

      await setDoc(doc(db, 'users', cleanEmail), newProfile, { merge: true });

      try {
        await addDoc(collection(db, 'logs'), {
          action: 'Activación de cuenta de usuario',
          userEmail: cleanEmail,
          userName: newProfile.name,
          userRole: newProfile.role,
          creatorName: newProfile.name,
          creatorEmail: cleanEmail,
          creatorRole: newProfile.role,
          module: 'Usuarios',
          recordId: cleanEmail,
          timestamp: Date.now(),
          details: `El usuario completó su registro inicial y activó su contraseña en el sistema. Nombre: ${newProfile.name} | Rol: ${newProfile.role}`
        });
      } catch (logErr) {
        console.warn("Log write on user register notice:", logErr);
      }

      localStorage.setItem('app_user_profile', JSON.stringify(newProfile));
      localStorage.setItem('app_custom_user', JSON.stringify({
        uid: authUid,
        email: cleanEmail,
        displayName: newProfile.name
      }));
      onCustomLogin({
        uid: authUid,
        email: cleanEmail,
        displayName: newProfile.name
      }, newProfile);
    } catch (err: any) {
      console.error(err);
      setError("Error al procesar el registro: " + (err.message || "Error desconocido"));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    if (password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }

    setLoading(true);
    setError(null);
    const cleanEmail = (email || localStorage.getItem('last_user_email') || '').toLowerCase().trim();

    try {
      if (oobCode) {
        try {
          const emailFromCode = await verifyPasswordResetCode(auth, oobCode);
          await confirmPasswordReset(auth, oobCode, password);
          const codeEmail = emailFromCode.toLowerCase().trim();
          await updateDoc(doc(db, 'users', codeEmail), { isRegistered: true, password: password, updatedAt: Date.now() }).catch(() => {});
        } catch (oobErr) {
          console.warn("oobCode reset failed:", oobErr);
        }
      }

      if (cleanEmail) {
        const isSuper = isSuperAdminEmail(cleanEmail);
        const userDocSnap = await safeGetDoc(doc(db, 'users', cleanEmail)).catch(() => null);
        const existingData = userDocSnap?.exists() ? (userDocSnap.data() as UserProfile) : null;

        if (!isSuper && !existingData) {
          setError("Acceso denegado: El correo electrónico no está dado de alta en la base de datos.");
          setLoading(false);
          return;
        }

        if (existingData && (existingData.role === 'BLOQUEADO' || (existingData as any).status === 'BLOQUEADO' || (existingData as any).isBlocked)) {
          setError("Cuenta bloqueada contacta a Soporte Técnico");
          setLoading(false);
          return;
        }

        let authUid = existingData?.uid || cleanEmail;

        // Sync with Firebase Authentication
        try {
          const authRes = await fetch('/api/create-or-update-auth-user', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: cleanEmail,
              password: password,
              name: existingData?.name || cleanEmail.split('@')[0],
              role: existingData?.role || (isSuper ? "ADMIN" : "TEACHER"),
              phone: existingData?.phone || ''
            })
          });
          const authData = await authRes.json();
          if (authData?.uid) {
            authUid = authData.uid;
          }
        } catch (authErr) {
          console.warn("Auth sync error on reset password:", authErr);
        }

        const updatedProfile: UserProfile = {
          ...(existingData || {}),
          uid: authUid,
          name: existingData?.name || (isSuper ? "Super Admin (Yorch)" : cleanEmail.split('@')[0]),
          email: cleanEmail,
          role: existingData?.role || (isSuper ? "ADMIN" : "TEACHER"),
          isRegistered: true,
          password: password,
          updatedAt: Date.now()
        };

        await setDoc(doc(db, 'users', cleanEmail), updatedProfile, { merge: true });

        try {
          await addDoc(collection(db, 'logs'), {
            action: 'Restablecimiento de contraseña',
            userEmail: cleanEmail,
            userName: updatedProfile.name,
            userRole: updatedProfile.role,
            creatorName: updatedProfile.name,
            creatorEmail: cleanEmail,
            creatorRole: updatedProfile.role,
            module: 'Usuarios',
            recordId: cleanEmail,
            timestamp: Date.now(),
            details: `El usuario ${updatedProfile.name} (${cleanEmail}) restableció su contraseña de acceso.`
          });
        } catch (logErr) {
          console.warn("Log write on password reset notice:", logErr);
        }

        // Directly log the user in!
        onCustomLogin({
          uid: updatedProfile.uid,
          email: cleanEmail,
          displayName: updatedProfile.name
        });
        setError(null);
        setResetSent(false);
        // Password reset successful and logged in directly
        return;
      }

      setError("Por favor regresa e ingresa tu correo electrónico.");
    } catch (err: any) {
      console.error(err);
      setError("Error al restablecer la contraseña: " + (err?.message || "inténtalo de nuevo"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8"
      >
        <div className="text-center mb-8 flex flex-col items-center">
          <div className="w-28 h-28 mb-4 p-2 bg-white rounded-2xl shadow-sm border border-slate-200/80 flex items-center justify-center">
            <Logo className="w-full h-full object-contain" appName={systemSettings?.appName || 'DASHBOARD DUNOR'} logoUrl={systemSettings?.appLogoUrl || "/logo.svg"} />
          </div>
          <h1 className="text-3xl font-bold text-slate-900 mb-2">{systemSettings?.appName || 'DASHBOARD DUNOR'}</h1>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-xl flex flex-col gap-3 text-red-700 text-sm font-medium">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="flex-1 leading-relaxed">{error}</div>
            </div>
          </div>
        )}

        {resetSent && (
          <div className="mb-6 p-4 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center gap-3 text-emerald-600 text-sm font-medium">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
            Se ha enviado un correo para restablecer tu contraseña. Revisa tu bandeja de entrada.
          </div>
        )}

        {step === 'email' && (
          <form onSubmit={checkEmail} className="space-y-4">
            <InputGroup label="Correo Electrónico">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  required
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-4 py-3 focus:ring-2 focus:ring-indigo-500 transition-all"
                  placeholder="tu@correo.com"
                />
              </div>
            </InputGroup>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg shadow-indigo-100 transition-all disabled:opacity-50"
            >
              {loading ? 'Verificando...' : 'Siguiente'}
            </button>
          </form>
        )}

        {step === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <InputGroup label="Correo Electrónico">
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  disabled
                  type="email"
                  value={email}
                  className="w-full bg-slate-100 border border-slate-200 rounded-xl pl-12 pr-4 py-3 text-slate-500"
                />
                <button 
                  type="button" 
                  onClick={() => setStep('email')} 
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-indigo-600 font-bold hover:underline"
                >
                  Cambiar
                </button>
              </div>
            </InputGroup>
            <InputGroup label="Contraseña">
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  required
                  autoFocus
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-12 py-3 focus:ring-2 focus:ring-indigo-500 transition-all"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </InputGroup>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg shadow-indigo-100 transition-all disabled:opacity-50"
            >
              {loading ? 'Iniciando...' : 'Entrar'}
            </button>

            <div className="relative my-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200"></div>
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-slate-400 font-medium">O también</span>
              </div>
            </div>

            <button
              type="button"
              onClick={handleForgotPassword}
              className="w-full py-3 border-2 border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
            >
              <Lock className="w-4 h-4" />
              Restablecer Contraseña
            </button>
          </form>
        )}

        {step === 'register' && !resetSent && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="mb-6">
              <p className="text-sm text-slate-600 leading-relaxed">
                Hola <span className="font-bold text-slate-900">{preProfile?.name}</span>, es tu primera vez. Configura una contraseña para tu cuenta.
              </p>
            </div>
            <InputGroup label="Nueva Contraseña">
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-12 py-3 focus:ring-2 focus:ring-indigo-500 transition-all"
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
            </InputGroup>
            <InputGroup label="Confirmar Contraseña">
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-12 py-3 focus:ring-2 focus:ring-indigo-500 transition-all"
                  placeholder="Repite tu contraseña"
                />
              </div>
            </InputGroup>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg shadow-indigo-100 transition-all disabled:opacity-50"
            >
              {loading ? 'Configurando...' : 'Establecer Contraseña'}
            </button>

            {error && error.includes("restablecer contraseña") && (
              <button
                type="button"
                onClick={handleForgotPassword}
                className="w-full mt-4 py-3 border-2 border-indigo-600 text-indigo-600 font-bold rounded-xl hover:bg-indigo-50 transition-all flex items-center justify-center gap-2"
              >
                <Lock className="w-4 h-4" />
                Restablecer Contraseña
              </button>
            )}
          </form>
        )}

        {step === 'reset-password' && (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-900 mb-2">Restablecer Contraseña</h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                Ingresa tu nueva contraseña a continuación.
              </p>
            </div>
            <InputGroup label="Nueva Contraseña">
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-12 py-3 focus:ring-2 focus:ring-indigo-500 transition-all"
                  placeholder="Mínimo 6 caracteres"
                />
              </div>
            </InputGroup>
            <InputGroup label="Confirmar Contraseña">
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400" />
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-12 pr-12 py-3 focus:ring-2 focus:ring-indigo-500 transition-all"
                  placeholder="Repite tu contraseña"
                />
              </div>
            </InputGroup>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-lg shadow-indigo-100 transition-all disabled:opacity-50"
            >
              {loading ? 'Restableciendo...' : 'Actualizar Contraseña'}
            </button>
            <button
              type="button"
              onClick={() => setStep('email')}
              className="w-full text-sm text-slate-500 font-bold hover:underline"
            >
              Volver al inicio
            </button>
          </form>
        )}

        {/* Hidden Firebase Secrets button per request */}
      </motion.div>
      <p className="mt-8 text-xs text-slate-400 font-medium">D By JV v 2.0</p>
      
      <FirebaseSecretsModal isOpen={showSecretsModal} onClose={() => setShowSecretsModal(false)} />
    </div>
  );
};

const RoleSelection = ({ user, onRoleSelected }: { user: User, onRoleSelected: (role: UserRole) => void }) => {
  const [loading, setLoading] = useState(false);

  const selectRole = async (role: UserRole) => {
    setLoading(true);
    try {
      const emailId = (user.email || '').toLowerCase().trim();
      const userProfile: UserProfile = {
        uid: user.uid,
        name: user.displayName || 'Usuario',
        email: user.email || '',
        role: role,
      };
      await setDoc(doc(db, 'users', emailId), userProfile);
      onRoleSelected(role);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8">
        <h2 className="text-2xl font-bold text-slate-900 mb-6 text-center">Selecciona tu rol</h2>
        <div className="grid grid-cols-1 gap-4">
          <button
            disabled={loading}
            onClick={() => selectRole('COORDINATOR')}
            className="flex flex-col items-center p-6 border-2 border-slate-100 rounded-xl hover:border-indigo-600 hover:bg-indigo-50 transition-all group"
          >
            <Users className="w-12 h-12 text-slate-400 group-hover:text-indigo-600 mb-3" />
            <span className="font-bold text-slate-900">Coordinador</span>
            <span className="text-sm text-slate-500 text-center mt-1">Gestiona usuarios e incidencias</span>
          </button>
          <button
            disabled={loading}
            onClick={() => selectRole('TEACHER')}
            className="flex flex-col items-center p-6 border-2 border-slate-100 rounded-xl hover:border-indigo-600 hover:bg-indigo-50 transition-all group"
          >
            <UserIcon className="w-12 h-12 text-slate-400 group-hover:text-indigo-600 mb-3" />
            <span className="font-bold text-slate-900">Docente</span>
            <span className="text-sm text-slate-500 text-center mt-1">Reporta nuevas incidencias</span>
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Main App ---

export default function App() {
  const [user, loading] = useAuthState(auth);
  const [authTimeout, setAuthTimeout] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setAuthTimeout(true);
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const hasCachedUser = typeof window !== 'undefined' && Boolean(
    localStorage.getItem('app_user_profile') || localStorage.getItem('app_custom_user')
  );

  const isAuthLoading = loading && !authTimeout && !hasCachedUser;

  return (
    <ErrorBoundary>
      <AppContent user={user} loading={isAuthLoading} />
    </ErrorBoundary>
  );
}

function AppContent({ user, loading }: { user: User | null | undefined, loading: boolean }) {
  const [customUser, setCustomUser] = useState<{ uid: string; email: string; displayName?: string } | null>(() => {
    try {
      const saved = localStorage.getItem('app_custom_user');
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      return null;
    }
  });

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  useEffect(() => {
    if (customUser) {
      setIsLoggingOut(false);
    }
  }, [customUser]);

  const isActuallyLoggedIn = Boolean((user && !user.isAnonymous) || customUser) && !isLoggingOut;
  const activeUser = isActuallyLoggedIn ? ((user && !user.isAnonymous) ? user : customUser) : null;

  const [profile, setProfile] = useState<UserProfile | null>(() => {
    try {
      const saved = localStorage.getItem('app_user_profile');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && (parsed.email || parsed.uid)) return parsed;
      }
    } catch (e) {}
    return null;
  });

  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [hasCheckedProfile, setHasCheckedProfile] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('app_user_profile');
      return Boolean(saved);
    } catch {
      return false;
    }
  });
  const [isSeeding, setIsSeeding] = useState(false);
  const [showAppSecretsModal, setShowAppSecretsModal] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return localStorage.getItem('theme') === 'dark';
  });

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  // Ensure network is restored on window focus or tab visibility change
  useEffect(() => {
    const handleWindowActive = () => {
      if (document.visibilityState === 'visible') {
        restoreFirestoreConnection().catch(() => {});
        // If we already have a loaded profile, ensure loading state never traps the user
        if (profile) {
          setIsProfileLoading(false);
          setHasCheckedProfile(true);
        }
      }
    };

    document.addEventListener('visibilitychange', handleWindowActive);
    window.addEventListener('focus', handleWindowActive);
    window.addEventListener('online', handleWindowActive);

    return () => {
      document.removeEventListener('visibilitychange', handleWindowActive);
      window.removeEventListener('focus', handleWindowActive);
      window.removeEventListener('online', handleWindowActive);
    };
  }, [profile]);

  // Invisible auto-watchdog: automatically transitions user to panel if profile resolution takes more than 1s
  useEffect(() => {
    if (activeUser && (!profile || !hasCheckedProfile || isProfileLoading)) {
      const autoTimer = setTimeout(() => {
        try {
          const saved = localStorage.getItem('app_user_profile');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && (parsed.email || parsed.uid)) {
              setProfile(parsed);
              setIsProfileLoading(false);
              setHasCheckedProfile(true);
              return;
            }
          }
        } catch (e) {}

        const emailId = (activeUser.email || (typeof window !== 'undefined' ? localStorage.getItem('last_user_email') : null) || '').toLowerCase().trim();
        if (isSuperAdminEmail(emailId)) {
          const autoAdmin: UserProfile = {
            uid: activeUser.uid || emailId,
            name: emailId.includes('dunor') ? "Administrador DUNOR" : (emailId === 'mi_yorch@hotmail.com' ? "Super Admin (Yorch)" : "Administrador"),
            email: emailId,
            role: "ADMIN",
            isRegistered: true
          };
          setProfile(autoAdmin);
          try { localStorage.setItem('app_user_profile', JSON.stringify(autoAdmin)); } catch (e) {}
        }
        setIsProfileLoading(false);
        setHasCheckedProfile(true);
      }, 1000);

      return () => clearTimeout(autoTimer);
    }
  }, [activeUser, profile, hasCheckedProfile, isProfileLoading]);

  useEffect(() => {
    if (activeUser && !auth.currentUser) {
      signInAnonymously(auth).catch((err) => {
        console.warn("signInAnonymously session sync notice:", err);
      });
    }
  }, [activeUser?.uid]);

  const [systemPopup, setSystemPopup] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    type?: 'success' | 'error' | 'warning' | 'info' | 'confirm';
    confirmText?: string;
    cancelText?: string;
    onConfirm?: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info'
  });

  const showSystemPopup = (
    title: string,
    message: string,
    type: 'success' | 'error' | 'warning' | 'info' | 'confirm' = 'info',
    onConfirm?: () => void,
    confirmText: string = 'Aceptar',
    cancelText: string = 'Cancelar'
  ) => {
    setSystemPopup({
      isOpen: true,
      title,
      message,
      type,
      onConfirm,
      confirmText,
      cancelText
    });
  };
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'notifications' | 'tasks' | 'incidents' | 'users' | 'add-incident' | 'settings' | 'logs' | 'referrals' | 'expedientes' | 'informes'>('notifications');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [expedientes, setExpedientes] = useState<Expediente[]>([]);
  const [preselectedReferralForExpediente, setPreselectedReferralForExpediente] = useState<Referral | null>(null);
  const [highlightedReferralId, setHighlightedReferralId] = useState<string | null>(null);
  const [highlightedTaskId, setHighlightedTaskId] = useState<string | null>(null);
  const [coordinators, setCoordinators] = useState<UserProfile[]>([]);
  const [teachers, setTeachers] = useState<UserProfile[]>([]);
  const [psychologists, setPsychologists] = useState<UserProfile[]>([]);
  const [directives, setDirectives] = useState<UserProfile[]>([]);
  const [admins, setAdmins] = useState<UserProfile[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<UserProfile[]>([]);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [chatOpenPartner, setChatOpenPartner] = useState<UserProfile | null>(null);
  const [liveToast, setLiveToast] = useState<{
    id: string;
    title: string;
    message: string;
    timestamp: number;
    incidentId?: string;
    referralId?: string;
    taskId?: string;
    type?: string;
    chatPartnerUid?: string;
    chatPartnerEmail?: string;
  } | null>(null);

  useEffect(() => {
    if (!liveToast) return;
    const timer = setTimeout(() => {
      setLiveToast(null);
    }, 7000);
    return () => clearTimeout(timer);
  }, [liveToast]);

  const playNotificationSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        ctx.resume();
      }
      const now = ctx.currentTime;
      
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(659.25, now);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.25);

      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(987.77, now + 0.08);
      gain2.gain.setValueAtTime(0.15, now + 0.08);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.4);
    } catch (e) {
      console.warn("Audio chime failed:", e);
    }
  };
  const [searchTerm, setSearchTerm] = useState('');
  const [isGroupedByStudent, setIsGroupedByStudent] = useState(false);
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [showCongratulationModal, setShowCongratulationModal] = useState(false);
  const [isExportingDb, setIsExportingDb] = useState(false);
  const [isImportingDb, setIsImportingDb] = useState(false);
  const [firestoreRolePermissions, setFirestoreRolePermissions] = useState<Partial<RolePermissionsMap>>({});

  const cachedName = typeof window !== 'undefined' ? localStorage.getItem('app_name') || 'DASHBOARD DUNOR' : 'DASHBOARD DUNOR';

  const DEFAULT_SETTINGS: SystemSettings = {
    appName: cachedName,
    appLogoUrl: '/logo.svg',
    emailNotificationsEnabled: true,
    forwardingEnabled: false,
    coordinatorAdminMapping: {},
    categories: [
      'Agresión Física',
      'Agresión Verbal',
      'Daño a Material',
      'Lenguaje Obsceno',
      'Manifestó Agresividad',
      'Incumplimiento de Actividades',
      'Accidente Escolar',
      'Falta de Respeto al Docente'
    ],
    rolePermissions: DEFAULT_ROLE_PERMISSIONS,
    teacherChatTtlHours: 6
  };

  const [systemSettings, setSystemSettings] = useState<SystemSettings>(DEFAULT_SETTINGS);
  const [chatTtlCustomInput, setChatTtlCustomInput] = useState<number>(6);
  const [chatTtlSavedFeedback, setChatTtlSavedFeedback] = useState(false);

  useEffect(() => {
    if (systemSettings.teacherChatTtlHours) {
      setChatTtlCustomInput(systemSettings.teacherChatTtlHours);
    }
  }, [systemSettings.teacherChatTtlHours]);

  const [selectedMappingAdmin, setSelectedMappingAdmin] = useState('');
  const [selectedMappingCoordinator, setSelectedMappingCoordinator] = useState('');
  const [selectedIncidents, setSelectedIncidents] = useState<string[]>([]);
  const [selectedNotifications, setSelectedNotifications] = useState<string[]>([]);
  const [isNotifSelectionMode, setIsNotifSelectionMode] = useState(false);
  const [expandedIncidentId, setExpandedIncidentId] = useState<string | null>(null);
  const [celebrationData, setCelebrationData] = useState<{
    notif: any;
    title: string;
    message: string;
  } | null>(null);

  const triggerConfetti = () => {
    try {
      confetti({
        particleCount: 120,
        spread: 80,
        origin: { y: 0.6 }
      });
      setTimeout(() => {
        confetti({
          particleCount: 70,
          angle: 60,
          spread: 60,
          origin: { x: 0.05, y: 0.6 }
        });
        confetti({
          particleCount: 70,
          angle: 120,
          spread: 60,
          origin: { x: 0.95, y: 0.6 }
        });
      }, 220);
      setTimeout(() => {
        confetti({
          particleCount: 90,
          spread: 100,
          origin: { y: 0.5 }
        });
      }, 450);
    } catch (err) {
      console.error("Confetti error:", err);
    }
  };

  useEffect(() => {
    if (!celebrationData) return;

    const timer = setTimeout(async () => {
      if (celebrationData) {
        const notifToProcess = celebrationData.notif;
        setCelebrationData(null);
        await processNotificationClickAndDelete(notifToProcess);
      }
    }, 3500);

    return () => clearTimeout(timer);
  }, [celebrationData]);

  const processNotificationClickAndDelete = async (notif: any) => {
    if (notif && notif.id) {
      setNotifications(prev => prev.filter(n => n.id !== notif.id));
      try {
        await deleteDoc(doc(db, 'notifications', notif.id));
      } catch (err) {
        console.error("Error deleting clicked notification:", err);
      }
    }

    const titleLower = (notif?.title || '').toLowerCase();
    const msgLower = (notif?.message || '').toLowerCase();

    // Notificación de Chat Docente Secreto
    if (notif?.type === 'teacher_chat') {
      const partnerUid = notif.chatPartnerUid || notif.senderUid || notif.creatorUid;
      const partnerEmail = notif.chatPartnerEmail || notif.senderEmail || notif.creatorEmail;
      const partner = teachers.find(t => 
        (partnerUid && t.uid === partnerUid) || 
        (partnerEmail && t.email?.toLowerCase() === String(partnerEmail).toLowerCase())
      );
      if (partner) {
        setChatOpenPartner(partner);
      }
      return;
    }

    const isReferralNotif = 
      notif?.type === 'referral' ||
      notif?.type === 'referral_suggestion' ||
      !!notif?.referralId ||
      titleLower.includes('canalizac') ||
      msgLower.includes('canalizac');

    if (isReferralNotif) {
      let targetRefId = notif?.referralId;
      if (!targetRefId && notif?.incidentId) {
        const foundRef = referrals.find(r => r.incidentId === notif.incidentId || r.id === `ref_inc_${notif.incidentId}`);
        targetRefId = foundRef ? foundRef.id : `ref_inc_${notif.incidentId}`;
      }
      setHighlightedReferralId(targetRefId || null);
      setActiveTab('referrals');
    } else if (notif?.type === 'felicitacion' || notif?.taskId || titleLower.includes('tarea') || titleLower.includes('felicitac')) {
      if (notif?.taskId) {
        setHighlightedTaskId(notif.taskId);
      }
      setActiveTab('tasks');
    } else if (notif?.expedienteId || notif?.type === 'expediente' || titleLower.includes('expediente')) {
      setActiveTab('expedientes');
    } else if (notif?.incidentId) {
      setExpandedIncidentId(notif.incidentId);
      setActiveTab('incidents');
    } else {
      setActiveTab('incidents');
    }
  };

  const handleNotificationClick = async (notif: any) => {
    if (isNotifSelectionMode) {
      setSelectedNotifications(prev => 
        prev.includes(notif.id) ? prev.filter(id => id !== notif.id) : [...prev, notif.id]
      );
      return;
    }

    const titleLower = (notif.title || '').toLowerCase();
    const msgLower = (notif.message || '').toLowerCase();

    const isFelicitacion = 
      notif.type === 'felicitacion' ||
      notif.title?.includes('🎉') ||
      titleLower.includes('felicitac') ||
      titleLower.includes('reconocimiento') ||
      msgLower.includes('felicitac') ||
      msgLower.includes('reconocimiento');

    if (isFelicitacion) {
      setCelebrationData({
        notif,
        title: notif.title || '¡Felicitaciones y Reconocimiento!',
        message: notif.message || ''
      });
      triggerConfetti();
      return;
    }

    await processNotificationClickAndDelete(notif);
  };
  const [newCategory, setNewCategory] = useState('');
  const [editingCategory, setEditingCategory] = useState<{ original: string; name: string } | null>(null);
  const [deletingCategory, setDeletingCategory] = useState<string | null>(null);
  const [appNameInput, setAppNameInput] = useState(systemSettings.appName || 'DASHBOARD DUNOR');
  const [appLogoInput, setAppLogoInput] = useState(systemSettings.appLogoUrl || '');

  const [testSubject, setTestSubject] = useState('Mensaje de Prueba - Sistema DUNOR');
  const [testBody, setTestBody] = useState('Este es un mensaje de prueba enviado desde la administración para verificar el funcionamiento de las notificaciones e email en la plataforma.');
  const [sendSystemNotifCheck, setSendSystemNotifCheck] = useState(true);
  const [sendEmailNotifCheck, setSendEmailNotifCheck] = useState(true);
  const [isSendingTestBroadcast, setIsSendingTestBroadcast] = useState(false);
  const [testBroadcastResult, setTestBroadcastResult] = useState<string | null>(null);

  useEffect(() => {
    if (systemSettings) {
      if (systemSettings.appName && systemSettings.appName !== appNameInput) setAppNameInput(systemSettings.appName);
      if (systemSettings.appLogoUrl && systemSettings.appLogoUrl !== appLogoInput) setAppLogoInput(systemSettings.appLogoUrl);
    }
  }, [systemSettings?.appName, systemSettings?.appLogoUrl]);

  const [logs, setLogs] = useState<Log[]>([]);
  const [logSearchTerm, setLogSearchTerm] = useState<string>('');
  const [logModuleFilter, setLogModuleFilter] = useState<string>('ALL');
  const [logRoleFilter, setLogRoleFilter] = useState<string>('ALL');
  const [selectedLogDetail, setSelectedLogDetail] = useState<Log | null>(null);
  const [galleryConfig, setGalleryConfig] = useState<{
    isOpen: boolean;
    images: string[];
    currentIndex: number;
  }>({
    isOpen: false,
    images: [],
    currentIndex: 0,
  });

  const [printIncident, setPrintIncident] = useState<Incident | null>(null);

  const isSuperAdmin = isSuperAdminEmail(profile?.email);

  const effectiveRolePermissions = useMemo(() => {
    const merged: RolePermissionsMap = { ...DEFAULT_ROLE_PERMISSIONS };
    const rolesList: UserRole[] = ['ADMIN', 'DIRECTIVE', 'COORDINATOR', 'PSYCHOLOGIST', 'TEACHER'];
    rolesList.forEach(r => {
      merged[r] = {
        ...DEFAULT_ROLE_PERMISSIONS[r],
        ...systemSettings?.rolePermissions?.[r],
        ...firestoreRolePermissions?.[r]
      };
    });
    return merged;
  }, [systemSettings.rolePermissions, firestoreRolePermissions]);

  const effectiveSystemSettings = useMemo(() => ({
    ...systemSettings,
    rolePermissions: effectiveRolePermissions
  }), [systemSettings, effectiveRolePermissions]);

  const can = (permissionKey: keyof RolePermissions): boolean => {
    return getRolePermission(profile?.role, permissionKey, effectiveRolePermissions, isSuperAdmin, profile?.customPermissions);
  };

  // Tab-to-permission mapping for automatic activeTab redirection when permissions change
  const tabPermissionMap: Record<string, keyof RolePermissions> = useMemo(() => ({
    'notifications': 'canViewNotifications',
    'incidents': 'canViewIncidents',
    'add-incident': 'canCreateIncident',
    'tasks': 'canViewTasks',
    'referrals': 'canViewReferrals',
    'expedientes': 'canViewExpedientes',
    'informes': 'canViewInformes',
    'users': 'canViewUsers',
    'settings': 'canViewSettings',
    'logs': 'canViewLogs',
  }), []);

  const tabPriorityOrder: Array<{ id: typeof activeTab; key: keyof RolePermissions }> = useMemo(() => [
    { id: 'notifications', key: 'canViewNotifications' },
    { id: 'incidents', key: 'canViewIncidents' },
    { id: 'tasks', key: 'canViewTasks' },
    { id: 'referrals', key: 'canViewReferrals' },
    { id: 'expedientes', key: 'canViewExpedientes' },
    { id: 'informes', key: 'canViewInformes' },
    { id: 'add-incident', key: 'canCreateIncident' },
    { id: 'users', key: 'canViewUsers' },
    { id: 'settings', key: 'canViewSettings' },
    { id: 'logs', key: 'canViewLogs' },
  ], []);

  // Initial view redirection based on role
  useEffect(() => {
    if (profile) {
      const normRole = normalizeUserRole(profile.role);
      if (normRole === 'PSYCHOLOGIST' && activeTab === 'incidents') {
        setActiveTab('notifications');
      }
    }
  }, [profile?.uid, profile?.role]);

  // Auto-redirect activeTab if currently selected tab becomes unpermitted or is not accessible
  useEffect(() => {
    if (!profile) return;
    const requiredPerm = tabPermissionMap[activeTab];
    if (requiredPerm && !can(requiredPerm)) {
      const availableTab = tabPriorityOrder.find(item => can(item.key));
      if (availableTab && availableTab.id !== activeTab) {
        setActiveTab(availableTab.id);
      }
    }
  }, [profile, activeTab, effectiveRolePermissions, firestoreRolePermissions, tabPermissionMap, tabPriorityOrder]);

  // Listener for 'permisos' collection in Firebase Firestore
  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'permisos'), (snapshot) => {
      const permissionsMap: Partial<RolePermissionsMap> = {};
      snapshot.docs.forEach((docSnap) => {
        const data = docSnap.data();
        const normRole = normalizeUserRole(docSnap.id) || normalizeUserRole(data.role);
        if (normRole) {
          permissionsMap[normRole] = {
            ...DEFAULT_ROLE_PERMISSIONS[normRole],
            ...(permissionsMap[normRole] || {}),
            ...data
          } as RolePermissions;
        }
      });
      setFirestoreRolePermissions(prev => {
        if (JSON.stringify(prev) === JSON.stringify(permissionsMap)) return prev;
        return permissionsMap;
      });
    }, (error) => {
      console.warn("Permisos collection listener warning:", error);
    });
    return () => unsubscribe();
  }, []);

  // Keep session open in background permanently (no auto-logout on inactivity) so real-time notifications remain active
  // Mobile device back button navigation handler:
  // Returns to the previous screen/tab or closes modals instead of minimizing/exiting the app
  const tabHistoryRef = useRef<string[]>(['notifications']);
  const isPopNavRef = useRef(false);

  useEffect(() => {
    // Ensure initial history state exists
    if (!window.history.state || !window.history.state.dunorApp) {
      window.history.replaceState({ dunorApp: true, tab: activeTab }, '');
    }

    const handleAppPopState = (e: PopStateEvent) => {
      // If a secret chat is handling this popstate, let it handle
      if (e.state && e.state.teacherChatOpen) {
        return;
      }

      // 1. Close confirmation modal if open
      if (confirmModal.isOpen) {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        window.history.pushState({ dunorApp: true, tab: activeTab }, '');
        return;
      }

      // 2. Close secrets modal if open
      if (showAppSecretsModal) {
        setShowAppSecretsModal(false);
        window.history.pushState({ dunorApp: true, tab: activeTab }, '');
        return;
      }

      // 3. Close mobile sidebar if open
      if (window.innerWidth < 768 && isSidebarOpen) {
        setIsSidebarOpen(false);
        window.history.pushState({ dunorApp: true, tab: activeTab }, '');
        return;
      }

      // 4. Navigate back to previous screen/tab if available
      if (tabHistoryRef.current.length > 1) {
        tabHistoryRef.current.pop(); // Remove current tab
        const prevTab = tabHistoryRef.current[tabHistoryRef.current.length - 1];
        if (prevTab) {
          isPopNavRef.current = true;
          setActiveTab(prevTab as any);
          return;
        }
      }

      // 5. If already at base screen, ensure app doesn't abruptly exit
      window.history.pushState({ dunorApp: true, tab: activeTab }, '');
    };

    window.addEventListener('popstate', handleAppPopState);
    return () => window.removeEventListener('popstate', handleAppPopState);
  }, [confirmModal.isOpen, showAppSecretsModal, isSidebarOpen, activeTab]);

  // Track tab transitions in history stack
  useEffect(() => {
    if (isPopNavRef.current) {
      isPopNavRef.current = false;
      return;
    }
    const stack = tabHistoryRef.current;
    if (stack[stack.length - 1] !== activeTab) {
      stack.push(activeTab);
      if (stack.length > 30) stack.shift();
      window.history.pushState({ dunorApp: true, tab: activeTab }, '');
    }
  }, [activeTab]);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'global'), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data() as SystemSettings;
        setSystemSettings(prev => {
          const mergedRolePermissions = { ...(prev.rolePermissions || DEFAULT_ROLE_PERMISSIONS) };
          if (data.rolePermissions) {
            Object.keys(data.rolePermissions).forEach(rawRole => {
              const normRole = normalizeUserRole(rawRole);
              if (normRole && data.rolePermissions[rawRole]) {
                mergedRolePermissions[normRole] = {
                  ...DEFAULT_ROLE_PERMISSIONS[normRole],
                  ...(mergedRolePermissions[normRole] || {}),
                  ...data.rolePermissions[rawRole]
                };
              }
            });
          }
          const next = {
            ...DEFAULT_SETTINGS,
            ...prev,
            ...data,
            rolePermissions: mergedRolePermissions
          };
          if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
          return next;
        });
        if (data.appLogoUrl) {
          localStorage.setItem('app_logo_url', data.appLogoUrl);
        }
        if (data.appName) {
          localStorage.setItem('app_name', data.appName);
        }
      } else {
        setSystemSettings(DEFAULT_SETTINGS);
      }
    }, (error) => {
      console.warn("Settings listener error:", error);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const appName = systemSettings.appName || 'DASHBOARD DUNOR';
    document.title = appName;

    const iconUrl = systemSettings.appLogoUrl || "/logo.svg";

    let iconLink = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (!iconLink) {
      iconLink = document.createElement('link');
      iconLink.rel = 'icon';
      document.getElementsByTagName('head')[0].appendChild(iconLink);
    }
    iconLink.href = iconUrl;

    let appleIconLink = document.querySelector("link[rel~='apple-touch-icon']") as HTMLLinkElement | null;
    if (!appleIconLink) {
      appleIconLink = document.createElement('link');
      appleIconLink.rel = 'apple-touch-icon';
      document.getElementsByTagName('head')[0].appendChild(appleIconLink);
    }
    appleIconLink.href = iconUrl;
  }, [systemSettings.appName, systemSettings.appLogoUrl]);

  useEffect(() => {
    if (isSuperAdmin || can('canViewLogs')) {
      const q = query(collection(db, 'logs'), orderBy('timestamp', 'desc'), limit(300));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const logsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Log));
        setLogs(logsData);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'logs');
      });
      return () => unsubscribe();
    }
  }, [isSuperAdmin, profile]);

  const sendEmail = async (to: string, subject: string, html: string) => {
    if (!to || !to.includes('@')) return { error: 'Invalid email' };
    try {
      const response = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim().toLowerCase(), subject, html })
      });
      const data = await response.json();
      if (!response.ok || data.error) {
        console.warn('[EMAIL-WARN] Server returned email error:', data.error || data);
      } else {
        console.log('[EMAIL-SUCCESS] Email sent successfully to:', to);
      }
      return data;
    } catch (error) {
      console.error('Email request exception:', error);
      return { error: String(error) };
    }
  };

  const sendNotification = async (
    userIdOrIds: string | string[],
    title: string,
    message: string,
    incidentId: string = '',
    skipAdmins: boolean = false,
    extraData: Record<string, any> = {}
  ) => {
    const titleLower = (title || '').toLowerCase();
    const msgLower = (message || '').toLowerCase();

    // Strictly eliminate welcome and new user registration notifications for all users
    if (
      titleLower.includes('bienvenid') ||
      titleLower.includes('nuevo usuario') ||
      titleLower.includes('registro de nuevo usuario') ||
      titleLower.includes('usuario registrado') ||
      titleLower.includes('usuario nuevo') ||
      titleLower.includes('alta de usuario') ||
      msgLower.includes('bienvenid') ||
      msgLower.includes('bienvenido/a a dashboard dunor') ||
      msgLower.includes('tu registro al dashboard dunor fue exitosa') ||
      msgLower.includes('nuevo usuario') ||
      msgLower.includes('usuario registrado') ||
      msgLower.includes('cuenta creada') ||
      (msgLower.includes('dashboard dunor') && (msgLower.includes('registro') || msgLower.includes('bienvenid')))
    ) {
      return;
    }

    let allUsers = [...admins, ...directives, ...coordinators, ...teachers, ...psychologists];
    if (allUsers.length === 0) {
      try {
        const snap = await safeGetDocs(collection(db, 'users'));
        allUsers = snap.docs.map(doc => doc.data() as UserProfile);
      } catch (e) {
        console.error("Error fetching all users for notification:", e);
      }
    }

    // Identify creator / excluded users so they NEVER receive notification or email for their own creations
    const excludedIdsAndEmails = new Set<string>();
    if (extraData?.creatorUid) excludedIdsAndEmails.add(String(extraData.creatorUid).toLowerCase().trim());
    if (extraData?.creatorEmail) excludedIdsAndEmails.add(String(extraData.creatorEmail).toLowerCase().trim());
    if (extraData?.excludeUserId) excludedIdsAndEmails.add(String(extraData.excludeUserId).toLowerCase().trim());
    if (extraData?.excludeUserEmail) excludedIdsAndEmails.add(String(extraData.excludeUserEmail).toLowerCase().trim());
    if (Array.isArray(extraData?.excludeUserIds)) {
      extraData.excludeUserIds.forEach((id: any) => {
        if (id && typeof id === 'string') excludedIdsAndEmails.add(id.toLowerCase().trim());
      });
    }
    if (extraData?.isCreationNotification && profile) {
      if (profile.uid) excludedIdsAndEmails.add(profile.uid.toLowerCase().trim());
      if (profile.email) excludedIdsAndEmails.add(profile.email.toLowerCase().trim());
    }

    // Expand exclusions to both uid and email if a matching user is found
    allUsers.forEach(u => {
      const uUid = u.uid ? u.uid.toLowerCase().trim() : '';
      const uEmail = u.email ? u.email.toLowerCase().trim() : '';
      if ((uUid && excludedIdsAndEmails.has(uUid)) || (uEmail && excludedIdsAndEmails.has(uEmail))) {
        if (uUid) excludedIdsAndEmails.add(uUid);
        if (uEmail) excludedIdsAndEmails.add(uEmail);
      }
    });

    const determinedCreatorUid = extraData?.creatorUid || extraData?.excludeUserId || (extraData?.isCreationNotification && profile?.uid ? profile.uid : '') || '';
    const determinedCreatorEmail = extraData?.creatorEmail || extraData?.excludeUserEmail || (extraData?.isCreationNotification && profile?.email ? profile.email : '') || '';

    const notificationData: Record<string, any> = {
      title,
      message,
      incidentId: incidentId || '',
      read: false,
      createdAt: Date.now(),
      ...(extraData || {}),
      creatorUid: determinedCreatorUid,
      creatorEmail: determinedCreatorEmail,
      isCreationNotification: Boolean(extraData?.isCreationNotification)
    };

    const finalTargetUserIds = new Set<string>();
    const targetEmails = new Set<string>();
    const rawTargets: string[] = Array.isArray(userIdOrIds) ? userIdOrIds : [userIdOrIds];

    const addTargetUser = (str: string) => {
      if (!str || typeof str !== 'string' || !str.trim()) return;
      const clean = str.trim();
      const cleanLower = clean.toLowerCase();
      if (cleanLower === 'jorge.villanueva@boletomovil.com') return;
      if (excludedIdsAndEmails.has(cleanLower)) return;

      const matched = allUsers.find(u =>
        u.uid === clean ||
        (u.email && u.email.toLowerCase() === cleanLower)
      );

      if (matched) {
        const mUidLower = matched.uid ? matched.uid.toLowerCase().trim() : '';
        const mEmailLower = matched.email ? matched.email.toLowerCase().trim() : '';
        if (excludedIdsAndEmails.has(mUidLower) || excludedIdsAndEmails.has(mEmailLower)) {
          return;
        }

        const targetId = matched.uid || (matched.email ? matched.email.toLowerCase() : cleanLower);
        finalTargetUserIds.add(targetId);
        if (matched.email && matched.email.includes('@')) {
          targetEmails.add(matched.email.toLowerCase());
        }
      } else {
        finalTargetUserIds.add(cleanLower);
        if (cleanLower.includes('@')) {
          targetEmails.add(cleanLower);
        }
      }
    };

    // 1. Explicit target recipients (expanding roles & ALL broadcasts)
    for (const raw of rawTargets) {
      if (!raw || typeof raw !== 'string' || !raw.trim()) continue;
      const clean = raw.trim();
      const cleanUpper = clean.toUpperCase();

      const roleMatches = allUsers.filter(u =>
        normalizeUserRole(u.role) === cleanUpper ||
        String(u.role).toUpperCase() === cleanUpper
      );

      if (roleMatches.length > 0) {
        roleMatches.forEach(u => {
          if (u.uid) addTargetUser(u.uid);
          if (u.email) addTargetUser(u.email);
        });
        finalTargetUserIds.add(cleanUpper.toLowerCase());
      } else if (cleanUpper === 'ALL') {
        allUsers.forEach(u => {
          if (u.uid) addTargetUser(u.uid);
          if (u.email) addTargetUser(u.email);
        });
        finalTargetUserIds.add('all');
      } else {
        addTargetUser(clean);
      }
    }

    // 2. SuperAdmin: System notifications reach superadmin in-app for auditing (NO EMAILS), unless skipAdmins or creator is superadmin
    if (!skipAdmins) {
      SUPER_ADMIN_EMAILS.forEach(email => {
        const eLower = email.toLowerCase().trim();
        if (!excludedIdsAndEmails.has(eLower)) {
          finalTargetUserIds.add(eLower);
        }
      });
      allUsers.filter(u => isSuperAdminEmail(u.email)).forEach(sa => {
        const saUid = sa.uid ? sa.uid.toLowerCase().trim() : '';
        const saEmail = sa.email ? sa.email.toLowerCase().trim() : '';
        if (sa.uid && !excludedIdsAndEmails.has(saUid) && !excludedIdsAndEmails.has(saEmail)) {
          finalTargetUserIds.add(sa.uid);
        }
        if (sa.email && !excludedIdsAndEmails.has(saEmail) && !excludedIdsAndEmails.has(saUid)) {
          finalTargetUserIds.add(sa.email.toLowerCase().trim());
        }
      });
    }

    // Double check that no excluded user ID or email slipped into finalTargetUserIds or targetEmails
    if (excludedIdsAndEmails.size > 0) {
      for (const id of Array.from(finalTargetUserIds)) {
        if (excludedIdsAndEmails.has(id.toLowerCase().trim())) {
          finalTargetUserIds.delete(id);
        }
      }
      for (const email of Array.from(targetEmails)) {
        if (excludedIdsAndEmails.has(email.toLowerCase().trim())) {
          targetEmails.delete(email);
        }
      }
    }

    // 3. Create single notification document per unique target user ID/email
    for (const userId of finalTargetUserIds) {
      if (!userId) continue;
      try {
        const docToSave: Record<string, any> = {
          ...notificationData,
          userId
        };

        // Remove any undefined keys to guarantee Firestore addDoc never throws 'Unsupported field value: undefined'
        Object.keys(docToSave).forEach((key) => {
          if (docToSave[key] === undefined) {
            delete docToSave[key];
          }
        });

        await addDoc(collection(db, 'notifications'), docToSave);
      } catch (e) {
        console.error("Error sending notification doc to:", userId, e);
      }
    }

    // 6. Send Email Notification to all recipient emails (unless skipEmail is set)
    // CRITICAL: SuperAdmin receives ONLY in-app notifications, NEVER notification emails ("solo notificaciones NO CORREOS, le lleguen al superadmin")
    const filteredTargetEmails = Array.from(targetEmails).filter(email => !isSuperAdminEmail(email));

    if (systemSettings.emailNotificationsEnabled !== false && !extraData?.skipEmail && filteredTargetEmails.length > 0) {
      const appTitle = systemSettings.appName || 'DASHBOARD DUNOR';
      const formattedMsg = message.replace(/\n/g, '<br/>');

      const emailHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <div style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.5px;">${title}</h1>
            <p style="color: #c7d2fe; margin: 4px 0 0 0; font-size: 12px; font-weight: 600; text-transform: uppercase;">${appTitle}</p>
          </div>
          <div style="padding: 24px; background-color: #ffffff;">
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 20px; font-size: 15px; color: #334155; line-height: 1.6;">
              ${formattedMsg}
            </div>

            ${extraData.detailsHtml ? `<div style="background-color: #f1f5f9; padding: 16px; border-radius: 12px; border: 1px solid #cbd5e1; margin-bottom: 20px; font-size: 14px; color: #1e293b;">${extraData.detailsHtml}</div>` : ''}

            <p style="font-size: 13px; color: #64748b; text-align: center; margin: 20px 0 0 0;">Ingresa a la plataforma para revisar los detalles y realizar el seguimiento correspondiente.</p>
          </div>
          <div style="background-color: #f1f5f9; padding: 14px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0; font-size: 11px; color: #94a3b8; font-weight: 500;">Notificación automática del Sistema ${appTitle}.</p>
          </div>
        </div>
      `;

      for (const targetEmail of filteredTargetEmails) {
        if (targetEmail && targetEmail.includes('@')) {
          sendEmail(targetEmail, title, emailHtml).catch(err => {
            console.error("Error sending email notification to:", targetEmail, err);
          });
        }
      }
    }
  };

  const getModuleFromAction = (action: string, details: string = ''): string => {
    const text = (action + ' ' + details).toLowerCase();
    if (text.includes('incidencia')) return 'Incidencias';
    if (text.includes('canaliz') || text.includes('referral') || text.includes('psicolog')) return 'Canalizaciones';
    if (text.includes('expediente') || text.includes('psicopedagógic')) return 'Expedientes';
    if (text.includes('informe')) return 'Informes';
    if (text.includes('tarea') || text.includes('felicitación') || text.includes('felicitacion')) return 'Tareas / Felicitaciones';
    if (text.includes('usuario') || text.includes('docente') || text.includes('coordinador') || text.includes('directiv') || text.includes('admin')) return 'Usuarios';
    if (text.includes('permiso') || text.includes('categoría') || text.includes('categoria') || text.includes('respaldo') || text.includes('logotipo')) return 'Configuración';
    return 'General';
  };

  const addLog = async (
    action: string, 
    details?: string,
    extra?: {
      module?: string;
      recordId?: string;
      creatorName?: string;
      creatorEmail?: string;
      creatorRole?: string;
      userEmail?: string;
      userName?: string;
      userRole?: string;
    }
  ) => {
    try {
      const effectiveEmail = profile?.email || activeUser?.email || extra?.creatorEmail || extra?.userEmail || 'incidencias.dunor@gmail.com';
      const effectiveName = profile?.name || activeUser?.displayName || extra?.creatorName || extra?.userName || (isSuperAdmin ? 'Superadministrador' : effectiveEmail.split('@')[0]);
      const effectiveRole = profile?.role || (isSuperAdmin ? 'ADMIN' : (extra?.creatorRole || extra?.userRole || 'ADMIN'));
      const creatorName = extra?.creatorName || effectiveName;
      const creatorEmail = extra?.creatorEmail || effectiveEmail;
      const creatorRole = extra?.creatorRole || effectiveRole;
      const moduleName = extra?.module || getModuleFromAction(action, details || '');

      await addDoc(collection(db, 'logs'), {
        action,
        userEmail: effectiveEmail,
        userName: effectiveName,
        userRole: effectiveRole,
        creatorName,
        creatorEmail,
        creatorRole,
        module: moduleName,
        recordId: extra?.recordId || '',
        timestamp: Date.now(),
        details: details || ''
      });
    } catch (e) {
      console.error("Error adding log:", e);
    }
  };

  const notifyIncidentInvolvedUsers = async ({
    incident,
    title,
    message,
    emailSubject,
    emailHeaderTitle = 'Actualización de Incidencia',
    actionDetails,
    excludeUserId,
    excludeUserEmail,
    isCreation = false,
    extraData = {}
  }: {
    incident: Incident;
    title: string;
    message: string;
    emailSubject: string;
    emailHeaderTitle?: string;
    actionDetails?: string;
    excludeUserId?: string;
    excludeUserEmail?: string;
    isCreation?: boolean;
    extraData?: Record<string, any>;
  }) => {
    let allUsers = [...admins, ...directives, ...coordinators, ...teachers, ...psychologists];
    if (allUsers.length === 0) {
      try {
        const snap = await safeGetDocs(collection(db, 'users'));
        allUsers = snap.docs.map(doc => doc.data() as UserProfile);
      } catch (e) {
        console.error("Error fetching users for incident notification:", e);
      }
    }

    const targetUserIds = new Set<string>();
    const targetEmails = new Set<string>();

    // Build comprehensive exclusion set for the user performing the action / creator of report
    const excludeSet = new Set<string>();
    if (excludeUserId) excludeSet.add(excludeUserId.toLowerCase().trim());
    if (excludeUserEmail) excludeSet.add(excludeUserEmail.toLowerCase().trim());
    if (profile?.uid) excludeSet.add(profile.uid.toLowerCase().trim());
    if (profile?.email) excludeSet.add(profile.email.toLowerCase().trim());
    if (isCreation) {
      if (incident.reporterId) excludeSet.add(incident.reporterId.toLowerCase().trim());
      if (incident.reporterEmail) excludeSet.add(incident.reporterEmail.toLowerCase().trim());
    }

    // Expand exclusions across all matching user records (both UID & email)
    allUsers.forEach(u => {
      const uUid = u.uid ? u.uid.toLowerCase().trim() : '';
      const uEmail = u.email ? u.email.toLowerCase().trim() : '';
      if ((uUid && excludeSet.has(uUid)) || (uEmail && excludeSet.has(uEmail))) {
        if (uUid) excludeSet.add(uUid);
        if (uEmail) excludeSet.add(uEmail);
      }
    });

    const addTarget = (uidOrEmail?: string) => {
      if (!uidOrEmail) return;
      const clean = uidOrEmail.trim();
      if (!clean) return;
      if (clean.toLowerCase() === 'jorge.villanueva@boletomovil.com') return;
      if (excludeSet.has(clean.toLowerCase())) return;

      const matched = allUsers.find(u =>
        u.uid === clean ||
        (u.email && u.email.toLowerCase() === clean.toLowerCase())
      );

      if (matched) {
        const mUid = matched.uid ? matched.uid.toLowerCase().trim() : '';
        const mEmail = matched.email ? matched.email.toLowerCase().trim() : '';
        if (excludeSet.has(mUid) || excludeSet.has(mEmail)) {
          return;
        }
        if (matched.uid) {
          targetUserIds.add(matched.uid);
        }
        if (matched.email) {
          targetEmails.add(matched.email.toLowerCase());
        }
      } else {
        if (clean.includes('@')) {
          targetEmails.add(clean.toLowerCase());
          targetUserIds.add(clean.toLowerCase());
        } else {
          targetUserIds.add(clean);
        }
      }
    };

    // 1. Reporter (Docente que levanta el reporte) - Only if NOT a creation event
    if (!isCreation) {
      addTarget(incident.reporterId);
      addTarget(incident.reporterEmail);
    }

    // 2. Coordinators (ÚNICAMENTE los coordinadores asignados al reporte o al docente que levantó el reporte)
    if (incident.coordinatorIds && Array.isArray(incident.coordinatorIds)) {
      incident.coordinatorIds.forEach(id => addTarget(id));
    }
    if (incident.coordinatorId) {
      addTarget(incident.coordinatorId);
    }
    if (incident.coordinatorEmail) {
      addTarget(incident.coordinatorEmail);
    }
    // Coordinador asignado específicamente en el perfil del docente que levantó el reporte
    const reportingTeacher = allUsers.find(u => 
      (incident.reporterId && u.uid === incident.reporterId) || 
      (incident.reporterEmail && u.email?.toLowerCase() === incident.reporterEmail.toLowerCase())
    );
    if (reportingTeacher) {
      if (reportingTeacher.assignedCoordinatorId) {
        addTarget(reportingTeacher.assignedCoordinatorId);
      }
      if (reportingTeacher.assignedCoordinatorEmail) {
        addTarget(reportingTeacher.assignedCoordinatorEmail);
      }
      if (reportingTeacher.assignedCoordinatorName) {
        const foundCoordByName = coordinators.find(c => c.name === reportingTeacher.assignedCoordinatorName);
        if (foundCoordByName) {
          addTarget(foundCoordByName.uid);
          addTarget(foundCoordByName.email);
        }
      }
    }

    // 3. Notified Teacher (Docente en copia si aplica)
    if (incident.notifiedTeacherId) {
      addTarget(incident.notifiedTeacherId);
    }
    if (incident.notifiedTeacherEmail) {
      addTarget(incident.notifiedTeacherEmail);
    }

    // 4. Directives and Admins (Directivos y Administradores de la institución)
    allUsers.filter(u => {
      const nr = normalizeUserRole(u.role);
      return nr === 'DIRECTIVE' || nr === 'ADMIN' || isSuperAdminEmail(u.email);
    }).forEach(u => {
      addTarget(u.uid);
      addTarget(u.email);
    });

    // Exclude SuperAdmin from routine incident email alerts ("solo notificaciones NO CORREOS, le lleguen al superadmin")
    for (const email of Array.from(targetEmails)) {
      if (isSuperAdminEmail(email)) {
        targetEmails.delete(email);
      }
    }

    // Prune target sets against excludeSet
    for (const id of Array.from(targetUserIds)) {
      if (excludeSet.has(id.toLowerCase().trim())) {
        targetUserIds.delete(id);
      }
    }
    for (const email of Array.from(targetEmails)) {
      if (excludeSet.has(email.toLowerCase().trim())) {
        targetEmails.delete(email);
      }
    }

    const finalTargetIds = Array.from(targetUserIds);

    // Send in-app notification in real-time (skipEmail: true since notifyIncidentInvolvedUsers handles the rich email below)
    if (finalTargetIds.length > 0) {
      await sendNotification(finalTargetIds, title, message, incident.id, false, {
        ...extraData,
        skipEmail: true,
        creatorUid: excludeUserId || profile?.uid || '',
        creatorEmail: excludeUserEmail || profile?.email || '',
        isCreationNotification: isCreation
      });
    }

    // Send email notification to all involved users (default true unless explicitly false)
    if (systemSettings.emailNotificationsEnabled !== false && targetEmails.size > 0) {
      const appTitle = systemSettings.appName || 'DASHBOARD DUNOR';
      const statusLabel = incident.status === 'RECIBIDO' ? 'Recibido' :
                          incident.status === 'EN_SEGUIMIENTO' ? 'En Seguimiento' :
                          incident.status === 'CERRADO' ? 'Cerrado' : 'Pendiente';

      const emailHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <div style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); padding: 28px 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">${emailHeaderTitle}</h1>
            <p style="color: #c7d2fe; margin: 6px 0 0 0; font-size: 13px; font-weight: 600; text-transform: uppercase;">${appTitle}</p>
          </div>
          <div style="padding: 28px 24px; background-color: #ffffff;">
            <p style="font-size: 15px; margin-top: 0; margin-bottom: 16px; color: #334155; line-height: 1.5;">${message}</p>
            
            <div style="background-color: #f8fafc; padding: 20px; border-radius: 12px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #334155;"><strong>Lugar / Espacio:</strong> ${incident.place || 'N/A'}</p>
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #334155;"><strong>Alumno(s):</strong> ${incident.students || 'N/A'}</p>
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #334155;"><strong>Reportado por:</strong> ${incident.reporterName || incident.creatorName || 'Personal Escolar'}${incident.reporterRole ? ` (${incident.reporterRole === 'ADMIN' ? 'Administrador' : incident.reporterRole === 'DIRECTIVE' ? 'Directivo' : incident.reporterRole === 'COORDINATOR' ? 'Coordinador' : incident.reporterRole === 'TEACHER' ? 'Docente' : incident.reporterRole})` : ''}</p>
              ${(incident.notifiedTeacherName || incident.notifiedTeacherId) ? `<p style="margin: 0 0 10px 0; font-size: 14px; color: #334155;"><strong>Copia a Docente:</strong> ${incident.notifiedTeacherName || 'Docente seleccionado'}</p>` : ''}
              <p style="margin: 0 0 10px 0; font-size: 14px; color: #334155;"><strong>Estatus del Reporte:</strong> <span style="background-color: #e0e7ff; color: #3730a3; padding: 3px 10px; border-radius: 6px; font-weight: 700; font-size: 13px;">${statusLabel}</span></p>
              ${actionDetails ? `<div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #cbd5e1; font-size: 13px; color: #475569;">${actionDetails}</div>` : ''}
            </div>

            <p style="font-size: 13px; color: #64748b; text-align: center; margin: 20px 0 0 0;">Ingresa a la plataforma para consultar el historial de seguimiento y detalles completos.</p>
          </div>
          <div style="background-color: #f1f5f9; padding: 16px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0; font-size: 11px; color: #94a3b8; font-weight: 500;">Mensaje automático del Sistema de Incidencias ${appTitle}.</p>
          </div>
        </div>
      `;

      for (const email of targetEmails) {
        try {
          await sendEmail(email, emailSubject, emailHtml);
        } catch (e) {
          console.error("Error sending email notification to:", email, e);
        }
      }
    }
  };

  const handleSendTestBroadcast = async () => {
    if (!testSubject.trim() || !testBody.trim()) {
      showSystemPopup('Campos requeridos', 'Por favor escribe un asunto y un mensaje para la prueba.', 'info');
      return;
    }
    if (!sendSystemNotifCheck && !sendEmailNotifCheck) {
      showSystemPopup('Selección requerida', 'Debes seleccionar al menos un canal de envío (Notificación en App o Correo).', 'info');
      return;
    }

    setIsSendingTestBroadcast(true);
    setTestBroadcastResult(null);

    try {
      // 1. Get all users from Firestore collection 'users'
      const usersSnapshot = await safeGetDocs(collection(db, 'users'));
      const firestoreUsers = usersSnapshot.docs.map(d => d.data() as UserProfile);

      // Combine with users loaded in memory
      const combinedUsers = [...firestoreUsers, ...admins, ...coordinators, ...teachers, ...psychologists, ...directives];

      // Deduplicate users by clean email and uid
      const userMap = new Map<string, { uid: string; email: string; name: string }>();
      combinedUsers.forEach(u => {
        if (u && u.email) {
          const cleanEmail = u.email.toLowerCase().trim();
          if (!userMap.has(cleanEmail)) {
            userMap.set(cleanEmail, {
              uid: u.uid || cleanEmail,
              email: cleanEmail,
              name: u.name || cleanEmail
            });
          }
        }
      });

      const targetUsers = Array.from(userMap.values());

      if (targetUsers.length === 0) {
        showSystemPopup('Sin usuarios', 'No se encontraron usuarios registrados en el sistema.', 'info');
        setIsSendingTestBroadcast(false);
        return;
      }

      let notifSuccessCount = 0;
      let emailSuccessCount = 0;
      let emailErrorCount = 0;

      // 2. Send System Notification (App Bell)
      if (sendSystemNotifCheck) {
        for (const target of targetUsers) {
          if (target.uid) {
            try {
              await addDoc(collection(db, 'notifications'), {
                title: `[PRUEBA] ${testSubject.trim()}`,
                message: testBody.trim(),
                incidentId: '',
                read: false,
                createdAt: Date.now(),
                userId: target.uid
              });
              notifSuccessCount++;
            } catch (e) {
              console.error("Error creating notification for:", target.uid, e);
            }
          }
        }
      }

      // 3. Send Email
      if (sendEmailNotifCheck) {
        const appTitle = systemSettings.appName || 'DASHBOARD DUNOR';
        const logoHeader = systemSettings.appLogoUrl ? `<img src="${systemSettings.appLogoUrl}" style="max-height: 50px; margin-bottom: 12px; object-fit: contain;" alt="Logo" />` : '';
        const htmlTemplate = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; background-color: #ffffff;">
            <div style="background-color: #4f46e5; padding: 24px; text-align: center;">
              ${logoHeader}
              <h1 style="color: #ffffff; margin: 0; font-size: 22px;">${testSubject.trim()}</h1>
              <p style="color: #c7d2fe; margin: 6px 0 0 0; font-size: 13px;">Mensaje de Prueba y Difusión</p>
            </div>
            <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
              <p style="font-size: 15px; margin-top: 0;">${testBody.trim().replace(/\n/g, '<br/>')}</p>
              <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
              <p style="font-size: 12px; color: #64748b; text-align: center; margin: 0;">
                Este es un mensaje de prueba enviado desde <strong>${appTitle}</strong> a todos los usuarios y correos registrados.
              </p>
            </div>
          </div>
        `;

        for (const target of targetUsers) {
          if (target.email) {
            try {
              const result = await sendEmail(target.email, `[PRUEBA] ${testSubject.trim()}`, htmlTemplate);
              if (result && result.error) {
                emailErrorCount++;
              } else {
                emailSuccessCount++;
              }
            } catch (e) {
              console.error("Error sending email to:", target.email, e);
              emailErrorCount++;
            }
          }
        }
      }

      await addLog(
        'Envío de mensaje de prueba masivo',
        `Asunto: "${testSubject}". Usuarios alcanzados: ${targetUsers.length}. Notificaciones App: ${notifSuccessCount}, Correos procesados: ${emailSuccessCount}`
      );

      const summaryText = `Total de usuarios/correos alcanzados: ${targetUsers.length}\n` +
        `• Notificaciones en la app creadas: ${notifSuccessCount}\n` +
        `• Correos procesados por el servidor: ${emailSuccessCount}` +
        (emailErrorCount > 0 ? ` (${emailErrorCount} sin servidor SMTP activo - también puedes usar la opción "Abrir Cliente de Correo Directo")` : '');

      setTestBroadcastResult(summaryText);
      showSystemPopup('Prueba de envío completada', summaryText, 'success');

    } catch (error) {
      console.error("Error in handleSendTestBroadcast:", error);
      showSystemPopup('Error', "Ocurrió un error al procesar el mensaje de prueba.", 'error');
    } finally {
      setIsSendingTestBroadcast(false);
    }
  };

  const handleOpenMailtoClient = async () => {
    try {
      const usersSnapshot = await safeGetDocs(collection(db, 'users'));
      const firestoreUsers = usersSnapshot.docs.map(d => d.data() as UserProfile);
      const combinedUsers = [...firestoreUsers, ...admins, ...coordinators, ...teachers, ...psychologists, ...directives];
      const emails = Array.from(new Set(combinedUsers.map(u => u.email?.toLowerCase().trim()).filter(Boolean)));

      if (emails.length === 0) {
        showSystemPopup('Sin correos', 'No se encontraron correos registrados en el sistema.', 'info');
        return;
      }

      const bcc = emails.join(',');
      const subject = encodeURIComponent(`[PRUEBA] ${testSubject}`);
      const body = encodeURIComponent(`${testBody}\n\n---\nMensaje de prueba enviado desde ${systemSettings.appName || 'DASHBOARD DUNOR'}`);
      
      window.open(`mailto:?bcc=${bcc}&subject=${subject}&body=${body}`, '_blank');
    } catch (e) {
      console.error("Error opening mailto:", e);
      showSystemPopup('Error', 'Error al recopilar la lista de correos.', 'error');
    }
  };

  const openGallery = (images: string[], index: number) => {
    setGalleryConfig({
      isOpen: true,
      images,
      currentIndex: index,
    });
  };

  const [showInstallPrompt, setShowInstallPrompt] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [systemNotificationPermission, setSystemNotificationPermission] = useState<NotificationPermission>(() => getNotificationPermission());
  const [hideTestedNotificationCard, setHideTestedNotificationCard] = useState<boolean>(() => {
    try {
      return localStorage.getItem('dunor_hide_tested_notification_card') === 'true';
    } catch {
      return false;
    }
  });

  const handleRequestSystemNotifications = async () => {
    const perm = await requestSystemNotificationPermission();
    setSystemNotificationPermission(perm);
    if (perm === 'granted') {
      await sendTestNotification();
      setHideTestedNotificationCard(true);
      try {
        localStorage.setItem('dunor_hide_tested_notification_card', 'true');
      } catch (e) {}
      setLiveToast({
        id: 'notif-perm-granted',
        title: '¡Notificaciones del Sistema Activas!',
        message: 'Aparecerán en la barra de notificaciones de tu celular o en tu PC.',
        timestamp: Date.now()
      });
    } else if (perm === 'denied') {
      setLiveToast({
        id: 'notif-perm-denied',
        title: 'Permiso Denegado',
        message: 'Habilita las notificaciones en la barra de dirección de tu navegador para recibirlas.',
        timestamp: Date.now()
      });
    }
  };

  const handleTestSystemNotification = async () => {
    const ok = await sendTestNotification();
    if (ok) {
      setHideTestedNotificationCard(true);
      try {
        localStorage.setItem('dunor_hide_tested_notification_card', 'true');
      } catch (e) {}
      setLiveToast({
        id: 'notif-test-ok',
        title: 'Prueba Enviada',
        message: 'Revisa la barra de notificaciones de tu celular o la pantalla de tu PC.',
        timestamp: Date.now()
      });
    } else {
      setLiveToast({
        id: 'notif-test-err',
        title: 'Permiso Pendiente',
        message: 'Debes conceder permisos de notificación para recibir avisos.',
        timestamp: Date.now()
      });
    }
  };

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: any) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setShowInstallPrompt(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  useEffect(() => {
    if (activeUser && isNotificationSupported()) {
      setSystemNotificationPermission(getNotificationPermission());
    }
  }, [activeUser]);

  useEffect(() => {
    // PWA Install Prompt Logic
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const isStandalone = (window.navigator as any).standalone || window.matchMedia('(display-mode: standalone)').matches;
    
    if (isMobile && !isStandalone) {
      const hasSeenPrompt = localStorage.getItem('hasSeenInstallPrompt');
      if (!hasSeenPrompt) {
        setShowInstallPrompt(true);
      }
    }

    if (!user || !profile) return;

    // Listen for notifications specifically targeted to current user (by UID, email, role or broadcast)
    let isInitialLoad = true;
    const userUid = profile.uid;
    const userEmail = profile.email ? profile.email.toLowerCase().trim() : '';
    const normRole = normalizeUserRole(profile.role).toLowerCase();
    const rawRole = profile.role ? String(profile.role).toLowerCase().trim() : '';

    const targetIds = Array.from(new Set([userUid, userEmail, normRole, rawRole, 'all', 'ALL'].filter(Boolean)));
    if (targetIds.length === 0) return;

    let q;
    if (isSuperAdmin) {
      q = query(collection(db, 'notifications'), orderBy('createdAt', 'desc'));
    } else if (targetIds.length === 1) {
      q = query(collection(db, 'notifications'), where('userId', '==', targetIds[0]));
    } else {
      q = query(collection(db, 'notifications'), where('userId', 'in', targetIds.slice(0, 30)));
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const rawDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() as any }));

      const checkIsWelcomeOrRegistration = (d: any) => {
        const titleLower = (d.title || '').toLowerCase();
        const msgLower = (d.message || '').toLowerCase();
        return (
          titleLower.includes('bienvenid') ||
          titleLower.includes('nuevo usuario') ||
          titleLower.includes('registro de nuevo usuario') ||
          titleLower.includes('usuario registrado') ||
          titleLower.includes('usuario nuevo') ||
          titleLower.includes('alta de usuario') ||
          msgLower.includes('bienvenid') ||
          msgLower.includes('bienvenido/a a dashboard dunor') ||
          msgLower.includes('tu registro al dashboard dunor fue exitosa') ||
          msgLower.includes('nuevo usuario') ||
          msgLower.includes('usuario registrado') ||
          msgLower.includes('cuenta creada') ||
          (msgLower.includes('dashboard dunor') && (msgLower.includes('registro') || msgLower.includes('bienvenid')))
        );
      };

      const checkIsNotificationRelevant = (d: any): boolean => {
        if (!d) return false;
        if (profile.role === 'BLOQUEADO') return false;
        if (checkIsWelcomeOrRegistration(d)) return false;

        const role = normalizeUserRole(profile.role);
        const roleStr = String(role);
        const uid = (profile.uid || '').toLowerCase().trim();
        const email = (userEmail || '').toLowerCase().trim();
        const targetId = (d.userId || '').toLowerCase().trim();
        const isDirectTarget = targetId === uid || targetId === email;
        const titleLower = (d.title || '').toLowerCase();
        const msgLower = (d.message || '').toLowerCase();

        // 0. EXCLUSIÓN DE CREACIÓN PARA EL CREADOR (Incidencias, Canalizaciones, Expedientes, Tareas o Felicitaciones)
        // El usuario que crea el registro NUNCA debe recibir la notificación de creación en la barra, audio ni lista.
        const isCreatorDirect =
          (d.creatorUid && String(d.creatorUid).toLowerCase().trim() === uid) ||
          (d.creatorEmail && String(d.creatorEmail).toLowerCase().trim() === email) ||
          (d.excludeUserId && String(d.excludeUserId).toLowerCase().trim() === uid) ||
          (d.excludeUserEmail && String(d.excludeUserEmail).toLowerCase().trim() === email);

        if (isCreatorDirect) {
          return false;
        }

        // 0.1 CHAT SECRETO ENTRE DOCENTES
        // Únicamente relevante para el docente destinatario directo (no administradores, no directores, no coordinadores)
        if (d.type === 'teacher_chat' || titleLower.includes('💬 mensaje de')) {
          return Boolean(isDirectTarget && role === 'TEACHER');
        }

        // Descartar confirmaciones personales de creación
        if (
          titleLower.includes('reporte registrado exitosamente') ||
          titleLower.includes('confirmación de reporte') ||
          msgLower.includes('has creado y enviado el reporte')
        ) {
          return false;
        }

        // Si es una notificación de creación, verificar que el usuario actual no sea el autor del registro
        const isCreationType = 
          d.isCreationNotification ||
          titleLower.includes('nueva incidencia') ||
          titleLower.includes('nuevo reporte') ||
          titleLower.includes('reporte registrado') ||
          titleLower.includes('nueva canalización') ||
          titleLower.includes('nueva canalizacion') ||
          titleLower.includes('nuevo expediente') ||
          titleLower.includes('nueva tarea') ||
          titleLower.includes('felicitac') ||
          titleLower.includes('reconocimiento') ||
          titleLower.includes('sugerencia de canaliz');

        if (isCreationType) {
          // Incidencias
          if (d.incidentId) {
            const inc = incidents.find(i => i.id === d.incidentId);
            if (inc) {
              const isReporter = (inc.reporterId && inc.reporterId.toLowerCase().trim() === uid) ||
                                (inc.reporterEmail && inc.reporterEmail.toLowerCase().trim() === email);
              if (isReporter) return false;
            }
          }

          // Canalizaciones
          if (d.referralId || d.type === 'referral') {
            const ref = referrals.find(r => r.id === d.referralId);
            if (ref) {
              const isRefCreator = (ref.teacherId && ref.teacherId.toLowerCase().trim() === uid) ||
                                  (ref.teacherEmail && ref.teacherEmail.toLowerCase().trim() === email) ||
                                  (ref.createdByEmail && ref.createdByEmail.toLowerCase().trim() === email);
              if (isRefCreator) return false;
            }
          }

          // Tareas y Felicitaciones
          if (d.taskId || d.type === 'task' || d.type === 'felicitacion') {
            const task = tasks.find(t => t.id === d.taskId);
            if (task) {
              const isTaskCreator = task.createdByEmail && task.createdByEmail.toLowerCase().trim() === email;
              if (isTaskCreator) return false;
            }
          }
        }

        if (isSuperAdmin) return true;

        // 1. DIRECTIVOS Y ADMINISTRADORES: Por default les llegan todas las notificaciones
        if (role === 'DIRECTIVE' || role === 'ADMIN' || isSuperAdmin) {
          return true;
        }

        // 2. COORDINADORES: ÚNICAMENTE si son el coordinador asignado al reporte o al docente que levantó el reporte
        if (role === 'COORDINATOR') {
          // Incidencias
          if (d.incidentId) {
            const inc = incidents.find(i => i.id === d.incidentId);
            if (inc) {
              const isAssignedToIncident = 
                inc.coordinatorId === uid ||
                (inc.coordinatorIds && inc.coordinatorIds.includes(uid)) ||
                (inc.coordinatorEmail && inc.coordinatorEmail.toLowerCase() === email);
              if (isAssignedToIncident) return true;

              const reportingTeacher = teachers.find(t => 
                (inc.reporterId && t.uid === inc.reporterId) || 
                (inc.reporterEmail && t.email?.toLowerCase() === inc.reporterEmail.toLowerCase())
              );
              if (reportingTeacher) {
                const isAssignedToTeacher = 
                  reportingTeacher.assignedCoordinatorId === uid ||
                  (reportingTeacher.assignedCoordinatorEmail && reportingTeacher.assignedCoordinatorEmail.toLowerCase() === email) ||
                  (reportingTeacher.assignedCoordinatorName && profile.name && reportingTeacher.assignedCoordinatorName.toLowerCase() === profile.name.toLowerCase());
                if (isAssignedToTeacher) return true;
              }

              // No asignado a esta incidencia ni al docente: no mostrar en barra ni lista
              return false;
            }
            return isDirectTarget;
          }

          // Canalizaciones
          if (d.referralId || d.type === 'referral' || titleLower.includes('canaliz') || titleLower.includes('psicol')) {
            const ref = referrals.find(r => r.id === d.referralId);
            if (ref) {
              const isAssignedToRef = 
                ref.coordinatorId === uid ||
                (ref.coordinatorEmail && ref.coordinatorEmail.toLowerCase() === email);
              if (isAssignedToRef) return true;

              const refTeacher = teachers.find(t =>
                (ref.teacherId && t.uid === ref.teacherId) ||
                (ref.teacherEmail && t.email?.toLowerCase() === ref.teacherEmail.toLowerCase()) ||
                (ref.createdByEmail && t.email?.toLowerCase() === ref.createdByEmail.toLowerCase())
              );
              if (refTeacher) {
                const isAssignedToTeacher = 
                  refTeacher.assignedCoordinatorId === uid ||
                  (refTeacher.assignedCoordinatorEmail && refTeacher.assignedCoordinatorEmail.toLowerCase() === email) ||
                  (refTeacher.assignedCoordinatorName && profile.name && refTeacher.assignedCoordinatorName.toLowerCase() === profile.name.toLowerCase());
                if (isAssignedToTeacher) return true;
              }

              const inRecipients = ref.additionalRecipients?.some(r => r.uid === uid || r.email?.toLowerCase() === email);
              if (inRecipients) return true;

              return false;
            }
            return isDirectTarget;
          }

          // Tareas
          if (d.taskId || d.type === 'task' || titleLower.includes('tarea')) {
            const task = tasks.find(t => t.id === d.taskId);
            if (task) {
              return task.assignedToEmail?.toLowerCase() === email || isDirectTarget;
            }
            return isDirectTarget;
          }

          return isDirectTarget;
        }

        // 3. DOCENTES: Solo sus reportes o en copia
        if (role === 'TEACHER') {
          if (d.incidentId) {
            const inc = incidents.find(i => i.id === d.incidentId);
            if (inc) {
              const isReporter = inc.reporterId === uid || (inc.reporterEmail && inc.reporterEmail.toLowerCase() === email);
              const isNotified = inc.notifiedTeacherId === uid || (inc.notifiedTeacherEmail && inc.notifiedTeacherEmail.toLowerCase() === email);
              return Boolean(isReporter || isNotified);
            }
            return isDirectTarget;
          }

          if (d.referralId || d.type === 'referral' || titleLower.includes('canaliz') || titleLower.includes('psicol')) {
            const ref = referrals.find(r => r.id === d.referralId);
            if (ref) {
              const isCreator = ref.createdByEmail?.toLowerCase() === email || ref.referredByName === profile.name;
              const isRecipient = ref.additionalRecipients?.some(r => r.uid === uid || r.email?.toLowerCase() === email);
              return Boolean(isCreator || isRecipient || isDirectTarget);
            }
            return isDirectTarget;
          }

          if (d.taskId || d.type === 'task' || d.type === 'felicitacion' || titleLower.includes('tarea') || titleLower.includes('felicitaci')) {
            const task = tasks.find(t => t.id === d.taskId);
            if (task) {
              const isAssigned = task.assignedToEmail?.toLowerCase() === email;
              return Boolean(isAssigned || isDirectTarget);
            }
            return isDirectTarget;
          }

          return isDirectTarget;
        }

        // 4. PSICÓLOGOS
        if (role === 'PSYCHOLOGIST') {
          const isPsychRelated = d.type === 'referral' || d.referralId || titleLower.includes('canaliz') || titleLower.includes('psicol');
          if (d.incidentId) {
            const inc = incidents.find(i => i.id === d.incidentId);
            if (inc) {
              const isReporter = inc.reporterId === uid || (inc.reporterEmail && inc.reporterEmail.toLowerCase() === email);
              const hasReferral = inc.referralStatus === 'SUGGESTED' || inc.referralStatus === 'IN_PROGRESS' || (inc as any).psychologistId === uid;
              return Boolean(isReporter || hasReferral || isPsychRelated);
            }
            return Boolean(isPsychRelated || (isDirectTarget && isPsychRelated));
          }
          if (isPsychRelated) return true;
          if (titleLower.includes('expediente') || titleLower.includes('informe')) return true;
          return isDirectTarget;
        }

        // 4. Expedientes & Informes
        if (titleLower.includes('expediente') || titleLower.includes('informe')) {
          if (roleStr === 'PSYCHOLOGIST' || roleStr === 'DIRECTIVE' || roleStr === 'ADMIN') return true;
          return isDirectTarget;
        }

        // Default: targeted directly or by role
        if (isDirectTarget) return true;
        if (profile.role && targetId === String(profile.role).toLowerCase()) return true;

        return false;
      };

      // Clean deduplication and strictly exclude welcome, new user registration, and non-competent notifications
      const uniqueMap = new Map<string, any>();
      for (const d of rawDocs) {
        if (!d.id) continue;
        if (!checkIsNotificationRelevant(d)) continue;

        const eventKey = isSuperAdmin
          ? (d.eventId || `${d.title || ''}_${d.message || ''}_${d.incidentId || ''}_${Math.floor((d.createdAt || 0) / 10000)}`)
          : d.id;
        if (!uniqueMap.has(eventKey)) {
          uniqueMap.set(eventKey, d);
        }
      }

      const finalDocs = Array.from(uniqueMap.values());
      finalDocs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      snapshot.docChanges().forEach((change) => {
        if (change.type === "added") {
          const data = change.doc.data();
          // Trigger instant real-time audio and visual alert ONLY for relevant unread notifications
          if (!isInitialLoad && !data.read && checkIsNotificationRelevant({ id: change.doc.id, ...data })) {
            playNotificationSound();

            setLiveToast({
              id: change.doc.id,
              title: data.title || 'Nueva Notificación',
              message: data.message || 'Tienes un nuevo aviso en la plataforma.',
              timestamp: Date.now(),
              incidentId: data.incidentId,
              referralId: data.referralId,
              taskId: data.taskId,
              type: data.type,
              chatPartnerUid: data.chatPartnerUid,
              chatPartnerEmail: data.chatPartnerEmail
            });

            showSystemNotification(data.title || 'Aviso - DUNOR', {
              body: data.message || 'Tienes una nueva notificación en el sistema DUNOR.',
              icon: '/logo_dunor.png',
              badge: '/logo_dunor.png',
              tag: change.doc.id,
              data: {
                incidentId: data.incidentId,
                referralId: data.referralId,
                taskId: data.taskId,
                type: data.type,
                chatPartnerUid: data.chatPartnerUid,
                chatPartnerEmail: data.chatPartnerEmail
              }
            }).catch((e) => {
              console.warn('Native system notification delivery error:', e);
            });
          }
        }
      });

      isInitialLoad = false;
      setNotifications(finalDocs);
    }, (error) => {
      console.warn("Notifications listener notice:", error);
    });

    return () => unsubscribe();
  }, [user, profile, isSuperAdmin, incidents, referrals, tasks, teachers, coordinators]);

  useEffect(() => {
    if (!activeUser || !profile) return;
    const qTasks = query(collection(db, 'tasks'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(qTasks, (snapshot) => {
      const allDocs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task));
      if (profile.role === 'DIRECTIVE' || profile.role === 'ADMIN' || profile.role === 'COORDINATOR' || isSuperAdmin) {
        setTasks(allDocs);
      } else {
        const myEmailLower = profile.email?.toLowerCase();
        const myUid = profile.uid;
        const userTasks = allDocs.filter(t => 
          (t.assignedToEmail && t.assignedToEmail.toLowerCase() === myEmailLower) || 
          (t.createdByEmail && t.createdByEmail.toLowerCase() === myEmailLower) ||
          (myUid && (t.assignedToEmail === myUid || t.createdByEmail === myUid))
        );
        setTasks(userTasks);
      }
    }, (error) => {
      console.warn("Tasks listener notice:", error);
    });
    return () => unsubscribe();
  }, [activeUser, profile, isSuperAdmin]);

  // REQUISITO 1: Si una tarea ya está en estatus de realizada y se llega la fecha límite, pasa en automático a completada
  useEffect(() => {
    if (!activeUser || !profile || !tasks || tasks.length === 0) return;
    const todayStr = format(new Date(), 'yyyy-MM-dd');

    tasks.forEach(async (task) => {
      if (task.status === 'REALIZADA' && task.dueDate && todayStr >= task.dueDate) {
        try {
          await updateDoc(doc(db, 'tasks', task.id), {
            status: 'COMPLETADA',
            completedAt: Date.now(),
            autoCompleted: true,
            autoCompletedReason: 'Fecha límite alcanzada en estatus REALIZADA'
          });

          await addLog(
            'Tarea Completada Automáticamente por Fecha Límite',
            `La tarea "${task.title}" (asignada a: ${task.assignedToName}) estaba en estatus REALIZADA y al llegar su fecha límite (${task.dueDate}) pasó automáticamente a COMPLETADA.`,
            { module: 'Tareas / Felicitaciones', recordId: task.id }
          );

          if (task.assignedToEmail) {
            await sendNotification(
              task.assignedToEmail,
              `✅ Tarea Completada Automáticamente: ${task.title}`,
              `Tu tarea "${task.title}" estaba en estatus REALIZADA y al cumplirse su fecha límite (${task.dueDate}) ha pasado en automático a COMPLETADA.`
            );
          }
        } catch (e) {
          console.warn('Notice updating realizada task to completed on deadline:', e);
        }
      }
    });
  }, [tasks, activeUser, profile]);

  useEffect(() => {
    if (!activeUser || !profile) return;
    const qReferrals = query(collection(db, 'referrals'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(qReferrals, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Referral));
      setReferrals(docs);
    }, (error) => {
      console.warn("Referrals listener notice:", error);
    });
    return () => unsubscribe();
  }, [activeUser, profile]);

  useEffect(() => {
    if (!activeUser || !profile) return;
    const qExpedientes = query(collection(db, 'expedientes'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(qExpedientes, (snapshot) => {
      const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Expediente));
      setExpedientes(docs);
    }, (error) => {
      console.warn("Expedientes listener notice:", error);
    });
    return () => unsubscribe();
  }, [activeUser, profile]);

  const markNotificationAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `notifications/${id}`);
    }
  };

  const markAllNotificationsAsRead = async () => {
    try {
      if (notifications.length === 0) return;
      const batch = writeBatch(db);
      notifications.forEach(n => {
        batch.delete(doc(db, 'notifications', n.id));
      });
      await batch.commit();
      setNotifications([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'notifications/markAllRead');
    }
  };

  useEffect(() => {
    // Ensure jorge.villanueva@boletomovil.com is removed from Firestore
    deleteDoc(doc(db, 'users', 'jorge.villanueva@boletomovil.com')).catch(() => {});
  }, []);

  useEffect(() => {
    if (profile || isSuperAdmin) {
      const q = query(collection(db, 'users'), where('role', '==', 'ADMIN'), limit(100));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const users = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() } as UserProfile));
        const uniqueUsers = Array.from(new Map(users.map(u => [u.email, u])).values())
          .filter(u => u.email?.toLowerCase().trim() !== 'jorge.villanueva@boletomovil.com');
        setAdmins(uniqueUsers);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users (admins)');
      });
      return () => unsubscribe();
    }
  }, [profile, isSuperAdmin]);



  const activeUserEmailStr = (activeUser?.email || (activeUser ? localStorage.getItem('last_user_email') : null) || '').toLowerCase().trim();
  const activeUserUidStr = activeUser?.uid || '';

  useEffect(() => {
    if (activeUser && activeUserEmailStr) {
      const emailId = activeUserEmailStr;
      let isMounted = true;

      // Only display the full-screen loading spinner if we don't already have this user's profile cached in memory or localStorage
      const hasCachedProfileInMemory = profile && (
        profile.email?.toLowerCase().trim() === emailId || 
        profile.uid === activeUserUidStr
      );

      if (!hasCachedProfileInMemory) {
        try {
          const saved = localStorage.getItem('app_user_profile');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && (parsed.email?.toLowerCase().trim() === emailId || parsed.uid === activeUserUidStr)) {
              setProfile(parsed);
              setIsProfileLoading(false);
              setHasCheckedProfile(true);
            } else {
              setIsProfileLoading(true);
              setHasCheckedProfile(false);
            }
          } else {
            setIsProfileLoading(true);
            setHasCheckedProfile(false);
          }
        } catch {
          setIsProfileLoading(true);
          setHasCheckedProfile(false);
        }
      }

      const fallbackTimer = setTimeout(() => {
        if (isMounted) {
          console.warn(`Profile load fallback timeout triggered for ${emailId}`);
          try {
            const saved = localStorage.getItem('app_user_profile');
            if (saved) {
              const parsed = JSON.parse(saved);
              if (parsed && (parsed.email?.toLowerCase().trim() === emailId || parsed.uid === activeUserUidStr)) {
                setProfile(parsed);
                setIsProfileLoading(false);
                setHasCheckedProfile(true);
                return;
              }
            }
          } catch (e) {}

          if (isSuperAdminEmail(emailId)) {
            const fallbackAdmin: UserProfile = {
              uid: activeUserUidStr || emailId,
              name: emailId.includes('dunor') ? "Administrador DUNOR" : "Super Admin (Yorch)",
              email: emailId,
              role: "ADMIN",
              isRegistered: true
            };
            setProfile(fallbackAdmin);
            try { localStorage.setItem('app_user_profile', JSON.stringify(fallbackAdmin)); } catch (e) {}
          }
          setIsProfileLoading(false);
          setHasCheckedProfile(true);
        }
      }, 1200);

      const unsubscribe = onSnapshot(doc(db, 'users', emailId), async (snapshot) => {
        clearTimeout(fallbackTimer);
        if (!isMounted) return;
        if (snapshot.exists()) {
          const data = snapshot.data() as UserProfile;
          if (data.role === 'BLOQUEADO' || (data as any).status === 'BLOQUEADO' || (data as any).isBlocked) {
            localStorage.setItem('blocked_account_notice', "Cuenta bloqueada contacta a Soporte Técnico");
            handleLogout();
            return;
          }
          if (activeUserUidStr && data.uid !== activeUserUidStr) {
            try {
              updateDoc(doc(db, 'users', emailId), { uid: activeUserUidStr }).catch(e => console.error("Error updating UID:", e));
            } catch (e) {
              console.error("Error updating UID:", e);
            }
          }
          const profileWithUid = { ...data, uid: activeUserUidStr || data.uid || emailId };
          try {
            localStorage.setItem('app_user_profile', JSON.stringify(profileWithUid));
          } catch (e) {}
          setProfile(prev => {
            if (prev && 
                prev.uid === profileWithUid.uid && 
                prev.email === profileWithUid.email && 
                prev.role === profileWithUid.role && 
                prev.name === profileWithUid.name &&
                JSON.stringify(prev.customPermissions || {}) === JSON.stringify(profileWithUid.customPermissions || {})) {
              return prev;
            }
            return profileWithUid;
          });
        } else {
          // If doc by emailId doesn't exist, check by query or check if super admin
          const isSuper = isSuperAdminEmail(emailId);
          if (isSuper) {
            const adminName = emailId.includes('dunor') ? "Administrador DUNOR" : (emailId === 'mi_yorch@hotmail.com' ? "Super Admin (Yorch)" : "Administrador Inicial");
            const autoProfile: UserProfile = {
              uid: activeUserUidStr || emailId,
              name: adminName,
              email: emailId,
              role: "ADMIN",
              isRegistered: true,
              updatedAt: Date.now()
            };
            try {
              await setDoc(doc(db, 'users', emailId), autoProfile, { merge: true });
              localStorage.setItem('app_user_profile', JSON.stringify(autoProfile));
            } catch (createErr) {
              console.error("Auto-creation of super admin user document failed:", createErr);
            }
            if (isMounted) setProfile(autoProfile);
          } else {
            // Check if user is registered with UID or case-insensitive query
            try {
              const queryByUid = await safeGetDocs(query(collection(db, 'users'), where('uid', '==', activeUserUidStr))).catch(() => null);
              if (queryByUid && !queryByUid.empty) {
                const foundData = queryByUid.docs[0].data() as UserProfile;
                const pData = { ...foundData, uid: activeUserUidStr };
                try { localStorage.setItem('app_user_profile', JSON.stringify(pData)); } catch (e) {}
                if (isMounted) setProfile(pData);
              } else {
                console.warn(`User ${emailId} is not registered in the database. Access denied.`);
                if (isMounted) {
                  const saved = localStorage.getItem('app_user_profile');
                  if (!saved) setProfile(null);
                }
              }
            } catch (qErr) {
              console.warn("Error checking secondary query for profile:", qErr);
            }
          }
        }
        if (isMounted) {
          setIsProfileLoading(false);
          setHasCheckedProfile(true);
        }
      }, (error) => {
        clearTimeout(fallbackTimer);
        if (!isMounted) return;
        console.warn(`Error loading profile for ${emailId}:`, error);
        try {
          const saved = localStorage.getItem('app_user_profile');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && (parsed.email?.toLowerCase().trim() === emailId || parsed.uid === activeUserUidStr)) {
              setProfile(parsed);
              setIsProfileLoading(false);
              setHasCheckedProfile(true);
              return;
            }
          }
        } catch (e) {}

        const isSuper = isSuperAdminEmail(emailId);
        if (isSuper) {
          const fallbackProfile: UserProfile = {
            uid: activeUserUidStr || emailId,
            name: emailId.includes('dunor') ? "Administrador DUNOR" : "Administrador",
            email: emailId,
            role: "ADMIN",
            isRegistered: true
          };
          setProfile(fallbackProfile);
        }
        setIsProfileLoading(false);
        setHasCheckedProfile(true);
      });
      return () => {
        isMounted = false;
        clearTimeout(fallbackTimer);
        unsubscribe();
      };
    } else if (!activeUser) {
      setProfile(null);
      setIsProfileLoading(false);
      setHasCheckedProfile(true);
    }
  }, [activeUserEmailStr, activeUserUidStr]);

  useEffect(() => {
    if (!profile) return;

    const normRole = normalizeUserRole(profile.role);
    const userEmail = (profile.email || '').toLowerCase().trim();
    const userUid = profile.uid;

    const q = query(collection(db, 'incidents'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      let docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Incident));
      
      docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      // 1. Directives, Admins, SuperAdmin: Full access to all incidents
      if (isSuperAdmin || isSuperAdminEmail(userEmail) || normRole === 'ADMIN' || normRole === 'DIRECTIVE') {
        setIncidents(docs);
        return;
      }

      // 2. Coordinators: only incidents assigned to them (or in coordinatorIds) and not soft-deleted
      if (normRole === 'COORDINATOR') {
        docs = docs.filter(doc => {
          if (doc.deletedByCoordinators?.includes(userUid)) return false;
          const isAssigned = 
            doc.coordinatorId === userUid || 
            (doc.coordinatorIds && doc.coordinatorIds.includes(userUid)) ||
            (doc.coordinatorEmail && doc.coordinatorEmail.toLowerCase() === userEmail);
          return Boolean(isAssigned);
        });
        setIncidents(docs);
        return;
      }

      // 3. Psychologists: incidents with suggestReferral or where they are directly involved
      if (normRole === 'PSYCHOLOGIST') {
        docs = docs.filter(doc => Boolean(
          doc.suggestReferral ||
          doc.reporterId === userUid ||
          (doc.reporterEmail && doc.reporterEmail.toLowerCase() === userEmail) ||
          doc.notifiedTeacherId === userUid ||
          (doc.notifiedTeacherEmail && doc.notifiedTeacherEmail.toLowerCase() === userEmail)
        ));
        setIncidents(docs);
        return;
      }

      // 4. TEACHERS (Docentes) - STRICT ACCESS CONTROL (User Request):
      // "Cuando un docente registre una incidencia, esta solo deberá ser visible para el docente que la registro, el coordinador asignado, el directivo y el administrador... ningún otro docente debe de poder visualizar los registros de otro docente, a menos que este como copia a docente"
      docs = docs.filter(doc => {
        const isAuthor = 
          (doc.reporterId && doc.reporterId === userUid) ||
          (doc.reporterEmail && doc.reporterEmail.toLowerCase() === userEmail);

        const isCopied = 
          (doc.notifiedTeacherId && doc.notifiedTeacherId === userUid) ||
          (doc.notifiedTeacherEmail && doc.notifiedTeacherEmail.toLowerCase() === userEmail) ||
          (doc.coordinatorIds && doc.coordinatorIds.includes(userUid));

        return Boolean(isAuthor || isCopied);
      });

      setIncidents(docs);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'incidents');
    });

    return () => unsubscribe();
  }, [profile]);

  useEffect(() => {
    if (profile?.role === 'COORDINATOR' || profile?.role === 'TEACHER' || profile?.role === 'ADMIN' || profile?.role === 'DIRECTIVE' || profile?.role === 'PSYCHOLOGIST' || isSuperAdmin) {
      const q = query(collection(db, 'users'), where('role', '==', 'COORDINATOR'), limit(100));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const users = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() } as UserProfile));
        // Deduplicate by email (since uid might be missing for pre-registered)
        const uniqueUsers = Array.from(new Map(users.map(u => [u.email, u])).values())
          .filter(u => u.email?.toLowerCase().trim() !== 'jorge.villanueva@boletomovil.com');
        setCoordinators(uniqueUsers);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users (coordinators)');
      });
      return () => unsubscribe();
    }
  }, [profile, isSuperAdmin]);

  useEffect(() => {
    if (profile?.role === 'ADMIN' || profile?.role === 'TEACHER' || profile?.role === 'DIRECTIVE' || profile?.role === 'COORDINATOR' || profile?.role === 'PSYCHOLOGIST' || isSuperAdmin) {
      const q = query(collection(db, 'users'), where('role', '==', 'TEACHER'), limit(100));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const users = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() } as UserProfile));
        const uniqueUsers = Array.from(new Map(users.map(u => [u.email, u])).values())
          .filter(u => u.email?.toLowerCase().trim() !== 'jorge.villanueva@boletomovil.com');
        setTeachers(uniqueUsers);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users (teachers)');
      });
      return () => unsubscribe();
    }
  }, [profile, isSuperAdmin]);

  useEffect(() => {
    if (profile?.role === 'ADMIN' || profile?.role === 'TEACHER' || profile?.role === 'COORDINATOR' || profile?.role === 'PSYCHOLOGIST' || profile?.role === 'DIRECTIVE' || isSuperAdmin) {
      const q = query(collection(db, 'users'), where('role', '==', 'PSYCHOLOGIST'), limit(100));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const users = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() } as UserProfile));
        const uniqueUsers = Array.from(new Map(users.map(u => [u.email, u])).values())
          .filter(u => u.email?.toLowerCase().trim() !== 'jorge.villanueva@boletomovil.com');
        setPsychologists(uniqueUsers);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users (psychologists)');
      });
      return () => unsubscribe();
    }
  }, [profile, isSuperAdmin]);

  useEffect(() => {
    if (profile?.role === 'ADMIN' || profile?.role === 'COORDINATOR' || profile?.role === 'DIRECTIVE' || profile?.role === 'TEACHER' || profile?.role === 'PSYCHOLOGIST' || isSuperAdmin) {
      const q = query(collection(db, 'users'), where('role', '==', 'DIRECTIVE'), limit(100));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const users = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() } as UserProfile));
        const uniqueUsers = Array.from(new Map(users.map(u => [u.email, u])).values())
          .filter(u => u.email?.toLowerCase().trim() !== 'jorge.villanueva@boletomovil.com');
        setDirectives(uniqueUsers);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users (directives)');
      });
      return () => unsubscribe();
    }
  }, [profile, isSuperAdmin]);

  useEffect(() => {
    if (profile && (profile.role === 'BLOQUEADO' || (profile as any).status === 'BLOQUEADO' || (profile as any).isBlocked)) {
      localStorage.setItem('blocked_account_notice', "Cuenta bloqueada contacta a Soporte Técnico");
      handleLogout();
    }
  }, [profile]);

  useEffect(() => {
    if (profile?.role === 'ADMIN' || isSuperAdmin) {
      const q = query(collection(db, 'users'), where('role', '==', 'BLOQUEADO'), limit(100));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const users = snapshot.docs.map(doc => ({ docId: doc.id, ...doc.data() } as UserProfile));
        const uniqueUsers = Array.from(new Map(users.map(u => [u.email, u])).values());
        setBlockedUsers(uniqueUsers);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, 'users (bloqueados)');
      });
      return () => unsubscribe();
    }
  }, [profile, isSuperAdmin]);

  useEffect(() => {
    if (activeUser && isSuperAdminEmail(activeUser.email) && !profile && !isProfileLoading) {
      const restoreAdmin = async () => {
        try {
          const emailId = activeUser.email!.toLowerCase().trim();
          await setDoc(doc(db, 'users', emailId), {
            uid: activeUser.uid,
            name: activeUser.displayName || "Administrador",
            email: activeUser.email!,
            role: "ADMIN",
            isRegistered: true,
            updatedAt: Date.now()
          }, { merge: true });
        } catch (e) {
          console.warn("Notice: restoreAdmin operation warning:", e);
        }
      };
      restoreAdmin();
    }
  }, [activeUser, profile, isProfileLoading]);

  useEffect(() => {
    // Auto initialize empty database
    const autoInitializeDb = async () => {
      try {
        await restoreFirestoreConnection();
        const settingsSnap = await safeGetDoc(doc(db, 'settings', 'global')).catch(() => null);
        if (settingsSnap && !settingsSnap.exists()) {
          console.log("Inicializando colecciones iniciales en la base de datos Firestore...");
          await seedDatabaseDataSilent().catch(() => {});
        }
      } catch (err: any) {
        console.warn("Auto-seed check notice:", err?.message || err);
      }
    };
    autoInitializeDb();
  }, []);

  const handleLogout = async () => {
    setIsLoggingOut(true);
    localStorage.removeItem('app_custom_user');
    localStorage.removeItem('last_user_email');
    localStorage.removeItem('app_user_profile');
    setCustomUser(null);
    setProfile(null);
    setIsProfileLoading(false);
    setHasCheckedProfile(false);
    setIncidents([]);
    setTasks([]);
    setReferrals([]);
    setExpedientes([]);
    setNotifications([]);
    setAdmins([]);
    setCoordinators([]);
    setTeachers([]);
    setPsychologists([]);
    setDirectives([]);
    setBlockedUsers([]);
    try {
      if (auth.currentUser) {
        await signOut(auth).catch((e) => {
          console.warn("signOut handled notice:", e?.message || e);
        });
      }
    } catch (e: any) {
      console.warn("Logout notice:", e?.message || e);
    } finally {
      setIsLoggingOut(false);
    }
  };

  // If we already have a loaded profile, do not block the user with a full-screen loader
  const shouldShowLoading = loading || (!profile && (isProfileLoading || (activeUser && !hasCheckedProfile)));

  if (shouldShowLoading) {
    return <LoadingScreen />;
  }
  
  if (!activeUser) {
    return (
      <ErrorBoundary>
        <LoginScreen
          systemSettings={effectiveSystemSettings}
          onCustomLogin={(uData, fullProfile) => {
            setIsLoggingOut(false);
            localStorage.setItem('app_custom_user', JSON.stringify(uData));
            setCustomUser(uData);
            if (fullProfile) {
              localStorage.setItem('app_user_profile', JSON.stringify(fullProfile));
              setProfile(fullProfile);
              setHasCheckedProfile(true);
              setIsProfileLoading(false);
            } else {
              try {
                const saved = localStorage.getItem('app_user_profile');
                if (saved) {
                  const parsed = JSON.parse(saved);
                  if (parsed && (parsed.email === uData.email || parsed.uid === uData.uid)) {
                    setProfile(parsed);
                    setHasCheckedProfile(true);
                    setIsProfileLoading(false);
                    return;
                  }
                }
              } catch (e) {}
              setIsProfileLoading(true);
              setHasCheckedProfile(false);
            }
          }}
        />
      </ErrorBoundary>
    );
  }
  
  if (!profile) return (
    <ErrorBoundary>
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-4">
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl p-8 text-center">
          <AlertCircle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Acceso No Autorizado</h2>
          <p className="text-slate-600 mb-3">Tu correo no está registrado en el sistema o no tienes un perfil asignado. Contacta a tu administrador.</p>
          {activeUser?.email && (
            <div className="bg-slate-100 rounded-xl p-2.5 mb-6 text-xs text-slate-600 font-mono break-all">
              {activeUser.email}
            </div>
          )}
          <div className="flex flex-col gap-2.5">
            <button
              onClick={() => {
                setIsProfileLoading(true);
                setHasCheckedProfile(false);
              }}
              className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-all cursor-pointer shadow-md"
            >
              Reintentar acceso
            </button>
            <button
              onClick={() => handleLogout()}
              className="w-full bg-slate-100 text-slate-700 font-bold py-2.5 rounded-xl hover:bg-slate-200 transition-all cursor-pointer"
            >
              Cerrar sesión
            </button>
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );

  const markAsReceived = async (incidentId: string) => {
    if (profile.role !== 'COORDINATOR' && !isSuperAdmin) return;
    try {
      const incident = incidents.find(i => i.id === incidentId);
      if (!incident) return;

      const updates: any = { isReceived: true };
      let updatedStatus = incident.status;
      
      // Only set status to RECIBIDO if it's currently PENDIENTE
      if (incident.status === 'PENDIENTE' || !incident.status) {
        updates.status = 'RECIBIDO';
        updatedStatus = 'RECIBIDO';
      }
      
      // Only set readAt and receivedByName if not already set
      if (!incident.readAt) {
        updates.readAt = Date.now();
        updates.receivedByName = profile.name;
      }

      await updateDoc(doc(db, 'incidents', incidentId), updates);

      if (updatedStatus === 'RECIBIDO' && incident.status !== 'RECIBIDO') {
        await addLog(
          'Recibió reporte de incidencia',
          `Recibido por: ${profile.name} (${profile.role} - ${profile.email}) | Incidencia: ${incident.place} | Alumno(s): ${incident.students} | Reportado originalmente por: ${incident.reporterName}`,
          { module: 'Incidencias', recordId: incidentId }
        );

        await notifyIncidentInvolvedUsers({
          incident: { ...incident, status: 'RECIBIDO' },
          title: 'Reporte Recibido por Coordinación',
          message: `El reporte en "${incident.place}" ha sido recibido y tomado en conocimiento por ${profile.name}.`,
          emailSubject: `Reporte Recibido - ${incident.place}`,
          emailHeaderTitle: 'Reporte de Incidencia Recibido',
          actionDetails: `Confirmado por <strong>${profile.name}</strong> (Coordinación)`,
          excludeUserId: profile.uid
        });
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `incidents/${incidentId}`);
    }
  };

  const updateIncidentStatus = async (incident: Incident, status: IncidentStatus) => {
    if (!can('canChangeStatus') && profile.role !== 'COORDINATOR' && !isSuperAdmin) return;
    try {
      await updateDoc(doc(db, 'incidents', incident.id), { status });
      await addLog(
        'Actualizó estatus de incidencia',
        `Modificado por: ${profile.name} (${profile.role} - ${profile.email}) | Nuevo estatus: ${status} | Incidencia: ${incident.place} | Alumno(s): ${incident.students} | Creador del reporte: ${incident.reporterName}`,
        { module: 'Incidencias', recordId: incident.id }
      );

      const statusLabels: Record<IncidentStatus, string> = {
        PENDIENTE: 'Pendiente',
        RECIBIDO: 'Recibido',
        EN_SEGUIMIENTO: 'En Seguimiento',
        CERRADO: 'Cerrado'
      };
      const label = statusLabels[status] || status;

      await notifyIncidentInvolvedUsers({
        incident: { ...incident, status },
        title: `Estatus Actualizado: ${label}`,
        message: `${profile.name} ha cambiado el estatus del reporte en "${incident.place}" a "${label}".`,
        emailSubject: `Actualización de Estatus (${label}) - ${incident.place}`,
        emailHeaderTitle: 'Cambio de Estatus de Incidencia',
        actionDetails: `Nuevo Estatus: <strong>${label}</strong> | Modificado por <strong>${profile.name}</strong> (${profile.role === 'COORDINATOR' ? 'Coordinación' : 'Administrador'})`,
        excludeUserId: profile.uid
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `incidents/${incident.id}`);
    }
  };

  const updateIncidentReferralStatus = async (incident: Incident, referralStatus: 'SUGGESTED' | 'IN_PROGRESS') => {
    try {
      const updateData: any = { referralStatus };
      if (referralStatus === 'SUGGESTED') {
        updateData.suggestReferral = true;
      }
      
      await updateDoc(doc(db, 'incidents', incident.id), updateData);
      
      await addLog(
        'Actualizó estatus de canalización',
        `Modificado por: ${profile.name} (${profile.role} - ${profile.email}) | Estatus: ${referralStatus === 'IN_PROGRESS' ? 'En Canalización' : 'Sugerencia'} | Incidencia: ${incident.place} | Alumno(s): ${incident.students} | Creador del reporte: ${incident.reporterName}`,
        { module: 'Canalizaciones', recordId: incident.id }
      );

      if (referralStatus === 'SUGGESTED') {
        // Determine assigned psychologist
        let assignedPsych = psychologists.find(p => 
          p.uid === (incident as any).assignedPsychologistId || 
          p.email.toLowerCase() === (incident as any).assignedPsychologistEmail?.toLowerCase()
        );
        if (!assignedPsych && psychologists.length === 1) {
          assignedPsych = psychologists[0];
        }

        // Auto-create/sync referral document
        const incAny = incident as any;
        const refId = `ref_inc_${incident.id}`;
        const refDoc: Referral = {
          id: refId,
          incidentId: incident.id,
          studentName: incident.students || 'Estudiante',
          gradeGroup: incAny.gradeGroup || incAny.grade || incAny.levelGroup || 'S/G',
          teacherId: incident.reporterId || '',
          teacherName: incident.reporterName || 'Docente',
          teacherEmail: incident.reporterEmail || '',
          coordinatorId: incident.coordinatorId || '',
          coordinatorName: incAny.coordinatorName || 'Coordinador General',
          coordinatorEmail: incAny.coordinatorEmail || '',
          psychologistId: assignedPsych?.uid || '',
          psychologistName: assignedPsych?.name || (psychologists[0]?.name || 'Psicólogo Escolar'),
          psychologistEmail: assignedPsych?.email || (psychologists[0]?.email || ''),
          reasonAndBackground: `Sugerencia de canalización generada desde incidencia en "${incident.place}". Alumno(s): ${incident.students}. Motivo/Hechos: ${incident.description}`,
          teacherStrategies: incident.referralComments || '',
          psychologistComment: '',
          status: 'PENDIENTE',
          createdAt: Date.now()
        };
        await setDoc(doc(db, 'referrals', refId), refDoc, { merge: true });

        const title = 'Nueva Canalización Sugerida';
        const message = `Se ha sugerido una canalización para la incidencia en "${incident.place}".`;
        
        // Notify Psychologists (assigned one or all if unassigned)
        const psychsToNotify = assignedPsych ? [assignedPsych] : psychologists;
        for (const psych of psychsToNotify) {
          await sendNotification(psych.uid, title, message, incident.id, false, { referralId: refId, type: 'referral' });
          
          if (systemSettings.emailNotificationsEnabled) {
            await sendEmail(
              psych.email,
              `Sugerencia de Canalización - ${incident.place}`,
              `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                <div style="background-color: #ec4899; padding: 20px; text-align: center;">
                  <h2 style="color: white; margin: 0;">Sugerencia de Canalización</h2>
                </div>
                <div style="padding: 30px; color: #1e293b; line-height: 1.6;">
                  <p>Hola <strong>${psych.name}</strong>,</p>
                  <p>Se ha generado una nueva sugerencia de canalización para una incidencia:</p>
                  <div style="background-color: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
                    <p style="margin: 5px 0;"><strong>Lugar:</strong> ${incident.place}</p>
                    <p style="margin: 5px 0;"><strong>Alumno:</strong> ${incident.students}</p>
                    <p style="margin: 5px 0;"><strong>Reporta:</strong> ${incident.reporterName}</p>
                  </div>
                  <p>Por favor, ingresa al sistema para revisar los detalles y realizar el seguimiento correspondiente.</p>
                  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 30px 0;">
                  <p style="color: #94a3b8; font-size: 12px; text-align: center;">Este es un mensaje automático del sistema DUNOR.</p>
                </div>
              </div>
              `
            );
          }
        }
      } else if (referralStatus === 'IN_PROGRESS') {
        const title = 'En Canalización';
        const message = `La incidencia en "${incident.place}" ha sido puesta "En canalización" por el equipo de psicología.`;

        // Batch all recipients to send only one set of notifications (and avoid duplicate admin notifications)
        const recipients = [
          ...(incident.coordinatorIds || [incident.coordinatorId]),
          incident.reporterId,
          ...(incident.notifiedTeacherId ? [incident.notifiedTeacherId] : [])
        ];
        
        await sendNotification(recipients, title, message, incident.id);
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `incidents/${incident.id}`);
    }
  };

  const updateReferralComments = async (incident: Incident, comments: string) => {
    try {
      await updateDoc(doc(db, 'incidents', incident.id), { 
        referralComments: comments 
      });
      await addLog(
        'Actualizó comentarios de canalización',
        `Registrado por: ${profile.name} (${profile.role} - ${profile.email}) | Incidencia: ${incident.place} | Alumno(s): ${incident.students} | Creador del reporte: ${incident.reporterName} | Comentarios: "${comments.slice(0, 100)}"`,
        { module: 'Canalizaciones', recordId: incident.id }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `incidents/${incident.id}`);
    }
  };

  const updateIncidentFollowUp = async (incident: Incident, followUp: string, history: FollowUpComment[], newCommentText: string) => {
    try {
      await updateDoc(doc(db, 'incidents', incident.id), { 
        followUp,
        followUpHistory: history,
        isReceived: false // Mark as unread so coordinator sees it as "Pendiente"
      });

      await addLog(
        'Agregó seguimiento a incidencia',
        `Registrado por: ${profile.name} (${profile.role} - ${profile.email}) | Incidencia: ${incident.place} | Alumno(s): ${incident.students} | Creador del reporte: ${incident.reporterName} | Comentario: "${newCommentText.substring(0, 100)}"`,
        { module: 'Incidencias', recordId: incident.id }
      );

      await notifyIncidentInvolvedUsers({
        incident,
        title: 'Nuevo Comentario de Seguimiento',
        message: `${profile.name} ha agregado un seguimiento en "${incident.place}": ${newCommentText.substring(0, 50)}${newCommentText.length > 50 ? '...' : ''}`,
        emailSubject: `Nuevo Comentario de Seguimiento: ${incident.place}`,
        emailHeaderTitle: 'Seguimiento de Incidencia',
        actionDetails: `Comentario de <strong>${profile.name}</strong>: "<span style="font-style: italic;">${newCommentText}</span>"`,
        excludeUserId: profile.uid
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `incidents/${incident.id}`);
    }
  };

  const deleteIncident = async (incident: Incident) => {
    if (!profile) return;
    const canPermDelete = Boolean(isSuperAdmin || can('canDeleteIncidents') || profile.role === 'ADMIN');
    const isCoordDelete = profile.role === 'COORDINATOR' && incident.status === 'CERRADO';

    if (!canPermDelete && !isCoordDelete) {
      showSystemPopup('Acción no permitida', 'No tienes permisos para eliminar este registro de incidencia.', 'warning');
      return;
    }

    if (canPermDelete) {
      setConfirmModal({
        isOpen: true,
        title: 'Eliminar Registro de Incidencia',
        message: `¿Estás seguro de eliminar permanentemente el registro de incidencia en "${incident.place}" (Alumnos: ${incident.students})? Esta acción borrará el registro de la base de datos de manera definitiva e irreversible.`,
        onConfirm: async () => {
          try {
            await deleteDoc(doc(db, 'incidents', incident.id));
            await addLog(
              'Eliminó incidencia permanentemente',
              `Incidencia eliminada permanentemente por: ${profile.name} (${profile.role} - ${profile.email}) | ID: ${incident.id} | Alumno(s): ${incident.students} | Lugar: ${incident.place}`,
              { module: 'Incidencias', recordId: incident.id }
            );
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
            showSystemPopup('Registro Eliminado', 'La incidencia ha sido eliminada permanentemente del sistema.', 'success');
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `incidents/${incident.id}`);
          }
        }
      });
    } else if (isCoordDelete) {
      setConfirmModal({
        isOpen: true,
        title: 'Eliminar Incidencia de Panel',
        message: '¿Estás seguro de eliminar esta incidencia de tu panel? El docente que la creó aún podrá verla.',
        onConfirm: async () => {
          try {
            await updateDoc(doc(db, 'incidents', incident.id), {
              deletedByCoordinators: arrayUnion(profile.uid)
            });
            await addLog(
              'Eliminó incidencia de panel',
              `Eliminado de panel por: ${profile.name} (${profile.role} - ${profile.email}) | Incidencia: ${incident.place} | Alumno(s): ${incident.students} | Creador del reporte: ${incident.reporterName}`,
              { module: 'Incidencias', recordId: incident.id }
            );
            setConfirmModal(prev => ({ ...prev, isOpen: false }));
          } catch (error) {
            handleFirestoreError(error, OperationType.DELETE, `incidents/${incident.id}`);
          }
        }
      });
    }
  };

  const handleInstallClick = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setShowInstallPrompt(false);
    }
  };

  const forwardIncidentToAdmin = async (incident: Incident, adminId: string) => {
    if (!systemSettings.forwardingEnabled) return;
    if (profile.role !== 'COORDINATOR' && !isSuperAdmin) return;
    if (incident.status !== 'EN_SEGUIMIENTO') return;
    try {
      const admin = admins.find(a => a.uid === adminId);
      if (admin) {
        await sendNotification(
          adminId,
          'Incidencia Reenviada',
          `${profile.name} ha reenviado una incidencia de "${incident.place}" para tu revisión.`,
          incident.id
        );

        await updateDoc(doc(db, 'incidents', incident.id), {
          forwardedTo: arrayUnion(adminId)
        });

        await addLog(
          'Reenvió incidencia a directivo/administrador',
          `Reenviado por: ${profile.name} (${profile.role} - ${profile.email}) | Incidencia: ${incident.place} | Alumno(s): ${incident.students} | Creador del reporte: ${incident.reporterName} | Destinatario: ${admin.name} (${admin.email})`,
          { module: 'Incidencias', recordId: incident.id }
        );

        // Send email notification to the admin
        if (systemSettings.emailNotificationsEnabled !== false && admin.email) {
          await sendEmail(
            admin.email,
            `Incidencia Reenviada: ${incident.place}`,
            `
              <div style="font-family: sans-serif; color: #334155; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                <div style="background-color: #4f46e5; padding: 24px; text-align: center;">
                  <h1 style="color: white; margin: 0; font-size: 24px;">Incidencia Reenviada</h1>
                </div>
                <div style="padding: 24px;">
                  <p style="font-size: 16px; margin-bottom: 20px;">${profile.name} ha reenviado una incidencia para tu revisión.</p>
                  <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
                    <p style="margin: 0 0 8px 0;"><strong>Lugar:</strong> ${incident.place}</p>
                    <p style="margin: 0 0 8px 0;"><strong>Colegio:</strong> ${incident.school}</p>
                    <p style="margin: 0 0 8px 0;"><strong>Descripción:</strong> ${incident.description}</p>
                  </div>
                  <p style="font-size: 14px; color: #64748b;">Por favor, ingresa al sistema para revisar el reporte completo.</p>
                </div>
              </div>
            `
          );
        }
      }
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `incidents/${incident.id}`);
    }
  };

  const deleteMultipleIncidents = async () => {
    if (selectedIncidents.length === 0) return;
    
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Incidencias',
      message: `¿Estás seguro de eliminar ${selectedIncidents.length} incidencias seleccionadas? Esta acción no se puede deshacer.`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          selectedIncidents.forEach(id => {
            batch.delete(doc(db, 'incidents', id));
          });
          await batch.commit();
          await addLog(
            'Eliminación múltiple de incidencias',
            `Eliminado por: ${profile.name} (${profile.role} - ${profile.email}) | Cantidad: ${selectedIncidents.length} incidencias eliminadas de la base de datos`,
            { module: 'Incidencias' }
          );
          setSelectedIncidents([]);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'incidents/multiple');
        }
      }
    });
  };

  const deleteMultipleNotifications = async () => {
    if (selectedNotifications.length === 0) return;
    
    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Notificaciones',
      message: `¿Estás seguro de eliminar ${selectedNotifications.length} notificaciones seleccionadas?`,
      onConfirm: async () => {
        try {
          const batch = writeBatch(db);
          selectedNotifications.forEach(id => {
            batch.delete(doc(db, 'notifications', id));
          });
          await batch.commit();
          setSelectedNotifications([]);
          setIsNotifSelectionMode(false);
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'notifications/multiple');
        }
      }
    });
  };

  const seedDatabaseDataSilent = async () => {
    try {
      const existingSettingsSnap = await safeGetDoc(doc(db, 'settings', 'global'));
      if (!existingSettingsSnap.exists()) {
        await setDoc(doc(db, 'settings', 'global'), DEFAULT_SETTINGS);
      } else {
        const existingData = existingSettingsSnap.data() || {};
        const settingsToSave = { ...DEFAULT_SETTINGS, ...existingData };
        if (existingData.appLogoUrl) settingsToSave.appLogoUrl = existingData.appLogoUrl;
        if (existingData.appName) settingsToSave.appName = existingData.appName;
        if (existingData.rolePermissions) settingsToSave.rolePermissions = existingData.rolePermissions;
        await setDoc(doc(db, 'settings', 'global'), settingsToSave, { merge: true });
      }

      const superAdmins = [
        { email: 'mi_yorch@hotmail.com', name: 'Super Admin (Yorch)', role: 'ADMIN' },
        { email: 'incidencias.dunor@gmail.com', name: 'Administrador DUNOR', role: 'ADMIN' }
      ];
      for (const sa of superAdmins) {
        await setDoc(doc(db, 'users', sa.email), {
          uid: sa.email,
          name: sa.name,
          email: sa.email,
          role: sa.role,
          password: 'qwerty1',
          isRegistered: true,
          updatedAt: Date.now()
        }, { merge: true });
      }

      const sampleTeam = [
        { email: 'coordinacion.primaria@dunor.edu.mx', name: 'Lic. Carlos López', role: 'COORDINATOR' },
        { email: 'coordinacion.secundaria@dunor.edu.mx', name: 'Mtra. Elena Gómez', role: 'COORDINATOR' },
        { email: 'docente.maria@dunor.edu.mx', name: 'Profra. María García', role: 'TEACHER' },
        { email: 'docente.juan@dunor.edu.mx', name: 'Profr. Juan Pérez', role: 'TEACHER' },
        { email: 'psicologia@dunor.edu.mx', name: 'Psic. Ana Martínez', role: 'PSYCHOLOGIST' },
        { email: 'direccion@dunor.edu.mx', name: 'Dir. Roberto Fernández', role: 'DIRECTIVE' }
      ];
      for (const tm of sampleTeam) {
        await setDoc(doc(db, 'users', tm.email), {
          uid: tm.email,
          name: tm.name,
          email: tm.email,
          role: tm.role,
          isRegistered: true,
          updatedAt: Date.now()
        }, { merge: true });
      }

      const sampleIncidents = [
        {
          studentName: 'Mateo Hernández Ruiz',
          grade: '1° A Primaria',
          category: 'Agresión Verbal',
          description: 'El alumno profirió insultos a un compañero durante la clase. Se realizó diálogo orientativo.',
          reportedBy: 'Profra. María García',
          reporterEmail: 'docente.maria@dunor.edu.mx',
          status: 'PENDING',
          priority: 'MEDIA',
          date: new Date().toISOString().split('T')[0],
          createdAt: Date.now() - 86400000 * 2,
          updatedAt: Date.now() - 86400000 * 2
        },
        {
          studentName: 'Sofia Torres Morales',
          grade: '2° B Secundaria',
          category: 'Incumplimiento de Actividades',
          description: 'Falta recurrente en la entrega de trabajos y conducta apática durante clase.',
          reportedBy: 'Profr. Juan Pérez',
          reporterEmail: 'docente.juan@dunor.edu.mx',
          status: 'IN_PROGRESS',
          priority: 'BAJA',
          date: new Date().toISOString().split('T')[0],
          createdAt: Date.now() - 86400000,
          updatedAt: Date.now()
        },
        {
          studentName: 'Gabriel Mendoza Castro',
          grade: '3° A Secundaria',
          category: 'Manifestó Agresividad',
          description: 'Conducta disruptiva en el patio escolar. Se acordó seguimiento con el área de psicología.',
          reportedBy: 'Lic. Carlos López',
          reporterEmail: 'coordinacion.primaria@dunor.edu.mx',
          status: 'RESOLVED',
          priority: 'ALTA',
          date: new Date().toISOString().split('T')[0],
          createdAt: Date.now() - 86400000 * 4,
          updatedAt: Date.now() - 86400000 * 3
        }
      ];

      for (const inc of sampleIncidents) {
        await addDoc(collection(db, 'incidents'), inc);
      }

      await addDoc(collection(db, 'logs'), {
        action: 'SYSTEM_BOOTSTRAP',
        details: 'Base de datos Firestore autoinicializada correctamente.',
        userName: 'Sistema DUNOR',
        userEmail: 'sistema@dunor.edu.mx',
        timestamp: Date.now()
      });
      console.log("Auto-seeding completado con éxito.");
    } catch (err) {
      console.warn("Silent auto-seed warning:", err);
    }
  };

  const seedDatabaseData = async () => {
    setIsSeeding(true);
    try {
      // 1. Write global settings safely without wiping existing logo/permissions
      const existingSettingsSnap = await safeGetDoc(doc(db, 'settings', 'global'));
      if (!existingSettingsSnap.exists()) {
        await setDoc(doc(db, 'settings', 'global'), DEFAULT_SETTINGS);
      } else {
        const existingData = existingSettingsSnap.data() || {};
        const settingsToSave = { ...DEFAULT_SETTINGS, ...existingData };
        if (existingData.appLogoUrl) settingsToSave.appLogoUrl = existingData.appLogoUrl;
        if (existingData.appName) settingsToSave.appName = existingData.appName;
        if (existingData.rolePermissions) settingsToSave.rolePermissions = existingData.rolePermissions;
        await setDoc(doc(db, 'settings', 'global'), settingsToSave, { merge: true });
      }

      // 2. Ensure super admin documents exist
      const superAdmins = [
        { email: 'mi_yorch@hotmail.com', name: 'Super Admin (Yorch)', role: 'ADMIN' },
        { email: 'incidencias.dunor@gmail.com', name: 'Administrador DUNOR', role: 'ADMIN' }
      ];
      for (const sa of superAdmins) {
        await setDoc(doc(db, 'users', sa.email), {
          uid: sa.email,
          name: sa.name,
          email: sa.email,
          role: sa.role,
          password: 'qwerty1',
          isRegistered: true,
          updatedAt: Date.now()
        }, { merge: true });
      }

      // 3. Seed sample team members
      const sampleTeam = [
        { email: 'coordinacion.primaria@dunor.edu.mx', name: 'Lic. Carlos López', role: 'COORDINATOR' },
        { email: 'coordinacion.secundaria@dunor.edu.mx', name: 'Mtra. Elena Gómez', role: 'COORDINATOR' },
        { email: 'docente.maria@dunor.edu.mx', name: 'Profra. María García', role: 'TEACHER' },
        { email: 'docente.juan@dunor.edu.mx', name: 'Profr. Juan Pérez', role: 'TEACHER' },
        { email: 'psicologia@dunor.edu.mx', name: 'Psic. Ana Martínez', role: 'PSYCHOLOGIST' },
        { email: 'direccion@dunor.edu.mx', name: 'Dir. Roberto Fernández', role: 'DIRECTIVE' }
      ];
      for (const tm of sampleTeam) {
        await setDoc(doc(db, 'users', tm.email), {
          uid: tm.email,
          name: tm.name,
          email: tm.email,
          role: tm.role,
          isRegistered: true,
          updatedAt: Date.now()
        }, { merge: true });
      }

      // 4. Seed sample incidents
      const sampleIncidents = [
        {
          studentName: 'Mateo Hernández Ruiz',
          grade: '1° A Primaria',
          category: 'Agresión Verbal',
          description: 'El alumno profirió insultos a un compañero durante la clase. Se realizó diálogo orientativo.',
          reportedBy: 'Profra. María García',
          reporterEmail: 'docente.maria@dunor.edu.mx',
          status: 'PENDING',
          priority: 'MEDIA',
          date: new Date().toISOString().split('T')[0],
          createdAt: Date.now() - 86400000 * 2,
          updatedAt: Date.now() - 86400000 * 2
        },
        {
          studentName: 'Sofia Torres Morales',
          grade: '2° B Secundaria',
          category: 'Incumplimiento de Actividades',
          description: 'Falta recurrente en la entrega de trabajos y conducta apática durante clase.',
          reportedBy: 'Profr. Juan Pérez',
          reporterEmail: 'docente.juan@dunor.edu.mx',
          status: 'IN_PROGRESS',
          priority: 'BAJA',
          date: new Date().toISOString().split('T')[0],
          createdAt: Date.now() - 86400000,
          updatedAt: Date.now()
        },
        {
          studentName: 'Gabriel Mendoza Castro',
          grade: '3° A Secundaria',
          category: 'Manifestó Agresividad',
          description: 'Conducta disruptiva en el patio escolar. Se acordó seguimiento con el área de psicología.',
          reportedBy: 'Lic. Carlos López',
          reporterEmail: 'coordinacion.primaria@dunor.edu.mx',
          status: 'RESOLVED',
          priority: 'ALTA',
          date: new Date().toISOString().split('T')[0],
          createdAt: Date.now() - 86400000 * 4,
          updatedAt: Date.now() - 86400000 * 3
        }
      ];

      for (const inc of sampleIncidents) {
        await addDoc(collection(db, 'incidents'), inc);
      }

      showSystemPopup('Inicialización exitosa', '¡Base de datos restablecida e inicializada con éxito! Se cargaron los ajustes, usuarios principales e incidencias de ejemplo.', 'success');
    } catch (err: any) {
      console.error("Error seeding DB:", err);
      showSystemPopup('Error', "Error al inicializar la base de datos: " + (err?.message || err), 'error');
    } finally {
      setIsSeeding(false);
    }
  };

  const exportDatabase = async () => {
    setIsExportingDb(true);
    try {
      const collectionsToExport = ['users', 'incidents', 'tasks', 'notifications', 'settings', 'logs'];
      const exportData: Record<string, any[]> = {};

      for (const colName of collectionsToExport) {
        const snap = await getDocs(collection(db, colName));
        exportData[colName] = snap.docs.map(d => ({ _id: d.id, ...d.data() }));
      }

      const jsonStr = JSON.stringify(exportData, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const downloadAnchor = document.createElement('a');
      downloadAnchor.href = url;
      downloadAnchor.download = `Respaldos_DUNOR_${format(new Date(), 'yyyy-MM-dd_HH-mm')}.json`;
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
      URL.revokeObjectURL(url);

      await addLog('Exportó respaldo de base de datos', 'Archivo JSON generado');
      showSystemPopup('Exportación exitosa', 'Base de datos exportada y respaldada exitosamente.', 'success');
    } catch (err: any) {
      console.error("Export DB error:", err);
      showSystemPopup('Error', "Error al exportar la base de datos: " + (err?.message || err), 'error');
    } finally {
      setIsExportingDb(false);
    }
  };

  const processImportFile = async (file: File) => {
    setIsImportingDb(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const data = JSON.parse(content);

        let restoredDocs = 0;
        for (const [colName, docsArr] of Object.entries(data)) {
          if (Array.isArray(docsArr)) {
            for (const item of docsArr) {
              const { _id, ...docData } = item;
              if (_id) {
                await setDoc(doc(db, colName, _id), docData, { merge: true });
                restoredDocs++;
              }
            }
          }
        }

        await addLog('Importó respaldo de base de datos', `${restoredDocs} documentos restaurados`);
        showSystemPopup('Restauración exitosa', `Base de datos restaurada con éxito. Se procesaron ${restoredDocs} documentos.`, 'success');
      } catch (err: any) {
        console.error("Import DB error:", err);
        showSystemPopup('Error', "Error al procesar el archivo de importación JSON: " + (err?.message || err), 'error');
      } finally {
        setIsImportingDb(false);
      }
    };
    reader.readAsText(file);
  };

  const handleImportDatabaseFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const currentInput = event.target;
    showSystemPopup(
      'Importar base de datos',
      '¿Estás seguro de importar este archivo de base de datos? Se actualizarán o restaurarán los datos en Firestore.',
      'confirm',
      () => {
        processImportFile(file);
        currentInput.value = '';
      },
      'Importar',
      'Cancelar'
    );
  };

  const handleLogoImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > 8 * 1024 * 1024) {
      showSystemPopup('Archivo muy grande', 'La imagen seleccionada supera los 8MB. Por favor elige una imagen más ligera.', 'error');
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (!result) return;

      const img = new Image();
      img.onload = async () => {
        try {
          const canvas = document.createElement('canvas');
          const MAX_SIZE = 350;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_SIZE) {
              height = Math.round((height * MAX_SIZE) / width);
              width = MAX_SIZE;
            }
          } else {
            if (height > MAX_SIZE) {
              width = Math.round((width * MAX_SIZE) / height);
              height = MAX_SIZE;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0, width, height);
            const compressedDataUrl = canvas.toDataURL('image/png');
            setAppLogoInput(compressedDataUrl);

            await setDoc(doc(db, 'settings', 'global'), {
              appLogoUrl: compressedDataUrl
            }, { merge: true });

            setSystemSettings(prev => ({
              ...prev,
              appLogoUrl: compressedDataUrl
            }));

            localStorage.setItem('app_logo_url', compressedDataUrl);
            await addLog('Actualización de Logotipo', 'Se subió y guardó un nuevo logotipo en la base de datos Firestore.');
            showSystemPopup('Logotipo actualizado', 'Logotipo guardado permanentemente en la base de datos Firestore.', 'success');
          }
        } catch (err) {
          console.error("Error processing logo image:", err);
          setAppLogoInput(result);
        }
      };
      img.src = result;
    };
    reader.readAsDataURL(file);
  };

  return (
    <ErrorBoundary>
      <div className={cn("min-h-screen flex flex-col md:flex-row transition-colors duration-300", isDarkMode ? "dark bg-slate-950 text-slate-100" : "bg-slate-50 text-slate-900")}>
      {/* Mobile Header */}
      <div className="md:hidden bg-white border-b border-slate-200 p-4 flex items-center justify-between sticky top-0 z-50">
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)} 
          className="flex flex-col items-center gap-1.5 hover:opacity-80 transition-opacity"
        >
          <div className="w-10 h-10 p-1 bg-white rounded-xl shadow-sm border border-slate-200/80 flex items-center justify-center">
            <Logo className="w-full h-full object-contain" appName={systemSettings.appName || 'DASHBOARD DUNOR'} logoUrl={systemSettings.appLogoUrl || "/logo.svg"} />
          </div>
          <span className="text-xs font-bold text-slate-900">{systemSettings.appName || 'DASHBOARD DUNOR'}</span>
        </button>
        <div className="flex items-center gap-2">
          {/* Notifications or other mobile header actions could go here */}
        </div>
      </div>

      {/* Sidebar */}
      <AnimatePresence>
        {(isSidebarOpen || window.innerWidth >= 768) && (
          <>
            {/* Mobile Overlay */}
            {isSidebarOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsSidebarOpen(false)}
                className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden"
              />
            )}
            <motion.aside
              initial={{ x: -300 }}
              animate={{ x: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              exit={{ x: -300 }}
              className={cn(
                "fixed top-0 left-0 h-full w-72 bg-white border-r border-slate-200 z-50 md:sticky md:h-screen md:z-30",
                !isSidebarOpen && "hidden md:block"
              )}
            >
              <div 
                className="p-6 flex flex-col h-full overflow-y-auto scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]"
              >
                <div className="flex items-center justify-center mb-8">
                  <div className="flex flex-col items-center gap-3 text-center">
                    <div className="w-20 h-20 p-2 bg-white rounded-2xl shadow-sm border border-slate-200/80 flex items-center justify-center">
                      <Logo className="w-full h-full object-contain" appName={systemSettings.appName || 'DASHBOARD DUNOR'} logoUrl={systemSettings.appLogoUrl || "/logo.svg"} />
                    </div>
                    <span className="text-lg font-bold text-slate-900 tracking-widest">{systemSettings.appName || 'DASHBOARD DUNOR'}</span>
                  </div>
                </div>

                <div className="space-y-1 flex-1">
                {can('canViewNotifications') && (
                  <SidebarItem
                    icon={
                      <div className="relative flex items-center justify-center">
                        <Send className="w-5 h-5" />
                        {notifications.filter(n => !n.read).length > 0 && (
                          <span className="absolute -top-2 -right-2.5 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full border-2 border-white flex items-center justify-center min-w-[18px] h-4.5 bg-amber-500 text-slate-950 shadow-sm leading-none animate-pulse">
                            {notifications.filter(n => !n.read).length}
                          </span>
                        )}
                      </div>
                    }
                    label="Notificaciones"
                    active={activeTab === 'notifications'}
                    onClick={() => { setActiveTab('notifications'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                  />
                )}
                {can('canViewTasks') && (
                  <SidebarItem
                    icon={
                      <div className="relative">
                        <CheckCircle2 className="w-5 h-5 text-indigo-600" />
                        {tasks.some(t => t.assignedToEmail?.toLowerCase() === profile?.email?.toLowerCase() && (t.status === 'ASIGNADA' || t.status === 'RECIBIDA')) && (
                          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full border-2 border-white animate-pulse" />
                        )}
                      </div>
                    }
                    label="Tareas"
                    active={activeTab === 'tasks'}
                    onClick={() => { setActiveTab('tasks'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                  />
                )}
                {can('canViewIncidents') && (
                  <SidebarItem
                    icon={<ClipboardList className="w-5 h-5" />}
                    label="Incidencias"
                    active={activeTab === 'incidents'}
                    onClick={() => { setActiveTab('incidents'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                  />
                )}
                {can('canCreateIncident') && (
                  <SidebarItem
                    icon={<Plus className="w-5 h-5" />}
                    label="Nueva Incidencia"
                    active={activeTab === 'add-incident'}
                    onClick={() => { setActiveTab('add-incident'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                  />
                )}
                {can('canViewReferrals') && (
                  <SidebarItem
                    icon={<BrainCircuit className="w-5 h-5" />}
                    label="Canalizaciones"
                    active={activeTab === 'referrals'}
                    onClick={() => { setActiveTab('referrals'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                  />
                )}
                {can('canViewExpedientes') && (
                  <SidebarItem
                    icon={<GraduationCap className="w-5 h-5" />}
                    label="Expedientes"
                    active={activeTab === 'expedientes'}
                    onClick={() => { setActiveTab('expedientes'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                  />
                )}
                {can('canViewInformes') && (
                  <SidebarItem
                    icon={<BarChart2 className="w-5 h-5" />}
                    label="Informe"
                    active={activeTab === 'informes'}
                    onClick={() => { setActiveTab('informes'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                  />
                )}
                {can('canViewUsers') && (
                  <SidebarItem
                    icon={<Users className="w-5 h-5" />}
                    label="Usuarios"
                    active={activeTab === 'users'}
                    onClick={() => { setActiveTab('users'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                  />
                )}
                {can('canViewSettings') && (
                  <SidebarItem
                    icon={<Settings className="w-5 h-5" />}
                    label="Configuración"
                    active={activeTab === 'settings'}
                    onClick={() => { setActiveTab('settings'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                  />
                )}
                {can('canViewLogs') && (
                  <SidebarItem
                    icon={<History className="w-5 h-5" />}
                    label="Logs"
                    active={activeTab === 'logs'}
                    onClick={() => { setActiveTab('logs'); if (window.innerWidth < 768) setIsSidebarOpen(false); }}
                  />
                )}
              </div>

              {/* Bottom Section with Dark Mode & Logout */}
              <div className="mt-auto pt-4 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 sticky bottom-0">
                {/* Dark Mode Switch */}
                <div className="flex items-center justify-between px-3 py-2 bg-slate-100 dark:bg-slate-800 rounded-xl mb-3 border border-slate-200/60 dark:border-slate-700/60">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                    {isDarkMode ? <Moon className="w-4 h-4 text-indigo-400" /> : <Sun className="w-4 h-4 text-amber-500" />}
                    <span>{isDarkMode ? 'Modo Oscuro' : 'Modo Claro'}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsDarkMode(!isDarkMode)}
                    className={cn(
                      "w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer",
                      isDarkMode ? "bg-indigo-600 justify-end" : "bg-slate-300 justify-start"
                    )}
                    title={isDarkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
                  >
                    <motion.div
                      layout
                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      className="w-4 h-4 bg-white rounded-full shadow-md"
                    />
                  </button>
                </div>

                <div className="flex items-center gap-3 mb-3 px-2">
                  <div className="w-10 h-10 bg-indigo-50 dark:bg-indigo-950/60 rounded-full flex items-center justify-center text-indigo-600 dark:text-indigo-400 flex-shrink-0">
                    <UserIcon className="w-6 h-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{profile.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                      {isSuperAdmin ? 'Super Admin' : profile.role === 'DIRECTIVE' ? 'Directivo (Observador)' : profile.role === 'COORDINATOR' ? 'Coordinador' : profile.role === 'TEACHER' ? 'Docente' : profile.role === 'PSYCHOLOGIST' ? 'Psicólogo' : profile.role}
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-3 py-2.5 text-slate-600 dark:text-slate-300 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 rounded-xl transition-all mb-2 cursor-pointer font-bold text-xs"
                >
                  <LogOut className="w-4 h-4" />
                  <span>Cerrar sesión</span>
                </button>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center pb-2 font-mono">D By JV v 2.0</p>
              </div>
            </div>
          </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <main className="flex-1 p-4 pt-20 md:pt-8 md:p-8 max-w-5xl mx-auto w-full">

        <AnimatePresence mode="wait">
          {activeTab === 'incidents' && can('canViewIncidents') && (
            <motion.div
              key="incidents"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900">Registro de Incidencias</h1>
                  <p className="text-slate-500">Visualiza y gestiona los reportes escolares</p>
                </div>
                <div className="flex items-center gap-2">
                  {isSuperAdmin && incidents.length > 0 && (
                    <button
                      onClick={() => {
                        if (selectedIncidents.length === incidents.length) {
                          setSelectedIncidents([]);
                        } else {
                          setSelectedIncidents(incidents.map(i => i.id));
                        }
                      }}
                      className="hidden md:flex items-center gap-2 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
                    >
                      {selectedIncidents.length === incidents.length ? 'Deseleccionar todo' : 'Seleccionar todo'}
                    </button>
                  )}
                  <button
                    onClick={() => setActiveTab('notifications')}
                    className="relative md:hidden p-3 text-slate-600 hover:bg-slate-100 rounded-full transition-all cursor-pointer"
                  >
                    <Send className="w-6 h-6" />
                    {notifications.filter(n => !n.read).length > 0 && (
                      <span className="absolute top-1 right-1 text-[10px] font-extrabold px-1.5 py-0.5 rounded-full border-2 border-white flex items-center justify-center min-w-[18px] h-4.5 bg-amber-500 text-slate-950 shadow-sm leading-none animate-pulse">
                        {notifications.filter(n => !n.read).length}
                      </span>
                    )}
                  </button>
                  {can('canCreateIncident') && (
                    <button
                      onClick={() => setActiveTab('add-incident')}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-200 transition-all font-bold flex items-center gap-2"
                    >
                      <Plus className="w-5 h-5" />
                      <span>Nueva Incidencia</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Search Bar & View Mode Toggle */}
              <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <div className="relative flex-1">
                  <Search className="w-5 h-5 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Buscar alumno reportado, lugar o descripción..."
                    className="w-full pl-11 pr-10 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-indigo-500 transition-all shadow-sm"
                  />
                  {searchTerm && (
                    <button 
                      onClick={() => setSearchTerm('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    onClick={() => setIsGroupedByStudent(false)}
                    className={cn(
                      "px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border",
                      !isGroupedByStudent 
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm" 
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    <ClipboardList className="w-4 h-4" />
                    <span>Individuales</span>
                  </button>
                  <button
                    onClick={() => setIsGroupedByStudent(true)}
                    className={cn(
                      "px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border",
                      isGroupedByStudent 
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-sm" 
                        : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                    )}
                  >
                    <Users className="w-4 h-4" />
                    <span>Agrupar por Alumno</span>
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {isSuperAdmin && selectedIncidents.length > 0 && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="bg-indigo-600 text-white p-4 rounded-2xl shadow-lg flex items-center justify-between sticky top-20 z-10"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center font-bold">
                        {selectedIncidents.length}
                      </div>
                      <span className="font-bold">Incidencias seleccionadas</span>
                    </div>
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setSelectedIncidents([])}
                        className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-bold transition-all"
                      >
                        Cancelar
                      </button>
                      <button 
                        onClick={deleteMultipleIncidents}
                        className="px-4 py-2 bg-red-500 hover:bg-red-600 rounded-lg text-sm font-bold flex items-center gap-2 transition-all"
                      >
                        <Trash2 className="w-4 h-4" />
                        Eliminar
                      </button>
                    </div>
                  </motion.div>
                )}

                {(() => {
                  const filteredIncidents = incidents.filter(incident => {
                    const normRole = normalizeUserRole(profile.role);
                    const userEmail = (profile.email || '').toLowerCase().trim();
                    const userUid = profile.uid;

                    // Enforce teacher privacy: only own records or if in copy
                    if (!isSuperAdmin && !isSuperAdminEmail(userEmail) && normRole !== 'ADMIN' && normRole !== 'DIRECTIVE') {
                      if (normRole === 'TEACHER') {
                        const isAuthor = 
                          (incident.reporterId && incident.reporterId === userUid) ||
                          (incident.reporterEmail && incident.reporterEmail.toLowerCase() === userEmail);
                        const isCopied = 
                          (incident.notifiedTeacherId && incident.notifiedTeacherId === userUid) ||
                          (incident.notifiedTeacherEmail && incident.notifiedTeacherEmail.toLowerCase() === userEmail) ||
                          (incident.coordinatorIds && incident.coordinatorIds.includes(userUid));
                        if (!isAuthor && !isCopied) return false;
                      } else if (normRole === 'COORDINATOR') {
                        const isAssigned = 
                          incident.coordinatorId === userUid || 
                          (incident.coordinatorIds && incident.coordinatorIds.includes(userUid)) ||
                          (incident.coordinatorEmail && incident.coordinatorEmail.toLowerCase() === userEmail);
                        if (!isAssigned) return false;
                      }
                    }

                    if (!searchTerm.trim()) return true;
                    const term = normalizeSearchText(searchTerm);
                    const studentsMatch = normalizeSearchText(incident.students).includes(term);
                    const placeMatch = normalizeSearchText(incident.place).includes(term);
                    const descMatch = normalizeSearchText(incident.description).includes(term);
                    const reporterMatch = normalizeSearchText(incident.reporterName).includes(term);
                    return studentsMatch || placeMatch || descMatch || reporterMatch;
                  });

                  if (filteredIncidents.length === 0) {
                    return (
                      <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                        <ClipboardList className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-500 font-medium">
                          {searchTerm ? `No se encontraron incidencias que coincidan con "${searchTerm}".` : 'No hay incidencias registradas aún.'}
                        </p>
                      </div>
                    );
                  }

                  if (isGroupedByStudent) {
                    interface StudentGroupItem {
                      id: string;
                      displayName: string;
                      incidents: Incident[];
                    }

                    const groups: StudentGroupItem[] = [];

                    filteredIncidents.forEach(inc => {
                      const rawName = inc.students?.trim() || 'Sin Nombre';
                      // Separar múltiples alumnos por coma, punto y coma, salto de línea, barra o " y " / " e "
                      const names = rawName
                        .split(/[,;\n/]+|\s+y\s+|\s+e\s+/i)
                        .map(s => s.trim())
                        .filter(Boolean);

                      if (names.length === 0) {
                        names.push('Sin Nombre');
                      }

                      names.forEach(name => {
                        const isSinNombre = !name || name.toLowerCase() === 'sin nombre' || name.toLowerCase() === 'n/a';
                        if (isSinNombre) {
                          const existing = groups.find(g => g.displayName === 'Sin Nombre');
                          if (existing) {
                            if (!existing.incidents.some(i => i.id === inc.id)) {
                              existing.incidents.push(inc);
                            }
                          } else {
                            groups.push({
                              id: 'sin-nombre',
                              displayName: 'Sin Nombre',
                              incidents: [inc]
                            });
                          }
                          return;
                        }

                        // Coincidencia flexible: insensible a acentos, mayúsculas/minúsculas y subconjuntos de nombres
                        const existing = groups.find(g => 
                          g.displayName !== 'Sin Nombre' && areStudentNamesEquivalent(g.displayName, name)
                        );

                        if (existing) {
                          if (!existing.incidents.some(i => i.id === inc.id)) {
                            existing.incidents.push(inc);
                          }
                          existing.displayName = pickBetterStudentDisplayName(existing.displayName, name);
                        } else {
                          groups.push({
                            id: normalizeStudentName(name) || 'sin-nombre',
                            displayName: formatStudentNameTitleCase(name),
                            incidents: [inc]
                          });
                        }
                      });
                    });

                    // Ordenar por cantidad de incidencias descendente y luego alfabéticamente
                    const studentEntries = groups
                      .sort((a, b) => b.incidents.length - a.incidents.length || a.displayName.localeCompare(b.displayName))
                      .map(g => [g.displayName, g.incidents] as [string, Incident[]]);

                    return (
                      <div className="space-y-4">
                        {studentEntries.map(([studentName, studentIncidents]) => (
                          <StudentGroupCard
                            key={studentName}
                            studentName={studentName}
                            incidents={studentIncidents}
                            profile={profile}
                            coordinators={coordinators}
                            teachers={teachers}
                            psychologists={psychologists}
                            onMarkReceived={(id) => markAsReceived(id)}
                            onUpdateStatus={(inc, status) => updateIncidentStatus(inc, status)}
                            onUpdateReferralStatus={(inc, status) => updateIncidentReferralStatus(inc, status)}
                            onUpdateReferralComments={(inc, comments) => updateReferralComments(inc, comments)}
                            onUpdateFollowUp={(inc, followUp, history, comment) => updateIncidentFollowUp(inc, followUp, history, comment)}
                            onDelete={(inc) => deleteIncident(inc)}
                            onForward={(inc, adminId) => forwardIncidentToAdmin(inc, adminId)}
                            onOpenGallery={openGallery}
                            onPrint={(inc) => setPrintIncident(inc)}
                            systemSettings={effectiveSystemSettings}
                            admins={admins}
                            expandedIncidentId={expandedIncidentId}
                          />
                        ))}
                      </div>
                    );
                  }

                  return filteredIncidents.map((incident) => (
                    <IncidentCard
                      key={incident.id}
                      incident={incident}
                      profile={profile}
                      coordinators={coordinators}
                      teachers={teachers}
                      psychologists={psychologists}
                      onMarkReceived={() => markAsReceived(incident.id)}
                      onUpdateStatus={(status: IncidentStatus) => updateIncidentStatus(incident, status)}
                      onUpdateReferralStatus={(status: 'SUGGESTED' | 'IN_PROGRESS') => updateIncidentReferralStatus(incident, status)}
                      onUpdateReferralComments={(comments: string) => updateReferralComments(incident, comments)}
                      onUpdateFollowUp={(followUp: string, history: FollowUpComment[], newCommentText: string) => updateIncidentFollowUp(incident, followUp, history, newCommentText)}
                      onDelete={() => deleteIncident(incident)}
                      onForward={(adminId: string) => forwardIncidentToAdmin(incident, adminId)}
                      onOpenGallery={openGallery}
                      onPrint={(inc) => setPrintIncident(inc)}
                      systemSettings={effectiveSystemSettings}
                      admins={admins}
                      selectable={isSuperAdmin}
                      selected={selectedIncidents.includes(incident.id)}
                      onSelect={(id) => {
                        setSelectedIncidents(prev => 
                          prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
                        );
                      }}
                      expandedIncidentId={expandedIncidentId}
                    />
                  ));
                })()}
              </div>
            </motion.div>
          )}

          {activeTab === 'notifications' && can('canViewNotifications') && (
            <motion.div
              key="notifications"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                <div>
                  <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Notificaciones</h1>
                  <p className="text-slate-500 dark:text-slate-400">Mantente al día con tus reportes</p>
                </div>
                {notifications.length > 0 && (
                  <button
                    type="button"
                    onClick={markAllNotificationsAsRead}
                    className="flex items-center gap-2 px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-xs rounded-xl transition-all border border-indigo-200 dark:border-indigo-800 shadow-sm cursor-pointer self-start sm:self-auto"
                  >
                    <CheckCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span>Marcar todos como leídos</span>
                  </button>
                )}
              </div>

              {/* System Native Notifications Card (Celular y PC) - Ocultable una vez aceptado y probado */}
              {!(systemNotificationPermission === 'granted' && hideTestedNotificationCard) && (
                <div className="mb-6 p-5 rounded-2xl bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white shadow-xl border border-indigo-500/20 relative overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      setHideTestedNotificationCard(true);
                      try { localStorage.setItem('dunor_hide_tested_notification_card', 'true'); } catch (e) {}
                    }}
                    className="absolute top-3 right-3 text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors z-20 cursor-pointer"
                    title="Ocultar aviso"
                  >
                    <X className="w-4 h-4" />
                  </button>
                  <div className="absolute right-0 top-0 translate-x-4 -translate-y-4 w-40 h-40 bg-indigo-500/10 rounded-full blur-2xl pointer-events-none" />
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
                    <div className="flex items-start gap-3.5">
                      <div className="w-11 h-11 rounded-xl bg-indigo-500/20 border border-indigo-400/30 flex items-center justify-center flex-shrink-0 text-indigo-300">
                        {systemNotificationPermission === 'granted' ? (
                          <BellRing className="w-5 h-5 text-emerald-400 animate-pulse" />
                        ) : (
                          <Bell className="w-5 h-5 text-indigo-300" />
                        )}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-base font-bold text-white">
                            Notificaciones en Celular y PC
                          </h3>
                          {systemNotificationPermission === 'granted' ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              Activo
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                              No activado
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-300 mt-1 max-w-xl leading-relaxed">
                          {systemNotificationPermission === 'granted'
                            ? 'Recibirás avisos directos en la barra de notificación de tu celular o en la pantalla de tu computadora al recibir nuevas incidencias, canalizaciones o tareas.'
                            : 'Permite que los avisos importantes aparezcan en la barra de notificaciones de tu celular o en el centro de avisos de tu PC aunque la app esté en segundo plano.'}
                        </p>
                        <div className="flex flex-wrap items-center gap-3 mt-2 text-[11px] text-slate-400">
                          <span className="flex items-center gap-1">
                            <Smartphone className="w-3.5 h-3.5 text-indigo-400" /> Barra de notificación móvil
                          </span>
                          <span>•</span>
                          <span className="flex items-center gap-1">
                            <Laptop className="w-3.5 h-3.5 text-indigo-400" /> Avisos de escritorio PC
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 self-start md:self-center flex-shrink-0">
                      {systemNotificationPermission === 'granted' ? (
                        <button
                          type="button"
                          onClick={handleTestSystemNotification}
                          className="px-4 py-2.5 bg-white/10 hover:bg-white/20 active:scale-95 text-white text-xs font-bold rounded-xl transition border border-white/20 shadow-sm flex items-center gap-1.5 cursor-pointer"
                        >
                          <BellRing className="w-4 h-4 text-emerald-400" />
                          Probar notificación
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={handleRequestSystemNotifications}
                          className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 active:scale-95 text-white text-xs font-bold rounded-xl transition shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 cursor-pointer"
                        >
                          <Bell className="w-4 h-4" />
                          Activar notificaciones
                        </button>
                      )}
                    </div>
                  </div>

                  {systemNotificationPermission === 'denied' && (
                    <div className="mt-3 pt-3 border-t border-rose-500/20 text-xs text-rose-300 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
                      <span>Las notificaciones están bloqueadas en tu navegador. Toca el candado o icono de permisos en la barra de direcciones de tu navegador para permitirlas.</span>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-3">
                {notifications.length === 0 ? (
                  <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center">
                    <Send className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-500 font-medium">No tienes notificaciones aún.</p>
                  </div>
                ) : (
                  notifications.map((notif) => (
                    <div 
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setIsNotifSelectionMode(true);
                        setSelectedNotifications(prev => [...prev, notif.id]);
                      }}
                      className={cn(
                        "p-4 rounded-xl border transition-all cursor-pointer relative overflow-hidden",
                        selectedNotifications.includes(notif.id) ? "border-indigo-600 ring-2 ring-indigo-100" : "border-slate-100",
                        notif.read 
                          ? "bg-white opacity-75" 
                          : "bg-indigo-50 border-indigo-100 shadow-sm"
                      )}
                    >
                      {isNotifSelectionMode && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-600" />
                      )}
                      <div className="flex justify-between items-start mb-1">
                        <div className="flex items-center gap-2">
                          {isNotifSelectionMode && (
                            <div className={cn(
                              "w-4 h-4 rounded border flex items-center justify-center transition-all",
                              selectedNotifications.includes(notif.id) ? "bg-indigo-600 border-indigo-600" : "border-slate-300 bg-white"
                            )}>
                              {selectedNotifications.includes(notif.id) && <CheckCircle2 className="w-3 h-3 text-white" />}
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            {notif.type === 'teacher_chat' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 flex items-center gap-1">
                                <MessageSquare className="w-3 h-3" />
                                Chat
                              </span>
                            )}
                            <h3 className={cn("font-bold", notif.read ? "text-slate-700" : "text-indigo-900")}>
                              {notif.title}
                            </h3>
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {format(notif.createdAt, "dd/MM HH:mm")}
                        </span>
                      </div>
                      <p className={cn("text-sm", notif.read ? "text-slate-500" : "text-indigo-700")}>
                        {notif.message}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          )}

          {activeTab === 'users' && can('canViewUsers') && (
            <motion.div
              key="users"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <UserManagement 
                profile={profile} 
                coordinators={coordinators} 
                teachers={teachers} 
                psychologists={psychologists}
                directives={directives}
                admins={admins}
                blockedUsers={blockedUsers}
                addLog={addLog}
                canManageUsers={can('canManageUsers')}
                canAssignPsychologist={can('canAssignPsychologist')}
                systemSettings={effectiveSystemSettings}
                firestoreRolePermissions={firestoreRolePermissions}
                sendNotification={sendNotification}
                sendEmail={sendEmail}
              />
            </motion.div>
          )}

          {activeTab === 'tasks' && can('canViewTasks') && (
            <motion.div
              key="tasks"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <TaskManager
                profile={profile}
                tasks={tasks}
                coordinators={coordinators}
                teachers={teachers}
                psychologists={psychologists}
                directives={directives}
                admins={admins}
                addLog={addLog}
                systemSettings={effectiveSystemSettings}
                sendNotification={sendNotification}
                canCreateTask={can('canCreateTask')}
                canSendCongratulations={can('canSendCongratulations')}
                highlightedTaskId={highlightedTaskId}
                onClearHighlightedTask={() => setHighlightedTaskId(null)}
              />
            </motion.div>
          )}

          {activeTab === 'add-incident' && can('canCreateIncident') && (
            <motion.div
              key="add-incident"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <IncidentForm
                profile={profile}
                coordinators={coordinators}
                teachers={teachers}
                psychologists={psychologists}
                directives={directives}
                admins={admins}
                onSuccess={() => setActiveTab('incidents')}
                onCancel={() => setActiveTab('incidents')}
                sendNotification={sendNotification}
                notifyIncidentInvolvedUsers={notifyIncidentInvolvedUsers}
                sendEmail={sendEmail}
                systemSettings={effectiveSystemSettings}
                addLog={addLog}
              />
            </motion.div>
          )}

          {activeTab === 'settings' && can('canViewSettings') && (
            <motion.div
              key="settings"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              <div className="mb-8">
                <h1 className="text-2xl font-bold text-slate-900">Configuración del Sistema</h1>
                <p className="text-slate-500">Administra las categorías de incidencias y los respaldos del sistema</p>
              </div>

              {/* Database Export & Backup / Import Card (Superadmin) */}
              {isSuperAdmin && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <Database className="w-5 h-5 text-indigo-600" />
                        Respaldo y Restauración de Base de Datos
                      </h2>
                      <p className="text-sm text-slate-500 mt-1">Exporta la base de datos completa a un archivo JSON o restaura datos previamente exportados.</p>
                    </div>
                  </div>
                  <div className="p-6 flex flex-wrap gap-4 items-center">
                    <button
                      onClick={exportDatabase}
                      disabled={isExportingDb}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold shadow-sm transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                    >
                      <Download className="w-4 h-4 text-white" />
                      {isExportingDb ? 'Exportando...' : 'Exportar Base de Datos (JSON)'}
                    </button>

                    <label className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold shadow-sm transition-colors flex items-center gap-2 cursor-pointer">
                      <Upload className="w-4 h-4 text-white" />
                      {isImportingDb ? 'Importando...' : 'Importar Base de Datos (JSON)'}
                      <input
                        type="file"
                        accept=".json"
                        onChange={handleImportDatabaseFile}
                        disabled={isImportingDb}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              )}

              {/* Seed / Initialize Database Card */}
              {isSuperAdmin && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                  <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <Database className="w-5 h-5 text-indigo-600" />
                        Inicialización de Base de Datos
                      </h2>
                      <p className="text-sm text-slate-500 mt-1">Carga las colecciones de ajustes, usuarios administradores e incidencias de ejemplo en Firestore.</p>
                    </div>
                  </div>
                  <div className="p-6">
                    <button
                      onClick={seedDatabaseData}
                      disabled={isSeeding}
                      className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-sm transition-colors flex items-center gap-2 cursor-pointer"
                    >
                      <Database className="w-4 h-4 text-white" />
                      {isSeeding ? 'Inicializando datos...' : 'Cargar / Inicializar Datos de Ejemplo'}
                    </button>
                  </div>
                </div>
              )}

              {/* Tiempo de Vida de los Mensajes del Chat Docente Cifrado (SuperAdmin) */}
              {isSuperAdmin && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Clock className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        Tiempo de Vida de Mensajes - Chat Docente
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Configura el período de autodestrucción automática tras el cual los mensajes, fotos y archivos adjuntos del canal secreto de docentes se eliminan permanentemente.
                      </p>
                    </div>
                    <span className="text-xs font-black px-3.5 py-1.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0 self-start sm:self-auto">
                      Actualmente: {systemSettings.teacherChatTtlHours ?? 6} horas
                    </span>
                  </div>
                  <div className="p-6 space-y-5">
                    {/* Botones de selección rápida */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wider">
                        Opciones de Duración Rápidas
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { hours: 1, label: '1 hora (Ultra efímero)' },
                          { hours: 2, label: '2 horas' },
                          { hours: 4, label: '4 horas' },
                          { hours: 6, label: '6 horas (Predeterminado)' },
                          { hours: 12, label: '12 horas' },
                          { hours: 24, label: '24 horas (1 Día)' },
                          { hours: 48, label: '48 horas (2 Días)' },
                          { hours: 72, label: '72 horas (3 Días)' },
                          { hours: 168, label: '168 horas (7 Días)' }
                        ].map((preset) => {
                          const isSelected = (systemSettings.teacherChatTtlHours ?? 6) === preset.hours;
                          return (
                            <button
                              key={preset.hours}
                              type="button"
                              onClick={async () => {
                                try {
                                  await setDoc(doc(db, 'settings', 'global'), {
                                    teacherChatTtlHours: preset.hours
                                  }, { merge: true });
                                  setSystemSettings(prev => ({ ...prev, teacherChatTtlHours: preset.hours }));
                                  setChatTtlCustomInput(preset.hours);
                                  await addLog('Modificó tiempo de vida del chat docente', `Nuevo tiempo: ${preset.hours} horas`);
                                } catch (e) {
                                  console.error('Error saving chat TTL:', e);
                                }
                              }}
                              className={cn(
                                "px-3.5 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 border cursor-pointer",
                                isSelected
                                  ? "bg-indigo-600 text-white border-indigo-600 shadow-md scale-105"
                                  : "bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                              )}
                            >
                              <Clock className="w-3.5 h-3.5" />
                              <span>{preset.label}</span>
                              {isSelected && <Check className="w-3.5 h-3.5 ml-0.5" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Input personalizado */}
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                      <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-2">
                        O especificar duración personalizada (en horas):
                      </label>
                      <div className="flex flex-wrap items-center gap-2.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min="1"
                            max="720"
                            value={chatTtlCustomInput}
                            onChange={(e) => setChatTtlCustomInput(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-24 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-sm font-bold text-slate-800 dark:text-white text-center focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none"
                          />
                          <span className="text-xs text-slate-500 font-medium">horas</span>
                        </div>
                        <button
                          type="button"
                          onClick={async () => {
                            const val = chatTtlCustomInput;
                            if (val < 1) return;
                            try {
                              await setDoc(doc(db, 'settings', 'global'), {
                                teacherChatTtlHours: val
                              }, { merge: true });
                              setSystemSettings(prev => ({ ...prev, teacherChatTtlHours: val }));
                              await addLog('Modificó tiempo de vida del chat docente', `Nuevo tiempo personalizado: ${val} horas`);
                              setChatTtlSavedFeedback(true);
                              setTimeout(() => setChatTtlSavedFeedback(false), 2500);
                            } catch (e) {
                              console.error('Error saving custom TTL:', e);
                            }
                          }}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
                        >
                          <Save className="w-3.5 h-3.5" />
                          Guardar horas
                        </button>
                        {chatTtlSavedFeedback && (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> ¡Guardado con éxito!
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Hidden Secrets Card per requirement */}

              {/* Categorías de Incidencia */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                    Categorías de Incidencia
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                    Agrega, modifica o elimina las categorías elegibles para el reporte de incidencias.
                  </p>
                </div>
                <div className="p-6 space-y-4">
                  {(isSuperAdmin || profile.role === 'ADMIN' || profile.role === 'DIRECTIVE' || profile.role === 'COORDINATOR') && (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={newCategory}
                        onChange={(e) => setNewCategory(e.target.value)}
                        placeholder="Escribe el nombre de la nueva categoría..."
                        className="flex-1 bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-sm font-medium text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                        onKeyDown={async (e) => {
                          if (e.key === 'Enter') {
                            if (!newCategory.trim()) return;
                            const catToAdd = newCategory.trim();
                            const currentCats = systemSettings.categories || DEFAULT_SETTINGS.categories || [];
                            if (currentCats.includes(catToAdd)) {
                              setNewCategory('');
                              return;
                            }
                            const updatedCategories = [...currentCats, catToAdd];
                            setSystemSettings(prev => ({ ...prev, categories: updatedCategories }));
                            setNewCategory('');
                            try {
                              await setDoc(doc(db, 'settings', 'global'), {
                                categories: updatedCategories
                              }, { merge: true });
                              await addLog('Creó una nueva categoría', `Categoría: ${catToAdd}`);
                            } catch (error) {
                              console.error("Error adding category:", error);
                            }
                          }
                        }}
                      />
                      <button
                        onClick={async () => {
                          if (!newCategory.trim()) return;
                          const catToAdd = newCategory.trim();
                          const currentCats = systemSettings.categories || DEFAULT_SETTINGS.categories || [];
                          if (currentCats.includes(catToAdd)) {
                            setNewCategory('');
                            return;
                          }
                          const updatedCategories = [...currentCats, catToAdd];
                          setSystemSettings(prev => ({ ...prev, categories: updatedCategories }));
                          setNewCategory('');
                          try {
                            await setDoc(doc(db, 'settings', 'global'), {
                              categories: updatedCategories
                            }, { merge: true });
                            await addLog('Creó una nueva categoría', `Categoría: ${catToAdd}`);
                          } catch (error) {
                            console.error("Error adding category:", error);
                          }
                        }}
                        className="bg-indigo-600 dark:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-bold hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-all flex items-center gap-2 cursor-pointer shadow-sm text-sm"
                      >
                        <Plus className="w-4 h-4" />
                        Agregar Categoría
                      </button>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                    {(systemSettings.categories || DEFAULT_SETTINGS.categories || []).map((cat) => {
                      const isEditingThis = editingCategory?.original === cat;
                      const isDeletingThis = deletingCategory === cat;
                      return (
                        <div key={cat} className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/80 dark:border-slate-700/80 hover:border-slate-300 dark:hover:border-slate-600 transition-all group min-h-[50px]">
                          {isEditingThis ? (
                            <div className="flex items-center gap-2 w-full">
                              <input
                                type="text"
                                value={editingCategory.name}
                                onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
                                className="flex-1 bg-white dark:bg-slate-900 border border-indigo-300 dark:border-indigo-600 rounded-lg px-3 py-1 text-sm font-semibold text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                                autoFocus
                                onKeyDown={async (e) => {
                                  if (e.key === 'Enter') {
                                    if (!editingCategory.name.trim()) return;
                                    const oldName = editingCategory.original;
                                    const newName = editingCategory.name.trim();
                                    if (oldName === newName) {
                                      setEditingCategory(null);
                                      return;
                                    }
                                    const currentCats = systemSettings.categories || DEFAULT_SETTINGS.categories || [];
                                    const updatedCategories = currentCats.map(c => c === oldName ? newName : c);
                                    setSystemSettings(prev => ({ ...prev, categories: updatedCategories }));
                                    setEditingCategory(null);
                                    try {
                                      await setDoc(doc(db, 'settings', 'global'), {
                                        categories: updatedCategories
                                      }, { merge: true });
                                      await addLog('Modificó una categoría', `De: "${oldName}" a: "${newName}"`);
                                    } catch (error) {
                                      console.error("Error updating category:", error);
                                    }
                                  } else if (e.key === 'Escape') {
                                    setEditingCategory(null);
                                  }
                                }}
                              />
                              <button
                                onClick={async () => {
                                  if (!editingCategory.name.trim()) return;
                                  const oldName = editingCategory.original;
                                  const newName = editingCategory.name.trim();
                                  if (oldName === newName) {
                                    setEditingCategory(null);
                                    return;
                                  }
                                  const currentCats = systemSettings.categories || DEFAULT_SETTINGS.categories || [];
                                  const updatedCategories = currentCats.map(c => c === oldName ? newName : c);
                                  setSystemSettings(prev => ({ ...prev, categories: updatedCategories }));
                                  setEditingCategory(null);
                                  try {
                                    await setDoc(doc(db, 'settings', 'global'), {
                                      categories: updatedCategories
                                    }, { merge: true });
                                    await addLog('Modificó una categoría', `De: "${oldName}" a: "${newName}"`);
                                  } catch (error) {
                                    console.error("Error updating category:", error);
                                  }
                                }}
                                title="Guardar cambio"
                                className="p-1.5 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/60 rounded-lg transition-all cursor-pointer"
                              >
                                <Check className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => setEditingCategory(null)}
                                title="Cancelar"
                                className="p-1.5 bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600 rounded-lg transition-all cursor-pointer"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : isDeletingThis ? (
                            <div className="flex items-center justify-between w-full gap-2 animate-fadeIn">
                              <span className="text-xs font-bold text-rose-600 dark:text-rose-400 truncate">
                                ¿Confirmas eliminar?
                              </span>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <button
                                  onClick={async () => {
                                    const currentCats = systemSettings.categories || DEFAULT_SETTINGS.categories || [];
                                    const updatedCategories = currentCats.filter(c => c !== cat);
                                    setSystemSettings(prev => ({ ...prev, categories: updatedCategories }));
                                    setDeletingCategory(null);
                                    try {
                                      await setDoc(doc(db, 'settings', 'global'), {
                                        categories: updatedCategories
                                      }, { merge: true });
                                      await addLog('Eliminó una categoría', `Categoría: ${cat}`);
                                    } catch (error) {
                                      console.error("Error removing category:", error);
                                    }
                                  }}
                                  className="px-2.5 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-all cursor-pointer shadow-sm"
                                >
                                  Sí, eliminar
                                </button>
                                <button
                                  onClick={() => setDeletingCategory(null)}
                                  className="px-2 py-1 bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold transition-all cursor-pointer"
                                >
                                  Cancelar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{cat}</span>
                              {(isSuperAdmin || profile.role === 'ADMIN' || profile.role === 'DIRECTIVE' || profile.role === 'COORDINATOR') && (
                                <div className="flex items-center gap-1 opacity-90 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={() => {
                                      setDeletingCategory(null);
                                      setEditingCategory({ original: cat, name: cat });
                                    }}
                                    title="Modificar nombre de categoría"
                                    className="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 rounded-lg transition-all cursor-pointer"
                                  >
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={() => {
                                      setEditingCategory(null);
                                      setDeletingCategory(cat);
                                    }}
                                    title="Eliminar categoría"
                                    className="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 rounded-lg transition-all cursor-pointer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Notificaciones del Sistema en el Dispositivo (Móvil y PC) */}
              <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
                <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <Bell className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                        Notificaciones en Barra del Dispositivo (Celular y PC)
                      </h2>
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        Controla los avisos nativos en la barra de notificaciones del celular o centro de notificaciones en PC.
                      </p>
                    </div>
                    <div>
                      {systemNotificationPermission === 'granted' ? (
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Activadas
                        </span>
                      ) : (
                        <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1.5">
                          <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> No activadas
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      {systemNotificationPermission === 'granted'
                        ? 'Tu dispositivo está configurado para recibir alertas visuales y con sonido.'
                        : 'Permite las notificaciones para no perderte incidencias ni canalizaciones prioritarias.'}
                    </p>
                    <p className="text-slate-500">Funciona en Android (barra superior), iOS PWA y PC (Windows/Mac/Linux).</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {systemNotificationPermission === 'granted' ? (
                      <button
                        type="button"
                        onClick={handleTestSystemNotification}
                        className="px-4 py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-xl transition border border-indigo-200 shadow-sm flex items-center gap-2 cursor-pointer"
                      >
                        <BellRing className="w-4 h-4 text-indigo-600" />
                        Probar notificación
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleRequestSystemNotifications}
                        className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition shadow-md shadow-indigo-200 flex items-center gap-2 cursor-pointer"
                      >
                        <Bell className="w-4 h-4" />
                        Activar en este dispositivo
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {isSuperAdmin && (
                <>
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6 border-b border-slate-100">
                      <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                        <Mail className="w-5 h-5 text-indigo-600" />
                        Notificaciones por Correo
                      </h2>
                      <p className="text-sm text-slate-500 mt-1">Habilita o deshabilita el envío de correos electrónicos automáticos.</p>
                    </div>
                    <div className="p-6 flex items-center justify-between">
                      <span className="font-medium text-slate-700">Estado del servicio</span>
                      <button
                        onClick={async () => {
                          try {
                            await setDoc(doc(db, 'settings', 'global'), {
                              emailNotificationsEnabled: !systemSettings.emailNotificationsEnabled
                            }, { merge: true });
                          } catch (error) {
                            console.error("Error updating email settings:", error);
                          }
                        }}
                        className={cn(
                          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2",
                          systemSettings.emailNotificationsEnabled ? "bg-indigo-600" : "bg-slate-200"
                        )}
                      >
                        <span
                          className={cn(
                            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                            systemSettings.emailNotificationsEnabled ? "translate-x-6" : "translate-x-1"
                          )}
                        />
                      </button>
                    </div>
                  </div>

                  {/* Super Admin Mass Test & Broadcast Message Card */}
                  {can('canSendMassMessages') && (
                    <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                      <div className="p-6 border-b border-slate-100 bg-gradient-to-r from-indigo-900 to-slate-900 text-white">
                        <h2 className="text-lg font-bold flex items-center gap-2">
                          <Send className="w-5 h-5 text-indigo-400" />
                          Envío de Mensaje de Prueba y Difusión Masiva
                        </h2>
                        <p className="text-sm text-indigo-200 mt-1">
                          Envía un mensaje de prueba como notificación en la aplicación y/o por correo electrónico a todos los usuarios y correos dados de alta en el sistema.
                        </p>
                      </div>

                      <div className="p-6 space-y-5">
                        <div>
                          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                            Asunto / Título del Mensaje
                          </label>
                          <input
                            type="text"
                            value={testSubject}
                            onChange={(e) => setTestSubject(e.target.value)}
                            placeholder="Ej. Mensaje de Prueba - Sistema DUNOR"
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-1.5">
                            Contenido del Mensaje
                          </label>
                          <textarea
                            rows={3}
                            value={testBody}
                            onChange={(e) => setTestBody(e.target.value)}
                            placeholder="Escribe el mensaje de prueba que recibirán los usuarios..."
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-bold text-slate-600 uppercase tracking-wider mb-2">
                            Canales de Envío
                          </label>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <label className={cn(
                              "flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all",
                              sendSystemNotifCheck ? "bg-indigo-50/70 border-indigo-200 text-indigo-900 font-bold" : "bg-slate-50 border-slate-200 text-slate-600"
                            )}>
                              <input
                                type="checkbox"
                                checked={sendSystemNotifCheck}
                                onChange={(e) => setSendSystemNotifCheck(e.target.checked)}
                                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                              />
                              <div className="flex flex-col">
                                <span className="text-xs">Notificación en la App (Campana)</span>
                                <span className="text-[11px] font-normal text-slate-500">Crea una notificación interna para cada usuario</span>
                              </div>
                            </label>

                            <label className={cn(
                              "flex items-center gap-3 p-3.5 rounded-xl border cursor-pointer transition-all",
                              sendEmailNotifCheck ? "bg-indigo-50/70 border-indigo-200 text-indigo-900 font-bold" : "bg-slate-50 border-slate-200 text-slate-600"
                            )}>
                              <input
                                type="checkbox"
                                checked={sendEmailNotifCheck}
                                onChange={(e) => setSendEmailNotifCheck(e.target.checked)}
                                className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                              />
                              <div className="flex flex-col">
                                <span className="text-xs">Correo Electrónico (Servidor/API)</span>
                                <span className="text-[11px] font-normal text-slate-500">Envía un e-mail a los correos registrados</span>
                              </div>
                            </label>
                          </div>
                        </div>

                        {testBroadcastResult && (
                          <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl text-xs whitespace-pre-line font-medium leading-relaxed">
                            {testBroadcastResult}
                          </div>
                        )}

                        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                          <button
                            type="button"
                            onClick={handleOpenMailtoClient}
                            className="w-full sm:w-auto px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs flex items-center justify-center gap-2 border border-slate-200 transition-all cursor-pointer"
                          >
                            <Mail className="w-4 h-4 text-slate-600" />
                            Abrir Cliente de Correo Directo (Mailto Bcc)
                          </button>

                          <button
                            type="button"
                            onClick={handleSendTestBroadcast}
                            disabled={isSendingTestBroadcast}
                            className="w-full sm:w-auto px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-200 transition-all cursor-pointer disabled:opacity-50"
                          >
                            {isSendingTestBroadcast ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Enviando mensaje a todos...
                              </>
                            ) : (
                              <>
                                <Send className="w-4 h-4" />
                                Enviar Mensaje a Todos los Usuarios
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}
            </motion.div>
          )}

          {activeTab === 'logs' && can('canViewLogs') && (
            <motion.div
              key="logs"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2.5">
                    <div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl">
                      <History className="w-5 h-5" />
                    </div>
                    <div>
                      <h1 className="text-2xl font-bold text-slate-900">Logs y Auditoría del Sistema</h1>
                      <p className="text-xs sm:text-sm text-slate-500">
                        Historial de actividad con autor de creación, canalizaciones y registros
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {logs.length > 0 && (
                    <button
                      onClick={() => {
                        const csvRows: string[] = [];
                        csvRows.push(['Fecha', 'Hora', 'Módulo', 'Acción', 'Creador/Responsable', 'Rol Creador', 'Usuario Actor', 'Rol Actor', 'Detalles'].join(','));
                        logs.forEach(l => {
                          const mod = l.module || getModuleFromAction(l.action);
                          const crName = l.creatorName || l.userName;
                          const crRole = l.creatorRole || l.userRole || '';
                          const d = `"${(l.details || '').replace(/"/g, '""')}"`;
                          csvRows.push([
                            format(l.timestamp, "yyyy-MM-dd"),
                            format(l.timestamp, "HH:mm:ss"),
                            `"${mod}"`,
                            `"${l.action.replace(/"/g, '""')}"`,
                            `"${crName.replace(/"/g, '""')}"`,
                            `"${crRole}"`,
                            `"${l.userName.replace(/"/g, '""')}"`,
                            `"${l.userRole || ''}"`,
                            d
                          ].join(','));
                        });
                        const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.setAttribute('href', url);
                        link.setAttribute('download', `auditoria_logs_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                      className="flex items-center gap-1.5 bg-white border border-slate-200 text-slate-700 px-3 py-2 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all shadow-sm cursor-pointer"
                      title="Exportar logs a CSV"
                    >
                      <Download className="w-3.5 h-3.5 text-slate-500" />
                      Exportar CSV
                    </button>
                  )}

                  {logs.length > 0 && isSuperAdmin && (
                    <button
                      onClick={() => {
                        setConfirmModal({
                          isOpen: true,
                          title: 'Borrar Historial de Logs',
                          message: '¿Estás seguro de que deseas eliminar todos los registros de actividad? Esta acción no se puede deshacer.',
                          onConfirm: async () => {
                            try {
                              const batch = writeBatch(db);
                              logs.forEach((log) => {
                                if (log.id) {
                                  batch.delete(doc(db, 'logs', log.id));
                                }
                              });
                              await batch.commit();
                              setConfirmModal(prev => ({ ...prev, isOpen: false }));
                            } catch (error) {
                              console.error("Error clearing logs:", error);
                            }
                          }
                        });
                      }}
                      className="flex items-center gap-1.5 bg-red-50 text-red-600 px-3 py-2 rounded-xl text-xs font-bold hover:bg-red-100 transition-all border border-red-100 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Borrar Historial
                    </button>
                  )}
                </div>
              </div>

              {/* Filter and Search Bar */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                  {/* Search Input */}
                  <div className="sm:col-span-5 relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Buscar por creador, acción, detalle, alumno o usuario..."
                      value={logSearchTerm}
                      onChange={(e) => setLogSearchTerm(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent bg-slate-50/50"
                    />
                    {logSearchTerm && (
                      <button
                        onClick={() => setLogSearchTerm('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Module Filter */}
                  <div className="sm:col-span-3">
                    <select
                      value={logModuleFilter}
                      onChange={(e) => setLogModuleFilter(e.target.value)}
                      className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      <option value="ALL">📁 Todos los Módulos</option>
                      <option value="Incidencias">🚨 Incidencias</option>
                      <option value="Canalizaciones">🧠 Canalizaciones</option>
                      <option value="Expedientes">📂 Expedientes</option>
                      <option value="Informes">📊 Informes</option>
                      <option value="Tareas / Felicitaciones">📋 Tareas / Felicitaciones</option>
                      <option value="Usuarios">👥 Usuarios</option>
                      <option value="Permisos">🛡️ Permisos</option>
                      <option value="Configuración">⚙️ Configuración</option>
                    </select>
                  </div>

                  {/* Role Filter */}
                  <div className="sm:col-span-3">
                    <select
                      value={logRoleFilter}
                      onChange={(e) => setLogRoleFilter(e.target.value)}
                      className="w-full px-3 py-2 text-xs sm:text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                    >
                      <option value="ALL">👤 Todos los Roles</option>
                      <option value="ADMIN">Administrador</option>
                      <option value="DIRECTIVE">Directivo</option>
                      <option value="COORDINATOR">Coordinador</option>
                      <option value="PSYCHOLOGIST">Psicólogo</option>
                      <option value="TEACHER">Docente</option>
                    </select>
                  </div>

                  {/* Clear button */}
                  <div className="sm:col-span-1 flex items-center">
                    {(logSearchTerm || logModuleFilter !== 'ALL' || logRoleFilter !== 'ALL') && (
                      <button
                        onClick={() => {
                          setLogSearchTerm('');
                          setLogModuleFilter('ALL');
                          setLogRoleFilter('ALL');
                        }}
                        className="w-full py-2 px-2 text-xs font-semibold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all flex items-center justify-center gap-1"
                        title="Restablecer filtros"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        <span className="sm:hidden">Limpiar</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Filter info badges */}
                <div className="flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100 flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-700">
                      Mostrando {
                        logs.filter(log => {
                          const mod = log.module || getModuleFromAction(log.action);
                          if (logModuleFilter !== 'ALL' && mod !== logModuleFilter) return false;
                          if (logRoleFilter !== 'ALL' && log.userRole !== logRoleFilter && log.creatorRole !== logRoleFilter) return false;
                          if (logSearchTerm.trim()) {
                            const q = logSearchTerm.toLowerCase();
                            const match = (log.action || '').toLowerCase().includes(q) ||
                              (log.details || '').toLowerCase().includes(q) ||
                              (log.userName || '').toLowerCase().includes(q) ||
                              (log.userEmail || '').toLowerCase().includes(q) ||
                              (log.creatorName || '').toLowerCase().includes(q) ||
                              (log.creatorEmail || '').toLowerCase().includes(q) ||
                              (mod || '').toLowerCase().includes(q);
                            if (!match) return false;
                          }
                          return true;
                        }).length
                      } de {logs.length} registros
                    </span>
                    {(logModuleFilter !== 'ALL' || logRoleFilter !== 'ALL' || logSearchTerm) && (
                      <span className="bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-md text-[11px]">
                        Filtro activo
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-3 text-[11px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"></span> Creación / Registro
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-blue-500 inline-block"></span> Actualización
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-rose-500 inline-block"></span> Eliminación
                    </span>
                  </div>
                </div>
              </div>

              {/* Logs Table */}
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-100">
                        <th className="px-4 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Fecha / Hora</th>
                        <th className="px-4 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Módulo</th>
                        <th className="px-4 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Creador / Responsable</th>
                        <th className="px-4 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Usuario Actor</th>
                        <th className="px-4 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Acción Realizada</th>
                        <th className="px-4 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider">Detalles del Registro</th>
                        <th className="px-3 py-3.5 text-xs font-bold text-slate-500 uppercase tracking-wider text-right">Info</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs sm:text-sm">
                      {(() => {
                        const displayedLogs = logs.filter(log => {
                          const mod = log.module || getModuleFromAction(log.action);
                          if (logModuleFilter !== 'ALL' && mod !== logModuleFilter) return false;
                          if (logRoleFilter !== 'ALL' && log.userRole !== logRoleFilter && log.creatorRole !== logRoleFilter) return false;
                          if (logSearchTerm.trim()) {
                            const q = logSearchTerm.toLowerCase();
                            const match = (log.action || '').toLowerCase().includes(q) ||
                              (log.details || '').toLowerCase().includes(q) ||
                              (log.userName || '').toLowerCase().includes(q) ||
                              (log.userEmail || '').toLowerCase().includes(q) ||
                              (log.creatorName || '').toLowerCase().includes(q) ||
                              (log.creatorEmail || '').toLowerCase().includes(q) ||
                              (mod || '').toLowerCase().includes(q);
                            if (!match) return false;
                          }
                          return true;
                        });

                        if (displayedLogs.length === 0) {
                          return (
                            <tr>
                              <td colSpan={7} className="px-6 py-12 text-center text-slate-400 italic">
                                <History className="w-8 h-8 text-slate-300 mx-auto mb-2 opacity-50" />
                                No se encontraron registros de actividad con los filtros seleccionados.
                              </td>
                            </tr>
                          );
                        }

                        return displayedLogs.map((log) => {
                          const mod = log.module || getModuleFromAction(log.action);
                          const creatorName = log.creatorName || log.userName;
                          const creatorEmail = log.creatorEmail || log.userEmail;
                          const creatorRole = log.creatorRole || log.userRole;

                          const isDeleteAction = log.action.includes('Eliminó') || log.action.includes('Eliminación');
                          const isCreateAction = log.action.includes('Creó') || log.action.includes('Asignó') || log.action.includes('Envió') || log.action.includes('Generó');

                          return (
                            <tr
                              key={log.id}
                              className="hover:bg-slate-50/70 transition-colors cursor-pointer group"
                              onClick={() => setSelectedLogDetail(log)}
                            >
                              {/* Date & Time */}
                              <td className="px-4 py-3.5 whitespace-nowrap">
                                <div className="font-semibold text-slate-900 text-xs">
                                  {format(log.timestamp, "dd/MM/yyyy")}
                                </div>
                                <div className="text-[11px] text-slate-400 font-mono">
                                  {format(log.timestamp, "HH:mm:ss")}
                                </div>
                              </td>

                              {/* Module */}
                              <td className="px-4 py-3.5 whitespace-nowrap">
                                <span className={cn(
                                  "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border",
                                  mod === 'Incidencias' ? "bg-amber-50 text-amber-800 border-amber-200" :
                                  mod === 'Canalizaciones' ? "bg-pink-50 text-pink-800 border-pink-200" :
                                  mod === 'Expedientes' ? "bg-purple-50 text-purple-800 border-purple-200" :
                                  mod === 'Informes' ? "bg-sky-50 text-sky-800 border-sky-200" :
                                  mod === 'Tareas / Felicitaciones' ? "bg-emerald-50 text-emerald-800 border-emerald-200" :
                                  mod === 'Usuarios' ? "bg-indigo-50 text-indigo-800 border-indigo-200" :
                                  mod === 'Permisos' ? "bg-violet-50 text-violet-800 border-violet-200" :
                                  "bg-slate-100 text-slate-700 border-slate-200"
                                )}>
                                  {mod}
                                </span>
                              </td>

                              {/* Creator / Responsible */}
                              <td className="px-4 py-3.5 whitespace-nowrap">
                                <div className="flex items-center gap-1.5">
                                  <div className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-[10px] shrink-0 border border-slate-200">
                                    {creatorName ? creatorName.charAt(0).toUpperCase() : 'U'}
                                  </div>
                                  <div>
                                    <div className="font-bold text-slate-900 text-xs flex items-center gap-1">
                                      {creatorName}
                                      {creatorRole && (
                                        <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded">
                                          {creatorRole}
                                        </span>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-slate-400 truncate max-w-[160px]">
                                      {creatorEmail}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Acting User */}
                              <td className="px-4 py-3.5 whitespace-nowrap">
                                <div className="text-xs font-semibold text-slate-700">
                                  {log.userName}
                                </div>
                                <div className="text-[11px] text-slate-400 truncate max-w-[140px]">
                                  {log.userRole ? `${log.userRole} • ` : ''}{log.userEmail}
                                </div>
                              </td>

                              {/* Action */}
                              <td className="px-4 py-3.5">
                                <span className={cn(
                                  "inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-bold border",
                                  isDeleteAction ? "bg-rose-50 text-rose-700 border-rose-200" :
                                  isCreateAction ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                                  "bg-blue-50 text-blue-700 border-blue-200"
                                )}>
                                  {log.action}
                                </span>
                              </td>

                              {/* Details snippet */}
                              <td className="px-4 py-3.5">
                                <div className="text-xs text-slate-600 max-w-sm truncate" title={log.details}>
                                  {log.details || '-'}
                                </div>
                              </td>

                              {/* View button */}
                              <td className="px-3 py-3.5 text-right whitespace-nowrap">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedLogDetail(log);
                                  }}
                                  className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors cursor-pointer"
                                  title="Ver detalle completo"
                                >
                                  <Eye className="w-4 h-4" />
                                </button>
                              </td>
                            </tr>
                          );
                        });
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Log Detail Modal */}
              <AnimatePresence>
                {selectedLogDetail && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-xl w-full overflow-hidden"
                    >
                      {/* Modal Header */}
                      <div className="p-5 bg-gradient-to-r from-slate-900 to-indigo-950 text-white flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <div className="p-2 bg-indigo-500/20 rounded-xl border border-indigo-400/30">
                            <History className="w-5 h-5 text-indigo-300" />
                          </div>
                          <div>
                            <h3 className="font-bold text-base">Detalle de Actividad en Registro</h3>
                            <p className="text-xs text-indigo-200">
                              {format(selectedLogDetail.timestamp, "dd 'de' MMMM, yyyy - HH:mm:ss")}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => setSelectedLogDetail(null)}
                          className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>

                      {/* Modal Content */}
                      <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
                        {/* Action and Module Header */}
                        <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-slate-100">
                          <div>
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Acción</span>
                            <span className="text-sm font-bold text-slate-900">{selectedLogDetail.action}</span>
                          </div>
                          <span className="px-2.5 py-1 rounded-lg text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                            Módulo: {selectedLogDetail.module || getModuleFromAction(selectedLogDetail.action)}
                          </span>
                        </div>

                        {/* Creator / Author details */}
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            <UserCheck className="w-4 h-4 text-emerald-600" />
                            Creador / Responsable del Registro
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-slate-400 block text-[11px]">Nombre:</span>
                              <span className="font-bold text-slate-800">
                                {selectedLogDetail.creatorName || selectedLogDetail.userName}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[11px]">Rol:</span>
                              <span className="font-semibold text-slate-700">
                                {selectedLogDetail.creatorRole || selectedLogDetail.userRole || 'No especificado'}
                              </span>
                            </div>
                            <div className="sm:col-span-2">
                              <span className="text-slate-400 block text-[11px]">Correo Electrónico:</span>
                              <span className="font-mono text-slate-700 text-[11px]">
                                {selectedLogDetail.creatorEmail || selectedLogDetail.userEmail}
                              </span>
                            </div>
                          </div>
                        </div>

                        {/* Executing user details if distinct */}
                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                            <UserIcon className="w-4 h-4 text-blue-600" />
                            Usuario que ejecutó la operación (Actor)
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-slate-400 block text-[11px]">Usuario:</span>
                              <span className="font-bold text-slate-800">{selectedLogDetail.userName}</span>
                            </div>
                            <div>
                              <span className="text-slate-400 block text-[11px]">Rol en el sistema:</span>
                              <span className="font-semibold text-slate-700">{selectedLogDetail.userRole || 'Usuario'}</span>
                            </div>
                            <div className="sm:col-span-2">
                              <span className="text-slate-400 block text-[11px]">Correo:</span>
                              <span className="font-mono text-slate-700 text-[11px]">{selectedLogDetail.userEmail}</span>
                            </div>
                          </div>
                        </div>

                        {/* Record ID if present */}
                        {selectedLogDetail.recordId && (
                          <div>
                            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1">
                              ID del Registro
                            </span>
                            <div className="bg-slate-100 px-3 py-1.5 rounded-lg text-xs font-mono text-slate-700 break-all select-all">
                              {selectedLogDetail.recordId}
                            </div>
                          </div>
                        )}

                        {/* Full details text */}
                        <div>
                          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block mb-1.5">
                            Contenido y Metadatos del Evento
                          </span>
                          <div className="bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-700 font-sans leading-relaxed whitespace-pre-wrap max-h-48 overflow-y-auto">
                            {selectedLogDetail.details ? (
                              <div className="space-y-1.5">
                                {selectedLogDetail.details.split(' | ').map((part, idx) => (
                                  <div key={idx} className="flex items-start gap-1.5 py-0.5 border-b border-slate-100 last:border-b-0">
                                    <span className="text-indigo-500 font-bold">•</span>
                                    <span className="break-all">{part}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">Sin detalles adicionales registrados.</span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Modal Footer */}
                      <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                        <button
                          onClick={() => {
                            const textToCopy = `Acción: ${selectedLogDetail.action}\nMódulo: ${selectedLogDetail.module || getModuleFromAction(selectedLogDetail.action)}\nCreador: ${selectedLogDetail.creatorName || selectedLogDetail.userName} (${selectedLogDetail.creatorRole || selectedLogDetail.userRole || ''})\nActor: ${selectedLogDetail.userName} (${selectedLogDetail.userEmail})\nFecha: ${format(selectedLogDetail.timestamp, "dd/MM/yyyy HH:mm:ss")}\nDetalles: ${selectedLogDetail.details || ''}`;
                            navigator.clipboard.writeText(textToCopy);
                            showSystemPopup("Copiado", "Los detalles del registro se han copiado al portapapeles.", "success");
                          }}
                          className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-100 px-3 py-2 rounded-xl transition-all shadow-sm"
                        >
                          <Copy className="w-3.5 h-3.5 text-slate-500" />
                          Copiar Detalles
                        </button>

                        <button
                          onClick={() => setSelectedLogDetail(null)}
                          className="px-4 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold hover:bg-slate-900 transition-all cursor-pointer"
                        >
                          Cerrar
                        </button>
                      </div>
                    </motion.div>
                  </div>
                )}
              </AnimatePresence>
            </motion.div>
          )}

          {activeTab === 'referrals' && can('canViewReferrals') && (
            <motion.div
              key="referrals"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <CanalizacionesManager
                referrals={referrals}
                profile={profile}
                coordinators={coordinators}
                psychologists={psychologists}
                directives={directives}
                teachers={teachers}
                admins={admins}
                addLog={addLog}
                isSuperAdmin={isSuperAdmin}
                canCreateReferral={can('canCreateReferral')}
                canDeleteReferral={can('canDeleteReferrals') || isSuperAdmin || profile?.role === 'ADMIN' || profile?.role === 'PSYCHOLOGIST' || (profile?.role && String(profile?.role).toLowerCase().includes('psico'))}
                canManageExpedientes={can('canManageExpedientes')}
                canAddFollowUp={can('canAddFollowUp')}
                highlightedReferralId={highlightedReferralId}
                sendNotification={sendNotification}
                onOpenExpedienteFromReferral={(referral) => {
                  setPreselectedReferralForExpediente(referral);
                  setActiveTab('expedientes');
                }}
              />
            </motion.div>
          )}

          {activeTab === 'expedientes' && can('canViewExpedientes') && (
            <motion.div
              key="expedientes"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <ExpedientesManager
                expedientes={expedientes}
                referrals={referrals}
                profile={profile}
                coordinators={coordinators}
                directives={directives}
                teachers={teachers}
                psychologists={psychologists}
                admins={admins}
                addLog={addLog}
                sendNotification={sendNotification}
                canManageExpedientes={can('canManageExpedientes')}
                preselectedReferral={preselectedReferralForExpediente}
                onClearPreselectedReferral={() => setPreselectedReferralForExpediente(null)}
              />
            </motion.div>
          )}

          {activeTab === 'informes' && can('canViewInformes') && (
            <motion.div
              key="informes"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <InformeManager
                expedientes={expedientes}
                referrals={referrals}
                profile={profile}
                coordinators={coordinators}
                directives={directives}
                admins={admins}
                sendNotification={sendNotification}
                addLog={addLog}
                systemSettings={systemSettings}
              />
            </motion.div>
          )}

          {!tabPriorityOrder.some(item => can(item.key)) && (
            <motion.div
              key="no-access"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-white border border-slate-200 rounded-2xl p-12 text-center shadow-sm"
            >
              <ShieldCheck className="w-16 h-16 text-slate-300 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-slate-800 mb-2">Sin módulos activos</h2>
              <p className="text-slate-500 max-w-md mx-auto">
                Tu rol actual ({ROLE_LABELS[normalizeUserRole(profile?.role) || 'TEACHER']?.name || profile?.role || 'Usuario'}) no tiene permisos habilitados para acceder a ningún menú. Si consideras que esto es un error, por favor solicita apoyo al Administrador.
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
      {/* PWA Install Prompt */}
      <AnimatePresence>
        {showInstallPrompt && (
          <div className="fixed bottom-4 left-4 right-4 z-[100]">
            <motion.div
              initial={{ y: 100, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 100, opacity: 0 }}
              className="bg-white rounded-2xl shadow-2xl border border-indigo-100 p-5 flex items-center gap-4"
            >
              <div className="w-12 h-12 p-1.5 bg-white rounded-xl flex items-center justify-center text-blue-700 shadow-md shadow-indigo-100 flex-shrink-0 border border-slate-100">
                <Logo className="w-full h-full object-contain" appName={systemSettings.appName || 'DASHBOARD DUNOR'} logoUrl={systemSettings.appLogoUrl || "/logo.svg"} />
              </div>
              <div className="flex-1">
                <h4 className="font-bold text-slate-900 text-sm">Instalar {systemSettings.appName || 'DASHBOARD DUNOR'}</h4>
                <p className="text-xs text-slate-500">Añade la app a tu pantalla de inicio para un acceso rápido y mejor experiencia.</p>
              </div>
              <div className="flex flex-col gap-2">
                <button 
                  onClick={handleInstallClick}
                  className="px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg shadow-md shadow-indigo-100"
                >
                  Instalar
                </button>
                <button 
                  onClick={() => {
                    setShowInstallPrompt(false);
                    localStorage.setItem('hasSeenInstallPrompt', 'true');
                  }}
                  className="text-[10px] text-slate-400 font-bold hover:text-slate-600"
                >
                  Más tarde
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Celebration / Congratulation Modal */}
      <AnimatePresence>
        {celebrationData && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-900/80 backdrop-blur-md"
              onClick={async () => {
                const notifToProcess = celebrationData.notif;
                setCelebrationData(null);
                await processNotificationClickAndDelete(notifToProcess);
              }}
            />
            <motion.div
              initial={{ scale: 0.6, opacity: 0, y: 50 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.8, opacity: 0, y: 30 }}
              transition={{ type: "spring", stiffness: 300, damping: 22 }}
              className="relative w-full max-w-lg bg-gradient-to-b from-amber-50 via-white to-amber-50/80 rounded-3xl shadow-2xl border-2 border-amber-300 p-8 text-center overflow-hidden z-10"
            >
              <div className="absolute -top-20 -left-20 w-44 h-44 bg-amber-400/20 rounded-full blur-3xl pointer-events-none" />
              <div className="absolute -bottom-20 -right-20 w-44 h-44 bg-yellow-400/20 rounded-full blur-3xl pointer-events-none" />

              <div className="mx-auto w-20 h-20 bg-gradient-to-tr from-amber-400 via-yellow-400 to-amber-300 rounded-2xl flex items-center justify-center shadow-xl shadow-amber-200/80 mb-5 border-4 border-white animate-bounce">
                <Award className="w-10 h-10 text-amber-950" />
              </div>

              <motion.h2 
                initial={{ scale: 0.8 }}
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ repeat: Infinity, duration: 1.8 }}
                className="text-3xl sm:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-amber-600 via-yellow-600 to-amber-700 tracking-wider mb-2 uppercase drop-shadow-sm"
              >
                🎉 CONGRATULATIONS 🎉
              </motion.h2>

              <p className="text-xs font-bold tracking-widest text-amber-800 uppercase mb-6 bg-amber-100/90 inline-block px-4 py-1.5 rounded-full border border-amber-200 shadow-sm">
                ¡FELICITACIONES Y RECONOCIMIENTO!
              </p>

              <div className="bg-white/95 border border-amber-200/80 rounded-2xl p-5 mb-4 shadow-sm text-left space-y-2">
                <h3 className="font-bold text-amber-950 text-base flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-amber-600 flex-shrink-0" />
                  {celebrationData.title.replace(/^🎉\s*/, '')}
                </h3>
                <p className="text-slate-700 text-sm whitespace-pre-line leading-relaxed pl-7">
                  {celebrationData.message}
                </p>
              </div>

              {/* Countdown / Auto-redirect Progress Bar */}
              <div className="space-y-1.5 mb-5">
                <div className="w-full bg-amber-100/80 h-2 rounded-full overflow-hidden border border-amber-200">
                  <motion.div
                    initial={{ width: "100%" }}
                    animate={{ width: "0%" }}
                    transition={{ duration: 3.5, ease: "linear" }}
                    className="bg-gradient-to-r from-amber-500 to-yellow-500 h-full"
                  />
                </div>
                <p className="text-[11px] font-semibold text-amber-800 flex items-center justify-center gap-1">
                  <Clock className="w-3 h-3 text-amber-600" />
                  <span>Redirigiendo automáticamente al registro en unos segundos...</span>
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => triggerConfetti()}
                  className="px-4 py-3 bg-amber-100/90 hover:bg-amber-200 text-amber-950 font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2 border border-amber-200 cursor-pointer"
                >
                  ✨ Más Confeti
                </button>
                <button
                  onClick={async () => {
                    const notifToProcess = celebrationData.notif;
                    setCelebrationData(null);
                    await processNotificationClickAndDelete(notifToProcess);
                  }}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-amber-500 via-amber-400 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-slate-950 font-extrabold text-sm rounded-xl shadow-lg shadow-amber-200 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <span>Ver Registro</span>
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6"
            >
              <div className="flex items-center gap-4 mb-4 text-red-600">
                <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">{confirmModal.title}</h3>
              </div>
              <p className="text-slate-600 mb-8">{confirmModal.message}</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                  className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={confirmModal.onConfirm}
                  className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-lg shadow-red-100 transition-all"
                >
                  Eliminar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ImageGallery 
        isOpen={galleryConfig.isOpen}
        images={galleryConfig.images}
        currentIndex={galleryConfig.currentIndex}
        onClose={() => setGalleryConfig(prev => ({ ...prev, isOpen: false }))}
      />

      {printIncident && (
        <PrintPreview 
          incident={printIncident} 
          systemSettings={effectiveSystemSettings}
          profile={profile}
          onClose={() => setPrintIncident(null)} 
        />
      )}

      <FirebaseSecretsModal 
        isOpen={showAppSecretsModal} 
        onClose={() => setShowAppSecretsModal(false)} 
      />

      {/* Global System Popup Modal */}
      <AnimatePresence>
        {systemPopup.isOpen && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSystemPopup(prev => ({ ...prev, isOpen: false }))}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-sm bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 rounded-3xl shadow-2xl p-6 overflow-hidden z-10"
            >
              <div className="flex items-start gap-4 mb-4">
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0 shadow-sm",
                  systemPopup.type === 'success' && "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400",
                  systemPopup.type === 'error' && "bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400",
                  systemPopup.type === 'warning' && "bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400",
                  (systemPopup.type === 'info' || systemPopup.type === 'confirm' || !systemPopup.type) && "bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400"
                )}>
                  {systemPopup.type === 'success' && <CheckCircle2 className="w-6 h-6" />}
                  {systemPopup.type === 'error' && <AlertCircle className="w-6 h-6" />}
                  {systemPopup.type === 'warning' && <AlertTriangle className="w-6 h-6" />}
                  {(systemPopup.type === 'info' || systemPopup.type === 'confirm' || !systemPopup.type) && <Sparkles className="w-6 h-6" />}
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white leading-snug">{systemPopup.title}</h3>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1 font-medium leading-relaxed">{systemPopup.message}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-6 pt-4 border-t border-slate-100 dark:border-slate-800">
                {systemPopup.type === 'confirm' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setSystemPopup(prev => ({ ...prev, isOpen: false }))}
                      className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-200 rounded-xl font-bold text-xs transition-all cursor-pointer"
                    >
                      {systemPopup.cancelText || 'Cancelar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (systemPopup.onConfirm) systemPopup.onConfirm();
                        setSystemPopup(prev => ({ ...prev, isOpen: false }));
                      }}
                      className="flex-1 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer"
                    >
                      {systemPopup.confirmText || 'Confirmar'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      if (systemPopup.onConfirm) systemPopup.onConfirm();
                      setSystemPopup(prev => ({ ...prev, isOpen: false }));
                    }}
                    className="w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold text-xs shadow-md transition-all cursor-pointer"
                  >
                    {systemPopup.confirmText || 'Entendido'}
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating In-App Live Toast Notification Banner */}
      <AnimatePresence>
        {liveToast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            onClick={() => {
              handleNotificationClick(liveToast);
              setLiveToast(null);
            }}
            className="fixed bottom-6 right-6 z-[99990] max-w-sm w-full bg-slate-900/95 dark:bg-slate-950/95 text-white p-4 rounded-2xl shadow-2xl border border-indigo-500/30 backdrop-blur-md cursor-pointer hover:border-indigo-400 transition-all group"
          >
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-indigo-600/30 border border-indigo-400/30 flex items-center justify-center shrink-0 text-indigo-400 group-hover:scale-105 transition-transform">
                {liveToast.type === 'teacher_chat' ? (
                  <MessageSquare className="w-5 h-5 text-emerald-400" />
                ) : (
                  <Bell className="w-5 h-5 text-indigo-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-xs font-bold text-white truncate tracking-wide">
                    {liveToast.title}
                  </h4>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setLiveToast(null);
                    }}
                    className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-xs text-slate-300 line-clamp-2 mt-0.5">
                  {liveToast.message}
                </p>
                <div className="flex items-center gap-1.5 mt-2 text-[10px] text-indigo-300 font-medium">
                  <span>Toca para abrir</span>
                  <span>→</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Teacher Secret Internal Chat (Exclusivo para el rol de docente con activación secreta en las 4 esquinas) */}
      <TeacherSecretChat
        currentUser={profile}
        allUsers={teachers}
        sendNotification={sendNotification}
        externalOpenPartner={chatOpenPartner}
        onCloseExternal={() => setChatOpenPartner(null)}
        ttlHours={systemSettings.teacherChatTtlHours ?? 6}
      />
    </ErrorBoundary>
  );
}

// --- Sub-components ---

const SidebarItem = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) => (
  <button
    onClick={onClick}
    className={cn(
      "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-medium",
      active
        ? "bg-indigo-50 text-indigo-600"
        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
    )}
  >
    {icon}
    <span>{label}</span>
  </button>
);

interface StudentGroupCardProps {
  studentName: string;
  incidents: Incident[];
  profile: UserProfile;
  coordinators: UserProfile[];
  teachers: UserProfile[];
  psychologists: UserProfile[];
  onMarkReceived: (id: string) => void;
  onUpdateStatus: (inc: Incident, status: IncidentStatus) => void;
  onUpdateReferralStatus: (inc: Incident, status: 'SUGGESTED' | 'IN_PROGRESS') => void;
  onUpdateReferralComments: (inc: Incident, comments: string) => void;
  onUpdateFollowUp: (inc: Incident, followUp: string, history: FollowUpComment[], comment: string) => void;
  onDelete: (inc: Incident) => void;
  onForward: (inc: Incident, adminId: string) => void;
  onOpenGallery: (images: string[], index: number) => void;
  onPrint: (inc: Incident) => void;
  systemSettings: SystemSettings;
  admins: UserProfile[];
  expandedIncidentId?: string | null;
}

const StudentGroupCard: React.FC<StudentGroupCardProps> = ({
  studentName,
  incidents,
  profile,
  coordinators,
  teachers,
  psychologists,
  onMarkReceived,
  onUpdateStatus,
  onUpdateReferralStatus,
  onUpdateReferralComments,
  onUpdateFollowUp,
  onDelete,
  onForward,
  onOpenGallery,
  onPrint,
  systemSettings,
  admins,
  expandedIncidentId,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-all">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 md:p-5 bg-slate-50 dark:bg-slate-800/60 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 flex items-center justify-center font-bold text-base">
            <UserIcon className="w-5 h-5" />
          </div>
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-base">{studentName}</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
              {incidents.length} {incidents.length === 1 ? 'incidencia registrada' : 'incidencias registradas'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-3 py-1 rounded-full border border-indigo-100 dark:border-indigo-800/60">
            {incidents.length}
          </span>
          <ChevronDown className={cn("w-5 h-5 text-slate-400 transition-transform duration-200", isOpen && "rotate-180")} />
        </div>
      </button>

      {isOpen && (
        <div className="p-4 md:p-6 space-y-4 bg-slate-50/50 dark:bg-slate-950/40 border-t border-slate-200 dark:border-slate-800">
          {incidents.map((incident) => (
            <IncidentCard
              key={incident.id}
              incident={incident}
              profile={profile}
              coordinators={coordinators}
              teachers={teachers}
              psychologists={psychologists}
              onMarkReceived={() => onMarkReceived(incident.id)}
              onUpdateStatus={(status) => onUpdateStatus(incident, status)}
              onUpdateReferralStatus={(status) => onUpdateReferralStatus(incident, status)}
              onUpdateReferralComments={(comments) => onUpdateReferralComments(incident, comments)}
              onUpdateFollowUp={(followUp, history, newComment) => onUpdateFollowUp(incident, followUp, history, newComment)}
              onDelete={() => onDelete(incident)}
              onForward={(adminId) => onForward(incident, adminId)}
              onOpenGallery={onOpenGallery}
              onPrint={onPrint}
              systemSettings={systemSettings}
              admins={admins}
              expandedIncidentId={expandedIncidentId}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface IncidentCardProps {
  incident: Incident;
  profile: UserProfile;
  coordinators: UserProfile[];
  teachers: UserProfile[];
  psychologists: UserProfile[];
  onMarkReceived: () => void | Promise<void>;
  onUpdateStatus: (status: IncidentStatus) => void | Promise<void>;
  onUpdateReferralStatus: (status: 'SUGGESTED' | 'IN_PROGRESS') => void | Promise<void>;
  onUpdateReferralComments: (comments: string) => void | Promise<void>;
  onUpdateFollowUp: (followUp: string, history: FollowUpComment[], newCommentText: string) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
  onForward: (adminId: string) => void | Promise<void>;
  onOpenGallery: (images: string[], index: number) => void;
  onPrint: (incident: Incident) => void;
  systemSettings: SystemSettings;
  admins: UserProfile[];
  selectable?: boolean;
  selected?: boolean;
  onSelect?: (id: string) => void;
  expandedIncidentId?: string | null;
}

const IncidentCard: React.FC<IncidentCardProps> = ({ incident, profile, coordinators, teachers, psychologists, onMarkReceived, onUpdateStatus, onUpdateReferralStatus, onUpdateReferralComments, onUpdateFollowUp, onDelete, onForward, onOpenGallery, onPrint, systemSettings, admins, selectable, selected, onSelect, expandedIncidentId }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [referralComments, setReferralComments] = useState(incident.referralComments || '');
  const [isEditingReferralComments, setIsEditingReferralComments] = useState(false);
  const [isEditingFollowUp, setIsEditingFollowUp] = useState(false);

  useEffect(() => {
    if (!isEditingReferralComments) {
      setReferralComments(incident.referralComments || '');
    }
  }, [incident.referralComments, isEditingReferralComments]);

  const role = profile.role;
  const isSuperAdmin = isSuperAdminEmail(profile.email);

  const can = (permissionKey: keyof RolePermissions): boolean => {
    return getRolePermission(profile?.role, permissionKey, systemSettings?.rolePermissions, isSuperAdmin, profile?.customPermissions);
  };

  useEffect(() => {
    if (expandedIncidentId === incident.id) {
      setIsExpanded(true);
      // Scroll into view if needed
      const element = document.getElementById(`incident-${incident.id}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [expandedIncidentId, incident.id]);

  const hasMarkedReceivedRef = useRef(false);
  useEffect(() => {
    if (isExpanded && role === 'COORDINATOR' && !incident.isReceived && !isSuperAdmin && !hasMarkedReceivedRef.current) {
      hasMarkedReceivedRef.current = true;
      onMarkReceived();
    }
  }, [isExpanded, role, incident.isReceived, isSuperAdmin]);

  const handleAddComment = () => {
    if (!newComment.trim()) return;
    
    const comment: FollowUpComment = {
      comment: newComment.trim(),
      timestamp: Date.now(),
      authorName: profile.name
    };
    
    const updatedHistory = [...(incident.followUpHistory || []), comment];
    const updatedFollowUp = incident.followUp ? `${incident.followUp}\n\n${newComment.trim()}` : newComment.trim();
    
    onUpdateFollowUp(updatedFollowUp, updatedHistory, newComment.trim());
    setNewComment('');
    setIsEditingFollowUp(false);
  };

  const getStatusColor = (status?: IncidentStatus) => {
    switch (status) {
      case 'RECIBIDO': return 'text-emerald-600 bg-emerald-50';
      case 'EN_SEGUIMIENTO': return 'text-indigo-600 bg-indigo-50';
      case 'CERRADO': return 'text-slate-600 bg-slate-100';
      default: return 'text-amber-600 bg-amber-50';
    }
  };

  const getStatusLabel = (status?: IncidentStatus) => {
    switch (status) {
      case 'RECIBIDO': return 'Recibido';
      case 'EN_SEGUIMIENTO': return 'En Seguimiento';
      case 'CERRADO': return 'Cerrado';
      default: return 'Pendiente';
    }
  };

    const getStatusBorderColor = (status?: IncidentStatus) => {
    switch (status) {
      case 'RECIBIDO': return 'border-l-emerald-500';
      case 'EN_SEGUIMIENTO': return 'border-l-indigo-600';
      case 'CERRADO': return 'border-l-slate-400';
      default: return 'border-l-amber-500';
    }
  };

  return (
    <div 
      id={`incident-${incident.id}`}
      className={cn(
        "bg-white rounded-2xl border border-l-4 transition-all duration-200 hover:shadow-md",
        selected ? "border-indigo-600 ring-2 ring-indigo-100 shadow-md" : "border-slate-200",
        getStatusBorderColor(incident.status)
      )}
    >
      <div className="flex items-stretch">
        {selectable && (
          <div 
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.(incident.id);
            }}
            className="flex items-center justify-center px-4 border-r border-slate-100 cursor-pointer hover:bg-slate-50 transition-colors"
          >
            <div className={cn(
              "w-5 h-5 rounded border-2 flex items-center justify-center transition-all",
              selected ? "bg-indigo-600 border-indigo-600" : "border-slate-300 bg-white"
            )}>
              {selected && <CheckCircle2 className="w-4 h-4 text-white" />}
            </div>
          </div>
        )}
        <div className="flex-1 p-5 cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
          <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-4">
          <div className="flex-1 w-full">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <span className="text-xs font-bold text-indigo-600 uppercase tracking-wider">{incident.school}</span>
              <span className="text-slate-300">•</span>
              <span className="text-xs text-slate-500">{incident.date}</span>
              {(incident.status === 'EN_SEGUIMIENTO' || incident.status === 'CERRADO') && (
                <>
                  <span className="text-slate-300">•</span>
                  <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-tight", getStatusColor(incident.status))}>
                    {getStatusLabel(incident.status)}
                  </span>
                </>
              )}
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-1">{incident.place}</h3>
            <div className="flex flex-col gap-1">
              <p className="text-sm text-slate-600">Alumnos: {incident.students}</p>
              {incident.categories && incident.categories.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {incident.categories.map(cat => (
                    <span key={cat} className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-full font-medium">
                      {cat}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-1">
                <p className="text-sm text-slate-800 font-bold flex items-center flex-wrap gap-1.5">
                  <span>Reporta: ({incident.reporterName || incident.creatorName || 'Personal Escolar'})</span>
                  {incident.reporterRole && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-100 text-slate-700 border border-slate-200">
                      {incident.reporterRole === 'ADMIN' ? 'Administrador' : incident.reporterRole === 'DIRECTIVE' ? 'Directivo' : incident.reporterRole === 'COORDINATOR' ? 'Coordinador' : incident.reporterRole === 'TEACHER' ? 'Docente' : incident.reporterRole === 'PSYCHOLOGIST' ? 'Psicólogo' : incident.reporterRole}
                    </span>
                  )}
                  {((incident.notifiedTeacherId === profile?.uid) || (incident.notifiedTeacherEmail && incident.notifiedTeacherEmail.toLowerCase() === profile?.email?.toLowerCase()) || (incident.coordinatorIds && incident.coordinatorIds.includes(profile?.uid))) && incident.reporterId !== profile?.uid && incident.reporterEmail?.toLowerCase() !== profile?.email?.toLowerCase() && (
                    <span className="ml-1 text-[10px] bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full font-bold border border-blue-200 shadow-xs">
                      En Copia
                    </span>
                  )}
                </p>
                {incident.suggestReferral && (
                  <div className={cn(
                    "inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border mt-1",
                    incident.referralStatus === 'IN_PROGRESS' 
                      ? "bg-pink-100 border-pink-200 text-pink-700 shadow-sm" 
                      : "bg-pink-50 border-pink-100 text-pink-600"
                  )}>
                    <Brain className={cn("w-3.5 h-3.5", incident.referralStatus === 'IN_PROGRESS' ? "animate-pulse" : "")} />
                    <span className="text-xs font-bold uppercase tracking-wide">
                      {incident.referralStatus === 'IN_PROGRESS' ? 'En canalización' : 'Sugerencia de canalización'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-start w-full sm:w-auto gap-3 border-t sm:border-t-0 pt-3 sm:pt-0 mt-3 sm:mt-0 border-slate-100">
            <div className="flex flex-row sm:flex-col items-center sm:items-end gap-2">
              {incident.referralStatus === 'IN_PROGRESS' && (
                <div className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-bold whitespace-nowrap bg-pink-500 text-white shadow-sm">
                  <Brain className="w-3 h-3" />
                  CANALIZADO
                </div>
              )}
              <div className={cn(
                "flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] sm:text-xs font-bold whitespace-nowrap", 
                (!incident.isReceived && role === 'COORDINATOR' && incident.status === 'PENDIENTE') ? 'text-amber-600 bg-amber-50' : getStatusColor(incident.status)
              )}>
                {(!incident.isReceived && role === 'COORDINATOR' && incident.status === 'PENDIENTE') 
                  ? <AlertCircle className="w-3 h-3" /> 
                  : (incident.status === 'RECIBIDO' || incident.status === 'EN_SEGUIMIENTO' || incident.status === 'CERRADO' || incident.isReceived ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />)
                }
                {(!incident.isReceived && role === 'COORDINATOR' && incident.status === 'PENDIENTE') 
                  ? 'Pendiente' 
                  : (incident.isReceived && role === 'COORDINATOR' && incident.status === 'PENDIENTE' ? 'Recibido' : getStatusLabel(incident.status))
                }
              </div>
              {incident.readAt && (
                <div className="text-[10px] text-slate-400 font-medium mt-1 text-right">
                  <p>Leído el:</p>
                  <p>{format(incident.readAt, "dd/MM/yyyy HH:mm")}</p>
                </div>
              )}
            </div>
            <div className="flex items-center gap-1">
              {(isSuperAdmin || can('canDeleteIncidents') || profile?.role === 'ADMIN') && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete();
                  }}
                  className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                  title="Eliminar incidencia"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              )}
              <ChevronRight className={cn("w-5 h-5 text-slate-400 transition-transform", isExpanded && "rotate-90")} />
            </div>
          </div>
        </div>
      </div>
    </div>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="border-t border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-transparent"
          >
            <div className="p-5 space-y-6">
              {role === 'PSYCHOLOGIST' && incident.suggestReferral && (
                <div className="space-y-4 pb-4 border-b border-slate-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-400 uppercase">Acciones de Psicología:</span>
                      {incident.referralStatus !== 'IN_PROGRESS' ? (
                        <button
                          onClick={() => onUpdateReferralStatus('IN_PROGRESS')}
                          className="px-3 py-1 bg-pink-100 text-pink-700 rounded-lg text-xs font-bold hover:bg-pink-200 transition-all flex items-center gap-1 shadow-sm border border-pink-200"
                        >
                          <Brain className="w-3 h-3" />
                          Poner En Canalización
                        </button>
                      ) : (
                        <div className="flex items-center gap-2 text-pink-600 font-bold text-xs bg-pink-50 px-3 py-1 rounded-lg border border-pink-100 shadow-sm">
                          <CheckCircle2 className="w-3 h-3 text-pink-500" />
                          Procesado: En Canalización
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5">
                        <Plus className="w-3 h-3" /> Comentarios de la canalización
                      </p>
                      {!isEditingReferralComments ? (
                        <button 
                          onClick={() => setIsEditingReferralComments(true)}
                          className="text-pink-600 hover:text-pink-700 text-xs font-bold flex items-center gap-1"
                        >
                          <Edit2 className="w-3 h-3" /> {incident.referralComments ? 'Editar' : 'Agregar'}
                        </button>
                      ) : (
                        <div className="flex gap-2">
                          <button 
                            onClick={async () => {
                              await onUpdateReferralComments(referralComments);
                              setIsEditingReferralComments(false);
                            }}
                            className="text-emerald-600 hover:text-emerald-700 text-xs font-bold flex items-center gap-1"
                          >
                            <Check className="w-3 h-3" /> Guardar
                          </button>
                          <button 
                            onClick={() => {
                              setReferralComments(incident.referralComments || '');
                              setIsEditingReferralComments(false);
                            }}
                            className="text-slate-400 hover:text-slate-500 text-xs font-bold flex items-center gap-1"
                          >
                            <X className="w-3 h-3" /> Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                    
                    {isEditingReferralComments ? (
                      <textarea
                        value={referralComments}
                        onChange={(e) => setReferralComments(e.target.value)}
                        placeholder="Escribe una breve explicación respecto al alumno..."
                        className="w-full bg-white border border-pink-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-pink-500 transition-all min-h-[80px] shadow-inner"
                      />
                    ) : (
                      <div className={cn(
                        "p-3 rounded-xl text-sm italic",
                        incident.referralComments ? "bg-pink-50 text-slate-700 border border-pink-100" : "bg-slate-50 text-slate-400 border border-slate-100"
                      )}>
                        {incident.referralComments || "No se han agregado comentarios adicionales de la canalización."}
                      </div>
                    )}
                  </div>
                </div>
              )}
              
              {role !== 'PSYCHOLOGIST' && incident.referralComments && (
                <div className="pb-4 border-b border-slate-200">
                  <p className="text-xs font-bold text-slate-400 uppercase mb-2 flex items-center gap-1.5">
                    <Brain className="w-3 h-3 text-pink-500" /> Comentarios de la canalización (Psicología)
                  </p>
                  <div className="bg-pink-50 border border-pink-100 text-slate-700 p-4 rounded-xl text-sm italic shadow-sm">
                    {incident.referralComments}
                  </div>
                </div>
              )}
              {can('canChangeStatus') && (
                <div className="flex items-center gap-2 pb-4 border-b border-slate-200">
                  <span className="text-xs font-bold text-slate-400 uppercase">Cambiar Estatus:</span>
                  {incident.status !== 'EN_SEGUIMIENTO' && (incident.status !== 'CERRADO' || isSuperAdmin) && (
                    <button
                      onClick={() => onUpdateStatus('EN_SEGUIMIENTO')}
                      className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-xs font-bold hover:bg-indigo-200 transition-all cursor-pointer"
                    >
                      En Seguimiento
                    </button>
                  )}
                  {incident.status !== 'CERRADO' && (
                    <button
                      onClick={() => onUpdateStatus('CERRADO')}
                      className="px-3 py-1 bg-slate-200 text-slate-700 rounded-lg text-xs font-bold hover:bg-slate-300 transition-all cursor-pointer"
                    >
                      Cerrar
                    </button>
                  )}
                  {(incident.status === 'RECIBIDO' || incident.status === 'EN_SEGUIMIENTO') && !incident.suggestReferral && (
                    <button
                      onClick={() => onUpdateReferralStatus('SUGGESTED')}
                      className="px-3 py-1 bg-pink-100 text-pink-700 rounded-lg text-xs font-bold hover:bg-pink-200 transition-all flex items-center gap-1 cursor-pointer"
                    >
                      <Brain className="w-3 h-3" />
                      Canalizar
                    </button>
                  )}
                </div>
              )}

              <DetailSection label="Descripción de los hechos" content={incident.description} />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {((incident.coordinatorIds && incident.coordinatorIds.length > 0) || incident.coordinatorId) && (
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Coordinadores asignados</p>
                    <div className="flex flex-wrap gap-2">
                      {(incident.coordinatorIds || [incident.coordinatorId]).map(id => {
                        const coord = coordinators.find(c => c.uid === id);
                        return (
                          <span key={id} className="px-3 py-1 bg-indigo-50 border border-indigo-100 rounded-lg text-xs font-medium text-indigo-700 shadow-sm flex items-center gap-1">
                            <UserIcon className="w-3 h-3" />
                            {coord?.name || 'Cargando...'}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}

                {incident.notifiedTeacherId && (
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Docente Notificado (Copia)</p>
                    <div className="flex flex-wrap gap-2">
                      {(() => {
                        const teacher = teachers.find(t => t.uid === incident.notifiedTeacherId);
                        return (
                          <span className="px-3 py-1 bg-slate-100 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 shadow-sm flex items-center gap-1">
                            <UserIcon className="w-3 h-3" />
                            {teacher?.name || incident.notifiedTeacherName || 'Docente notificado'}
                          </span>
                        );
                      })()}
                    </div>
                  </div>
                )}
              </div>
              
              {incident.categories && incident.categories.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-400 uppercase mb-1">Categoría de la Incidencia</p>
                  <div className="flex flex-wrap gap-2">
                    {incident.categories.map(cat => (
                      <span key={cat} className="px-3 py-1 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-700 shadow-sm">
                        {cat}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <DetailSection label="Medidas disciplinarias" content={incident.disciplinaryMeasures} />
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold text-slate-400 uppercase">Seguimiento</p>
                  {can('canAddFollowUp') && incident.status === 'EN_SEGUIMIENTO' && !isEditingFollowUp && (
                    <button 
                      onClick={() => setIsEditingFollowUp(true)}
                      className="text-indigo-600 hover:text-indigo-700 flex items-center gap-1 text-xs font-bold cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Agregar comentario
                    </button>
                  )}
                </div>
                
                <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-4">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap">{incident.followUp || 'Sin seguimiento aún.'}</p>
                  
                  {incident.followUpHistory && incident.followUpHistory.length > 0 && (
                    <div className="pt-4 border-t border-slate-100 space-y-3">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
                        <History className="w-3 h-3" /> Historial de comentarios
                      </div>
                      {incident.followUpHistory.map((h, i) => (
                        <div key={i} className="text-xs bg-slate-50 p-2 rounded-lg border border-slate-100">
                          <div className="flex justify-between mb-1">
                            <span className="font-bold text-slate-700">{h.authorName}</span>
                            <span className="text-slate-400">{format(h.timestamp, "dd/MM HH:mm")}</span>
                          </div>
                          <p className="text-slate-600">{h.comment}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {isEditingFollowUp && (
                    <div className="pt-4 border-t border-slate-100 space-y-3">
                      <textarea
                        value={newComment}
                        onChange={(e) => setNewComment(e.target.value)}
                        placeholder="Escribe tu comentario de seguimiento..."
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 transition-all"
                        rows={3}
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleAddComment}
                          className="flex-1 bg-indigo-600 text-white py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-2"
                        >
                          <Send className="w-3 h-3" /> Actualizar y Notificar
                        </button>
                        <button
                          onClick={() => { setIsEditingFollowUp(false); setNewComment(''); }}
                          className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {incident.images && incident.images.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
                    <ImageIcon className="w-3 h-3" /> Evidencia Fotográfica
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {incident.images.map((img, idx) => (
                      <button 
                        key={idx} 
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenGallery(incident.images || [], idx);
                        }}
                        className="w-24 h-24 rounded-xl overflow-hidden border border-slate-200 hover:opacity-80 transition-all shadow-sm group relative"
                      >
                        <img src={img} alt={`Evidencia ${idx}`} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                        <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                          <Eye className="w-6 h-6 text-white" />
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-200">
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Reportado por (Creador del Registro)</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-slate-900">({incident.reporterName || incident.creatorName || 'Personal Escolar'})</p>
                      {incident.reporterRole && (
                        <span className="text-[10px] px-2 py-0.5 rounded-md font-extrabold uppercase bg-indigo-50 text-indigo-700 border border-indigo-200">
                          {incident.reporterRole === 'ADMIN' ? 'Administrador' : incident.reporterRole === 'DIRECTIVE' ? 'Directivo' : incident.reporterRole === 'COORDINATOR' ? 'Coordinador' : incident.reporterRole === 'TEACHER' ? 'Docente' : incident.reporterRole === 'PSYCHOLOGIST' ? 'Psicólogo' : incident.reporterRole}
                        </span>
                      )}
                    </div>
                    {incident.reporterEmail && (
                      <p className="text-xs text-slate-500 mt-0.5">{incident.reporterEmail}</p>
                    )}
                  </div>
                  {incident.receivedByName && (
                    <div>
                      <p className="text-xs font-bold text-slate-400 uppercase mb-1">Recibido por</p>
                      <p className="text-sm font-medium text-slate-900">{incident.receivedByName}</p>
                    </div>
                  )}
                </div>
                <div className="flex justify-end items-end gap-2">
                  {can('canExportReports') && profile?.role !== 'TEACHER' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onPrint(incident); }}
                      className="flex items-center gap-2 text-slate-600 hover:bg-slate-100 px-3 py-2 rounded-lg transition-all text-sm font-bold cursor-pointer"
                    >
                      <Printer className="w-4 h-4" />
                      Imprimir
                    </button>
                  )}
                  {(isSuperAdmin || can('canDeleteIncidents') || profile?.role === 'ADMIN' || (profile?.role === 'COORDINATOR' && incident.status === 'CERRADO')) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onDelete(); }}
                      className="flex items-center gap-2 text-red-600 hover:bg-red-50 px-3 py-2 rounded-lg transition-all text-sm font-bold cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                      Eliminar
                    </button>
                  )}
                </div>
              </div>

            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const DetailSection = ({ label, content }: { label: string, content: string }) => (
  <div>
    <p className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase mb-1">{label}</p>
    <p className="text-sm text-slate-700 dark:text-slate-100 whitespace-pre-wrap">{content || 'Sin información'}</p>
  </div>
);

const IncidentForm = ({ profile, coordinators, teachers, psychologists, directives = [], admins = [], onSuccess, onCancel, sendNotification, notifyIncidentInvolvedUsers, sendEmail, systemSettings, addLog }: { 
  profile: UserProfile, 
  coordinators: UserProfile[],
  teachers: UserProfile[], 
  psychologists: UserProfile[],
  directives?: UserProfile[],
  admins?: UserProfile[],
  onSuccess: () => void, 
  onCancel: () => void, 
  sendNotification: (userIdOrIds: string | string[], title: string, message: string, incidentId?: string, skipAdmins?: boolean, extraData?: Record<string, any>) => Promise<void>, 
  notifyIncidentInvolvedUsers?: (params: any) => Promise<void>,
  sendEmail?: (to: string, subject: string, html: string) => Promise<any>,
  systemSettings: SystemSettings,
  addLog: (action: string, details?: string, extra?: {
    module?: string;
    recordId?: string;
    creatorName?: string;
    creatorEmail?: string;
    creatorRole?: string;
  }) => Promise<void>
}) => {
  const isSuperAdmin = isSuperAdminEmail(profile?.email);
  const canCreateReferral = getRolePermission(profile?.role, 'canCreateReferral', systemSettings?.rolePermissions, isSuperAdmin, profile?.customPermissions);
  const [loading, setLoading] = useState(false);
  const [processingImages, setProcessingImages] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    place: '',
    students: '',
    description: '',
    disciplinaryMeasures: '',
    followUp: '',
    coordinatorIds: [] as string[],
    notifiedTeacherId: '',
    school: 'Campus Victoria',
    categories: [] as string[],
    suggestReferral: false,
  });
  const [images, setImages] = useState<string[]>([]);

  const primaryCoord = coordinators.find(c =>
    (profile.assignedCoordinatorId && c.uid === profile.assignedCoordinatorId) ||
    (profile.assignedCoordinatorEmail && c.email?.toLowerCase() === profile.assignedCoordinatorEmail?.toLowerCase()) ||
    (profile.assignedCoordinatorName && c.name === profile.assignedCoordinatorName)
  );

  const secondaryCoord = coordinators.find(c =>
    (profile.secondaryCoordinatorId && c.uid === profile.secondaryCoordinatorId) ||
    (profile.secondaryCoordinatorEmail && c.email?.toLowerCase() === profile.secondaryCoordinatorEmail?.toLowerCase()) ||
    (profile.secondaryCoordinatorName && c.name === profile.secondaryCoordinatorName)
  );

  const hasTwoCoordinators = Boolean(primaryCoord && secondaryCoord && primaryCoord.uid !== secondaryCoord.uid);
  const [selectedCoordMode, setSelectedCoordMode] = useState<'primary' | 'secondary' | 'both'>('primary');

  useEffect(() => {
    if (coordinators.length > 0 && formData.coordinatorIds.length === 0) {
      if (hasTwoCoordinators && primaryCoord) {
        setFormData(prev => ({ ...prev, coordinatorIds: [primaryCoord.uid] }));
        return;
      }
      let defaultCoord: UserProfile | undefined;
      // If the current user is a coordinator, default assigned coordinator to themselves
      if (profile.role === 'COORDINATOR') {
        defaultCoord = coordinators.find(c => c.uid === profile.uid || (c.email && c.email.toLowerCase() === profile.email?.toLowerCase()));
      }
      if (!defaultCoord) {
        defaultCoord = coordinators.find(c =>
          (profile.assignedCoordinatorId && c.uid === profile.assignedCoordinatorId) ||
          (profile.assignedCoordinatorEmail && c.email?.toLowerCase() === profile.assignedCoordinatorEmail?.toLowerCase()) ||
          (profile.assignedCoordinatorName && c.name === profile.assignedCoordinatorName)
        );
      }
      if (defaultCoord) {
        setFormData(prev => ({ ...prev, coordinatorIds: [defaultCoord.uid] }));
      } else {
        const firstValid = coordinators.find(c => !isSuperAdminEmail(c.email) && c.role !== 'ADMIN');
        if (firstValid) {
          setFormData(prev => ({ ...prev, coordinatorIds: [firstValid.uid] }));
        }
      }
    }
  }, [profile, coordinators, hasTwoCoordinators, primaryCoord]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const fileList = Array.from(files);
      if (images.length + fileList.length > 5) {
        setError('Máximo 5 imágenes permitidas');
        return;
      }
      
      setProcessingImages(prev => prev + fileList.length);
      fileList.forEach((file: any) => {
        const reader = new FileReader();
        reader.onerror = () => {
          setProcessingImages(prev => Math.max(0, prev - 1));
          setError('Error al leer el archivo');
        };
        reader.onloadend = () => {
          const img = new Image();
          img.onerror = () => {
            setProcessingImages(prev => Math.max(0, prev - 1));
            setError('Error al cargar la imagen');
          };
          img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            // Max dimension 600px for better performance and size
            const MAX_DIM = 600;
            if (width > height) {
              if (width > MAX_DIM) {
                height *= MAX_DIM / width;
                width = MAX_DIM;
              }
            } else {
              if (height > MAX_DIM) {
                width *= MAX_DIM / height;
                height = MAX_DIM;
              }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0, width, height);
            
            // Compress to jpeg with 0.5 quality to ensure it fits in Firestore
            const compressedBase64 = canvas.toDataURL('image/jpeg', 0.5);
            setImages(prev => [...prev, compressedBase64]);
            setProcessingImages(prev => Math.max(0, prev - 1));
          };
          img.src = reader.result as string;
        };
        reader.readAsDataURL(file);
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.coordinatorIds.length === 0) {
      setError('Por favor selecciona al menos un coordinador');
      return;
    }

    if (processingImages > 0) {
      setError('Espera a que las imágenes terminen de procesarse');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const selectedCoord = coordinators.find(c => c.uid === (formData.coordinatorIds[0] || ''));
      const allSelectedCoords = coordinators.filter(c => formData.coordinatorIds.includes(c.uid));
      const coordNames = allSelectedCoords.length > 0 ? allSelectedCoords.map(c => c.name).join(', ') : (selectedCoord?.name || '');
      const coordEmails = allSelectedCoords.length > 0 ? allSelectedCoords.map(c => c.email).join(', ') : (selectedCoord?.email || '');
      const selectedTeacher = teachers.find(t => t.uid === formData.notifiedTeacherId);

      const creatorDisplayName = (profile.name && profile.name.trim()) || profile.email || 'Personal Escolar';

      const newIncident: any = {
        ...formData,
        coordinatorId: formData.coordinatorIds[0] || '', // Main coordinator
        coordinatorName: coordNames,
        coordinatorEmail: coordEmails,
        coordinatorIds: formData.coordinatorIds,
        notifiedTeacherName: selectedTeacher?.name || '',
        notifiedTeacherEmail: selectedTeacher?.email || '',
        date: format(now, "dd/MM/yyyy HH:mm"),
        reporterName: creatorDisplayName,
        reporterId: profile.uid,
        reporterEmail: profile.email,
        reporterRole: profile.role,
        creatorName: creatorDisplayName,
        creatorId: profile.uid,
        creatorEmail: profile.email,
        creatorRole: profile.role,
        isReceived: false,
        status: 'PENDIENTE',
        createdAt: Date.now(),
      };

      if (formData.suggestReferral) {
        newIncident.referralStatus = 'SUGGESTED';
      }

      if (images.length > 0) {
        newIncident.images = images;
      }

      // Remove any undefined properties to ensure Firestore accepts the payload
      Object.keys(newIncident).forEach(key => {
        if (newIncident[key] === undefined) {
          delete newIncident[key];
        }
      });

      const docRef = await addDoc(collection(db, 'incidents'), newIncident);
      const createdIncident = { id: docRef.id, ...newIncident } as Incident;
      
      await addLog(
        'Creó reporte de incidencia',
        `Creado por: ${profile.name} (${profile.role} - ${profile.email}) | Lugar: ${formData.place} | Alumnos: ${formData.students} | Reportado por: ${newIncident.reporterName || profile.name} | Coordinador(es): ${coordinators.filter(c => formData.coordinatorIds.includes(c.uid)).map(c => c.name).join(', ') || 'General'}`,
        { module: 'Incidencias', recordId: docRef.id }
      );
      
      // Notify all involved users (coordinators, notified teacher, directives, admins) with real-time in-app notification & email
      if (notifyIncidentInvolvedUsers) {
        await notifyIncidentInvolvedUsers({
          incident: createdIncident,
          title: 'Nueva Incidencia Reportada',
          message: `Se ha registrado una nueva incidencia en "${formData.place}" por ${profile.name}.`,
          emailSubject: `Nueva Incidencia Registrada: ${formData.place}`,
          emailHeaderTitle: 'Nueva Incidencia Registrada',
          actionDetails: `<strong>Lugar:</strong> ${formData.place}<br/><strong>Alumnos:</strong> ${formData.students}<br/><strong>Descripción:</strong> ${formData.description}`,
          excludeUserId: profile.uid,
          excludeUserEmail: profile.email,
          isCreation: true
        });
      }

      // Dedicated notification for the teacher added in copy (if not the creator)
      if (formData.notifiedTeacherId && formData.notifiedTeacherId !== profile.uid) {
        const creatorRoleLabel = profile.role === 'ADMIN' ? 'el administrador' : profile.role === 'DIRECTIVE' ? 'el directivo' : profile.role === 'COORDINATOR' ? 'el coordinador' : 'el docente';
        await sendNotification(
          formData.notifiedTeacherId,
          'Copia de Incidencia Registrada',
          `Has sido agregado/a en copia en el reporte de incidencia en "${formData.place}" por ${creatorRoleLabel} ${creatorDisplayName}.`,
          docRef.id,
          true,
          { skipEmail: true, creatorUid: profile.uid, creatorEmail: profile.email }
        );
      }

      // Notification for Psychologists & Auto Referral
      if (formData.suggestReferral) {
        const refId = `ref_inc_${docRef.id}`;
        const targetCoord = coordinators.find(c => formData.coordinatorIds.includes(c.uid) || formData.coordinatorIds.includes(c.email)) || coordinators[0];
        const targetPsych = psychologists[0];

        const refDoc: Referral = {
          id: refId,
          incidentId: docRef.id,
          studentName: formData.students || 'Estudiante',
          gradeGroup: 'S/G',
          teacherId: profile.uid,
          teacherName: profile.name,
          teacherEmail: profile.email,
          coordinatorId: targetCoord?.uid || (formData.coordinatorIds[0] || ''),
          coordinatorName: targetCoord?.name || 'Coordinador General',
          coordinatorEmail: targetCoord?.email || '',
          psychologistId: targetPsych?.uid || '',
          psychologistName: targetPsych?.name || 'Psicólogo Escolar',
          psychologistEmail: targetPsych?.email || '',
          reasonAndBackground: `Sugerencia de canalización generada desde incidencia en "${formData.place}". Alumno(s): ${formData.students}. Motivo/Hechos: ${formData.description}`,
          teacherStrategies: formData.disciplinaryMeasures || formData.followUp || '',
          psychologistComment: '',
          status: 'PENDIENTE',
          createdAt: Date.now()
        };
        try {
          await setDoc(doc(db, 'referrals', refId), refDoc, { merge: true });
        } catch (refErr) {
          console.error("Error creating auto referral document:", refErr);
        }

        // Target uids excluding the creator
        const notifyUids: string[] = [];
        if (targetCoord?.uid && targetCoord.uid !== profile.uid) notifyUids.push(targetCoord.uid);
        psychologists.forEach(p => { if (p.uid && p.uid !== profile.uid) notifyUids.push(p.uid); });

        await sendNotification(
          notifyUids,
          'Sugerencia de Canalización Psicopedagógica',
          `Se ha registrado una canalización para "${formData.students}" desde incidencia en "${formData.place}" por ${profile.name}.`,
          docRef.id,
          false, // Include directives and admins
          { 
            referralId: refId, 
            type: 'referral',
            creatorUid: profile.uid,
            creatorEmail: profile.email,
            isCreationNotification: true
          }
        );

        const emailRecipients = new Set<string>();
        if (targetCoord?.email) emailRecipients.add(targetCoord.email.toLowerCase());
        psychologists.forEach(p => { if (p.email) emailRecipients.add(p.email.toLowerCase()); });
        directives.forEach(d => { if (d.email) emailRecipients.add(d.email.toLowerCase()); });
        admins.forEach(a => { if (a.email) emailRecipients.add(a.email.toLowerCase()); });

        // Exclude the reporting user from receiving email
        if (profile.email) emailRecipients.delete(profile.email.toLowerCase());
        if (targetCoord?.email) emailRecipients.add(targetCoord.email.toLowerCase());
        psychologists.forEach(p => { if (p.email) emailRecipients.add(p.email.toLowerCase()); });
        directives.forEach(d => { if (d.email) emailRecipients.add(d.email.toLowerCase()); });
        admins.forEach(a => { if (a.email) emailRecipients.add(a.email.toLowerCase()); });

        const filteredEmailRecipients = Array.from(emailRecipients).filter(e => !isSuperAdminEmail(e));

        for (const targetEmail of filteredEmailRecipients) {
          if (systemSettings.emailNotificationsEnabled !== false && sendEmail) {
            await sendEmail(
              targetEmail,
              `Sugerencia de Canalización: ${formData.students}`,
              `
                <div style="font-family: sans-serif; color: #334155; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                  <div style="background: linear-gradient(135deg, #ec4899 0%, #db2777 100%); padding: 24px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 20px;">Sugerencia de Canalización</h1>
                    <p style="color: #fbcfe8; margin: 4px 0 0 0; font-size: 12px; text-transform: uppercase;">DASHBOARD DUNOR</p>
                  </div>
                  <div style="padding: 24px;">
                    <p style="font-size: 15px; margin-bottom: 16px;">Se ha registrado una incidencia con sugerencia de canalización al departamento de psicología.</p>
                    <div style="background-color: #f8fafc; padding: 16px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #e2e8f0;">
                      <p style="margin: 0 0 8px 0;"><strong>Reportado por:</strong> ${profile.name} (${profile.email})</p>
                      <p style="margin: 0 0 8px 0;"><strong>Lugar:</strong> ${formData.place}</p>
                      <p style="margin: 0 0 8px 0;"><strong>Alumnos:</strong> ${formData.students}</p>
                      <p style="margin: 0;"><strong>Descripción:</strong> ${formData.description}</p>
                    </div>
                    <p style="font-size: 13px; color: #64748b;">Ingresa a la plataforma para revisar los detalles y dar seguimiento.</p>
                  </div>
                </div>
              `
            ).catch(err => console.warn("Email notice error:", err));
          }
        }
      }

      onSuccess();
    } catch (error) {
      console.error("Error saving incident:", error);
      if (error instanceof Error && error.message.includes('too large')) {
        setError('El reporte es demasiado grande (demasiadas imágenes o muy pesadas). Intenta con menos imágenes.');
      } else {
        handleFirestoreError(error, OperationType.CREATE, 'incidents');
        setError('Error al guardar la incidencia en la base de datos. Por favor verifica tu conexión e intenta de nuevo.');
      }
    } finally {
      setLoading(false);
    }
  };

  // Filter out super admin from coordinators list
  const filteredCoordinators = coordinators.filter(c => 
    !isSuperAdminEmail(c.email) && 
    c.role !== 'ADMIN'
  );

  const userLevel = getUserEducationLevel(profile, coordinators);
  const isPsychologist = profile?.role === 'PSYCHOLOGIST' || (profile?.role && String(profile.role).toLowerCase().includes('psico'));
  const isGlobalUser = (profile?.role === 'ADMIN' || profile?.role === 'DIRECTIVE' || isPsychologist || isSuperAdmin) && !userLevel;

  // Determine active level from user profile or from selected coordinator in the incident form
  const selectedCoord = coordinators.find(c => formData.coordinatorIds && formData.coordinatorIds.includes(c.uid));
  const selectedCoordLevel = selectedCoord ? getUserEducationLevel(selectedCoord, coordinators) : '';
  const activeIncidentLevel = userLevel || selectedCoordLevel;

  const filteredTeachersForCopy = teachers.filter(t => {
    // Cannot copy oneself
    if (t.uid === profile.uid || (profile.email && t.email?.toLowerCase() === profile.email.toLowerCase())) {
      return false;
    }
    // Filter by the educational level (Preescolar, Primaria, Secundaria)
    const tLevel = getUserEducationLevel(t, coordinators);
    if (activeIncidentLevel) {
      return tLevel === activeIncidentLevel;
    }
    // If global admin/directive with no specific level, show all teachers
    if (isGlobalUser) return true;
    return true;
  });

  return (
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-slate-100">
      <div className="bg-gradient-to-r from-indigo-600 to-indigo-700 p-6 md:p-8 text-white relative">
        <div className="relative z-10">
          <h2 className="text-2xl font-bold flex items-center gap-3">
            <ClipboardList className="w-8 h-8" />
            Registro de Nueva Incidencia ({profile.name || profile.email})
          </h2>
        </div>
        <div className="absolute top-0 right-0 w-32 h-full bg-white/10 -skew-x-12 translate-x-16"></div>
      </div>

      <form onSubmit={handleSubmit} className="p-6 md:p-8 space-y-8">
        {/* Creator Identity Banner */}
        <div className="bg-slate-50 border border-slate-200/90 rounded-2xl p-4.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-xs">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-bold text-base shadow-sm">
              {(profile.name || profile.email || 'U').charAt(0).toUpperCase()}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Quien Registra el Incidente</span>
                <span className="px-2.5 py-0.5 rounded-md text-[10px] font-extrabold uppercase bg-indigo-100 text-indigo-800 border border-indigo-200">
                  {profile.role === 'ADMIN' ? 'Administrador' : profile.role === 'DIRECTIVE' ? 'Directivo' : profile.role === 'COORDINATOR' ? 'Coordinador' : profile.role === 'TEACHER' ? 'Docente' : profile.role === 'PSYCHOLOGIST' ? 'Psicólogo' : profile.role}
                </span>
              </div>
              <p className="text-base font-bold text-slate-900 mt-0.5">({profile.name})</p>
              <p className="text-xs text-slate-500">{profile.email}</p>
            </div>
          </div>
          <div className="text-xs text-slate-700 bg-white border border-slate-200 px-3.5 py-2 rounded-xl shadow-2xs font-medium flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>El incidente se registrará oficialmente por: <strong>({profile.name})</strong></span>
          </div>
        </div>
        {/* Section 1: General Info */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <School className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-800">Información General</h3>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <InputGroup label="Lugar del Incidente" required>
              <div className="relative">
                <input
                  required
                  type="text"
                  value={formData.place}
                  onChange={(e) => setFormData({ ...formData, place: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-4 pr-10 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  placeholder="Ej. Patio central, Aula 3B..."
                />
                <AlertCircle className="w-5 h-5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-300" />
              </div>
            </InputGroup>
            
            <InputGroup label="Campus" required>
              <select
                required
                value={formData.school}
                onChange={(e) => setFormData({ ...formData, school: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              >
                <option value="Campus Victoria">Campus Victoria</option>
                <option value="Campus Esperanza">Campus Esperanza</option>
              </select>
            </InputGroup>
          </div>

          <InputGroup label="Alumnos involucrados" required>
            <div className="relative">
              <input
                required
                type="text"
                value={formData.students}
                onChange={(e) => setFormData({ ...formData, students: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-4 pr-10 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                placeholder="Ingresa los nombres de los alumnos involucrados..."
              />
              <Users className="w-5 h-5 absolute right-3 top-1/2 -translate-y-1/2 text-slate-300" />
            </div>
          </InputGroup>
        </div>

        {/* Section 2: Details */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center text-amber-600">
              <AlertCircle className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-800">Detalles de lo Ocurrido</h3>
          </div>

          <InputGroup label="Categoría de la Incidencia">
            <div className="flex flex-col gap-3">
              <select
                onChange={(e) => {
                  const cat = e.target.value;
                  if (cat && !formData.categories.includes(cat)) {
                    setFormData({ ...formData, categories: [...formData.categories, cat] });
                  }
                  e.target.value = "";
                }}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              >
                <option value="">Selecciona etiquetas para categorizar...</option>
                {(systemSettings.categories || []).map(cat => (
                  <option key={cat} value={cat} disabled={formData.categories.includes(cat)}>
                    {cat}
                  </option>
                ))}
              </select>

              <div className="flex flex-wrap gap-2">
                {formData.categories.length > 0 ? (
                  formData.categories.map((cat) => (
                    <div 
                      key={cat}
                      onClick={() => {
                        setFormData({ ...formData, categories: formData.categories.filter(c => c !== cat) });
                      }}
                      className="flex items-center gap-2 bg-slate-100 text-slate-700 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer hover:bg-red-50 hover:text-red-700 hover:border-red-100 border border-transparent transition-all animate-in fade-in zoom-in duration-200 group"
                    >
                      <CheckCircle2 className="w-4 h-4" />
                      <span>{cat}</span>
                      <X className="w-3 h-3 ml-1 text-slate-400 group-hover:text-red-400" />
                    </div>
                  ))
                ) : (
                  <span className="text-xs text-slate-400 italic px-1">Sin categorías seleccionadas</span>
                )}
              </div>
            </div>
          </InputGroup>

          <InputGroup label="Descripción Detallada de los Hechos" required>
            <textarea
              required
              rows={4}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
              placeholder="¿Qué sucedió? Describe con precisión el evento..."
            />
          </InputGroup>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <InputGroup label="Medidas Disciplinarias">
              <textarea
                rows={3}
                value={formData.disciplinaryMeasures}
                onChange={(e) => setFormData({ ...formData, disciplinaryMeasures: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                placeholder="Acciones tomadas al momento..."
              />
            </InputGroup>
            <InputGroup label="Seguimiento">
              <textarea
                rows={3}
                value={formData.followUp}
                onChange={(e) => setFormData({ ...formData, followUp: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all resize-none"
                placeholder="Pasos a seguir recomendados..."
              />
            </InputGroup>
          </div>
        </div>

        {/* Section 3: Assignment & Notifications */}
        <div className="space-y-6">
          <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <Send className="w-5 h-5" />
            </div>
            <h3 className="font-bold text-slate-800">Asignación y Notificaciones</h3>
          </div>

          {/* Selector para docentes con dos coordinadores asignados */}
          {hasTwoCoordinators && primaryCoord && secondaryCoord && (
            <div className="bg-indigo-50/80 border border-indigo-200 rounded-2xl p-4.5 space-y-3 shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-indigo-950">Compartir Incidencia con Coordinación</h4>
                  <p className="text-xs text-indigo-700">Tienes dos coordinadores asignados. Selecciona a cuál(es) deseas compartir este reporte:</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedCoordMode('primary');
                    setFormData(prev => ({ ...prev, coordinatorIds: [primaryCoord.uid] }));
                  }}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between",
                    selectedCoordMode === 'primary'
                      ? "bg-white border-indigo-600 shadow-sm ring-2 ring-indigo-500/20"
                      : "bg-white/70 border-indigo-100 hover:bg-white text-slate-700"
                  )}
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 block mb-1">1er Coordinador</span>
                    <span className="text-xs font-bold text-slate-900 block">{primaryCoord.name}</span>
                  </div>
                  <span className="text-[11px] text-slate-500 truncate mt-1">{primaryCoord.email}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedCoordMode('secondary');
                    setFormData(prev => ({ ...prev, coordinatorIds: [secondaryCoord.uid] }));
                  }}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between",
                    selectedCoordMode === 'secondary'
                      ? "bg-white border-indigo-600 shadow-sm ring-2 ring-indigo-500/20"
                      : "bg-white/70 border-indigo-100 hover:bg-white text-slate-700"
                  )}
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 block mb-1">2do Coordinador</span>
                    <span className="text-xs font-bold text-slate-900 block">{secondaryCoord.name}</span>
                  </div>
                  <span className="text-[11px] text-slate-500 truncate mt-1">{secondaryCoord.email}</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setSelectedCoordMode('both');
                    setFormData(prev => ({ ...prev, coordinatorIds: [primaryCoord.uid, secondaryCoord.uid] }));
                  }}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between",
                    selectedCoordMode === 'both'
                      ? "bg-white border-indigo-600 shadow-sm ring-2 ring-indigo-500/20"
                      : "bg-white/70 border-indigo-100 hover:bg-white text-slate-700"
                  )}
                >
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-600 block mb-1">Ambos Coordinadores</span>
                    <span className="text-xs font-bold text-slate-900 block">Compartir con los Dos</span>
                  </div>
                  <span className="text-[11px] text-slate-500 truncate mt-1">{primaryCoord.name} y {secondaryCoord.name}</span>
                </button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <InputGroup label="Coordinador Asignado" required>
              <div className="space-y-3">
                {formData.coordinatorIds.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {formData.coordinatorIds.map((id, index) => {
                      const coord = coordinators.find(c => c.uid === id) || directives.find(d => d.uid === id) || teachers.find(t => t.uid === id);
                      const userRole = coord?.role ? (coord.role === 'DIRECTIVE' ? 'Directivo' : coord.role === 'TEACHER' ? 'Docente' : 'Coordinador') : 'Coordinador';
                      if (index === 0) {
                        return (
                          <div 
                            key={id}
                            className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold bg-indigo-50 text-indigo-700 border border-indigo-200 cursor-default select-none shadow-sm"
                          >
                            <UserIcon className="w-3.5 h-3.5 text-indigo-600" />
                            <span>Coordinador Asignado: {coord?.name || id}</span>
                          </div>
                        );
                      }
                      return (
                        <div 
                          key={id}
                          onClick={() => {
                            setFormData({ ...formData, coordinatorIds: formData.coordinatorIds.filter(cId => cId !== id) });
                          }}
                          className="flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold cursor-pointer border transition-all group bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-red-50 hover:text-red-700 hover:border-red-200 shadow-sm"
                          title="Clic para remover copia"
                        >
                          <UserIcon className="w-3.5 h-3.5" />
                          <span>Copia ({userRole}): {coord?.name || id}</span>
                          <X className="w-3.5 h-3.5 ml-1 opacity-80 group-hover:opacity-100" />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-amber-600 font-medium italic">Sin coordinador asignado.</p>
                )}

                <div className="pt-1">
                  <label className="text-xs font-bold text-slate-500 block mb-1">Copia a otro Coordinador o Directivo (Opcional):</label>
                  <select
                    value=""
                    onChange={(e) => {
                      const id = e.target.value;
                      if (id && !formData.coordinatorIds.includes(id)) {
                        setFormData({ ...formData, coordinatorIds: [...formData.coordinatorIds, id] });
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">-- Selecciona destinatario para Copia (Directivo o Coordinador) --</option>
                    
                    <optgroup label="Coordinadores">
                      {filteredCoordinators.map((c) => (
                        <option key={c.uid} value={c.uid} disabled={formData.coordinatorIds.includes(c.uid)}>
                          Coordinador: {c.name} ({c.email})
                        </option>
                      ))}
                    </optgroup>

                    {directives.length > 0 && (
                      <optgroup label="Directivos">
                        {directives.map((d) => (
                          <option key={d.uid} value={d.uid} disabled={formData.coordinatorIds.includes(d.uid)}>
                            Directivo: {d.name} ({d.email})
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
              </div>
            </InputGroup>

            <InputGroup label="Copiar a Docente (Opcional)">
              <select
                value={formData.notifiedTeacherId}
                onChange={(e) => setFormData({ ...formData, notifiedTeacherId: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
              >
                <option value="">
                  {activeIncidentLevel ? `Selecciona docente opcional (${activeIncidentLevel})...` : 'Selecciona docente opcional...'}
                </option>
                {filteredTeachersForCopy.length > 0 ? (
                  filteredTeachersForCopy.map((t) => {
                    const tLvl = getUserEducationLevel(t, coordinators);
                    return (
                      <option key={t.uid} value={t.uid}>
                        {t.name}{tLvl && !activeIncidentLevel ? ` (${tLvl})` : ''}
                      </option>
                    );
                  })
                ) : activeIncidentLevel ? (
                  <option disabled value="">
                    No hay docentes registrados en nivel {activeIncidentLevel}
                  </option>
                ) : null}
              </select>
            </InputGroup>
          </div>

          <InputGroup label="Evidencia Fotográfica (Máximo 5)">
            <div className="group relative border-2 border-dashed border-slate-200 rounded-xl p-4 hover:border-indigo-300 hover:bg-indigo-50/30 transition-all cursor-pointer text-center">
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleImageChange}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
              <div className="flex flex-col items-center justify-center py-2">
                <ImageIcon className="w-8 h-8 text-slate-400 group-hover:text-indigo-500 mb-2 transition-colors" />
                <p className="text-sm font-medium text-slate-600">Haz clic o arrastra imágenes aquí</p>
                <p className="text-xs text-slate-400 mt-1">Formato JPG, PNG (Max. 5 archivos)</p>
              </div>
            </div>

            {images.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-3">
                {images.map((img, idx) => (
                  <div key={idx} className="relative group/img w-24 h-24 rounded-xl overflow-hidden border-2 border-slate-100 shadow-sm">
                    <img src={img} alt={`Preview ${idx}`} className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImages(prev => prev.filter((_, i) => i !== idx))}
                      className="absolute top-1 right-1 bg-black/50 text-white p-1 rounded-full opacity-0 group-hover/img:opacity-100 transition-opacity backdrop-blur-sm"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                    <div className="absolute bottom-0 inset-x-0 bg-black/40 py-0.5 text-[8px] text-white text-center font-bold">
                      IMAGEN {idx + 1}
                    </div>
                  </div>
                ))}
              </div>
            )}
            
            {processingImages > 0 && (
              <div className="mt-3 flex items-center gap-2 text-indigo-600 text-xs font-bold animate-pulse">
                <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin"></div>
                Procesando {processingImages} imagen(es)...
              </div>
            )}
          </InputGroup>
        </div>

        {/* Section 4: Psychopedagogical Suggestion */}
        {(canCreateReferral || isSuperAdmin) && (
          <div className="space-y-6 pt-4 border-t border-slate-100">
            <div 
              onClick={() => setFormData({ ...formData, suggestReferral: !formData.suggestReferral })}
              className={cn(
                "p-6 rounded-2xl border-2 transition-all cursor-pointer group flex items-center justify-between",
                formData.suggestReferral 
                  ? "bg-pink-50 border-pink-200 shadow-md shadow-pink-100" 
                  : "bg-slate-50 border-slate-100 hover:border-pink-200 hover:bg-pink-50/50"
              )}
            >
              <div className="flex items-center gap-4">
                <div className={cn(
                  "w-12 h-12 rounded-xl flex items-center justify-center transition-colors",
                  formData.suggestReferral ? "bg-pink-500 text-white" : "bg-white text-slate-400 group-hover:text-pink-500 shadow-sm"
                )}>
                  <Brain className="w-6 h-6" />
                </div>
                <div>
                  <h3 className={cn("font-bold text-lg", formData.suggestReferral ? "text-pink-900" : "text-slate-700")}>
                    Sugerir Canalización
                  </h3>
                  <p className={cn("text-sm", formData.suggestReferral ? "text-pink-600" : "text-slate-500")}>
                    El reporte también será compartido con el equipo de psicología para su seguimiento.
                  </p>
                </div>
              </div>
              <div className={cn(
                "w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                formData.suggestReferral ? "bg-pink-500 border-pink-500" : "border-slate-300"
              )}>
                {formData.suggestReferral && <Check className="w-4 h-4 text-white font-bold" />}
              </div>
            </div>
          </div>
        )}

        {error && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 bg-red-50 border border-red-100 rounded-xl flex items-center gap-3 text-red-700 text-sm font-medium"
          >
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </motion.div>
        )}

        <div className="pt-6 border-t border-slate-100 flex items-center justify-end gap-4">
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3 text-slate-600 font-bold hover:bg-slate-100 rounded-xl transition-all"
            disabled={loading}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || processingImages > 0}
            className={cn(
              "px-8 py-3 bg-indigo-600 text-white font-bold rounded-xl shadow-lg shadow-indigo-200 hover:bg-indigo-700 transform hover:-translate-y-0.5 active:translate-y-0 transition-all flex items-center gap-2",
              (loading || processingImages > 0) && "opacity-50 cursor-not-allowed transform-none"
            )}
          >
            {loading ? (
              <>
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Registrando...
              </>
            ) : (
              <>
                <CheckCircle2 className="w-5 h-5" />
                Registrar Incidencia
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
};

const InputGroup = ({ label, children, required }: { label: string, children: React.ReactNode, required?: boolean }) => (
  <div className="space-y-1.5">
    <label className="text-sm font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1">
      {label}
      {required && <span className="text-red-500">*</span>}
    </label>
    {children}
  </div>
);

const TaskManager = ({
  profile,
  tasks,
  coordinators,
  teachers,
  psychologists,
  directives,
  admins,
  addLog,
  systemSettings,
  sendNotification,
  canCreateTask = true,
  canSendCongratulations = true,
  highlightedTaskId,
  onClearHighlightedTask,
}: {
  profile: UserProfile;
  tasks: Task[];
  coordinators: UserProfile[];
  teachers: UserProfile[];
  psychologists: UserProfile[];
  directives: UserProfile[];
  admins: UserProfile[];
  addLog: (action: string, details?: string, extra?: {
    module?: string;
    recordId?: string;
    creatorName?: string;
    creatorEmail?: string;
    creatorRole?: string;
  }) => Promise<void>;
  systemSettings: SystemSettings;
  sendNotification: (userIdOrIds: string | string[], title: string, message: string, incidentId?: string, skipAdmins?: boolean, extraData?: Record<string, any>) => Promise<void>;
  canCreateTask?: boolean;
  canSendCongratulations?: boolean;
  highlightedTaskId?: string | null;
  onClearHighlightedTask?: () => void;
}) => {
  const [sysModal, setSysModal] = useState<SystemModalState>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info'
  });

  const showSystemPopup = (
    title: string,
    message: string,
    type: 'success' | 'error' | 'warning' | 'info' | 'confirm' = 'info',
    onConfirm?: () => void,
    confirmText?: string,
    cancelText?: string
  ) => {
    setSysModal({ isOpen: true, title, message, type, onConfirm, confirmText, cancelText });
  };

  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showCongratulationModal, setShowCongratulationModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [evidenceText, setEvidenceText] = useState('');
  const [evidenceFile, setEvidenceFile] = useState('');
  const [directiveFeedback, setDirectiveFeedback] = useState('');
  const [taskFilter, setTaskFilter] = useState<'ALL' | 'ASIGNADA' | 'RECIBIDA' | 'REALIZADA' | 'COMPLETADA' | 'INCUMPLIDA'>('ALL');

  const isTaskOverdue = (task: Task) => {
    if (task.status === 'COMPLETADA') return false;
    // Si una tarea ya está en estatus de realizada y se llega la fecha límite, cuenta como completada
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    if (task.status === 'REALIZADA' && task.dueDate && todayStr >= task.dueDate) return false;
    if (!task.dueDate) return false;
    if (task.title.includes('🎉') || task.title.toLowerCase().includes('felicitac') || task.title.toLowerCase().includes('reconocimiento')) return false;
    return todayStr > task.dueDate;
  };

  useEffect(() => {
    if (highlightedTaskId && tasks && tasks.length > 0) {
      const targetTask = tasks.find(t => t.id === highlightedTaskId);
      if (targetTask) {
        handleOpenTask(targetTask);
        if (onClearHighlightedTask) {
          onClearHighlightedTask();
        }
      }
    }
  }, [highlightedTaskId, tasks]);

  useEffect(() => {
    if (!profile || !tasks || tasks.length === 0) return;

    const todayStr = format(new Date(), 'yyyy-MM-dd');

    tasks.forEach(async (task) => {
      // 1. REQUISITO: Si una tarea ya está en estatus de realizada y se llega la fecha límite, esta pasa en automático a completada
      if (task.status === 'REALIZADA' && task.dueDate && todayStr >= task.dueDate) {
        try {
          await updateDoc(doc(db, 'tasks', task.id), {
            status: 'COMPLETADA',
            completedAt: Date.now(),
            autoCompleted: true,
            autoCompletedReason: 'Fecha límite alcanzada en estatus REALIZADA'
          });

          await sendNotification(
            task.assignedToEmail,
            `✅ Tarea Completada Automáticamente: ${task.title}`,
            `Tu tarea "${task.title}" (en estatus Realizada) alcanzó su fecha límite (${task.dueDate}) y ha pasado automáticamente a COMPLETADA.`
          );

          if (task.createdByEmail && task.createdByEmail.toLowerCase() !== task.assignedToEmail?.toLowerCase()) {
            await sendNotification(
              task.createdByEmail,
              `✅ Tarea Completada Automáticamente: ${task.title}`,
              `La tarea "${task.title}" asignada a ${task.assignedToName} estaba en estatus REALIZADA y al llegar su fecha límite (${task.dueDate}) pasó automáticamente a COMPLETADA.`
            );
          }

          await addLog(
            'Tarea Completada Automáticamente por Fecha Límite',
            `La tarea "${task.title}" asignada a ${task.assignedToName} (${task.assignedToEmail}) estaba en estatus REALIZADA y al llegar su fecha límite (${task.dueDate}) pasó automáticamente a COMPLETADA.`,
            { module: 'Tareas / Felicitaciones', recordId: task.id }
          );
        } catch (autoErr) {
          console.warn("Auto-completion on deadline error in TaskManager:", autoErr);
        }
        return;
      }

      if (task.status !== 'COMPLETADA' && task.status !== 'REALIZADA' && task.dueDate) {
        const isDueOrOverdue = todayStr >= task.dueDate;
        if (isDueOrOverdue && !task.overdueReminderSent) {
          try {
            await updateDoc(doc(db, 'tasks', task.id), {
              overdueReminderSent: true,
              lastReminderSentAt: Date.now()
            });

            const isStrictlyOverdue = todayStr > task.dueDate;
            const subject = isStrictlyOverdue
              ? `⏰ Recordatorio de Tarea Incumplida / Vencida: ${task.title}`
              : `⏰ Recordatorio: Fecha Límite de Tarea Hoy (${task.title})`;

            const message = isStrictlyOverdue
              ? `La tarea "${task.title}" con fecha límite ${task.dueDate} se encuentra INCUMPLIDA y requiere tu atención inmediata.`
              : `Hoy vence la fecha límite (${task.dueDate}) para la tarea "${task.title}". Por favor sube tu evidencia a la brevedad.`;

            await sendNotification(task.assignedToEmail, subject, message);

            if (systemSettings.emailNotificationsEnabled && task.assignedToEmail) {
              try {
                await fetch('/api/send-email', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    to: task.assignedToEmail,
                    subject: subject,
                    html: `
                      <div style="font-family: sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #fca5a5; border-radius: 12px; padding: 24px; background-color: #fef2f2;">
                        <div style="background-color: #dc2626; padding: 14px; border-radius: 8px; text-align: center; margin-bottom: 20px;">
                          <h2 style="color: #ffffff; margin: 0; font-size: 18px;">⏰ Recordatorio de Tarea ${isStrictlyOverdue ? 'Incumplida' : 'Pendiente'}</h2>
                        </div>
                        <p style="font-size: 15px;">Estimado/a <strong>${task.assignedToName}</strong>,</p>
                        <p style="font-size: 14px; line-height: 1.6;">${message}</p>
                        <div style="background-color: #ffffff; border-left: 4px solid #dc2626; padding: 16px; margin: 20px 0; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                          <h3 style="margin: 0 0 6px 0; color: #991b1b; font-size: 16px;">${task.title}</h3>
                          <p style="margin: 0 0 10px 0; color: #475569; font-size: 13px;">${task.description}</p>
                          <p style="margin: 0; font-size: 13px; font-weight: bold; color: #dc2626;">Fecha Límite: ${task.dueDate}</p>
                        </div>
                        <p style="font-size: 12px; color: #7f1d1d; font-weight: bold;">Asignado por: ${task.createdByName} (${task.createdByRole})</p>
                        <p style="font-size: 11px; color: #94a3b8; margin-top: 20px; text-align: center;">Por favor ingresa a la plataforma para cargar tu evidencia y completar esta tarea.</p>
                      </div>
                    `
                  })
                });
              } catch (emailErr) {
                console.error("Task reminder email error:", emailErr);
              }
            }
          } catch (err) {
            console.error("Task reminder trigger error:", err);
          }
        }
      }
    });
  }, [tasks, profile, systemSettings]);

  const isSuperAdmin = isSuperAdminEmail(profile?.email);
  const isDirectiveOrAdmin = profile.role === 'DIRECTIVE' || profile.role === 'ADMIN' || profile.role === 'COORDINATOR' || isSuperAdmin;
  const canDeleteRecords = canCreateTask || canSendCongratulations || isDirectiveOrAdmin || isSuperAdmin;
  const assignableUsers = [...coordinators, ...teachers, ...psychologists];

  const handleDeleteTask = (taskToDelete: Task, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    showSystemPopup(
      'Eliminar Registro',
      `¿Estás seguro de que deseas eliminar permanentemente el registro "${taskToDelete.title}"? Esta acción no se puede deshacer.`,
      'confirm',
      async () => {
        try {
          await deleteDoc(doc(db, 'tasks', taskToDelete.id));
          await addLog(
            'Eliminó registro de tarea/felicitación',
            `Eliminado por: ${profile.name} (${profile.role} - ${profile.email}) | Título: ${taskToDelete.title} | Asignado a: ${taskToDelete.assignedToName} (${taskToDelete.assignedToEmail}) | Creador original: ${taskToDelete.createdByName || 'N/A'}`,
            { module: 'Tareas / Felicitaciones', recordId: taskToDelete.id }
          );
          if (selectedTask?.id === taskToDelete.id) {
            setSelectedTask(null);
          }
          showSystemPopup('Registro eliminado', 'El registro ha sido eliminado con éxito.', 'success');
        } catch (err) {
          console.error("Error deleting task:", err);
          showSystemPopup('Error', 'Ocurrió un error al intentar eliminar el registro.', 'error');
        }
      }
    );
  };

  const [taskFormData, setTaskFormData] = useState({
    title: '',
    description: '',
    dueDate: format(new Date(Date.now() + 7 * 86400000), 'yyyy-MM-dd'),
    targetType: 'SPECIFIC' as 'SPECIFIC' | 'ALL_TEACHERS' | 'ALL_COORDINATORS' | 'ALL_STAFF',
    selectedEmails: [] as string[],
  });

  const [congratFormData, setCongratFormData] = useState({
    targetType: 'SPECIFIC' as 'SPECIFIC' | 'ALL_TEACHERS' | 'ALL_COORDINATORS' | 'ALL_STAFF',
    selectedEmails: [] as string[],
    title: '¡Felicitaciones y Reconocimiento!',
    message: '',
  });

  const getRecipientsForTarget = (targetType: string, selectedEmails: string[]): UserProfile[] => {
    if (targetType === 'SPECIFIC') {
      return assignableUsers.filter(u => selectedEmails.map(e => e.toLowerCase()).includes(u.email.toLowerCase()));
    } else if (targetType === 'ALL_TEACHERS') {
      return teachers;
    } else if (targetType === 'ALL_COORDINATORS') {
      return coordinators;
    } else if (targetType === 'ALL_STAFF') {
      return [...teachers, ...coordinators, ...psychologists];
    }
    return [];
  };

  const handleAssignTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const recipientsToNotify = getRecipientsForTarget(taskFormData.targetType, taskFormData.selectedEmails);
    if (recipientsToNotify.length === 0) {
      showSystemPopup("Selección requerida", "Por favor selecciona al menos un destinatario para la tarea.", "info");
      return;
    }

    try {
      for (const recipient of recipientsToNotify) {
        const newTaskDoc: Omit<Task, 'id'> = {
          title: taskFormData.title.trim(),
          description: taskFormData.description.trim(),
          dueDate: taskFormData.dueDate,
          assignedToEmail: recipient.email.toLowerCase(),
          assignedToName: recipient.name,
          assignedToRole: recipient.role,
          createdByEmail: profile.email.toLowerCase(),
          createdByName: profile.name,
          createdByRole: profile.role,
          createdAt: Date.now(),
          status: 'ASIGNADA',
        };

        const newTaskRef = await addDoc(collection(db, 'tasks'), newTaskDoc);

        // Do not notify or send email to the user who created/assigned the task
        const isSelf = recipient.email.toLowerCase() === profile.email.toLowerCase() ||
                       (recipient.uid && recipient.uid === profile.uid);

        if (!isSelf) {
          await sendNotification(
            recipient.email,
            `📋 Nueva Tarea Asignada: ${newTaskDoc.title}`,
            `Se te ha asignado la tarea "${newTaskDoc.title}" con fecha límite ${newTaskDoc.dueDate}. Asignada por ${profile.name}.`,
            '',
            false,
            {
              taskId: newTaskRef.id,
              type: 'task',
              creatorUid: profile.uid,
              creatorEmail: profile.email,
              isCreationNotification: true
            }
          );

          if (systemSettings.emailNotificationsEnabled && recipient.email) {
            try {
              await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to: recipient.email,
                  subject: `📋 Nueva Tarea Asignada: ${newTaskDoc.title}`,
                  html: `
                    <div style="font-family: sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px;">
                      <h2 style="color: #4f46e5; margin-top: 0;">Nueva Tarea Asignada</h2>
                      <p>Estimado/a <strong>${recipient.name}</strong>,</p>
                      <p>Se te ha asignado una nueva tarea en el sistema:</p>
                      <div style="background-color: #f8fafc; border-left: 4px solid #4f46e5; padding: 16px; margin: 16px 0; border-radius: 4px;">
                        <h3 style="margin: 0 0 8px 0; color: #0f172a;">${newTaskDoc.title}</h3>
                        <p style="margin: 0 0 8px 0; color: #475569;">${newTaskDoc.description}</p>
                        <p style="margin: 0; font-size: 13px; font-weight: bold; color: #e11d48;">Fecha Límite: ${newTaskDoc.dueDate}</p>
                      </div>
                      <p style="font-size: 12px; color: #94a3b8;">Asignado por: ${profile.name} (${profile.role})</p>
                    </div>
                  `
                })
              });
            } catch (err) {
              console.error("Task email error:", err);
            }
          }
        }
      }

      await addLog(
        'Asignó tarea(s)',
        `Creado y asignado por: ${profile.name} (${profile.role} - ${profile.email}) | Título: ${taskFormData.title} | Destinatarios (${recipientsToNotify.length}): ${recipientsToNotify.map(r => `${r.name} (${r.role})`).join(', ')} | Fecha límite: ${taskFormData.dueDate}`,
        { module: 'Tareas / Felicitaciones' }
      );
      setShowAssignModal(false);
      setTaskFormData({ title: '', description: '', dueDate: format(new Date(Date.now() + 7 * 86400000), 'yyyy-MM-dd'), targetType: 'SPECIFIC', selectedEmails: [] });
      showSystemPopup("Tarea asignada", "Tarea(s) asignada(s) correctamente.", "success");
    } catch (error) {
      console.error("Error creating task:", error);
      showSystemPopup("Error", "Error al asignar la tarea.", "error");
    }
  };

  const handleSendCongratulation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!congratFormData.message.trim()) {
      showSystemPopup("Campo requerido", "Por favor escribe el mensaje de felicitación.", "info");
      return;
    }

    const recipientsToNotify = getRecipientsForTarget(congratFormData.targetType, congratFormData.selectedEmails);

    if (recipientsToNotify.length === 0) {
      showSystemPopup("Sin destinatarios", "No se encontraron destinatarios.", "info");
      return;
    }

    try {
      for (const rec of recipientsToNotify) {
        // Create task document so felicitación appears in Tareas for both sender and recipient
        const congratTaskDoc: Omit<Task, 'id'> = {
          title: `🎉 ${congratFormData.title}`,
          description: `Reconocimiento enviado por ${profile.name} (${profile.role}):\n${congratFormData.message}`,
          dueDate: '',
          assignedToEmail: rec.email.toLowerCase(),
          assignedToName: rec.name,
          assignedToRole: rec.role,
          createdByEmail: profile.email.toLowerCase(),
          createdByName: profile.name,
          createdByRole: profile.role,
          createdAt: Date.now(),
          status: 'COMPLETADA',
        };

        const newTaskRef = await addDoc(collection(db, 'tasks'), congratTaskDoc);

        // Do not notify or send email to the user who created/sent the congratulation
        const isSelf = rec.email.toLowerCase() === profile.email.toLowerCase() ||
                       (rec.uid && rec.uid === profile.uid);

        if (!isSelf) {
          await sendNotification(
            rec.email,
            `🎉 ${congratFormData.title}`,
            `${congratFormData.message}\n\n- Mensaje enviado por ${profile.name} (${profile.role})`,
            '',
            false,
            {
              type: 'felicitacion',
              taskId: newTaskRef.id,
              creatorUid: profile.uid,
              creatorEmail: profile.email,
              isCreationNotification: true
            }
          );

          if (systemSettings.emailNotificationsEnabled && rec.email) {
            try {
              await fetch('/api/send-email', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  to: rec.email,
                  subject: `🎉 ${congratFormData.title}`,
                  html: `
                    <div style="font-family: sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #bbf7d0; border-radius: 12px; padding: 24px; background-color: #f0fdf4;">
                      <h2 style="color: #166534; margin-top: 0;">🎉 ${congratFormData.title}</h2>
                      <p>Estimado/a <strong>${rec.name}</strong>,</p>
                      <div style="background-color: #ffffff; border: 1px solid #86efac; padding: 16px; margin: 16px 0; border-radius: 8px;">
                        <p style="margin: 0; font-size: 15px; color: #15803d; line-height: 1.6;">${congratFormData.message.replace(/\n/g, '<br/>')}</p>
                      </div>
                      <p style="font-size: 12px; color: #166534; font-weight: bold;">Enviado por: ${profile.name} (${profile.role})</p>
                    </div>
                  `
                })
              });
            } catch (err) {
              console.error("Congratulation email error:", err);
            }
          }
        }
      }

      await addLog(
        'Envió mensaje de felicitación',
        `Creado y enviado por: ${profile.name} (${profile.role} - ${profile.email}) | Título: ${congratFormData.title} | Destinatarios (${recipientsToNotify.length}): ${recipientsToNotify.map(r => `${r.name} (${r.role})`).join(', ')}`,
        { module: 'Tareas / Felicitaciones' }
      );
      setShowCongratulationModal(false);
      setCongratFormData({ targetType: 'SPECIFIC', selectedEmails: [], title: '¡Felicitaciones y Reconocimiento!', message: '' });
      showSystemPopup("Felicitación enviada", "Mensaje de felicitación enviado y registrado en Tareas correctamente.", "success");
    } catch (err) {
      console.error("Error sending congratulation:", err);
      showSystemPopup("Error", "Error al enviar la felicitación.", "error");
    }
  };

  const handleOpenTask = async (task: Task) => {
    setSelectedTask(task);
    setEvidenceText(task.evidenceText || '');
    setEvidenceFile(task.evidenceFiles?.[0] || '');
    setDirectiveFeedback(task.directiveFeedback || '');

    if (task.assignedToEmail.toLowerCase() === profile.email.toLowerCase() && task.status === 'ASIGNADA') {
      try {
        await updateDoc(doc(db, 'tasks', task.id), {
          status: 'RECIBIDA',
          readAt: Date.now(),
        });
      } catch (err) {
        console.error("Error setting task to RECIBIDA:", err);
      }
    }
  };

  const handleSubmitEvidence = async (task: Task) => {
    if (!evidenceText.trim()) {
      showSystemPopup("Campo requerido", "Por favor describe la evidencia o el trabajo realizado.", "info");
      return;
    }
    try {
      const filesArr = evidenceFile.trim() ? [evidenceFile.trim()] : [];
      await updateDoc(doc(db, 'tasks', task.id), {
        status: 'REALIZADA',
        evidenceText: evidenceText.trim(),
        evidenceFiles: filesArr,
        evidenceSubmittedAt: Date.now(),
      });

      await sendNotification(
        task.createdByEmail,
        `📥 Evidencia de Tarea Entregada: ${task.title}`,
        `${profile.name} ha entregado la evidencia para la tarea "${task.title}". Estatus cambiado a REALIZADA.`
      );

      await addLog(
        'Entregó evidencia de tarea',
        `Entregado por: ${profile.name} (${profile.role} - ${profile.email}) | Tarea: ${task.title} | Asignado originalmente a: ${task.assignedToName} | Creador de tarea: ${task.createdByName}`,
        { module: 'Tareas / Felicitaciones', recordId: task.id }
      );
      setSelectedTask(null);
      setEvidenceText('');
      setEvidenceFile('');
    } catch (err) {
      console.error("Error submitting evidence:", err);
    }
  };

  const handleUpdateTaskStatus = async (task: Task, newStatus: TaskStatus) => {
    try {
      const updates: any = { status: newStatus };
      if (newStatus === 'ASIGNADA') {
        updates.directiveFeedback = directiveFeedback.trim() || 'Por favor revisa y corrige la evidencia enviada.';
      }

      await updateDoc(doc(db, 'tasks', task.id), updates);

      if (newStatus === 'COMPLETADA') {
        await sendNotification(
          task.assignedToEmail,
          `✅ Tarea Aprobada: ${task.title}`,
          `Tu tarea "${task.title}" ha sido revisada y marcada como COMPLETADA por ${profile.name}.`
        );
        await addLog(
          'Aprobó tarea (COMPLETADA)',
          `Revisado y aprobado por: ${profile.name} (${profile.role} - ${profile.email}) | Tarea: ${task.title} | Realizado por: ${task.assignedToName}`,
          { module: 'Tareas / Felicitaciones', recordId: task.id }
        );
      } else if (newStatus === 'ASIGNADA') {
        await sendNotification(
          task.assignedToEmail,
          `⚠️ Tarea Reasignada para Corrección: ${task.title}`,
          `Tu tarea "${task.title}" ha sido cambiada a ASIGNADA: ${directiveFeedback.trim() || 'Revisa observaciones.'}`
        );
        await addLog(
          'Reasignó tarea (ASIGNADA)',
          `Revisado y reasignado por: ${profile.name} (${profile.role} - ${profile.email}) | Tarea: ${task.title} | Observaciones: "${directiveFeedback.trim() || 'Revisa observaciones.'}"`,
          { module: 'Tareas / Felicitaciones', recordId: task.id }
        );
      }

      setSelectedTask(null);
      setDirectiveFeedback('');
    } catch (err) {
      console.error("Error updating status:", err);
    }
  };

  const filteredTasks = tasks.map(t => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    if (t.status === 'REALIZADA' && t.dueDate && todayStr >= t.dueDate) {
      return { ...t, status: 'COMPLETADA' as TaskStatus };
    }
    return t;
  }).filter(t => {
    if (taskFilter === 'ALL') return true;
    if (taskFilter === 'INCUMPLIDA') return isTaskOverdue(t);
    return t.status === taskFilter;
  });

  const getStatusBadge = (task: Task) => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const isAutoCompleted = task.status === 'REALIZADA' && task.dueDate && todayStr >= task.dueDate;
    if (isAutoCompleted || task.status === 'COMPLETADA') {
      return (
        <span className="bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-200 text-xs font-bold px-2.5 py-1 rounded-full border border-emerald-200 dark:border-emerald-800 flex items-center gap-1">
          <CheckCircle2 className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
          {isAutoCompleted ? 'Completada (Auto)' : 'Completada'}
        </span>
      );
    }
    if (isTaskOverdue(task)) {
      return (
        <span className="bg-red-100 dark:bg-red-950/80 text-red-800 dark:text-red-200 text-xs font-bold px-2.5 py-1 rounded-full border border-red-300 dark:border-red-800 flex items-center gap-1 shadow-sm">
          <AlertTriangle className="w-3.5 h-3.5 text-red-600 dark:text-red-400 flex-shrink-0" /> Incumplida
        </span>
      );
    }
    switch (task.status) {
      case 'RECIBIDA':
        return <span className="bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-200 text-xs font-bold px-2.5 py-1 rounded-full border border-blue-200 dark:border-blue-800 flex items-center gap-1"><Eye className="w-3 h-3 text-blue-600 dark:text-blue-400" /> Recibida</span>;
      case 'ASIGNADA':
        return <span className="bg-amber-100 dark:bg-amber-950/80 text-amber-800 dark:text-amber-200 text-xs font-bold px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800 flex items-center gap-1"><Clock className="w-3 h-3 text-amber-600 dark:text-amber-400" /> Re-asignada</span>;
      case 'REALIZADA':
        return <span className="bg-purple-100 dark:bg-purple-950/80 text-purple-800 dark:text-purple-200 text-xs font-bold px-2.5 py-1 rounded-full border border-purple-200 dark:border-purple-800 flex items-center gap-1"><FileText className="w-3 h-3 text-purple-600 dark:text-purple-400" /> Realizada</span>;
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Gestión de Tareas</h1>
          <p className="text-slate-500 dark:text-slate-400">
            {isDirectiveOrAdmin
              ? 'Asigna, supervisa y revisa tareas y compromisos del personal'
              : 'Consulta tus tareas asignadas y envía evidencias de cumplimiento'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canSendCongratulations && (
            <button
              onClick={() => setShowCongratulationModal(true)}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl shadow-md transition-all font-bold text-sm cursor-pointer"
            >
              <Award className="w-4 h-4" />
              <span>Enviar Felicitación</span>
            </button>
          )}
          {canCreateTask && (
            <button
              onClick={() => setShowAssignModal(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl shadow-md transition-all font-bold text-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Asignar Tarea</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 border-b border-slate-200 dark:border-slate-800">
        {(['ALL', 'RECIBIDA', 'ASIGNADA', 'REALIZADA', 'COMPLETADA', 'INCUMPLIDA'] as const).map(st => (
          <button
            key={st}
            onClick={() => setTaskFilter(st)}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer",
              taskFilter === st
                ? st === 'INCUMPLIDA' ? "bg-red-600 text-white shadow-sm" : "bg-indigo-600 text-white shadow-sm"
                : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700"
            )}
          >
            {st === 'ALL' ? 'Todas' : st === 'ASIGNADA' ? 'Re-asignada' : st === 'RECIBIDA' ? 'Recibida' : st === 'REALIZADA' ? 'Realizada' : st === 'COMPLETADA' ? 'Completada' : '⚠️ Incumplidas'}
          </button>
        ))}
      </div>

      {/* Task List */}
      {filteredTasks.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 p-12 text-center text-slate-400 dark:text-slate-500">
          <CheckCircle2 className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="text-sm font-medium">No hay tareas en esta categoría.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredTasks.map((t) => {
            const overdue = isTaskOverdue(t);
            return (
              <div
                key={t.id}
                onClick={() => handleOpenTask(t)}
                className={cn(
                  "rounded-2xl border p-5 transition-all cursor-pointer space-y-3",
                  overdue
                    ? "bg-red-50/40 dark:bg-red-950/30 border-red-200 dark:border-red-900/60 border-l-4 border-l-red-500 hover:border-red-300 dark:hover:border-red-700 hover:shadow-md"
                    : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      {t.title}
                      {overdue && (
                        <span className="text-[10px] font-bold px-2 py-0.5 bg-red-100 dark:bg-red-950/80 text-red-700 dark:text-red-300 rounded-full border border-red-200 dark:border-red-800 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3 text-red-600 dark:text-red-400" /> Vencida
                        </span>
                      )}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-500 dark:text-slate-400 font-medium">
                      <span>Para: <strong className="text-slate-800 dark:text-slate-200">{t.assignedToName}</strong> ({t.assignedToRole})</span>
                      <span>De: <strong className="text-slate-800 dark:text-slate-200">{t.createdByName}</strong> ({t.createdByRole})</span>
                      {t.dueDate ? (
                        <span className={cn("font-bold px-1.5 py-0.5 rounded", overdue ? "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300" : "text-red-600 dark:text-red-400")}>
                          Límite: {t.dueDate}
                        </span>
                      ) : (
                        <span className="font-bold px-2 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 text-xs flex items-center gap-1">
                          🎉 Reconocimiento
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div>{getStatusBadge(t)}</div>
                    {(canDeleteRecords || t.createdByEmail?.toLowerCase() === profile?.email?.toLowerCase()) && (
                      <button
                        type="button"
                        onClick={(e) => handleDeleteTask(t, e)}
                        title="Eliminar registro"
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40 rounded-lg transition-all cursor-pointer"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2">{t.description}</p>

                {t.directiveFeedback && (
                  <div className="bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-xs">
                    <strong className="text-amber-800 dark:text-amber-300 font-bold">Observación de Dirección:</strong>{' '}
                    <span className="text-amber-950 dark:text-amber-100 font-semibold">{t.directiveFeedback}</span>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-400 dark:text-slate-500">
                  <span>Creada: {format(t.createdAt, 'dd/MM/yyyy HH:mm')}</span>
                  <span className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline">Ver detalles →</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Assign Task Modal */}
      <AnimatePresence>
        {showAssignModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAssignModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">Asignar Nueva Tarea</h2>
              <form onSubmit={handleAssignTask} className="space-y-4">
                <InputGroup label="Opciones de Destinatario" required>
                  <select
                    value={taskFormData.targetType}
                    onChange={(e) => setTaskFormData({ ...taskFormData, targetType: e.target.value as any })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500 mb-2"
                  >
                    <option value="SPECIFIC">Seleccionar Persona(s) Específica(s)</option>
                    <option value="ALL_TEACHERS">Todos los Docentes</option>
                    <option value="ALL_COORDINATORS">Todos los Coordinadores</option>
                    <option value="ALL_STAFF">Todo el Personal</option>
                  </select>
                </InputGroup>

                {taskFormData.targetType === 'SPECIFIC' && (
                  <InputGroup label="Seleccionar Persona(s)" required={taskFormData.selectedEmails.length === 0}>
                    <div className="space-y-3">
                      <select
                        value=""
                        onChange={(e) => {
                          const email = e.target.value;
                          if (email && !taskFormData.selectedEmails.includes(email)) {
                            setTaskFormData({ ...taskFormData, selectedEmails: [...taskFormData.selectedEmails, email] });
                          }
                        }}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-indigo-500"
                      >
                        <option value="">-- Selecciona persona para agregar --</option>
                        <optgroup label="Coordinadores">
                          {coordinators.map(c => (
                            <option key={c.email} value={c.email} disabled={taskFormData.selectedEmails.includes(c.email)}>
                              {c.name} ({c.role})
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Docentes">
                          {teachers.map(t => (
                            <option key={t.email} value={t.email} disabled={taskFormData.selectedEmails.includes(t.email)}>
                              {t.name} ({t.role})
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Psicólogos">
                          {psychologists.map(p => (
                            <option key={p.email} value={p.email} disabled={taskFormData.selectedEmails.includes(p.email)}>
                              {p.name} ({p.role})
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      <div className="flex flex-wrap gap-2">
                        {taskFormData.selectedEmails.map((email) => {
                          const person = assignableUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
                          return (
                            <div 
                              key={email}
                              onClick={() => {
                                setTaskFormData({
                                  ...taskFormData,
                                  selectedEmails: taskFormData.selectedEmails.filter(e => e.toLowerCase() !== email.toLowerCase())
                                });
                              }}
                              className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-950/80 text-indigo-700 dark:text-indigo-200 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-700 dark:hover:text-red-300 border border-indigo-100 dark:border-indigo-800 hover:border-red-100 dark:hover:border-red-800 transition-all group"
                            >
                              <UserIcon className="w-3.5 h-3.5" />
                              <span>{person?.name || email}</span>
                              <X className="w-3.5 h-3.5 ml-1 text-indigo-400 group-hover:text-red-500" />
                            </div>
                          );
                        })}
                        {taskFormData.selectedEmails.length === 0 && (
                          <span className="text-xs text-slate-400 dark:text-slate-500 italic px-1">Sin personas seleccionadas. Elige personas arriba para agregarlas.</span>
                        )}
                      </div>
                    </div>
                  </InputGroup>
                )}

                <InputGroup label="Título de la Tarea" required>
                  <input
                    required
                    type="text"
                    value={taskFormData.title}
                    onChange={(e) => setTaskFormData({ ...taskFormData, title: e.target.value })}
                    placeholder="Ej. Entrega de planeaciones del mes"
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500"
                  />
                </InputGroup>

                <InputGroup label="Descripción / Instrucciones" required>
                  <textarea
                    required
                    rows={4}
                    value={taskFormData.description}
                    onChange={(e) => setTaskFormData({ ...taskFormData, description: e.target.value })}
                    placeholder="Describe los requerimientos y lo que debe incluir la evidencia..."
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-indigo-500"
                  />
                </InputGroup>

                <InputGroup label="Fecha Límite" required>
                  <input
                    required
                    type="date"
                    value={taskFormData.dueDate}
                    onChange={(e) => setTaskFormData({ ...taskFormData, dueDate: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:ring-2 focus:ring-indigo-500 font-medium"
                  />
                </InputGroup>

                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setShowAssignModal(false)} className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">Cancelar</button>
                  <button type="submit" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl shadow-lg shadow-indigo-100 dark:shadow-none cursor-pointer">Asignar Tarea</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Congratulation Modal */}
      <AnimatePresence>
        {showCongratulationModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowCongratulationModal(false)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-emerald-100 dark:bg-emerald-950/80 text-emerald-600 dark:text-emerald-400 rounded-xl"><Award className="w-6 h-6" /></div>
                <h2 className="text-2xl font-bold text-slate-900 dark:text-white">Enviar Felicitación</h2>
              </div>
              <form onSubmit={handleSendCongratulation} className="space-y-4">
                <InputGroup label="Opciones de Destinatario" required>
                  <select
                    value={congratFormData.targetType}
                    onChange={(e) => setCongratFormData({ ...congratFormData, targetType: e.target.value as any })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 mb-2"
                  >
                    <option value="SPECIFIC">Seleccionar Persona(s) Específica(s)</option>
                    <option value="ALL_TEACHERS">Todos los Docentes</option>
                    <option value="ALL_COORDINATORS">Todos los Coordinadores</option>
                    <option value="ALL_STAFF">Todo el Personal</option>
                  </select>
                </InputGroup>

                {congratFormData.targetType === 'SPECIFIC' && (
                  <InputGroup label="Seleccionar Persona(s)" required={congratFormData.selectedEmails.length === 0}>
                    <div className="space-y-3">
                      <select
                        value=""
                        onChange={(e) => {
                          const email = e.target.value;
                          if (email && !congratFormData.selectedEmails.includes(email)) {
                            setCongratFormData({ ...congratFormData, selectedEmails: [...congratFormData.selectedEmails, email] });
                          }
                        }}
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">-- Selecciona persona para agregar --</option>
                        <optgroup label="Coordinadores">
                          {coordinators.map(c => (
                            <option key={c.email} value={c.email} disabled={congratFormData.selectedEmails.includes(c.email)}>
                              {c.name} ({c.role})
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Docentes">
                          {teachers.map(t => (
                            <option key={t.email} value={t.email} disabled={congratFormData.selectedEmails.includes(t.email)}>
                              {t.name} ({t.role})
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Psicólogos">
                          {psychologists.map(p => (
                            <option key={p.email} value={p.email} disabled={congratFormData.selectedEmails.includes(p.email)}>
                              {p.name} ({p.role})
                            </option>
                          ))}
                        </optgroup>
                      </select>

                      <div className="flex flex-wrap gap-2">
                        {congratFormData.selectedEmails.map((email) => {
                          const person = assignableUsers.find(u => u.email.toLowerCase() === email.toLowerCase());
                          return (
                            <div 
                              key={email}
                              onClick={() => {
                                setCongratFormData({
                                  ...congratFormData,
                                  selectedEmails: congratFormData.selectedEmails.filter(e => e.toLowerCase() !== email.toLowerCase())
                                });
                              }}
                              className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-200 px-3 py-1.5 rounded-full text-xs font-bold cursor-pointer hover:bg-red-50 dark:hover:bg-red-950 hover:text-red-700 dark:hover:text-red-300 border border-emerald-100 dark:border-emerald-800 hover:border-red-100 dark:hover:border-red-800 transition-all group"
                            >
                              <UserIcon className="w-3.5 h-3.5" />
                              <span>{person?.name || email}</span>
                              <X className="w-3.5 h-3.5 ml-1 text-emerald-400 group-hover:text-red-500" />
                            </div>
                          );
                        })}
                        {congratFormData.selectedEmails.length === 0 && (
                          <span className="text-xs text-slate-400 dark:text-slate-500 italic px-1">Sin personas seleccionadas. Elige personas arriba para agregarlas.</span>
                        )}
                      </div>
                    </div>
                  </InputGroup>
                )}

                <InputGroup label="Título del Reconocimiento" required>
                  <input
                    required
                    type="text"
                    value={congratFormData.title}
                    onChange={(e) => setCongratFormData({ ...congratFormData, title: e.target.value })}
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
                  />
                </InputGroup>

                <InputGroup label="Mensaje de Felicitación" required>
                  <textarea
                    required
                    rows={4}
                    value={congratFormData.message}
                    onChange={(e) => setCongratFormData({ ...congratFormData, message: e.target.value })}
                    placeholder="Expresa un reconocimiento por su compromiso, esfuerzo o logros destacados..."
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-emerald-500"
                  />
                </InputGroup>

                <div className="flex gap-3 pt-4">
                  <button type="button" onClick={() => setShowCongratulationModal(false)} className="flex-1 py-2.5 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">Cancelar</button>
                  <button type="submit" className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-lg shadow-emerald-100 dark:shadow-none cursor-pointer">Enviar Reconocimiento</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Task Details & Evidence Modal */}
      <AnimatePresence>
        {selectedTask && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedTask(null)} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl p-6 max-h-[90vh] overflow-y-auto space-y-6">
              <div className="flex items-start justify-between gap-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <div className="mb-1">{getStatusBadge(selectedTask)}</div>
                  <h2 className="text-2xl font-bold text-slate-900 dark:text-white">{selectedTask.title}</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Asignada a <strong className="text-slate-800 dark:text-slate-200">{selectedTask.assignedToName}</strong> por {selectedTask.createdByName}</p>
                </div>
                <div className="flex items-center gap-2">
                  {(canDeleteRecords || selectedTask.createdByEmail?.toLowerCase() === profile?.email?.toLowerCase()) && (
                    <button
                      type="button"
                      onClick={(e) => handleDeleteTask(selectedTask, e)}
                      title="Eliminar registro"
                      className="px-3 py-1.5 bg-red-50 dark:bg-red-950/60 hover:bg-red-100 dark:hover:bg-red-900/60 text-red-600 dark:text-red-300 rounded-xl transition-all flex items-center gap-1.5 text-xs font-bold border border-red-200 dark:border-red-800 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Eliminar</span>
                    </button>
                  )}
                  <button onClick={() => setSelectedTask(null)} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl cursor-pointer"><X className="w-5 h-5" /></button>
                </div>
              </div>

              <div className="space-y-4">
                {isTaskOverdue(selectedTask) && (
                  <div className="bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800 text-red-900 dark:text-red-200 rounded-xl p-3.5 text-xs font-bold flex items-center gap-2.5 shadow-sm">
                    <AlertTriangle className="w-4 h-4 text-red-600 dark:text-red-400 flex-shrink-0" />
                    <span>⚠️ Esta tarea superó la fecha límite ({selectedTask.dueDate}) sin completarse y ha sido marcada como INCUMPLIDA.</span>
                  </div>
                )}
                <div>
                  <h4 className="text-xs font-bold text-slate-400 dark:text-slate-400 uppercase tracking-wider mb-1">Descripción / Instrucciones</h4>
                  <div className="bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700/80 rounded-xl p-4 text-sm text-slate-800 dark:text-slate-100 whitespace-pre-line">
                    {selectedTask.description}
                  </div>
                </div>

                <div className="flex items-center gap-6 text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/80 p-3 rounded-xl border border-slate-100 dark:border-slate-700/80">
                  {selectedTask.dueDate ? (
                    <span>Fecha Límite: <strong className="text-red-600 dark:text-red-400 font-bold">{selectedTask.dueDate}</strong></span>
                  ) : (
                    <span>Tipo: <strong className="text-emerald-700 dark:text-emerald-400 font-bold">🎉 Reconocimiento / Felicitación (Sin Límite)</strong></span>
                  )}
                  {selectedTask.readAt && <span>Visto: {format(selectedTask.readAt, 'dd/MM HH:mm')}</span>}
                </div>

                {selectedTask.directiveFeedback && (
                  <div className="bg-amber-50 dark:bg-amber-950/80 border border-amber-200 dark:border-amber-700 rounded-xl p-4 text-xs space-y-1.5">
                    <strong className="text-amber-800 dark:text-amber-300 font-bold block text-xs uppercase tracking-wider">Observaciones de Dirección / Reasignación:</strong>
                    <p className="text-amber-950 dark:text-amber-100 font-semibold text-sm leading-relaxed bg-amber-100/60 dark:bg-amber-900/40 p-3 rounded-lg border border-amber-200/80 dark:border-amber-800/80">
                      {selectedTask.directiveFeedback}
                    </p>
                  </div>
                )}

                {/* Evidence Details if submitted */}
                {selectedTask.evidenceText && (
                  <div>
                    <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-300 uppercase tracking-wider mb-1">Evidencia Entregada</h4>
                    <div className="bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-200 dark:border-emerald-700 rounded-xl p-4 text-sm whitespace-pre-line space-y-2">
                      <p className="text-emerald-950 dark:text-emerald-100 font-semibold text-sm leading-relaxed bg-emerald-100/60 dark:bg-emerald-900/40 p-3 rounded-lg border border-emerald-200/80 dark:border-emerald-800/80">
                        {selectedTask.evidenceText}
                      </p>
                      {selectedTask.evidenceFiles && selectedTask.evidenceFiles.length > 0 && (
                        <div className="pt-2 border-t border-emerald-200 dark:border-emerald-800">
                          <span className="text-xs font-bold text-emerald-800 dark:text-emerald-300">Enlace / Archivo: </span>
                          <a href={selectedTask.evidenceFiles[0]} target="_blank" rel="noopener noreferrer" className="text-xs text-indigo-600 dark:text-indigo-300 underline font-semibold break-all">
                            {selectedTask.evidenceFiles[0]}
                          </a>
                        </div>
                      )}
                      {selectedTask.evidenceSubmittedAt && (
                        <span className="block text-[11px] text-emerald-700 dark:text-emerald-300 font-bold">Entregado el: {format(selectedTask.evidenceSubmittedAt, 'dd/MM/yyyy HH:mm')}</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Form to Submit Evidence for Assigned User */}
                {selectedTask.assignedToEmail.toLowerCase() === profile.email.toLowerCase() &&
                  (selectedTask.status === 'RECIBIDA' || selectedTask.status === 'ASIGNADA') && (
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                      <Send className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                      Subir / Compartir Evidencia de Cumplimiento
                    </h4>
                    <InputGroup label="Detalles de la Evidencia" required>
                      <textarea
                        rows={3}
                        value={evidenceText}
                        onChange={(e) => setEvidenceText(e.target.value)}
                        placeholder="Describe el trabajo realizado o cómo se dio cumplimiento a la tarea..."
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      />
                    </InputGroup>
                    <InputGroup label="Enlace de Evidencia (Google Drive / Archivo URL)">
                      <input
                        type="url"
                        value={evidenceFile}
                        onChange={(e) => setEvidenceFile(e.target.value)}
                        placeholder="https://..."
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      />
                    </InputGroup>
                    <button
                      onClick={() => handleSubmitEvidence(selectedTask)}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 rounded-xl shadow-md transition-all text-sm cursor-pointer"
                    >
                      Enviar Evidencia al Directivo (Estatus: Realizada)
                    </button>
                  </div>
                )}

                {/* Directive Review Options for REALIZADA status */}
                {isDirectiveOrAdmin && selectedTask.status === 'REALIZADA' && (
                  <div className="border-t border-slate-200 dark:border-slate-800 pt-4 space-y-3">
                    <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">Revisión de Evidencia por Dirección</h4>
                    <InputGroup label="Observaciones (si requiere corrección)">
                      <input
                        type="text"
                        value={directiveFeedback}
                        onChange={(e) => setDirectiveFeedback(e.target.value)}
                        placeholder="Escribe comentarios de corrección si la reasignas..."
                        className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl p-2.5 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500"
                      />
                    </InputGroup>
                    <div className="flex gap-3">
                      <button
                        onClick={() => handleUpdateTaskStatus(selectedTask, 'ASIGNADA')}
                        className="flex-1 bg-amber-50 dark:bg-amber-950/60 hover:bg-amber-100 dark:hover:bg-amber-900/60 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800 font-bold py-2.5 rounded-xl text-sm transition-all cursor-pointer"
                      >
                        Reasignar (Requerir Corrección)
                      </button>
                      <button
                        onClick={() => handleUpdateTaskStatus(selectedTask, 'COMPLETADA')}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-2.5 rounded-xl shadow-md text-sm transition-all cursor-pointer"
                      >
                        Aprobar (Marcar Completada)
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <SystemModal modal={sysModal} onClose={() => setSysModal(prev => ({ ...prev, isOpen: false }))} />
    </div>
  );
};

const UserManagement = ({ profile, coordinators, teachers, psychologists, directives = [], admins, blockedUsers = [], addLog, canManageUsers = true, canAssignPsychologist = true, systemSettings, firestoreRolePermissions, sendNotification, sendEmail }: { 
  profile: UserProfile, 
  coordinators: UserProfile[], 
  teachers: UserProfile[], 
  psychologists: UserProfile[],
  directives?: UserProfile[],
  admins: UserProfile[],
  blockedUsers?: UserProfile[],
  addLog: (action: string, details?: string, extra?: {
    module?: string;
    recordId?: string;
    creatorName?: string;
    creatorEmail?: string;
    creatorRole?: string;
    userEmail?: string;
    userName?: string;
    userRole?: string;
  }) => Promise<void>,
  canManageUsers?: boolean,
  canAssignPsychologist?: boolean,
  systemSettings: SystemSettings,
  firestoreRolePermissions?: Partial<RolePermissionsMap>,
  sendNotification?: (userIdOrIds: string | string[], title: string, message: string, incidentId?: string, skipAdmins?: boolean, extraData?: Record<string, any>) => Promise<void>,
  sendEmail?: (to: string, subject: string, html: string) => Promise<any>
}) => {
  const [sysModal, setSysModal] = useState<SystemModalState>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info'
  });

  const showSystemPopup = (
    title: string,
    message: string,
    type: 'success' | 'error' | 'warning' | 'info' | 'confirm' = 'info'
  ) => {
    setSysModal({ isOpen: true, title, message, type });
  };

  const [showAddModal, setShowAddModal] = useState(false);
  const [userToEditPermissions, setUserToEditPermissions] = useState<UserProfile | null>(null);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  const [newUserRole, setNewUserRole] = useState<UserRole>(
    profile.role === 'COORDINATOR' ? 'TEACHER' : profile.role === 'DIRECTIVE' ? 'COORDINATOR' : 'TEACHER'
  );
  const [educationLevel, setEducationLevel] = useState<'Preescolar' | 'Primaria' | 'Secundaria'>('Primaria');
  const [teacherLevelFilter, setTeacherLevelFilter] = useState<'TODOS' | 'Preescolar' | 'Primaria' | 'Secundaria' | 'SinNivel'>('TODOS');
  const [teacherSearchQuery, setTeacherSearchQuery] = useState('');
  const [activeUserTab, setActiveUserTab] = useState<UserRole | 'DIRECTIVE' | 'BLOQUEADO'>(
    profile.role === 'ADMIN' || isSuperAdminEmail(profile.email) 
      ? 'ADMIN' 
      : profile.role === 'DIRECTIVE'
      ? 'DIRECTIVE'
      : 'COORDINATOR'
  );
  const [formData, setFormData] = useState({ name: '', email: '', password: '' });
  const [loading, setLoading] = useState(false);

  const isSuperAdmin = isSuperAdminEmail(profile.email);
  const isAdmin = profile.role === 'ADMIN';
  const isDirective = profile.role === 'DIRECTIVE';
  const isCoordinator = profile.role === 'COORDINATOR';

  const isEmailAlreadyRegistered = useMemo(() => {
    if (!formData.email || !formData.email.includes('@')) return false;
    const clean = formData.email.toLowerCase().trim();
    const all = [...admins, ...directives, ...coordinators, ...psychologists, ...teachers, ...blockedUsers];
    return all.some(u => u.email?.toLowerCase().trim() === clean);
  }, [formData.email, admins, directives, coordinators, psychologists, teachers, blockedUsers]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email || !formData.email.includes('@')) {
      showSystemPopup("Correo inválido", "Ingresa un correo electrónico válido.", "warning");
      return;
    }
    setLoading(true);
    try {
      const emailId = formData.email.toLowerCase().trim();

      // Validación exhaustiva: Verificar si el correo ya está registrado en el sistema
      const allKnownUsers = [
        ...admins,
        ...directives,
        ...coordinators,
        ...psychologists,
        ...teachers,
        ...blockedUsers
      ];
      const isAlreadyInList = allKnownUsers.some(u => u.email?.toLowerCase().trim() === emailId);

      let existsInDb = false;

      // 1. Direct getDoc by emailId
      try {
        const checkDoc = await safeGetDoc(doc(db, 'users', emailId));
        if (checkDoc && checkDoc.exists()) {
          existsInDb = true;
        }
      } catch (checkErr) {
        console.warn("Direct checkDoc notice:", checkErr);
      }

      // 2. Query collection users where email == emailId
      if (!existsInDb) {
        try {
          const qSnap = await safeGetDocs(query(collection(db, 'users'), where('email', '==', emailId), limit(1)));
          if (qSnap && !qSnap.empty) {
            existsInDb = true;
          }
        } catch (qErr) {
          console.warn("Query check notice:", qErr);
        }
      }

      // 3. Query collection users where uid == emailId
      if (!existsInDb) {
        try {
          const qUidSnap = await safeGetDocs(query(collection(db, 'users'), where('uid', '==', emailId), limit(1)));
          if (qUidSnap && !qUidSnap.empty) {
            existsInDb = true;
          }
        } catch (qUidErr) {
          console.warn("Query UID check notice:", qUidErr);
        }
      }

      // 4. Server-side check (verifies Firebase Auth and Firestore DB via Admin SDK)
      if (!existsInDb) {
        try {
          const sRes = await fetch(`/api/check-user-email?email=${encodeURIComponent(emailId)}`);
          if (sRes.ok) {
            const sData = await sRes.json();
            if (sData?.exists) {
              existsInDb = true;
            }
          }
        } catch (sErr) {
          console.warn("Server email check notice:", sErr);
        }
      }

      if (isAlreadyInList || existsInDb) {
        setLoading(false);
        showSystemPopup(
          "Correo ya registrado",
          `El correo electrónico "${emailId}" ya se encuentra registrado en el sistema. No se permite registrarlo de nuevo.`,
          "warning"
        );
        return;
      }

      const creatorName = profile?.name || (isSuperAdmin ? 'Superadministrador' : 'Administrador');
      const creatorEmail = profile?.email || 'incidencias.dunor@gmail.com';
      const creatorRole = profile?.role || (isSuperAdmin ? 'ADMIN' : 'COORDINATOR');

      const newUserData: any = {
        name: formData.name.trim(),
        email: emailId,
        role: newUserRole,
        uid: emailId,
        isRegistered: false,
        createdBy: creatorEmail,
        createdByName: creatorName,
        creatorRole: creatorRole,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      // Rule 8: If Coordinator adds a user, auto-link ONLY if the new user is NOT a coordinator
      if (isCoordinator && newUserRole !== 'COORDINATOR') {
        newUserData.assignedCoordinatorId = profile.uid;
        newUserData.assignedCoordinatorEmail = profile.email;
        newUserData.assignedCoordinatorName = profile.name;
      }

      if (newUserRole === 'TEACHER') {
        newUserData.educationLevel = educationLevel;
      }

      await setDoc(doc(db, 'users', emailId), newUserData, { merge: true });

      const logDetails = `Registrado por: ${creatorName} (${creatorRole} - ${creatorEmail}) | Nombre: ${formData.name.trim()} | Email: ${emailId} | Rol: ${newUserRole}${newUserRole === 'TEACHER' && educationLevel ? ` | Nivel: ${educationLevel}` : ''}`;

      try {
        await addLog(
          'Creó un usuario',
          logDetails,
          { 
            module: 'Usuarios', 
            recordId: emailId,
            creatorName,
            creatorEmail,
            creatorRole,
            userEmail: creatorEmail,
            userName: creatorName,
            userRole: creatorRole
          }
        );
      } catch (logErr) {
        console.warn("Notice calling addLog:", logErr);
      }

      // Send registration confirmation email with the access link and welcome message
      const accessUrl = "https://dashboard-dunor.vercel.app/";
      const emailSubject = "Felicidades tu registro al Dashboard DUNOR fue exitosa";
      const emailHtml = `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <div style="background: linear-gradient(135deg, #4f46e5 0%, #3730a3 100%); padding: 28px 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.02em;">Dashboard DUNOR</h1>
            <p style="color: #c7d2fe; margin: 6px 0 0 0; font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Confirmación de Registro</p>
          </div>
          <div style="padding: 28px 24px; background-color: #ffffff;">
            <p style="font-size: 16px; color: #1e293b; margin-top: 0;">Hola <strong>${formData.name.trim()}</strong>,</p>
            
            <div style="background-color: #f0fdf4; border-left: 4px solid #10b981; padding: 16px 20px; border-radius: 8px; margin: 20px 0;">
              <p style="margin: 0; font-size: 15px; color: #166534; font-weight: 700; line-height: 1.5;">
                Felicidades tu registro al Dashboard DUNOR fue exitosa, visita el siguiente enlace para poder acceder, recuerda generar tu contraseña para obtener el acceso.
              </p>
            </div>

            <div style="background-color: #f8fafc; padding: 18px; border-radius: 12px; border: 1px solid #e2e8f0; margin: 20px 0;">
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #334155;"><strong>Tu correo de acceso:</strong> <span style="color: #4f46e5; font-weight: 600;">${emailId}</span></p>
              <p style="margin: 0 0 8px 0; font-size: 14px; color: #334155;"><strong>Rol asignado:</strong> ${newUserRole}</p>
              <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
                Al ser tu primer ingreso, escribe tu correo y el sistema detectará que es tu primer acceso para guiarte en la generación de tu contraseña personal.
              </p>
            </div>

            <div style="text-align: center; margin: 28px 0;">
              <a href="${accessUrl}" target="_blank" rel="noopener noreferrer" style="background-color: #4f46e5; color: #ffffff; padding: 14px 32px; font-size: 15px; font-weight: 700; text-decoration: none; border-radius: 10px; display: inline-block; box-shadow: 0 4px 10px rgba(79, 70, 229, 0.3);">
                Acceder al Dashboard DUNOR
              </a>
            </div>

            <p style="font-size: 13px; color: #64748b; line-height: 1.6; text-align: center; margin: 20px 0 0 0;">
              O accede directamente mediante este enlace:<br />
              <a href="${accessUrl}" target="_blank" rel="noopener noreferrer" style="color: #4f46e5; font-weight: 600; word-break: break-all;">${accessUrl}</a>
            </p>
          </div>
          <div style="background-color: #f1f5f9; padding: 14px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="margin: 0; font-size: 11px; color: #94a3b8; font-weight: 500;">Notificación automática del Sistema DASHBOARD DUNOR.</p>
          </div>
        </div>
      `;

      try {
        if (sendEmail) {
          await sendEmail(emailId, emailSubject, emailHtml);
        } else {
          await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: emailId, subject: emailSubject, html: emailHtml })
          });
        }
      } catch (emailErr) {
        console.warn("Welcome email error:", emailErr);
      }

      showSystemPopup(
        "Usuario Registrado Exitosamente",
        `El usuario "${formData.name}" (${emailId}) ha sido registrado exitosamente.\n\nSe ha enviado un correo de confirmación de registro a ${emailId} con el enlace de acceso (https://dashboard-dunor.vercel.app/) y la indicación para generar su contraseña.`,
        "success"
      );

      setShowAddModal(false);
      setFormData({ name: '', email: '', password: '' });
    } catch (error: any) {
      console.error("Error adding user:", error);
      if (isFirestoreInternalAssertion(error)) {
        showSystemPopup(
          "Usuario Registrado Exitosamente",
          `El usuario "${formData.name}" (${formData.email}) ha sido registrado en el sistema.`,
          "success"
        );
        setShowAddModal(false);
        setFormData({ name: '', email: '', password: '' });
      } else {
        showSystemPopup(
          "Error al Guardar Usuario",
          error?.message || "Ocurrió un error al intentar guardar el usuario en la base de datos.",
          "error"
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const displayedTeachers = isCoordinator
    ? teachers.filter(t => 
        t.assignedCoordinatorId === profile.uid || 
        t.assignedCoordinatorEmail === profile.email || 
        t.assignedCoordinatorName === profile.name ||
        t.secondaryCoordinatorId === profile.uid || 
        t.secondaryCoordinatorEmail === profile.email || 
        t.secondaryCoordinatorName === profile.name
      )
    : teachers;

  const canFilterTeachersByLevel = isSuperAdmin || isAdmin || isDirective;

  const matchesTeacherSearch = (t: UserProfile) => {
    if (!teacherSearchQuery.trim()) return true;
    const q = teacherSearchQuery.toLowerCase().trim();
    const name = (t.name || '').toLowerCase();
    const email = (t.email || '').toLowerCase();
    const phone = (t.phone || '').toLowerCase();
    const coordName = (t.assignedCoordinatorName || '').toLowerCase();
    const secCoordName = (t.secondaryCoordinatorName || '').toLowerCase();
    const lvl = (getUserEducationLevel(t, coordinators) || '').toLowerCase();
    return name.includes(q) || email.includes(q) || phone.includes(q) || coordName.includes(q) || secCoordName.includes(q) || lvl.includes(q);
  };

  const filteredTeachers = displayedTeachers.filter(t => {
    if (canFilterTeachersByLevel && teacherLevelFilter !== 'TODOS') {
      const lvl = getUserEducationLevel(t, coordinators);
      if (teacherLevelFilter === 'SinNivel') {
        if (normalizeEducationLevel(lvl)) return false;
      } else if (normalizeEducationLevel(lvl) !== normalizeEducationLevel(teacherLevelFilter)) {
        return false;
      }
    }
    return matchesTeacherSearch(t);
  });

  const preescolarTeachers = displayedTeachers.filter(
    t => !isSuperAdminEmail(t.email) && normalizeEducationLevel(getUserEducationLevel(t, coordinators)) === 'Preescolar' && matchesTeacherSearch(t)
  );
  const primariaTeachers = displayedTeachers.filter(
    t => !isSuperAdminEmail(t.email) && normalizeEducationLevel(getUserEducationLevel(t, coordinators)) === 'Primaria' && matchesTeacherSearch(t)
  );
  const secundariaTeachers = displayedTeachers.filter(
    t => !isSuperAdminEmail(t.email) && normalizeEducationLevel(getUserEducationLevel(t, coordinators)) === 'Secundaria' && matchesTeacherSearch(t)
  );
  const sinNivelTeachers = displayedTeachers.filter(
    t => !isSuperAdminEmail(t.email) && !normalizeEducationLevel(getUserEducationLevel(t, coordinators)) && matchesTeacherSearch(t)
  );

  const allTeacherLevelGroups = [
    {
      id: 'Preescolar',
      levelKey: 'Preescolar' as const,
      title: 'Docentes de Preescolar',
      description: 'Educación Preescolar / Kínder',
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800',
      headerBg: 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
      iconColor: 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800',
      icon: Sparkles,
      teachers: preescolarTeachers,
      emptyText: teacherSearchQuery 
        ? `No hay docentes de preescolar que coincidan con "${teacherSearchQuery}".` 
        : 'No hay docentes registrados en Preescolar.'
    },
    {
      id: 'Primaria',
      levelKey: 'Primaria' as const,
      title: 'Docentes de Primaria',
      description: 'Educación Primaria (1° a 6° grado)',
      badgeColor: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/60 dark:text-sky-300 dark:border-sky-800',
      headerBg: 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
      iconColor: 'text-sky-600 dark:text-sky-400 bg-sky-50 dark:bg-sky-950/60 border-sky-200 dark:border-sky-800',
      icon: GraduationCap,
      teachers: primariaTeachers,
      emptyText: teacherSearchQuery 
        ? `No hay docentes de primaria que coincidan con "${teacherSearchQuery}".` 
        : 'No hay docentes registrados en Primaria.'
    },
    {
      id: 'Secundaria',
      levelKey: 'Secundaria' as const,
      title: 'Docentes de Secundaria',
      description: 'Educación Secundaria (1° a 3° grado)',
      badgeColor: 'bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800',
      headerBg: 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
      iconColor: 'text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/60 border-purple-200 dark:border-purple-800',
      icon: School,
      teachers: secundariaTeachers,
      emptyText: teacherSearchQuery 
        ? `No hay docentes de secundaria que coincidan con "${teacherSearchQuery}".` 
        : 'No hay docentes registrados en Secundaria.'
    },
    ...(displayedTeachers.some(t => !isSuperAdminEmail(t.email) && !normalizeEducationLevel(getUserEducationLevel(t, coordinators))) ? [{
      id: 'SinNivel',
      levelKey: 'SinNivel' as const,
      title: 'Docentes sin Nivel Asignado',
      description: 'Selecciona el nivel educativo (Preescolar, Primaria o Secundaria) para clasificar a cada docente',
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800',
      headerBg: 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800',
      iconColor: 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800',
      icon: AlertCircle,
      teachers: sinNivelTeachers,
      emptyText: teacherSearchQuery
        ? `No hay docentes sin nivel que coincidan con "${teacherSearchQuery}".`
        : 'No hay docentes sin nivel educativo asignado.'
    }] : [])
  ];

  const teacherLevelGroupsToRender = teacherLevelFilter === 'TODOS'
    ? (teacherSearchQuery ? allTeacherLevelGroups.filter(g => g.teachers.length > 0) : allTeacherLevelGroups)
    : allTeacherLevelGroups.filter(g => g.levelKey === teacherLevelFilter);

  const deleteUser = async (userToDelete: UserProfile) => {
    // Rule 1: Coordinator cannot delete themselves or other coordinators
    if (isCoordinator && (userToDelete.role === 'COORDINATOR' || userToDelete.email.toLowerCase() === profile.email.toLowerCase())) {
      showSystemPopup("Acción no permitida", "Un coordinador no puede eliminarse a sí mismo ni a otros coordinadores.", "info");
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'Eliminar Usuario',
      message: '¿Estás seguro de eliminar este usuario? Se eliminará completamente de la base de datos y del sistema de acceso.',
      onConfirm: async () => {
        try {
          const emailId = userToDelete.email.toLowerCase().trim();
          try {
            const response = await fetch('/api/delete-auth-user', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                email: userToDelete.email,
                uid: userToDelete.uid 
              }),
            });
            await response.json();
          } catch (apiErr) {
            console.error("API error deleting auth user:", apiErr);
          }

          await deleteDoc(doc(db, 'users', emailId));
          await addLog(
            'Eliminó un usuario',
            `Eliminado por: ${profile.name} (${profile.role} - ${profile.email}) | Nombre: ${userToDelete.name} | Email: ${userToDelete.email} | Rol: ${userToDelete.role}`,
            { module: 'Usuarios', recordId: userToDelete.email }
          );
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, `users/${userToDelete.email}`);
        }
      }
    });
  };

  const updateUserRole = async (userToUpdate: UserProfile, newRole: UserRole) => {
    try {
      const emailId = userToUpdate.email.toLowerCase().trim();
      const updateData: any = { 
        role: newRole,
        updatedAt: Date.now()
      };
      if (newRole === 'BLOQUEADO') {
        updateData.status = 'BLOQUEADO';
        updateData.isBlocked = true;
      } else {
        updateData.status = 'ACTIVO';
        updateData.isBlocked = false;
      }
      await updateDoc(doc(db, 'users', emailId), updateData);

      // Sync role change to Firebase Authentication
      fetch('/api/create-or-update-auth-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailId,
          name: userToUpdate.name,
          role: newRole,
          password: userToUpdate.password || (newRole === 'ADMIN' ? 'qwerty1' : 'dunor2024')
        })
      }).catch(e => console.warn("Failed to sync role to Auth:", e));

      await addLog(
        newRole === 'BLOQUEADO' ? 'Bloqueó usuario' : 'Actualizó rol de usuario',
        `Modificado por: ${profile.name} (${profile.role} - ${profile.email}) | Usuario: ${userToUpdate.name} (${userToUpdate.email}) | Rol anterior: ${userToUpdate.role} | Nuevo rol: ${newRole}`,
        { module: 'Usuarios', recordId: emailId }
      );
      showSystemPopup(
        newRole === 'BLOQUEADO' ? "Usuario Bloqueado" : "Rol Actualizado", 
        newRole === 'BLOQUEADO'
          ? `El usuario ${userToUpdate.name} ha sido bloqueado. Se cerrará su sesión en forma automática y se le denegará el acceso con el mensaje: "Cuenta bloqueada contacta a Soporte Técnico".`
          : `El rol de ${userToUpdate.name} fue cambiado a ${newRole} y sincronizado con Authentication.`, 
        "success"
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userToUpdate.email}`);
    }
  };

  // Helper to safely write user document to Firestore using setDoc with merge (avoids NOT_FOUND errors)
  const safeSaveUserDoc = async (user: UserProfile, updateData: Record<string, any>) => {
    const emailId = user.email.toLowerCase().trim();
    const docId = (user as any).docId || emailId;
    const dataWithTs = { ...updateData, updatedAt: Date.now() };

    await setDoc(doc(db, 'users', docId), dataWithTs, { merge: true });
    if (docId !== emailId) {
      await setDoc(doc(db, 'users', emailId), dataWithTs, { merge: true }).catch(() => {});
    }
    if (user.uid && user.uid !== docId && user.uid !== emailId) {
      await setDoc(doc(db, 'users', user.uid), dataWithTs, { merge: true }).catch(() => {});
    }
  };

  const updateAssignedCoordinator = async (userToUpdate: UserProfile, coordinatorUid: string) => {
    try {
      const emailId = userToUpdate.email.toLowerCase().trim();
      let coordinatorName = '';
      let updateData: any = {};
      if (!coordinatorUid) {
        updateData = {
          assignedCoordinatorId: '',
          assignedCoordinatorEmail: '',
          assignedCoordinatorName: '',
          updatedAt: Date.now()
        };
      } else {
        const coord = coordinators.find(c => c.uid === coordinatorUid || c.email === coordinatorUid);
        if (coord) {
          coordinatorName = coord.name;
          const coordLvl = getUserEducationLevel(coord, coordinators);
          updateData = {
            assignedCoordinatorId: coord.uid,
            assignedCoordinatorEmail: coord.email,
            assignedCoordinatorName: coord.name,
            updatedAt: Date.now()
          };
          if (coordLvl && !userToUpdate.educationLevel) {
            updateData.educationLevel = coordLvl;
          }
        }
      }

      await safeSaveUserDoc(userToUpdate, updateData);

      // Background sync with server
      fetch('/api/update-user-coordinator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailId, ...updateData })
      }).catch(e => console.warn("Background server coordinator sync notice:", e));

      await addLog(
        'Asignó coordinador a docente',
        `Asignado por: ${profile.name} (${profile.role} - ${profile.email}) | Docente: ${userToUpdate.name} (${userToUpdate.email}) | Coordinador: ${coordinatorName || 'Ninguno'}`,
        { module: 'Usuarios', recordId: emailId }
      );

      showSystemPopup(
        "Primer Coordinador",
        coordinatorName
          ? `Se ha asignado a "${coordinatorName}" como primer coordinador para ${userToUpdate.name}.`
          : `Se ha retirado el primer coordinador de ${userToUpdate.name}.`,
        "success"
      );
    } catch (error: any) {
      console.error("Error updating assigned coordinator:", error);
      if (isFirestoreInternalAssertion(error)) {
        showSystemPopup("Primer Coordinador", `Se ha guardado la asignación de coordinador para ${userToUpdate.name}.`, "success");
      } else {
        showSystemPopup("Error", "No se pudo actualizar el coordinador: " + (error?.message || ''), "error");
      }
    }
  };

  const updateAssignedSecondaryCoordinator = async (userToUpdate: UserProfile, coordinatorUid: string) => {
    try {
      const emailId = userToUpdate.email.toLowerCase().trim();
      let coordinatorName = '';
      let updatePayload: Record<string, any> = {};

      if (!coordinatorUid) {
        updatePayload = {
          secondaryCoordinatorId: '',
          secondaryCoordinatorEmail: '',
          secondaryCoordinatorName: '',
          updatedAt: Date.now()
        };
      } else {
        const coord = coordinators.find(c => c.uid === coordinatorUid || c.email === coordinatorUid);
        if (coord) {
          coordinatorName = coord.name;
          updatePayload = {
            secondaryCoordinatorId: coord.uid,
            secondaryCoordinatorEmail: coord.email,
            secondaryCoordinatorName: coord.name,
            updatedAt: Date.now()
          };
        }
      }

      await safeSaveUserDoc(userToUpdate, updatePayload);

      // Background sync with server
      fetch('/api/update-user-coordinator', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailId, ...updatePayload })
      }).catch(err => console.warn("Background server coordinator sync notice:", err));

      try {
        await addLog(
          'Asignó segundo coordinador a docente',
          `Asignado por: ${profile.name} (${profile.role} - ${profile.email}) | Docente: ${userToUpdate.name} (${userToUpdate.email}) | Segundo Coordinador: ${coordinatorName || 'Ninguno'}`,
          { module: 'Usuarios', recordId: emailId }
        );
      } catch (logErr) {
        console.warn("Log notice:", logErr);
      }

      showSystemPopup(
        "Segundo Coordinador",
        coordinatorName
          ? `Se ha asignado a "${coordinatorName}" como segundo coordinador para ${userToUpdate.name}.`
          : `Se ha retirado el segundo coordinador de ${userToUpdate.name}.`,
        "success"
      );
    } catch (error: any) {
      console.error("Error updating secondary coordinator:", error);
      if (isFirestoreInternalAssertion(error)) {
        showSystemPopup("Segundo Coordinador", `Se ha guardado el segundo coordinador para ${userToUpdate.name}.`, "success");
      } else {
        showSystemPopup("Error", "No se pudo actualizar el segundo coordinador: " + (error?.message || ''), "error");
      }
    }
  };

  const updateUserEducationLevel = async (userToUpdate: UserProfile, newLevel: string) => {
    try {
      const emailId = userToUpdate.email.toLowerCase().trim();
      await safeSaveUserDoc(userToUpdate, { educationLevel: newLevel });
      await addLog(
        'Actualizó nivel educativo',
        `Modificado por: ${profile.name} (${profile.role} - ${profile.email}) | Docente: ${userToUpdate.name} (${userToUpdate.email}) | Nuevo nivel: ${newLevel}`,
        { module: 'Usuarios', recordId: emailId }
      );
      showSystemPopup("Nivel Educativo Actualizado", `El nivel de ${userToUpdate.name} fue cambiado a ${newLevel}.`, "success");
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, `users/${userToUpdate.email}`);
    }
  };

  const updateAssignedPsychologist = async (userToUpdate: UserProfile, psychologistUid: string) => {
    try {
      const emailId = userToUpdate.email.toLowerCase().trim();
      let psychologistName = '';
      let updateData: any = {};
      if (!psychologistUid) {
        updateData = {
          assignedPsychologistId: '',
          assignedPsychologistEmail: '',
          assignedPsychologistName: '',
        };
      } else {
        const psycho = psychologists.find(p => p.uid === psychologistUid || p.email === psychologistUid);
        if (psycho) {
          psychologistName = psycho.name;
          updateData = {
            assignedPsychologistId: psycho.uid,
            assignedPsychologistEmail: psycho.email,
            assignedPsychologistName: psycho.name,
          };
        }
      }
      await safeSaveUserDoc(userToUpdate, updateData);
      await addLog(
        'Asignó psicólogo a docente',
        `Asignado por: ${profile.name} (${profile.role} - ${profile.email}) | Docente: ${userToUpdate.name} (${userToUpdate.email}) | Psicólogo: ${psychologistName || 'Ninguno'}`,
        { module: 'Usuarios', recordId: emailId }
      );
    } catch (error) {
      console.error("Error updating assigned psychologist:", error);
    }
  };

  const updateUserPermissions = async (userToUpdate: UserProfile, newPermissions: Partial<RolePermissions> | null) => {
    if (!isSuperAdmin) {
      showSystemPopup("Acción no permitida", "Únicamente el Superadministrador puede modificar los permisos de usuario.", "warning");
      return;
    }
    try {
      const emailId = userToUpdate.email.toLowerCase().trim();
      if (newPermissions === null) {
        await updateDoc(doc(db, 'users', emailId), {
          customPermissions: deleteField()
        });
        await addLog(
          'Restableció permisos de usuario',
          `Restablecido por: ${profile.name} (${profile.role} - ${profile.email}) | Usuario: ${userToUpdate.name} (${userToUpdate.email})`,
          { module: 'Permisos', recordId: emailId }
        );
        showSystemPopup("Permisos restablecidos", `Permisos de ${userToUpdate.name} restablecidos a las preferencias por defecto de su rol.`, "success");
      } else {
        await updateDoc(doc(db, 'users', emailId), {
          customPermissions: newPermissions
        });
        await addLog(
          'Actualizó permisos individuales de usuario',
          `Modificado por: ${profile.name} (${profile.role} - ${profile.email}) | Usuario: ${userToUpdate.name} (${userToUpdate.email})`,
          { module: 'Permisos', recordId: emailId }
        );
        showSystemPopup("Permisos guardados", `Permisos individuales de ${userToUpdate.name} guardados con éxito en la base de datos Firestore.`, "success");
      }
    } catch (error) {
      console.error("Error updating user permissions:", error);
      showSystemPopup("Error", "Error al actualizar los permisos del usuario en la base de datos.", "error");
    }
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Gestión de Usuarios</h1>
          <p className="text-slate-500">
            {isAdmin || isSuperAdmin 
              ? 'Administra administradores, directivos, coordinadores y docentes' 
              : profile.role === 'COORDINATOR'
              ? 'Administra docentes asignados y consulta el personal'
              : 'Directorio y asignación de personal'}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {canManageUsers && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl shadow-lg shadow-indigo-100 transition-all font-bold cursor-pointer text-sm"
            >
              <UserPlus className="w-4 h-4" />
              <span>Nuevo Usuario</span>
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-1 flex overflow-x-auto no-scrollbar">
        {(isAdmin || isSuperAdmin) && (
          <button
            onClick={() => setActiveUserTab('ADMIN')}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
              activeUserTab === 'ADMIN' 
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" 
                : "text-slate-500 hover:bg-slate-50"
            )}
          >
            <ShieldCheck className="w-4 h-4" />
            Administradores
          </button>
        )}
        {/* Rule 1: Remove Directivos tab for Coordinators */}
        {!isCoordinator && (
          <button
            onClick={() => setActiveUserTab('DIRECTIVE')}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
              activeUserTab === 'DIRECTIVE' 
                ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" 
                : "text-slate-500 hover:bg-slate-50"
            )}
          >
            <Building2 className="w-4 h-4" />
            Directivos
          </button>
        )}
        <button
          onClick={() => setActiveUserTab('COORDINATOR')}
          className={cn(
            "px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
            activeUserTab === 'COORDINATOR' 
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" 
              : "text-slate-500 hover:bg-slate-50"
          )}
        >
          <Users className="w-4 h-4" />
          Coordinadores
        </button>
        <button
          onClick={() => setActiveUserTab('PSYCHOLOGIST')}
          className={cn(
            "px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
            activeUserTab === 'PSYCHOLOGIST' 
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" 
              : "text-slate-500 hover:bg-slate-50"
          )}
        >
          <Brain className="w-4 h-4" />
          Psicólogos
        </button>
        <button
          onClick={() => setActiveUserTab('TEACHER')}
          className={cn(
            "px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
            activeUserTab === 'TEACHER' 
              ? "bg-indigo-600 text-white shadow-lg shadow-indigo-100" 
              : "text-slate-500 hover:bg-slate-50"
          )}
        >
          <School className="w-4 h-4" />
          Docentes
        </button>
        {isSuperAdmin && (
          <button
            onClick={() => setActiveUserTab('BLOQUEADO')}
            className={cn(
              "px-6 py-3 rounded-xl text-sm font-bold transition-all flex items-center gap-2 whitespace-nowrap",
              activeUserTab === 'BLOQUEADO' 
                ? "bg-rose-600 text-white shadow-lg shadow-rose-100" 
                : "text-rose-600 hover:bg-rose-50"
            )}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Bloqueados</span>
            {blockedUsers.length > 0 && (
              <span className={cn(
                "text-[10px] px-2 py-0.5 rounded-full font-bold",
                activeUserTab === 'BLOQUEADO' ? "bg-white text-rose-700" : "bg-rose-100 text-rose-800"
              )}>
                {blockedUsers.length}
              </span>
            )}
          </button>
        )}
      </div>

      <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        {activeUserTab === 'ADMIN' && (isAdmin || isSuperAdmin) && (
          <UserList 
            title="Administradores del Sistema" 
            users={admins.filter(u => !isSuperAdminEmail(u.email))} 
            onDelete={deleteUser} 
            onUpdateRole={updateUserRole}
            showPasswords={isSuperAdmin}
            canChangeRole={canManageUsers && (isSuperAdmin || isAdmin)}
            profile={profile}
            canManageUsers={canManageUsers}
            onEditPermissions={isSuperAdmin ? setUserToEditPermissions : undefined}
          />
        )}

        {activeUserTab === 'DIRECTIVE' && !isCoordinator && (
          <UserList 
            title="Personal Directivo" 
            users={directives.filter(u => !isSuperAdminEmail(u.email))} 
            onDelete={deleteUser} 
            onUpdateRole={updateUserRole}
            showPasswords={isSuperAdmin}
            canChangeRole={canManageUsers && (isSuperAdmin || isAdmin)}
            profile={profile}
            canManageUsers={canManageUsers}
            onEditPermissions={isSuperAdmin ? setUserToEditPermissions : undefined}
          />
        )}
        
        {activeUserTab === 'COORDINATOR' && (
          <UserList 
            title="Coordinadores Académicos" 
            users={coordinators.filter(u => !isSuperAdminEmail(u.email))} 
            onDelete={deleteUser} 
            onUpdateRole={updateUserRole}
            showPasswords={isSuperAdmin}
            canChangeRole={canManageUsers && (isSuperAdmin || isAdmin)}
            profile={profile}
            canManageUsers={canManageUsers}
            onEditPermissions={isSuperAdmin ? setUserToEditPermissions : undefined}
          />
        )}
        
        {activeUserTab === 'PSYCHOLOGIST' && (
          <UserList 
            title="Personal de Psicología" 
            users={psychologists.filter(u => !isSuperAdminEmail(u.email))} 
            onDelete={deleteUser} 
            onUpdateRole={updateUserRole}
            showPasswords={isSuperAdmin}
            canChangeRole={canManageUsers && (isSuperAdmin || isAdmin)}
            profile={profile}
            canManageUsers={canManageUsers}
            onEditPermissions={isSuperAdmin ? setUserToEditPermissions : undefined}
          />
        )}
        
        {activeUserTab === 'TEACHER' && (
          <div className="space-y-4">
            {canFilterTeachersByLevel && (
              <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                  <GraduationCap className="w-4 h-4 text-indigo-600" />
                  <span>Nivel de Educación:</span>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {([
                    { id: 'TODOS', label: 'Todos los Niveles (Agrupados)', count: displayedTeachers.filter(u => !isSuperAdminEmail(u.email)).length },
                    { id: 'Preescolar', label: 'Preescolar', count: displayedTeachers.filter(u => !isSuperAdminEmail(u.email) && normalizeEducationLevel(getUserEducationLevel(u, coordinators)) === 'Preescolar').length },
                    { id: 'Primaria', label: 'Primaria', count: displayedTeachers.filter(u => !isSuperAdminEmail(u.email) && normalizeEducationLevel(getUserEducationLevel(u, coordinators)) === 'Primaria').length },
                    { id: 'Secundaria', label: 'Secundaria', count: displayedTeachers.filter(u => !isSuperAdminEmail(u.email) && normalizeEducationLevel(getUserEducationLevel(u, coordinators)) === 'Secundaria').length },
                    ...(displayedTeachers.some(u => !isSuperAdminEmail(u.email) && !normalizeEducationLevel(getUserEducationLevel(u, coordinators))) ? [{
                      id: 'SinNivel' as const,
                      label: 'Sin Nivel',
                      count: displayedTeachers.filter(u => !isSuperAdminEmail(u.email) && !normalizeEducationLevel(getUserEducationLevel(u, coordinators))).length
                    }] : [])
                  ] as const).map(item => {
                    const isActive = teacherLevelFilter === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setTeacherLevelFilter(item.id)}
                        className={cn(
                          "px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                          isActive
                            ? "bg-indigo-600 text-white shadow-sm shadow-indigo-200"
                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                        )}
                      >
                        <span>{item.label}</span>
                        <span className={cn(
                          "text-[10px] px-1.5 py-0.5 rounded-full font-bold",
                          isActive ? "bg-white/20 text-white" : "bg-white text-slate-600 border border-slate-200"
                        )}>
                          {item.count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Barra de búsqueda para localizar docentes rápidamente */}
            <div className="bg-white rounded-2xl border border-slate-200 p-3 shadow-xs flex flex-col sm:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={teacherSearchQuery}
                  onChange={(e) => setTeacherSearchQuery(e.target.value)}
                  placeholder="Buscar docente por nombre, correo, teléfono o nivel educativo..."
                  className="w-full pl-10 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-800 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
                />
                {teacherSearchQuery && (
                  <button 
                    type="button"
                    onClick={() => setTeacherSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors cursor-pointer"
                    title="Limpiar búsqueda"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              {teacherSearchQuery && (
                <div className="text-xs font-semibold text-slate-500 whitespace-nowrap px-1">
                  <span>
                    {filteredTeachers.filter(u => !isSuperAdminEmail(u.email)).length}{' '}
                    {filteredTeachers.filter(u => !isSuperAdminEmail(u.email)).length === 1 ? 'docente encontrado' : 'docentes encontrados'}
                  </span>
                </div>
              )}
            </div>

            {/* Vista para Superadmin, Admin y Directivo: Docentes agrupados por nivel educativo */}
            {canFilterTeachersByLevel ? (
              <div className="space-y-8">
                {teacherLevelGroupsToRender.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-dashed border-slate-200 p-12 text-center text-slate-400">
                    <UserIcon className="w-12 h-12 mx-auto mb-3 opacity-20" />
                    <p className="text-sm font-medium">
                      {teacherSearchQuery 
                        ? `No se encontraron docentes que coincidan con "${teacherSearchQuery}".` 
                        : "No hay docentes registrados en el sistema."}
                    </p>
                  </div>
                ) : (
                  teacherLevelGroupsToRender.map((group) => (
                    <div key={group.id} className="space-y-3">
                      <div className={cn(
                        "p-4 rounded-2xl border flex items-center justify-between gap-3 shadow-xs",
                        group.headerBg
                      )}>
                        <div className="flex items-center gap-3">
                          <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shadow-xs border", group.iconColor)}>
                            <group.icon className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-slate-900 dark:text-white text-base">
                                {group.title}
                              </h3>
                              <span className={cn("text-xs font-black px-2.5 py-0.5 rounded-full border shadow-2xs", group.badgeColor)}>
                                {group.teachers.length}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">{group.description}</p>
                          </div>
                        </div>
                      </div>

                      <UserList 
                        title=""
                        hideTitleHeader={true}
                        users={group.teachers} 
                        emptyMessage={group.emptyText}
                        onDelete={deleteUser} 
                        onUpdateRole={updateUserRole}
                        showPasswords={isSuperAdmin}
                        canChangeRole={canManageUsers && (isSuperAdmin || isAdmin)}
                        coordinators={coordinators}
                        psychologists={psychologists}
                        onAssignCoordinator={updateAssignedCoordinator}
                        onAssignSecondaryCoordinator={updateAssignedSecondaryCoordinator}
                        onAssignPsychologist={updateAssignedPsychologist}
                        onUpdateEducationLevel={updateUserEducationLevel}
                        profile={profile}
                        canManageUsers={canManageUsers}
                        canAssignPsychologist={canAssignPsychologist}
                        onEditPermissions={isSuperAdmin ? setUserToEditPermissions : undefined}
                      />
                    </div>
                  ))
                )}
              </div>
            ) : (
              <UserList 
                title="Docentes Asignados a mi Coordinación" 
                users={filteredTeachers.filter(u => !isSuperAdminEmail(u.email))} 
                emptyMessage={teacherSearchQuery ? `No se encontraron docentes que coincidan con "${teacherSearchQuery}".` : undefined}
                onDelete={deleteUser} 
                onUpdateRole={updateUserRole}
                showPasswords={isSuperAdmin}
                canChangeRole={canManageUsers && (isSuperAdmin || isAdmin)}
                coordinators={coordinators}
                psychologists={psychologists}
                onAssignCoordinator={updateAssignedCoordinator}
                onAssignSecondaryCoordinator={updateAssignedSecondaryCoordinator}
                onAssignPsychologist={updateAssignedPsychologist}
                onUpdateEducationLevel={updateUserEducationLevel}
                profile={profile}
                canManageUsers={canManageUsers}
                canAssignPsychologist={canAssignPsychologist}
                onEditPermissions={isSuperAdmin ? setUserToEditPermissions : undefined}
              />
            )}
          </div>
        )}

        {activeUserTab === 'BLOQUEADO' && isSuperAdmin && (
          <UserList 
            title="Usuarios Bloqueados (Acceso Denegado al Sistema)" 
            users={blockedUsers.filter(u => !isSuperAdminEmail(u.email))} 
            onDelete={deleteUser} 
            onUpdateRole={updateUserRole}
            showPasswords={isSuperAdmin}
            canChangeRole={true}
            profile={profile}
            canManageUsers={canManageUsers}
            onEditPermissions={setUserToEditPermissions}
          />
        )}

        <UserPermissionsModal
          user={userToEditPermissions}
          isOpen={!!userToEditPermissions}
          systemSettings={systemSettings}
          firestoreRolePermissions={firestoreRolePermissions}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setUserToEditPermissions(null)}
          onSave={updateUserPermissions}
        />
      </div>

      {/* Add User Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }} className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 max-h-[90vh] overflow-y-auto">
              <h2 className="text-2xl font-bold text-slate-900 mb-6">Agregar Usuario</h2>
              <form onSubmit={handleAddUser} className="space-y-4">
                {/* Rule 9: Role creation permissions */}
                <div className="flex p-1 bg-slate-100 rounded-xl mb-4 overflow-x-auto gap-1">
                  {(isAdmin || isSuperAdmin) && (
                    <button
                      type="button"
                      onClick={() => setNewUserRole('ADMIN')}
                      className={cn(
                        "flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap",
                        newUserRole === 'ADMIN' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                      )}
                    >
                      Admin
                    </button>
                  )}
                  {(isAdmin || isSuperAdmin) && (
                    <button
                      type="button"
                      onClick={() => setNewUserRole('DIRECTIVE')}
                      className={cn(
                        "flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap",
                        newUserRole === 'DIRECTIVE' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                      )}
                    >
                      Directivo
                    </button>
                  )}
                  {(isAdmin || isSuperAdmin || isDirective || isCoordinator) && (
                    <button
                      type="button"
                      onClick={() => setNewUserRole('COORDINATOR')}
                      className={cn(
                        "flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap",
                        newUserRole === 'COORDINATOR' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                      )}
                    >
                      Coordinador
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setNewUserRole('PSYCHOLOGIST')}
                    className={cn(
                      "flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap",
                      newUserRole === 'PSYCHOLOGIST' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                    )}
                  >
                    Psicólogo
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewUserRole('TEACHER')}
                    className={cn(
                      "flex-1 py-2 px-3 text-xs font-bold rounded-lg transition-all whitespace-nowrap",
                      newUserRole === 'TEACHER' ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"
                    )}
                  >
                    Docente
                  </button>
                </div>

                <InputGroup label="Nombre Completo" required>
                  <input
                    required
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 transition-all"
                  />
                </InputGroup>

                {newUserRole === 'TEACHER' && (
                  <InputGroup label="Nivel Educativo" required>
                    <select
                      value={educationLevel}
                      onChange={(e) => setEducationLevel(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-slate-700"
                    >
                      <option value="Preescolar">Preescolar</option>
                      <option value="Primaria">Primaria</option>
                      <option value="Secundaria">Secundaria</option>
                    </select>
                  </InputGroup>
                )}
                <InputGroup label="Correo Electrónico" required>
                  <input
                    required
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    className={cn(
                      "w-full bg-slate-50 border rounded-xl px-4 py-2.5 focus:ring-2 transition-all",
                      isEmailAlreadyRegistered
                        ? "border-amber-400 focus:ring-amber-500 bg-amber-50/40 text-amber-900"
                        : "border-slate-200 focus:ring-indigo-500"
                    )}
                  />
                  {isEmailAlreadyRegistered && (
                    <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-amber-800 text-xs font-semibold">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span>El correo ya está registrado en el sistema. No se permite registrarlo de nuevo.</span>
                    </div>
                  )}
                </InputGroup>
                <div className="p-3.5 bg-indigo-50/80 border border-indigo-100 rounded-xl flex items-start gap-3">
                  <div className="p-1.5 bg-indigo-100 rounded-lg text-indigo-700 shrink-0 mt-0.5">
                    <Lock className="w-4 h-4" />
                  </div>
                  <div className="text-xs text-indigo-950 leading-relaxed">
                    <span className="font-bold block text-indigo-900 mb-0.5">Sin contraseña por defecto</span>
                    No se requiere asignar contraseña. Cuando el usuario ingrese con su correo por primera vez al sistema, se verificará automáticamente y se le solicitará crear su propia contraseña de acceso personal.
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 py-2.5 border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-all"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading || isEmailAlreadyRegistered}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 rounded-xl shadow-lg shadow-indigo-100 transition-all disabled:opacity-50"
                  >
                    {loading ? 'Guardando...' : 'Guardar'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmModal.isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" />
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="relative w-full max-w-sm bg-white rounded-2xl shadow-2xl p-6">
              <div className="flex items-center gap-4 mb-4 text-red-600">
                <div className="w-12 h-12 bg-red-50 rounded-full flex items-center justify-center">
                  <AlertCircle className="w-6 h-6" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">{confirmModal.title}</h3>
              </div>
              <p className="text-slate-600 mb-8">{confirmModal.message}</p>
              <div className="flex gap-3">
                <button onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))} className="flex-1 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold transition-all">Cancelar</button>
                <button onClick={confirmModal.onConfirm} className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold shadow-lg shadow-red-100 transition-all">Eliminar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <SystemModal modal={sysModal} onClose={() => setSysModal(prev => ({ ...prev, isOpen: false }))} />
    </div>
  );
};

const UserList = ({ 
  title, 
  users, 
  onDelete, 
  onUpdateRole, 
  showPasswords, 
  canChangeRole,
  readOnly,
  coordinators = [],
  psychologists = [],
  onAssignCoordinator,
  onAssignSecondaryCoordinator,
  onAssignPsychologist,
  onUpdateEducationLevel,
  profile,
  canManageUsers = true,
  canAssignPsychologist = true,
  onEditPermissions,
  emptyMessage,
  hideTitleHeader = false,
}: { 
  title: string, 
  users: UserProfile[], 
  onDelete: (user: UserProfile) => void, 
  onUpdateRole: (user: UserProfile, role: UserRole) => void, 
  showPasswords?: boolean, 
  canChangeRole?: boolean,
  readOnly?: boolean,
  coordinators?: UserProfile[],
  psychologists?: UserProfile[],
  onAssignCoordinator?: (user: UserProfile, coordUid: string) => void,
  onAssignSecondaryCoordinator?: (user: UserProfile, coordUid: string) => void,
  onAssignPsychologist?: (user: UserProfile, psychUid: string) => void,
  onUpdateEducationLevel?: (user: UserProfile, level: string) => void,
  profile: UserProfile,
  canManageUsers?: boolean,
  canAssignPsychologist?: boolean,
  onEditPermissions?: (user: UserProfile) => void,
  emptyMessage?: string,
  hideTitleHeader?: boolean,
}) => {
  const isCoordinator = profile.role === 'COORDINATOR';
  const isSuperAdmin = isSuperAdminEmail(profile?.email);
  const isAdminOrDirective = profile.role === 'ADMIN' || profile.role === 'DIRECTIVE' || isSuperAdmin;
  const canAssignCoordinators = isSuperAdmin || profile.role === 'ADMIN' || profile.role === 'DIRECTIVE' || profile.role === 'COORDINATOR';

  return (
    <div className="space-y-4">
      {!hideTitleHeader && title && (
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            {title}
            <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-0.5 rounded-full border border-indigo-100">
              {users.length}
            </span>
          </h3>
        </div>
      )}

      {users.length === 0 ? (
        <div className={cn(
          "bg-white rounded-2xl border border-dashed border-slate-200 text-center text-slate-400",
          hideTitleHeader ? "p-8" : "p-12"
        )}>
          <UserIcon className={cn("mx-auto opacity-20", hideTitleHeader ? "w-8 h-8 mb-2" : "w-12 h-12 mb-3")} />
          <p className="text-sm font-medium">{emptyMessage || "No hay usuarios registrados en esta categoría."}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {users.map((u) => {
            // Rule 1: Coordinator cannot delete other coordinators or themselves
            const canDeleteThisUser = canManageUsers && !readOnly && !(isCoordinator && (u.role === 'COORDINATOR' || u.email.toLowerCase() === profile.email.toLowerCase()));
            const userRoleNorm = normalizeUserRole(u.role);
            const roleBaseDefaults = DEFAULT_ROLE_PERMISSIONS[userRoleNorm] || DEFAULT_ROLE_PERMISSIONS.TEACHER;
            const actualCustomEntries = u.customPermissions
              ? Object.entries(u.customPermissions).filter(([k, v]) => v !== roleBaseDefaults[k as keyof RolePermissions])
              : [];
            const hasCustomPerms = actualCustomEntries.length > 0;

            return (
              <div key={u.email} className="bg-white rounded-xl border border-slate-200 p-4 hover:border-indigo-300 hover:shadow-sm transition-all group flex flex-col md:flex-row md:items-center gap-4">
                <div className="flex items-center gap-4 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600 border border-indigo-100 flex-shrink-0">
                    <UserIcon className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors truncate">{u.name}</h4>
                      {hasCustomPerms && isSuperAdmin && (
                        <span className="text-[10px] font-black bg-amber-500 text-amber-950 px-2 py-0.5 rounded-full shadow-xs flex items-center gap-1 border border-amber-400">
                          <ShieldCheck className="w-3 h-3 text-amber-950 fill-amber-950/20" />
                          Permisos Personalizados
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-0.5">
                      <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                        <Mail className="w-3 h-3" />
                        <span className="truncate">{u.email}</span>
                      </div>
                      {u.phone && (
                        <div className="flex items-center gap-1.5 text-slate-500 text-xs">
                          <Phone className="w-3 h-3" />
                          <span>{u.phone}</span>
                        </div>
                      )}
                    </div>

                    {(u.createdByName || u.createdBy) && (
                      <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mt-1">
                        <UserCheck className="w-3 h-3 text-slate-400" />
                        <span>Registrado por: <strong className="text-slate-600 font-semibold">{u.createdByName || u.createdBy}</strong> {u.creatorRole ? `(${u.creatorRole})` : ''}</span>
                      </div>
                    )}
                    {!u.createdByName && !u.createdBy && u.role === 'ADMIN' && (
                      <div className="flex items-center gap-1.5 text-slate-400 text-[11px] mt-1">
                        <UserCheck className="w-3 h-3 text-slate-400" />
                        <span>Registrado por: <strong className="text-slate-600 font-semibold">Sistema / Superadministrador Inicial</strong></span>
                      </div>
                    )}

                    {/* Chips showing active custom permissions directly on user card - strictly for SuperAdmin */}
                    {hasCustomPerms && actualCustomEntries.length > 0 && isSuperAdmin && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {actualCustomEntries.map(([permKey, val]) => {
                          const labels: Record<string, string> = {
                            canViewNotifications: 'Notificaciones',
                            canViewIncidents: 'Incidencias',
                            canCreateIncident: 'Crear Incidencia',
                            canViewTasks: 'Tareas',
                            canCreateTask: 'Crear Tareas',
                            canViewUsers: 'Directorio',
                            canViewLogs: 'Bitácora',
                            canViewSettings: 'Ajustes',
                            canViewPermissions: 'Permisos',
                            canViewReferrals: 'Canalizaciones',
                            canCreateReferral: 'Crear Canalización',
                            canViewExpedientes: 'Expedientes',
                            canManageExpedientes: 'Gestionar Expedientes',
                            canViewInformes: 'Informes',
                            canEditIncidents: 'Editar Incidencias',
                            canDeleteIncidents: 'Eliminar Incidencias',
                            canChangeStatus: 'Estado Incidencias',
                            canAssignPsychologist: 'Asignar Psicólogo',
                            canAddFollowUp: 'Seguimiento',
                            canExportReports: 'Exportar Reportes',
                            canSendCongratulations: 'Reconocimientos',
                            canManageUsers: 'Gestionar Usuarios',
                            canSendMassMessages: 'Envío Masivo',
                          };
                          const labelName = labels[permKey] || permKey;
                          return (
                            <span
                              key={permKey}
                              className={cn(
                                "text-[10px] font-bold px-2 py-0.5 rounded-md border flex items-center gap-1 shadow-2xs",
                                val
                                  ? "bg-amber-100 text-amber-950 border-amber-300 font-extrabold"
                                  : "bg-rose-50 text-rose-800 border-rose-200 line-through opacity-85"
                              )}
                            >
                              {val ? '★' : '✕'} {labelName}
                            </span>
                          );
                        })}
                      </div>
                    )}

                    {/* Options to assign 1st and 2nd Coordinator, Level, and Psychologist to Teachers */}
                    {u.role === 'TEACHER' && canAssignCoordinators && (
                      <div className="flex flex-wrap items-center gap-3 mt-2 pt-2 border-t border-slate-100">
                        {/* 1er Coordinador */}
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-semibold text-slate-500">1er Coord:</span>
                          <select
                            value={u.assignedCoordinatorId || u.assignedCoordinatorEmail || ''}
                            onChange={(e) => onAssignCoordinator && onAssignCoordinator(u, e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 hover:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            title="Primer Coordinador Asignado"
                          >
                            <option value="">-- Sin Asignar --</option>
                            {coordinators.map(c => (
                              <option key={c.email} value={c.uid}>{c.name}</option>
                            ))}
                          </select>
                        </div>

                        {/* 2do Coordinador */}
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-semibold text-indigo-700 flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-600 inline-block"></span>
                            2do Coord:
                          </span>
                          <select
                            value={u.secondaryCoordinatorId || u.secondaryCoordinatorEmail || ''}
                            onChange={(e) => onAssignSecondaryCoordinator && onAssignSecondaryCoordinator(u, e.target.value)}
                            className="bg-indigo-50/70 border border-indigo-200 rounded-lg px-2 py-1 text-xs font-semibold text-indigo-900 hover:border-indigo-400 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            title="Segundo Coordinador Asignado (Opcional)"
                          >
                            <option value="">-- Sin Asignar (Opcional) --</option>
                            {coordinators
                              .filter(c => c.uid !== (u.assignedCoordinatorId || u.assignedCoordinatorEmail) && c.email !== u.assignedCoordinatorEmail)
                              .map(c => (
                                <option key={c.email} value={c.uid}>{c.name}</option>
                              ))}
                          </select>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-semibold text-slate-500">Nivel:</span>
                          <select
                            value={u.educationLevel || getUserEducationLevel(u, coordinators) || ''}
                            onChange={(e) => onUpdateEducationLevel && onUpdateEducationLevel(u, e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 hover:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                          >
                            <option value="">-- Sin Nivel --</option>
                            <option value="Preescolar">Preescolar</option>
                            <option value="Primaria">Primaria</option>
                            <option value="Secundaria">Secundaria</option>
                          </select>
                        </div>

                        {canAssignPsychologist && (
                          <div className="flex items-center gap-1.5 text-xs">
                            <span className="font-semibold text-slate-500">Psicólogo:</span>
                            <select
                              value={u.assignedPsychologistId || u.assignedPsychologistEmail || ''}
                              onChange={(e) => onAssignPsychologist && onAssignPsychologist(u, e.target.value)}
                              className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-semibold text-slate-700 hover:border-indigo-300 focus:ring-2 focus:ring-indigo-500/20 outline-none"
                            >
                              <option value="">-- Sin Asignar --</option>
                              {psychologists.map(p => (
                                <option key={p.email} value={p.uid}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    )}

                    {(u.assignedCoordinatorName || u.secondaryCoordinatorName || u.assignedPsychologistName || u.educationLevel) && u.role === 'TEACHER' && !canAssignCoordinators && (
                      <div className="flex flex-wrap items-center gap-2 mt-1.5">
                        {u.assignedCoordinatorName && (
                          <span className="text-[11px] bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-md font-semibold border border-indigo-100 flex items-center gap-1">
                            <UserIcon className="w-3 h-3 text-indigo-500" />
                            1er Coord: {u.assignedCoordinatorName}
                          </span>
                        )}
                        {u.secondaryCoordinatorName && (
                          <span className="text-[11px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md font-semibold border border-purple-100 flex items-center gap-1">
                            <UserIcon className="w-3 h-3 text-purple-500" />
                            2do Coord: {u.secondaryCoordinatorName}
                          </span>
                        )}
                        {u.assignedPsychologistName && (
                          <span className="text-[11px] bg-purple-50 text-purple-700 px-2 py-0.5 rounded-md font-semibold border border-purple-100 flex items-center gap-1">
                            <Brain className="w-3 h-3 text-purple-500" />
                            Psicólogo: {u.assignedPsychologistName}
                          </span>
                        )}
                        {u.educationLevel && (
                          <span className="text-[11px] bg-amber-50 text-amber-700 px-2 py-0.5 rounded-md font-semibold border border-amber-100 flex items-center gap-1">
                            <GraduationCap className="w-3 h-3 text-amber-500" />
                            Nivel: {u.educationLevel}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 pt-3 md:pt-0 border-t md:border-t-0 border-slate-100">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-1.5">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        u.role === 'BLOQUEADO' ? "bg-rose-600 animate-pulse" : u.isRegistered ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
                      )} />
                      <span className={cn(
                        "text-[10px] font-bold uppercase tracking-wider",
                        u.role === 'BLOQUEADO' ? "text-rose-600 font-extrabold" : "text-slate-400"
                      )}>
                        {u.role === 'BLOQUEADO' ? 'Bloqueado' : u.isRegistered ? 'Registrado' : 'Pendiente'}
                      </span>
                    </div>
                    
                    {showPasswords && u.password && (
                      <div className="flex items-center gap-1 px-2 py-1 bg-slate-50 rounded-md text-[10px] font-mono text-slate-500 border border-slate-100">
                        <Lock className="w-3 h-3" />
                        {u.password}
                      </div>
                    )}
                  </div>

                  {!readOnly && (
                    <div className="flex items-center gap-2 ml-auto">
                      {onEditPermissions && canManageUsers && isSuperAdmin && (
                        <button
                          type="button"
                          onClick={() => onEditPermissions(u)}
                          className={cn(
                            "px-2.5 py-1 text-[11px] font-bold rounded-lg border transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs",
                            hasCustomPerms
                              ? "bg-amber-500 text-amber-950 border-amber-400 hover:bg-amber-400 font-extrabold"
                              : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-indigo-600"
                          )}
                          title="Ver y gestionar permisos individuales guardados en la base de datos para este usuario"
                        >
                          <ShieldCheck className={cn("w-3.5 h-3.5", hasCustomPerms ? "text-amber-950 fill-amber-950/20" : "text-indigo-600")} />
                          <span>{hasCustomPerms ? 'Permisos (Modificados)' : 'Permisos'}</span>
                        </button>
                      )}

                      {canChangeRole && (
                        <div className="relative">
                          <select
                            value={u.role}
                            onChange={(e) => onUpdateRole(u, e.target.value as UserRole)}
                            className="appearance-none text-[10px] font-bold bg-slate-50 border border-slate-200 rounded-lg pl-2 pr-6 py-1.5 text-slate-500 hover:text-indigo-600 hover:border-indigo-200 transition-all cursor-pointer focus:ring-2 focus:ring-indigo-500/20 outline-none"
                          >
                            <option value="TEACHER">Docente</option>
                            <option value="COORDINATOR">Coordinador</option>
                            <option value="DIRECTIVE">Directivo</option>
                            <option value="PSYCHOLOGIST">Psicólogo</option>
                            <option value="ADMIN">Admin</option>
                            {(isSuperAdmin || u.role === 'BLOQUEADO') && (
                              <option value="BLOQUEADO" className="text-red-600 font-bold">Bloqueado</option>
                            )}
                          </select>
                          <ChevronDown className="w-3 h-3 absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                        </div>
                      )}
                      {canDeleteThisUser && (
                        <button
                          onClick={() => onDelete(u)}
                          className="p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                          title="Eliminar usuario"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
