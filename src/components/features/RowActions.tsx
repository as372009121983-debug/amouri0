import { useState } from 'react';
import { MoreVertical, X } from 'lucide-react';
import { createPortal } from 'react-dom';

export interface RowAction {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  hidden?: boolean;
}

interface RowActionsProps {
  actions: RowAction[];
  align?: 'right' | 'left' | 'auto';
}

const RowActions = ({ actions }: RowActionsProps) => {
  const [open, setOpen] = useState(false);

  const visible = actions.filter(a => !a.hidden);
  if (visible.length === 0) return null;

  return (
    <>
      {/* ── زر الثلاث نقاط ── */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '36px',
          height: '36px',
          borderRadius: '10px',
          border: '1px solid #e2e8f0',
          background: '#f8fafc',
          cursor: 'pointer',
          flexShrink: 0,
          touchAction: 'manipulation',
          WebkitTapHighlightColor: 'transparent',
          userSelect: 'none',
        }}
        aria-label="إجراءات"
      >
        <MoreVertical
          style={{ width: '16px', height: '16px', color: '#64748b', pointerEvents: 'none' }}
        />
      </button>

      {/* ── Center Modal via Portal ── */}
      {open && createPortal(
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px',
          }}
        >
          {/* Backdrop */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0, 0, 0, 0.55)',
            }}
            onClick={() => setOpen(false)}
          />

          {/* Modal Box */}
          <div
            style={{
              position: 'relative',
              background: '#ffffff',
              borderRadius: '20px',
              width: '100%',
              maxWidth: '320px',
              boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '16px 20px 12px',
                borderBottom: '1px solid #f1f5f9',
              }}
            >
              <span style={{ fontSize: '15px', fontWeight: 700, color: '#1e293b' }}>
                الإجراءات
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  border: 'none',
                  background: '#f1f5f9',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  touchAction: 'manipulation',
                  WebkitTapHighlightColor: 'transparent',
                }}
              >
                <X style={{ width: '14px', height: '14px', color: '#64748b', pointerEvents: 'none' }} />
              </button>
            </div>

            {/* Action Buttons */}
            <div style={{ padding: '10px 12px 14px' }}>
              {visible.map((action, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    action.onClick();
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '14px',
                    width: '100%',
                    padding: '14px 12px',
                    marginBottom: i < visible.length - 1 ? '4px' : '0',
                    background: action.danger ? '#fff5f5' : '#f8fafc',
                    border: action.danger ? '1px solid #fecaca' : '1px solid #e2e8f0',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    textAlign: 'right',
                    direction: 'rtl',
                    minHeight: '52px',
                    touchAction: 'manipulation',
                    WebkitTapHighlightColor: 'transparent',
                    userSelect: 'none',
                    transition: 'background 0.15s',
                  }}
                >
                  {action.icon && (
                    <span
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '10px',
                        background: action.danger ? '#fee2e2' : '#e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        color: action.danger ? '#ef4444' : '#475569',
                        pointerEvents: 'none',
                      }}
                    >
                      {action.icon}
                    </span>
                  )}
                  <span
                    style={{
                      fontSize: '15px',
                      fontWeight: 600,
                      color: action.danger ? '#dc2626' : '#1e293b',
                      flex: 1,
                      pointerEvents: 'none',
                    }}
                  >
                    {action.label}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
};

export default RowActions;
