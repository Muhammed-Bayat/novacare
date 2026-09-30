import { useState, type FormEvent } from 'react';

interface DisplayNameMenuProps {
  displayName: string;
  fallbackDisplayName: string;
  onSave: (nextDisplayName: string) => void;
  onLogout: () => void;
  label?: string;
}

export function DisplayNameMenu({ displayName, fallbackDisplayName, onSave, onLogout, label }: DisplayNameMenuProps) {
  const [open, setOpen] = useState(false);
  const [draftDisplayName, setDraftDisplayName] = useState(displayName);
  const displayInitial = displayName.trim().slice(0, 1).toUpperCase() || 'N';

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(draftDisplayName.trim() || fallbackDisplayName);
    setOpen(false);
  }

  return (
    <div className="nv-user-menu">
      <button
        type="button"
        className="user-chip"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setDraftDisplayName(displayName);
          setOpen((current) => !current);
        }}
      >
        <span style={{ fontWeight: 800 }}>{displayInitial}</span> <span>{label ?? `Hi, ${displayName}`}</span> <span style={{ fontSize: 12 }}>Menu</span>
      </button>
      {open ? (
        <form className="card nv-profile-menu" onSubmit={save} aria-label="Update display name">
          <h3>Profile</h3>
          <label className="nv-field">
            Display name
            <input value={draftDisplayName} onChange={(event) => setDraftDisplayName(event.target.value)} autoFocus />
          </label>
          <div className="nv-profile-actions">
            <button type="button" className="ghost-btn nv-danger" onClick={onLogout}>Logout</button>
            <button type="button" className="secondary-btn" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="primary-btn">Save</button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
