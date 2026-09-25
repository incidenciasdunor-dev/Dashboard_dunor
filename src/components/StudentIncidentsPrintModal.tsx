import React from 'react';
import { Printer, X } from 'lucide-react';
import { format } from 'date-fns';
import { Incident, SystemSettings, UserProfile, IncidentStatus, normalizeUserRole, isSuperAdminEmail } from '../types';
import { useBackHandler } from '../lib/mobileNavigation';

interface StudentIncidentsPrintModalProps {
  studentName: string;
  incidents: Incident[];
  systemSettings?: SystemSettings;
  profile: UserProfile;
  coordinators?: UserProfile[];
  onClose: () => void;
}

export const StudentIncidentsPrintModal: React.FC<StudentIncidentsPrintModalProps> = ({
  studentName,
  incidents,
  systemSettings,
  profile,
  coordinators = [],
  onClose,
}) => {
  const normRole = normalizeUserRole(profile?.role);
  const isSuperAdmin = isSuperAdminEmail(profile?.email) || (profile as any)?.role === 'SUPER_ADMIN' || (profile as any)?.isSuperAdmin;
  const isAuthorized = (isSuperAdmin || normRole === 'COORDINATOR' || normRole === 'DIRECTIVE' || normRole === 'ADMIN') && incidents.length >= 2;

  useBackHandler(true, onClose, `student-incidents-print-${studentName}`);

  if (!isAuthorized) {
    return null;
  }

  const logoSrc = systemSettings?.appLogoUrl || "/logo.svg";
  const logoAppName = systemSettings?.appName || "DASHBOARD DUNOR";

  // Sort incidents chronologically (oldest to newest for progressive expediente, or newest first)
  const sortedIncidents = [...incidents].sort((a, b) => {
    const dateA = new Date(a.date).getTime() || 0;
    const dateB = new Date(b.date).getTime() || 0;
    return dateA - dateB;
  });

  // Unique schools
  const uniqueSchools = Array.from(new Set(incidents.map(i => i.school).filter(Boolean)));

  const dateRange = sortedIncidents.length > 0 
    ? `${sortedIncidents[0].date} — ${sortedIncidents[sortedIncidents.length - 1].date}`
    : format(new Date(), 'dd/MM/yyyy');

  const getCoordinatorName = (incident: Incident) => {
    if (incident.coordinatorId) {
      const found = coordinators.find(c => c.uid === incident.coordinatorId);
      if (found?.name) return found.name;
    }
    if (incident.coordinatorIds && incident.coordinatorIds.length > 0) {
      const names = incident.coordinatorIds
        .map(id => coordinators.find(c => c.uid === id)?.name || id)
        .filter(Boolean);
      if (names.length > 0) return names.join(', ');
    }
    return incident.coordinatorEmail || 'Coordinación Escolar';
  };

  const handlePrint = () => {
    const printContent = document.getElementById('printable-student-concentrated-report');
    if (!printContent) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      window.print();
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html lang="es">
        <head>
          <meta charset="utf-8" />
          <title>Concentrado de Incidencias - ${studentName}</title>
          <style>
            @page {
              size: letter;
              margin: 1.2cm;
            }
            * {
              box-sizing: border-box;
            }
            body { 
              font-family: 'Segoe UI', Roboto, -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif; 
              color: #0f172a; 
              line-height: 1.5; 
              margin: 0;
              padding: 0;
              background: #fff;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .header { 
              display: flex;
              flex-direction: row;
              align-items: center;
              justify-content: space-between;
              border-bottom: 2.5px solid #4f46e5; 
              padding-bottom: 14px; 
              margin-bottom: 20px; 
            }
            .logo-container {
              display: flex;
              flex-direction: column;
              align-items: flex-start;
            }
            .header-logo {
              height: 55px;
              width: auto;
              object-fit: contain;
              margin-bottom: 3px;
            }
            .logo-text {
              font-weight: 900;
              font-size: 13px;
              letter-spacing: 0.25em;
              color: #1e293b;
            }
            .header-text {
              text-align: right;
            }
            .header-text h1 { 
              margin: 0; 
              color: #1e293b; 
              font-size: 17px;
              font-weight: 900;
              text-transform: uppercase;
              letter-spacing: 0.04em;
            }
            .header-text p { 
              margin: 2px 0 0 0; 
              color: #64748b; 
              font-weight: 700;
              font-size: 10px;
            }
            .student-banner {
              background: #f8fafc;
              border: 1.5px solid #cbd5e1;
              border-radius: 8px;
              padding: 12px 16px;
              margin-bottom: 20px;
              display: grid;
              grid-template-columns: 1.4fr 1fr;
              gap: 12px;
            }
            .student-name {
              font-size: 17px;
              font-weight: 900;
              color: #1e293b;
              margin: 0 0 3px 0;
            }
            .sub-info {
              font-size: 10px;
              color: #475569;
              font-weight: 600;
              margin: 1px 0;
            }
            .stats-badges {
              display: flex;
              flex-wrap: wrap;
              gap: 6px;
              align-items: center;
              justify-content: flex-end;
            }
            .incident-item {
              border: 1px solid #e2e8f0;
              border-left: 4px solid #4f46e5;
              background: #ffffff;
              border-radius: 8px;
              padding: 12px 14px;
              margin-bottom: 14px;
              page-break-inside: avoid;
            }
            .inc-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 8px;
              border-bottom: 1px dashed #e2e8f0;
              padding-bottom: 6px;
            }
            .inc-title {
              font-size: 12px;
              font-weight: 800;
              color: #0f172a;
            }
            .inc-meta {
              display: flex;
              gap: 8px;
              align-items: center;
            }
            .inc-grid {
              display: grid;
              grid-template-columns: 1fr 1fr 1fr;
              gap: 8px;
              margin-bottom: 8px;
              font-size: 10px;
            }
            .inc-label {
              font-weight: 800;
              color: #64748b;
              text-transform: uppercase;
              font-size: 8.5px;
              display: block;
              margin-bottom: 1px;
            }
            .inc-value {
              font-weight: 600;
              color: #1e293b;
            }
            .categories-wrap {
              display: flex;
              flex-wrap: wrap;
              gap: 4px;
              margin-bottom: 6px;
            }
            .cat-tag {
              background: #eef2ff;
              color: #3730a3;
              padding: 1px 7px;
              border-radius: 4px;
              font-size: 9px;
              font-weight: 700;
              border: 1px solid #c7d2fe;
            }
            .box-desc {
              background: #f8fafc;
              border-left: 3px solid #6366f1;
              padding: 7px 10px;
              font-size: 10.5px;
              color: #334155;
              border-radius: 0 6px 6px 0;
              margin-top: 5px;
              white-space: pre-wrap;
              line-height: 1.45;
            }
            .box-measures {
              background: #fef2f2;
              border-left: 3px solid #ef4444;
              padding: 6px 10px;
              font-size: 10px;
              color: #991b1b;
              border-radius: 0 6px 6px 0;
              margin-top: 5px;
              white-space: pre-wrap;
              line-height: 1.4;
            }
            .box-followup {
              background: #f0fdf4;
              border-left: 3px solid #10b981;
              padding: 6px 10px;
              font-size: 10px;
              color: #166534;
              border-radius: 0 6px 6px 0;
              margin-top: 5px;
              white-space: pre-wrap;
              line-height: 1.4;
            }
            .box-referral {
              background: #fdf2f8;
              border-left: 3px solid #ec4899;
              padding: 6px 10px;
              font-size: 10px;
              color: #9d174d;
              border-radius: 0 6px 6px 0;
              margin-top: 5px;
              white-space: pre-wrap;
              line-height: 1.4;
            }
            .followup-item {
              background: #ffffff;
              border: 1px solid #e2e8f0;
              border-radius: 5px;
              padding: 5px 8px;
              margin-top: 4px;
              font-size: 9.5px;
            }
            .followup-author {
              font-weight: 800;
              color: #0f172a;
            }
            .followup-date {
              color: #94a3b8;
              font-size: 8.5px;
              margin-left: 5px;
            }
            .signatures-section {
              margin-top: 30px;
              page-break-inside: avoid;
            }
            .signatures-grid {
              display: grid;
              grid-template-columns: 1fr 1fr 1fr;
              gap: 20px;
              margin-top: 20px;
            }
            .signature-box {
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
            }
            .signature-line {
              width: 90%;
              border-bottom: 1.2px solid #334155;
              margin-bottom: 5px;
              height: 40px;
            }
            .signature-title {
              font-size: 10px;
              font-weight: 800;
              color: #0f172a;
              text-transform: uppercase;
              letter-spacing: 0.03em;
            }
            .signature-sub {
              font-size: 8.5px;
              color: #64748b;
              font-weight: 600;
            }
            .footer {
              margin-top: 30px;
              padding-top: 10px;
              border-top: 1px solid #e2e8f0;
              display: flex;
              justify-content: space-between;
              font-size: 8.5px;
              color: #94a3b8;
              font-weight: 700;
              text-transform: uppercase;
              letter-spacing: 0.04em;
              page-break-inside: avoid;
            }
          </style>
        </head>
        <body>
          <div class="report-wrapper">
            ${printContent.innerHTML}
          </div>
          <script>
            window.onload = () => {
              window.print();
              setTimeout(() => {
                window.close();
              }, 600);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  return (
    <div className="fixed inset-0 z-[300] bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-3 md:p-6 overflow-y-auto">
      <div className="bg-white dark:bg-slate-900 w-full max-w-5xl rounded-3xl shadow-2xl flex flex-col h-full max-h-[96vh] border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Header Toolbar */}
        <div className="p-4 md:px-6 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-white dark:bg-slate-900 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 rounded-2xl border border-indigo-100 dark:border-indigo-800/60">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base md:text-lg font-black text-slate-900 dark:text-white">
                  Concentrado de Reportes por Alumno
                </h2>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/60">
                  {incidents.length} {incidents.length === 1 ? 'incidencia' : 'incidencias'}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Expediente institucional para {studentName}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold text-xs md:text-sm shadow-md shadow-indigo-600/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <Printer className="w-4 h-4" />
              <span>Imprimir Concentrado</span>
            </button>
            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-all"
              title="Cerrar vista previa"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Scrollable Printable Document Preview */}
        <div className="flex-1 overflow-y-auto p-3 md:p-8 bg-slate-100/70 dark:bg-slate-950/60">
          <div 
            id="printable-student-concentrated-report" 
            className="bg-white text-slate-900 shadow-xl border border-slate-200 rounded-xl p-6 md:p-12 mx-auto w-full max-w-[21.5cm] min-h-[28cm] font-sans"
          >
            {/* Header */}
            <div className="header flex flex-row items-center justify-between border-b-[2.5px] border-indigo-600 pb-3.5 mb-5">
              <div className="logo-container flex flex-col items-start">
                {logoSrc && (
                  <img 
                    src={logoSrc} 
                    alt={logoAppName} 
                    className="header-logo object-contain max-h-[55px]"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                    }}
                  />
                )}
                <span className="logo-text font-black text-xs md:text-sm tracking-[0.25em] text-slate-900 mt-1">
                  {logoAppName}
                </span>
              </div>
              <div className="header-text text-right">
                <h1 className="text-base md:text-lg font-black text-slate-900 uppercase tracking-tight m-0">
                  Concentrado de Reportes de Incidencias
                </h1>
                <p className="text-[10px] text-slate-500 font-bold m-0 mt-0.5">
                  Fecha de expedición: {format(new Date(), "dd/MM/yyyy 'a las' HH:mm")}
                </p>
                <p className="text-[9px] text-indigo-700 font-extrabold m-0 mt-0.5 tracking-wider uppercase">
                  DOCUMENTO INSTITUCIONAL CONFIDENCIAL
                </p>
              </div>
            </div>

            {/* Student Overview Banner */}
            <div className="student-banner bg-slate-50 border border-slate-300 rounded-xl p-3.5 md:p-4 mb-5 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2">
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500 block">
                  Estudiante / Alumno:
                </span>
                <h2 className="student-name text-lg font-black text-slate-900 m-0">
                  {studentName}
                </h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
                  <span>
                    <strong>Plantel / Nivel:</strong> {uniqueSchools.join(', ') || 'Plantel General'}
                  </span>
                  <span>•</span>
                  <span>
                    <strong>Período registrado:</strong> {dateRange}
                  </span>
                </div>
              </div>

              <div className="flex flex-col md:items-end justify-center">
                <span className="text-[9px] font-extrabold uppercase tracking-wider text-slate-500 block mb-1">
                  Incidencias Registradas
                </span>
                <span className="text-sm font-black text-indigo-700 bg-indigo-50 px-3 py-1 rounded-lg border border-indigo-200 inline-block">
                  {incidents.length} {incidents.length === 1 ? 'Reporte' : 'Reportes'}
                </span>
              </div>
            </div>

            {/* List of Incidents */}
            <div className="section-title text-[11px] font-black uppercase tracking-wider text-indigo-700 border-b border-slate-200 pb-1 mb-3.5 flex items-center justify-between">
              <span>Desglose Cronológico de Incidencias Registradas</span>
              <span className="text-[9px] font-bold text-slate-400">Total: {sortedIncidents.length} reportes</span>
            </div>

            <div className="space-y-4">
              {sortedIncidents.map((incident, index) => {
                return (
                  <div 
                    key={incident.id || index}
                    className="incident-item border border-slate-200 bg-white rounded-lg p-3.5 mb-3"
                    style={{ borderLeftColor: '#4f46e5', borderLeftWidth: '4px' }}
                  >
                    {/* Header line */}
                    <div className="inc-header flex items-center justify-between pb-2 mb-2 border-b border-dashed border-slate-200">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black text-slate-900">
                          #{index + 1} — {incident.place || 'Lugar Escolar'}
                        </span>
                        {incident.school && (
                          <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100 uppercase">
                            {incident.school}
                          </span>
                        )}
                      </div>

                      <div className="inc-meta flex items-center gap-2">
                        <span className="text-[11px] font-bold text-slate-600">
                          {incident.date} {(incident as any).time ? `• ${(incident as any).time}` : ''}
                        </span>
                      </div>
                    </div>

                    {/* Meta info grid */}
                    <div className="inc-grid grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2 text-xs">
                      <div>
                        <span className="inc-label text-[9px] font-bold text-slate-500 uppercase block">Reportado por:</span>
                        <span className="inc-value font-medium text-slate-800">
                          {incident.reporterName || incident.creatorName || 'Personal Escolar'}
                          {incident.reporterRole ? ` (${incident.reporterRole})` : ''}
                        </span>
                      </div>
                      <div>
                        <span className="inc-label text-[9px] font-bold text-slate-500 uppercase block">Coordinador a cargo:</span>
                        <span className="inc-value font-medium text-slate-800">
                          {getCoordinatorName(incident)}
                        </span>
                      </div>
                      <div>
                        <span className="inc-label text-[9px] font-bold text-slate-500 uppercase block">Canalización Psicológica:</span>
                        <span className="inc-value font-medium text-slate-800">
                          {incident.referralStatus === 'IN_PROGRESS' 
                            ? 'En Atención Psicológica' 
                            : incident.referralStatus === 'SUGGESTED' 
                              ? 'Canalización Sugerida' 
                              : 'No requerida'}
                        </span>
                      </div>
                    </div>

                    {/* Categories */}
                    {incident.categories && incident.categories.length > 0 && (
                      <div className="categories-wrap flex flex-wrap gap-1 mb-2">
                        {incident.categories.map(cat => (
                          <span key={cat} className="cat-tag text-[9px] font-bold bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded border border-indigo-200">
                            {cat}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Description */}
                    <div className="mb-2">
                      <span className="inc-label text-[9px] font-bold text-slate-500 uppercase block">
                        Resumen de los hechos / Descripción:
                      </span>
                      <div className="box-desc bg-slate-50 border-l-[3px] border-indigo-600 p-2 text-xs text-slate-700 rounded-r-md whitespace-pre-wrap leading-relaxed mt-1">
                        {incident.description || 'Sin descripción redactada.'}
                      </div>
                    </div>

                    {/* Disciplinary measures */}
                    {incident.disciplinaryMeasures && (
                      <div className="mb-2">
                        <span className="inc-label text-[9px] font-bold text-red-600 uppercase block">
                          Medidas disciplinarias aplicadas:
                        </span>
                        <div className="box-measures bg-red-50/70 border-l-[3px] border-red-500 p-2 text-xs text-red-900 rounded-r-md whitespace-pre-wrap leading-relaxed mt-1">
                          {incident.disciplinaryMeasures}
                        </div>
                      </div>
                    )}

                    {/* Follow-up / Acuerdos */}
                    {incident.followUp && (
                      <div className="mb-2">
                        <span className="inc-label text-[9px] font-bold text-emerald-700 uppercase block">
                          Seguimiento institucional / Acuerdos:
                        </span>
                        <div className="box-followup bg-emerald-50/70 border-l-[3px] border-emerald-500 p-2 text-xs text-emerald-900 rounded-r-md whitespace-pre-wrap leading-relaxed mt-1">
                          {incident.followUp}
                        </div>
                      </div>
                    )}

                    {/* Referral comments if any */}
                    {incident.referralComments && (
                      <div className="mb-2">
                        <span className="inc-label text-[9px] font-bold text-pink-700 uppercase block">
                          Observaciones de Canalización:
                        </span>
                        <div className="box-referral bg-pink-50/70 border-l-[3px] border-pink-500 p-2 text-xs text-pink-900 rounded-r-md whitespace-pre-wrap leading-relaxed mt-1">
                          {incident.referralComments}
                        </div>
                      </div>
                    )}

                    {/* Follow-up history entries if available */}
                    {incident.followUpHistory && incident.followUpHistory.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-slate-100">
                        <span className="inc-label text-[8.5px] font-bold text-slate-400 uppercase block mb-1">
                          Bitácora de Notas y Seguimientos ({incident.followUpHistory.length}):
                        </span>
                        <div className="space-y-1">
                          {incident.followUpHistory.map((h, hIdx) => (
                            <div key={hIdx} className="followup-item bg-slate-50 border border-slate-200 rounded p-1.5 text-[10px]">
                              <div className="flex justify-between items-center text-slate-600 mb-0.5">
                                <span className="font-bold text-slate-800">{h.authorName || 'Personal Autorizado'}</span>
                                <span className="text-[9px] text-slate-400">
                                  {h.timestamp ? format(h.timestamp, 'dd/MM/yyyy HH:mm') : ''}
                                </span>
                              </div>
                              <p className="text-slate-700 m-0">{h.comment}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Institutional Signatures Section */}
            <div className="signatures-section mt-8 pt-4 border-t border-slate-200">
              <h3 className="section-title text-[10px] font-black uppercase tracking-wider text-indigo-700 mb-3">
                Firmas de Validación y Seguimiento Institucional
              </h3>
              <div className="signatures-grid grid grid-cols-3 gap-6 text-center mt-6">
                <div className="signature-box flex flex-col items-center">
                  <div className="signature-line w-4/5 border-b border-slate-700 h-10 mb-1.5"></div>
                  <span className="signature-title text-[10px] font-extrabold uppercase text-slate-900">
                    Coordinación Escolar
                  </span>
                  <span className="signature-sub text-[8.5px] text-slate-500 font-semibold">
                    Nombre y Firma
                  </span>
                </div>

                <div className="signature-box flex flex-col items-center">
                  <div className="signature-line w-4/5 border-b border-slate-700 h-10 mb-1.5"></div>
                  <span className="signature-title text-[10px] font-extrabold uppercase text-slate-900">
                    Dirección del Plantel
                  </span>
                  <span className="signature-sub text-[8.5px] text-slate-500 font-semibold">
                    Nombre, Sello y Firma
                  </span>
                </div>

                <div className="signature-box flex flex-col items-center">
                  <div className="signature-line w-4/5 border-b border-slate-700 h-10 mb-1.5"></div>
                  <span className="signature-title text-[10px] font-extrabold uppercase text-slate-900">
                    Padre, Madre o Tutor
                  </span>
                  <span className="signature-sub text-[8.5px] text-slate-500 font-semibold">
                    Nombre, Parentesco y Firma
                  </span>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="footer mt-8 pt-3 border-t border-slate-200 flex justify-between items-center text-[9px] text-slate-400 font-bold uppercase tracking-wider">
              <span>{logoAppName} • Concentrado Oficial de Incidencias</span>
              <span>
                Expedido por: {profile?.name || 'Personal Autorizado'} ({isSuperAdmin ? 'Soporte' : profile?.role === 'DIRECTIVE' ? 'Directivo' : profile?.role === 'COORDINATOR' ? 'Coordinador' : profile?.role === 'TEACHER' ? 'Docente' : profile?.role === 'PSYCHOLOGIST' ? 'Psicólogo' : profile?.role || 'Personal Autorizado'})
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
