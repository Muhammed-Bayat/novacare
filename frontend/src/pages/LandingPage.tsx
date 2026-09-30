import { useEffect, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import type { MouseEvent } from 'react';
import { Brand, TopBar, TopNav } from '../components/TopBar.tsx';
import heroImage from '../assets/landing-care-hero.png';
import '../styles/landing-page.css';

const navItems = [
  { label: 'Home', href: '#top' },
  { label: 'Services', href: '#services' },
  { label: 'Appointments', href: '#appointments' },
  { label: 'Support', href: '#support' },
  { label: 'Contact', href: '#contact' },
];

const sectionLabels: Record<string, string> = {
  services: 'Services',
  appointments: 'Appointments',
  support: 'Support',
  contact: 'Contact',
};

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

const appointmentSteps = [
  {
    marker: '01',
    title: 'Find your care',
    text: 'Search nearby facilities by service, area or specialty and see what is available today.',
    tone: 'blue',
  },
  {
    marker: '02',
    title: 'Choose a time',
    text: 'Pick an open slot that works for you and confirm the visit details in a few taps.',
    tone: 'green',
  },
  {
    marker: '03',
    title: 'Get confirmation',
    text: 'Receive your booking straight away, with reminders and changes kept in your portal.',
    tone: 'teal',
  },
];

const supportCards = [
  {
    title: 'Help centre',
    text: 'Step-by-step guides for bookings, results, prescriptions and account settings.',
    tone: 'blue',
  },
  {
    title: 'Care team messaging',
    text: 'Ask non-urgent questions and keep every conversation with your care team in one place.',
    tone: 'green',
  },
  {
    title: 'Records & billing',
    text: 'Get help understanding statements, invoices and requests for your medical records.',
    tone: 'teal',
  },
];

const contactCards = [
  { title: 'Call us', text: '0800 555 0100', note: 'Weekdays 07:00 – 19:00' },
  { title: 'Email us', text: 'hello@novacare.example', note: 'Replies within one working day' },
  { title: 'Visit us', text: '12 Care Lane, Johannesburg', note: 'Mon to Fri, 08:00 – 17:00' },
  { title: 'Patient support', text: '0800 555 0111', note: 'Seven days a week, 07:00 – 22:00' },
];

export function LandingPage() {
  const { loginWithRedirect } = useAuth0();
  const [activeTab, setActiveTab] = useState('Home');

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return undefined;
    const visible = new Set<string>();
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      });
      const current = Object.keys(sectionLabels).find((id) => visible.has(id));
      setActiveTab(current ? sectionLabels[current] : 'Home');
    }, { rootMargin: '-45% 0px -50% 0px' });
    Object.keys(sectionLabels).forEach((id) => {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    });
    return () => observer.disconnect();
  }, []);

  function goTo(event: MouseEvent, targetId: string, label: string) {
    event.preventDefault();
    setActiveTab(label);
    if (targetId === 'top') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    document.getElementById(targetId)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  const items = navItems.map((item) => ({
    ...item,
    active: item.label === activeTab,
    onClick: (event: MouseEvent) => goTo(event, item.href.slice(1), item.label),
  }));

  return (
    <div className="app nv-landing" id="top">
      <TopBar>
        <Brand />
        <TopNav items={items} />
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

      <section className="landing-section" id="appointments">
        <div className="services-head">
          <div>
            <p className="eyebrow">Appointments</p>
            <h2 className="section-title">Book care in three clear steps</h2>
          </div>
          <p className="muted">Reserve a visit without waiting on the phone. Your bookings, reminders and changes all stay together in one place.</p>
        </div>
        <div className="step-grid">
          {appointmentSteps.map((step) => (
            <article className={`card service-card ${step.tone}`} key={step.title}>
              <div className="service-marker">{step.marker}</div>
              <div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </div>
            </article>
          ))}
        </div>
        <div className="section-cta">
          <button type="button" className="primary-btn" onClick={() => void loginWithRedirect()}>Book an appointment</button>
        </div>
      </section>

      <section className="landing-section" id="support">
        <div className="services-head">
          <div>
            <p className="eyebrow">Support</p>
            <h2 className="section-title">Help whenever you need it</h2>
          </div>
          <p className="muted">From first booking to follow-up care, our team and guides keep you moving forward.</p>
        </div>
        <div className="info-grid">
          {supportCards.map((card) => (
            <article className="info-card" key={card.title}>
              <span className={`info-dot ${card.tone}`} aria-hidden="true" />
              <h3>{card.title}</h3>
              <p>{card.text}</p>
            </article>
          ))}
        </div>
        <p className="emergency-note">In an emergency, call your local emergency number or go to the nearest emergency department.</p>
      </section>

      <section className="landing-section" id="contact">
        <div className="services-head">
          <div>
            <p className="eyebrow">Contact</p>
            <h2 className="section-title">Talk to the Nova Care team</h2>
          </div>
          <p className="muted">Questions about bookings, records or your account? Reach us any of these ways and we will get back to you.</p>
        </div>
        <div className="info-grid contact-grid">
          {contactCards.map((card) => (
            <article className="info-card" key={card.title}>
              <h3>{card.title}</h3>
              <p className="contact-value">{card.text}</p>
              <p>{card.note}</p>
            </article>
          ))}
        </div>
        <div className="section-cta">
          <a className="primary-btn contact-cta" href="mailto:hello@novacare.example">Send us a message</a>
        </div>
      </section>
    </div>
  );
}
