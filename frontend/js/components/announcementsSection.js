/**
 * announcementsSection.js - Active Announcements Noticeboard Component for Kiosk
 */

import { api } from '../services/api.js';

export class AnnouncementsSectionComponent {
  constructor({ containerId, onSpeakAnnouncement }) {
    this.container = document.getElementById(containerId);
    this.onSpeakAnnouncement = onSpeakAnnouncement;
    this.announcements = [];
  }

  async init() {
    await this.loadAnnouncements();
  }

  async loadAnnouncements() {
    if (!this.container) return;

    try {
      const res = await api.getAnnouncements({ activeOnly: true });
      this.announcements = (res.success && res.data) ? res.data : [];
      this.render();
    } catch (err) {
      console.warn('[AnnouncementsSection] Error loading announcements:', err);
      this.announcements = [];
      this.render();
    }
  }

  render() {
    if (!this.container) return;

    if (!this.announcements || this.announcements.length === 0) {
      this.container.innerHTML = '';
      this.container.style.display = 'none';
      return;
    }

    this.container.style.display = 'block';
    this.container.innerHTML = `
      <div class="announcements-banner-wrap">
        <div class="announcements-header">
          <div class="announcements-title-group">
            <span class="announcement-bell-icon">🔔</span>
            <h3 class="announcements-title">Noticeboard & Gym Updates</h3>
          </div>
          <span class="font-mono text-muted text-xs">${this.announcements.length} Active Notice${this.announcements.length > 1 ? 's' : ''}</span>
        </div>

        <div class="announcements-grid">
          ${this.announcements.map((a) => {
            const priority = (a.priority || 'normal').toLowerCase();
            let priorityBadge = '';
            let priorityClass = '';

            if (priority === 'urgent') {
              priorityBadge = '🚨 URGENT';
              priorityClass = 'priority-urgent';
            } else if (priority === 'event') {
              priorityBadge = '🎉 EVENT';
              priorityClass = 'priority-event';
            } else if (priority === 'maintenance') {
              priorityBadge = '🛠️ MAINTENANCE';
              priorityClass = 'priority-maintenance';
            } else {
              priorityBadge = '📢 NOTICE';
              priorityClass = 'priority-normal';
            }

            const formattedDate = a.start_date
              ? new Date(a.start_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
              : 'Today';

            return `
              <div class="card announcement-card ${priorityClass}" role="article">
                <div class="announcement-card-header">
                  <span class="announcement-priority-pill font-mono">${priorityBadge}</span>
                  <time class="announcement-date font-mono text-xs text-muted">${formattedDate}</time>
                </div>
                <h4 class="announcement-headline">${a.title}</h4>
                <p class="announcement-body">${a.message}</p>
                <div class="announcement-footer">
                  <button class="btn btn-xs btn-speak-announcement" data-text="${encodeURIComponent(a.title + '. ' + a.message)}" aria-label="Listen to notice">
                    🔊 Listen Aloud
                  </button>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;

    // Attach speak button listeners
    this.container.querySelectorAll('.btn-speak-announcement').forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = decodeURIComponent(btn.dataset.text);
        if (this.onSpeakAnnouncement) {
          this.onSpeakAnnouncement(text);
        }
      });
    });
  }
}
