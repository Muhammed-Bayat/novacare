import type { ReactNode } from 'react';
import logo from '../assets/nova-care-logo.png';

export interface TopNavItem {
  label: string;
  href?: string;
  active?: boolean;
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
      {items.map((item) => (
        <a key={item.label} className={item.active ? 'active' : undefined} href={item.href ?? '#'}>
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
