import React from 'react';
import './Card.css';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
}

export const Card: React.FC<CardProps> = ({ children, className = '', compact, disabled }) => {
  const classes = ['card', compact ? 'compact' : '', disabled ? 'is-disabled' : '', className].filter(Boolean).join(' ');
  return (
    <article className={classes} aria-disabled={disabled}>
      {children}
    </article>
  );
};

export const CardEyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="eyebrow">{children}</span>
);

export const CardTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="title">{children}</div>
);

export const CardValue: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="value">{children}</div>
);

export const CardSupport: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="support">{children}</div>
);

export const CardMeta: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="meta">{children}</div>
);

export const CardActions: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="actions">{children}</div>
);
