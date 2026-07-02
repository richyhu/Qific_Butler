import React from 'react';
import './Button.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  children?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  label,
  children,
  className = '',
  ...props
}) => {
  const classes = ['btn', variant, size, className].filter(Boolean).join(' ');
  return (
    <button className={classes} {...props}>
      {label || children}
    </button>
  );
};
