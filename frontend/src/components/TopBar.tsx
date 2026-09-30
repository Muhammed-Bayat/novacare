import type { MouseEvent, ReactNode } from 'react';
import logo from '../assets/nova-care-logo.png';

export interface TopNavItem {
  label: string;
  href?: string;
  active?: boolean;
  onClick?: (event: MouseEvent) => void;
}

export function Brand() {
  return (
    <div className="brand">
      <img src={logo} alt="Nova Care logo" />
    </div>
  );
}

export function TopNav({ items }: { items: readonly TopNavItem[] }) {
  return (
    <nav className="nav">
      {items.map((item) => item.href !== undefined ? (
        <a
          key={item.label}
          className={item.active ? 'active' : undefined}
          href={item.href}
          aria-current={item.active ? 'page' : undefined}
          onClick={item.onClick}
        >
          {item.label}
        </a>
      ) : item.onClick ? (
        <button key={item.label} type="button" className={item.active ? 'active' : undefined} onClick={item.onClick}>
          {item.label}
        </button>
      ) : (
        <a key={item.label} className={item.active ? 'active' : undefined} href="#">
          {item.label}
        </a>
      ))}
    </nav>
  );
}

export function TopBar({ children }: { children: ReactNode }) {
  return <header className="topbar">{children}</header>;
}

export function SearchButton() {
  return (
    <button type="button" className="icon-btn" aria-label="Search">
      <span className="search-dot" />
    </button>
  );
}
