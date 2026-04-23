import type { ReactNode } from "react";

type CardProps = {
  title?: string;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
};

export function Card({ title, children, className = "", actions }: CardProps) {
  return (
    <section className={`neon-card ${className}`.trim()}>
      {(title || actions) && (
        <header className="neon-card__head">
          {title ? <h2 className="neon-card__title">{title}</h2> : <span />}
          {actions}
        </header>
      )}
      <div className="neon-card__body">{children}</div>
    </section>
  );
}
