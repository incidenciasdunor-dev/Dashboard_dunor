import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  UserProfile,
  UserRole,
  SystemSettings,
  RolePermissions,
  RolePermissionsMap,
  DEFAULT_ROLE_PERMISSIONS,
  getRolePermission,
  normalizeUserRole
} from '../types';
import { ShieldCheck, Save, RotateCcw, X, CheckCircle2, User } from 'lucide-react';
import { cn } from '../lib/utils';

interface UserPermissionsModalProps {
  user: UserProfile | null;
  isOpen: boolean;
  systemSettings: SystemSettings;
  firestoreRolePermissions?: Partial<RolePermissionsMap>;
  onClose: () => void;
  onSave: (userToUpdate: UserProfile, updatedPermissions: Partial<RolePermissions> | null) => Promise<void>;
}

export const UserPermissionsModal: React.FC<UserPermissionsModalProps> = ({
  user,
  isOpen,
  systemSettings,
  firestoreRolePermissions,
  onClose,
  onSave
}) => {
  const getRoleBase = (roleStr?: string): RolePermissions => {
    const normalizedRole: UserRole = normalizeUserRole(roleStr) || 'TEACHER';
    return firestoreRolePermissions?.[normalizedRole] || systemSettings?.rolePermissions?.[normalizedRole] || DEFAULT_ROLE_PERMISSIONS[normalizedRole] || DEFAULT_ROLE_PERMISSIONS.TEACHER;
  };

  const [permissionsState, setPermissionsState] = useState<RolePermissions>(() => {
    if (!user) return DEFAULT_ROLE_PERMISSIONS.TEACHER;
    const roleBase = getRoleBase(user.role);
    return {
      ...roleBase,
      ...(user.customPermissions || {})
    };
  });

  const [isSaving, setIsSaving] = useState(false);
  const [hasCustom, setHasCustom] = useState(false);

  useEffect(() => {
    if (user) {
      const roleBase = getRoleBase(user.role);
      setPermissionsState({
        ...roleBase,
        ...(user.customPermissions || {})
      });
      setHasCustom(Boolean(user.customPermissions && Object.keys(user.customPermissions).length > 0));
    }
  }, [user, systemSettings, firestoreRolePermissions]);

  if (!isOpen || !user) return null;

  const handleToggle = (key: keyof RolePermissions) => {
    setPermissionsState(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const customOnly: Partial<RolePermissions> = {};
      const roleBase = getRoleBase(user.role);
      let hasCustom = false;

      (Object.keys(permissionsState) as (keyof RolePermissions)[]).forEach(k => {
        if (permissionsState[k] !== roleBase[k]) {
          customOnly[k] = permissionsState[k];
          hasCustom = true;
        }
      });

      await onSave(user, hasCustom ? customOnly : null);
      onClose();
    } catch (e) {
      console.error("Error saving user custom permissions:", e);
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetToRoleDefaults = async () => {
    if (!confirm(`¿Restablecer los permisos de ${user.name} a los valores predeterminados de su rol (${user.role})?`)) return;
    setIsSaving(true);
    try {
      await onSave(user, null);
      onClose();
    } catch (e) {
      console.error("Error resetting user custom permissions:", e);
    } finally {
      setIsSaving(false);
    }
  };

  const permissionDefinitions: {
    category: string;
    items: { key: keyof RolePermissions; label: string; description: string }[];
  }[] = [
    {
      category: 'Módulos y Pestañas Principales',
      items: [
        { key: 'canViewNotifications', label: 'Ver Notificaciones', description: 'Acceso al módulo de notificaciones y avisos del sistema.' },
        { key: 'canViewIncidents', label: 'Ver Incidencias', description: 'Acceso a la lista, historial y detalles de incidencias reportadas.' },
        { key: 'canCreateIncident', label: 'Reportar Nueva Incidencia', description: 'Permite registrar y enviar nuevas incidencias escolares.' },
        { key: 'canViewTasks', label: 'Ver Tareas y Seguimiento', description: 'Acceso al módulo de asignación de tareas y tareas recibidas.' },
        { key: 'canCreateTask', label: 'Crear / Asignar Tareas', description: 'Permite crear y asignar tareas a coordinadores o docentes.' },
        { key: 'canViewUsers', label: 'Directorio de Usuarios', description: 'Acceso al listado de docentes, coordinadores y personal.' },
        { key: 'canViewLogs', label: 'Bitácora de Eventos (Logs)', description: 'Ver registro histórico de actividades del sistema.' },
        { key: 'canViewSettings', label: 'Configuración del Sistema', description: 'Acceso al panel de configuración e identidad escolar.' },
        { key: 'canViewPermissions', label: 'Gestión de Permisos', description: 'Acceso al módulo independiente de gestión de permisos.' },
        { key: 'canViewReferrals', label: 'Ver Canalizaciones Psicopedagógicas', description: 'Acceso al módulo de canalización y comunicación a psicología.' },
        { key: 'canCreateReferral', label: 'Crear Canalización', description: 'Permite enviar nuevas solicitudes de canalización dirigidas a psicología.' },
        { key: 'canViewExpedientes', label: 'Ver Expedientes Psicopedagógicos', description: 'Acceso al módulo de registro y seguimiento confidencial de expedientes.' },
        { key: 'canManageExpedientes', label: 'Abrir y Gestionar Expedientes', description: 'Permite crear, vincular y actualizar expedientes clínicos/psicopedagógicos.' },
      ]
    },
    {
      category: 'Acciones en Incidencias y Seguimiento',
      items: [
        { key: 'canEditIncidents', label: 'Editar Incidencias', description: 'Modificar datos, descripción o prioridad de incidencias existentes.' },
        { key: 'canDeleteIncidents', label: 'Eliminar Incidencias', description: 'Borrar permanentemente registros de incidencias.' },
        { key: 'canChangeStatus', label: 'Cambiar Estado de Incidencia', description: 'Actualizar estado (Recibido, En Seguimiento, Cerrado).' },
        { key: 'canAssignPsychologist', label: 'Asignar Psicólogo', description: 'Asignar profesional de psicología o especialista al caso.' },
        { key: 'canAddFollowUp', label: 'Agregar Seguimiento', description: 'Redactar acuerdos, notas de seguimiento y subir evidencias.' },
        { key: 'canExportReports', label: 'Exportar Reportes', description: 'Generar e imprimir archivos Excel / PDF / CSV de incidencias.' },
      ]
    },
    {
      category: 'Administración y Comunicación',
      items: [
        { key: 'canSendCongratulations', label: 'Enviar Reconocimientos', description: 'Enviar felicitaciones o reconocimientos formales al personal.' },
        { key: 'canManageUsers', label: 'Gestionar Usuarios', description: 'Crear, editar, bloquear usuarios o cambiar sus contraseñas.' },
        { key: 'canSendMassMessages', label: 'Envío Masivo de Pruebas', description: 'Permite realizar envíos masivos de notificación o correos.' },
      ]
    }
  ];

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 overflow-y-auto">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm"
        />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden z-10 my-8 max-h-[90vh] flex flex-col"
        >
          {/* Header */}
          <div className="p-6 bg-slate-900 text-white flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-bold">Permisos Individuales de Usuario</h2>
                  {hasCustom && (
                    <span className="text-[10px] font-bold bg-amber-400 text-amber-950 px-2 py-0.5 rounded-full uppercase tracking-wider">
                      Personalizado
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-300">
                  {user.name} ({user.email}) &bull; Rol base: <strong className="text-indigo-300">{user.role}</strong>
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-all"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Body */}
          <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-slate-50">
            <div className="p-4 bg-indigo-50 border border-indigo-100 rounded-xl text-xs text-indigo-900 flex items-start gap-2">
              <User className="w-4 h-4 text-indigo-600 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-bold">Permisos guardados en la base de datos para este usuario</p>
                <p className="text-indigo-700 mt-0.5">
                  Los cambios que deshabilites o habilites aquí se guardan de forma permanente en la ficha del usuario en Firestore y se respetarán estrictamente cada vez que inicie sesión.
                </p>
              </div>
            </div>

            {permissionDefinitions.map((cat, idx) => (
              <div key={idx} className="space-y-3 bg-white p-4 rounded-xl border border-slate-200">
                <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-900 border-b border-slate-100 pb-2 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-indigo-600" />
                  {cat.category}
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {cat.items.map(item => {
                    const isChecked = permissionsState[item.key];
                    return (
                      <div
                        key={item.key}
                        onClick={() => handleToggle(item.key)}
                        className={cn(
                          "p-3 rounded-xl border transition-all cursor-pointer flex items-start justify-between gap-3 select-none",
                          isChecked
                            ? "bg-indigo-50/50 border-indigo-200 hover:border-indigo-300 shadow-sm"
                            : "bg-slate-50 border-slate-200 opacity-70 hover:opacity-100"
                        )}
                      >
                        <div className="space-y-1 pr-2">
                          <span className={cn("text-xs font-bold block", isChecked ? "text-indigo-950" : "text-slate-600")}>
                            {item.label}
                          </span>
                          <p className="text-[11px] text-slate-500 leading-tight">
                            {item.description}
                          </p>
                        </div>

                        <button
                          type="button"
                          className={cn(
                            "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none mt-0.5",
                            isChecked ? "bg-indigo-600" : "bg-slate-300"
                          )}
                        >
                          <span
                            className={cn(
                              "inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm",
                              isChecked ? "translate-x-6" : "translate-x-1"
                            )}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="p-4 bg-white border-t border-slate-200 flex flex-wrap items-center justify-between gap-3 flex-shrink-0">
            {hasCustom ? (
              <button
                type="button"
                onClick={handleResetToRoleDefaults}
                disabled={isSaving}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-4 h-4 text-slate-500" />
                Restablecer a Permisos de Rol
              </button>
            ) : (
              <span className="text-xs text-slate-500 font-medium">
                Este usuario está usando los permisos predeterminados de su rol ({user.role}).
              </span>
            )}

            <div className="flex items-center gap-3 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border border-slate-200 text-slate-600 text-xs font-bold rounded-xl hover:bg-slate-50 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-100 transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                {isSaving ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                Guardar Permisos de Usuario
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
