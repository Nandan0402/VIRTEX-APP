/**
 * memberCard.js - Dynamic Gym Member Display & Check-in Feed Component
 * Handles Active Members, Inactive/Frozen/Expired Members, Duplicate Check-ins, and Guest / Standby States
 */

export class MemberCardComponent {
  constructor(containerId, { onEnquireClick } = {}) {
    this.container = document.getElementById(containerId);
    this.onEnquireClick = onEnquireClick;
  }

  renderMember(member, checkIn, options = {}) {
    if (!this.container) return;

    // 1. Standby State (Default)
    if (!member && !options.errorState) {
      this.container.innerHTML = `
        <div class="card member-standby-card" role="status">
          <div class="standby-icon" aria-hidden="true">🪪</div>
          <h4 class="standby-title">Fast Member Check-In</h4>
          <p class="standby-desc">Enter your Member Code (e.g. <strong>GYM001</strong>) or 10-digit phone number below, or tell FitBot via microphone.</p>
        </div>
      `;
      return;
    }

    // 2. Error / Not Found / Guest State
    if (options.errorState === 'not_found') {
      this.container.innerHTML = `
        <article class="card member-alert-card member-error-card animate-slide-up" role="alert">
          <div class="member-card-header">
            <div>
              <span class="member-tag font-mono text-danger">ID NOT RECOGNIZED</span>
              <h3 class="member-display-name">Guest / Unregistered ID</h3>
            </div>
            <span class="badge badge-danger">Not Found</span>
          </div>
          <p class="member-alert-desc">We couldn't find a membership matching "<strong>${this.escapeHtml(options.identifier || '')}</strong>".</p>
          <div class="member-alert-actions">
            <button class="btn btn-green btn-guest-enquiry">
              ✍️ Join as New Member / Guest Pass
            </button>
          </div>
        </article>
      `;

      const btn = this.container.querySelector('.btn-guest-enquiry');
      if (btn && this.onEnquireClick) {
        btn.addEventListener('click', () => this.onEnquireClick('General Membership'));
      }
      return;
    }

    // 3. Duplicate Check-in State
    if (options.errorState === 'duplicate') {
      this.container.innerHTML = `
        <article class="card member-alert-card member-warning-card animate-slide-up" role="status">
          <div class="member-card-header">
            <div>
              <span class="member-tag font-mono text-warning">RECENT CHECK-IN</span>
              <h3 class="member-display-name">${member ? this.escapeHtml(member.full_name) : 'Valued Member'}</h3>
            </div>
            <span class="badge badge-warning">Already Checked In</span>
          </div>
          <p class="member-alert-desc">${options.message || 'You have already checked in recently. Please proceed to the workout floor!'}</p>
        </article>
      `;
      return;
    }

    // 4. Inactive / Expired / Frozen Member State
    const isMemberActive = member.status === 'active';
    const statusLabel = (member.status || 'inactive').toUpperCase();

    const checkInTime = checkIn?.check_in_time
      ? new Date(checkIn.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'Just now';

    this.container.innerHTML = `
      <article class="card active-member-card ${isMemberActive ? 'member-active-glow' : 'member-inactive-glow'} animate-slide-up" aria-label="Checked-in Member Information">
        <div class="member-card-header">
          <div>
            <span class="member-tag font-mono">${member.member_code || 'MEMBER'}</span>
            <h3 class="member-display-name">${this.escapeHtml(member.full_name || 'Valued Member')}</h3>
          </div>
          <span class="badge ${isMemberActive ? 'badge-green' : 'badge-danger'}">
            ${isMemberActive ? 'ACTIVE MEMBER' : statusLabel}
          </span>
        </div>

        <div class="member-info-grid">
          <div class="info-cell">
            <span class="info-label">Membership Tier</span>
            <span class="info-value font-semibold ${isMemberActive ? 'text-green' : 'text-warning'}">${member.plan_name || 'Standard'}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">${isMemberActive ? 'Check-in Timestamp' : 'Account Status'}</span>
            <span class="info-value font-mono">${isMemberActive ? checkInTime : statusLabel}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Preferred Voice</span>
            <span class="info-value">${this.formatLangName(member.preferred_language)}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Access State</span>
            <span class="info-value ${isMemberActive ? 'text-green' : 'text-danger'} font-semibold">
              ${isMemberActive ? 'Access Granted ✓' : 'Please See Desk ✕'}
            </span>
          </div>
        </div>

        ${!isMemberActive ? `
          <div class="member-renewal-notice">
            <p>Your membership is currently <strong>${member.status}</strong>. Please visit the front desk manager to renew or reactivate your access pass.</p>
            <button class="btn btn-green btn-renew-membership" style="margin-top: 8px;">
              🔄 Renew Membership Pass
            </button>
          </div>
        ` : ''}
      </article>
    `;

    const renewBtn = this.container.querySelector('.btn-renew-membership');
    if (renewBtn && this.onEnquireClick) {
      renewBtn.addEventListener('click', () => this.onEnquireClick(member.plan_name || 'General Membership'));
    }
  }

  formatLangName(code) {
    if (code === 'kn-IN' || code === 'kn') return 'ಕನ್ನಡ (Kannada)';
    if (code === 'hi-IN' || code === 'hi') return 'हिन्दी (Hindi)';
    return 'English (India)';
  }

  renderRecentList(records = []) {
    const listContainer = document.getElementById('recent-checkins-list');
    if (!listContainer) return;

    if (!records || records.length === 0) {
      listContainer.innerHTML = `
        <li class="no-records-msg">
          <span>No check-in records for today yet.</span>
        </li>
      `;
      return;
    }

    listContainer.innerHTML = records
      .slice(0, 5)
      .map(
        (r) => `
        <li class="recent-checkin-row">
          <div class="recent-member-meta">
            <strong class="recent-name">${this.escapeHtml(r.full_name || 'Gym Member')}</strong>
            <span class="recent-plan">${r.member_code || ''} • ${r.plan_name || 'Access Pass'}</span>
          </div>
          <time class="recent-time font-mono">${new Date(r.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </li>
      `
      )
      .join('');
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
