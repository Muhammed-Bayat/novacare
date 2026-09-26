import { useAuth0 } from '@auth0/auth0-react';
import { Brand, TopBar, TopNav } from '../components/TopBar.tsx';
import heroImage from '../assets/landing-care-hero.png';
import '../styles/landing-page.css';

const navItems = [
  { label: 'Home', active: true },
  { label: 'Services', href: '#services' },
  { label: 'Appointments' },
  { label: 'Support' },
  { label: 'Contact' },
];

const serviceCards = [
  {
    marker: '01',
    title: 'Book care faster',
    text: 'Find nearby facilities, choose a service and reserve an appointment without waiting on the phone.',
    tone: 'blue',
  },
  {
    marker: '02',
    title: 'Manage medication',
    text: 'Keep prescriptions and refill requests organised in one secure patient workspace.',
    tone: 'green',
  },
  {
    marker: '03',
    title: 'Access results',
    text: 'Review important test updates and appointment outcomes as soon as they are available.',
    tone: 'purple',
  },
  {
    marker: '04',
    title: 'Get support',
    text: 'Reach care teams, ask questions and keep communication connected after every visit.',
    tone: 'teal',
  },
];

export function LandingPage() {
  const { loginWithRedirect } = useAuth0();

  return (
    <div className="app nv-landing">
      <TopBar>
        <Brand />
        <TopNav items={navItems} />
        <div className="actions">
          <button type="button" className="outline-btn" onClick={() => void loginWithRedirect()}>Sign In</button>
        </div>
      </TopBar>

      <section className="hero-card hero">
        <div className="hero-left">
          <p className="eyebrow">Nova Care digital health</p>
          <h1>Simple, Trusted Healthcare for Everyone</h1>
          <p className="muted">Book appointments, find trusted care nearby and stay connected with your healthcare team from one clear patient portal.</p>
          <div className="hero-actions">
            <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Book Appointment</button>
            <button type="button" className="secondary-btn" onClick={() => void loginWithRedirect()}>Find a Doctor</button>
          </div>
          <div className="trust">
            <span>People first</span>
            <span>Trusted care</span>
            <span>Healthier communities</span>
          </div>
        </div>
        <div className="hero-right">
          <img className="hero-photo" src={heroImage} alt="Doctor supporting a patient in a hospital room" />
          <div className="hero-callout">
            <strong>Care today for a brighter tomorrow.</strong>
          </div>
        </div>
      </section>

      <section className="services" id="services">
        <div className="services-head">
          <div>
            <p className="eyebrow">Connected care tools</p>
            <h2 className="section-title">Services designed around real patient journeys</h2>
          </div>
          <p className="muted">Nova Care keeps the most important healthcare tasks easy to find, easy to understand and easy to complete.</p>
        </div>
        <div className="service-grid">
          {serviceCards.map((service) => (
            <article className={`card service-card ${service.tone}`} key={service.title}>
              <div className="service-marker">{service.marker}</div>
              <div>
                <h3>{service.title}</h3>
                <p>{service.text}</p>
              </div>
              <span className="service-link">Learn more</span>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
