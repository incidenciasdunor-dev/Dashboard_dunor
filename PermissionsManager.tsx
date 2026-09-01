import React, { useState } from 'react';
import { 
  Shield, ShieldCheck, Check, X, Search, RotateCcw, Save, AlertCircle, 
  Eye, Plus, Edit2, Trash2, Users, FileText, Bell, Settings, History, 
  GraduationCap, ClipboardList, Send, Brain, Key, Lock, CheckSquare, Square, RefreshCw, BarChart2
} from 'lucide-react';
import { UserRole, RolePermissions, RolePermissionsMap, DEFAULT_ROLE_PERMISSIONS, normalizeUserRole } from '../types';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { doc, setDoc, getDocs, collection, deleteField, updateDoc } from 'firebase/firestore';

interface PermissionsManagerProps {
  firestoreRolePermissions?: Partial<RolePermissionsMap>;
  addLog: (action: string, details?: string) => Promise<void>;
  isSuperAdmin: boolean;
}

export const ROLE_LABELS: Record<UserRole, { name: string; title: string; color: string; bg: string; border: string; desc: string }> = {
  ADMIN: { 
    name: 'Administrador', 
    title: 'Administrador',
    color: 'text-purple-700', 
    bg: 'bg-purple-50', 
    border: 'border-purple-200',
    desc: 'Control total de la plataforma y administración del sistema.' 
  },
  DIRECTIVE: { 
    name: 'Directivo', 
    title: 'Directivo',
    color: 'text-indigo-700', 
    bg: 'bg-indigo-50', 
    border: 'border-indigo-200',
    desc: 'Dirección escolar con supervisión ejecutiva y reportes generales.' 
  },
  COORDINATOR: { 
    name: 'Coordinador', 
    title: 'Coordinador',
    color: 'text-blue-700', 
    bg: 'bg-blue-50', 
    border: 'border-blue-200',
    desc: 'Supervisión de docentes, revisión de incidencias y gestión operativa.' 
  },
  PSYCHOLOGIST: { 
    name: 'Psicólogo', 
    title: 'Psicólogo',
    color: 'text-teal-700', 
    bg: 'bg-teal-50', 
    border: 'border-teal-200',
    desc: 'Atención a canalizaciones, intervención psicopedagógica y expedientes.' 
  },
  TEACHER: { 
    name: 'Docente', 
    title: 'Docente',
    color: 'text-emerald-700', 
    bg: 'bg-emerald-50', 
    border: 'border-emerald-200',
    desc: 'Registro de incidencias, solicitudes de canalización y seguimiento.' 
  },
};

export const PERMISSION_GROUPS: {
  title: string;
  description: string;
  items: { key: keyof RolePermissions; label: string; description: string; icon: React.ReactNode }[];
}[] = [
  {
    title: 'Apartados y Módulos del Panel',
    description: 'Controla qué secciones y pestañas principales se muestran en el menú de navegación.',
    items: [
      { key: 'canViewNotifications', label: 'Apartado Notificaciones', description: 'Acceso al centro de alertas y notificaciones.', icon: <Bell className="w-4 h-4 text-blue-600" /> },
      { key: 'canViewIncidents', label: 'Apartado Incidencias', description: 'Acceso a la vista y consulta de incidencias escolares.', icon: <ClipboardList className="w-4 h-4 text-indigo-600" /> },
      { key: 'canViewReferrals', label: 'Apartado Canalizaciones', description: 'Acceso a la sección de canalizaciones psicopedagógicas.', icon: <Brain className="w-4 h-4 text-teal-600" /> },
      { key: 'canViewExpedientes', label: 'Apartado Expedientes de Alumnos', description: 'Acceso al registro y archivo de expedientes de alumnos.', icon: <GraduationCap className="w-4 h-4 text-emerald-600" /> },
      { key: 'canViewInformes', label: 'Apartado Informe Psicopedagógico', description: 'Acceso al módulo de informes automáticos de canalizaciones y copia censurada.', icon: <BarChart2 className="w-4 h-4 text-amber-600" /> },
      { key: 'canViewTasks', label: 'Apartado Tareas y Pendientes', description: 'Acceso al módulo de asignación y seguimiento de tareas.', icon: <CheckSquare className="w-4 h-4 text-purple-600" /> },
      { key: 'canViewUsers', label: 'Apartado Gestión de Usuarios', description: 'Acceso al directorio y administración de usuarios.', icon: <Users className="w-4 h-4 text-amber-600" /> },
      { key: 'canViewLogs', label: 'Apartado Historial de Bitácora', description: 'Acceso al registro de eventos y auditoría del sistema.', icon: <History className="w-4 h-4 text-slate-600" /> },
      { key: 'canViewSettings', label: 'Apartado Configuración', description: 'Acceso a ajustes globales e identidad institucional.', icon: <Settings className="w-4 h-4 text-slate-700" /> },
      { key: 'canViewPermissions', label: 'Apartado Gestión de Permisos', description: 'Acceso a este módulo de control de permisos por rol.', icon: <ShieldCheck className="w-4 h-4 text-purple-700" /> },
    ]
  },
  {
    title: 'Opciones y Funciones: Incidencias Escolares',
    description: 'Acciones y permisos específicos sobre la gestión de reportes e incidencias.',
    items: [
      { key: 'canCreateIncident', label: 'Registrar / Crear Incidencias', description: 'Permite abrir el formulario y enviar reportes de incidencias.', icon: <Plus className="w-4 h-4 text-emerald-600" /> },
      { key: 'canEditIncidents', label: 'Editar Incidencias', description: 'Modificar datos, descripción o prioridad de incidencias existentes.', icon: <Edit2 className="w-4 h-4 text-amber-600" /> },
      { key: 'canDeleteIncidents', label: 'Eliminar Incidencias', description: 'Borrar permanentemente registros de incidencias.', icon: <Trash2 className="w-4 h-4 text-rose-600" /> },
      { key: 'canChangeStatus', label: 'Cambiar Estado de Incidencia', description: 'Actualizar estado a Recibido, En Seguimiento o Cerrado.', icon: <RefreshCw className="w-4 h-4 text-blue-600" /> },
      { key: 'canAddFollowUp', label: 'Agregar Notas de Seguimiento', description: 'Redactar notas, evidencias o acuerdos en la incidencia.', icon: <FileText className="w-4 h-4 text-indigo-600" /> },
      { key: 'canAssignPsychologist', label: 'Asignar Psicólogo', description: 'Derivar la incidencia a un especialista psicopedagógico.', icon: <Brain className="w-4 h-4 text-teal-600" /> },
      { key: 'canExportReports', label: 'Exportar Reportes (PDF / Excel)', description: 'Generar e imprimir reportes de incidencias.', icon: <FileText className="w-4 h-4 text-slate-700" /> },
    ]
  },
  {
    title: 'Opciones y Funciones: Canalizaciones, Expedientes y Tareas',
    description: 'Funciones para atención psicopedagógica y asignación operativa.',
    items: [
      { key: 'canCreateReferral', label: 'Sugerir / Crear Canalización', description: 'Enviar solicitudes de atención dirigida a psicología.', icon: <Brain className="w-4 h-4 text-teal-600" /> },
      { key: 'canManageExpedientes', label: 'Crear y Gestionar Expedientes', description: 'Abrir, actualizar y gestionar expedientes de alumnos.', icon: <GraduationCap className="w-4 h-4 text-emerald-600" /> },
      { key: 'canCreateTask', label: 'Crear / Asignar Tareas', description: 'Asignar tareas de seguimiento a docentes o coordinadores.', icon: <CheckSquare className="w-4 h-4 text-purple-600" /> },
    ]
  },
  {
    title: 'Opciones y Funciones: Usuarios y Comunicación',
    description: 'Gestión de directorio de personal y comunicaciones masivas.',
    items: [
      { key: 'canManageUsers', label: 'Administrar Usuarios (Crear/Editar)', description: 'Crear nuevos usuarios, editar roles o restablecer accesos.', icon: <Users className="w-4 h-4 text-amber-600" /> },
      { key: 'canSendCongratulations', label: 'Enviar Reconocimientos', description: 'Emitir y enviar diplomados o reconocimientos al personal.', icon: <Send className="w-4 h-4 text-indigo-600" /> },
      { key: 'canSendMassMessages', label: 'Envío Masivo de Correos', description: 'Permite realizar notificaciones o pruebas masivas por correo.', icon: <Send className="w-4 h-4 text-rose-600" /> },
    ]
  }
];

export const RolePermissionsManager: React.FC<PermissionsManagerProps> = ({
  firestoreRolePermissions = {},
  addLog,
  isSuperAdmin
}) => {
  const roles: UserRole[] = ['ADMIN', 'DIRECTIVE', 'COORDINATOR', 'PSYCHOLOGIST', 'TEACHER'];
  const [selectedRole, setSelectedRole] = useState<UserRole>('ADMIN');
  const [viewMode, setViewMode] = useState<'role' | 'matrix'>('role');
  const [searchQuery, setSearchQuery] = useState('');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [lastSavedMessage, setLastSavedMessage] = useState<string | null>(null);

  const [localPermissions, setLocalPermissions] = useState<Partial<RolePermissionsMap>>(() => firestoreRolePermissions || {});

  React.useEffect(() => {
    if (firestoreRolePermissions && Object.keys(firestoreRolePermissions).length > 0) {
      setLocalPermissions(prev => ({
        ...prev,
        ...firestoreRolePermissions
      }));
    }
  }, [firestoreRolePermissions]);

  // Helper to resolve current permission value for a given role & key
  const getPermValue = (role: UserRole, key: keyof RolePermissions): boolean => {
    if (localPermissions[role] && localPermissions[role]![key] !== undefined) {
      return Boolean(localPermissions[role]![key]);
    }
    if (firestoreRolePermissions[role] && firestoreRolePermissions[role]![key] !== undefined) {
      return Boolean(firestoreRolePermissions[role]![key]);
    }
    return Boolean(DEFAULT_ROLE_PERMISSIONS[role]?.[key]);
  };

  // Safe non-blocking Firestore setDoc helper to guarantee UI releases immediately
  const safeSetDoc = async (docRef: any, data: any, options?: any) => {
    try {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Timeout')), 2500)
      );
      await Promise.race([
        setDoc(docRef, data, options),
        timeoutPromise
      ]);
    } catch (err) {
      console.warn("Firestore setDoc notice:", err);
    }
  };

  // Function to toggle single permission value in Firebase collection 'permisos'
  const handleTogglePermission = async (role: UserRole, key: keyof RolePermissions, currentValue: boolean) => {
    if (!isSuperAdmin) {
      setLastSavedMessage('Únicamente el Superadministrador puede modificar los permisos globales de rol.');
      setTimeout(() => setLastSavedMessage(null), 3500);
      return;
    }

    const newValue = !currentValue;
    const saveId = `${role}-${key}`;
    setSavingKey(saveId);

    // Optimistic UI update immediately
    setLocalPermissions(prev => ({
      ...prev,
      [role]: {
        ...DEFAULT_ROLE_PERMISSIONS[role],
        ...(prev[role] || {}),
        [key]: newValue
      }
    }));

    try {
      const currentRolePerms = localPermissions[role] || firestoreRolePermissions[role] || DEFAULT_ROLE_PERMISSIONS[role];
      const updatedRolePerms = {
        ...DEFAULT_ROLE_PERMISSIONS[role],
        ...currentRolePerms,
        [key]: newValue,
        role: role,
        roleName: ROLE_LABELS[role].name,
        updatedAt: Date.now()
      };

      // 1 & 2. Update Firestore collection 'permisos' AND 'settings/global' concurrently
      await Promise.allSettled([
        safeSetDoc(doc(db, 'permisos', role), updatedRolePerms, { merge: true }),
        safeSetDoc(doc(db, 'settings', 'global'), {
          rolePermissions: {
            [role]: updatedRolePerms
          }
        }, { merge: true })
      ]);

      setLastSavedMessage(`Permiso "${key}" para ${ROLE_LABELS[role].name} actualizado (${newValue ? 'ACTIVADO' : 'DESACTIVADO'})`);
      setTimeout(() => setLastSavedMessage(null), 3000);

      // Async background tasks so the UI spinner releases immediately
      setTimeout(async () => {
        try {
          const usersSnap = await getDocs(collection(db, 'users'));
          const updatePromises: Promise<any>[] = [];
          for (const uDoc of usersSnap.docs) {
            const uData = uDoc.data();
            const userNormRole = normalizeUserRole(uData.role);
            if (userNormRole === role && uData.customPermissions && uData.customPermissions[key] !== undefined) {
              updatePromises.push(
                updateDoc(doc(db, 'users', uDoc.id), {
                  [`customPermissions.${key}`]: deleteField()
                }).catch(e => console.warn("Notice clearing user custom perm:", uDoc.id, e))
              );
            }
          }
          await Promise.allSettled(updatePromises);
        } catch (err) {
          console.warn("User custom permissions cleanup notice:", err);
        }

        try {
          await addLog(
            `Actualizó permiso en colección 'permisos'`,
            `Rol: ${ROLE_LABELS[role].name} (${role}) | Función: ${key} = ${newValue ? 'Permitido (true)' : 'Denegado (false)'}`
          );
        } catch (err) {
          console.warn("Log creation notice:", err);
        }
      }, 20);

    } catch (error) {
      console.error(`Error updating permission ${key} for role ${role}:`, error);
      // Revert optimistic change on explicit error
      setLocalPermissions(prev => ({
        ...prev,
        [role]: {
          ...DEFAULT_ROLE_PERMISSIONS[role],
          ...(prev[role] || {}),
          [key]: currentValue
        }
      }));
      setLastSavedMessage(`Error al guardar: ${error instanceof Error ? error.message : String(error)}`);
      setTimeout(() => setLastSavedMessage(null), 4000);
    } finally {
      setSavingKey(null);
    }
  };

  // Bulk actions for current role
  const handleBulkAction = async (role: UserRole, targetValue: boolean) => {
    if (!confirm(`¿${targetValue ? 'Activar' : 'Desactivar'} TODOS los permisos para el rol ${ROLE_LABELS[role].name}?`)) return;

    setSavingKey(`bulk-${role}`);

    const updatedRolePerms: Record<string, any> = {
      role: role,
      roleName: ROLE_LABELS[role].name,
      updatedAt: Date.now()
    };

    PERMISSION_GROUPS.forEach(group => {
      group.items.forEach(item => {
        updatedRolePerms[item.key] = targetValue;
      });
    });

    setLocalPermissions(prev => ({
      ...prev,
      [role]: updatedRolePerms as RolePermissions
    }));

    try {
      await Promise.allSettled([
        safeSetDoc(doc(db, 'permisos', role), updatedRolePerms, { merge: true }),
        safeSetDoc(doc(db, 'settings', 'global'), {
          rolePermissions: {
            [role]: updatedRolePerms
          }
        }, { merge: true })
      ]);

      setLastSavedMessage(`Todos los permisos para ${ROLE_LABELS[role].name} fueron ${targetValue ? 'ACTIVADOS' : 'DESACTIVADOS'}`);
      setTimeout(() => setLastSavedMessage(null), 3500);

      setTimeout(async () => {
        try {
          const usersSnap = await getDocs(collection(db, 'users'));
          for (const uDoc of usersSnap.docs) {
            const uData = uDoc.data();
            const userNormRole = normalizeUserRole(uData.role);
            if (userNormRole === role && uData.customPermissions) {
              await updateDoc(doc(db, 'users', uDoc.id), {
                customPermissions: deleteField()
              }).catch(() => {});
            }
          }
        } catch (err) {
          console.warn("User custom permissions cleanup notice during bulk action:", err);
        }

        try {
          await addLog(
            `Actualización masiva de permisos en 'permisos'`,
            `Rol: ${ROLE_LABELS[role].name} | Todos los permisos = ${targetValue ? 'ACTIVADOS (true)' : 'DESACTIVADOS (false)'}`
          );
        } catch (e) {}
      }, 20);

    } catch (error) {
      console.error(`Error applying bulk action to role ${role}:`, error);
      setLastSavedMessage(`Error al aplicar cambio masivo: ${error instanceof Error ? error.message : String(error)}`);
      setTimeout(() => setLastSavedMessage(null), 4000);
    } finally {
      setSavingKey(null);
    }
  };

  // Reset role to default values
  const handleResetDefaults = async (role: UserRole) => {
    if (!confirm(`¿Restablecer todos los permisos de ${ROLE_LABELS[role].name} a los valores predeterminados de fábrica?`)) return;

    setSavingKey(`reset-${role}`);

    const defaultPerms = {
      ...DEFAULT_ROLE_PERMISSIONS[role],
      role: role,
      roleName: ROLE_LABELS[role].name,
      updatedAt: Date.now()
    };

    setLocalPermissions(prev => ({
      ...prev,
      [role]: DEFAULT_ROLE_PERMISSIONS[role]
    }));

    try {
      await Promise.allSettled([
        safeSetDoc(doc(db, 'permisos', role), defaultPerms),
        safeSetDoc(doc(db, 'settings', 'global'), {
          rolePermissions: {
            [role]: DEFAULT_ROLE_PERMISSIONS[role]
          }
        }, { merge: true })
      ]);

      setLastSavedMessage(`Permisos de ${ROLE_LABELS[role].name} restablecidos a predeterminados.`);
      setTimeout(() => setLastSavedMessage(null), 3500);

      setTimeout(async () => {
        try {
          await addLog(
            `Restableció permisos predeterminados en 'permisos'`,
            `Rol: ${ROLE_LABELS[role].name}`
          );
        } catch (e) {}
      }, 20);

    } catch (error) {
      console.error(`Error resetting default permissions for ${role}:`, error);
      setLastSavedMessage(`Error al restablecer permisos: ${error instanceof Error ? error.message : String(error)}`);
      setTimeout(() => setLastSavedMessage(null), 4000);
    } finally {
      setSavingKey(null);
    }
  };

  // Sync role permissions to all users of this role
  const handleSyncRoleToAllUsers = async (role: UserRole) => {
    if (!confirm(`¿Sincronizar y aplicar los permisos de "${ROLE_LABELS[role].name}" a TODOS los usuarios con este rol? Esto eliminará sobreescrituras individuales en esos usuarios para que respeten el rol global.`)) return;

    setSavingKey(`sync-${role}`);
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      let updatedCount = 0;

      for (const uDoc of usersSnap.docs) {
        const uData = uDoc.data();
        const rUpper = String(uData.role || '').toUpperCase().trim();
        const matchesRole = 
          (role === 'PSYCHOLOGIST' && (rUpper === 'PSYCHOLOGIST' || rUpper === 'PSICOLOGO' || rUpper === 'PSICÓLOGO')) ||
          (role === 'TEACHER' && (rUpper === 'TEACHER' || rUpper === 'DOCENTE' || rUpper === 'PROFESOR')) ||
          (role === 'COORDINATOR' && (rUpper === 'COORDINATOR' || rUpper === 'COORDINADOR')) ||
          (role === 'DIRECTIVE' && (rUpper === 'DIRECTIVE' || rUpper === 'DIRECTIVO')) ||
          (role === 'ADMIN' && (rUpper === 'ADMIN' || rUpper === 'ADMINISTRADOR')) ||
          uData.role === role;

        if (matchesRole && uData.customPermissions) {
          await updateDoc(doc(db, 'users', uDoc.id), {
            customPermissions: deleteField()
          }).catch(() => {});
          updatedCount++;
        }
      }

      await addLog(
        `Sincronizó permisos del rol a usuarios`,
        `Rol: ${ROLE_LABELS[role].name} (${role}) | Sobreescrituras limpiadas en ${updatedCount} usuario(s)`
      ).catch(() => {});

      setLastSavedMessage(`Sincronización completada: ${updatedCount} usuario(s) limpios y alineados al rol ${ROLE_LABELS[role].name}.`);
      setTimeout(() => setLastSavedMessage(null), 4000);
    } catch (error) {
      console.error(`Error syncing role permissions to users:`, error);
      setLastSavedMessage(`Error en sincronización: ${error instanceof Error ? error.message : String(error)}`);
      setTimeout(() => setLastSavedMessage(null), 4000);
    } finally {
      setSavingKey(null);
    }
  };

  // Filter items based on query
  const matchesFilter = (item: { label: string; description: string; key: string }) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.label.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.key.toLowerCase().includes(q)
    );
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white rounded-2xl p-6 shadow-xl border border-indigo-950/40 relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-1/4 -translate-y-1/4 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 relative z-10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2.5 bg-indigo-500/20 backdrop-blur-md rounded-xl border border-indigo-400/30 text-indigo-300">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Gestión de Permisos por Rol</h2>
              <span className="bg-emerald-500/20 text-emerald-300 text-xs font-semibold px-2.5 py-1 rounded-full border border-emerald-500/30 flex items-center gap-1">
                <Check className="w-3 h-3" /> Colección Firebase: <code className="font-mono">permisos</code>
              </span>
            </div>
            <p className="text-slate-300 text-sm max-w-3xl">
              Configura de manera directa qué apartados, funciones y características puede visualizar o realizar cada rol (<strong>Administrador, Directivo, Coordinador, Psicólogo y Docente</strong>). Cada cambio se sincroniza en tiempo real en la base de datos de Firebase.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-slate-800/80 backdrop-blur border border-slate-700 p-1.5 rounded-xl self-start md:self-auto">
            <button
              onClick={() => setViewMode('role')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === 'role'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              Vista por Rol
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                viewMode === 'matrix'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              Matriz Comparativa
            </button>
          </div>
        </div>

        {lastSavedMessage && (
          <div className="mt-4 p-3 bg-emerald-950/80 border border-emerald-500/50 rounded-xl text-emerald-200 text-xs flex items-center gap-2 animate-in fade-in duration-200">
            <Check className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>{lastSavedMessage}</span>
          </div>
        )}
      </div>

      {/* Role Selection Tabs */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
          {roles.map((role) => {
            const isSelected = selectedRole === role;
            const meta = ROLE_LABELS[role];
            return (
              <button
                key={role}
                onClick={() => {
                  setSelectedRole(role);
                  if (viewMode === 'matrix') setViewMode('role');
                }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all whitespace-nowrap border ${
                  isSelected && viewMode === 'role'
                    ? `${meta.bg} ${meta.color} ${meta.border} shadow-sm font-semibold`
                    : 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                <span className={`w-2.5 h-2.5 rounded-full ${isSelected && viewMode === 'role' ? 'bg-current animate-pulse' : 'bg-slate-300'}`} />
                {meta.name}
              </button>
            );
          })}
        </div>

        {/* Search Bar */}
        <div className="relative min-w-[240px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar función o apartado..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all outline-none text-slate-800 placeholder-slate-400"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* VIEW MODE 1: Single Role Detailed View */}
      {viewMode === 'role' && (
        <div className="space-y-6">
          {/* Active Role Card Header & Bulk Actions */}
          <div className={`p-5 rounded-2xl border ${ROLE_LABELS[selectedRole].bg} ${ROLE_LABELS[selectedRole].border} flex flex-col sm:flex-row sm:items-center justify-between gap-4`}>
            <div>
              <div className="flex items-center gap-2">
                <Shield className={`w-5 h-5 ${ROLE_LABELS[selectedRole].color}`} />
                <h3 className={`text-lg font-bold ${ROLE_LABELS[selectedRole].color}`}>
                  Permisos para el rol: {ROLE_LABELS[selectedRole].name}
                </h3>
              </div>
              <p className="text-xs text-slate-600 mt-1 max-w-xl">
                {ROLE_LABELS[selectedRole].desc}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleBulkAction(selectedRole, true)}
                disabled={savingKey !== null}
                className="px-3 py-1.5 bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-50 rounded-lg text-xs font-medium shadow-sm transition-all flex items-center gap-1.5"
              >
                <Check className="w-3.5 h-3.5" />
                Permitir Todo
              </button>
              <button
                onClick={() => handleBulkAction(selectedRole, false)}
                disabled={savingKey !== null}
                className="px-3 py-1.5 bg-white text-rose-700 border border-rose-200 hover:bg-rose-50 rounded-lg text-xs font-medium shadow-sm transition-all flex items-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" />
                Denegar Todo
              </button>
              <button
                onClick={() => handleResetDefaults(selectedRole)}
                disabled={savingKey !== null}
                className="px-3 py-1.5 bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 rounded-lg text-xs font-medium shadow-sm transition-all flex items-center gap-1.5"
                title="Restablecer a valores iniciales por defecto"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Restablecer
              </button>
              <button
                onClick={() => handleSyncRoleToAllUsers(selectedRole)}
                disabled={savingKey !== null}
                className="px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-xs font-medium shadow-sm transition-all flex items-center gap-1.5"
                title="Elimina sobreescrituras individuales para que todos los usuarios de este rol respeten estrictamente la configuración global de la colección permisos"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Aplicar a Usuarios del Rol
              </button>
            </div>
          </div>

          {/* Permission Groups */}
          {PERMISSION_GROUPS.map((group, groupIdx) => {
            const filteredItems = group.items.filter(matchesFilter);
            if (filteredItems.length === 0) return null;

            return (
              <div key={groupIdx} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 bg-slate-50 border-b border-slate-200">
                  <h4 className="font-bold text-slate-900 text-sm">{group.title}</h4>
                  <p className="text-xs text-slate-500 mt-0.5">{group.description}</p>
                </div>

                <div className="divide-y divide-slate-100">
                  {filteredItems.map((item) => {
                    const isAllowed = getPermValue(selectedRole, item.key);
                    const isSavingThis = savingKey === `${selectedRole}-${item.key}`;

                    return (
                      <div 
                        key={item.key} 
                        className={`p-4 flex items-center justify-between gap-4 transition-colors hover:bg-slate-50/70 ${
                          isAllowed ? 'bg-white' : 'bg-slate-50/30'
                        }`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="p-2 bg-slate-100 rounded-xl shrink-0 mt-0.5">
                            {item.icon}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-900 text-sm tracking-tight">{item.label}</span>
                              <code className="text-[10px] font-mono bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                                {item.key}
                              </code>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{item.description}</p>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {isSavingThis && (
                            <span className="text-[11px] text-indigo-600 font-medium animate-pulse flex items-center gap-1">
                              <RefreshCw className="w-3 h-3 animate-spin" /> Guardando...
                            </span>
                          )}

                          <button
                            type="button"
                            onClick={() => handleTogglePermission(selectedRole, item.key, isAllowed)}
                            disabled={savingKey !== null}
                            className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                              isAllowed ? 'bg-emerald-500' : 'bg-slate-300'
                            }`}
                            role="switch"
                            aria-checked={isAllowed}
                          >
                            <span
                              className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                isAllowed ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* VIEW MODE 2: Matrix Comparison Table */}
      {viewMode === 'matrix' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900 text-base">Matriz General de Permisos</h3>
              <p className="text-xs text-slate-500">Compara y modifica de forma directa los permisos de los 5 roles en una sola vista.</p>
            </div>
            <div className="text-xs text-slate-400">
              Haz clic en cualquier celda para activar/desactivar el permiso
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/70 text-slate-700 text-xs font-semibold border-b border-slate-200">
                  <th className="p-4 min-w-[260px] sticky left-0 bg-slate-100 z-10">Función / Apartado</th>
                  {roles.map((r) => (
                    <th key={r} className="p-4 text-center min-w-[120px]">
                      <div className={`font-bold ${ROLE_LABELS[r].color}`}>{ROLE_LABELS[r].name}</div>
                      <div className="text-[10px] font-normal text-slate-500 font-mono mt-0.5">{r}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {PERMISSION_GROUPS.map((group, groupIdx) => {
                  const filteredItems = group.items.filter(matchesFilter);
                  if (filteredItems.length === 0) return null;

                  return (
                    <React.Fragment key={groupIdx}>
                      <tr className="bg-slate-50/80">
                        <td colSpan={6} className="px-4 py-2 font-bold text-slate-700 text-xs tracking-wide uppercase bg-slate-100/50">
                          {group.title}
                        </td>
                      </tr>
                      {filteredItems.map((item) => (
                        <tr key={item.key} className="hover:bg-slate-50/70 transition-colors">
                          <td className="p-4 sticky left-0 bg-white z-10 shadow-sm border-r border-slate-100">
                            <div className="flex items-center gap-2">
                              {item.icon}
                              <div>
                                <div className="font-semibold text-slate-900">{item.label}</div>
                                <div className="text-[10px] text-slate-500 font-mono">{item.key}</div>
                              </div>
                            </div>
                          </td>
                          {roles.map((r) => {
                            const isAllowed = getPermValue(r, item.key);
                            const isSavingThis = savingKey === `${r}-${item.key}`;

                            return (
                              <td key={r} className="p-3 text-center align-middle">
                                <button
                                  type="button"
                                  onClick={() => handleTogglePermission(r, item.key, isAllowed)}
                                  disabled={savingKey !== null}
                                  className={`inline-flex items-center justify-center p-2 rounded-xl border transition-all ${
                                    isAllowed
                                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                                      : 'bg-slate-100 text-slate-400 border-slate-200 hover:bg-slate-200 hover:text-slate-600'
                                  }`}
                                  title={`${item.label} para ${ROLE_LABELS[r].name}: ${isAllowed ? 'Permitido' : 'Denegado'}`}
                                >
                                  {isSavingThis ? (
                                    <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                                  ) : isAllowed ? (
                                    <Check className="w-4 h-4 font-bold" />
                                  ) : (
                                    <X className="w-4 h-4" />
                                  )}
                                </button>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
