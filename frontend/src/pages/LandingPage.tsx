import { Brand, SearchButton, TopBar, TopNav } from '../components/TopBar.tsx';
import logo from '../assets/nova-care-logo.png';
import '../styles/landing-page.css';

const navItems = [
  { label: 'Home', active: true },
  { label: 'Services', href: '#services' },
  { label: 'Appointments' },
  { label: 'Support' },
  { label: 'Contact' },
];

function HeroIllustration() {
  return (
    <svg viewBox="0 0 920 520" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f6fbff" />
          <stop offset="1" stopColor="#e7f4ff" />
        </linearGradient>
        <linearGradient id="scrub" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#5eaee7" />
          <stop offset="1" stopColor="#3d8fd7" />
        </linearGradient>
        <linearGradient id="coat" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="1" stopColor="#eff5fb" />
        </linearGradient>
      </defs>
      <rect width="920" height="520" rx="28" fill="url(#bg)" />
      <rect x="0" y="430" width="920" height="90" fill="#f3f9ff" />
      <circle cx="318" cy="215" r="118" fill="#ffffff" opacity=".85" />
      <circle cx="235" cy="150" r="16" fill="#d3eaf9" />
      <circle cx="390" cy="110" r="10" fill="#d3eaf9" />
      <circle cx="710" cy="110" r="12" fill="#d3eaf9" />
      <g transform="translate(190 115)">
        <ellipse cx="120" cy="245" rx="118" ry="120" fill="#efe7e0" />
        <rect x="56" y="160" width="128" height="162" rx="54" fill="#f3ede7" />
        <circle cx="120" cy="118" r="60" fill="#f0d7c4" />
        <path d="M64 106c8-54 101-78 119-22 10 30-2 58-2 58-13-18-27-28-50-26-27 2-45 19-59 36 0 0-15-21-8-46z" fill="#ececec" />
        <circle cx="99" cy="116" r="4" fill="#6d4d43" />
        <circle cx="136" cy="116" r="4" fill="#6d4d43" />
        <path d="M105 140c14 12 28 12 42 0" fill="none" stroke="#b66f5d" strokeWidth="4" strokeLinecap="round" />
      </g>
      <g transform="translate(470 70)">
        <rect x="115" y="230" width="76" height="120" rx="20" fill="#f2d4c1" />
        <circle cx="153" cy="125" r="48" fill="#f2d4c1" />
        <path d="M110 101c6-42 89-47 90 0 0 0-13 8-21 35-12-10-27-16-47-10-10 2-18 8-24 14-12-19-6-39 2-39z" fill="#6b4b45" />
        <path d="M72 164c25-40 61-54 102-54 58 0 103 25 126 75v160H35V213c10-20 18-32 37-49z" fill="url(#coat)" />
        <path d="M118 176c14 10 26 15 35 15 9 0 21-5 34-15v56h-69z" fill="url(#scrub)" />
        <path d="M150 182c17 24 26 47 26 70" fill="none" stroke="#2a394f" strokeWidth="9" strokeLinecap="round" />
        <path d="M193 183c26 29 39 56 39 82" fill="none" stroke="#2a394f" strokeWidth="9" strokeLinecap="round" />
        <circle cx="177" cy="264" r="16" fill="none" stroke="#2a394f" strokeWidth="7" />
        <path d="M175 280l-5 24" stroke="#2a394f" strokeWidth="6" strokeLinecap="round" />
        <circle cx="137" cy="120" r="4" fill="#6d4d43" />
        <circle cx="165" cy="120" r="4" fill="#6d4d43" />
        <path d="M137 142c9 7 22 7 31 0" fill="none" stroke="#b66f5d" strokeWidth="3" strokeLinecap="round" />
      </g>
      <g fill="#8ab9e7" opacity=".25">
        <path d="M0 250c123-82 221-46 295 7 77 55 153 64 237 3 70-50 171-59 388 18v242H0z" />
      </g>
    </svg>
  );
}

export function LandingPage() {
  return (
    <div className="app nv-landing">
      <TopBar>
        <Brand />
        <TopNav items={navItems} />
        <div className="actions">
          <SearchButton />
          <button type="button" className="outline-btn">Sign In</button>
        </div>
      </TopBar>

      <section className="hero-card hero">
        <div className="hero-left">
          <h1>Simple, Trusted Healthcare for Everyone</h1>
          <p className="muted">Compassionate care. Modern tools. A healthier tomorrow — at every stage of life.</p>
          <div className="hero-actions">
            <button type="button" className="primary-btn">🗓️&nbsp; Book Appointment &rarr;</button>
            <button type="button" className="secondary-btn">👤&nbsp; Find a Doctor &rarr;</button>
          </div>
          <div className="trust">
            <span>♥ People first</span>
            <span>🛡 Trusted care</span>
            <span>👥 Healthier communities</span>
          </div>
        </div>
        <div className="hero-right">
          <HeroIllustration />
          <div className="hero-note">
            Better<br />Health<br />Brighter<br />Days ♡
          </div>
          <div className="hero-callout">
            <strong>
              Care today<br />for a brighter<br />tomorrow.
            </strong>
            <img src={logo} alt="Nova Care" />
          </div>
        </div>
      </section>

      <section className="services" id="services">
        <h2 className="section-title">Our Services</h2>
        <p className="muted" style={{ fontSize: 18, margin: '8px 0 18px' }}>Everything you need for better health, all in one place.</p>
        <div className="grid-4">
          <article className="card service-card">
            <div className="icon-circle">🗓️</div>
            <div>
              <h3>Appointments</h3>
              <p>Book and manage your appointments easily.</p>
            </div>
          </article>
          <article className="card service-card">
            <div className="icon-circle" style={{ background: '#e4faf0' }}>💊</div>
            <div>
              <h3>Medication</h3>
              <p>View your prescriptions and refill requests.</p>
            </div>
          </article>
          <article className="card service-card">
            <div className="icon-circle" style={{ background: '#f1ecff' }}>📄</div>
            <div>
              <h3>Test Results</h3>
              <p>Access your test results securely and quickly.</p>
            </div>
          </article>
          <article className="card service-card">
            <div className="icon-circle">🎧</div>
            <div>
              <h3>Support</h3>
              <p>Get help when you need it, from real people.</p>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
