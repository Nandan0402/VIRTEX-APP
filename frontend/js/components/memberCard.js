/**
 * memberCard.js - Dynamic Gym Member Display & Check-in Feed Component
 * Operates purely on dynamic responses (no hardcoded private member details)
 */

export class MemberCardComponent {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  renderMember(member, checkIn) {
    if (!this.container) return;

    if (!member) {
      this.container.innerHTML = `
        <div class="card member-standby-card" role="status">
          <div class="standby-icon" aria-hidden="true">🪪</div>
          <h4 class="standby-title">Fast Member Check-In</h4>
          <p class="standby-desc">Enter your Member Code (e.g. GYM001) or 10-digit registered phone number below, or tell FitBot via microphone.</p>
        </div>
      `;
      return;
    }

    const checkInTime = checkIn?.check_in_time
      ? new Date(checkIn.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'Just now';

    const isMemberActive = member.status === 'active';

    this.container.innerHTML = `
      <article class="card active-member-card animate-slide-up" aria-label="Checked-in Member Information">
        <div class="member-card-header">
          <div>
            <span class="member-tag font-mono">${member.member_code || 'MEMBER'}</span>
            <h3 class="member-display-name">${member.full_name || 'Valued Member'}</h3>
          </div>
          <span class="badge ${isMemberActive ? 'badge-green' : 'badge-danger'}">
            ${isMemberActive ? 'ACTIVE MEMBER' : member.status.toUpperCase()}
          </span>
        </div>

        <div class="member-info-grid">
          <div class="info-cell">
            <span class="info-label">Membership Plan</span>
            <span class="info-value font-semibold text-green">${member.plan_name || 'Standard'}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Check-in Timestamp</span>
            <span class="info-value font-mono">${checkInTime}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Preferred Voice</span>
            <span class="info-value">${member.preferred_language || 'English'}</span>
          </div>
          <div class="info-cell">
            <span class="info-label">Status</span>
            <span class="info-value ${isMemberActive ? 'text-green' : 'text-danger'}">
              ${isMemberActive ? 'Access Granted ✓' : 'Please See Desk ✕'}
            </span>
          </div>
        </div>
      </article>
    `;
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
            <strong class="recent-name">${r.full_name || 'Gym Member'}</strong>
            <span class="recent-plan">${r.member_code || ''} • ${r.plan_name || 'Access Pass'}</span>
          </div>
          <time class="recent-time font-mono">${new Date(r.check_in_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>
        </li>
      `
      )
      .join('');
  }
}
