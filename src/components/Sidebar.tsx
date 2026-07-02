import React from 'react';
import './Sidebar.css';

interface SidebarProps {
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ children, className = '', compact, disabled }) => {
  const classes = ['sidebar', compact ? 'compact' : '', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ');
  return (
    <aside className={classes}>
      {children}
    </aside>
  );
};

export const SidebarWorkspace: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="workspace">{children}</div>
);

export const SidebarSection: React.FC<{ children: React.ReactNode; isFooter?: boolean }> = ({ children, isFooter }) => (
  <nav className={`section ${isFooter ? 'footer' : ''}`}>{children}</nav>
);

export const SidebarItem: React.FC<{ children: React.ReactNode; active?: boolean; disabled?: boolean; onClick?: () => void }> = ({ children, active, disabled, onClick }) => {
  const classes = ['item', active ? 'active' : '', disabled ? 'disabled' : ''].filter(Boolean).join(' ');
  return (
    <div className={classes} onClick={!disabled ? onClick : undefined} style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}>
      {children}
    </div>
  );
};
