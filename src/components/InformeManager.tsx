import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  FileText, BarChart2, Users, Search, Share2, Lock, Eye, EyeOff, 
  CheckCircle2, AlertTriangle, GraduationCap, Printer, Sparkles, 
  BrainCircuit, X, Check, Filter, Calendar, ShieldAlert, Edit3, 
  ChevronDown, Send, UserCheck, RefreshCw, MessageSquare, PieChart,
  ClipboardList
} from 'lucide-react';
import { UserProfile, Expediente, Referral, normalizeUserRole } from '../types';
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

export interface SharedReport {
  id: string;
  title: string;
  period: string;
  executiveSummary: string;
  conclusions: string;
  studentsBreakdown: SharedReportStudentCard[];
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

        // Filter reports visible to current user (Admin, Directive, and Coordinator only view reports shared with them)
        const userEmailLower = profile.email?.toLowerCase();
        const visibleReports = reports.filter(r => {
          // Psychologist who created/shared the report can see it
          if (isPsychologist && r.sharedByEmail?.toLowerCase() === userEmailLower) return true;
          // Admins, Directives, Coordinators only view reports shared with them
          return r.recipients?.some(rec => 
            (rec.email && userEmailLower && rec.email.toLowerCase() === userEmailLower) || 
            (profile.uid && rec.uid === profile.uid)
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

  // Combine recipient options
  const allAvailableRecipients = useMemo(() => {
    const list: Array<{ uid?: string; email: string; name: string; roleLabel: string }> = [];
    
    // Directives
    directives.forEach(d => {
      if (d.email) list.push({ uid: d.uid, email: d.email.toLowerCase(), name: d.name, roleLabel: 'Directivo' });
    });
    // Coordinators
    coordinators.forEach(c => {
      if (c.email && !list.some(x => x.email === c.email.toLowerCase())) {
        list.push({ uid: c.uid, email: c.email.toLowerCase(), name: c.name, roleLabel: 'Coordinador' });
      }
    });
    // Admins
    admins.forEach(a => {
      if (a.email && !list.some(x => x.email === a.email.toLowerCase())) {
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
      // Directives, Coordinators, Admins only view expedientes shared with them by the psychologist
      if (!isPsychologist) {
        const isRecipient = Array.isArray((exp as any).recipients) && (exp as any).recipients.some((r: any) =>
          (r.uid && profile.uid && r.uid === profile.uid) ||
          (r.email && userEmailLower && r.email.toLowerCase() === userEmailLower)
        );
        const isOwner = (exp as any).sharedByEmail && userEmailLower && (exp as any).sharedByEmail.toLowerCase() === userEmailLower;
        if (!isRecipient && !isOwner) return false;
      }

      const matchesSearch = searchQuery === '' || 
        exp.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        exp.gradeGroup.toLowerCase().includes(searchQuery.toLowerCase()) ||
        exp.reasonAndBackground.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesGrade = gradeFilter === 'ALL' || exp.gradeGroup.toLowerCase().includes(gradeFilter.toLowerCase());

      return matchesSearch && matchesGrade;
    });
  }, [expedientes, searchQuery, gradeFilter, profile.role, profile.uid, profile.email]);

  // Statistics calculation from expedientes
  const stats = useMemo(() => {
    const totalCanalizados = filteredExpedientes.length;

    // By status
    const enProceso = filteredExpedientes.filter(e => !e.status || e.status === 'EN_PROCESO').length;
    const concluidos = filteredExpedientes.filter(e => e.status === 'CONCLUIDO').length;
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

    return {
      totalCanalizados,
      enProceso,
      concluidos,
      derivados,
      gradeCounts,
      referrerCounts,
      conEstrategiasDocentes,
      conEntrevistaPadres,
      conEvaluacionPsico
    };
  }, [filteredExpedientes, referrals]);

  // Automatic Executive Summary Text Generation
  const autoExecutiveSummary = useMemo(() => {
    if (filteredExpedientes.length === 0) {
      return "Actualmente no se registran alumnos en canalización con expediente activo en la selección.";
    }

    const total = stats.totalCanalizados;
    const topGrades = (Object.entries(stats.gradeCounts) as [string, number][])
      .sort((a, b) => b[1] - a[1])
      .map(([g, c]) => `${g} (${c} alumno${c > 1 ? 's' : ''})`)
      .slice(0, 3)
      .join(', ');

    const getUniqueItemsText = (getter: (e: any) => string | undefined, defaultText: string) => {
      const items = Array.from(new Set(
        filteredExpedientes
          .map(e => getter(e)?.trim())
          .filter((t): t is string => Boolean(t && t.length > 2))
          .map(t => t.replace(/^•\s*\[.*?\]:\s*/, '').replace(/^\[.*?\]:\s*/, '').trim())
      ));
      if (items.length === 0) return defaultText;
      return items.join('; ');
    };

    const motivosStr = getUniqueItemsText(e => e.reasonAndBackground, 'atención a necesidades de aprendizaje, regulación emocional y acompañamiento conductual');
    const estrategiasStr = getUniqueItemsText(e => e.teacherStrategies, 'implementación de adecuaciones curriculares y estrategias psicopedagógicas en el aula');
    const entrevistasStr = getUniqueItemsText(e => e.parentInterviews, 'atención periódica y firma de acuerdos de colaboración con los tutores');
    const evaluacionesStr = getUniqueItemsText(e => e.psychologicalEvaluation, 'valoración de estilos de aprendizaje e impresiones psicopedagógicas');
    const seguimientoStr = getUniqueItemsText(e => e.psychologyFollowUp, 'sesiones de orientación, desarrollo de habilidades socioemocionales y acuerdos conductuales');
    const avancesStr = getUniqueItemsText(e => e.latestProgress, 'evolución favorable y cumplimiento paulatino de los objetivos previstos');

    const countConEntrevistas = filteredExpedientes.filter(e => e.parentInterviews?.trim()).length;
    const countConEvaluacion = filteredExpedientes.filter(e => e.psychologicalEvaluation?.trim()).length;
    const countConEstrategias = filteredExpedientes.filter(e => e.teacherStrategies?.trim()).length;
    const countConSeguimiento = filteredExpedientes.filter(e => e.psychologyFollowUp?.trim()).length;
    const countConAvances = filteredExpedientes.filter(e => e.latestProgress?.trim()).length;

    return `El presente resumen ejecutivo consolida de manera integral la información psicopedagógica recopilada en un total de ${total} expediente(s) existente(s), concentrados principalmente en los niveles de ${topGrades || 'diversos grados'}.\n\n` +
      `Respecto a los motivos de canalización y antecedentes, la población atendida presenta principalmente observaciones relacionadas con: ${motivosStr}.\n\n` +
      `En cuanto a las estrategias previas aplicadas por los docentes, en el ${Math.round((countConEstrategias / (total || 1)) * 100)}% de los expedientes se registran intervenciones y adecuaciones en el aula como: ${estrategiasStr}.\n\n` +
      `En el ámbito del acompañamiento familiar, el ${Math.round((countConEntrevistas / (total || 1)) * 100)}% de los casos cuenta con registro formal de entrevistas y acuerdos con padres de familia, enfocados en: ${entrevistasStr}.\n\n` +
      `En materia de evaluación y diagnóstico psicopedagógico, se tiene constancia en el ${Math.round((countConEvaluacion / (total || 1)) * 100)}% de los expedientes mediante: ${evaluacionesStr}.\n\n` +
      `Sobre el seguimiento y acuerdos establecidos por el Departamento de Psicología, el ${Math.round((countConSeguimiento / (total || 1)) * 100)}% de los alumnos cuenta con acciones activas de orientación y acuerdos como: ${seguimientoStr}.\n\n` +
      `En relación a los últimos avances reportados, el ${Math.round((countConAvances / (total || 1)) * 100)}% de los estudiantes muestra logros y evoluciones cuantitativas/cualitativas observando: ${avancesStr}.\n\n` +
      `Por último, respecto a las acciones de guardado, actualización y resguardo de avances, el 100% de los ${total} expedientes analizados se encuentran digitalizados, actualizados y debidamente resguardados en la plataforma institucional, garantizando la confidencialidad, la trazabilidad de los datos y la continuidad del proceso psicopedagógico.`;
  }, [filteredExpedientes, stats]);

  // Automatic Conclusions Text Generation
  const autoConclusions = useMemo(() => {
    return `1. Continuar con el monitoreo continuo de los ${stats.enProceso} expedientes en seguimiento activo.\n` +
      `2. Reforzar las entrevistas y compromisos con los padres de familia en los casos que requieran apoyo psicopedagógico en casa.\n` +
      `3. Mantener reuniones de retroalimentación periódicas entre el Departamento de Psicología, Coordinadores y Directivos para garantizar el cumplimiento de los acuerdos instaurados.`;
  }, [stats]);

  // Auto-build student breakdown cards
  const masterStudentCards = useMemo<SharedReportStudentCard[]>(() => {
    return filteredExpedientes.map(exp => {
      const ref = referrals.find(r => r.id === exp.linkedReferralId || r.studentName.toLowerCase() === exp.studentName.toLowerCase());
      const referredBy = ref ? `${ref.referredByName || ref.referredBy} (${ref.referredByRole || 'Docente/Coordinador'})` : 'Canalización Directa / Psicología';

      return {
        expedienteId: exp.id,
        studentName: exp.studentName,
        gradeGroup: exp.gradeGroup,
        referredBy,
        reasonAndBackground: exp.reasonAndBackground || 'Sin motivo registrado.',
        teacherStrategies: exp.teacherStrategies || 'Sin estrategias docentes registradas.',
        parentInterviews: exp.parentInterviews || 'Sin entrevistas con padres registradas.',
        psychologicalEvaluation: exp.psychologicalEvaluation || 'Sin evaluación psicológica registrada.',
        psychologyFollowUp: exp.psychologyFollowUp || 'Sin acciones registradas.',
        latestProgress: exp.latestProgress || 'Sin avances recientes.',
        status: exp.status || 'EN_PROCESO'
      };
    });
  }, [filteredExpedientes, referrals]);

  // Dedicated Print Function for Reports
  const handlePrintReport = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.print();
      return;
    }

    const reportTitle = activeSubTab === 'MASTER' 
      ? 'INFORME GENERAL Y ESTADÍSTICO DE ATENCIÓN PSICOPEDAGÓGICA' 
      : selectedSharedReport?.title || 'INFORME COMPARTIDO DE PSICOLOGÍA';

    const logoUrl = systemSettings?.appLogoUrl || "/logo.svg";
    const appName = systemSettings?.appName || "DASHBOARD DUNOR";

    const execSummary = activeSubTab === 'MASTER' ? autoExecutiveSummary : selectedSharedReport?.executiveSummary || '';
    const conclusions = activeSubTab === 'MASTER' ? autoConclusions : selectedSharedReport?.conclusions || '';
    const dateStr = new Date().toLocaleDateString('es-MX', { year: 'numeric', month: 'long', day: 'numeric' });

    let studentsListHtml = '';

    if (activeSubTab === 'MASTER') {
      studentsListHtml = filteredExpedientes.map((exp, idx) => `
        <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:10px; padding:12px; margin-bottom:12px; page-break-inside:avoid;">
          <div style="font-weight:bold; font-size:13px; color:#1e293b; margin-bottom:4px;">
            ${idx + 1}. ${exp.studentName} <span style="font-size:11px; color:#475569; background:#e2e8f0; padding:2px 8px; border-radius:12px;">Grado/Grupo: ${exp.gradeGroup || 'S/G'}</span>
          </div>
          <div style="font-size:11px; color:#334155; margin-bottom:6px;">
            <strong>Estatus:</strong> ${exp.status === 'CONCLUIDO' ? 'Caso Concluido' : 'En Proceso'} | <strong>Psicólogo:</strong> ${exp.psychologistName || 'Asignado'}
          </div>
          ${exp.reasonAndBackground ? `<div style="font-size:11px; color:#475569; margin-top:4px;"><strong>Motivo / Antecedentes:</strong> ${exp.reasonAndBackground}</div>` : ''}
          ${exp.psychologicalEvaluation ? `<div style="font-size:11px; color:#475569; margin-top:4px;"><strong>Evaluación Psicopedagógica:</strong> ${exp.psychologicalEvaluation}</div>` : ''}
          ${exp.latestProgress ? `<div style="font-size:11px; color:#1e293b; margin-top:4px; font-weight:600;"><strong>Avances Recientes:</strong> ${exp.latestProgress}</div>` : ''}
        </div>
      `).join('');
    } else if (selectedSharedReport) {
      studentsListHtml = (selectedSharedReport.studentsBreakdown || []).map((s, idx) => `
        <div style="background:#f8fafc; border:1px solid #cbd5e1; border-radius:10px; padding:12px; margin-bottom:12px; page-break-inside:avoid;">
          <div style="font-weight:bold; font-size:13px; color:#1e293b; margin-bottom:4px;">
            ${idx + 1}. ${s.studentName} <span style="font-size:11px; color:#475569; background:#e2e8f0; padding:2px 8px; border-radius:12px;">Grado/Grupo: ${s.gradeGroup || 'S/G'}</span>
          </div>
          ${s.reasonAndBackground ? `<div style="font-size:11px; color:#475569; margin-top:4px;"><strong>Motivo / Antecedentes:</strong> ${s.reasonAndBackground}</div>` : ''}
          ${s.teacherStrategies ? `<div style="font-size:11px; color:#475569; margin-top:4px;"><strong>Estrategias Docentes:</strong> ${s.teacherStrategies}</div>` : ''}
          ${s.psychologicalEvaluation ? `<div style="font-size:11px; color:#475569; margin-top:4px;"><strong>Evaluación Psicopedagógica:</strong> ${s.psychologicalEvaluation}</div>` : ''}
          ${s.latestProgress ? `<div style="font-size:11px; color:#1e293b; margin-top:4px; font-weight:600;"><strong>Avances Recientes:</strong> ${s.latestProgress}</div>` : ''}
        </div>
      `).join('');
    }

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
            <div class="section-title">Resumen Ejecutivo</div>
            <div class="content-box">${execSummary}</div>
          </div>

          ${conclusions ? `
            <div class="section">
              <div class="section-title">Conclusiones y Recomendaciones</div>
              <div class="content-box">${conclusions}</div>
            </div>
          ` : ''}

          <div class="section">
            <div class="section-title">Desglose de Expedientes (${activeSubTab === 'MASTER' ? filteredExpedientes.length : (selectedSharedReport?.studentsBreakdown?.length || 0)})</div>
            ${studentsListHtml || '<p style="color:#64748b; font-style:italic;">No hay alumnos registrados en el informe.</p>'}
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
    
    setEditableTitle('Informe de Canalizaciones y Seguimiento Psicopedagógico');
    setEditablePeriod(periodStr);
    setEditableSummary(autoExecutiveSummary);
    setEditableConclusions(autoConclusions);
    setEditableStudents(JSON.parse(JSON.stringify(masterStudentCards)));
    
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
      const selectedUsersData = allAvailableRecipients.filter(r => selectedRecipients.includes(r.email));

      // Process student breakdown based on flags
      const finalStudents: SharedReportStudentCard[] = editableStudents.map(st => ({
        ...st,
        studentName: anonymizeStudentNames ? getAnonymizedName(st.studentName) : st.studentName,
        psychologicalEvaluation: hidePsychEvaluation ? '[INFORMACIÓN RESERVADA DE EVALUACIÓN]' : st.psychologicalEvaluation,
        parentInterviews: hideParentInterviews ? '[INFORMACIÓN RESERVADA DE ENTREVISTAS]' : st.parentInterviews
      }));

      const sharedReportId = `rep_${Date.now()}`;
      const payload: SharedReport = {
        id: sharedReportId,
        title: editableTitle.trim() || 'Informe de Canalizaciones',
        period: editablePeriod.trim(),
        executiveSummary: editableSummary.trim(),
        conclusions: editableConclusions.trim(),
        studentsBreakdown: finalStudents,
        sharedBy: profile.name || 'Departamento de Psicología',
        sharedByEmail: profile.email,
        sharedAt: Date.now(),
        recipients: selectedUsersData
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
          `Informe: ${payload.title}. Destinatarios (${selectedRecipients.length}): ${selectedUsersData.map(u => `${u.name} (${u.roleLabel})`).join(', ')}`
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
            placeholder="Buscar por alumno, grado o motivo de canalización..."
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

            {/* Section 3: Desglose por Alumno Canalizado */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
                  <GraduationCap className="w-4 h-4 text-indigo-600" />
                  <span>2. Detalle y Acciones Realizadas por Alumno ({masterStudentCards.length})</span>
                </h3>
              </div>

              {masterStudentCards.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-dashed border-slate-300 text-slate-500 text-xs font-medium">
                  No se encontraron expedientes con los criterios seleccionados.
                </div>
              ) : (
                <div className="space-y-4">
                  {masterStudentCards.map((st, idx) => (
                    <div key={st.expedienteId || idx} className="bg-slate-50/80 border border-slate-200/90 rounded-2xl p-5 space-y-3 shadow-2xs hover:border-slate-300 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/80 pb-3">
                        <div>
                          <span className="text-[10px] font-extrabold text-indigo-600 uppercase tracking-wider">Alumno #{idx + 1}</span>
                          <h4 className="text-base font-bold text-slate-900">{st.studentName}</h4>
                          <p className="text-xs font-medium text-slate-500">Grado/Grupo: <strong className="text-slate-700">{st.gradeGroup}</strong></p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500">Solicitado por: <strong className="text-slate-700">{st.referredBy}</strong></span>
                          <span className={cn(
                            "px-2.5 py-1 rounded-full text-xs font-bold border",
                            st.status === 'CONCLUIDO' ? "bg-emerald-100 text-emerald-800 border-emerald-300" :
                            st.status === 'DERIVADO_EXTERNO' ? "bg-sky-100 text-sky-800 border-sky-300" :
                            "bg-amber-100 text-amber-800 border-amber-300"
                          )}>
                            {st.status === 'CONCLUIDO' ? 'Concluido' : st.status === 'DERIVADO_EXTERNO' ? 'Derivado Externo' : 'En Seguimiento'}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-1">
                          <span className="font-bold text-slate-800 flex items-center gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-600" /> Motivos y Antecedentes:
                          </span>
                          <p className="text-slate-600 whitespace-pre-line font-medium leading-relaxed">{st.reasonAndBackground}</p>
                        </div>

                        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-1">
                          <span className="font-bold text-slate-800 flex items-center gap-1.5">
                            <GraduationCap className="w-3.5 h-3.5 text-blue-600" /> Estrategias por Docentes:
                          </span>
                          <p className="text-slate-600 whitespace-pre-line font-medium leading-relaxed">{st.teacherStrategies}</p>
                        </div>

                        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-1">
                          <span className="font-bold text-slate-800 flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-sky-600" /> Entrevistas con Padres / Tutores:
                          </span>
                          <p className="text-slate-600 whitespace-pre-line font-medium leading-relaxed">{st.parentInterviews}</p>
                        </div>

                        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-1">
                          <span className="font-bold text-slate-800 flex items-center gap-1.5">
                            <BrainCircuit className="w-3.5 h-3.5 text-purple-600" /> Evaluación Psicopedagógica:
                          </span>
                          <p className="text-slate-600 whitespace-pre-line font-medium leading-relaxed">{st.psychologicalEvaluation}</p>
                        </div>

                        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-1">
                          <span className="font-bold text-slate-800 flex items-center gap-1.5">
                            <ClipboardList className="w-3.5 h-3.5 text-indigo-600" /> Seguimiento & Acuerdos Psicología:
                          </span>
                          <p className="text-slate-600 whitespace-pre-line font-medium leading-relaxed">{st.psychologyFollowUp}</p>
                        </div>

                        <div className="bg-white p-3.5 rounded-xl border border-slate-200/80 space-y-1">
                          <span className="font-bold text-slate-800 flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Últimos Avances Reportados:
                          </span>
                          <p className="text-slate-600 whitespace-pre-line font-medium leading-relaxed">{st.latestProgress}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
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

              {/* Student Breakdown Cards */}
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Detalle de Alumnos en Canalización ({selectedSharedReport.studentsBreakdown?.length || 0})
                </h3>

                <div className="space-y-4">
                  {selectedSharedReport.studentsBreakdown?.map((st, idx) => (
                    <div key={idx} className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <div>
                          <h4 className="font-bold text-slate-900 text-sm">{st.studentName}</h4>
                          <p className="text-xs text-slate-500 font-medium">Grado/Grupo: {st.gradeGroup}</p>
                        </div>
                        <span className="text-xs font-bold text-slate-600 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                          {st.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
                        <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1 font-mono">
                          <span className="font-bold text-slate-800">Motivos y Antecedentes:</span>
                          <p className="text-slate-700 leading-relaxed whitespace-pre-line">{st.reasonAndBackground}</p>
                        </div>
                        <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1 font-mono">
                          <span className="font-bold text-slate-800">Estrategias Docentes:</span>
                          <p className="text-slate-700 leading-relaxed whitespace-pre-line">{st.teacherStrategies}</p>
                        </div>
                        <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1 font-mono">
                          <span className="font-bold text-slate-800">Entrevistas con Padres:</span>
                          <p className="text-slate-700 leading-relaxed whitespace-pre-line">{st.parentInterviews}</p>
                        </div>
                        <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1 font-mono">
                          <span className="font-bold text-slate-800">Evaluación Psicopedagógica:</span>
                          <p className="text-slate-700 leading-relaxed whitespace-pre-line">{st.psychologicalEvaluation}</p>
                        </div>
                        <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1 font-mono">
                          <span className="font-bold text-slate-800">Seguimiento Psicología:</span>
                          <p className="text-slate-700 leading-relaxed whitespace-pre-line">{st.psychologyFollowUp}</p>
                        </div>
                        <div className="p-3 bg-white rounded-xl border border-slate-200 space-y-1 font-mono">
                          <span className="font-bold text-slate-800">Últimos Avances:</span>
                          <p className="text-slate-700 leading-relaxed whitespace-pre-line">{st.latestProgress}</p>
                        </div>
                      </div>
                    </div>
                  ))}
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

              {/* Redaction Controls & Toggles */}
              <div className="space-y-3 bg-amber-50/60 border border-amber-200/90 p-4 rounded-2xl">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <span className="text-xs font-bold text-amber-950 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    <span>2. Opciones de Privacidad y Censura en Copia Compartida</span>
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
                  <label className="flex items-center gap-2 p-2 bg-white rounded-xl border border-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={anonymizeStudentNames}
                      onChange={(e) => setAnonymizeStudentNames(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded"
                    />
                    <span className="font-semibold text-slate-800">Usar Iniciales de Alumnos</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 bg-white rounded-xl border border-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hidePsychEvaluation}
                      onChange={(e) => setHidePsychEvaluation(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded"
                    />
                    <span className="font-semibold text-slate-800">Ocultar Eval. Psicológicas</span>
                  </label>

                  <label className="flex items-center gap-2 p-2 bg-white rounded-xl border border-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hideParentInterviews}
                      onChange={(e) => setHideParentInterviews(e.target.checked)}
                      className="w-4 h-4 text-indigo-600 rounded"
                    />
                    <span className="font-semibold text-slate-800">Ocultar Entrevistas Padres</span>
                  </label>
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

              {/* Executive Summary Censorship */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Resumen Ejecutivo (Censura de Texto)
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

              {/* Student Cards Preview & Redaction */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                  Desglose de Alumnos en Canalización ({editableStudents.length})
                </label>

                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {editableStudents.map((st, idx) => (
                    <div key={idx} className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-2 text-xs">
                      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                        <span className="font-bold text-slate-900">
                          {anonymizeStudentNames ? getAnonymizedName(st.studentName) : st.studentName} ({st.gradeGroup})
                        </span>
                        <span className="text-[10px] font-extrabold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                          {st.status}
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 text-[11px]">
                        <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                          <strong>Motivos:</strong> {st.reasonAndBackground}
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                          <strong>Estrategias Docentes:</strong> {st.teacherStrategies}
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                          <strong>Entrevistas Padres:</strong> {hideParentInterviews ? '[INFORMACIÓN RESERVADA DE ENTREVISTAS]' : st.parentInterviews}
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                          <strong>Eval. Psicopedagógica:</strong> {hidePsychEvaluation ? '[INFORMACIÓN RESERVADA DE EVALUACIÓN]' : st.psychologicalEvaluation}
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                          <strong>Seguimiento Psicología:</strong> {st.psychologyFollowUp}
                        </div>
                        <div className="p-2 bg-white rounded-lg border border-slate-200 font-mono">
                          <strong>Últimos Avances:</strong> {st.latestProgress}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
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
