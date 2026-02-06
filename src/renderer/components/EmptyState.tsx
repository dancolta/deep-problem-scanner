import React from 'react';
import './EmptyState.css';

interface EmptyStateProps {
  icon: string;
  heading: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  tip?: string;
}

export default function EmptyState({
  icon,
  heading,
  description,
  actionLabel,
  onAction,
  tip,
}: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">{icon}</div>
      <h3 className="empty-state__heading">{heading}</h3>
      <p className="empty-state__description">{description}</p>
      {actionLabel && onAction && (
        <button className="btn-primary" onClick={onAction}>
          {actionLabel}
        </button>
      )}
      {tip && <p className="empty-state__tip">{tip}</p>}
    </div>
  );
}
