import React from 'react';

export function SlaIndicator({ slaStatus, createdAt }) {
  if (!slaStatus || slaStatus === 'ok') return null;

  const isCritical = slaStatus === 'critical';

  const hoursElapsed = createdAt
    ? Math.round((Date.now() - new Date(createdAt).getTime()) / 3_600_000)
    : null;

  return (
    <span style={{
      fontSize:10.5, fontWeight:700,
      padding:'2px 8px', borderRadius:999,
      background: isCritical ? 'rgba(239,68,68,.12)' : 'rgba(245,158,11,.12)',
      color:      isCritical ? 'var(--re)' : '#F59E0B',
      display:'inline-flex', alignItems:'center', gap:4, whiteSpace:'nowrap',
    }}>
      {isCritical ? '🔴' : '🟡'} {isCritical ? 'SLA Crítico' : 'SLA Warning'}
      {hoursElapsed !== null && ` · ${hoursElapsed}h`}
    </span>
  );
}

// Settings card for SLA thresholds
export function SlaSettings({ warningHours, criticalHours, onChange }) {
  return (
    <div style={{ display:'flex', gap:16, flexWrap:'wrap' }}>
      <div>
        <label style={{ fontSize:11.5, fontWeight:600, color:'var(--ts)', display:'block', marginBottom:5 }}>
          🟡 Warning (horas)
        </label>
        <input
          type="number" value={warningHours} min={1}
          onChange={e => onChange('slaWarningHours', Number(e.target.value))}
          style={{ width:100 }}
        />
      </div>
      <div>
        <label style={{ fontSize:11.5, fontWeight:600, color:'var(--ts)', display:'block', marginBottom:5 }}>
          🔴 Crítico (horas)
        </label>
        <input
          type="number" value={criticalHours} min={1}
          onChange={e => onChange('slaCriticalHours', Number(e.target.value))}
          style={{ width:100 }}
        />
      </div>
    </div>
  );
}
