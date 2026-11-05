/**
 * trainerSection.js - Live Trainer Roster & Floor Availability Component for Kiosk
 */

import { api } from '../services/api.js';

export class TrainerSectionComponent {
  constructor({ containerId, onTrainerConsult }) {
    this.container = document.getElementById(containerId);
    this.onTrainerConsult = onTrainerConsult;
    this.trainers = [];
    this.currentFilter = 'all';
  }

  async init() {
    await this.loadTrainers();
  }

  async loadTrainers() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 2rem; color: #a1a1aa;">
        <span style="display: inline-block; animation: spin 1s linear infinite; margin-right: 8px;">⏳</span> Loading trainer floor availability...
      </div>
    `;

    try {
      const res = await api.getTrainers();
      this.trainers = (res.success && res.data) ? res.data : [];
      this.render();
    } catch (err) {
      console.warn('[TrainerSection] Error loading trainers:', err);
      this.trainers = [];
      this.render();
    }
  }

  setFilter(filter) {
    this.currentFilter = filter;
    this.render();
  }

  render() {
    if (!this.container) return;

    const filtered = this.trainers.filter((t) => {
      if (this.currentFilter === 'all') return true;
      return t.status === this.currentFilter;
    });

    const onFloorCount = this.trainers.filter(t => t.status === 'on_floor').length;
    const inSessionCount = this.trainers.filter(t => t.status === 'in_session').length;

    this.container.innerHTML = `
      <div class="trainer-section-wrap">
        <div class="trainer-header-row">
          <div>
            <span class="section-pill text-green font-mono">EXPERT COACHING</span>
            <h2 class="section-heading">Trainer Roster & Availability</h2>
            <p class="section-sub">Certified fitness professionals available on the workout floor.</p>
          </div>

          <!-- Touchscreen Filter Tabs -->
          <div class="trainer-filter-pills" role="group" aria-label="Filter Trainers by Availability">
            <button class="btn-filter-pill ${this.currentFilter === 'all' ? 'active' : ''}" data-filter="all">
              All (${this.trainers.length})
            </button>
            <button class="btn-filter-pill ${this.currentFilter === 'on_floor' ? 'active' : ''}" data-filter="on_floor">
              <span class="status-dot-mini green"></span> On Floor (${onFloorCount})
            </button>
            <button class="btn-filter-pill ${this.currentFilter === 'in_session' ? 'active' : ''}" data-filter="in_session">
              <span class="status-dot-mini amber"></span> In Session (${inSessionCount})
            </button>
          </div>
        </div>

        <div class="trainers-grid">
          ${filtered.length === 0 ? `
            <div class="no-trainers-box">
              <p>No trainers currently match this filter.</p>
            </div>
          ` : filtered.map((t) => {
            let statusBadge = '';
            if (t.status === 'on_floor') {
              statusBadge = '<span class="trainer-status-badge on-floor">🟢 On Floor Now</span>';
            } else if (t.status === 'in_session') {
              statusBadge = '<span class="trainer-status-badge in-session">🟠 In Session</span>';
            } else {
              statusBadge = '<span class="trainer-status-badge off-duty">⚪ Off Duty</span>';
            }

            const certs = Array.isArray(t.certifications)
              ? t.certifications
              : (typeof t.certifications === 'string' && t.certifications ? t.certifications.split(',').map(c => c.trim()) : []);

            let shiftText = t.shift_hours || '';
            if (!shiftText && t.shift_start && t.shift_end) {
              shiftText = `${t.shift_start.slice(0, 5)} - ${t.shift_end.slice(0, 5)}`;
            }

            return `
              <div class="card trainer-card ${t.status === 'on_floor' ? 'trainer-featured' : ''}" role="article" aria-label="${t.full_name} Profile">
                <div class="trainer-card-top">
                  <div class="trainer-avatar-ring">
                    <span class="trainer-avatar-icon">🏋️</span>
                  </div>
                  <div class="trainer-meta">
                    <h4 class="trainer-name">${t.full_name}</h4>
                    <span class="trainer-specialty font-mono text-green">${t.specialty || 'Fitness Coach'}</span>
                  </div>
                </div>

                <div class="trainer-status-row">
                  ${statusBadge}
                  ${shiftText ? `<span class="trainer-shift-tag font-mono">Shift: ${shiftText}</span>` : ''}
                </div>

                ${t.bio ? `<p class="trainer-bio-text">${t.bio}</p>` : ''}

                ${certs.length > 0 ? `
                  <div class="trainer-certs-wrap">
                    ${certs.map(c => `<span class="cert-pill font-mono">${c}</span>`).join('')}
                  </div>
                ` : ''}

                <div class="trainer-card-actions">
                  <button class="btn btn-block btn-consult-trainer ${t.status === 'on_floor' ? 'btn-green' : 'btn-outline'}" data-name="${t.full_name}">
                    ${t.status === 'on_floor' ? '⚡ Request Floor Consultation' : '📅 Book Training Session'}
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Attach filter pill listeners
    this.container.querySelectorAll('.btn-filter-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.setFilter(btn.dataset.filter);
      });
    });

    // Attach consult listeners
    this.container.querySelectorAll('.btn-consult-trainer').forEach((btn) => {
      btn.addEventListener('click', () => {
        const trainerName = btn.dataset.name;
        if (this.onTrainerConsult) {
          this.onTrainerConsult(trainerName);
        }
      });
    });
  }
}
