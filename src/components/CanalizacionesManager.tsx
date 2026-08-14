import React, { useState, useEffect } from 'react';
import {
  Search,
  Plus,
  ChevronDown,
  ChevronUp,
  FileText,
  BookOpen,
  Globe,
  Calendar,
  User,
  Send,
  X,
  CheckCircle2,
  BrainCircuit
} from 'lucide-react';
import {
  Referral,
  UserProfile,
  normalizeUserRole
} from '../types';
import { SystemModal, SystemModalState } from './SystemModal';
import { doc, setDoc, updateDoc, addDoc, collection } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';

interface CanalizacionesManagerProps {
  referrals: Referral[];
  profile: UserProfile;
  coordinators: UserProfile[];
  psychologists: UserProfile[];
  directives?: UserProfile[];
  teachers?: UserProfile[];
  addLog: (action: string, details?: string) => Promise<void>;
  isSuperAdmin?: boolean;
  canCreateReferral?: boolean;
  canManageExpedientes?: boolean;
  canAddFollowUp?: boolean;
  onOpenExpedienteFromReferral?: (referral: Referral) => void;
  highlightedReferralId?: string | null;
  sendNotification?: (userIdOrIds: string | string[], title: string, message: string, incidentId?: string, skipAdmins?: boolean, extraData?: Record<string, any>) => Promise<void>;
}

export const CanalizacionesManager: React.FC<CanalizacionesManagerProps> = ({
  referrals,
  profile,
  coordinators,
  psychologists,
  directives = [],
  teachers = [],
  addLog,
  isSuperAdmin,
  canCreateReferral = true,
  canManageExpedientes = true,
  canAddFollowUp = true,
  onOpenExpedienteFromReferral,
  highlightedReferralId,
  sendNotification
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [expandedCardIds, setExpandedCardIds] = useState<Record<string, boolean>>({});

  const [sysModal, setSysModal] = useState<SystemModalState>({
    isOpen: false,
    title: '',
    message: '',
    type: 'info'
  });

  const showAlert = (title: string, message: string, type: 'success' | 'error' | 'warning' | 'info' = 'info') => {
    setSysModal({ isOpen: true, title, message, type });
  };

  // Effect to auto-expand and scroll to highlighted referral when redirected from notifications
  useEffect(() => {
    if (highlightedReferralId) {
      // Find matching target referral
      const targetRef = referrals.find(r => r.id === highlightedReferralId || r.incidentId === highlightedReferralId || (r.id && highlightedReferralId.includes(r.id)));
      const targetId = targetRef ? targetRef.id : highlightedReferralId;

      setExpandedCardIds(prev => ({ ...prev, [targetId]: true }));

      if (targetRef && searchTerm) {
        setSearchTerm('');
      }

      const timer = setTimeout(() => {
        const el = document.getElementById(`referral-card-${targetId}`) || document.getElementById(`referral-card-${highlightedReferralId}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 200);

      return () => clearTimeout(timer);
    }
  }, [highlightedReferralId, referrals]);

  // Psicólogo comment state map
  const [editingComments, setEditingComments] = useState<Record<string, string>>({});
  const [savingCommentId, setSavingCommentId] = useState<string | null>(null);
  const [saveSuccessId, setSaveSuccessId] = useState<string | null>(null);

  // Helper to determine the linked coordinator
  const getLinkedCoordinatorEmail = () => {
    const linked = coordinators.find(c =>
      (profile.assignedCoordinatorId && c.uid === profile.assignedCoordinatorId) ||
      (profile.assignedCoordinatorEmail && c.email?.toLowerCase() === profile.assignedCoordinatorEmail?.toLowerCase()) ||
      (profile.assignedCoordinatorName && c.name === profile.assignedCoordinatorName)
    );
    if (linked) return linked.email;
    if (profile.role === 'COORDINATOR') {
      const selfCoord = coordinators.find(c => c.uid === profile.uid || c.email?.toLowerCase() === profile.email?.toLowerCase());
      if (selfCoord) return selfCoord.email;
    }
    return profile.assignedCoordinatorEmail || (coordinators[0]?.email || '');
  };

  // New Referral form state
  const [formData, setFormData] = useState({
    studentName: '',
    gradeGroup: '',
    coordinatorEmail: getLinkedCoordinatorEmail(),
    additionalRecipients: [] as { uid?: string; email: string; name: string; role: string }[],
    psychologistEmail: profile.assignedPsychologistEmail || (psychologists[0]?.email || ''),
    reasonAndBackground: '',
    teacherStrategies: ''
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isModalOpen) {
      const defaultCoord = getLinkedCoordinatorEmail();
      const defaultPsych = profile.assignedPsychologistEmail || (psychologists[0]?.email || '');
      setFormData(prev => ({
        ...prev,
        coordinatorEmail: prev.coordinatorEmail || defaultCoord,
        psychologistEmail: prev.psychologistEmail || defaultPsych
      }));
    }
  }, [isModalOpen, profile, coordinators, psychologists]);

  // Toggle card details
  const toggleDetails = (id: string) => {
    setExpandedCardIds(prev => ({
      ...prev,
      [id]: prev[id] === undefined ? false : !prev[id]
    }));
  };

  const isDetailsExpanded = (id: string) => {
    return expandedCardIds[id] !== false; // Default expanded
  };

  // Filter referrals
  const filteredReferrals = referrals.filter(ref => {
    const term = searchTerm.toLowerCase();
    const matchesTerm = (
      ref.studentName?.toLowerCase().includes(term) ||
      ref.gradeGroup?.toLowerCase().includes(term) ||
      ref.teacherName?.toLowerCase().includes(term) ||
      ref.psychologistName?.toLowerCase().includes(term) ||
      ref.coordinatorName?.toLowerCase().includes(term)
    );

    if (!matchesTerm) return false;

    // Filter by assigned psychologist if current user is a psychologist
    if (profile.role === 'PSYCHOLOGIST' && !isSuperAdmin) {
      const userEmail = profile.email.toLowerCase();
      const userUid = profile.uid;
      // If there's only 1 psychologist in total, show all
      if (psychologists.length <= 1) return true;

      // Otherwise match assigned psychologist email/ID or unassigned
      const isAssignedToMe = 
        (ref.psychologistEmail && ref.psychologistEmail.toLowerCase() === userEmail) ||
        (ref.psychologistId && ref.psychologistId === userUid) ||
        (!ref.psychologistEmail && !ref.psychologistId);
      return isAssignedToMe;
    }

    return true;
  });

  // Handle create referral
  const handleCreateReferral = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.studentName.trim() || !formData.reasonAndBackground.trim()) {
      showAlert('Campos obligatorios', 'Por favor completa los campos obligatorios (*)', 'info');
      return;
    }

    setIsSubmitting(true);
    try {
      const id = 'ref_' + Date.now();
      const selectedCoord = coordinators.find(c => c.email === formData.coordinatorEmail);
      const selectedPsych = psychologists.find(p => p.email === formData.psychologistEmail);

      const newRef: Referral = {
        id,
        studentName: formData.studentName.trim(),
        gradeGroup: formData.gradeGroup.trim() || 'S/G',
        teacherId: profile.uid || profile.email,
        teacherName: profile.name || 'Docente',
        teacherEmail: profile.email,
        coordinatorId: selectedCoord?.uid,
        coordinatorName: selectedCoord?.name || 'Coordinador General',
        coordinatorEmail: selectedCoord?.email || formData.coordinatorEmail,
        psychologistId: selectedPsych?.uid,
        psychologistName: selectedPsych?.name || (psychologists[0]?.name || 'Psicólogo Escolar'),
        psychologistEmail: selectedPsych?.email || (psychologists[0]?.email || formData.psychologistEmail),
        reasonAndBackground: formData.reasonAndBackground.trim(),
        teacherStrategies: formData.teacherStrategies.trim(),
        psychologistComment: '',
        additionalRecipients: formData.additionalRecipients,
        status: 'PENDIENTE',
        createdAt: Date.now()
      };

      await setDoc(doc(db, 'referrals', id), newRef);
      await addLog('Nueva Canalización', `Se canalizó al alumno ${newRef.studentName} (${newRef.gradeGroup}) a Psicología.`);

      // Send in-app and email notifications
      if (sendNotification) {
        const targetRecipients: string[] = [];
        if (selectedCoord?.uid) targetRecipients.push(selectedCoord.uid);
        else if (selectedCoord?.email) targetRecipients.push(selectedCoord.email.toLowerCase());

        if (selectedPsych?.uid) targetRecipients.push(selectedPsych.uid);
        else if (selectedPsych?.email) targetRecipients.push(selectedPsych.email.toLowerCase());

        formData.additionalRecipients.forEach(r => {
          if (r.uid) targetRecipients.push(r.uid);
          else if (r.email) targetRecipients.push(r.email.toLowerCase());
        });

        await sendNotification(
          targetRecipients,
          'Nueva Canalización Psicopedagógica',
          `Se ha registrado una canalización para el estudiante "${newRef.studentName}" (${newRef.gradeGroup}) por ${profile.name}.`,
          '',
          false,
          { 
            referralId: id, 
            type: 'referral',
            detailsHtml: `<strong>Estudiante:</strong> ${newRef.studentName} (${newRef.gradeGroup})<br/><strong>Remitido por:</strong> ${profile.name}<br/><strong>Motivo:</strong> ${newRef.reasonAndBackground}`
          }
        );
      }

      setIsModalOpen(false);
      setFormData({
        studentName: '',
        gradeGroup: '',
        coordinatorEmail: getLinkedCoordinatorEmail(),
        additionalRecipients: [],
        psychologistEmail: profile.assignedPsychologistEmail || (psychologists[0]?.email || ''),
        reasonAndBackground: '',
        teacherStrategies: ''
      });
      showAlert('Canalización enviada', 'Canalización enviada con éxito.', 'success');
    } catch (err) {
      console.error("Error creating referral:", err);
      showAlert('Error', "Error al enviar la canalización.", 'error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Save psychologist comment
  const handleSavePsychologistComment = async (ref: Referral) => {
    if (!isPsychologistUser) {
      showAlert('Acceso Restringido', 'Únicamente el usuario psicólogo puede realizar o modificar comentarios en canalizaciones.', 'warning');
      return;
    }
    const commentVal = editingComments[ref.id] !== undefined ? editingComments[ref.id] : (ref.psychologistComment || '');
    setSavingCommentId(ref.id);
    try {
      await updateDoc(doc(db, 'referrals', ref.id), {
        psychologistComment: commentVal,
        status: commentVal.trim() ? 'EN_VALORACION' : ref.status,
        updatedAt: Date.now()
      });

      if (ref.incidentId) {
        try {
          await updateDoc(doc(db, 'incidents', ref.incidentId), {
            referralComments: commentVal
          });
        } catch (e) {
          console.error("Error updating linked incident referralComments:", e);
        }
      }

      await addLog(
        'Respuesta de Psicología en Canalización',
        `El psicólogo actualizó el comentario para la canalización de ${ref.studentName}: "${commentVal.slice(0, 50)}..."`
      );

      // Requirement 1: Notify the teacher who submitted referral and the assigned coordinator
      const recipientUids = new Set<string>();

      // Teacher who submitted
      if (ref.teacherId) recipientUids.add(ref.teacherId);
      if (ref.teacherEmail && teachers) {
        const tObj = teachers.find(t => t.email?.toLowerCase() === ref.teacherEmail?.toLowerCase());
        if (tObj?.uid) recipientUids.add(tObj.uid);
      }

      // Assigned Coordinator
      if (ref.coordinatorId) recipientUids.add(ref.coordinatorId);
      if (ref.coordinatorEmail && coordinators) {
        const cObj = coordinators.find(c => c.email?.toLowerCase() === ref.coordinatorEmail?.toLowerCase());
        if (cObj?.uid) recipientUids.add(cObj.uid);
      }

      const notifTitle = 'Comentario del Psicólogo en Canalización';
      const notifMessage = `El área de Psicología (${profile.name}) ha publicado un comentario para la canalización del alumno "${ref.studentName}": "${commentVal.slice(0, 80)}${commentVal.length > 80 ? '...' : ''}"`;

      if (sendNotification) {
        await sendNotification(
          Array.from(recipientUids),
          notifTitle,
          notifMessage,
          ref.incidentId || '',
          false, // skipAdmins = false so directives & admins receive it too
          { referralId: ref.id, type: 'referral' }
        );
      } else {
        for (const uid of recipientUids) {
          try {
            await addDoc(collection(db, 'notifications'), {
              title: notifTitle,
              message: notifMessage,
              date: new Date().toLocaleDateString('es-MX'),
              read: false,
              createdAt: Date.now(),
              userId: uid,
              referralId: ref.id,
              type: 'referral'
            });
          } catch (e) {
            console.error("Error creating notification:", e);
          }
        }
      }

      // Send emails to teacher and coordinator if available
      const recipientEmails = new Set<string>();
      if (ref.teacherEmail) recipientEmails.add(ref.teacherEmail);
      if (ref.coordinatorEmail) recipientEmails.add(ref.coordinatorEmail);

      for (const email of recipientEmails) {
        try {
          await fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: email,
              subject: `💬 Comentario de Psicología: Canalización de ${ref.studentName}`,
              html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden;">
                  <div style="background-color: #4f46e5; padding: 20px; text-align: center;">
                    <h2 style="color: white; margin: 0; font-size: 18px;">💬 Comentario de Psicología</h2>
                  </div>
                  <div style="padding: 24px; color: #1e293b; line-height: 1.6;">
                    <p>El área de psicología (<strong>${profile.name || 'Psicología'}</strong>) ha publicado un comentario para la canalización del alumno <strong>${ref.studentName}</strong>:</p>
                    <div style="background-color: #f8fafc; border-left: 4px solid #4f46e5; padding: 16px; border-radius: 8px; margin: 20px 0;">
                      <p style="margin: 0; font-style: italic; color: #334155;">"${commentVal}"</p>
                    </div>
                    <p style="font-size: 13px; color: #64748b;">Ingresa a la plataforma para consultar el seguimiento completo.</p>
                  </div>
                </div>
              `
            })
          });
        } catch (e) {
          console.error("Error sending comment email:", e);
        }
      }

      setSaveSuccessId(ref.id);
      setTimeout(() => setSaveSuccessId(null), 3000);
    } catch (err) {
      console.error("Error saving psychologist comment:", err);
      showAlert('Error', "Error al guardar el comentario.", 'error');
    } finally {
      setSavingCommentId(null);
    }
  };

  const normRole = normalizeUserRole(profile.role);
  const isPsychologistUser = normRole === 'PSYCHOLOGIST' || (profile.role && String(profile.role).toLowerCase().includes('psico'));
  const allowCreateReferral = canCreateReferral && normRole !== 'COORDINATOR' && normRole !== 'DIRECTIVE';

  return (
    <div className="space-y-6">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 flex-shrink-0">
            <BrainCircuit className="w-6 h-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              Canalizaciones Psicopedagógicas
            </h1>
            <p className="text-xs text-slate-500 font-medium mt-0.5">
              Control y comunicación de alumnos dirigidos a psicología
            </p>
          </div>
        </div>

        {allowCreateReferral && (
          <button
            type="button"
            onClick={() => {
              // Pre-select only psychologist if only 1 exists
              const defaultPsychEmail = profile.assignedPsychologistEmail || (psychologists.length === 1 ? psychologists[0].email : (psychologists[0]?.email || ''));
              const defaultCoordEmail = profile.assignedCoordinatorEmail || (coordinators[0]?.email || '');
              setFormData(prev => ({
                ...prev,
                psychologistEmail: defaultPsychEmail,
                coordinatorEmail: defaultCoordEmail
              }));
              setIsModalOpen(true);
            }}
            className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Nueva Canalización</span>
          </button>
        )}
      </div>

      {/* Search Bar */}
      <div className="relative">
        <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Buscar por alumno, grado, docente o especialista asignado..."
          className="w-full pl-12 pr-4 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all shadow-sm"
        />
      </div>

      {/* Counter Banner */}
      <div className="flex items-center justify-between text-xs font-bold text-slate-500 uppercase tracking-wider px-1">
        <span>MOSTRANDO {filteredReferrals.length} DE {referrals.length} CANALIZACIONES</span>
      </div>

      {/* Referral Cards List */}
      <div className="space-y-4">
        {filteredReferrals.length === 0 ? (
          <div className="p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
            <BrainCircuit className="w-12 h-12 text-slate-300 mx-auto" />
            <h3 className="text-base font-bold text-slate-700">No hay canalizaciones registradas</h3>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              Utiliza el botón "+ Nueva Canalización" para derivar un alumno al área de psicología y dar seguimiento.
            </p>
          </div>
        ) : (
          filteredReferrals.map((ref) => {
            const expanded = isDetailsExpanded(ref.id);
            const currentCommentVal = editingComments[ref.id] !== undefined ? editingComments[ref.id] : (ref.psychologistComment || '');
            const isHighlighted = highlightedReferralId && (
              ref.id === highlightedReferralId ||
              ref.incidentId === highlightedReferralId ||
              (ref.id && highlightedReferralId.includes(ref.id))
            );

            return (
              <div
                key={ref.id}
                id={`referral-card-${ref.id}`}
                className={cn(
                  "bg-white rounded-2xl border p-6 space-y-4 transition-all hover:border-indigo-200",
                  isHighlighted 
                    ? "ring-2 ring-indigo-500 border-indigo-500 bg-indigo-50/30 shadow-lg shadow-indigo-100/50" 
                    : "border-slate-200/90 shadow-sm"
                )}
              >
                {/* Header Row */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-100 font-extrabold text-xs rounded-lg uppercase">
                      {ref.gradeGroup || 'S/G'}
                    </span>
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
                      <Calendar className="w-3.5 h-3.5" />
                      <span>{new Date(ref.createdAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {onOpenExpedienteFromReferral && canManageExpedientes && (
                      <button
                        type="button"
                        onClick={() => onOpenExpedienteFromReferral(ref)}
                        className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        <span>Abrir / Vincular Expediente</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleDetails(ref.id)}
                      className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer px-2 py-1 rounded-lg hover:bg-slate-100 transition-all"
                    >
                      <span>{expanded ? 'Ocultar detalles' : 'Ver detalles'}</span>
                      {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Student Name */}
                <div className="space-y-1">
                  <h2 className="text-xl font-bold text-slate-900 tracking-tight">
                    {ref.studentName}
                  </h2>
                  <div className="text-xs text-slate-600 flex items-center gap-x-6 gap-y-1 flex-wrap font-medium">
                    <span>
                      <strong className="text-slate-800">Docente:</strong> {ref.teacherName}
                    </span>
                    <span>
                      <strong className="text-slate-800">Coordinador:</strong> {ref.coordinatorName || 'Coordinador General'}
                    </span>
                    <span>
                      <strong className="text-slate-800">Psicólogo:</strong> {ref.psychologistName || 'Psicólogo Escolar'}
                    </span>
                  </div>
                  {ref.additionalRecipients && ref.additionalRecipients.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1 text-xs">
                      <span className="font-bold text-slate-500">Copia a:</span>
                      {ref.additionalRecipients.map((rec, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 border border-slate-200 text-slate-700 text-[11px] font-medium rounded-md">
                          <span className="font-bold text-indigo-700 uppercase text-[9px]">{rec.role}:</span> {rec.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Expanded Details Sections */}
                {expanded && (
                  <div className="space-y-3 pt-2">
                    {/* Section 1: Motivo de la Canalización y Antecedentes */}
                    <div className="border border-slate-300 rounded-xl p-4 bg-white space-y-1.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <FileText className="w-4 h-4 text-slate-400" />
                        <span>MOTIVO DE LA CANALIZACIÓN Y ANTECEDENTES</span>
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {ref.reasonAndBackground}
                      </p>
                    </div>

                    {/* Section 2: Estrategias Utilizadas por el Docente */}
                    <div className="border border-slate-300 rounded-xl p-4 bg-white space-y-1.5">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <BookOpen className="w-4 h-4 text-slate-400" />
                        <span>ESTRATEGIAS UTILIZADAS POR EL DOCENTE</span>
                      </div>
                      <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">
                        {ref.teacherStrategies || 'No se registraron estrategias previas.'}
                      </p>
                    </div>

                    {/* Section 3: Comentario del Psicólogo */}
                    <div className="border border-slate-300 rounded-xl p-4 bg-indigo-50/20 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 text-xs font-bold text-indigo-800 uppercase tracking-wider">
                          <Globe className="w-4 h-4 text-indigo-600" />
                          <span>COMENTARIO DEL PSICÓLOGO</span>
                        </div>
                        {saveSuccessId === ref.id && (
                          <span className="text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> ¡Guardado!
                          </span>
                        )}
                      </div>

                      {isPsychologistUser ? (
                        <div className="space-y-2">
                          <textarea
                            rows={3}
                            value={currentCommentVal}
                            onChange={(e) => setEditingComments({ ...editingComments, [ref.id]: e.target.value })}
                            placeholder="Escribe un comentario de respuesta o valoración..."
                            className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={() => handleSavePsychologistComment(ref)}
                              disabled={savingCommentId === ref.id}
                              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-sm"
                            >
                              {savingCommentId === ref.id ? (
                                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                              ) : (
                                <Send className="w-3.5 h-3.5" />
                              )}
                              <span>Guardar y Enviar</span>
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white border border-slate-200 rounded-xl p-3 min-h-[44px] flex items-center">
                          <p className="text-xs text-slate-800 font-medium">
                            {ref.psychologistComment || <span className="text-slate-400 italic">En espera de respuesta o valoración por parte de psicología...</span>}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Modal: Nueva Canalización */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-6 space-y-6 my-8 border border-slate-100">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center font-bold">
                  <BrainCircuit className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Nueva Solicitud de Canalización</h2>
                  <p className="text-xs text-slate-500">Derivación de alumno al departamento de psicopedagogía</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-2 rounded-xl hover:bg-slate-100 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateReferral} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Nombre del Alumno *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.studentName}
                    onChange={(e) => setFormData({ ...formData, studentName: e.target.value })}
                    placeholder="Ej. Juan López"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Grado y Grupo *
                  </label>
                  <input
                    type="text"
                    required
                    value={formData.gradeGroup}
                    onChange={(e) => setFormData({ ...formData, gradeGroup: e.target.value })}
                    placeholder="Ej. 6TO B, 1° A"
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Coordinador Asignado *
                  </label>
                  {(() => {
                    const activeCoord = coordinators.find(c => c.email === formData.coordinatorEmail) || coordinators.find(c =>
                      (profile.assignedCoordinatorId && c.uid === profile.assignedCoordinatorId) ||
                      (profile.assignedCoordinatorEmail && c.email?.toLowerCase() === profile.assignedCoordinatorEmail?.toLowerCase()) ||
                      (profile.assignedCoordinatorName && c.name === profile.assignedCoordinatorName)
                    ) || coordinators[0];

                    return (
                      <div className="w-full px-3.5 py-2.5 bg-slate-100 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-800 flex items-center justify-between select-none cursor-not-allowed">
                        <div className="flex items-center gap-2 truncate">
                          <User className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                          <span className="truncate">
                            {activeCoord?.name || 'Coordinación General'} {activeCoord?.email ? `(${activeCoord.email})` : ''}
                          </span>
                        </div>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-white px-2 py-0.5 rounded border border-slate-200 flex-shrink-0 ml-1">
                          Predeterminado
                        </span>
                      </div>
                    );
                  })()}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Psicólogo Asignado *
                  </label>
                  <select
                    value={formData.psychologistEmail}
                    onChange={(e) => setFormData({ ...formData, psychologistEmail: e.target.value })}
                    className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  >
                    {psychologists.length === 0 ? (
                      <option value="">Psicólogo Escolar</option>
                    ) : (
                      psychologists.map(p => (
                        <option key={p.uid || p.email} value={p.email}>
                          {p.name} ({p.email})
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>

              {/* Destinatarios adicionales: Coordinador, Directivo o Docente */}
              <div className="space-y-2 pt-1">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Agregar a otro Coordinador, Directivo o Docente (Opcional)
                </label>

                {formData.additionalRecipients.length > 0 && (
                  <div className="flex flex-wrap gap-2 p-2.5 bg-slate-50 border border-slate-200 rounded-xl">
                    {formData.additionalRecipients.map((rec, idx) => (
                      <span
                        key={rec.email + idx}
                        className="inline-flex items-center gap-1.5 px-3 py-1 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-800 shadow-sm"
                      >
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 uppercase">
                          {rec.role}
                        </span>
                        <span>{rec.name}</span>
                        <button
                          type="button"
                          onClick={() => {
                            setFormData({
                              ...formData,
                              additionalRecipients: formData.additionalRecipients.filter((_, i) => i !== idx)
                            });
                          }}
                          className="text-slate-400 hover:text-red-600 transition-colors cursor-pointer ml-1"
                          title="Remover destinatario"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <select
                  value=""
                  onChange={(e) => {
                    const selectedVal = e.target.value;
                    if (!selectedVal) return;
                    const [roleType, uidOrEmail] = selectedVal.split('::');
                    let found: UserProfile | undefined;
                    let roleLabel = 'Coordinador';

                    if (roleType === 'coord') {
                      found = coordinators.find(c => c.uid === uidOrEmail || c.email === uidOrEmail);
                      roleLabel = 'Coordinador';
                    } else if (roleType === 'dir') {
                      found = directives.find(d => d.uid === uidOrEmail || d.email === uidOrEmail);
                      roleLabel = 'Directivo';
                    } else if (roleType === 'teach') {
                      found = teachers.find(t => t.uid === uidOrEmail || t.email === uidOrEmail);
                      roleLabel = 'Docente';
                    }

                    if (found && found.email) {
                      if (!formData.additionalRecipients.some(r => r.email === found?.email)) {
                        setFormData({
                          ...formData,
                          additionalRecipients: [
                            ...formData.additionalRecipients,
                            {
                              uid: found.uid,
                              email: found.email,
                              name: found.name || found.email,
                              role: roleLabel
                            }
                          ]
                        });
                      }
                    }
                  }}
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-800 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value="">-- Seleccionar otro destinatario (Coordinador, Directivo o Docente) --</option>
                  
                  {coordinators.filter(c => c.email !== formData.coordinatorEmail).length > 0 && (
                    <optgroup label="Coordinadores">
                      {coordinators
                        .filter(c => c.email !== formData.coordinatorEmail)
                        .map(c => (
                          <option key={`coord::${c.uid || c.email}`} value={`coord::${c.uid || c.email}`}>
                            Coordinador: {c.name} ({c.email})
                          </option>
                        ))}
                    </optgroup>
                  )}

                  {directives.length > 0 && (
                    <optgroup label="Directivos">
                      {directives.map(d => (
                        <option key={`dir::${d.uid || d.email}`} value={`dir::${d.uid || d.email}`}>
                          Directivo: {d.name} ({d.email})
                        </option>
                      ))}
                    </optgroup>
                  )}

                  {teachers.length > 0 && (
                    <optgroup label="Docentes">
                      {teachers.map(t => (
                        <option key={`teach::${t.uid || t.email}`} value={`teach::${t.uid || t.email}`}>
                          Docente: {t.name} ({t.email})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Motivo de la Canalización y Antecedentes *
                </label>
                <textarea
                  required
                  rows={4}
                  value={formData.reasonAndBackground}
                  onChange={(e) => setFormData({ ...formData, reasonAndBackground: e.target.value })}
                  placeholder="Describe la situación observada en el alumno, reacciones emocionales o eventos relevantes..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                  Estrategias Utilizadas por el Docente
                </label>
                <textarea
                  rows={3}
                  value={formData.teacherStrategies}
                  onChange={(e) => setFormData({ ...formData, teacherStrategies: e.target.value })}
                  placeholder="Medidas de intervención previas, llamadas a padres, acuerdos en aula..."
                  className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-xl transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Send className="w-4 h-4" />
                  )}
                  <span>Enviar Canalización</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <SystemModal
        modal={sysModal}
        onClose={() => setSysModal(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  );
};
