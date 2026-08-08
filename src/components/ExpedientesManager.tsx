import React, { useState, useEffect } from 'react';
import {
  FileText,
  Plus,
  Search,
  Paperclip,
  Users,
  Check,
  MessageSquare,
  Send,
  User,
  GraduationCap,
  Save,
  Link,
  Trash2,
  Edit,
  ArrowLeft,
  CheckCircle2,
  FolderHeart,
  Eye,
  EyeOff,
  Lock,
  ShieldAlert,
  X,
  RotateCcw
} from 'lucide-react';
import {
  Expediente,
  Referral,
  UserProfile,
  normalizeUserRole
} from '../types';
import { doc, setDoc, deleteDoc, collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { cn } from '../lib/utils';

interface ExpedientesManagerProps {
  expedientes: Expediente[];
  referrals: Referral[];
  profile: UserProfile;
  coordinators: UserProfile[];
  directives?: UserProfile[];
  addLog: (action: string, details?: string) => Promise<void>;
  sendNotification?: (userIdOrIds: string | string[], title: string, message: string, incidentId?: string, skipAdmins?: boolean) => Promise<void>;
  canManageExpedientes?: boolean;
  preselectedReferral?: Referral | null;
  onClearPreselectedReferral?: () => void;
}

export const ExpedientesManager: React.FC<ExpedientesManagerProps> = ({
  expedientes,
  referrals,
  profile,
  coordinators = [],
  directives = [],
  addLog,
  sendNotification,
  canManageExpedientes = true,
  preselectedReferral,
  onClearPreselectedReferral
}) => {
  const userRole = normalizeUserRole(profile.role);
  const isDirectiveOrCoordinator = userRole === 'DIRECTIVE' || userRole === 'COORDINATOR';
  const isPsychologist = userRole === 'PSYCHOLOGIST' || userRole === 'ADMIN' || (profile.role && String(profile.role).toLowerCase().includes('psico')) || (profile.role && String(profile.role).toLowerCase().includes('admin'));
  const allowManageExpedientes = canManageExpedientes && isPsychologist && !isDirectiveOrCoordinator;

  const [viewMode, setViewMode] = useState<'FORM' | 'LIST'>(preselectedReferral && allowManageExpedientes ? 'FORM' : (allowManageExpedientes ? 'FORM' : 'LIST'));
  const [editingExpedienteId, setEditingExpedienteId] = useState<string | null>(null);
  const [selectedLinkedReferralId, setSelectedLinkedReferralId] = useState<string>('');

  // Shared expedientes state
  const [sharedExpedientes, setSharedExpedientes] = useState<any[]>([]);
  const [selectedSharedExpediente, setSelectedSharedExpediente] = useState<any | null>(null);
  const [listTab, setListTab] = useState<'SHARED' | 'MASTER'>(isDirectiveOrCoordinator || !allowManageExpedientes ? 'SHARED' : 'MASTER');

  const [searchTerm, setSearchTerm] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [saveSuccessMessage, setSaveSuccessMessage] = useState(false);

  // Subscribe to shared_expedientes collection in Firestore
  useEffect(() => {
    const q = query(collection(db, 'shared_expedientes'), orderBy('sharedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docs = snapshot.docs.map(docSnap => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      setSharedExpedientes(docs);
    }, (err) => {
      console.warn("Notice loading shared_expedientes:", err);
    });
    return () => unsubscribe();
  }, []);

  // Form Data State
  const [formData, setFormData] = useState({
    studentName: '',
    gradeGroup: '',
    reasonAndBackground: '',
    teacherStrategies: '',
    parentInterviews: '',
    psychologicalEvaluation: '',
    attachmentName: '',
    attachmentData: '',
    psychologyFollowUp: '',
    latestProgress: ''
  });

  // Multiple Recipient Selection State (Requirement 3)
  const [selectedRecipients, setSelectedRecipients] = useState<string[]>([]);

  // Share / Redaction Modal State (Requirement 4)
  const [isShareModalOpen, setIsShareModalOpen] = useState(false);
  const [hiddenSections, setHiddenSections] = useState<string[]>([]);
  const [redactionMode, setRedactionMode] = useState<'editor' | 'words'>('editor');
  const textareaRefs = React.useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [sharedCopyData, setSharedCopyData] = useState({
    reasonAndBackground: '',
    teacherStrategies: '',
    parentInterviews: '',
    psychologicalEvaluation: '',
    psychologyFollowUp: '',
    latestProgress: ''
  });

  // Unique list of Coordinators and Directives
  const allAvailableRecipients = React.useMemo(() => {
    const list: { email: string; name: string; roleLabel: string; uid?: string }[] = [];
    const emailsSeen = new Set<string>();

    coordinators.forEach(c => {
      if (c.email && !emailsSeen.has(c.email.toLowerCase())) {
        emailsSeen.add(c.email.toLowerCase());
        list.push({ email: c.email, name: c.name || 'Coordinador', roleLabel: 'Coordinador', uid: c.uid });
      }
    });

    directives.forEach(d => {
      if (d.email && !emailsSeen.has(d.email.toLowerCase())) {
        emailsSeen.add(d.email.toLowerCase());
        list.push({ email: d.email, name: d.name || 'Directivo', roleLabel: 'Directivo', uid: d.uid });
      }
    });

    return list;
  }, [coordinators, directives]);

  // Handle preselected referral if passed
  useEffect(() => {
    if (preselectedReferral) {
      setViewMode('FORM');
      setSelectedLinkedReferralId(preselectedReferral.id);
      setFormData(prev => ({
        ...prev,
        studentName: preselectedReferral.studentName || '',
        gradeGroup: preselectedReferral.gradeGroup || '',
        reasonAndBackground: preselectedReferral.reasonAndBackground || '',
        teacherStrategies: preselectedReferral.teacherStrategies || ''
      }));
    }
  }, [preselectedReferral]);

  // Handle selecting linked referral
  const handleSelectLinkedReferral = (refId: string) => {
    setSelectedLinkedReferralId(refId);
    if (!refId) return;

    const ref = referrals.find(r => r.id === refId);
    if (ref) {
      setFormData(prev => ({
        ...prev,
        studentName: ref.studentName || prev.studentName,
        gradeGroup: ref.gradeGroup || prev.gradeGroup,
        reasonAndBackground: ref.reasonAndBackground || prev.reasonAndBackground,
        teacherStrategies: ref.teacherStrategies || prev.teacherStrategies
      }));
    }
  };

  const toggleRecipient = (email: string) => {
    setSelectedRecipients(prev => 
      prev.includes(email) ? prev.filter(e => e !== email) : [...prev, email]
    );
  };

  const toggleSelectAllCoordinators = () => {
    const coordEmails = allAvailableRecipients.filter(r => r.roleLabel === 'Coordinador').map(r => r.email);
    const allSelected = coordEmails.length > 0 && coordEmails.every(e => selectedRecipients.includes(e));
    if (allSelected) {
      setSelectedRecipients(prev => prev.filter(e => !coordEmails.includes(e)));
    } else {
      setSelectedRecipients(prev => Array.from(new Set([...prev, ...coordEmails])));
    }
  };

  const toggleSelectAllDirectives = () => {
    const dirEmails = allAvailableRecipients.filter(r => r.roleLabel === 'Directivo').map(r => r.email);
    const allSelected = dirEmails.length > 0 && dirEmails.every(e => selectedRecipients.includes(e));
    if (allSelected) {
      setSelectedRecipients(prev => prev.filter(e => !dirEmails.includes(e)));
    } else {
      setSelectedRecipients(prev => Array.from(new Set([...prev, ...dirEmails])));
    }
  };

  // Open Share / Redaction Modal
  const handleOpenShareModal = () => {
    if (!formData.studentName.trim() || !formData.reasonAndBackground.trim()) {
      alert('Por favor completa primero el Nombre del Alumno y los Motivos de la Ficha antes de preparar la copia compartida.');
      return;
    }
    if (selectedRecipients.length === 0) {
      alert('Por favor selecciona al menos un Coordinador o Directivo para compartir.');
      return;
    }

    // Initialize sharedCopyData with current formData
    setSharedCopyData({
      reasonAndBackground: formData.reasonAndBackground,
      teacherStrategies: formData.teacherStrategies,
      parentInterviews: formData.parentInterviews,
      psychologicalEvaluation: formData.psychologicalEvaluation,
      psychologyFollowUp: formData.psychologyFollowUp,
      latestProgress: formData.latestProgress
    });
    setHiddenSections([]);
    setIsShareModalOpen(true);
  };

  // Toggle hiding a section in shared copy
  const toggleHideSection = (sectionKey: string) => {
    setHiddenSections(prev =>
      prev.includes(sectionKey) ? prev.filter(k => k !== sectionKey) : [...prev, sectionKey]
    );
  };

  // Blackout text using black highlighter for selected words
  const applyBlackoutToSection = (sectionKey: keyof typeof sharedCopyData) => {
    const textarea = textareaRefs.current[sectionKey];
    const currentText = sharedCopyData[sectionKey] || formData[sectionKey] || '';
    if (!currentText.trim()) return;

    if (textarea && textarea.selectionStart !== undefined && textarea.selectionEnd !== undefined && textarea.selectionStart !== textarea.selectionEnd) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const selectedText = currentText.substring(start, end);
      const redactedSelection = selectedText.replace(/[^\s\n]/g, '█');
      const newText = currentText.substring(0, start) + redactedSelection + currentText.substring(end);
      setSharedCopyData(prev => ({ ...prev, [sectionKey]: newText }));
    } else {
      alert("🖍️ Marcatextos Negro: Por favor selecciona con el cursor o ratón las palabras específicas que deseas censurar en negro, o utiliza el modo '🖍️ Marcatextos (Un Toque)' para marcar palabras directamente.");
    }
  };

  // Toggle word blackout on touch/click
  const toggleWordRedaction = (sectionKey: keyof typeof sharedCopyData, tokenIdx: number) => {
    const origText = formData[sectionKey] || '';
    const currentText = sharedCopyData[sectionKey] || origText;

    const origTokens = origText.match(/(\S+|\s+)/g) || [];
    const currTokens = currentText.match(/(\S+|\s+)/g) || [];

    if (tokenIdx < 0 || tokenIdx >= currTokens.length) return;

    const currToken = currTokens[tokenIdx];
    const origToken = origTokens[tokenIdx] || currToken;

    const isRedacted = /^█+$/.test(currToken.trim());

    if (isRedacted) {
      currTokens[tokenIdx] = origToken;
    } else {
      currTokens[tokenIdx] = origToken.replace(/[^\s\n]/g, '█');
    }

    const updatedText = currTokens.join('');
    setSharedCopyData(prev => ({ ...prev, [sectionKey]: updatedText }));
  };

  // Restore section to original
  const restoreSectionText = (sectionKey: keyof typeof sharedCopyData) => {
    setSharedCopyData(prev => ({ ...prev, [sectionKey]: formData[sectionKey] || '' }));
  };

  // Save / Update Master Expediente
  const handleSaveExpediente = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!formData.studentName.trim() || !formData.reasonAndBackground.trim()) {
      alert('Por favor completa el Nombre del Alumno y Motivos de la Ficha.');
      return;
    }

    // If user selected recipients but clicked "Guardar Cambios" directly, prompt them to open share modal
    if (selectedRecipients.length > 0 && !isShareModalOpen) {
      if (confirm(`Has seleccionado ${selectedRecipients.length} destinatario(s). ¿Deseas abrir la vista para preparar y censurar la copia compartida antes de enviar?`)) {
        handleOpenShareModal();
        return;
      }
    }

    setIsSubmitting(true);
    setSaveSuccessMessage(false);
    try {
      const id = editingExpedienteId || 'exp_' + Date.now();

      const payload: Expediente = {
        id,
        studentName: formData.studentName.trim(),
        gradeGroup: formData.gradeGroup.trim(),
        linkedReferralId: selectedLinkedReferralId || undefined,
        reasonAndBackground: formData.reasonAndBackground.trim(),
        teacherStrategies: formData.teacherStrategies.trim(),
        parentInterviews: formData.parentInterviews.trim(),
        psychologicalEvaluation: formData.psychologicalEvaluation.trim(),
        attachmentName: formData.attachmentName || undefined,
        attachmentData: formData.attachmentData || undefined,
        psychologyFollowUp: formData.psychologyFollowUp.trim(),
        latestProgress: formData.latestProgress.trim(),
        psychologistId: profile.uid || profile.email,
        psychologistName: profile.name || 'Psicólogo Escolar',
        psychologistEmail: profile.email,
        createdAt: editingExpedienteId ? (expedientes.find(e => e.id === editingExpedienteId)?.createdAt || Date.now()) : Date.now(),
        updatedAt: Date.now()
      };

      await setDoc(doc(db, 'expedientes', id), payload, { merge: true });

      await addLog(
        editingExpedienteId ? 'Actualización de Expediente' : 'Nuevo Expediente Psicopedagógico',
        `Se ${editingExpedienteId ? 'actualizó' : 'creó'} la ficha psicopedagógica para ${payload.studentName}.`
      );

      setSaveSuccessMessage(true);
      setTimeout(() => setSaveSuccessMessage(false), 4000);

      alert(`✅ Expediente maestro ${editingExpedienteId ? 'actualizado' : 'guardado'} exitosamente en la base de datos.`);
      setViewMode('LIST');
      resetForm();
    } catch (err) {
      console.error("Error saving expediente:", err);
      alert("Error al guardar el expediente.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Confirm and Send Shared Copy (Requirement 4)
  const handleConfirmAndSendSharedCopy = async () => {
    setIsSubmitting(true);
    try {
      const id = editingExpedienteId || 'exp_' + Date.now();

      // 1. Save Master Unredacted Expediente in Firestore
      const masterPayload: Expediente = {
        id,
        studentName: formData.studentName.trim(),
        gradeGroup: formData.gradeGroup.trim(),
        linkedReferralId: selectedLinkedReferralId || undefined,
        reasonAndBackground: formData.reasonAndBackground.trim(),
        teacherStrategies: formData.teacherStrategies.trim(),
        parentInterviews: formData.parentInterviews.trim(),
        psychologicalEvaluation: formData.psychologicalEvaluation.trim(),
        attachmentName: formData.attachmentName || undefined,
        attachmentData: formData.attachmentData || undefined,
        psychologyFollowUp: formData.psychologyFollowUp.trim(),
        latestProgress: formData.latestProgress.trim(),
        psychologistId: profile.uid || profile.email,
        psychologistName: profile.name || 'Psicólogo Escolar',
        psychologistEmail: profile.email,
        createdAt: editingExpedienteId ? (expedientes.find(e => e.id === editingExpedienteId)?.createdAt || Date.now()) : Date.now(),
        updatedAt: Date.now()
      };

      await setDoc(doc(db, 'expedientes', id), masterPayload, { merge: true });

      // 2. Prepare Shared Copy Payload
      const selectedUsersData = allAvailableRecipients.filter(r => selectedRecipients.includes(r.email));
      
      const sharedCopyPayload = {
        expedienteId: id,
        studentName: formData.studentName.trim(),
        gradeGroup: formData.gradeGroup.trim(),
        reasonAndBackground: hiddenSections.includes('reasonAndBackground') ? '[INFORMACIÓN RESERVADA / OCULTA]' : sharedCopyData.reasonAndBackground,
        teacherStrategies: hiddenSections.includes('teacherStrategies') ? '[INFORMACIÓN RESERVADA / OCULTA]' : sharedCopyData.teacherStrategies,
        parentInterviews: hiddenSections.includes('parentInterviews') ? '[INFORMACIÓN RESERVADA / OCULTA]' : sharedCopyData.parentInterviews,
        psychologicalEvaluation: hiddenSections.includes('psychologicalEvaluation') ? '[INFORMACIÓN RESERVADA / OCULTA]' : sharedCopyData.psychologicalEvaluation,
        psychologyFollowUp: hiddenSections.includes('psychologyFollowUp') ? '[INFORMACIÓN RESERVADA / OCULTA]' : sharedCopyData.psychologyFollowUp,
        latestProgress: hiddenSections.includes('latestProgress') ? '[INFORMACIÓN RESERVADA / OCULTA]' : sharedCopyData.latestProgress,
        sharedBy: profile.name || 'Psicología',
        sharedByEmail: profile.email,
        sharedAt: Date.now(),
        recipients: selectedUsersData
      };

      // Store in shared_expedientes collection
      const sharedDocId = `shared_${id}_${Date.now()}`;
      await setDoc(doc(db, 'shared_expedientes', sharedDocId), sharedCopyPayload, { merge: true });

      // 3. Send system notification to selected recipients
      if (sendNotification) {
        const recipientUids = selectedUsersData.map(u => u.uid).filter(Boolean) as string[];
        const recipientEmails = selectedUsersData.map(u => u.email);
        const targets = recipientUids.length > 0 ? recipientUids : recipientEmails;

        await sendNotification(
          targets,
          `📄 Ficha de Expediente Compartida: ${formData.studentName}`,
          `${profile.name} te ha compartido los avances del expediente psicopedagógico de ${formData.studentName} (${formData.gradeGroup}).`,
          id
        );
      }

      await addLog(
        'Envío de copia compartida de expediente',
        `Alumno: ${formData.studentName}. Destinatarios (${selectedRecipients.length}): ${selectedUsersData.map(u => `${u.name} (${u.roleLabel})`).join(', ')}`
      );

      alert(`✅ ¡Copia compartida enviada con éxito a ${selectedRecipients.length} usuario(s) seleccionado(s)!\n\nEl expediente original en la base de datos se guardó completo sin sufrir modificaciones.`);
      setIsShareModalOpen(false);
      setViewMode('LIST');
      resetForm();
    } catch (err) {
      console.error("Error sending shared copy:", err);
      alert("Error al enviar la copia compartida.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Reset form
  const resetForm = () => {
    setEditingExpedienteId(null);
    setSelectedLinkedReferralId('');
    setSelectedRecipients([]);
    setFormData({
      studentName: '',
      gradeGroup: '',
      reasonAndBackground: '',
      teacherStrategies: '',
      parentInterviews: '',
      psychologicalEvaluation: '',
      attachmentName: '',
      attachmentData: '',
      psychologyFollowUp: '',
      latestProgress: ''
    });
    if (onClearPreselectedReferral) onClearPreselectedReferral();
  };

  // Edit existing expediente
  const handleEditExpediente = (exp: Expediente) => {
    setEditingExpedienteId(exp.id);
    setSelectedLinkedReferralId(exp.linkedReferralId || '');
    setFormData({
      studentName: exp.studentName || '',
      gradeGroup: exp.gradeGroup || '',
      reasonAndBackground: exp.reasonAndBackground || '',
      teacherStrategies: exp.teacherStrategies || '',
      parentInterviews: exp.parentInterviews || '',
      psychologicalEvaluation: exp.psychologicalEvaluation || '',
      attachmentName: exp.attachmentName || '',
      attachmentData: exp.attachmentData || '',
      psychologyFollowUp: exp.psychologyFollowUp || '',
      latestProgress: exp.latestProgress || ''
    });
    setSelectedRecipients([]);
    setViewMode('FORM');
  };

  // Delete expediente
  const handleDeleteExpediente = async (id: string, studentName: string) => {
    if (!confirm(`¿Estás seguro de eliminar el expediente de ${studentName}?`)) return;
    try {
      await deleteDoc(doc(db, 'expedientes', id));
      await addLog('Eliminación de Expediente', `Se eliminó la ficha psicopedagógica de ${studentName}.`);
      alert('Expediente eliminado correctamente.');
    } catch (e) {
      console.error("Error deleting expediente:", e);
      alert("Error al eliminar el expediente.");
    }
  };

  // Delete shared expediente
  const handleDeleteSharedExpediente = async (id: string, studentName: string) => {
    if (!confirm(`¿Estás seguro de eliminar la copia compartida de ${studentName}?`)) return;
    try {
      await deleteDoc(doc(db, 'shared_expedientes', id));
      await addLog('Eliminación de Copia Compartida', `Se eliminó la copia de expediente para ${studentName}.`);
      alert('Copia compartida eliminada correctamente.');
    } catch (e) {
      console.error("Error deleting shared expediente:", e);
      alert("Error al eliminar la copia compartida.");
    }
  };

  // File Attachment handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1024 * 1024) {
        alert("El archivo excede el tamaño máximo permitido de 1MB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = (uploadEvent) => {
        setFormData(prev => ({
          ...prev,
          attachmentName: file.name,
          attachmentData: uploadEvent.target?.result as string
        }));
      };
      reader.readAsDataURL(file);
    }
  };

  const filteredExpedientes = expedientes.filter(exp => {
    const term = searchTerm.toLowerCase();
    return (
      exp.studentName?.toLowerCase().includes(term) ||
      exp.gradeGroup?.toLowerCase().includes(term) ||
      exp.psychologistName?.toLowerCase().includes(term)
    );
  });

  const filteredSharedExpedientes = sharedExpedientes.filter(exp => {
    const term = searchTerm.toLowerCase();
    return (
      exp.studentName?.toLowerCase().includes(term) ||
      exp.gradeGroup?.toLowerCase().includes(term) ||
      exp.sharedBy?.toLowerCase().includes(term)
    );
  });

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center justify-center text-indigo-600 flex-shrink-0">
            <GraduationCap className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Expedientes Psicopedagógicos</h1>
            <p className="text-xs text-slate-500">Gestión de fichas clínicas, acuerdos, avances e informes confidenciales</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {viewMode === 'LIST' ? (
            allowManageExpedientes && (
              <button
                type="button"
                onClick={() => { resetForm(); setViewMode('FORM'); }}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>+ Abrir Nuevo Expediente</span>
              </button>
            )
          ) : (
            <button
              type="button"
              onClick={() => { setViewMode('LIST'); resetForm(); }}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Volver a la Lista</span>
            </button>
          )}
        </div>
      </div>

      {/* FORM VIEW */}
      {viewMode === 'FORM' && allowManageExpedientes && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-indigo-600" />
                {editingExpedienteId ? 'Editar Ficha Psicopedagógica' : 'Nueva Ficha Psicopedagógica de Alumno'}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Completa la información del estudiante y las observaciones del departamento</p>
            </div>
            {saveSuccessMessage && (
              <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 flex items-center gap-1.5 animate-pulse">
                <CheckCircle2 className="w-4 h-4" /> ¡Guardado correctamente!
              </span>
            )}
          </div>

          <form onSubmit={handleSaveExpediente} className="p-6 space-y-6">
            {/* Section 1: ALUMNO Y VINCULACIÓN */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-slate-50/70 rounded-2xl border border-slate-100">
              <div className="md:col-span-1 space-y-1">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  VINCULAR CANALIZACIÓN EXISTENTE (OPCIONAL)
                </label>
                <select
                  value={selectedLinkedReferralId}
                  onChange={(e) => handleSelectLinkedReferral(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                >
                  <option value="">-- Sin vincular --</option>
                  {referrals.map(r => (
                    <option key={r.id} value={r.id}>
                      {r.studentName} ({r.gradeGroup}) - Sugerido por {r.teacherName}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-1 space-y-1">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  NOMBRE COMPLETO DEL ALUMNO *
                </label>
                <input
                  type="text"
                  required
                  value={formData.studentName}
                  onChange={(e) => setFormData({ ...formData, studentName: e.target.value })}
                  placeholder="Ej. Juan Carlos López Pérez"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <div className="md:col-span-1 space-y-1">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  GRADO Y GRUPO / NIVEL
                </label>
                <input
                  type="text"
                  value={formData.gradeGroup}
                  onChange={(e) => setFormData({ ...formData, gradeGroup: e.target.value })}
                  placeholder="Ej. 2º A Primaria"
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>
            </div>

            {/* Section 2: MOTIVOS Y ANTECEDENTES */}
            <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-2">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-600" />
                MOTIVOS DE LA CANALIZACIÓN Y ANTECEDENTES *
              </label>
              <textarea
                rows={3}
                required
                value={formData.reasonAndBackground}
                onChange={(e) => setFormData({ ...formData, reasonAndBackground: e.target.value })}
                placeholder="Describe brevemente los motivos por los cuales el alumno requiere atención psicopedagógica..."
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed"
              />
            </div>

            {/* Section 3: ESTRATEGIAS DOCENTES */}
            <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-2">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Users className="w-4 h-4 text-indigo-600" />
                ESTRATEGIAS PREVIAS APLICADAS POR DOCENTES
              </label>
              <textarea
                rows={3}
                value={formData.teacherStrategies}
                onChange={(e) => setFormData({ ...formData, teacherStrategies: e.target.value })}
                placeholder="Indica las estrategias o adaptaciones previas implementadas en el aula por los maestros..."
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed"
              />
            </div>

            {/* Section 4: ENTREVISTAS PADRES */}
            <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-2">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <User className="w-4 h-4 text-indigo-600" />
                ENTREVISTAS Y ACUERDOS CON PADRES DE FAMILIA
              </label>
              <textarea
                rows={3}
                value={formData.parentInterviews}
                onChange={(e) => setFormData({ ...formData, parentInterviews: e.target.value })}
                placeholder="Resumen de entrevistas sostenidas con tutores, firmas de compromiso y citatorios..."
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed"
              />
            </div>

            {/* Section 5: EVALUACIÓN PSICOLÓGICA */}
            <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-2">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-indigo-600" />
                EVALUACIÓN Y DIAGNÓSTICO PSICOPEDAGÓGICO
              </label>
              <textarea
                rows={3}
                value={formData.psychologicalEvaluation}
                onChange={(e) => setFormData({ ...formData, psychologicalEvaluation: e.target.value })}
                placeholder="Resultados de pruebas psicométricas, observaciones conductuales o diagnósticos clínicos..."
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed"
              />
            </div>

            {/* Section 6: ADJUNTO DE DOCUMENTOS */}
            <div className="p-5 bg-slate-50/80 border border-slate-200 rounded-2xl space-y-3">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <Paperclip className="w-4 h-4 text-indigo-600" />
                DOCUMENTOS ADJUNTOS / PRUEBAS (MÁX. 1MB)
              </label>
              <div className="flex items-center gap-3">
                <label className="px-4 py-2.5 bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs rounded-xl border border-slate-200 shadow-sm cursor-pointer transition-all flex items-center gap-2">
                  <Paperclip className="w-4 h-4 text-indigo-600" />
                  <span>Seleccionar Archivo</span>
                  <input type="file" onChange={handleFileChange} className="hidden" accept="image/*,.pdf,.doc,.docx" />
                </label>
                {formData.attachmentName ? (
                  <span className="text-xs font-bold text-indigo-700 bg-indigo-50 px-3 py-1.5 rounded-lg border border-indigo-100 flex items-center gap-1.5">
                    📎 {formData.attachmentName}
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">Sin archivo adjunto</span>
                )}
              </div>
            </div>

            {/* Section 7: SEGUIMIENTO Y ACUERDOS DE PSICOLOGÍA */}
            <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-2">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-indigo-600" />
                SEGUIMIENTO Y ACUERDOS DE PSICOLOGÍA
              </label>
              <textarea
                rows={3}
                value={formData.psychologyFollowUp}
                onChange={(e) => setFormData({ ...formData, psychologyFollowUp: e.target.value })}
                placeholder="Detalla el seguimiento periódico y acuerdos alcanzados con el alumno..."
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed"
              />
            </div>

            {/* Section 8: ÚLTIMOS AVANCES REPORTADOS */}
            <div className="p-5 bg-white border border-slate-200 rounded-2xl space-y-2">
              <label className="block text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-indigo-600" />
                ÚLTIMOS AVANCES REPORTADOS
              </label>
              <textarea
                rows={3}
                value={formData.latestProgress}
                onChange={(e) => setFormData({ ...formData, latestProgress: e.target.value })}
                placeholder="Indica el estado actual de los avances logrados..."
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed"
              />
            </div>

            {/* Section 9: ACCIONES DE GUARDADO Y ENVÍO DE AVANCES (Requirements 3 & 4) */}
            <div className="p-6 bg-slate-50 border border-slate-200 rounded-2xl space-y-5">
              <div className="flex items-center justify-between border-b border-slate-200 pb-3">
                <div className="flex items-center gap-2 text-xs font-bold text-indigo-900 uppercase tracking-wider">
                  <Send className="w-4 h-4 text-indigo-600" />
                  ACCIONES DE GUARDADO Y ENVÍO DE AVANCES
                </div>
                {selectedRecipients.length > 0 && (
                  <span className="text-xs font-extrabold text-indigo-700 bg-indigo-100 px-3 py-1 rounded-full border border-indigo-200">
                    {selectedRecipients.length} Destinatario(s) Seleccionado(s)
                  </span>
                )}
              </div>

              {/* Multi-recipient selection list for Coordinators and Directives (Requirement 3) */}
              <div className="space-y-3">
                <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
                  COMPARTIR / NOTIFICAR A COORDINADORES Y DIRECTIVOS (PUEDES ELEGIR MÁS DE UNO)
                </label>

                {allAvailableRecipients.length === 0 ? (
                  <p className="text-xs text-slate-500 italic bg-white p-3 rounded-xl border border-slate-200">
                    No se encontraron usuarios registrados con rol de Coordinador o Directivo.
                  </p>
                ) : (
                  <div className="space-y-4 bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                    {/* Coordinators Section */}
                    {allAvailableRecipients.some(r => r.roleLabel === 'Coordinador') && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                          <span className="text-[11px] font-extrabold text-indigo-900 uppercase tracking-wider flex items-center gap-1.5">
                            <Users className="w-3.5 h-3.5 text-indigo-600" /> Coordinadores
                          </span>
                          <button
                            type="button"
                            onClick={toggleSelectAllCoordinators}
                            className="text-[11px] font-bold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                          >
                            Seleccionar / Deseleccionar Todos
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {allAvailableRecipients.filter(r => r.roleLabel === 'Coordinador').map(c => {
                            const isSelected = selectedRecipients.includes(c.email);
                            return (
                              <label
                                key={c.email}
                                onClick={() => toggleRecipient(c.email)}
                                className={cn(
                                  "flex items-center gap-2.5 p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer select-none",
                                  isSelected 
                                    ? "bg-indigo-50 border-indigo-300 text-indigo-900 shadow-sm"
                                    : "bg-slate-50/80 border-slate-200 text-slate-700 hover:bg-slate-100"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {}} // handled by container
                                  className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                                />
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate font-bold">{c.name}</span>
                                  <span className="text-[10px] text-slate-500 truncate">{c.email}</span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Directives Section */}
                    {allAvailableRecipients.some(r => r.roleLabel === 'Directivo') && (
                      <div className="space-y-2 pt-2 border-t border-slate-100">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                          <span className="text-[11px] font-extrabold text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                            <GraduationCap className="w-3.5 h-3.5 text-amber-600" /> Directivos
                          </span>
                          <button
                            type="button"
                            onClick={toggleSelectAllDirectives}
                            className="text-[11px] font-bold text-amber-600 hover:text-amber-800 cursor-pointer"
                          >
                            Seleccionar / Deseleccionar Todos
                          </button>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                          {allAvailableRecipients.filter(r => r.roleLabel === 'Directivo').map(d => {
                            const isSelected = selectedRecipients.includes(d.email);
                            return (
                              <label
                                key={d.email}
                                onClick={() => toggleRecipient(d.email)}
                                className={cn(
                                  "flex items-center gap-2.5 p-2.5 rounded-xl border text-xs font-semibold transition-all cursor-pointer select-none",
                                  isSelected 
                                    ? "bg-amber-50 border-amber-300 text-amber-900 shadow-sm"
                                    : "bg-slate-50/80 border-slate-200 text-slate-700 hover:bg-slate-100"
                                )}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => {}}
                                  className="w-4 h-4 text-amber-600 rounded border-slate-300 focus:ring-amber-500"
                                />
                                <div className="flex flex-col min-w-0">
                                  <span className="truncate font-bold">{d.name}</span>
                                  <span className="text-[10px] text-slate-500 truncate">{d.email}</span>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Requirement 4: Button to prepare/censor shared copy if recipients selected */}
              {selectedRecipients.length > 0 && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                    <ShieldAlert className="w-4 h-4 text-amber-600" />
                    <span>Preparar Copia Compartida Personalizada / Censurada ({selectedRecipients.length} destinatario(s))</span>
                  </div>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Al dar clic a continuación, se abrirá la vista de edición/censura donde podrás <strong>marcar en negro, ocultar o redactar</strong> información confidencial que no desees compartir. El expediente original NO sufrirá modificaciones.
                  </p>
                  <button
                    type="button"
                    onClick={handleOpenShareModal}
                    className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-extrabold text-xs rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
                  >
                    <Lock className="w-4 h-4" />
                    <span>Preparar / Censurar y Enviar Copia Compartida</span>
                  </button>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex justify-end pt-2 gap-3">
                <button
                  type="button"
                  onClick={() => handleSaveExpediente()}
                  disabled={isSubmitting}
                  className="px-8 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  <span>Guardar Cambios de Expediente Maestro</span>
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* SHARE / REDACTION MODAL (Requirement 4) */}
      {isShareModalOpen && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden my-auto">
            {/* Modal Header */}
            <div className="p-6 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-500/20 text-amber-400 rounded-xl border border-amber-500/30">
                  <Lock className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    Edición y Censura para Copia Compartida
                  </h3>
                  <p className="text-xs text-slate-300">
                    Alumno: <strong className="text-white">{formData.studentName}</strong> ({formData.gradeGroup || 'S/G'})
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsShareModalOpen(false)}
                className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Recipients summary banner */}
            <div className="p-4 bg-amber-50 border-b border-amber-100 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                <Users className="w-4 h-4 text-amber-600" />
                <span>Destinatarios ({selectedRecipients.length}):</span>
                <div className="flex flex-wrap gap-1.5 ml-1">
                  {allAvailableRecipients.filter(r => selectedRecipients.includes(r.email)).map(u => (
                    <span key={u.email} className="px-2 py-0.5 bg-white text-amber-900 border border-amber-200 rounded-md text-[11px] font-bold">
                      {u.name} ({u.roleLabel})
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Explanation Notice */}
            <div className="px-6 py-3 bg-slate-100 border-b border-slate-200 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
              <div>
                💡 <strong>Nota Importante:</strong> Toda modificación, censura o sección ocultada en esta ventana afectará <u>únicamente</u> a la copia enviada.
              </div>
              <div className="flex items-center gap-1 bg-slate-200/80 p-1 rounded-xl">
                <button
                  type="button"
                  onClick={() => setRedactionMode('words')}
                  className={cn(
                    "px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border",
                    redactionMode === 'words' ? "bg-slate-900 text-white border-slate-900 shadow-xs" : "text-slate-600 border-transparent hover:text-slate-900"
                  )}
                >
                  <span>🖍️ Marcatextos Negro (Un Toque)</span>
                </button>
                <button
                  type="button"
                  onClick={() => setRedactionMode('editor')}
                  className={cn(
                    "px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer border",
                    redactionMode === 'editor' ? "bg-white text-indigo-900 border-slate-300 shadow-xs" : "text-slate-600 border-transparent hover:text-slate-900"
                  )}
                >
                  <span>✏️ Editor y Selección Libre</span>
                </button>
              </div>
            </div>

            {/* Modal Body: Interactive Section Editors */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {[
                { key: 'reasonAndBackground' as const, label: 'Motivos de Canalización y Antecedentes', icon: <MessageSquare className="w-4 h-4 text-indigo-600" /> },
                { key: 'teacherStrategies' as const, label: 'Estrategias Previas Aplicadas por Docentes', icon: <Users className="w-4 h-4 text-indigo-600" /> },
                { key: 'parentInterviews' as const, label: 'Entrevistas y Acuerdos con Padres de Familia', icon: <User className="w-4 h-4 text-indigo-600" /> },
                { key: 'psychologicalEvaluation' as const, label: 'Evaluación y Diagnóstico Psicopedagógico', icon: <GraduationCap className="w-4 h-4 text-indigo-600" /> },
                { key: 'psychologyFollowUp' as const, label: 'Seguimiento y Acuerdos de Psicología', icon: <CheckCircle2 className="w-4 h-4 text-indigo-600" /> },
                { key: 'latestProgress' as const, label: 'Últimos Avances Reportados', icon: <MessageSquare className="w-4 h-4 text-indigo-600" /> }
              ].map(sec => {
                const isHidden = hiddenSections.includes(sec.key);
                const currentVal = sharedCopyData[sec.key];

                return (
                  <div key={sec.key} className={cn("p-4 rounded-2xl border transition-all space-y-3", isHidden ? "bg-slate-100 border-slate-300 opacity-75" : "bg-white border-slate-200 shadow-sm")}>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
                      <label className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                        {sec.icon}
                        <span>{sec.label}</span>
                      </label>

                      <div className="flex items-center gap-2">
                        {/* Toggle Hide whole section */}
                        <button
                          type="button"
                          onClick={() => toggleHideSection(sec.key)}
                          className={cn(
                            "px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer border",
                            isHidden 
                              ? "bg-slate-200 text-slate-700 border-slate-300" 
                              : "bg-rose-50 text-rose-700 hover:bg-rose-100 border-rose-200"
                          )}
                        >
                          {isHidden ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                          <span>{isHidden ? 'Mostrar Sección' : 'Ocultar Sección Completa'}</span>
                        </button>

                        {!isHidden && (
                          <>
                            {/* Blackout button */}
                            <button
                              type="button"
                              onClick={() => applyBlackoutToSection(sec.key)}
                              className="px-3 py-1 bg-slate-900 hover:bg-black text-white rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-sm"
                              title="Marca en negro únicamente el texto o palabras seleccionadas con el cursor"
                            >
                              <span>🖍️ Marcatextos Negro (Censurar Selección)</span>
                            </button>

                            {/* Restore Original */}
                            <button
                              type="button"
                              onClick={() => restoreSectionText(sec.key)}
                              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer"
                              title="Restaura el texto original"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {isHidden ? (
                      <div className="p-3 bg-slate-200/80 rounded-xl text-xs font-bold text-slate-600 text-center italic border border-slate-300">
                        🙈 Esta sección estará completamente oculta para los destinatarios de la copia compartida.
                      </div>
                    ) : redactionMode === 'words' ? (
                      <div className="space-y-2">
                        <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs leading-relaxed flex flex-wrap items-center gap-1.5 select-none min-h-[80px]">
                          {(currentVal.match(/(\S+|\s+)/g) || []).map((token, tokenIdx) => {
                            const isWhitespace = /^\s+$/.test(token);
                            if (isWhitespace) {
                              return <span key={tokenIdx} className="whitespace-pre">{token}</span>;
                            }
                            const isRedacted = /^█+$/.test(token.trim());
                            return (
                              <button
                                key={tokenIdx}
                                type="button"
                                onClick={() => toggleWordRedaction(sec.key, tokenIdx)}
                                className={cn(
                                  "px-1.5 py-0.5 rounded transition-all cursor-pointer font-mono font-bold text-xs border shadow-2xs",
                                  isRedacted
                                    ? "bg-slate-950 text-slate-950 border-black shadow-inner"
                                    : "bg-white text-slate-900 border-slate-300 hover:bg-amber-100 hover:border-amber-400"
                                )}
                                title={isRedacted ? "Toca para revelar palabra" : "Toca para marcar palabra en negro"}
                              >
                                {token}
                              </button>
                            );
                          })}
                          {(!currentVal || !currentVal.trim()) && (
                            <span className="text-slate-400 italic font-sans text-xs">Sin texto registrado en esta sección.</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-500 font-medium">
                          🖍️ <strong>Marcatextos de Color Negro:</strong> Haz clic o toca directamente cualquier palabra para ocultarla en negro (█) o revertirla al instante.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <textarea
                          ref={(el) => { textareaRefs.current[sec.key] = el; }}
                          rows={3}
                          value={currentVal}
                          onChange={(e) => setSharedCopyData({ ...sharedCopyData, [sec.key]: e.target.value })}
                          placeholder="Edita o redacta el contenido para la copia compartida..."
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-900 focus:bg-white focus:ring-2 focus:ring-indigo-500 focus:outline-none leading-relaxed font-mono"
                        />
                        <p className="text-[10px] text-slate-500 font-medium">
                          💡 Selecciona con el cursor las palabras exactas que deseas ocultar y presiona <strong>"🖍️ Marcatextos Negro"</strong> arriba para censurarlas.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Modal Footer */}
            <div className="p-6 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setIsShareModalOpen(false)}
                className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-800 font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={handleConfirmAndSendSharedCopy}
                disabled={isSubmitting}
                className="px-8 py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs rounded-xl shadow-lg shadow-emerald-200 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
                <span>Confirmar y Enviar Copia Compartida ({selectedRecipients.length})</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* LIST VIEW */}
      {viewMode === 'LIST' && (
        <div className="space-y-4">
          {/* Sub-tabs Selection */}
          <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
            <button
              type="button"
              onClick={() => setListTab('SHARED')}
              className={cn(
                "px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer",
                listTab === 'SHARED'
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              )}
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Expedientes Compartidos ({sharedExpedientes.length})</span>
            </button>

            {allowManageExpedientes && (
              <button
                type="button"
                onClick={() => setListTab('MASTER')}
                className={cn(
                  "px-4 py-2 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer",
                  listTab === 'MASTER'
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                )}
              >
                <FolderHeart className="w-3.5 h-3.5" />
                <span>Fichas Maestras ({expedientes.length})</span>
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="w-5 h-5 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por alumno, grado o remitente..."
              className="w-full pl-12 pr-4 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
            />
          </div>

          {listTab === 'SHARED' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredSharedExpedientes.length === 0 ? (
                <div className="col-span-full p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
                  <Lock className="w-12 h-12 text-slate-300 mx-auto" />
                  <h3 className="text-base font-bold text-slate-700">No hay expedientes compartidos</h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Los expedientes y avances psicopedagógicos que comparta el área de Psicología aparecerán guardados en este apartado.
                  </p>
                </div>
              ) : (
                filteredSharedExpedientes.map(exp => (
                  <div key={exp.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3 hover:border-indigo-200 transition-all">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-md flex items-center gap-1">
                        <Lock className="w-3 h-3" /> Copia Compartida ({exp.gradeGroup || 'S/G'})
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {exp.sharedAt ? new Date(exp.sharedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-base font-bold text-slate-900">{exp.studentName}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        <strong>Compartido por:</strong> {exp.sharedBy || 'Psicología'}
                      </p>
                    </div>

                    <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100 line-clamp-2">
                      <strong>Motivo:</strong> {exp.reasonAndBackground || 'Sin antecedentes registrados.'}
                    </div>

                    {exp.recipients && exp.recipients.length > 0 && (
                      <div className="text-[11px] text-slate-400 flex items-center gap-1 truncate">
                        <Users className="w-3 h-3 text-slate-400 flex-shrink-0" />
                        <span className="truncate">Para: {exp.recipients.map((r: any) => r.name).join(', ')}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => setSelectedSharedExpediente(exp)}
                        className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer shadow-sm"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Ver Expediente Compartido</span>
                      </button>

                      {allowManageExpedientes && (
                        <button
                          type="button"
                          onClick={() => handleDeleteSharedExpediente(exp.id, exp.studentName)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredExpedientes.length === 0 ? (
                <div className="col-span-full p-12 text-center bg-white rounded-2xl border border-slate-200 space-y-3">
                  <FolderHeart className="w-12 h-12 text-slate-300 mx-auto" />
                  <h3 className="text-base font-bold text-slate-700">No hay expedientes registrados</h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    Haz clic en "+ Abrir Expediente" para crear una nueva ficha psicopedagógica o vincular una canalización existente.
                  </p>
                </div>
              ) : (
                filteredExpedientes.map(exp => (
                  <div key={exp.id} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3 hover:border-indigo-200 transition-all">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                      <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-md">
                        {exp.gradeGroup || 'Ficha Psicopedagógica'}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {new Date(exp.updatedAt || exp.createdAt).toLocaleDateString('es-MX')}
                      </span>
                    </div>

                    <div>
                      <h3 className="text-base font-bold text-slate-900">{exp.studentName}</h3>
                      <p className="text-xs text-slate-500 mt-0.5">
                        <strong>Psicólogo:</strong> {exp.psychologistName}
                      </p>
                    </div>

                    <div className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100 line-clamp-2">
                      <strong>Motivo:</strong> {exp.reasonAndBackground}
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                      <button
                        type="button"
                        onClick={() => handleEditExpediente(exp)}
                        className="px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold rounded-lg transition-all flex items-center gap-1 cursor-pointer"
                      >
                        <Edit className="w-3.5 h-3.5" />
                        <span>{allowManageExpedientes ? 'Ver / Editar Ficha' : 'Ver Ficha'}</span>
                      </button>

                      {allowManageExpedientes && (
                        <button
                          type="button"
                          onClick={() => handleDeleteExpediente(exp.id, exp.studentName)}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* DETAIL MODAL FOR SHARED EXPEDIENTE */}
      {selectedSharedExpediente && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden my-auto">
            {/* Modal Header */}
            <div className="p-6 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
                  <GraduationCap className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    {selectedSharedExpediente.studentName}
                  </h3>
                  <p className="text-xs text-slate-300">
                    Grado/Grupo: <strong className="text-white">{selectedSharedExpediente.gradeGroup || 'S/G'}</strong> • Compartido por: <strong className="text-white">{selectedSharedExpediente.sharedBy}</strong>
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedSharedExpediente(null)}
                className="p-2 hover:bg-slate-800 text-slate-400 hover:text-white rounded-xl transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 text-slate-800 text-xs">
              <div className="flex items-center justify-between bg-emerald-50 p-3 rounded-2xl border border-emerald-200 text-emerald-900">
                <div className="flex items-center gap-2">
                  <Lock className="w-4 h-4 text-emerald-600" />
                  <span className="font-bold">Copia de Expediente Compartido por Psicología</span>
                </div>
                <span className="text-[11px] font-medium text-emerald-700">
                  {selectedSharedExpediente.sharedAt ? new Date(selectedSharedExpediente.sharedAt).toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                </span>
              </div>

              {/* Reason & Background */}
              <div className="space-y-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5 uppercase text-[11px]">
                  <FileText className="w-3.5 h-3.5 text-indigo-600" /> Motivo de Canalización y Antecedentes
                </h4>
                <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {selectedSharedExpediente.reasonAndBackground || 'Sin información registrada.'}
                </p>
              </div>

              {/* Teacher Strategies */}
              <div className="space-y-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5 uppercase text-[11px]">
                  <Users className="w-3.5 h-3.5 text-indigo-600" /> Estrategias Utilizadas por el Docente
                </h4>
                <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {selectedSharedExpediente.teacherStrategies || 'Sin información registrada.'}
                </p>
              </div>

              {/* Parent Interviews */}
              <div className="space-y-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5 uppercase text-[11px]">
                  <User className="w-3.5 h-3.5 text-indigo-600" /> Entrevistas con Padres de Familia
                </h4>
                <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {selectedSharedExpediente.parentInterviews || 'Sin información registrada.'}
                </p>
              </div>

              {/* Psychological Evaluation */}
              <div className="space-y-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5 uppercase text-[11px]">
                  <GraduationCap className="w-3.5 h-3.5 text-indigo-600" /> Evaluación Psicopedagógica
                </h4>
                <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {selectedSharedExpediente.psychologicalEvaluation || 'Sin información registrada.'}
                </p>
              </div>

              {/* Psychology FollowUp */}
              <div className="space-y-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5 uppercase text-[11px]">
                  <MessageSquare className="w-3.5 h-3.5 text-indigo-600" /> Seguimiento del Área de Psicología
                </h4>
                <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {selectedSharedExpediente.psychologyFollowUp || 'Sin información registrada.'}
                </p>
              </div>

              {/* Latest Progress */}
              <div className="space-y-1.5 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                <h4 className="font-bold text-slate-900 flex items-center gap-1.5 uppercase text-[11px]">
                  <CheckCircle2 className="w-3.5 h-3.5 text-indigo-600" /> Avances y Acuerdos Recientes
                </h4>
                <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">
                  {selectedSharedExpediente.latestProgress || 'Sin información registrada.'}
                </p>
              </div>

              {/* File Attachment */}
              {selectedSharedExpediente.attachmentData && (
                <div className="space-y-1.5 bg-indigo-50/50 p-4 rounded-2xl border border-indigo-100">
                  <h4 className="font-bold text-indigo-900 flex items-center gap-1.5 uppercase text-[11px]">
                    <Paperclip className="w-3.5 h-3.5 text-indigo-600" /> Documento / Expediente Adjunto
                  </h4>
                  <a
                    href={selectedSharedExpediente.attachmentData}
                    download={selectedSharedExpediente.attachmentName || `Expediente_${selectedSharedExpediente.studentName}.pdf`}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-sm transition-all text-xs"
                  >
                    <Paperclip className="w-4 h-4" />
                    <span>Descargar {selectedSharedExpediente.attachmentName || 'Archivo Adjunto'}</span>
                  </a>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedSharedExpediente(null)}
                className="px-6 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-xl transition-all cursor-pointer"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
