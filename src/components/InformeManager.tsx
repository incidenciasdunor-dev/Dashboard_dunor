import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileText, BarChart2, Users, Search, Share2, Lock, Eye, EyeOff, 
  CheckCircle2, AlertTriangle, GraduationCap, Printer, Sparkles, 
  BrainCircuit, X, Check, Filter, Calendar, ShieldAlert, Edit3, 
  ChevronDown, Send, UserCheck, RefreshCw, MessageSquare, PieChart,
  ClipboardList
} from 'lucide-react';
import { UserProfile, Expediente, Referral, normalizeUserRole, isSuperAdminEmail, SUPER_ADMIN_EMAILS } from '../types';
import { cn } from '../lib/utils';
import { db } from '../lib/firebase';
import { collection, onSnapshot, setDoc, doc } from 'firebase/firestore';
import { SystemModal, SystemModalState } from './SystemModal';

export interface SharedReportStudentCard {
  expedienteId: string;
  studentName: string;
  gradeGroup: string;
  referredBy: string;
  reasonAndBackground: string;
  teacherStrategies: string;
  parentInterviews: string;
  psychologicalEvaluation: string;
  psychologyFollowUp: string;
  latestProgress: string;
  status: string;
}

export interface SharedReportGradeSummary {
  grade: string;
  total: number;
  enProc: number;
  conc: number;
  deriv: number;
  conPadres: number;
  conDocentes?: number;
  pctPadres: number;
}

export interface SharedReport {
  id: string;
  title: string;
  period: string;
  executiveSummary: string;
  conclusions: string;
  studentsBreakdown?: SharedReportStudentCard[];
  gradeSummary?: SharedReportGradeSummary[];
  sharedBy: string;
  sharedByEmail: string;
  sharedAt: number;
  recipients: Array<{
    uid?: string;
    email: string;
    name: string;
    roleLabel: string;
  }>;
}

interface InformeManagerProps {
  expedientes: Expediente[];
  referrals: Referral[];
  profile: UserProfile;
  coordinators: UserProfile[];
  directives: UserProfile[];
  admins: UserProfile[];
  sendNotification?: (userIdOrIds: string | string[], title: string, message: string, incidentId?: string, skipAdmins?: boolean, extraData?: Record<string, any>) => Promise<void>;
  addLog?: (action: string, details: string) => Promise<void>;
  systemSettings?: any;
}

export const InformeManager: React.FC<InformeManagerProps> = ({
  expedientes = [],
  referrals = [],
  profile,
  coordinators = [],
  directives = [],
  admins = [],
  sendNotification,
  addLog,
  systemSettings
}) => {
  const normRole = normalizeUserRole(profile.role);
  const isPsychologist = normRole === 'PSYCHOLOGIST' || (profile.role && String(profile.role).toLowerCase().includes('psico'));
  const isAdmin = normRole === 'ADMIN';
  const isDirective = normRole === 'DIRECTIVE';
  const isCoordinator = normRole === 'COORDINATOR';

  // Only psychologist can create and share live master reports
  const canCreateAndShare = isPsychologist;

  // Active view tab: 'MASTER' (Live report generation) vs 'SHARED' (Consult shared reports)
  const [activeSubTab, setActiveSubTab] = useState<'MASTER' | 'SHARED'>(
    canCreateAndShare ? 'MASTER' : 'SHARED'
  );

  // Custom System Modal State
  const [sysModal, setSysModal] = useState<SystemModalState>({
    isOpen: false,
    type: 'info',
    title: '',
    message: ''
  });

  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setSysModal({ isOpen: true, type, title, message });
  };

  // Filters for Master Report
  const [gradeFilter, setGradeFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Shared reports loaded from Firestore
  const [sharedReports, setSharedReports] = useState<SharedReport[]>([]);
  const [selectedSharedReport, setSelectedSharedReport] = useState<SharedReport | null>(null);

  // Share / Censorship Modal
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);
  const [anonymizeStudentNames, setAnonymizeStudentNames] = useState(false);
  const [hidePsychEvaluation, setHidePsychEvaluation] = useState(false);
  const [hideParentInterviews, setHideParentInterviews] = useState(false);

  // Editable copy data for share modal
  const [editableTitle, setEditableTitle] = useState('');
  const [editablePeriod, setEditablePeriod] = useState('');
  const [editableSummary, setEditableSummary] = useState('');
  const [editableConclusions, setEditableConclusions] = useState('');
  const [editableStudents, setEditableStudents] = useState<SharedReportStudentCard[]>([]);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Textarea references for selection blackout in modal
  const summaryTextareaRef = useRef<HTMLTextAreaElement>(null);
  const conclusionsTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Listen to `shared_reports` collection in Firestore
  useEffect(() => {
    if (!db) return;
    try {
      const unsub = onSnapshot(collection(db, 'shared_reports'), (snapshot) => {
        const reports: SharedReport[] = [];
        snapshot.forEach((doc) => {
          reports.push({ id: doc.id, ...doc.data() } as SharedReport);
        });
        // Sort by share date desc
        reports.sort((a, b) => (b.sharedAt || 0) - (a.sharedAt || 0));

        // Filter reports visible to current user (Admin, Directive, and Coordinator only view reports shared with them, Superadmins see all by default)
        const userEmailLower = profile.email?.toLowerCase();
        const visibleReports = reports.filter(r => {
          // Superadmins can see all reports by default
          if (isSuperAdminEmail(profile.email) || (profile as any).role === 'SUPER_ADMIN') return true;
          // Psychologist who created/shared the report can see it
          if (isPsychologist && r.sharedByEmail?.toLowerCase() === userEmailLower) return true;
          // Admins, Directives, Coordinators only view reports shared with them
          return r.recipients?.some(rec => 
            (rec.email && userEmailLower && rec.email.toLowerCase() === userEmailLower) || 
            (profile.uid && rec.uid === profile.uid) ||
            isSuperAdminEmail(rec.email)
          );
        });

        setSharedReports(visibleReports);
      }, (err) => {
        console.error("Error loading shared reports:", err);
      });

      return () => unsub();
    } catch (err) {
      console.error("Failed to setup shared_reports listener:", err);
    }
  }, [profile, isAdmin, isPsychologist]);

  // Combine recipient options (excluding super admins who receive reports by default)
  const allAvailableRecipients = useMemo(() => {
    const list: Array<{ uid?: string; email: string; name: string; roleLabel: string }> = [];
    
    const isExcluded = (u: any) => {
      if (!u || !u.email) return true;
      if (isSuperAdminEmail(u.email)) return true;
      if (u.role === 'SUPER_ADMIN') return true;
      const lowerName = (u.name || '').toLowerCase();
      if (lowerName.includes('super admin') || lowerName.includes('administrador dunor')) return true;
      return false;
    };

    // Directives
    directives.forEach(d => {
      if (d.email && !isExcluded(d)) list.push({ uid: d.uid, email: d.email.toLowerCase(), name: d.name, roleLabel: 'Directivo' });
    });
    // Coordinators
    coordinators.forEach(c => {
      if (c.email && !isExcluded(c) && !list.some(x => x.email === c.email.toLowerCase())) {
        list.push({ uid: c.uid, email: c.email.toLowerCase(), name: c.name, roleLabel: 'Coordinador' });
      }
    });
    // Admins
    admins.forEach(a => {
      if (a.email && !isExcluded(a) && !list.some(x => x.email === a.email.toLowerCase())) {
        list.push({ uid: a.uid, email: a.email.toLowerCase(), name: a.name, roleLabel: 'Administrador' });
      }
    });

    return list.filter(r => r.email !== profile.email?.toLowerCase());
  }, [directives, coordinators, admins, profile]);

  // Filtered expedientes for master report
  const filteredExpedientes = useMemo(() => {
    const normRole = normalizeUserRole(profile.role);
    const isPsychologist = normRole === 'PSYCHOLOGIST';
    const userEmailLower = profile.email?.toLowerCase();

    return expedientes.filter(exp => {
      // Super admins always have full access by default
      if (isSuperAdminEmail(profile.email) || (profile as any).role === 'SUPER_ADMIN') {
        // Allowed access
      } else if (!isPsychologist) {
        // Directives, Coordinators, Admins only view expedientes shared with them by the psychologist
        const isRecipient = Array.isArray((exp as any).recipients) && (exp as any).recipients.some((r: any) =>
          (r.uid && profile.uid && r.uid === profile.uid) ||
          (r.email && userEmailLower && r.email.toLowerCase() === userEmailLower)
        );
        const isOwner = (exp as any).sharedByEmail && userEmailLower && (exp as any).sharedByEmail.toLowerCase() === userEmailLower;
        if (!isRecipient && !isOwner) return false;
      }

      const matchesSearch = searchQuery === '' || 
        exp.gradeGroup.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesGrade = gradeFilter === 'ALL' || exp.gradeGroup.toLowerCase().includes(gradeFilter.toLowerCase());

      return matchesSearch && matchesGrade;
    });
  }, [expedientes, searchQuery, gradeFilter, profile.role, profile.uid, profile.email]);

  // Statistics calculation from expedientes
  const stats = useMemo(() => {
    const totalCanalizados = filteredExpedientes.length;

    // By status
    const enProceso = filteredExpedientes.filter(e => !e.status || e.status === 'EN_PROCESO').length;
    const concluidos = filteredExpedientes.filter(e => e.status === 'CONCLUIDO' || e.status === 'CASO_CONCLUIDO').length;
    const derivados = filteredExpedientes.filter(e => e.status === 'DERIVADO_EXTERNO').length;

    // By Grade
    const gradeCounts: Record<string, number> = {};
    filteredExpedientes.forEach(e => {
      const g = e.gradeGroup || 'Sin Grado Especificado';
      gradeCounts[g] = (gradeCounts[g] || 0) + 1;
    });

    // Requirers / Referrers mapping
    const referrerCounts: Record<string, number> = {};
    filteredExpedientes.forEach(e => {
      // Find linked referral if any
      const ref = referrals.find(r => r.id === e.linkedReferralId || r.studentName.toLowerCase() === e.studentName.toLowerCase());
      const referrer = ref ? `${ref.referredByName || ref.referredBy} (${ref.referredByRole || 'Docente'})` : (e.psychologistName ? 'Psicología' : 'Docencia / Coordinación');
      referrerCounts[referrer] = (referrerCounts[referrer] || 0) + 1;
    });

    // Counts of key interventions
    const conEstrategiasDocentes = filteredExpedientes.filter(e => e.teacherStrategies && e.teacherStrategies.trim().length > 5).length;
    const conEntrevistaPadres = filteredExpedientes.filter(e => e.parentInterviews && e.parentInterviews.trim().length > 5).length;
    const conEvaluacionPsico = filteredExpedientes.filter(e => e.psychologicalEvaluation && e.psychologicalEvaluation.trim().length > 5).length;

    // Aggregated grade distribution and statistics (global, without individual student records)
    const gradeSummaryList: SharedReportGradeSummary[] = Object.keys(gradeCounts).sort().map(grade => {
      const inGrade = filteredExpedientes.filter(e => (e.gradeGroup || 'Sin Grado Especificado') === grade);
      const enProc = inGrade.filter(e => !e.status || e.status === 'EN_PROCESO').length;
      const conc = inGrade.filter(e => e.status === 'CONCLUIDO' || e.status === 'CASO_CONCLUIDO').length;
      const deriv = inGrade.filter(e => e.status === 'DERIVADO_EXTERNO').length;
      const conPadres = inGrade.filter(e => e.parentInterviews && e.parentInterviews.trim().length > 5).length;
      const conDocentes = inGrade.filter(e => e.teacherStrategies && e.teacherStrategies.trim().length > 5).length;
      return {
        grade,
        total: inGrade.length,
        enProc,
        conc,
        deriv,
        conPadres,
        conDocentes,
        pctPadres: Math.round((conPadres / (inGrade.length || 1)) * 100)
      };
    });

    return {
      totalCanalizados,
      enProceso,
      concluidos,
      derivados,
      gradeCounts,
      referrerCounts,
      conEstrategiasDocentes,
      conEntrevistaPadres,
      conEvaluacionPsico,
      gradeSummaryList
    };
  }, [filteredExpedientes, referrals]);

  // Automatic Generalized Executive Summary Text Generation (Macro & Institutional)
  const autoExecutiveSummary = useMemo(() => {
    if (filteredExpedientes.length === 0) {
      return "Actualmente no se registran expedientes psicopedagógicos activos para los criterios seleccionados.";
    }

    const total = stats.totalCanalizados;
    const topGrades = (Object.entries(stats.gradeCounts) as [string, number][])
      .sort((a, b) => b[1] - a[1])
      .map(([g, c]) => `${g} (${c} alumno${c > 1 ? 's' : ''})`)
      .slice(0, 4)
      .join(', ');

    const pctEnProceso = Math.round((stats.enProceso / (total || 1)) * 100);
    const pctConcluidos = Math.round((stats.concluidos / (total || 1)) * 100);
    const pctDerivados = Math.round((stats.derivados / (total || 1)) * 100);
    const pctEstrategiasDocentes = Math.round((stats.conEstrategiasDocentes / (total || 1)) * 100);
    const pctEntrevistaPadres = Math.round((stats.conEntrevistaPadres / (total || 1)) * 100);
    const pctEvaluacion = Math.round((stats.conEvaluacionPsico / (total || 1)) * 100);

    return `I. PANORAMA GENERAL Y COBERTURA INSTITUCIONAL\n` +
      `El presente informe consolida de forma global el estado del acompañamiento psicopedagógico institucional, abarcando un total de ${total} expediente(s) activo(s), con mayor presencia en los niveles de ${topGrades || 'diversos grados'}.\n` +
      `De la población total canalizada, el ${pctEnProceso}% se encuentra en seguimiento continuo y activo, el ${pctConcluidos}% corresponde a intervenciones concluidas satisfactoriamente por cumplimiento de objetivos, y el ${pctDerivados}% ha sido canalizado a instancias especializadas para apoyo multidisciplinario.\n\n` +
      `II. EJES GENERALES DE INTERVENCIÓN PSICOPEDAGÓGICA\n` +
      `Las líneas de acción del Departamento de Psicología se orientan de forma general en cuatro dimensiones formativas esenciales:\n` +
      `• Eje Socioemocional y Afectivo: Fortalecimiento del autoconcepto, habilidades de autorregulación emocional, resiliencia y expresión asertiva ante situaciones de conflicto.\n` +
      `• Eje de Convivencia y Regulación Conductual: Promoción de la cultura de paz, apego a los acuerdos escolares de aula, respeto entre pares y prevención de conductas disruptivas.\n` +
      `• Eje de Procesos de Aprendizaje: Detección de estilos y ritmos de aprendizaje, fomento de técnicas de estudio efectivas, hábitos de concentración y seguimiento a la motivación académica.\n` +
      `• Eje de Coordinación Institucional: Seguimiento colegiado y oportuno entre psicología, coordinaciones académicas y directivos para una atención integral.\n\n` +
      `III. ARTICULACIÓN COLEGIADA CON EL PERSONAL DOCENTE\n` +
      `En el ${pctEstrategiasDocentes}% de los expedientes se ha consolidado un trabajo estrecho con los profesores titulares y de materia, facilitando pautas pedagógicas conjuntas, adecuaciones metodológicas en el aula y recomendaciones prácticas que favorecen un entorno de aprendizaje seguro e inclusivo.\n\n` +
      `IV. VINCULACIÓN FAMILIAR Y CORRESPONSABILIDAD TUTORIAL\n` +
      `El involucramiento de los padres de familia y tutores representa un pilar formativo prioritario. Se ha registrado atención directa y firma de acuerdos en el ${pctEntrevistaPadres}% de los casos atendidos, estableciendo compromisos mutuos orientados a reforzar rutinas en el hogar, límites formativos claros, supervisión de tareas y canales continuos de comunicación con la escuela.\n\n` +
      `V. VALORACIÓN Y RESGUARDO INSTITUCIONAL\n` +
      `A nivel de evaluación diagnóstica y seguimiento, el ${pctEvaluacion}% de la población canalizada cuenta con valoraciones psicopedagógicas orientativas. El 100% de los expedientes institucionales se encuentran digitalizados, actualizados y debidamente resguardados bajo estrictos principios de confidencialidad y ética profesional.\n\n` +
      `VI. BALANCE GLOBAL DE EVOLUCIÓN\n` +
      `En términos generales, se observa una respuesta favorable en los estudiantes atendidos, reflejada en una mejor adaptación grupal, mayor compromiso de los tutores en el seguimiento escolar y fortalecimiento continuo de los acuerdos de convivencia en el plantel.`;
  }, [filteredExpedientes, stats]);

  // Automatic Conclusions Text Generation
  const autoConclusions = useMemo(() => {
    return `1. Mantener el seguimiento sistemático a los ${stats.enProceso} alumnos en proceso activo de intervención psicopedagógica, priorizando su bienestar socioemocional y desempeño armónico en el entorno escolar.\n` +
      `2. Continuar fortaleciendo la alianza escuela-familia mediante sesiones periódicas de seguimiento y orientación a padres de familia y tutores.\n` +
      `3. Reforzar el acompañamiento colaborativo con el cuerpo docente para la implementación y monitoreo continuo de las pautas psicopedagógicas en las aulas.\n` +
      `4. Salvaguardar la confidencialidad, privacidad y el resguardo seguro de la información psicopedagógica institucional en todo momento.`;
  }, [stats]);

  // Dedicated Print Function for Reports (Macro, Global & Confidential)
  const handlePrintReport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.print();
      return;
    }

    const reportTitle = activeSubTab === 'MASTER' 
      ? 'INFORME GENERAL DE ATENCIÓN PSICOPEDAGÓGICA Y SEGUIMIENTO INSTITUCIONAL' 
      : selectedSharedReport?.title || 'INFORME COMPARTIDO DE PSICOLOGÍA';

    const logoUrl = systemSettings?.appLogoUrl || "/logo.svg";
    const appName = systemSettings?.appName || "DASHBOARD DUNOR";

    const execSummary = activeSubTab === 'MASTER' ? autoExecutiveSummary : selectedSharedReport?.executiveSummary || '';
    const conclusions = activeSubTab === 'MASTER' ? autoConclusions : selectedSharedReport?.conclusions || '';
    const dateStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

    const gradeSummaryData = (activeSubTab === 'MASTER' ? stats.gradeSummaryList : selectedSharedReport?.gradeSummary) || [];

    const gradeRowsHtml = gradeSummaryData.map(item => `
      <tr>
        <td style="padding: 7px 10px; border: 1px solid #cbd5e1; font-weight: bold; color: #1e293b;">${item.grade}</td>
        <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: 800; color: #0f172a;">${item.total}</td>
        <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: center; color: #b45309; font-weight: 600;">${item.enProc}</td>
        <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: center; color: #15803d; font-weight: bold;">${item.conc}</td>
        <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: center; color: #475569;">${item.deriv}</td>
        <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: center; color: #1e3a8a; font-weight: 600;">${item.conPadres} (${item.pctPadres}%)</td>
        <td style="padding: 7px 10px; border: 1px solid #cbd5e1; text-align: center; font-weight: 700; color: #334155;">${item.conc === item.total && item.total > 0 ? 'Concluido' : 'En Atención'}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>${reportTitle}</title>
          <style>
            @page { size: letter; margin: 1.5cm; }
            body { font-family: 'Segoe UI', Arial, sans-serif; color: #0f172a; line-height: 1.5; margin: 0; padding: 0; font-size: 12px; }
            .header { border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 20px; text-align: center; }
            .header h1 { font-size: 18px; color: #1e3a8a; margin: 0 0 4px 0; text-transform: uppercase; letter-spacing: 0.5px; }
            .header h2 { font-size: 13px; color: #334155; margin: 0 0 4px 0; font-weight: bold; }
            .header p { font-size: 10px; color: #64748b; margin: 0; }
            .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 20px; }
            .stat-card { background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px; text-align: center; }
            .stat-num { font-size: 18px; font-weight: bold; color: #1e293b; }
            .stat-lbl { font-size: 9px; color: #64748b; text-transform: uppercase; font-weight: bold; }
            .section { margin-bottom: 20px; }
            .section-title { font-size: 12px; font-weight: bold; color: #1e3a8a; text-transform: uppercase; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; margin-bottom: 8px; }
            .content-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; white-space: pre-line; }
            .footer { margin-top: 40px; padding-top: 10px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 9px; color: #94a3b8; }
          </style>
        </head>
        <body>
          <div class="header">
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 2px solid #cbd5e1; padding-bottom: 12px; margin-bottom: 12px;">
              <div style="display: flex; align-items: center; gap: 12px;">
                <img src="${logoUrl}" alt="${appName}" style="max-height: 65px; max-width: 180px; object-fit: contain;" onerror="this.style.display='none'" />
                <div style="text-align: left;">
                  <div style="font-size: 14px; font-weight: 900; letter-spacing: 1px; color: #1e3a8a; text-transform: uppercase;">${appName}</div>
                  <div style="font-size: 10px; color: #475569; font-weight: 600;">Atención Psicopedagógica y Control Escolar</div>
                </div>
              </div>
              <div style="text-align: right; font-size: 10px; color: #64748b;">
                <div><strong>Fecha de emisión:</strong> ${dateStr}</div>
                <div><strong>Emitido por:</strong> ${profile.name || profile.email} (${profile.role})</div>
              </div>
            </div>
            <h1>${reportTitle}</h1>
          </div>

          ${activeSubTab === 'MASTER' ? `
            <div class="stats-grid">
              <div class="stat-card"><div class="stat-num">${stats.totalCanalizados}</div><div class="stat-lbl">Total Canalizados</div></div>
              <div class="stat-card"><div class="stat-num">${stats.enProceso}</div><div class="stat-lbl">En Seguimiento</div></div>
              <div class="stat-card"><div class="stat-num">${stats.concluidos}</div><div class="stat-lbl">Concluidos</div></div>
              <div class="stat-card"><div class="stat-num">${stats.conEntrevistaPadres}</div><div class="stat-lbl">Atención Familiar</div></div>
            </div>
          ` : ''}

          <div class="section">
            <div class="section-title">I. Resumen Ejecutivo Institucional</div>
            <div class="content-box">${execSummary}</div>
          </div>

          <div class="section">
            <div class="section-title">II. Ejes Generales de Intervención Psicopedagógica</div>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-top: 8px;">
              <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px;">
                <div style="font-weight: bold; font-size: 11px; color: #1e3a8a;">1. Eje Socioemocional y Afectivo</div>
                <div style="font-size: 10px; color: #475569; margin-top: 3px;">Fortalecimiento de la autorregulación emocional, autoestima, resolución pacífica de conflictos y bienestar escolar.</div>
              </div>
              <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px;">
                <div style="font-weight: bold; font-size: 11px; color: #b45309;">2. Eje de Convivencia y Conducta</div>
                <div style="font-size: 10px; color: #475569; margin-top: 3px;">Acompañamiento en el cumplimiento de normas escolares, respeto mutuo, integración armónica en el aula y prevención de conductas de riesgo.</div>
              </div>
              <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px;">
                <div style="font-weight: bold; font-size: 11px; color: #1d4ed8;">3. Eje de Aprendizaje y Acompañamiento Docente</div>
                <div style="font-size: 10px; color: #475569; margin-top: 3px;">Detección de estilos de aprendizaje, adecuaciones curriculares y trabajo colaborativo con profesores titulares y de materia.</div>
              </div>
              <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px;">
                <div style="font-weight: bold; font-size: 11px; color: #15803d;">4. Eje de Vinculación y Acompañamiento Familiar</div>
                <div style="font-size: 10px; color: #475569; margin-top: 3px;">Orientación formativa a padres o tutores, formalización de compromisos en el hogar y seguimiento mutuo con el plantel.</div>
              </div>
            </div>
          </div>

          <div class="section">
            <div class="section-title">III. Cobertura y Distribución Global por Grado / Nivel</div>
            <table style="width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 8px;">
              <thead>
                <tr style="background: #f1f5f9; text-align: left; color: #334155;">
                  <th style="padding: 6px 8px; border: 1px solid #cbd5e1;">Grado / Nivel</th>
                  <th style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">Total Canalizados</th>
                  <th style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">En Seguimiento</th>
                  <th style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">Concluidos</th>
                  <th style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">Derivados Ext.</th>
                  <th style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">Atención Tutores</th>
                  <th style="padding: 6px 8px; border: 1px solid #cbd5e1; text-align: center;">Estatus General</th>
                </tr>
              </thead>
              <tbody>
                ${gradeRowsHtml || '<tr><td colspan="7" style="padding: 10px; text-align: center; color: #94a3b8;">Sin datos registrados.</td></tr>'}
              </tbody>
            </table>
            <div style="font-size: 9px; color: #64748b; font-style: italic; margin-top: 6px;">
              * Información estadística consolidada y despersonalizada conforme a las políticas institucionales de confidencialidad y protección de datos.
            </div>
          </div>

          ${conclusions ? `
            <div class="section">
              <div class="section-title">IV. Conclusiones y Acuerdos de Trabajo Institucionales</div>
              <div class="content-box">${conclusions}</div>
            </div>
          ` : ''}

          <div style="margin-top: 45px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; text-align: center; font-size: 10px; page-break-inside: avoid;">
            <div>
              <div style="border-top: 1px solid #64748b; width: 80%; margin: 0 auto 6px auto;"></div>
              <div style="font-weight: bold; color: #1e293b;">${profile.name || 'Departamento de Psicología'}</div>
              <div style="color: #64748b;">Psicología Escolar</div>
            </div>
            <div>
              <div style="border-top: 1px solid #64748b; width: 80%; margin: 0 auto 6px auto;"></div>
              <div style="font-weight: bold; color: #1e293b;">Coordinación Académica</div>
              <div style="color: #64748b;">Visto Bueno</div>
            </div>
            <div>
              <div style="border-top: 1px solid #64748b; width: 80%; margin: 0 auto 6px auto;"></div>
              <div style="font-weight: bold; color: #1e293b;">Dirección del Plantel</div>
              <div style="color: #64748b;">Dirección General</div>
            </div>
          </div>

          <div class="footer">
            Este documento es un informe confidencial generado para uso institucional exclusivo del personal autorizado.
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

  // Open Share & Redaction Modal
  const handleOpenShareModal = () => {
    const today = new Date();
    const periodStr = `Periodo al ${today.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}`;
    
    setEditableTitle('Informe General de Canalizaciones y Seguimiento Psicopedagógico');
    setEditablePeriod(periodStr);
    setEditableSummary(autoExecutiveSummary);
    setEditableConclusions(autoConclusions);
    setEditableStudents([]);
    
    setSelectedRecipients(allAvailableRecipients.map(r => r.email));
    setIsShareModalOpen(true);
  };

  // Helper to blackout specific text in cursor selection
  const applyBlackoutToText = (text: string, textarea: HTMLTextAreaElement | null, setter: (val: string) => void) => {
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    if (start !== undefined && end !== undefined && start !== end) {
      const selected = text.substring(start, end);
      const redacted = selected.replace(/[^\s\n]/g, '█');
      const newText = text.substring(0, start) + redacted + text.substring(end);
      setter(newText);
    } else {
      showAlert("Marcatextos Negro", "Por favor selecciona primero las palabras con el ratón o cursor para censurarlas, o usa el modo 'Tocar Palabras'.", "info");
    }
  };

  // Helper to toggle word blackout on click/touch
  const toggleWordBlackout = (fullText: string, wordIdx: number, setter: (val: string) => void) => {
    const tokens = fullText.match(/(\S+|\s+)/g) || [];
    let count = -1;
    const updated = tokens.map(token => {
      if (/\S/.test(token)) {
        count++;
        if (count === wordIdx) {
          if (token.includes('█')) {
            return ' [TEXTO_RESTAURADO] ';
          } else {
            return '█'.repeat(token.length);
          }
        }
      }
      return token;
    }).join('');

    setter(updated.replace(/\s*\[TEXTO_RESTAURADO\]\s*/g, ' '));
  };

  // Anonymize student name helper
  const getAnonymizedName = (name: string) => {
    if (!name) return 'ALUMNO REGISTRADO';
    const parts = name.trim().split(/\s+/);
    return parts.map(p => p[0]?.toUpperCase() + '.').join(' ');
  };

  // Handle Save & Send Shared Report
  const handleConfirmAndSendSharedReport = async () => {
    if (selectedRecipients.length === 0) {
      showAlert("Seleccionar destinatarios", "Por favor selecciona al menos un destinatario para compartir el informe.", "info");
      return;
    }

    setIsSubmitting(true);
    try {
      // Collect superadmin recipients (included automatically by default)
      const superAdminRecipients: { email: string; name: string; roleLabel: string; uid?: string }[] = [];
      const saEmailsSeen = new Set<string>();
      admins.forEach(a => {
        if (a.email && (isSuperAdminEmail(a.email) || (a as any).role === 'SUPER_ADMIN') && !saEmailsSeen.has(a.email.toLowerCase())) {
          saEmailsSeen.add(a.email.toLowerCase());
          superAdminRecipients.push({ email: a.email.toLowerCase(), name: a.name || 'Super Admin', roleLabel: 'Super Admin', uid: a.uid });
        }
      });
      SUPER_ADMIN_EMAILS.forEach(saEmail => {
        if (!saEmailsSeen.has(saEmail.toLowerCase())) {
          saEmailsSeen.add(saEmail.toLowerCase());
          superAdminRecipients.push({ email: saEmail.toLowerCase(), name: 'Super Admin', roleLabel: 'Super Admin' });
        }
      });

      const selectedUsersData = allAvailableRecipients.filter(r => selectedRecipients.includes(r.email));
      const allRecipientsPayload = [...selectedUsersData, ...superAdminRecipients];

      const sharedReportId = `rep_${Date.now()}`;
      const payload: SharedReport = {
        id: sharedReportId,
        title: editableTitle.trim() || 'Informe General de Canalizaciones y Seguimiento Psicopedagógico',
        period: editablePeriod.trim(),
        executiveSummary: editableSummary.trim(),
        conclusions: editableConclusions.trim(),
        gradeSummary: stats.gradeSummaryList,
        sharedBy: profile.name || 'Departamento de Psicología',
        sharedByEmail: profile.email,
        sharedAt: Date.now(),
        recipients: allRecipientsPayload
      };

      await setDoc(doc(db, 'shared_reports', sharedReportId), payload, { merge: true });

      // Notify recipients
      if (sendNotification) {
        const recipientUids = selectedUsersData.map(u => u.uid).filter(Boolean) as string[];
        const recipientEmails = selectedUsersData.map(u => u.email);
        const targets = recipientUids.length > 0 ? recipientUids : recipientEmails;

        await sendNotification(
          targets,
          `📊 Nuevo Informe Psicológico Compartido`,
          `${profile.name} te ha compartido un Informe de Canalizaciones y Seguimiento Psicopedagógico.`,
          sharedReportId
        );
      }

      if (addLog) {
        await addLog(
          'Envío de Informe Psicológico Compartido',
          `Generado y compartido por: ${profile.name} (${profile.role} - ${profile.email}) | Título: ${payload.title} | Destinatarios (${selectedRecipients.length}): ${selectedUsersData.map(u => `${u.name} (${u.roleLabel})`).join(', ')}`
        );
      }

      showAlert("Envío exitoso", `¡Informe compartido enviado con éxito a ${selectedRecipients.length} destinatario(s)!`, "success");
      setIsShareModalOpen(false);
      setActiveSubTab('SHARED');
      setSelectedSharedReport(payload);
    } catch (err) {
      console.error("Error saving shared report:", err);
      showAlert("Error", "Ocurrió un error al enviar el informe compartido.", "error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Search, Filter, Print, and Shared Reports Controls Bar */}
      <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl shadow-sm border border-slate-200/80 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Search Bar */}
        <div className="relative flex-1 w-full">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
          <input
            type="text"
            placeholder="Filtrar informe global por grado o nivel escolar..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white focus:bg-white dark:focus:bg-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          />
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto justify-end">
          {/* Grade Filter */}
          <div className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700">
            <Filter className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">Grado:</span>
            <select
              value={gradeFilter}
              onChange={(e) => setGradeFilter(e.target.value)}
              className="bg-transparent text-xs font-bold text-slate-800 dark:text-white focus:outline-none cursor-pointer"
            >
              <option value="ALL">Todos los Grados</option>
              <option value="1">1º Grado</option>
              <option value="2">2º Grado</option>
              <option value="3">3º Grado</option>
              <option value="Preescolar">Preescolar</option>
              <option value="Primaria">Primaria</option>
              <option value="Secundaria">Secundaria</option>
            </select>
          </div>

          {/* SubTab Toggle: Informe Principal & Informes Compartidos */}
          {canCreateAndShare ? (
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => { setActiveSubTab('MASTER'); setSelectedSharedReport(null); }}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer",
                  activeSubTab === 'MASTER'
                    ? "bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                )}
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Informe</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveSubTab('SHARED')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer relative",
                  activeSubTab === 'SHARED'
                    ? "bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-xs"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                )}
              >
                <ShieldAlert className="w-3.5 h-3.5 text-emerald-500" />
                <span>Informes Compartidos ({sharedReports.length})</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 px-3.5 py-2 bg-emerald-50 text-emerald-800 rounded-xl border border-emerald-200 text-xs font-bold shadow-xs">
              <ShieldAlert className="w-4 h-4 text-emerald-600" />
              <span>Informes Compartidos ({sharedReports.length})</span>
            </div>
          )}

          {/* Print Button */}
          <button
            type="button"
            onClick={handlePrintReport}
            className="px-3.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer border border-slate-200 dark:border-slate-700"
          >
            <Printer className="w-4 h-4 text-slate-600 dark:text-slate-300" />
            <span>Imprimir</span>
          </button>

          {/* Compartir Option */}
          {canCreateAndShare && (
            <button
              type="button"
              onClick={handleOpenShareModal}
              className="px-3.5 py-2 bg-amber-500 hover:bg-amber-600 text-slate-950 rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all cursor-pointer"
              title="Censurar y compartir copia del informe"
            >
              <Share2 className="w-4 h-4" />
              <span>Compartir</span>
            </button>
          )}
        </div>
      </div>

      {/* SUB-TAB 1: MASTER AUTOMATED REPORT */}
      {canCreateAndShare && activeSubTab === 'MASTER' && (
        <div className="space-y-6">

          {/* Statistical Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex items-center gap-4">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-2xl flex items-center justify-center flex-shrink-0">
                <GraduationCap className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Alumnos Canalizados</p>
                <h3 className="text-2xl font-black text-slate-900">{stats.totalCanalizados}</h3>
                <p className="text-[11px] font-medium text-slate-500 mt-0.5">Con expediente individual</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex items-center gap-4">
              <div className="w-12 h-12 bg-amber-50 text-amber-600 rounded-2xl flex items-center justify-center flex-shrink-0">
                <BrainCircuit className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Seguimiento Activo</p>
                <h3 className="text-2xl font-black text-amber-600">{stats.enProceso}</h3>
                <p className="text-[11px] font-medium text-slate-500 mt-0.5">En proceso de intervención</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center flex-shrink-0">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Casos Concluidos</p>
                <h3 className="text-2xl font-black text-emerald-600">{stats.concluidos}</h3>
                <p className="text-[11px] font-medium text-slate-500 mt-0.5">Atención finalizada</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200/80 flex items-center gap-4">
              <div className="w-12 h-12 bg-sky-50 text-sky-600 rounded-2xl flex items-center justify-center flex-shrink-0">
                <Users className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider">Entrevistas Padres</p>
                <h3 className="text-2xl font-black text-sky-600">{stats.conEntrevistaPadres}</h3>
                <p className="text-[11px] font-medium text-slate-500 mt-0.5">Con tutores registrados</p>
              </div>
            </div>
          </div>

          {/* Executive Report Document */}
          <div className="bg-white rounded-3xl shadow-md border border-slate-200/80 p-6 md:p-8 space-y-8">
            {/* Title Section */}
            <div className="border-b border-slate-200 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-extrabold mb-2">
                  <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Informe Automático Consolidado</span>
                </div>
                <h2 className="text-xl md:text-2xl font-black text-slate-900">
                  Informe de Canalizaciones y Seguimiento Psicopedagógico
                </h2>
                <p className="text-xs font-semibold text-slate-500 mt-1">
                  Generado automáticamente con datos de expedientes al {new Date().toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })}
                </p>
              </div>

              {canCreateAndShare && (
                <button
                  type="button"
                  onClick={handleOpenShareModal}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer self-start"
                >
                  <Share2 className="w-4 h-4" />
                  <span>Censurar y Compartir Copia</span>
                </button>
              )}
            </div>

            {/* Section 1: Resumen Ejecutivo */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                <span>1. Resumen Ejecutivo</span>
              </h3>
              <div className="p-4 bg-slate-50 border border-slate-200/80 rounded-2xl text-xs md:text-sm leading-relaxed text-slate-700 whitespace-pre-line font-medium">
                {autoExecutiveSummary}
              </div>
            </div>

            {/* Section 2: Quienes solicitaron la canalización & Distribución */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-3">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-indigo-600" />
                  <span>Solicitantes de la Canalización</span>
                </h4>
                <div className="space-y-2">
                  {Object.keys(stats.referrerCounts).length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No hay datos de solicitantes registrados.</p>
                  ) : (
                    Object.entries(stats.referrerCounts).map(([referrer, count]) => (
                      <div key={referrer} className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-slate-200 text-xs font-semibold">
                        <span className="text-slate-800">{referrer}</span>
                        <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-lg font-bold">{count} caso(s)</span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-3">
                <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <PieChart className="w-4 h-4 text-indigo-600" />
                  <span>Distribución por Grado / Grupo</span>
                </h4>
                <div className="space-y-2">
                  {Object.keys(stats.gradeCounts).length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No hay distribución registrada.</p>
                  ) : (
                    Object.entries(stats.gradeCounts).map(([grade, count]) => (
                      <div key={grade} className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-slate-200 text-xs font-semibold">
                        <span className="text-slate-800">{grade}</span>
                        <span className="px-2.5 py-1 bg-amber-50 text-amber-800 rounded-lg font-bold">{count} alumno(s)</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Section 2: Ejes Generales de Intervención y Cobertura Agregada */}
            <div className="space-y-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-indigo-600" />
                    <span>2. Ejes Generales de Intervención Psicopedagógica</span>
                  </h3>
                  <p className="text-xs text-slate-500 font-medium mt-0.5">
                    Resumen general y líneas de acción institucionales del Departamento de Psicología
                  </p>
                </div>
                <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100 flex items-center gap-1.5 self-start">
                  <ShieldAlert className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Informe Global Despersonalizado</span>
                </span>
              </div>

              {/* 4 Core Strategic Axes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-50/90 border border-slate-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-purple-100 text-purple-700 flex items-center justify-center flex-shrink-0">
                      <BrainCircuit className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 uppercase">Eje Socioemocional y Afectivo</h4>
                      <span className="text-[10px] text-slate-500">Bienestar y salud mental escolar</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    Acompañamiento en autorregulación emocional, tolerancia a la frustración, desarrollo de la autoestima y fortalecimiento de habilidades para la vida y expresión asertiva ante conflictos.
                  </p>
                </div>

                <div className="bg-slate-50/90 border border-slate-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center flex-shrink-0">
                      <CheckCircle2 className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 uppercase">Eje de Convivencia y Conducta</h4>
                      <span className="text-[10px] text-slate-500">Clima escolar armónico</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    Intervenciones orientadas a la resolución pacífica de diferencias, apego a los acuerdos escolares de aula, respeto mutuo entre pares y prevención de conductas disruptivas.
                  </p>
                </div>

                <div className="bg-slate-50/90 border border-slate-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center flex-shrink-0">
                      <GraduationCap className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 uppercase">Eje de Aprendizaje y Acompañamiento Docente</h4>
                      <span className="text-[10px] text-slate-500">Apoyo pedagógico y adecuaciones</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    Valoración de estilos de aprendizaje, fomento de técnicas de concentración y articulación colegiada con docentes para adecuaciones en el aula ({Math.round((stats.conEstrategiasDocentes / (stats.totalCanalizados || 1)) * 100)}% de vinculación activa).
                  </p>
                </div>

                <div className="bg-slate-50/90 border border-slate-200 rounded-2xl p-4 space-y-2">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center flex-shrink-0">
                      <Users className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-900 uppercase">Eje de Vinculación Familiar</h4>
                      <span className="text-[10px] text-slate-500">Corresponsabilidad tutorial</span>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed font-medium">
                    Orientación psicopedagógica a madres, padres y tutores, formalizando acuerdos formativos en casa ({Math.round((stats.conEntrevistaPadres / (stats.totalCanalizados || 1)) * 100)}% de casos con seguimiento tutorial directo).
                  </p>
                </div>
              </div>

              {/* Cobertura y Estatus Global por Grado / Nivel */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-indigo-600" />
                    <span>3. Cobertura y Estatus Global por Grado / Nivel</span>
                  </h4>
                  <span className="text-[11px] text-slate-500 font-medium">
                    Datos consolidados para seguimiento institucional
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-600 bg-white">
                        <th className="p-3 font-bold">Grado / Nivel</th>
                        <th className="p-3 font-bold text-center">Total Canalizados</th>
                        <th className="p-3 font-bold text-center">En Seguimiento</th>
                        <th className="p-3 font-bold text-center">Concluidos</th>
                        <th className="p-3 font-bold text-center">Derivados Ext.</th>
                        <th className="p-3 font-bold text-center">Atención con Tutores</th>
                        <th className="p-3 font-bold text-center">Estatus General</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/80 bg-white">
                      {stats.gradeSummaryList.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="p-4 text-center text-slate-400 italic">
                            No hay registros con los filtros seleccionados
                          </td>
                        </tr>
                      ) : (
                        stats.gradeSummaryList.map((item) => (
                          <tr key={item.grade} className="hover:bg-slate-50 transition-colors">
                            <td className="p-3 font-bold text-slate-800">{item.grade}</td>
                            <td className="p-3 text-center font-extrabold text-slate-900">{item.total}</td>
                            <td className="p-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                {item.enProc}
                              </span>
                            </td>
                            <td className="p-3 text-center">
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                {item.conc}
                              </span>
                            </td>
                            <td className="p-3 text-center text-slate-600 font-medium">
                              {item.deriv}
                            </td>
                            <td className="p-3 text-center font-semibold text-slate-700">
                              {item.conPadres} ({item.pctPadres}%)
                            </td>
                            <td className="p-3 text-center">
                              <span className="text-[11px] font-bold text-slate-600">
                                {item.conc === item.total && item.total > 0 ? 'Concluido' : 'En Atención'}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Section 4: Conclusiones y Recomendaciones */}
            <div className="space-y-3 border-t border-slate-200 pt-6">
              <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>3. Conclusiones y Acuerdos de Trabajo</span>
              </h3>
              <div className="p-4 bg-emerald-50/50 border border-emerald-200 rounded-2xl text-xs md:text-sm leading-relaxed text-slate-800 whitespace-pre-line font-medium">
                {autoConclusions}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: SHARED REPORTS CONSULTATION */}
      {(!canCreateAndShare || activeSubTab === 'SHARED' || selectedSharedReport) && (
        <div className="space-y-6">
          {selectedSharedReport ? (
            /* Detailed View of a Selected Shared Report */
            <div className="bg-white rounded-3xl shadow-lg border border-slate-200/80 p-6 md:p-8 space-y-8">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <button
                  type="button"
                  onClick={() => setSelectedSharedReport(null)}
                  className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  ← Volver a Informes
                </button>

                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full text-xs font-bold border border-emerald-300 flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5 text-emerald-600" /> Copia Compartida y Censurada
                  </span>
                  <button
                    type="button"
                    onClick={handlePrintReport}
                    className="px-3 py-1.5 bg-slate-900 text-white hover:bg-black rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Printer className="w-4 h-4" />
                    <span>Imprimir Copia</span>
                  </button>
                </div>
              </div>

              {/* Header Info */}
              <div className="bg-slate-50 p-5 rounded-2xl border border-slate-200/80 space-y-2">
                <div className="flex items-center gap-2 text-indigo-700 text-xs font-extrabold uppercase tracking-wider">
                  <FileText className="w-4 h-4" />
                  <span>{selectedSharedReport.period}</span>
                </div>
                <h2 className="text-xl font-black text-slate-900">{selectedSharedReport.title}</h2>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 font-medium">
                  <span>Compartido por: <strong className="text-slate-800">{selectedSharedReport.sharedBy}</strong></span>
                  <span>Fecha: <strong className="text-slate-800">{new Date(selectedSharedReport.sharedAt).toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</strong></span>
                </div>
              </div>

              {/* Executive Summary */}
              <div className="space-y-2">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Resumen Ejecutivo</h3>
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl text-xs md:text-sm leading-relaxed font-mono whitespace-pre-line">
                  {selectedSharedReport.executiveSummary}
                </div>
              </div>

              {/* Strategic Axes of Intervention */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <ClipboardList className="w-4 h-4 text-indigo-600" />
                    <span>Ejes Rectores de Intervención Psicopedagógica</span>
                  </h3>
                  <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-full border border-indigo-100">
                    Resumen Macro Institucional
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <BrainCircuit className="w-3.5 h-3.5 text-purple-600" />
                      1. Eje Socioemocional y Afectivo
                    </span>
                    <p className="text-slate-600 font-medium leading-relaxed">
                      Acompañamiento en autorregulación emocional, tolerancia a la frustración, desarrollo de la autoestima y habilidades socioemocionales.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-amber-600" />
                      2. Eje de Convivencia y Regulación Conductual
                    </span>
                    <p className="text-slate-600 font-medium leading-relaxed">
                      Resolución pacífica de conflictos, apego al marco de convivencia escolar, respeto mutuo entre pares y prevención de conductas disruptivas.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <GraduationCap className="w-3.5 h-3.5 text-blue-600" />
                      3. Eje de Aprendizaje y Acompañamiento Docente
                    </span>
                    <p className="text-slate-600 font-medium leading-relaxed">
                      Detección de estilos y ritmos de aprendizaje, adecuaciones curriculares y trabajo colaborativo y colegiado con los docentes.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1.5">
                    <span className="font-bold text-slate-900 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-emerald-600" />
                      4. Eje de Vinculación y Acompañamiento Familiar
                    </span>
                    <p className="text-slate-600 font-medium leading-relaxed">
                      Entrevistas periódicas de orientación con padres de familia o tutores y formalización de acuerdos y corresponsabilidad formativa en el hogar.
                    </p>
                  </div>
                </div>
              </div>

              {/* Cobertura y Distribución por Grado / Nivel */}
              <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-indigo-600" />
                    <span>Cobertura y Distribución Global por Grado / Nivel</span>
                  </h3>
                  <span className="text-[10px] text-slate-500 font-medium">
                    Datos consolidados y despersonalizados
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-600 bg-slate-50">
                        <th className="p-3 font-bold">Grado / Nivel</th>
                        <th className="p-3 font-bold text-center">Total Canalizados</th>
                        <th className="p-3 font-bold text-center">En Seguimiento</th>
                        <th className="p-3 font-bold text-center">Concluidos</th>
                        <th className="p-3 font-bold text-center">Derivados Ext.</th>
                        <th className="p-3 font-bold text-center">Atención con Tutores</th>
                        <th className="p-3 font-bold text-center">Estatus General</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/80 bg-white">
                      {((selectedSharedReport.gradeSummary && selectedSharedReport.gradeSummary.length > 0)
                        ? selectedSharedReport.gradeSummary
                        : stats.gradeSummaryList).map((item) => (
                        <tr key={item.grade} className="hover:bg-slate-50 transition-colors">
                          <td className="p-3 font-bold text-slate-800">{item.grade}</td>
                          <td className="p-3 text-center font-extrabold text-slate-900">{item.total}</td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                              {item.enProc}
                            </span>
                          </td>
                          <td className="p-3 text-center">
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                              {item.conc}
                            </span>
                          </td>
                          <td className="p-3 text-center text-slate-600 font-medium">
                            {item.deriv}
                          </td>
                          <td className="p-3 text-center font-semibold text-slate-700">
                            {item.conPadres} ({item.pctPadres}%)
                          </td>
                          <td className="p-3 text-center">
                            <span className="text-[11px] font-bold text-slate-600">
                              {item.conc === item.total && item.total > 0 ? 'Concluido' : 'En Atención'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Conclusions */}
              <div className="space-y-2 border-t border-slate-200 pt-4">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">Conclusiones y Recomendaciones</h3>
                <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-2xl text-xs md:text-sm font-mono leading-relaxed whitespace-pre-line text-slate-800">
                  {selectedSharedReport.conclusions}
                </div>
              </div>
            </div>
          ) : (
            /* List of Available Shared Reports */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 text-emerald-600" />
                  <span>Informes Compartidos Disponibles ({sharedReports.length})</span>
                </h3>
              </div>

              {sharedReports.length === 0 ? (
                <div className="bg-white p-12 text-center rounded-3xl border border-slate-200 shadow-sm space-y-3">
                  <FileText className="w-12 h-12 text-slate-300 mx-auto" />
                  <h4 className="font-bold text-slate-800 text-base">No hay informes compartidos disponibles aún.</h4>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Cuando el Departamento de Psicología o los Administradores generen y compartan un informe con censura de datos, aparecerá disponible en este apartado.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {sharedReports.map((report) => (
                    <div
                      key={report.id}
                      onClick={() => setSelectedSharedReport(report)}
                      className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all cursor-pointer space-y-3 group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <span className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-wider bg-indigo-50 px-2 py-0.5 rounded-md border border-indigo-100">
                            {report.period}
                          </span>
                          <h4 className="font-bold text-slate-900 text-sm mt-1 group-hover:text-indigo-600 transition-colors">
                            {report.title}
                          </h4>
                        </div>
                        <span className="p-2 bg-slate-50 group-hover:bg-indigo-50 text-slate-400 group-hover:text-indigo-600 rounded-xl transition-colors">
                          <Eye className="w-4 h-4" />
                        </span>
                      </div>

                      <p className="text-xs text-slate-600 line-clamp-2 font-medium">
                        {report.executiveSummary}
                      </p>

                      <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500 font-medium">
                        <span>De: <strong>{report.sharedBy}</strong></span>
                        <span>{new Date(report.sharedAt).toLocaleDateString('es-MX')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* SHARE AND REDACTION MODAL */}
      {isShareModalOpen && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95 duration-200">
            {/* Modal Header */}
            <div className="p-6 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between flex-shrink-0">
              <div>
                <div className="flex items-center gap-2 text-amber-400 text-xs font-bold uppercase tracking-wider mb-1">
                  <ShieldAlert className="w-4 h-4" />
                  <span>Edición y Censura de Datos antes de Enviar</span>
                </div>
                <h3 className="text-lg font-black">Compartir Informe de Canalizaciones</h3>
              </div>
              <button
                onClick={() => setIsShareModalOpen(false)}
                className="p-2 text-slate-400 hover:text-white rounded-xl transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {/* Recipient Selection */}
              <div className="space-y-2 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <Users className="w-4 h-4 text-indigo-600" />
                  <span>1. Seleccionar Destinatarios ({selectedRecipients.length} seleccionados)</span>
                </label>
                <p className="text-[11px] text-slate-500 font-medium">
                  Selecciona a quiénes se les notificará y otorgará acceso para consultar esta copia del informe.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 pt-2 max-h-36 overflow-y-auto">
                  {allAvailableRecipients.map((rec) => {
                    const isChecked = selectedRecipients.includes(rec.email);
                    return (
                      <label
                        key={rec.email}
                        className={cn(
                          "flex items-center gap-2.5 p-2.5 rounded-xl border text-xs font-medium cursor-pointer transition-all",
                          isChecked ? "bg-indigo-50/80 border-indigo-300 text-indigo-950 font-semibold shadow-2xs" : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedRecipients(prev => [...prev, rec.email]);
                            } else {
                              setSelectedRecipients(prev => prev.filter(em => em !== rec.email));
                            }
                          }}
                          className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs">{rec.name}</p>
                          <p className="text-[10px] text-slate-400 truncate">{rec.roleLabel}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Privacy Notice */}
              <div className="bg-emerald-50/80 border border-emerald-200 p-4 rounded-2xl flex items-start gap-3">
                <ShieldAlert className="w-5 h-5 text-emerald-600 flex-shrink-0 mt-0.5" />
                <div className="text-xs space-y-1">
                  <h4 className="font-bold text-emerald-950 uppercase tracking-wider">Informe General Despersonalizado</h4>
                  <p className="text-emerald-800 leading-relaxed font-medium">
                    Este informe está configurado para compartir únicamente datos estadísticos consolidados por grado y conclusiones globales de intervención psicopedagógica, preservando la confidencialidad de los expedientes individuales.
                  </p>
                </div>
              </div>

              {/* Title & Period Inputs */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Título del Informe:</label>
                  <input
                    type="text"
                    value={editableTitle}
                    onChange={(e) => setEditableTitle(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-700">Periodo o Encabezado:</label>
                  <input
                    type="text"
                    value={editablePeriod}
                    onChange={(e) => setEditablePeriod(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900"
                  />
                </div>
              </div>

              {/* Executive Summary Censorship / Editing */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Resumen Ejecutivo Institucional (Censura o Edición)
                  </label>
                  <button
                    type="button"
                    onClick={() => applyBlackoutToText(editableSummary, summaryTextareaRef.current, setEditableSummary)}
                    className="px-2.5 py-1 bg-slate-900 hover:bg-black text-white rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors"
                  >
                    <span>🖍️ Censurar Selección en Negro</span>
                  </button>
                </div>

                <textarea
                  ref={summaryTextareaRef}
                  rows={4}
                  value={editableSummary}
                  onChange={(e) => setEditableSummary(e.target.value)}
                  placeholder="Edita o censura el resumen ejecutivo antes de compartir..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              {/* Cobertura por Grado Preview */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Distribución y Cobertura Global que se Compartirá ({stats.gradeSummaryList.length} Grados)
                </label>
                <div className="overflow-x-auto border border-slate-200 rounded-2xl">
                  <table className="w-full text-left text-xs bg-white">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-600">
                      <tr>
                        <th className="p-2.5 font-bold">Grado</th>
                        <th className="p-2.5 font-bold text-center">Canalizados</th>
                        <th className="p-2.5 font-bold text-center">En Seguimiento</th>
                        <th className="p-2.5 font-bold text-center">Concluidos</th>
                        <th className="p-2.5 font-bold text-center">Atención con Tutores</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stats.gradeSummaryList.map((item) => (
                        <tr key={item.grade}>
                          <td className="p-2.5 font-bold text-slate-800">{item.grade}</td>
                          <td className="p-2.5 text-center font-bold">{item.total}</td>
                          <td className="p-2.5 text-center text-amber-700 font-semibold">{item.enProc}</td>
                          <td className="p-2.5 text-center text-emerald-700 font-semibold">{item.conc}</td>
                          <td className="p-2.5 text-center text-slate-700 font-medium">{item.conPadres} ({item.pctPadres}%)</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Editable Conclusions */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Conclusiones y Acuerdos de Trabajo Institucionales
                </label>
                <textarea
                  rows={3}
                  value={editableConclusions}
                  onChange={(e) => setEditableConclusions(e.target.value)}
                  placeholder="Conclusiones y recomendaciones para directivos y coordinadores..."
                  className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-mono text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-5 bg-slate-100 border-t border-slate-200 flex items-center justify-between flex-shrink-0">
              <span className="text-xs text-slate-500 font-medium">
                💡 Los cambios y censuras aplicados afectarán únicamente a esta copia compartida.
              </span>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsShareModalOpen(false)}
                  className="px-4 py-2 bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleConfirmAndSendSharedReport}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-sm transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-4 h-4" />
                  <span>{isSubmitting ? 'Enviando...' : 'Confirmar y Enviar Informe'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Custom System Modal */}
      <SystemModal modal={sysModal} onClose={() => setSysModal(prev => ({ ...prev, isOpen: false }))} />
    </div>
  );
};
